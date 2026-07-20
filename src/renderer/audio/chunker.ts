export type ChunkerConfig = {
  sampleRate: number;
  preRollMs: number;
  silenceCloseMs: number;
  minChunkMs: number;
  maxChunkMs: number;
  minSpeechMs: number;
};

export const DEFAULT_CHUNKER_CONFIG: ChunkerConfig = {
  sampleRate: 16_000,
  preRollMs: 300,
  silenceCloseMs: 700,
  minChunkMs: 5_000,
  maxChunkMs: 30_000,
  minSpeechMs: 1_000,
};

export type PcmChunk = {
  samples: Float32Array;
  tsStart: number;
  tsEnd: number;
  speechMs: number;
  reason: "silence" | "hard-cap";
};

export class VadChunker {
  private readonly config: ChunkerConfig;
  private readonly onChunk: (chunk: PcmChunk) => void;
  private ring: Float32Array<ArrayBufferLike> = new Float32Array();
  private active: Float32Array<ArrayBufferLike>[] | null = null;
  private activeSamples = 0;
  private speechSamples = 0;
  private silenceSamples = 0;
  private sampleCursor = 0;
  private chunkStartCursor = 0;
  private epochMs = 0;
  private paused = false;

  constructor(onChunk: (chunk: PcmChunk) => void, config: Partial<ChunkerConfig> = {}) {
    this.config = { ...DEFAULT_CHUNKER_CONFIG, ...config };
    this.onChunk = onChunk;
  }

  start(epochMs = Date.now()): void {
    this.reset();
    this.epochMs = epochMs;
  }

  feed(samples: Float32Array, isSpeech: boolean): void {
    if (samples.length === 0) return;
    if (this.paused) {
      this.sampleCursor += samples.length;
      return;
    }

    let offset = 0;
    while (offset < samples.length) {
      if (!this.active && isSpeech) this.beginChunk();
      const maxSamples = msToSamples(this.config.maxChunkMs, this.config.sampleRate);
      const remaining = this.active ? maxSamples - this.activeSamples : samples.length - offset;
      const take = Math.min(samples.length - offset, Math.max(1, remaining));
      const part = samples.slice(offset, offset + take);

      if (this.active) {
        this.active.push(part);
        this.activeSamples += part.length;
        if (isSpeech) {
          this.speechSamples += part.length;
          this.silenceSamples = 0;
        } else {
          this.silenceSamples += part.length;
        }
      } else {
        this.pushPreRoll(part);
      }
      this.sampleCursor += part.length;
      offset += part.length;

      if (!this.active) continue;
      if (this.activeSamples >= maxSamples) {
        this.finish("hard-cap");
      } else if (
        this.silenceSamples >= msToSamples(this.config.silenceCloseMs, this.config.sampleRate) &&
        this.activeSamples >= msToSamples(this.config.minChunkMs, this.config.sampleRate)
      ) {
        this.finish("silence");
      }
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.active = null;
    this.activeSamples = 0;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.ring = new Float32Array();
  }

  reset(): void {
    this.ring = new Float32Array();
    this.active = null;
    this.activeSamples = 0;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.sampleCursor = 0;
    this.chunkStartCursor = 0;
    this.paused = false;
  }

  private beginChunk(): void {
    this.chunkStartCursor = this.sampleCursor - this.ring.length;
    this.active = this.ring.length ? [this.ring] : [];
    this.activeSamples = this.ring.length;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.ring = new Float32Array();
  }

  private pushPreRoll(samples: Float32Array): void {
    const limit = msToSamples(this.config.preRollMs, this.config.sampleRate);
    const combined = concatSamples([this.ring, samples]);
    this.ring = combined.length > limit ? combined.slice(combined.length - limit) : combined;
  }

  private finish(reason: PcmChunk["reason"]): void {
    if (!this.active) return;
    const speechMs = samplesToMs(this.speechSamples, this.config.sampleRate);
    if (speechMs >= this.config.minSpeechMs) {
      this.onChunk({
        samples: concatSamples(this.active),
        tsStart: this.epochMs + samplesToMs(this.chunkStartCursor, this.config.sampleRate),
        tsEnd: this.epochMs + samplesToMs(this.sampleCursor, this.config.sampleRate),
        speechMs,
        reason,
      });
    }
    this.active = null;
    this.activeSamples = 0;
    this.speechSamples = 0;
    this.silenceSamples = 0;
    this.ring = new Float32Array();
  }
}

export function concatSamples(parts: Float32Array[]): Float32Array {
  const output = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function msToSamples(milliseconds: number, sampleRate: number): number {
  return Math.round((milliseconds / 1_000) * sampleRate);
}

function samplesToMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1_000;
}
