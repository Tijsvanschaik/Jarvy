import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivationController } from "./activationController";

afterEach(() => {
  vi.useRealTimers();
});

describe("ActivationController", () => {
  it("toggles one session and closes it cleanly", async () => {
    const activate = vi.fn();
    const close = vi.fn();
    const controller = new ActivationController(activate, close);

    await controller.toggle("shortcut");
    expect(controller.isActive).toBe(true);
    expect(activate).toHaveBeenCalledOnce();

    await controller.toggle("shortcut");
    expect(controller.isActive).toBe(false);
    expect(close).toHaveBeenCalledWith("shortcut");
  });

  it("resets and fires the inactivity timeout", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const controller = new ActivationController(vi.fn(), close, 20_000);
    await controller.activate();

    await vi.advanceTimersByTimeAsync(15_000);
    controller.activity();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(close).toHaveBeenCalledWith("inactivity");
    expect(controller.isActive).toBe(false);
  });
});
