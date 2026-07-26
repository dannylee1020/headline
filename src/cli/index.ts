import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { installClaude } from "../adapters/claude/install.js";
import { installOpenCode } from "../adapters/opencode/install.js";
import { installPi } from "../adapters/pi/install.js";
import { parseJsonInput, runLifecycle, runRefreshWorker, runStatus } from "../adapters/claude/runtime.js";
import { configSummary, loadConfig } from "../core/config.js";
import { sourceCapabilities } from "../core/default-sources.js";
import { loadOpmlSources, resolveOpmlPath } from "../core/opml.js";
import { FileSnapshotCache, cacheRoot } from "../runtime/file-cache.js";
import { headlinePaths } from "../runtime/paths.js";
import { refreshNews } from "../runtime/refresh-service.js";

function option(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv[0] === "--headline") argv = argv.slice(1);
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
      const launcherPath = option(argv, "--launcher");
      const result = await installClaude({
        force: argv.includes("--force"),
        ...(launcherPath ? { commandPath: launcherPath } : {}),
      });
      process.stdout.write(`${result.changed ? "Installed" : "Already installed"} Headline Claude integration at ${result.settingsPath}\nBackup: ${result.backupPath}\n`);
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
      process.stdout.write(`${result.changed ? "Installed" : "Already installed"} Headline OpenCode TUI plugin at ${result.configPath}\nBackup: ${result.backupPath}\n`);
      return 0;
    }
    if (argv[0] === "install" && argv[1] === "pi") {
      const installPath = option(argv, "--path");
      if (!installPath) throw new Error("install pi requires --path");
      await installPi({ installPath, project: argv.includes("--project") });
      process.stdout.write(`Installed Headline Pi package from ${installPath}\n`);
      return 0;
    }
    if (argv[0] === "sources") {
      for (const capability of sourceCapabilities()) {
        process.stdout.write(`${capability.providerId}: ${capability.categories.join(", ")}\n`);
      }
      return 0;
    }
    if (argv[0] === "opml" && argv[1] === "inspect") {
      const inputPath = argv[2];
      if (!inputPath) throw new Error("opml inspect requires a path");
      const path = resolveOpmlPath(inputPath, join(process.cwd(), "config.json"));
      const result = await loadOpmlSources(path);
      process.stdout.write(`${JSON.stringify({
        path,
        feedCount: result.sources.length,
        feeds: result.sources.map((source) => ({ id: source.id, name: source.name, category: source.category, url: source.url })),
        warnings: result.warnings,
      }, null, 2)}\n`);
      return 0;
    }
    if (argv[0] === "config" && argv[1] === "path") {
      process.stdout.write(`${headlinePaths().config}\n`);
      return 0;
    }
    if (argv[0] === "config" && argv[1] === "show") {
      const loaded = await loadConfig();
      process.stdout.write(`${JSON.stringify(configSummary(loaded.config), null, 2)}\n`);
      if (loaded.warnings.length) process.stderr.write(`${loaded.warnings.join("\n")}\n`);
      if (loaded.errors.length) {
        process.stderr.write(`${loaded.errors.join("\n")}\n`);
        return 1;
      }
      return 0;
    }
    if (argv[0] === "refresh") {
      const refreshed = await refreshNews();
      process.stdout.write(`${refreshed ? "Refreshed Headline cache" : "Refresh skipped; another refresh is already running or Headline is off"}\n`);
      return 0;
    }
    if (argv[0] === "cache" && argv[1] === "clear") {
      await new FileSnapshotCache().clear();
      process.stdout.write(`Cleared Headline cache at ${cacheRoot()}\n`);
      return 0;
    }
    if (argv[0] === "doctor") {
      const loaded = await loadConfig();
      const paths = headlinePaths();
      process.stdout.write(`Headline home: ${paths.home}\nHeadline app: ${paths.app}\nHeadline launcher: ${paths.launcher}\nHeadline cache: ${cacheRoot()}\nHeadline state: ${paths.state}\nLegacy app: ${paths.legacyApp}\nLegacy config: ${paths.legacyConfig}\nLegacy cache: ${paths.legacyCache}\nNode: ${process.version}\nHeadline config: ${loaded.path}\nEffective config: ${JSON.stringify(configSummary(loaded.config))}\n`);
      if (loaded.warnings.length) process.stdout.write(`Config warnings:\n${loaded.warnings.map((warning) => `- ${warning}`).join("\n")}\n`);
      if (loaded.errors.length) {
        process.stdout.write(`Config errors:\n${loaded.errors.map((error) => `- ${error}`).join("\n")}\n`);
        return 1;
      }
      return 0;
    }
    process.stderr.write("Usage: headline install claude [--force] | install opencode --plugin-path PATH [--config PATH] | install pi --path PATH [--project] | headline claude status|lifecycle active|idle|refresh-worker | headline sources | headline opml inspect PATH | headline config path|show | headline refresh | headline cache clear | headline doctor\n");
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
