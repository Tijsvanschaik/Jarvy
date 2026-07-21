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
  if (wav.byteLength < 12 || ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("Unsupported WAV: expected a RIFF/WAVE container.");
  }
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | undefined;
  let dataOffset = -1;
  let dataBytes = -1;
  for (let offset = 12; offset + 8 <= wav.byteLength;) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > wav.byteLength) throw new Error(`Invalid WAV: '${id}' chunk exceeds file length.`);
    if (id === "fmt ") {
      if (size < 16) throw new Error("Invalid WAV: fmt chunk is too short.");
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataOffset = body;
      dataBytes = size;
    }
    offset = body + size + (size % 2);
  }
  if (!format) throw new Error("Invalid WAV: missing fmt chunk.");
  if (dataOffset < 0) throw new Error("Invalid WAV: missing data chunk.");
  if (format.audioFormat !== 1 || format.channels !== 1 || format.bits !== 16) {
    throw new Error(
      `Unsupported WAV format: replay requires mono PCM16 (format=${format.audioFormat}, channels=${format.channels}, bits=${format.bits}).`,
    );
  }
  if (!Number.isInteger(format.sampleRate) || format.sampleRate < 8_000 || format.sampleRate > 192_000) {
    throw new Error(`Unsupported WAV sample rate: ${format.sampleRate}.`);
  }
  if (dataBytes % 2 !== 0) throw new Error("Invalid WAV data length.");
  const samples = new Float32Array(dataBytes / 2);
  for (let index = 0; index < samples.length; index += 1) {
    const value = view.getInt16(dataOffset + index * 2, true);
    samples[index] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }
  return { samples, sampleRate: format.sampleRate };
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}
