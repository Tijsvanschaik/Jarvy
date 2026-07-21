import { describe, expect, it } from "vitest";
import {
  assistantSaidPayloadSchema,
  audioChunkPayloadSchema,
  cameraCaptureRequestSchema,
  cameraCaptureResponseSchema,
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  toolCallPayloadSchema,
} from "./ipc";

describe("IPC boundary schemas", () => {
  it("accepts canonical session and tool payloads", () => {
    expect(sessionActivatePayloadSchema.parse({ source: "shortcut" })).toEqual({ source: "shortcut" });
    expect(toolCallPayloadSchema.parse({ name: "web_search", arguments: { query: "Aiden" } }).name).toBe("web_search");
    expect(assistantSaidPayloadSchema.parse({ id: "1", text: "Hoi", at: "12:00" }).text).toBe("Hoi");
    expect(audioChunkPayloadSchema.parse({ wav: new ArrayBuffer(44), tsStart: 1, tsEnd: 2 }).wav.byteLength).toBe(44);
    const correlationId = "7d6d8c11-68df-4b38-a432-e96f57160793";
    expect(cameraCaptureRequestSchema.parse({ correlationId, frames: 2, timeoutMs: 4_000 }).frames).toBe(2);
    expect(cameraCaptureResponseSchema.parse({
      correlationId,
      ok: true,
      frames: [{ mediaType: "image/jpeg", data: "transient", width: 1024, height: 576 }],
    }).ok).toBe(true);
  });

  it("rejects malformed process-boundary values", () => {
    expect(() => sessionActivatePayloadSchema.parse({ source: "wake-word" })).toThrow();
    expect(() => toolCallPayloadSchema.parse({ name: "", arguments: [] })).toThrow();
    expect(() => audioChunkPayloadSchema.parse({ wav: new ArrayBuffer(8), tsStart: 2, tsEnd: 1 })).toThrow();
    expect(() => cameraCaptureRequestSchema.parse({
      correlationId: "not-a-uuid",
      frames: 4,
      timeoutMs: 10,
    })).toThrow();
    expect(() =>
      sessionActivateResultSchema.parse({
        token: { value: "", expiresAt: null },
        context: { totalTokens: -1, sections: [], warnings: [] },
      }),
    ).toThrow();
  });
});
