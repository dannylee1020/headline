import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ActivityStore, FileSnapshotCache } from "../../runtime/file-cache.js";
import { DEFAULT_SOURCES } from "../../core/default-sources.js";
import { DEFAULT_INTERVAL_MS, DEFAULT_USER_AGENT } from "../../core/config.js";
import { formatHeadline } from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { buildPool, selectHeadline } from "../../core/pool.js";
import type { NewsSnapshot } from "../../core/types.js";

export interface HookInput {
  readonly session_id?: string;
  readonly sessionId?: string;
  readonly session?: { id?: string };
}

export interface StatusInput {
  readonly session_id?: string;
  readonly sessionId?: string;
  readonly session?: { id?: string };
}

function sessionIdOf(input: HookInput | StatusInput): string | undefined {
  return input.session_id ?? input.sessionId ?? input.session?.id;
}

export async function parseJsonInput<T>(): Promise<T | undefined> {
  try {
    let value = "";
    for await (const chunk of process.stdin) value += String(chunk);
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export async function runLifecycle(action: "active" | "idle", input: HookInput | undefined, now = Date.now()): Promise<void> {
  const id = input && sessionIdOf(input);
  if (!id) return;
  await new ActivityStore().setActive(id, action === "active", now).catch(() => undefined);
}

function cliPath(): string {
  return fileURLToPath(new URL("../../cli/index.js", import.meta.url));
}

function spawnRefreshWorker(): void {
  try {
    const child = spawn(process.execPath, [cliPath(), "claude", "refresh-worker"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Status rendering must remain silent if a platform refuses to spawn.
  }
}

export interface StatusOptions {
  readonly now?: number;
  readonly root?: string;
  readonly spawnWorker?: () => void;
}

export async function runStatus(input: StatusInput | undefined, options: StatusOptions = {}): Promise<string> {
  const id = input && sessionIdOf(input);
  if (!id) return "";
  const now = options.now ?? Date.now();
  const cacheOptions = options.root ? { root: options.root } : {};
  const activity = new ActivityStore(cacheOptions);
  if (!(await activity.isActive(id, now).catch(() => false))) return "";
  const cache = new FileSnapshotCache(cacheOptions);
  const snapshot = await cache.read().catch(() => undefined);
  const newest = Math.max(0, ...(snapshot?.sources.map((source) => source.fetchedAt) ?? []));
  if (!newest || now - newest >= 15 * 60_000) {
    if (await activity.claimRefresh(now).catch(() => false)) {
      (options.spawnWorker ?? spawnRefreshWorker)();
    }
  }
  if (!snapshot) return "NEWS · loading headlines…";
  return formatHeadline(selectHeadline(buildPool(snapshot), now, DEFAULT_INTERVAL_MS));
}

export async function runRefreshWorker(root?: string): Promise<void> {
  const now = Date.now();
  const cacheOptions = root ? { root } : {};
  const activity = new ActivityStore(cacheOptions);
  const cache = new FileSnapshotCache(cacheOptions);
  try {
    const previous = await cache.read();
    const result = await refreshFeeds(DEFAULT_SOURCES, previous, {
      now,
      userAgent: DEFAULT_USER_AGENT,
      timeoutMs: 5_000,
      maxBytes: 1_024 * 1_024,
    });
    await cache.write(result.snapshot);
  } catch {
    // A feed worker is best effort and never reports into Claude.
  } finally {
    await activity.releaseRefresh().catch(() => undefined);
  }
}
