import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { legacyConfigPath as legacyConfigPathForEnv, headlinePaths } from "../runtime/paths.js";
import { loadOpmlSources, resolveOpmlPath } from "./opml.js";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_PROVIDER_CATEGORIES,
  DEFAULT_PROVIDER_IDS,
  DEFAULT_SOURCES,
  sourceCapabilities,
  sourcesForProviderCategories,
} from "./default-sources.js";
import type { Category, NewsSource, ProviderCategories } from "./types.js";

export { DEFAULT_CATEGORIES, DEFAULT_PROVIDER_CATEGORIES, DEFAULT_PROVIDER_IDS } from "./default-sources.js";

export const DEFAULT_INTERVAL_MS = 8_000;
export const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_FEED_TTL_MS = DEFAULT_REFRESH_INTERVAL_MS;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 1_024 * 1_024;
export const DEFAULT_MAX_ITEMS = 20;
export const DEFAULT_USER_AGENT = "Headline/0.0.0 (+RSS headline reader)";

export type ProviderId = string;
export type Visibility = "always" | "working" | "off";
export type SourceMode = "built-in" | "opml";

export interface HeadlineConfig {
  readonly intervalMs: number;
  readonly refreshIntervalMs: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly providers: ProviderCategories;
  readonly sourceMode: SourceMode;
  readonly sources: readonly NewsSource[];
  readonly opmlPath?: string;
  readonly visibility: Visibility;
}

export interface LoadedHeadlineConfig {
  readonly config: HeadlineConfig;
  readonly path: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface LoadConfigOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly filePath?: string;
}

export const DEFAULT_CONFIG: HeadlineConfig = {
  intervalMs: DEFAULT_INTERVAL_MS,
  refreshIntervalMs: DEFAULT_REFRESH_INTERVAL_MS,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxBytes: DEFAULT_MAX_BYTES,
  maxItems: DEFAULT_MAX_ITEMS,
  providers: DEFAULT_PROVIDER_CATEGORIES,
  sourceMode: "built-in",
  sources: sourcesForProviderCategories(DEFAULT_PROVIDER_CATEGORIES),
  visibility: "working",
};

const CATEGORIES_BY_PROVIDER = new Map(
  sourceCapabilities().map((capability) => [capability.providerId, new Set(capability.categories)]),
);
const LEGACY_CATEGORY_VALUES = new Set<Category>(DEFAULT_SOURCES.map((source) => source.category));
const LEGACY_PROVIDER_VALUES = new Set<string>(DEFAULT_PROVIDER_IDS);
const VISIBILITY_VALUES = new Set<Visibility>(["always", "working", "off"]);
// Existing versioned files remain readable, but the current format is inferred from its shape.
const CONFIG_KEYS = new Set(["version", "providers", "categories", "sources", "visibility", "rotationSeconds", "refreshMinutes"]);
const SOURCE_KEYS = new Set(["mode", "providers", "path"]);

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

function parseLegacyList<T extends string>(
  value: unknown,
  name: string,
  allowed: ReadonlySet<string>,
  fallback: readonly T[],
): readonly T[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !allowed.has(item))) {
    throw new Error(`${name} must contain only supported values`);
  }
  if (value.length === 0) return fallback;
  return [...new Set(value as T[])];
}

function legacyProviderCategories(providerValue: unknown, categoryValue: unknown): ProviderCategories {
  const providers = parseLegacyList(providerValue, "providers", LEGACY_PROVIDER_VALUES, DEFAULT_PROVIDER_IDS);
  const categories = parseLegacyList<Category>(categoryValue, "categories", LEGACY_CATEGORY_VALUES, DEFAULT_CATEGORIES);
  const selected = new Set(providers);
  const selectedCategories = new Set(categories);
  const result: Record<string, Category[]> = {};
  for (const source of DEFAULT_SOURCES) {
    if (!selected.has(source.providerId) || !selectedCategories.has(source.category)) continue;
    (result[source.providerId] ??= []).push(source.category);
  }
  if (Object.keys(result).length === 0) throw new Error("providers and categories must select at least one available source");
  return result;
}

function parseProviderCategories(value: unknown): ProviderCategories {
  if (value === undefined) return DEFAULT_PROVIDER_CATEGORIES;
  if (!isRecord(value)) throw new Error("providers must be an object mapping provider IDs to category arrays");
  const entries = Object.entries(value);
  if (entries.length === 0) throw new Error("providers must select at least one provider");
  const result: Record<string, Category[]> = {};
  for (const [providerId, categories] of entries) {
    const allowed = CATEGORIES_BY_PROVIDER.get(providerId);
    if (!allowed) throw new Error(`unsupported provider: ${providerId}`);
    if (!Array.isArray(categories) || categories.length === 0 || categories.some((category) => typeof category !== "string" || !allowed.has(category))) {
      throw new Error(`${providerId} categories must be a non-empty array containing only: ${[...allowed].join(", ")}`);
    }
    result[providerId] = [...new Set(categories as Category[])];
  }
  return result;
}

function sourceConfig(value: unknown): { mode: SourceMode; providers: ProviderCategories; sources: readonly NewsSource[]; opmlPath?: string } {
  if (!isRecord(value)) throw new Error("sources must be an object with mode and configuration");
  const unknownKeys = Object.keys(value).filter((key) => !SOURCE_KEYS.has(key));
  if (unknownKeys.length) throw new Error(`unknown sources option(s): ${unknownKeys.join(", ")}`);
  if (value.mode === "built-in") {
    if (value.path !== undefined) throw new Error("built-in sources do not accept path");
    const providers = parseProviderCategories(value.providers);
    return { mode: "built-in", providers, sources: sourcesForProviderCategories(providers) };
  }
  if (value.mode === "opml") {
    if (value.providers !== undefined) throw new Error("opml sources do not accept providers");
    if (typeof value.path !== "string" || !value.path.trim()) throw new Error("opml sources require a non-empty path");
    return { mode: "opml", providers: {}, sources: [], opmlPath: value.path.trim() };
  }
  throw new Error('sources.mode must be "built-in" or "opml"');
}

function parseConfig(value: unknown): HeadlineConfig {
  if (!isRecord(value)) throw new Error("configuration must be a JSON object");
  const unknownKeys = Object.keys(value).filter((key) => !CONFIG_KEYS.has(key));
  if (unknownKeys.length) throw new Error(`unknown configuration option(s): ${unknownKeys.join(", ")}`);
  if (value.version !== undefined && value.version !== 1 && value.version !== 2) throw new Error("version must be 1 or 2");

  const hasSourceBlock = value.sources !== undefined;
  const hasLegacySelection = value.providers !== undefined || value.categories !== undefined;
  if (hasSourceBlock && hasLegacySelection) {
    throw new Error("use either sources or top-level providers/categories, not both");
  }

  const legacy = !hasSourceBlock && (Array.isArray(value.providers) || value.categories !== undefined);
  const selected = hasSourceBlock
    ? sourceConfig(value.sources)
    : legacy
      ? { mode: "built-in" as const, providers: legacyProviderCategories(value.providers, value.categories), sources: [] as readonly NewsSource[] }
      : { mode: "built-in" as const, providers: parseProviderCategories(value.providers), sources: [] as readonly NewsSource[] };
  const sources = selected.sources.length ? selected.sources : sourcesForProviderCategories(selected.providers);
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
    providers: selected.providers,
    sourceMode: selected.mode,
    sources: selected.mode === "opml" ? [] : sources,
    ...(selected.opmlPath ? { opmlPath: selected.opmlPath } : {}),
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
        warnings: [],
      };
    }
    return { config: DEFAULT_CONFIG, path, errors: [], warnings: [] };
  }

  try {
    const parsed = parseConfig(JSON.parse(raw) as unknown);
    if (!explicitPath && sourcePath !== path) await migrateLegacyConfig(sourcePath, path);
    if (parsed.sourceMode !== "opml") return { config: parsed, path, errors: [], warnings: [] };

    const opmlPath = resolveOpmlPath(parsed.opmlPath!, path);
    try {
      const loaded = await loadOpmlSources(opmlPath);
      return {
        config: { ...parsed, opmlPath, sources: loaded.sources },
        path,
        errors: [],
        warnings: loaded.warnings,
      };
    } catch (error) {
      return {
        config: { ...parsed, opmlPath, sources: [] },
        path,
        errors: [`could not load OPML: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
      };
    }
  } catch (error) {
    return {
      config: DEFAULT_CONFIG,
      path,
      errors: [`invalid configuration: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
    };
  }
}

export function configSummary(config: HeadlineConfig): Record<string, unknown> {
  return {
    sourceMode: config.sourceMode,
    sources: config.sourceMode === "opml"
      ? { mode: "opml", path: config.opmlPath, feedCount: config.sources.length }
      : { mode: "built-in", providers: config.providers, feedCount: config.sources.length },
    providers: config.providers,
    visibility: config.visibility,
    rotationSeconds: config.intervalMs / 1_000,
    refreshMinutes: config.refreshIntervalMs / 60_000,
  };
}

export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.HEADLINE_OFFLINE ?? env.PI_OFFLINE;
  return value === "1" || value?.toLowerCase() === "true";
}
