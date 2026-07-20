import { describe, expect, it } from "vitest";
import { estimateTokens } from "./tokenEstimate";

describe("estimateTokens", () => {
  it("uses the agreed character heuristic and rounds up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("x".repeat(32))).toBe(10);
  });
});
