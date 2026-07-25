import { describe, expect, it, vi } from "vitest";
import { NewsController } from "../src/runtime/news-controller.js";
import { MemoryCache } from "../src/runtime/memory-cache.js";
import type { NewsSnapshot, RefreshResult, TimerScheduler } from "../src/core/types.js";

function snapshot(): NewsSnapshot {
  return {
    version: 1,
    updatedAt: 1000,
    health: [],
    sources: [{
      source: { id: "npr:general", providerId: "npr", name: "NPR", category: "general", url: "https://example.com/feed" },
      fetchedAt: 1000,
      headlines: [{
        id: "npr-1", title: "A headline", url: "https://example.com/story", sourceId: "npr:general", providerId: "npr", sourceName: "NPR", category: "general", fetchedAt: 1000, feedOrdinal: 0,
      }],
    }],
  };
}

class FakeScheduler implements TimerScheduler {
  callbacks: Array<() => void> = [];
  intervals: number[] = [];
  setInterval(callback: () => void, ms: number): unknown {
    this.callbacks.push(callback);
    this.intervals.push(ms);
    return callback;
  }
  clearInterval(handle: unknown): void {
    this.callbacks = this.callbacks.filter((callback) => callback !== handle);
  }
}

describe("NewsController", () => {
  it("activates idempotently and contains refresh errors", async () => {
    const scheduler = new FakeScheduler();
    const invalidate = vi.fn();
    const refresh = vi.fn(async (): Promise<RefreshResult> => ({ snapshot: snapshot(), failures: [] }));
    const controller = new NewsController({
      cache: new MemoryCache(),
      scheduler,
      refresh,
      onInvalidate: invalidate,
      clock: { now: () => 1000 },
    });
    expect(controller.getHeadline()).toBeUndefined();
    controller.activate();
    controller.activate();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(scheduler.callbacks).toHaveLength(2);
    expect(scheduler.intervals).toEqual([8_000, 15 * 60_000]);
    expect(controller.getHeadline()?.title).toBe("A headline");
    scheduler.callbacks[0]!();
    expect(refresh).toHaveBeenCalledTimes(1);
    controller.deactivate();
    expect(controller.getHeadline()).toBeUndefined();
    expect(scheduler.callbacks).toHaveLength(0);
    controller.dispose();
    expect(scheduler.callbacks).toHaveLength(0);
  });

  it("uses a fresh cached snapshot without refreshing on activation", async () => {
    const cache = new MemoryCache();
    await cache.write(snapshot());
    const refresh = vi.fn(async (): Promise<RefreshResult> => ({ snapshot: snapshot(), failures: [] }));
    const controller = new NewsController({
      cache,
      refresh,
      clock: { now: () => 1000 },
      onInvalidate: vi.fn(),
    });
    controller.activate();
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("never throws when the host invalidate callback fails", () => {
    const controller = new NewsController({
      cache: new MemoryCache(),
      refresh: async () => ({ snapshot: snapshot(), failures: [] }),
      onInvalidate: () => { throw new Error("host"); },
    });
    expect(() => controller.activate()).not.toThrow();
    controller.dispose();
  });
});
