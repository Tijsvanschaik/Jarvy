import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchHardClose, OpsStateAggregator, ThrottledBroadcaster } from "./opsState";

afterEach(() => vi.useRealTimers());

describe("operational state", () => {
  it("aggregates bounded transcript, queue, capture, context and session timing", () => {
    let active = true;
    let now = 1_000;
    const transcript = Array.from({ length: 20 }, (_, index) => ({
      id: String(index), tsStart: index, tsEnd: index + 1, text: `line ${index}`, source: "room" as const,
    }));
    const aggregator = new OpsStateAggregator({
      block: () => "2-verdieping",
      active: () => active,
      notesCount: () => 3,
      transcript: () => transcript,
      warnings: () => ["store warning"],
    }, 20_000, () => now);
    aggregator.setSession(true);
    aggregator.setCapture({ capture: "capturing", vadSpeech: true, level: 0.4 });
    aggregator.setQueue({ depth: 2, active: 1, oldestPendingTs: 500 });
    aggregator.setContext({ totalTokens: 10, sections: [], warnings: [] });
    aggregator.setRecap({ phase: "mapping", completed: 1, total: 2, cacheUsed: false });
    now = 6_000;
    const state = aggregator.snapshot();
    expect(state.transcript).toHaveLength(15);
    expect(state.session.durationMs).toBe(5_000);
    expect(state.session.inactivityRemainingMs).toBe(15_000);
    expect(state.block).toBe("2-verdieping");
    expect(state.recap).toEqual({ phase: "mapping", completed: 1, total: 2, cacheUsed: false });

    const close = vi.fn(() => { active = false; });
    const notify = vi.fn();
    expect(dispatchHardClose(close, notify, aggregator).session.state).toBe("idle");
    expect(close).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("broadcasts at most twice per second with a trailing snapshot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const send = vi.fn();
    const broadcaster = new ThrottledBroadcaster(send);
    broadcaster.request();
    broadcaster.request();
    broadcaster.request();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    broadcaster.dispose();
  });
});
