import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NEWSBAR_STATUS = "--newsbar claude status";
const NEWSBAR_LIFECYCLE = "--newsbar claude lifecycle";

export interface InstallOptions {
  readonly settingsPath?: string;
  readonly nodePath?: string;
  readonly cliPath?: string;
  readonly force?: boolean;
}

export interface InstallResult {
  readonly settingsPath: string;
  readonly backupPath: string;
  readonly changed: boolean;
}

export class InstallConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallConflict";
  }
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.NEWSBAR_CLAUDE_SETTINGS) return env.NEWSBAR_CLAUDE_SETTINGS;
  const configDir = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(configDir, "settings.json");
}

function shellQuote(value: string): string {
  if (process.platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function command(nodePath: string, cliPath: string, args: readonly string[]): string {
  return [shellQuote(nodePath), shellQuote(cliPath), ...args.map(shellQuote)].join(" ");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hookCommand(nodePath: string, cliPath: string, action: "active" | "idle"): string {
  return command(nodePath, cliPath, ["--newsbar", "claude", "lifecycle", action]);
}

function isNewsbarHook(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.hooks) && value.hooks.some((item) => isObject(item) && typeof item.command === "string" && item.command.includes("--newsbar") && item.command.includes("lifecycle"));
}

function isNewsbarStatus(value: unknown): boolean {
  return isObject(value) && typeof value.command === "string" && value.command.includes("--newsbar") && value.command.includes("status");
}

function addHook(settings: Record<string, unknown>, event: string, hook: unknown): void {
  const hooks = isObject(settings.hooks) ? { ...settings.hooks } : {};
  const current = Array.isArray(hooks[event]) ? [...hooks[event] as unknown[]] : [];
  if (!current.some(isNewsbarHook)) current.push(hook);
  hooks[event] = current;
  settings.hooks = hooks;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function installClaude(options: InstallOptions = {}): Promise<InstallResult> {
  const settingsPath = options.settingsPath ?? defaultSettingsPath();
  const nodePath = options.nodePath ?? process.execPath;
  const cliPath = options.cliPath ?? fileURLToPath(new URL("../../cli/index.js", import.meta.url));
  let settings: Record<string, unknown> = {};
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed)) throw new Error("Claude settings must be a JSON object");
    settings = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const existingStatus = settings.statusLine;
  if (existingStatus !== undefined && !isNewsbarStatus(existingStatus) && !options.force) {
    throw new InstallConflict("Claude already has a non-Newsbar statusLine; rerun with --force to replace it");
  }

  const statusCommand = command(nodePath, cliPath, ["--newsbar", "claude", "status"]);
  settings.statusLine = { type: "command", command: statusCommand, refreshInterval: 8 };
  const activeHook = {
    hooks: [{ type: "command", command: hookCommand(nodePath, cliPath, "active") }],
  };
  const idleHook = {
    hooks: [{ type: "command", command: hookCommand(nodePath, cliPath, "idle") }],
  };
  addHook(settings, "SessionStart", idleHook);
  addHook(settings, "UserPromptSubmit", activeHook);
  addHook(settings, "Stop", idleHook);
  addHook(settings, "StopFailure", idleHook);
  addHook(settings, "SessionEnd", idleHook);

  const backupPath = `${settingsPath}.newsbar.bak`;
  try {
    await copyFile(settingsPath, backupPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, "{}\n", { encoding: "utf8", mode: 0o600 });
  }
  await atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { settingsPath, backupPath, changed: true };
}

export const installerMarkers = { NEWSBAR_STATUS, NEWSBAR_LIFECYCLE } as const;
