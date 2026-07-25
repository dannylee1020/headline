import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES, DEFAULT_CONFIG, loadConfig } from "../src/core/config.js";
import { sourcesForConfig } from "../src/core/default-sources.js";

async function tempConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "headline-config-"));
  return join(root, "config.json");
}

describe("configuration", () => {
  it("uses safe defaults when the file is missing", async () => {
    const path = await tempConfig();
    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors).toEqual([]);
  });

  it("uses the quiet default categories", () => {
    expect(DEFAULT_CATEGORIES).toEqual(["general", "finance"]);
    expect(sourcesForConfig(DEFAULT_CONFIG).map((source) => source.id)).toEqual([
      "axios:general", "bbc:general", "npr:general", "yahoo-finance:finance",
    ]);
  });

  it("loads a category available from only one provider", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({
      version: 1,
      providers: ["bbc", "npr"],
      categories: ["sports", "sports"],
      visibility: "always",
      rotationSeconds: 12,
      refreshMinutes: 30,
    }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.providers).toEqual(["bbc", "npr"]);
    expect(loaded.config.categories).toEqual(["sports"]);
    expect(loaded.config.visibility).toBe("always");
    expect(loaded.config.intervalMs).toBe(12_000);
    expect(loaded.config.refreshIntervalMs).toBe(30 * 60_000);
    expect(sourcesForConfig(loaded.config).map((source) => source.id)).toEqual(["bbc:sports", "npr:sports"]);
  });

  it("migrates a valid legacy config into the Headline home", async () => {
    const root = await mkdtemp(join(tmpdir(), "headline-config-home-"));
    const legacyPath = join(root, ".config", "headline", "config.json");
    const env = {
      ...process.env,
      HOME: root,
      HEADLINE_HOME: join(root, ".headline"),
      XDG_CONFIG_HOME: join(root, ".config"),
    };
    await mkdir(join(root, ".config", "headline"), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ visibility: "always" }));

    const loaded = await loadConfig({ env });
    expect(loaded.config.visibility).toBe("always");
    expect(loaded.path).toBe(join(root, ".headline", "config.json"));
    expect(await readFile(loaded.path, "utf8")).toContain('"visibility":"always"');
  });

  it("treats empty filters as the quiet defaults", async () => {
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

  it("rejects a provider and category combination with no available source", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ providers: ["axios"], categories: ["sports"] }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors[0]).toMatch(/available source/);
  });
});
