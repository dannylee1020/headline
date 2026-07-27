import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEntrypoint } from "../src/cli/index.js";

describe("CLI entrypoint detection", () => {
  it("resolves symlinked launcher paths to the real module", async () => {
    const root = await mkdtemp(join(tmpdir(), "headline-cli-"));
    const modulePath = join(root, "cli.js");
    const launcherPath = join(root, "launcher");
    await writeFile(modulePath, "");
    await symlink(modulePath, launcherPath);

    expect(isEntrypoint(launcherPath, modulePath)).toBe(true);
    expect(isEntrypoint(modulePath, modulePath)).toBe(true);
  });
});
