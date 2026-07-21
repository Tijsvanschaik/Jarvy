import type { ContextSectionUsage } from "./contextBuilder";
import type { QueueOpsState } from "./transcriptionQueue";
import type { CaptureState, OpsStateEvent, RecapProgress, TranscriptEntryEvent } from "../shared/ipc";

export type OpsStateSources = {
  block: () => string;
  active: () => boolean;
  notesCount: () => number;
  transcript: () => TranscriptEntryEvent[];
  warnings: () => string[];
};

type ContextOps = {
  totalTokens: number;
  sections: ContextSectionUsage[];
  warnings: string[];
};

export class OpsStateAggregator {
  private capture: CaptureState = { capture: "stopped", vadSpeech: false, level: 0 };
  private queue: QueueOpsState = { depth: 0, active: 0 };
  private context: ContextOps | undefined;
  private recap: RecapProgress = { phase: "idle", completed: 0, total: 0, cacheUsed: false };
  private phase: "idle" | "open" | "listening" | "speaking" = "idle";
  private openedAt: number | undefined;
  private lastActivityAt: number | undefined;

  constructor(
    private readonly sources: OpsStateSources,
    private readonly inactivityMs = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  setCapture(capture: CaptureState): void {
    this.capture = capture;
  }

  setQueue(queue: QueueOpsState): void {
    this.queue = queue;
  }

  setContext(context: ContextOps): void {
    this.context = context;
  }

  setRecap(recap: RecapProgress): void {
    this.recap = recap;
  }

  setSession(active: boolean, phase: "open" | "listening" | "speaking" = "open"): void {
    if (active) {
      this.openedAt ??= this.now();
      this.lastActivityAt = this.now();
      this.phase = phase;
    } else {
      this.openedAt = undefined;
      this.lastActivityAt = undefined;
      this.phase = "idle";
    }
  }

  activity(phase: "open" | "listening" | "speaking"): void {
    if (!this.sources.active()) return;
    this.phase = phase;
    this.lastActivityAt = this.now();
  }

  snapshot(): OpsStateEvent {
    const now = this.now();
    const active = this.sources.active();
    const openedAt = active ? this.openedAt : undefined;
    const remaining =
      active && this.lastActivityAt !== undefined
        ? Math.max(0, this.inactivityMs - (now - this.lastActivityAt))
        : undefined;
    return {
      block: this.sources.block(),
      session: {
        state: active ? this.phase : "idle",
        active,
        ...(openedAt === undefined ? {} : { openedAt }),
        durationMs: openedAt === undefined ? 0 : Math.max(0, now - openedAt),
        ...(remaining === undefined ? {} : { inactivityRemainingMs: remaining }),
      },
      capture: this.capture,
      queue: this.queue,
      transcript: this.sources.transcript().slice(-15),
      ...(this.context
        ? {
            context: {
              totalTokens: this.context.totalTokens,
              sections: this.context.sections,
              warnings: this.context.warnings,
            },
          }
        : {}),
      notesCount: this.sources.notesCount(),
      recap: this.recap,
      warnings: this.sources.warnings(),
    };
  }
}

export class ThrottledBroadcaster {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private pending = false;

  constructor(
    private readonly send: () => void,
    private readonly intervalMs = 500,
    private readonly now: () => number = Date.now,
    private readonly schedule: typeof setTimeout = setTimeout,
  ) {}

  request(): void {
    this.pending = true;
    const elapsed = this.now() - this.lastSentAt;
    if (elapsed >= this.intervalMs && !this.timer) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = this.schedule(() => {
        this.timer = undefined;
        this.flush();
      }, Math.max(0, this.intervalMs - elapsed));
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
  }

  private flush(): void {
    if (!this.pending) return;
    this.pending = false;
    this.lastSentAt = this.now();
    this.send();
  }
}

export function dispatchHardClose(
  close: () => void,
  notifyRenderer: () => void,
  aggregator: OpsStateAggregator,
): OpsStateEvent {
  close();
  aggregator.setSession(false);
  notifyRenderer();
  return aggregator.snapshot();
}
