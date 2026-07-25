import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCES } from "../src/core/default-sources.js";
import type { NewsSnapshot } from "../src/core/types.js";
import { FileSnapshotCache } from "../src/runtime/file-cache.js";
import { FileRefreshCoordinator } from "../src/runtime/refresh-coordinator.js";

function snapshot(): NewsSnapshot {
  return {
    version: 1,
    updatedAt: 1000,
    health: [],
    sources: [{ source: DEFAULT_SOURCES.find((source) => source.id === "npr:general")!, fetchedAt: 1000, headlines: [] }],
  };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "headline-cache-"));
}

describe("persistent cache", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists snapshots and clears only cached data", async () => {
    const root = await tempRoot();
    const cache = new FileSnapshotCache({ root });
    await cache.write(snapshot());
    expect(await new FileSnapshotCache({ root }).read()).toEqual(snapshot());
    expect(await readFile(join(root, "snapshot.json"), "utf8")).toContain('"updatedAt":1000');
    await cache.clear();
    await expect(new FileSnapshotCache({ root }).read()).resolves.toBeUndefined();
  });

  it("migrates a legacy snapshot into the Headline cache", async () => {
    const root = await tempRoot();
    const legacyHome = join(root, "legacy-cache");
    const headlineHome = join(root, "headline");
    vi.stubEnv("HOME", root);
    vi.stubEnv("XDG_CACHE_HOME", legacyHome);
    vi.stubEnv("HEADLINE_HOME", headlineHome);
    const legacy = new FileSnapshotCache({ root: join(legacyHome, "headline") });
    await legacy.write(snapshot());

    const cache = new FileSnapshotCache();
    await expect(cache.read()).resolves.toEqual(snapshot());
    await expect(readFile(join(headlineHome, "cache", "snapshot.json"), "utf8")).resolves.toContain('"updatedAt":1000');
  });

  it("allows only one refresh coordinator at a time", async () => {
    const root = await tempRoot();
    const first = new FileRefreshCoordinator({ root });
    const second = new FileRefreshCoordinator({ root });
    let calls = 0;
    let release!: () => void;
    let signalStart!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { signalStart = resolve; });
    const running = first.run(async () => {
      calls += 1;
      signalStart();
      await hold;
      return "first";
    });
    await started;
    await expect(access(join(root, "refresh.lock"))).resolves.toBeUndefined();
    const skipped = await second.run(async () => {
      calls += 1;
      return "second";
    });
    release();

    const results = [await running, skipped];
    expect(results.filter((result) => result !== undefined)).toHaveLength(1);
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
    expect(calls).toBe(1);
  });
});
