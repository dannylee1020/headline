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
      source: { id: "npr", name: "NPR", category: "general", url: "https://example.com/feed" },
      fetchedAt: 1000,
      headlines: [{
        id: "npr-1", title: "A headline", url: "https://example.com/story", sourceId: "npr", sourceName: "NPR", category: "general", fetchedAt: 1000, feedOrdinal: 0,
      }],
    }],
  };
}

class FakeScheduler implements TimerScheduler {
  callbacks: Array<() => void> = [];
  setInterval(callback: () => void): unknown {
    this.callbacks.push(callback);
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
    expect(scheduler.callbacks).toHaveLength(1);
    expect(controller.getHeadline()?.title).toBe("A headline");
    controller.deactivate();
    expect(controller.getHeadline()).toBeUndefined();
    expect(scheduler.callbacks).toHaveLength(0);
    controller.dispose();
    expect(scheduler.callbacks).toHaveLength(0);
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
