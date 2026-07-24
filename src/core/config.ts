import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Category } from "./types.js";

export const DEFAULT_INTERVAL_MS = 8_000;
export const DEFAULT_FEED_TTL_MS = 15 * 60_000;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_024 * 1_024;
export const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_USER_AGENT = "Newsbar/0.0.0 (+RSS headline reader)";

export const DEFAULT_PROVIDER_IDS = ["hacker-news", "techcrunch", "yahoo-finance", "npr"] as const;
export const DEFAULT_CATEGORIES: readonly Category[] = ["tech", "finance", "general"];

export type ProviderId = (typeof DEFAULT_PROVIDER_IDS)[number];
export type Visibility = "always" | "working" | "off";

export interface NewsbarConfig {
  readonly version: 1;
  readonly intervalMs: number;
  readonly feedTtlMs: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly providers: readonly ProviderId[];
  readonly categories: readonly Category[];
  readonly visibility: Visibility;
}

export interface LoadedNewsbarConfig {
  readonly config: NewsbarConfig;
  readonly path: string;
  readonly errors: readonly string[];
}

export interface LoadConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly filePath?: string;
}

export const DEFAULT_CONFIG: NewsbarConfig = {
  version: 1,
  intervalMs: DEFAULT_INTERVAL_MS,
  feedTtlMs: DEFAULT_FEED_TTL_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  maxItems: DEFAULT_MAX_ITEMS,
  providers: DEFAULT_PROVIDER_IDS,
  categories: DEFAULT_CATEGORIES,
  visibility: "working",
};

const CATEGORY_VALUES = new Set<Category>(DEFAULT_CATEGORIES);
const PROVIDER_VALUES = new Set<string>(DEFAULT_PROVIDER_IDS);
const PROVIDER_CATEGORIES: Record<ProviderId, Category> = {
  "hacker-news": "tech",
  techcrunch: "tech",
  "yahoo-finance": "finance",
  npr: "general",
};
const VISIBILITY_VALUES = new Set<Visibility>(["always", "working", "off"]);
const CONFIG_KEYS = new Set(["version", "providers", "categories", "visibility", "rotationSeconds"]);

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".config");
  return join(configHome, "newsbar", "config.json");
}

export function validateInterval(value: number): number {
  if (!Number.isFinite(value) || value < 2 || value > 60) {
    throw new RangeError("rotationSeconds must be between 2 and 60 seconds");
  }
  return Math.round(value * 1_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseList<T extends string>(value: unknown, name: string, allowed: ReadonlySet<string>, fallback: readonly T[]): readonly T[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !allowed.has(item as T))) {
    throw new Error(`${name} must contain only supported values`);
  }
  if (value.length === 0) return fallback;
  return [...new Set(value as T[])];
}

function parseConfig(value: unknown): NewsbarConfig {
  if (!isRecord(value)) throw new Error("configuration must be a JSON object");
  const unknownKeys = Object.keys(value).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length) throw new Error(`unknown configuration option(s): ${unknownKeys.join(", ")}`);
  if (value.version !== undefined && value.version !== 1) throw new Error("version must be 1");

  const providers = parseList(value.providers, "providers", PROVIDER_VALUES, DEFAULT_PROVIDER_IDS);
  const categories = parseList(value.categories, "categories", CATEGORY_VALUES, DEFAULT_CATEGORIES);
  if (!providers.some((provider) => categories.includes(PROVIDER_CATEGORIES[provider]))) {
    throw new Error("providers and categories must select at least one default source");
  }
  const visibility = value.visibility === undefined ? DEFAULT_CONFIG.visibility : value.visibility;
  if (typeof visibility !== "string" || !VISIBILITY_VALUES.has(visibility as Visibility)) {
    throw new Error("visibility must be one of: always, working, off");
  }
  const intervalMs = value.rotationSeconds === undefined ? DEFAULT_INTERVAL_MS : validateIntervalNumber(value.rotationSeconds);

  return {
    ...DEFAULT_CONFIG,
    intervalMs,
    providers,
    categories,
    visibility: visibility as Visibility,
  };
}

function validateIntervalNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("rotationSeconds must be a number");
  try {
    return validateInterval(value);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedNewsbarConfig> {
  const path = options.filePath ?? configFilePath(options.env);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: DEFAULT_CONFIG, path, errors: [] };
    }
    return {
      config: DEFAULT_CONFIG,
      path,
      errors: [`could not read configuration: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  try {
    return { config: parseConfig(JSON.parse(raw) as unknown), path, errors: [] };
  } catch (error) {
    return {
      config: DEFAULT_CONFIG,
      path,
      errors: [`invalid configuration: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function configSummary(config: NewsbarConfig): Record<string, unknown> {
  return {
    version: config.version,
    providers: config.providers,
    categories: config.categories,
    visibility: config.visibility,
    rotationSeconds: config.intervalMs / 1_000,
  };
}

export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.NEWSBAR_OFFLINE ?? env.PI_OFFLINE;
  return value === "1" || value?.toLowerCase() === "true";
}
