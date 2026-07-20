import { describe, expect, it } from "vitest";
import {
  assistantSaidPayloadSchema,
  sessionActivatePayloadSchema,
  sessionActivateResultSchema,
  toolCallPayloadSchema,
} from "./ipc";

describe("IPC boundary schemas", () => {
  it("accepts canonical session and tool payloads", () => {
    expect(sessionActivatePayloadSchema.parse({ source: "shortcut" })).toEqual({ source: "shortcut" });
    expect(toolCallPayloadSchema.parse({ name: "web_search", arguments: { query: "Ricky" } }).name).toBe("web_search");
    expect(assistantSaidPayloadSchema.parse({ id: "1", text: "Hoi", at: "12:00" }).text).toBe("Hoi");
  });

  it("rejects malformed process-boundary values", () => {
    expect(() => sessionActivatePayloadSchema.parse({ source: "wake-word" })).toThrow();
    expect(() => toolCallPayloadSchema.parse({ name: "", arguments: [] })).toThrow();
    expect(() =>
      sessionActivateResultSchema.parse({
        token: { value: "", expiresAt: null },
        context: { totalTokens: -1, sections: [], warnings: [] },
      }),
    ).toThrow();
  });
});
