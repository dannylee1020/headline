import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export interface OpenCodeInstallOptions {
  readonly configPath?: string;
  readonly pluginPath: string;
}

export interface OpenCodeInstallResult {
  readonly configPath: string;
  readonly backupPath: string;
  readonly pluginPath: string;
  readonly changed: boolean;
}

export class OpenCodeInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenCodeInstallError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function defaultOpenCodeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HEADLINE_OPENCODE_CONFIG) return env.HEADLINE_OPENCODE_CONFIG;
  const configDir = env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode");
  return join(configDir, "tui.json");
}

export function defaultOpenCodePluginPath(installRoot: string): string {
  return resolve(installRoot, "dist", "adapters", "opencode", "index.js");
}

function entryPath(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry) && typeof entry[0] === "string") return entry[0];
  return undefined;
}

function samePlugin(entry: unknown, pluginPath: string): boolean {
  const candidate = entryPath(entry);
  if (!candidate) return false;
  if (candidate === pluginPath) return true;
  if (candidate.startsWith("file://")) {
    try {
      return resolve(fileURLToPath(candidate)) === pluginPath;
    } catch {
      return false;
    }
  }
  try {
    return resolve(candidate) === pluginPath;
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function backup(path: string, backupPath: string, existed: boolean): Promise<void> {
  await mkdir(dirname(backupPath), { recursive: true });
  if (existed) {
    await copyFile(path, backupPath);
  } else {
    await writeFile(backupPath, "{}\n", { encoding: "utf8", mode: 0o600 });
  }
}

function parseConfig(text: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !isObject(parsed)) {
    throw new OpenCodeInstallError("OpenCode TUI config is not a valid JSON/JSONC object");
  }
  return parsed;
}

export async function installOpenCode(options: OpenCodeInstallOptions): Promise<OpenCodeInstallResult> {
  const configPath = resolve(options.configPath ?? defaultOpenCodeConfigPath());
  const pluginPath = resolve(options.pluginPath);
  const backupPath = `${configPath}.headline.bak`;
  let text = "";
  let existed = true;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    existed = false;
    text = "{}\n";
  }

  const config = parseConfig(text);
  const current = config.plugin;
  if (current !== undefined && !Array.isArray(current)) {
    throw new OpenCodeInstallError("OpenCode TUI config plugin must be an array");
  }
  const plugins = Array.isArray(current) ? [...current] : [];
  if (plugins.some((entry) => samePlugin(entry, pluginPath))) {
    return { configPath, backupPath, pluginPath, changed: false };
  }
  plugins.push(pluginPath);

  const edits = modify(text, ["plugin"], plugins, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  });
  const nextText = applyEdits(text, edits);
  await backup(configPath, backupPath, existed);
  await atomicWrite(configPath, nextText);
  return { configPath, backupPath, pluginPath, changed: true };
}
