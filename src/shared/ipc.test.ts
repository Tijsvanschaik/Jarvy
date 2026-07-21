import { describe, expect, it } from "vitest";
import {
  assistantSaidPayloadSchema,
  audioChunkPayloadSchema,
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
  });

  it("rejects malformed process-boundary values", () => {
    expect(() => sessionActivatePayloadSchema.parse({ source: "wake-word" })).toThrow();
    expect(() => toolCallPayloadSchema.parse({ name: "", arguments: [] })).toThrow();
    expect(() => audioChunkPayloadSchema.parse({ wav: new ArrayBuffer(8), tsStart: 2, tsEnd: 1 })).toThrow();
    expect(() =>
      sessionActivateResultSchema.parse({
        token: { value: "", expiresAt: null },
        context: { totalTokens: -1, sections: [], warnings: [] },
      }),
    ).toThrow();
  });
});
