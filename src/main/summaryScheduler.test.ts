import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SummaryScheduler, SummaryStore } from "./summaryScheduler";
import { TranscriptStore } from "./transcriptStore";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("SummaryScheduler", () => {
  it("summarizes only uncovered room entries and advances coversUntil idempotently", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-summary-"));
    roots.push(root);
    const transcript = new TranscriptStore(path.join(root, "transcript"));
    const summaries = SummaryStore.inDataDir(root);
    await Promise.all([transcript.load(), summaries.load()]);
    await transcript.append({
      id: "old",
      tsStart: 1_000,
      tsEnd: 2_000,
      text: "Feitelijke bijdrage",
      source: "room",
      block: "1-welkom",
    });
    await transcript.append({
      id: "assistant",
      tsStart: 2_500,
      tsEnd: 3_000,
      text: "Niet meenemen",
      source: "assistant",
      block: "1-welkom",
    });
    const summarize = vi.fn(async ({ entries }: { entries: Array<{ text: string }> }) =>
      entries.map((entry) => entry.text).join(" "),
    );
    const scheduler = new SummaryScheduler(transcript, summaries, { summarize }, () => 20 * 60_000);
    await scheduler.run();
    await scheduler.run();
    expect(summarize).toHaveBeenCalledOnce();
    expect((await summaries.list())[0]).toMatchObject({
      block: "1-welkom",
      summary: "Feitelijke bijdrage",
      coversUntil: 2_000,
    });
  });
});
