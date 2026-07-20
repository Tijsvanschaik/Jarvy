export type VadState = {
  speech: boolean;
  rms: number;
};

export type EnergyVadConfig = {
  speechThreshold: number;
  releaseThreshold: number;
  releaseFrames: number;
};

export const DEFAULT_ENERGY_VAD_CONFIG: EnergyVadConfig = {
  speechThreshold: 0.018,
  releaseThreshold: 0.012,
  releaseFrames: 6,
};

/**
 * Honest local fallback while Silero assets/integration remain follow-up work.
 * It classifies PCM energy only; it does not claim neural speech detection.
 */
export class EnergyVad {
  private readonly config: EnergyVadConfig;
  private speech = false;
  private quietFrames = 0;

  constructor(config: Partial<EnergyVadConfig> = {}) {
    this.config = { ...DEFAULT_ENERGY_VAD_CONFIG, ...config };
  }

  process(samples: Float32Array): VadState {
    let energy = 0;
    for (const sample of samples) energy += sample * sample;
    const rms = samples.length ? Math.sqrt(energy / samples.length) : 0;

    if (rms >= this.config.speechThreshold) {
      this.speech = true;
      this.quietFrames = 0;
    } else if (this.speech && rms < this.config.releaseThreshold) {
      this.quietFrames += 1;
      if (this.quietFrames >= this.config.releaseFrames) {
        this.speech = false;
        this.quietFrames = 0;
      }
    }
    return { speech: this.speech, rms };
  }

  reset(): void {
    this.speech = false;
    this.quietFrames = 0;
  }
}

export function resampleMono(samples: Float32Array, fromRate: number, toRate = 16_000): Float32Array {
  if (fromRate === toRate) return samples;
  if (fromRate <= 0 || toRate <= 0 || samples.length === 0) return new Float32Array();
  const outputLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}
