import type { CategoryFilter } from "./types.js";

export const DEFAULT_INTERVAL_MS = 8_000;
export const DEFAULT_FEED_TTL_MS = 15 * 60_000;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_024 * 1_024;
export const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_USER_AGENT = "Newsbar/0.0.0 (+RSS headline reader)";

export interface NewsbarConfig {
  readonly intervalMs: number;
  readonly feedTtlMs: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly category: CategoryFilter;
}

export const DEFAULT_CONFIG: NewsbarConfig = {
  intervalMs: DEFAULT_INTERVAL_MS,
  feedTtlMs: DEFAULT_FEED_TTL_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  maxItems: DEFAULT_MAX_ITEMS,
  category: "all",
};

export function validateInterval(value: number): number {
  if (!Number.isFinite(value) || value < 2 || value > 60) {
    throw new RangeError("interval must be between 2 and 60 seconds");
  }
  return Math.round(value * 1_000);
}

export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.NEWSBAR_OFFLINE ?? env.PI_OFFLINE;
  return value === "1" || value?.toLowerCase() === "true";
}
