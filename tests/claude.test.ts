import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { installClaude, InstallConflict } from "../src/adapters/claude/install.js";
import { runLifecycle, runStatus } from "../src/adapters/claude/runtime.js";
import { DEFAULT_SOURCES } from "../src/core/default-sources.js";
import { FileSnapshotCache } from "../src/runtime/file-cache.js";
import type { NewsSnapshot } from "../src/core/types.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "headline-test-"));
}

describe("Claude integration", () => {
  it("tracks activity and returns cached status without network", async () => {
    const root = await tempRoot();
    vi.stubEnv("HEADLINE_CACHE_DIR", root);
    await runLifecycle("active", { session_id: "session-1" }, 1000);
    vi.unstubAllEnvs();
    const snapshot: NewsSnapshot = {
      version: 1,
      updatedAt: 1000,
      health: [],
      sources: [{
        source: DEFAULT_SOURCES.find((source) => source.id === "npr:general")!,
        fetchedAt: 1000,
        headlines: [{
          id: "npr-1", title: "Cached headline", url: "https://example.com/story", sourceId: "npr:general", providerId: "npr", sourceName: "NPR", category: "general", fetchedAt: 1000, feedOrdinal: 0,
        }],
      }],
    };
    await new FileSnapshotCache({ root }).write(snapshot);
    const output = await runStatus({ session_id: "session-1" }, { root, configPath: join(root, "config.json"), now: 1000, spawnWorker: vi.fn() });
    expect(output).toContain("Cached headline");
  });

  it("honors always visibility and provider-specific category filters", async () => {
    const root = await tempRoot();
    const configPath = join(root, "config.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(configPath, JSON.stringify({
      version: 2,
      providers: { npr: ["general"] },
      visibility: "always",
    })));
    const snapshot: NewsSnapshot = {
      version: 1,
      updatedAt: 1000,
      health: [],
      sources: [{
        source: DEFAULT_SOURCES.find((source) => source.id === "npr:general")!,
        fetchedAt: 1000,
        headlines: [{
          id: "npr-1", title: "Always headline", url: "https://example.com/story", sourceId: "npr:general", providerId: "npr", sourceName: "NPR", category: "general", fetchedAt: 1000, feedOrdinal: 0,
        }],
      }],
    };
    await new FileSnapshotCache({ root }).write(snapshot);

    await expect(runStatus({ session_id: "idle-session" }, { root, configPath, now: 1000, spawnWorker: vi.fn() })).resolves.toContain("Always headline");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(configPath, JSON.stringify({ visibility: "off" })));
    await expect(runStatus({ session_id: "idle-session" }, { root, configPath, now: 1000, spawnWorker: vi.fn() })).resolves.toBe("");
  });

  it("merges settings, preserves unrelated values, and is idempotent", async () => {
    const root = await tempRoot();
    const settingsPath = join(root, "settings.json");
    const original = { theme: "dark", hooks: { PostToolUse: [{ matcher: "Edit", hooks: [] }] } };
    await import("node:fs/promises").then(({ writeFile }) => writeFile(settingsPath, JSON.stringify(original)));
    const first = await installClaude({ settingsPath, nodePath: "/node", cliPath: "/cli" });
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(parsed.theme).toBe("dark");
    expect(parsed.statusLine).toMatchObject({ type: "command", refreshInterval: 8 });
    expect(String((parsed.statusLine as { command: string }).command)).toContain("status");
    expect(first.backupPath).toContain(".headline.bak");
    await installClaude({ settingsPath, nodePath: "/node", cliPath: "/cli", commandPath: "/headline/bin/headline" });
    const launcherSettings = JSON.parse(await readFile(settingsPath, "utf8")) as { statusLine: { command: string }; hooks: Record<string, unknown[]> };
    expect(launcherSettings.statusLine.command).toContain("/headline/bin/headline");
    const again = JSON.parse(await readFile(settingsPath, "utf8")) as { hooks: Record<string, unknown[]> };
    expect((again.hooks.UserPromptSubmit ?? []).length).toBe(1);
  });

  it("refuses to replace an unrelated status line unless forced", async () => {
    const root = await tempRoot();
    const settingsPath = join(root, "settings.json");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(settingsPath, JSON.stringify({ statusLine: { type: "command", command: "custom" } })));
    await expect(installClaude({ settingsPath, nodePath: "/node", cliPath: "/cli" })).rejects.toBeInstanceOf(InstallConflict);
    await expect(installClaude({ settingsPath, nodePath: "/node", cliPath: "/cli", force: true })).resolves.toBeTruthy();
  });
});
