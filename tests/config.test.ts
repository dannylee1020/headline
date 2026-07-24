import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig } from "../src/core/config.js";
import { sourcesForConfig } from "../src/core/default-sources.js";

async function tempConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "newsbar-config-"));
  return join(root, "config.json");
}

describe("configuration", () => {
  it("uses safe defaults when the file is missing", async () => {
    const path = await tempConfig();
    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors).toEqual([]);
  });

  it("loads supported provider, category, visibility, and rotation settings", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({
      version: 1,
      providers: ["npr", "npr"],
      categories: ["general"],
      visibility: "always",
      rotationSeconds: 12,
    }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.providers).toEqual(["npr"]);
    expect(loaded.config.categories).toEqual(["general"]);
    expect(loaded.config.visibility).toBe("always");
    expect(loaded.config.intervalMs).toBe(12_000);
    expect(sourcesForConfig(loaded.config).map((source) => source.id)).toEqual(["npr"]);
  });

  it("treats empty filters as all defaults", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ providers: [], categories: [] }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.providers).toEqual(DEFAULT_CONFIG.providers);
    expect(loaded.config.categories).toEqual(DEFAULT_CONFIG.categories);
  });

  it("falls back to defaults and reports invalid configuration", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ providers: ["unknown-provider"] }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors[0]).toMatch(/providers/);
  });

  it("rejects a provider and category combination with no default source", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ providers: ["npr"], categories: ["tech"] }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors[0]).toMatch(/at least one default source/);
  });
});
