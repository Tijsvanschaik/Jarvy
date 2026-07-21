import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptStore } from "./transcriptStore";
import {
  OpenAITranscriptionTransport,
  TranscriptionError,
  TranscriptionQueue,
  type TranscriptionRequest,
  type TranscriptionTransport,
} from "./transcriptionQueue";

const roots: string[] = [];
const wav = () => new ArrayBuffer(44);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function setup(transport: TranscriptionTransport, options: Record<string, unknown> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-queue-"));
  roots.push(root);
  const transcript = new TranscriptStore(path.join(root, "transcript"));
  await transcript.load();
  const queue = new TranscriptionQueue({
    dataDir: root,
    transcript,
    transport,
    currentBlock: () => "1-welkom",
    ...options,
  });
  await queue.load();
  return { root, transcript, queue };
}

describe("TranscriptionQueue", () => {
  it("uses concurrency two but appends out-of-order results by tsStart", async () => {
    const pending = new Map<string, (text: string) => void>();
    let active = 0;
    let maximumActive = 0;
    const transport: TranscriptionTransport = {
      transcribe: (request) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return new Promise<string>((resolve) => {
          pending.set(path.basename(request.wavPath), (text) => {
            active -= 1;
            resolve(text);
          });
        });
      },
    };
    const { transcript, queue } = await setup(transport);
    const first = await queue.enqueue(wav(), 100, 110);
    const second = await queue.enqueue(wav(), 200, 210);
    const third = await queue.enqueue(wav(), 300, 310);
    await waitUntil(() => pending.size === 2);
    pending.get(second.chunkFile)?.("second");
    await waitUntil(() => pending.has(third.chunkFile));
    pending.get(third.chunkFile)?.("third");
    expect(await transcript.list()).toEqual([]);
    pending.get(first.chunkFile)?.("first");
    await queue.waitForIdle();
    expect(maximumActive).toBe(2);
    expect((await transcript.list()).map((entry) => entry.text)).toEqual(["first", "second", "third"]);
  });

  it("retries transient failures with 1/2/4/8 second backoff and keeps raw WAV", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const transcribe = vi.fn(async () => {
      attempts += 1;
      if (attempts < 5) throw new TranscriptionError("temporary", true);
      return "hersteld";
    });
    const { root, transcript, queue } = await setup(
      { transcribe },
      { sleep: async (milliseconds: number) => void delays.push(milliseconds) },
    );
    const job = await queue.enqueue(wav(), 100, 200);
    await queue.waitForIdle();
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect((await transcript.list())[0].text).toBe("hersteld");
    await expect(fs.access(path.join(root, "audio", "chunks", job.chunkFile))).resolves.toBeUndefined();
  });

  it("recovers active manifest jobs after restart in original order", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-recovery-"));
    roots.push(root);
    const chunks = path.join(root, "audio", "chunks");
    await fs.mkdir(chunks, { recursive: true });
    await fs.writeFile(path.join(chunks, "old.wav"), new Uint8Array(wav()));
    await fs.writeFile(
      path.join(root, "audio", "queue.json"),
      JSON.stringify({
        jobs: [
          {
            id: "old",
            tsStart: 10,
            tsEnd: 20,
            chunkFile: "old.wav",
            block: "1-welkom",
            status: "active",
            attempts: 1,
            createdAt: new Date(0).toISOString(),
          },
        ],
      }),
    );
    const transcript = new TranscriptStore(path.join(root, "transcript"));
    await transcript.load();
    const transport = { transcribe: vi.fn(async (_request: TranscriptionRequest) => "recovered") };
    const queue = new TranscriptionQueue({
      dataDir: root,
      transcript,
      transport,
      currentBlock: () => "1-welkom",
    });
    await queue.load();
    await queue.waitForIdle();
    expect(transport.transcribe).toHaveBeenCalledOnce();
    expect((await transcript.list())[0].text).toBe("recovered");
  });

  it("retains permanently failed jobs and audio for manual recovery", async () => {
    const { root, queue } = await setup({
      transcribe: async () => {
        throw new TranscriptionError("bad request", false);
      },
    });
    const job = await queue.enqueue(wav(), 500, 600);
    await queue.waitForIdle();
    const manifest = JSON.parse(await fs.readFile(path.join(root, "audio", "queue.json"), "utf8")) as {
      jobs: Array<{ id: string; status: string }>;
    };
    expect(manifest.jobs).toContainEqual(expect.objectContaining({ id: job.id, status: "failed" }));
    await expect(fs.access(path.join(root, "audio", "chunks", job.chunkFile))).resolves.toBeUndefined();
  });

  it("quarantines corrupt queue state without crashing or deleting raw bytes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aiden-corrupt-queue-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "audio", "chunks"), { recursive: true });
    await fs.writeFile(path.join(root, "audio", "chunks", "preserve.wav"), "raw");
    await fs.writeFile(path.join(root, "audio", "queue.json"), "{broken");
    const warnings: string[] = [];
    const transcript = new TranscriptStore(path.join(root, "transcript"));
    await transcript.load();
    const queue = new TranscriptionQueue({
      dataDir: root,
      transcript,
      transport: { transcribe: async () => "unused" },
      currentBlock: () => "1",
      warn: (warning) => warnings.push(warning),
    });
    await expect(queue.load()).resolves.toBeUndefined();
    expect(warnings.some((warning) => warning.includes("quarantined"))).toBe(true);
    await expect(fs.readFile(path.join(root, "audio", "chunks", "preserve.wav"), "utf8")).resolves.toBe("raw");
  });

  it("persists shutdown idempotently and rejects new audio", async () => {
    const { queue } = await setup({ transcribe: async () => "done" });
    await Promise.all([queue.shutdown(), queue.shutdown()]);
    await expect(queue.enqueue(wav(), 1, 2)).rejects.toThrow("shutting down");
  });
});

describe("OpenAITranscriptionTransport", () => {
  it("falls back only for model-related unsupported responses", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ricky-transport-"));
    roots.push(root);
    const wavPath = path.join(root, "chunk.wav");
    await fs.writeFile(wavPath, new Uint8Array(wav()));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("model not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "fallback" }), { status: 200 }));
    const transport = new OpenAITranscriptionTransport(() => "test-key", fetcher);
    await expect(transport.transcribe({ wavPath, prompt: "namen", language: "nl" })).resolves.toBe("fallback");
    expect(fetcher).toHaveBeenCalledTimes(2);

    fetcher.mockReset();
    fetcher.mockResolvedValue(new Response("temporary", { status: 500 }));
    await expect(transport.transcribe({ wavPath, prompt: "namen", language: "nl" })).rejects.toMatchObject({
      transient: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let count = 0; count < 100; count += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for queue state.");
}
