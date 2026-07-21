import { describe, expect, it } from "vitest";
import { formatAge, formatDuration } from "./OperatorPanel";

describe("OperatorPanel formatting", () => {
  it("renders duration and pending age deterministically", () => {
    expect(formatDuration(61_000)).toBe("1:01");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatAge(1_000, 6_000)).toBe("0:05");
  });
});
