export const WAV_SAMPLE_RATE = 16_000;

export function floatToPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

export function encodeMonoPcm16Wav(samples: Float32Array, sampleRate = WAV_SAMPLE_RATE): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error("Invalid WAV sample rate.");
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, floatToPcm16(samples[index]), true);
  }
  return buffer;
}

export function decodeMonoPcm16Wav(wav: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(wav);
  if (wav.byteLength < 44 || ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("Unsupported WAV file.");
  }
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16) {
    throw new Error("Replay requires mono PCM16 WAV.");
  }
  const dataBytes = view.getUint32(40, true);
  if (44 + dataBytes > wav.byteLength || dataBytes % 2 !== 0) throw new Error("Invalid WAV data length.");
  const samples = new Float32Array(dataBytes / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getInt16(44 + index * 2, true);
    samples[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return { samples, sampleRate: view.getUint32(24, true) };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}
