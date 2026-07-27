import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ActivityStore, FileSnapshotCache } from "../../runtime/file-cache.js";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import {
  formatHeadlineState,
  headlineLayoutPrefix,
  layoutHeadline,
  terminalHyperlink,
  terminalWidth,
} from "../../core/format.js";

const CLAUDE_COLORS = {
  marker: [215, 119, 87],
  metadata: [153, 153, 153],
  title: [196, 196, 196],
} as const;
import { buildPool, selectHeadline } from "../../core/pool.js";
import type { Headline } from "../../core/types.js";
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

function ansiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.NO_COLOR && env.TERM !== "dumb";
}

function ansiColor(text: string, [red, green, blue]: readonly [number, number, number]): string {
  return `\u001b[38;2;${red};${green};${blue}m${text}\u001b[39m`;
}

function ansiBold(text: string): string {
  return `\u001b[1m${text}\u001b[22m`;
}

function formatClaudeState(status: "loading" | "unavailable", width: number): string {
  const text = formatHeadlineState(status, width);
  if (!ansiEnabled()) return text;
  return `${ansiColor(text.slice(0, 1), CLAUDE_COLORS.marker)}${ansiColor(text.slice(1), CLAUDE_COLORS.metadata)}`;
}

function formatClaudeHeadline(headline: Headline | undefined, width: number, hasSnapshot: boolean): string {
  const layout = layoutHeadline(headline, width);
  if (!layout) return formatClaudeState(hasSnapshot ? "unavailable" : "loading", width);
  const prefix = headlineLayoutPrefix(layout);
  const metadata = prefix.slice(layout.marker.length);
  const title = terminalHyperlink(layout.title, layout.url);
  if (!ansiEnabled()) return `${prefix}${title}`;
  return `${ansiColor(layout.marker, CLAUDE_COLORS.marker)}${ansiColor(metadata, CLAUDE_COLORS.metadata)}${ansiColor(ansiBold(title), CLAUDE_COLORS.title)}`;
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
  const hasConfiguredSources = configuredSources.every((source) => snapshot?.health.some((item) => item.sourceId === source.id));
  const lastAttempt = hasConfiguredSources ? snapshot?.updatedAt ?? newest : 0;
  if ((!lastAttempt || now - lastAttempt >= config.refreshIntervalMs) && await activity.claimRefresh(now).catch(() => false)) {
    (options.spawnWorker ?? spawnRefreshWorker)();
  }
  const headline = snapshot
    ? selectHeadline(buildPool(snapshot, config.maxItems, { sourceIds: configuredSources.map((source) => source.id) }), now, config.intervalMs)
    : undefined;
  return formatClaudeHeadline(headline, terminalWidth(), Boolean(snapshot));
}

export async function runRefreshWorker(root?: string, configPath?: string): Promise<void> {
  await refreshNews({
    ...(root ? { root } : {}),
    ...(configPath ? { configPath } : {}),
    lockHeld: true,
  }).catch(() => undefined);
}
