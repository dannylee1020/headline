import { DEFAULT_INTERVAL_MS, DEFAULT_REFRESH_INTERVAL_MS } from "../core/config.js";
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
  private readonly coordinateRefresh: ControllerOptions["coordinateRefresh"];
  private readonly intervalMs: number;
  private readonly refreshIntervalMs: number;
  private readonly maxItems: number;
  private readonly filters: ControllerOptions["filters"];
  private readonly onInvalidate: () => void;
  private snapshot: NewsSnapshot | undefined;
  private timer: unknown | undefined;
  private refreshTimer: unknown | undefined;
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
    this.coordinateRefresh = options.coordinateRefresh;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    this.maxItems = options.maxItems ?? 20;
    this.filters = options.filters;
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
    return selectHeadline(buildPool(this.snapshot, this.maxItems, this.filters), this.clock.now(), this.intervalMs, category);
  }

  activate(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    this.timer = this.scheduler.setInterval(() => this.safeInvalidate(), this.intervalMs);
    this.refreshTimer = this.scheduler.setInterval(() => this.refreshIfNeeded(), this.refreshIntervalMs);
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
    if (this.refreshTimer !== undefined) {
      try {
        this.scheduler.clearInterval(this.refreshTimer);
      } catch {
        // Ignore host timer failures.
      }
      this.refreshTimer = undefined;
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
    if (this.refreshTimer !== undefined) {
      try {
        this.scheduler.clearInterval(this.refreshTimer);
      } catch {
        // Ignore host timer failures.
      }
      this.refreshTimer = undefined;
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
    this.refreshIfNeeded();
  }

  private refreshIfNeeded(): void {
    if (!this.active || this.disposed || this.request) return;
    const lastAttempt = this.snapshot?.updatedAt ?? 0;
    if (lastAttempt && this.clock.now() - lastAttempt < this.refreshIntervalMs) return;
    const abort = new AbortController();
    this.abort = abort;
    const generation = this.generation;
    const refresh = () => this.refreshFn(abort.signal);
    const task = (this.coordinateRefresh ? this.coordinateRefresh(refresh) : refresh())
      .then(async (result) => {
        if (generation !== this.generation || this.disposed) return;
        if (!result) {
          this.snapshot = (await this.cache.read().catch(() => undefined)) ?? this.snapshot;
          this.safeInvalidate();
          return;
        }
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
