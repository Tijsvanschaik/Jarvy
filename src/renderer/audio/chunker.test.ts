import { describe, expect, it } from "vitest";
import { VadChunker, type PcmChunk } from "./chunker";

const samples = (milliseconds: number, value = 0.1) => new Float32Array(milliseconds).fill(value);

function setup(config: Record<string, number> = {}) {
  const chunks: PcmChunk[] = [];
  const chunker = new VadChunker((chunk) => chunks.push(chunk), { sampleRate: 1_000, ...config });
  chunker.start(10_000);
  return { chunker, chunks };
}

describe("VadChunker", () => {
  it("keeps exactly 300 ms pre-roll and closes after silence once the chunk is long enough", () => {
    const { chunker, chunks } = setup();
    chunker.feed(samples(500, 0), false);
    chunker.feed(samples(1_100), true);
    chunker.feed(samples(3_900, 0), false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].samples).toHaveLength(5_300);
    expect(chunks[0].tsStart).toBe(10_200);
    expect(chunks[0].reason).toBe("silence");
  });

  it("drops chunks with less than one second detected speech", () => {
    const { chunker, chunks } = setup();
    chunker.feed(samples(500), true);
    chunker.feed(samples(4_500, 0), false);
    expect(chunks).toHaveLength(0);
  });

  it("hard-caps at 30 seconds even during speech", () => {
    const { chunker, chunks } = setup();
    chunker.feed(samples(30_100), true);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].samples).toHaveLength(30_000);
    expect(chunks[0].reason).toBe("hard-cap");
  });

  it("discards active audio while paused and starts cleanly after resume", () => {
    const { chunker, chunks } = setup({ minChunkMs: 1_700 });
    chunker.feed(samples(1_000), true);
    chunker.setPaused(true);
    chunker.feed(samples(2_000), true);
    chunker.setPaused(false);
    chunker.feed(samples(1_000), true);
    chunker.feed(samples(700, 0), false);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tsStart).toBe(13_000);
  });
});
