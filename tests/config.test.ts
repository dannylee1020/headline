import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_PROVIDER_CATEGORIES, loadConfig } from "../src/core/config.js";
import { sourcesForConfig } from "../src/core/default-sources.js";

async function tempConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "headline-config-"));
  return join(root, "config.json");
}

describe("configuration", () => {
  it("uses safe provider-specific defaults when the file is missing", async () => {
    const path = await tempConfig();
    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.config.providers).toEqual(DEFAULT_PROVIDER_CATEGORIES);
    expect(loaded.errors).toEqual([]);
    expect(sourcesForConfig(DEFAULT_CONFIG).map((source) => source.id)).toEqual([
      "axios:general", "bbc:general", "bbc:technology", "npr:general", "npr:technology", "techcrunch:technology", "yahoo-finance:finance",
    ]);
  });

  it("selects categories independently for each provider", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({
      version: 2,
      providers: {
        bbc: ["sports", "sports"],
        npr: ["general"],
      },
      visibility: "always",
      rotationSeconds: 12,
      refreshMinutes: 30,
    }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.providers).toEqual({ bbc: ["sports"], npr: ["general"] });
    expect(loaded.config.visibility).toBe("always");
    expect(loaded.config.intervalMs).toBe(12_000);
    expect(loaded.config.refreshIntervalMs).toBe(30 * 60_000);
    expect(sourcesForConfig(loaded.config).map((source) => source.id)).toEqual(["bbc:sports", "npr:general"]);
  });

  it("normalizes version 1 global filters for compatibility", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({
      version: 1,
      providers: ["bbc", "npr"],
      categories: ["sports"],
    }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.version).toBe(2);
    expect(loaded.config.providers).toEqual({ bbc: ["sports"], npr: ["sports"] });
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

  it("uses defaults when providers is omitted", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ version: 2, visibility: "always" }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.errors).toEqual([]);
    expect(loaded.config.providers).toEqual(DEFAULT_CONFIG.providers);
  });

  it("falls back to defaults for an unknown provider", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ version: 2, providers: { unknown: ["general"] } }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors[0]).toMatch(/unsupported provider/);
  });

  it("rejects categories not exposed by their provider", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ version: 2, providers: { axios: ["sports"] } }));

    const loaded = await loadConfig({ filePath: path });
    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.errors[0]).toMatch(/axios categories.*general/);
  });

  it("rejects empty provider and category selections", async () => {
    const path = await tempConfig();
    await writeFile(path, JSON.stringify({ version: 2, providers: { bbc: [] } }));
    const emptyCategories = await loadConfig({ filePath: path });
    expect(emptyCategories.errors[0]).toMatch(/bbc categories/);

    await writeFile(path, JSON.stringify({ version: 2, providers: {} }));
    const emptyProviders = await loadConfig({ filePath: path });
    expect(emptyProviders.errors[0]).toMatch(/at least one provider/);
  });
});
