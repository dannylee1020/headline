import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { installClaude } from "../adapters/claude/install.js";
import { installOpenCode } from "../adapters/opencode/install.js";
import { installPi } from "../adapters/pi/install.js";
import { parseJsonInput, runLifecycle, runRefreshWorker, runStatus } from "../adapters/claude/runtime.js";
import { cacheRoot } from "../runtime/file-cache.js";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === "--newsbar") argv = argv.slice(1);
  try {
    if (argv[0] === "claude" && argv[1] === "lifecycle" && (argv[2] === "active" || argv[2] === "idle")) {
      await runLifecycle(argv[2], await parseJsonInput());
      return 0;
    }
    if (argv[0] === "claude" && argv[1] === "status") {
      const output = await runStatus(await parseJsonInput());
      if (output) process.stdout.write(`${output}\n`);
      return 0;
    }
    if (argv[0] === "claude" && argv[1] === "refresh-worker") {
      await runRefreshWorker();
      return 0;
    }
    if (argv[0] === "install" && argv[1] === "claude") {
      const result = await installClaude({ force: argv.includes("--force") });
      process.stdout.write(`${result.changed ? "Installed" : "Already installed"} Newsbar Claude integration at ${result.settingsPath}\nBackup: ${result.backupPath}\n`);
      return 0;
    }
    if (argv[0] === "install" && argv[1] === "opencode") {
      const pluginPath = option(argv, "--plugin-path");
      if (!pluginPath) throw new Error("install opencode requires --plugin-path");
      const configPath = option(argv, "--config");
      const result = await installOpenCode({
        pluginPath,
        ...(configPath ? { configPath } : {}),
      });
      process.stdout.write(`${result.changed ? "Installed" : "Already installed"} Newsbar OpenCode TUI plugin at ${result.configPath}\nBackup: ${result.backupPath}\n`);
      return 0;
    }
    if (argv[0] === "install" && argv[1] === "pi") {
      const installPath = option(argv, "--path");
      if (!installPath) throw new Error("install pi requires --path");
      await installPi({ installPath, project: argv.includes("--project") });
      process.stdout.write(`Installed Newsbar Pi package from ${installPath}\n`);
      return 0;
    }
    if (argv[0] === "doctor") {
      process.stdout.write(`Newsbar cache: ${cacheRoot()}\nNode: ${process.version}\n`);
      return 0;
    }
    process.stderr.write("Usage: newsbar install claude [--force] | install opencode --plugin-path PATH [--config PATH] | install pi --path PATH [--project] | newsbar claude status|lifecycle active|idle|refresh-worker | newsbar doctor\n");
    return 2;
  } catch (error) {
    if (argv[0] === "claude") return 0;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.exitCode = 0;
  });
}
