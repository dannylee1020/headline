import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installOpenCode, OpenCodeInstallError } from "../src/adapters/opencode/install.js";
import { installPi, piInstallArgs } from "../src/adapters/pi/install.js";

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "headline-installer-"));
}

describe("OpenCode installer", () => {
  it("preserves JSONC comments and unrelated plugin entries", async () => {
    const root = await tempRoot();
    const configPath = join(root, "tui.json");
    const pluginPath = join(root, "headline", "dist", "adapters", "opencode", "index.js");
    await writeFile(configPath, '{\n  // preserved\n  "$schema": "https://opencode.ai/tui.json",\n  "plugin": ["other",],\n}\n');
    const result = await installOpenCode({ configPath, pluginPath });
    const output = await readFile(configPath, "utf8");
    expect(result.changed).toBe(true);
    expect(output).toContain("// preserved");
    expect(output).toContain('"other"');
    expect(output).toContain(pluginPath);
    await expect(access(`${configPath}.headline.bak`)).rejects.toBeTruthy();
    expect((await installOpenCode({ configPath, pluginPath })).changed).toBe(false);
  });

  it("does not touch malformed configuration", async () => {
    const root = await tempRoot();
    const configPath = join(root, "tui.json");
    await writeFile(configPath, "{ not valid");
    await expect(installOpenCode({ configPath, pluginPath: join(root, "plugin.js") })).rejects.toBeInstanceOf(OpenCodeInstallError);
    expect(await readFile(configPath, "utf8")).toBe("{ not valid");
  });
});

describe("Pi installer contract", () => {
  it("uses global scope by default and -l only when requested", () => {
    expect(piInstallArgs({ installPath: "/tmp/headline" })).toEqual(["install", "/tmp/headline"]);
    expect(piInstallArgs({ installPath: "/tmp/headline", project: true })).toEqual(["install", "-l", "/tmp/headline"]);
  });

  it("captures a failed Pi command", async () => {
    await expect(installPi({ installPath: "/tmp/headline", command: "/usr/bin/false" })).rejects.toThrow(/pi install failed/);
  });
});
