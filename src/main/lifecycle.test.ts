import { describe, expect, it, vi } from "vitest";
import { ShutdownCoordinator } from "./lifecycle";

describe("ShutdownCoordinator", () => {
  it("runs in order exactly once across repeated shutdown requests", async () => {
    const order: string[] = [];
    const coordinator = new ShutdownCoordinator([
      { name: "audio", run: async () => void order.push("audio") },
      { name: "queue", run: async () => void order.push("queue") },
      { name: "timers", run: () => void order.push("timers") },
    ]);
    await Promise.all([coordinator.shutdown(), coordinator.shutdown()]);
    expect(order).toEqual(["audio", "queue", "timers"]);
  });

  it("continues cleanup and reports controlled failures", async () => {
    const final = vi.fn();
    const coordinator = new ShutdownCoordinator([
      { name: "first", run: () => { throw new Error("failed"); } },
      { name: "final", run: final },
    ]);
    await expect(coordinator.shutdown()).rejects.toThrow("controlled error");
    expect(final).toHaveBeenCalledOnce();
  });
});
