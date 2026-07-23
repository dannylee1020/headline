import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { NewsSnapshot, SourceCache } from "../core/types.js";

const SCHEMA_VERSION = 1;
const DEFAULT_ACTIVITY_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_CLAIM_TTL_MS = 30_000;

export interface FileCacheOptions {
  readonly root?: string;
  readonly activityTtlMs?: number;
  readonly claimTtlMs?: number;
}

export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEWSBAR_CACHE_DIR) return env.NEWSBAR_CACHE_DIR;
  if (env.XDG_CACHE_HOME) return join(env.XDG_CACHE_HOME, "newsbar");
  if (process.platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "newsbar");
  return join(homedir(), ".cache", "newsbar");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  try {
    await chmod(path, 0o700);
  } catch {
    // Windows may not support the same mode semantics.
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(temporary, 0o600);
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  await rename(temporary, path);
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isSnapshot(value: unknown): value is NewsSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NewsSnapshot>;
  return candidate.version === SCHEMA_VERSION && Array.isArray(candidate.sources) && Array.isArray(candidate.health);
}

export class FileSnapshotCache implements SourceCache {
  readonly root: string;

  constructor(options: FileCacheOptions = {}) {
    this.root = options.root ?? cacheRoot();
  }

  private get path(): string {
    return join(this.root, "snapshot.json");
  }

  async read(): Promise<NewsSnapshot | undefined> {
    const value = await readJson(this.path);
    return isSnapshot(value) ? value : undefined;
  }

  async write(snapshot: NewsSnapshot): Promise<void> {
    await atomicJson(this.path, snapshot);
  }
}

export class ActivityStore {
  private readonly root: string;
  private readonly activityTtlMs: number;
  private readonly claimTtlMs: number;

  constructor(options: FileCacheOptions = {}) {
    this.root = options.root ?? cacheRoot();
    this.activityTtlMs = options.activityTtlMs ?? DEFAULT_ACTIVITY_TTL_MS;
    this.claimTtlMs = options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  }

  private activityPath(sessionId: string): string {
    return join(this.root, `activity-${hash(sessionId)}.json`);
  }

  private get claimPath(): string {
    return join(this.root, "refresh.claim");
  }

  async setActive(sessionId: string, active: boolean, now = Date.now()): Promise<void> {
    const path = this.activityPath(sessionId);
    if (!active) {
      await rm(path, { force: true });
      return;
    }
    await atomicJson(path, { version: SCHEMA_VERSION, active: true, updatedAt: now });
  }

  async isActive(sessionId: string, now = Date.now()): Promise<boolean> {
    const value = await readJson(this.activityPath(sessionId));
    if (!value || typeof value !== "object") return false;
    const candidate = value as { version?: unknown; active?: unknown; updatedAt?: unknown };
    if (candidate.version !== SCHEMA_VERSION || candidate.active !== true || typeof candidate.updatedAt !== "number") return false;
    if (now - candidate.updatedAt > this.activityTtlMs) {
      await rm(this.activityPath(sessionId), { force: true }).catch(() => undefined);
      return false;
    }
    return true;
  }

  async claimRefresh(now = Date.now()): Promise<boolean> {
    await ensureDirectory(this.root);
    try {
      const handle = await open(this.claimPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ version: SCHEMA_VERSION, startedAt: now }), "utf8");
      await handle.close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
      try {
        const current = await stat(this.claimPath);
        if (now - current.mtimeMs > this.claimTtlMs) {
          await rm(this.claimPath, { force: true });
          return this.claimRefresh(now);
        }
      } catch {
        return false;
      }
      return false;
    }
  }

  async releaseRefresh(): Promise<void> {
    await rm(this.claimPath, { force: true });
  }
}

export function temporaryCacheRoot(): string {
  return join(tmpdir(), `newsbar-${process.pid}`);
}
