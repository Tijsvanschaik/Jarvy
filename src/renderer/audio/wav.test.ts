import { describe, expect, it } from "vitest";
import { decodeMonoPcm16Wav, encodeMonoPcm16Wav, floatToPcm16 } from "./wav";

describe("PCM16 WAV", () => {
  it("writes canonical mono 16 kHz headers and sample values", () => {
    const wav = encodeMonoPcm16Wav(new Float32Array([-1, -0.5, 0, 0.5, 1]));
    const view = new DataView(wav);
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...new Uint8Array(wav, 8, 4))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(52, true)).toBe(32_767);
  });

  it("clamps conversion and decodes its output", () => {
    expect(floatToPcm16(-2)).toBe(-32_768);
    expect(floatToPcm16(2)).toBe(32_767);
    const decoded = decodeMonoPcm16Wav(encodeMonoPcm16Wav(new Float32Array([-0.25, 0.25])));
    expect(decoded.sampleRate).toBe(16_000);
    expect([...decoded.samples]).toEqual([expect.closeTo(-0.25, 4), expect.closeTo(0.25, 4)]);
  });
});
