import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ActivityStore, FileSnapshotCache } from "../../runtime/file-cache.js";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import { formatLinkedHeadline, HEADLINE_BULLET } from "../../core/format.js";
import { buildPool, selectHeadline } from "../../core/pool.js";
import type { NewsSnapshot } from "../../core/types.js";
import { refreshNews } from "../../runtime/refresh-service.js";

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
  readonly configPath?: string;
  readonly spawnWorker?: () => void;
}

export async function runStatus(input: StatusInput | undefined, options: StatusOptions = {}): Promise<string> {
  const id = input && sessionIdOf(input);
  if (!id) return "";
  const loaded = await loadConfig(options.configPath ? { filePath: options.configPath } : {});
  const config = loaded.config;
  if (config.visibility === "off") return "";
  const now = options.now ?? Date.now();
  const cacheOptions = options.root ? { root: options.root } : {};
  const activity = new ActivityStore(cacheOptions);
  if (config.visibility === "working" && !(await activity.isActive(id, now).catch(() => false))) return "";
  const cache = new FileSnapshotCache(cacheOptions);
  const snapshot = await cache.read().catch(() => undefined);
  const configuredSources = sourcesForConfig(config);
  const configuredSourceIds = new Set(configuredSources.map((source) => source.id));
  const newest = Math.max(0, ...(snapshot?.sources.filter((source) => configuredSourceIds.has(source.source.id)).map((source) => source.fetchedAt) ?? []));
  const hasConfiguredSources = configuredSources.every((source) => snapshot?.sources.some((item) => item.source.id === source.id));
  const lastAttempt = hasConfiguredSources ? snapshot?.updatedAt ?? newest : 0;
  if ((!lastAttempt || now - lastAttempt >= config.refreshIntervalMs) && await activity.claimRefresh(now).catch(() => false)) {
    (options.spawnWorker ?? spawnRefreshWorker)();
  }
  if (!snapshot) return `${HEADLINE_BULLET} loading headlines…`;
  return formatLinkedHeadline(selectHeadline(buildPool(snapshot, config.maxItems, config), now, config.intervalMs));
}

export async function runRefreshWorker(root?: string, configPath?: string): Promise<void> {
  await refreshNews({
    ...(root ? { root } : {}),
    ...(configPath ? { configPath } : {}),
    lockHeld: true,
  }).catch(() => undefined);
}
