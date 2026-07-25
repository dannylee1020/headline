import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { legacyConfigPath as legacyConfigPathForEnv, headlinePaths } from "../runtime/paths.js";
import { DEFAULT_CATEGORIES, DEFAULT_PROVIDER_IDS, DEFAULT_SOURCES, SUPPORTED_CATEGORY_IDS } from "./default-sources.js";
import type { Category } from "./types.js";

export { DEFAULT_CATEGORIES, DEFAULT_PROVIDER_IDS } from "./default-sources.js";

export const DEFAULT_INTERVAL_MS = 8_000;
export const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_FEED_TTL_MS = DEFAULT_REFRESH_INTERVAL_MS;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_024 * 1_024;
export const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_USER_AGENT = "Headline/0.0.0 (+RSS headline reader)";

export type ProviderId = string;
export type Visibility = "always" | "working" | "off";

export interface HeadlineConfig {
  readonly version: 1;
  readonly intervalMs: number;
  readonly refreshIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly providers: readonly ProviderId[];
  readonly categories: readonly Category[];
  readonly visibility: Visibility;
}

export interface LoadedHeadlineConfig {
  readonly config: HeadlineConfig;
  readonly path: string;
  readonly errors: readonly string[];
}

export interface LoadConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly filePath?: string;
}

export const DEFAULT_CONFIG: HeadlineConfig = {
  version: 1,
  intervalMs: DEFAULT_INTERVAL_MS,
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  maxItems: DEFAULT_MAX_ITEMS,
  providers: DEFAULT_PROVIDER_IDS,
  categories: DEFAULT_CATEGORIES,
  visibility: "working",
};

const CATEGORY_VALUES = new Set<Category>(SUPPORTED_CATEGORY_IDS);
const PROVIDER_VALUES = new Set<string>(DEFAULT_PROVIDER_IDS);
const VISIBILITY_VALUES = new Set<Visibility>(["always", "working", "off"]);
const CONFIG_KEYS = new Set(["version", "providers", "categories", "visibility", "rotationSeconds", "refreshMinutes"]);

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return headlinePaths(env).config;
}

export function legacyConfigFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return legacyConfigPathForEnv(env);
}

export function validateRefreshMinutes(value: number): number {
  if (!Number.isFinite(value) || value < 5 || value > 1_440) {
    throw new RangeError("refreshMinutes must be between 5 and 1440 minutes");
  }
  return Math.round(value * 60_000);
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

function parseConfig(value: unknown): HeadlineConfig {
  if (!isRecord(value)) throw new Error("configuration must be a JSON object");
  const unknownKeys = Object.keys(value).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length) throw new Error(`unknown configuration option(s): ${unknownKeys.join(", ")}`);
  if (value.version !== undefined && value.version !== 1) throw new Error("version must be 1");

  const providers = parseList(value.providers, "providers", PROVIDER_VALUES, DEFAULT_PROVIDER_IDS);
  const categories = parseList(value.categories, "categories", CATEGORY_VALUES, DEFAULT_CATEGORIES);
  if (!DEFAULT_SOURCES.some((source) => providers.includes(source.providerId) && categories.includes(source.category))) {
    throw new Error("providers and categories must select at least one available source");
  }
  const visibility = value.visibility === undefined ? DEFAULT_CONFIG.visibility : value.visibility;
  if (typeof visibility !== "string" || !VISIBILITY_VALUES.has(visibility as Visibility)) {
    throw new Error("visibility must be one of: always, working, off");
  }
  const intervalMs = value.rotationSeconds === undefined ? DEFAULT_INTERVAL_MS : validateIntervalNumber(value.rotationSeconds);
  const refreshIntervalMs = value.refreshMinutes === undefined ? DEFAULT_REFRESH_INTERVAL_MS : validateRefreshMinutesNumber(value.refreshMinutes);

  return {
    ...DEFAULT_CONFIG,
    intervalMs,
    refreshIntervalMs,
    providers,
    categories,
    visibility: visibility as Visibility,
  };
}

function validateRefreshMinutesNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("refreshMinutes must be a number");
  try {
    return validateRefreshMinutes(value);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

function validateIntervalNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("rotationSeconds must be a number");
  try {
    return validateInterval(value);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
}

async function migrateLegacyConfig(source: string, destination: string): Promise<void> {
  try {
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  } catch {
    // The legacy file remains a valid read-only fallback when migration cannot complete.
  }
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedHeadlineConfig> {
  const env = options.env ?? process.env;
  const explicitPath = options.filePath !== undefined;
  const path = options.filePath ?? configFilePath(env);
  const candidates = explicitPath || path === legacyConfigFilePath(env) ? [path] : [path, legacyConfigFilePath(env)];
  let raw: string | undefined;
  let sourcePath = path;
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, "utf8");
      sourcePath = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        lastError = error;
        break;
      }
    }
  }

  if (raw === undefined) {
    if (lastError) {
      return {
        config: DEFAULT_CONFIG,
        path,
        errors: [`could not read configuration: ${lastError instanceof Error ? lastError.message : String(lastError)}`],
      };
    }
    return { config: DEFAULT_CONFIG, path, errors: [] };
  }

  try {
    const config = parseConfig(JSON.parse(raw) as unknown);
    if (!explicitPath && sourcePath !== path) await migrateLegacyConfig(sourcePath, path);
    return { config, path, errors: [] };
  } catch (error) {
    return {
      config: DEFAULT_CONFIG,
      path,
      errors: [`invalid configuration: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function configSummary(config: HeadlineConfig): Record<string, unknown> {
  return {
    version: config.version,
    providers: config.providers,
    categories: config.categories,
    visibility: config.visibility,
    rotationSeconds: config.intervalMs / 1_000,
    refreshMinutes: config.refreshIntervalMs / 60_000,
  };
}

export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.HEADLINE_OFFLINE ?? env.PI_OFFLINE;
  return value === "1" || value?.toLowerCase() === "true";
}
