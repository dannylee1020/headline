import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface HeadlinePaths {
  readonly home: string;
  readonly app: string;
  readonly bin: string;
  readonly launcher: string;
  readonly config: string;
  readonly cache: string;
  readonly state: string;
  readonly refreshLock: string;
  readonly legacyApp: string;
  readonly legacyConfig: string;
  readonly legacyCache: string;
}

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || homedir();
}

export function headlineHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.HEADLINE_HOME?.trim();
  return configured ? resolve(configured) : join(homeDir(env), ".headline");
}

export function legacyConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homeDir(env), ".config");
  return join(configHome, "headline", "config.json");
}

export function legacyCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32" && env.LOCALAPPDATA) return join(env.LOCALAPPDATA, "headline");
  const cacheHome = env.XDG_CACHE_HOME?.trim() || join(homeDir(env), ".cache");
  return join(cacheHome, "headline");
}

export function legacyAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homeDir(env), ".local", "share");
  return join(dataHome, "headline");
}

export function headlinePaths(env: NodeJS.ProcessEnv = process.env): HeadlinePaths {
  const home = headlineHome(env);
  const app = join(home, "app");
  const bin = join(home, "bin");
  return {
    home,
    app,
    bin,
    launcher: join(bin, "headline"),
    config: join(home, "config.json"),
    cache: join(home, "cache"),
    state: join(home, "state"),
    refreshLock: join(home, "state", "refresh.lock"),
    legacyApp: legacyAppRoot(env),
    legacyConfig: legacyConfigPath(env),
    legacyCache: legacyCacheRoot(env),
  };
}

