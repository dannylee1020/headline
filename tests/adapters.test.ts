import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { installClaude } from "../src/adapters/claude/install.js";
import opencodePlugin from "../src/adapters/opencode/index.js";
import piExtension from "../src/adapters/pi/index.js";

describe("adapter surfaces", () => {
  it("exposes only the three selected host adapters", () => {
    expect(typeof piExtension).toBe("function");
    expect(typeof opencodePlugin).toBe("object");
    expect(typeof installClaude).toBe("function");
    expect(Object.keys(opencodePlugin)).toEqual(["id", "tui"]);
    expect((opencodePlugin as { id: string }).id).toBe("newsbar");
  });

  it("does not contain removed Codex or tmux implementation surfaces", async () => {
    const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
    expect(packageText).not.toMatch(/codex|tmux/iu);
  });
});
