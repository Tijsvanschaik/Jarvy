export type ActivationCloseReason = "ui" | "shortcut" | "inactivity" | "error" | "window";

export class ActivationController {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onActivate: () => void | Promise<void>,
    private readonly onClose: (reason: ActivationCloseReason) => void | Promise<void>,
    private readonly inactivityMs = 20_000,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  async activate(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      await this.onActivate();
      this.activity();
    } catch (error) {
      this.active = false;
      this.clearTimer();
      throw error;
    }
  }

  async close(reason: ActivationCloseReason): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.clearTimer();
    await this.onClose(reason);
  }

  async toggle(source: "ui" | "shortcut" = "ui"): Promise<void> {
    if (this.active) {
      await this.close(source);
    } else {
      await this.activate();
    }
  }

  activity(): void {
    if (!this.active) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.close("inactivity");
    }, this.inactivityMs);
  }

  dispose(): void {
    this.active = false;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
