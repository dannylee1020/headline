import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HEADLINE_STATUS = "--headline claude status";
const HEADLINE_LIFECYCLE = "--headline claude lifecycle";

export interface InstallOptions {
  readonly settingsPath?: string;
  readonly nodePath?: string;
  readonly cliPath?: string;
  readonly commandPath?: string;
  readonly force?: boolean;
}

export interface InstallResult {
  readonly settingsPath: string;
  readonly changed: boolean;
}

export class InstallConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallConflict";
  }
}

export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HEADLINE_CLAUDE_SETTINGS) return env.HEADLINE_CLAUDE_SETTINGS;
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

function hookCommand(nodePath: string, cliPath: string, action: "active" | "idle", commandPath?: string): string {
  return commandPath
    ? [shellQuote(commandPath), "--headline", "claude", "lifecycle", action].join(" ")
    : command(nodePath, cliPath, ["--headline", "claude", "lifecycle", action]);
}

function isHeadlineHook(value: unknown): boolean {
  return isObject(value) && Array.isArray(value.hooks) && value.hooks.some((item) => isObject(item) && typeof item.command === "string" && item.command.includes("--headline") && item.command.includes("lifecycle"));
}

function isHeadlineStatus(value: unknown): boolean {
  return isObject(value) && typeof value.command === "string" && value.command.includes("--headline") && value.command.includes("status");
}

function addHook(settings: Record<string, unknown>, event: string, hook: unknown): void {
  const hooks = isObject(settings.hooks) ? { ...settings.hooks } : {};
  const current = Array.isArray(hooks[event]) ? [...hooks[event] as unknown[]] : [];
  if (!current.some(isHeadlineHook)) current.push(hook);
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
  if (existingStatus !== undefined && !isHeadlineStatus(existingStatus) && !options.force) {
    throw new InstallConflict("Claude already has a non-Headline statusLine; rerun with --force to replace it");
  }

  const statusCommand = options.commandPath
    ? [shellQuote(options.commandPath), "--headline", "claude", "status"].join(" ")
    : command(nodePath, cliPath, ["--headline", "claude", "status"]);
  settings.statusLine = { type: "command", command: statusCommand, refreshInterval: 8 };
  const activeHook = {
    hooks: [{ type: "command", command: hookCommand(nodePath, cliPath, "active", options.commandPath) }],
  };
  const idleHook = {
    hooks: [{ type: "command", command: hookCommand(nodePath, cliPath, "idle", options.commandPath) }],
  };
  addHook(settings, "SessionStart", idleHook);
  addHook(settings, "UserPromptSubmit", activeHook);
  addHook(settings, "Stop", idleHook);
  addHook(settings, "StopFailure", idleHook);
  addHook(settings, "SessionEnd", idleHook);

  await atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { settingsPath, changed: true };
}

export const installerMarkers = { HEADLINE_STATUS, HEADLINE_LIFECYCLE } as const;
