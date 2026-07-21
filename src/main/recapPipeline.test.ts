import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recapDeckJsonSchema } from "../shared/schemas";
import type { RecapDeck, TranscriptEntry } from "../shared/types";
import type { RecapStructuredRequest, RecapTextProvider } from "./recapProvider";
import { enforceParticipantEvidence, RecapJobController, RecapPipeline } from "./recapPipeline";
import { RecapStore } from "./recapStore";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function entry(id: string, block = "blok-1"): TranscriptEntry {
  return { id, block, tsStart: 1, tsEnd: 2, source: "room", text: `regel ${id}` };
}

function mapResult(block = "blok-1") {
  return { block, kernpunten: [`punt ${block}`], onzekerheden: [] };
}

function deck(slides: RecapDeck["slides"] = [{ id: "b1", soort: "blok", titel: "Blok 1", bullets: ["Punt"] }]): RecapDeck {
  return { id: "deck-1", createdAt: "2026-08-27T12:00:00.000Z", slides };
}

class QueueProvider implements RecapTextProvider {
  requests: RecapStructuredRequest[] = [];
  constructor(readonly responses: unknown[]) {}
  async generate(request: RecapStructuredRequest): Promise<unknown> {
    this.requests.push(request);
    if (!this.responses.length) throw new Error("No fake response.");
    return this.responses.shift();
  }
}

async function tempStore(): Promise<RecapStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-recap-"));
  tempDirs.push(directory);
  const store = new RecapStore(directory);
  await store.load();
  return store;
}

describe("RecapPipeline text and cache", () => {
  it("derives an OpenAI-strict schema with nullable optional slide fields", () => {
    const slides = recapDeckJsonSchema.properties as Record<string, any>;
    const slide = slides.slides.items as Record<string, any>;
    expect(slide.required).toEqual(expect.arrayContaining(["beeldPrompt", "beeldPad"]));
    expect(slide.properties.beeldPrompt.type).toEqual(["string", "null"]);
    expect(recapDeckJsonSchema).not.toHaveProperty("$schema");
  });

  it("maps once per block, reduces once, and reports cache reuse", async () => {
    const store = await tempStore();
    const transcript = [entry("a", "blok-1"), entry("b", "blok-2")];
    const provider = new QueueProvider([mapResult("blok-1"), mapResult("blok-2"), deck()]);
    const progress = vi.fn();
    const pipeline = new RecapPipeline(
      { transcript: async () => transcript, summaries: async () => [], notes: async () => [] },
      store,
      provider,
      undefined,
      { onProgress: progress },
    );

    await expect(pipeline.run()).resolves.toMatchObject({ cacheUsed: false });
    expect(provider.requests.map((request) => request.name)).toEqual(["recap_map", "recap_map", "recap_deck"]);
    expect(provider.requests[0]!.prompt).toContain('"text":"regel a"');
    await expect(pipeline.run()).resolves.toMatchObject({ cacheUsed: true });
    expect(provider.requests).toHaveLength(3);
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ phase: "ready", cacheUsed: true }));
  });

  it("invalidates cache when transcript grows", async () => {
    const store = await tempStore();
    const transcript = [entry("a")];
    const provider = new QueueProvider([mapResult(), deck(), mapResult(), deck()]);
    const pipeline = new RecapPipeline(
      { transcript: async () => transcript, summaries: async () => [], notes: async () => [] },
      store,
      provider,
      undefined,
    );
    await pipeline.run();
    transcript.push({ ...entry("b"), tsStart: 3, tsEnd: 4 });
    await expect(pipeline.run()).resolves.toMatchObject({ cacheUsed: false });
    expect(provider.requests).toHaveLength(4);
  });

  it("retries invalid structured output exactly once with validation errors", async () => {
    const provider = new QueueProvider([{ nope: true }, mapResult(), deck()]);
    const pipeline = new RecapPipeline(
      { transcript: async () => [entry("a")], summaries: async () => [], notes: async () => [] },
      await tempStore(),
      provider,
      undefined,
    );
    await pipeline.run();
    expect(provider.requests).toHaveLength(3);
    expect(provider.requests[1]!.validationErrors).toContain("kernpunten");

    const failing = new QueueProvider([{ nope: 1 }, { still: "bad" }]);
    const failedPipeline = new RecapPipeline(
      { transcript: async () => [entry("a")], summaries: async () => [], notes: async () => [] },
      await tempStore(),
      failing,
      undefined,
    );
    await expect(failedPipeline.run()).rejects.toThrow("na één herstelpoging");
    expect(failing.requests).toHaveLength(2);
  });
});

describe("RecapPipeline evidence and images", () => {
  it("removes unsupported participant slides and replaces claims with stored notes", () => {
    const filtered = enforceParticipantEvidence(
      deck([
        { id: "jan", soort: "deelnemer", titel: "Jan", bullets: ["Verzonnen claim"] },
        { id: "mia", soort: "deelnemer", titel: "Mia", bullets: ["Geen bewijs"] },
        { id: "slot", soort: "slot", titel: "Slot", bullets: ["Samen verder"] },
      ]),
      [
        {
          id: "n1",
          deelnemer: "Jan",
          type: "inzicht",
          tekst: "Ik wil klein beginnen.",
          block: "blok-1",
          timestamp: "2026-08-27T11:00:00.000Z",
        },
      ],
    );
    expect(filtered.slides).toEqual([
      { id: "jan", soort: "deelnemer", titel: "Jan", bullets: ["Ik wil klein beginnen."] },
      { id: "slot", soort: "slot", titel: "Slot", bullets: ["Samen verder"] },
    ]);
  });

  it("limits image concurrency to four and degrades individual failures", async () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`,
      soort: "blok" as const,
      titel: `Slide ${index}`,
      bullets: ["Punt"],
      beeldPrompt: `beeld ${index}`,
    }));
    let active = 0;
    let maxActive = 0;
    const imageProvider = {
      generate: vi.fn(async (_prompt: string, slideId: string) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (slideId === "s2") throw new Error("kapot");
        return `/tmp/${slideId}.png`;
      }),
    };
    const decks: RecapDeck[] = [];
    const warnings: string[] = [];
    const pipeline = new RecapPipeline(
      { transcript: async () => [entry("a")], summaries: async () => [], notes: async () => [] },
      await tempStore(),
      new QueueProvider([mapResult(), deck(slides)]),
      imageProvider,
      { onDeck: (next) => decks.push(next), onWarning: (warning) => warnings.push(warning) },
      3,
      8,
    );
    const result = await pipeline.run();
    expect(maxActive).toBe(4);
    expect(result.deck.slides.filter((slide) => slide.beeldPad)).toHaveLength(5);
    expect(decks).toHaveLength(6);
    expect(warnings).toHaveLength(1);
  });

  it("guards duplicate jobs and catches background failures", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<{ deck: RecapDeck; cacheUsed: boolean }>((resolve) => {
      release = () => resolve({ deck: deck(), cacheUsed: false });
    }));
    const controller = new RecapJobController({ run } as unknown as RecapPipeline);
    expect(controller.start()).toEqual({ started: true });
    await Promise.resolve();
    expect(controller.start()).toEqual({ started: false, alreadyRunning: true });
    release();
    await vi.waitFor(() => expect(controller.isRunning).toBe(false));
  });
});
