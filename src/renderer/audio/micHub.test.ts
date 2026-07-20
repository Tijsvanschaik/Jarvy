import { describe, expect, it, vi } from "vitest";
import { createRealtimeTrackLease } from "./micHub";

describe("shared microphone branch ownership", () => {
  it("stops only the cloned Realtime branch", () => {
    const sourceStop = vi.fn();
    const branchStop = vi.fn();
    const branch = { enabled: false, stop: branchStop } as unknown as MediaStreamTrack;
    const source = { stop: sourceStop, clone: () => branch } as unknown as MediaStreamTrack;
    const stream = {} as MediaStream;
    const lease = createRealtimeTrackLease(source, () => stream);
    expect(lease.stream).toBe(stream);
    expect(branch.enabled).toBe(true);
    lease.release();
    expect(branchStop).toHaveBeenCalledOnce();
    expect(sourceStop).not.toHaveBeenCalled();
  });
});
