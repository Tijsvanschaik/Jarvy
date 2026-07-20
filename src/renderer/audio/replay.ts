import { VadChunker, type PcmChunk } from "./chunker";
import { decodeMonoPcm16Wav } from "./wav";

export function replayWav(
  wav: ArrayBuffer,
  classify: (frame: Float32Array) => boolean,
  frameMs = 20,
): PcmChunk[] {
  const { samples, sampleRate } = decodeMonoPcm16Wav(wav);
  const chunks: PcmChunk[] = [];
  const chunker = new VadChunker((chunk) => chunks.push(chunk), { sampleRate });
  chunker.start(0);
  const frameSize = Math.max(1, Math.round((frameMs / 1_000) * sampleRate));
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    const frame = samples.slice(offset, Math.min(samples.length, offset + frameSize));
    chunker.feed(frame, classify(frame));
  }
  return chunks;
}
