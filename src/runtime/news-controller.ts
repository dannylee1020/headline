import { DEFAULT_FEED_TTL_MS, DEFAULT_INTERVAL_MS } from "../core/config.js";
import { buildPool, selectHeadline } from "../core/pool.js";
import type { CategoryFilter, Clock, ControllerOptions, Headline, NewsSnapshot, TimerScheduler } from "../core/types.js";

const systemClock: Clock = { now: () => Date.now() };
const systemScheduler: TimerScheduler = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class NewsController {
  private readonly cache: ControllerOptions["cache"];
  private readonly clock: Clock;
  private readonly scheduler: TimerScheduler;
  private readonly refreshFn: ControllerOptions["refresh"];
  private readonly intervalMs: number;
  private readonly onInvalidate: () => void;
  private snapshot: NewsSnapshot | undefined;
  private timer: unknown | undefined;
  private request: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private active = false;
  private disposed = false;
  private generation = 0;

  constructor(options: ControllerOptions) {
    this.cache = options.cache;
    this.clock = options.clock ?? systemClock;
    this.scheduler = options.scheduler ?? systemScheduler;
    this.refreshFn = options.refresh;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.onInvalidate = () => {
      try {
        options.onInvalidate();
      } catch {
        // Host rendering must never affect agent execution.
      }
    };
  }

  isActive(): boolean {
    return this.active && !this.disposed;
  }

  getSnapshot(): NewsSnapshot | undefined {
    return this.snapshot;
  }

  getHeadline(category: CategoryFilter = "all"): Headline | undefined {
    if (!this.isActive() || !this.snapshot) return undefined;
    return selectHeadline(buildPool(this.snapshot), this.clock.now(), this.intervalMs, category);
  }

  activate(): void {
    if (this.disposed) return;
    this.active = true;
    if (this.timer === undefined) {
      this.timer = this.scheduler.setInterval(() => {
        this.safeInvalidate();
        this.refreshIfNeeded();
      }, this.intervalMs);
    }
    this.safeInvalidate();
    void this.loadAndRefresh();
  }

  deactivate(): void {
    this.active = false;
    if (this.timer !== undefined) {
      try {
        this.scheduler.clearInterval(this.timer);
      } catch {
        // Ignore host timer failures.
      }
      this.timer = undefined;
    }
    this.safeInvalidate();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    this.generation += 1;
    if (this.timer !== undefined) {
      try {
        this.scheduler.clearInterval(this.timer);
      } catch {
        // Ignore host timer failures.
      }
      this.timer = undefined;
    }
    this.abort?.abort();
    this.abort = undefined;
    this.request = undefined;
    this.safeInvalidate();
  }

  private safeInvalidate(): void {
    try {
      this.onInvalidate();
    } catch {
      // Deliberately contained.
    }
  }

  private async loadAndRefresh(): Promise<void> {
    const generation = this.generation;
    if (!this.snapshot) {
      try {
        this.snapshot = await this.cache.read();
      } catch {
        this.snapshot = undefined;
      }
      if (generation !== this.generation || this.disposed) return;
      this.safeInvalidate();
    }
    this.refreshIfNeeded(true);
  }

  private refreshIfNeeded(force = false): void {
    if (!this.active || this.disposed || this.request) return;
    const newest = Math.max(0, ...(this.snapshot?.sources.map((source) => source.fetchedAt) ?? []));
    if (!force && newest && this.clock.now() - newest < DEFAULT_FEED_TTL_MS) return;
    this.abort = new AbortController();
    const generation = this.generation;
    const task = this.refreshFn(this.abort.signal)
      .then(async (result) => {
        if (generation !== this.generation || this.disposed) return;
        this.snapshot = result.snapshot;
        try {
          await this.cache.write(result.snapshot);
        } catch {
          // A cache write is best effort; memory remains usable.
        }
        this.safeInvalidate();
      })
      .catch(() => {
        // News failures are intentionally silent.
      })
      .finally(() => {
        if (generation === this.generation) {
          this.request = undefined;
          this.abort = undefined;
        }
      });
    this.request = task;
  }
}
