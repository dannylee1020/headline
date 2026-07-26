import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installClaude } from "../src/adapters/claude/install.js";
import opencodePlugin from "../src/adapters/opencode/index.js";
import piExtension from "../src/adapters/pi/index.js";

describe("adapter surfaces", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("exposes only the three selected host adapters", () => {
    expect(typeof piExtension).toBe("function");
    expect(typeof opencodePlugin).toBe("object");
    expect(typeof installClaude).toBe("function");
    expect(Object.keys(opencodePlugin)).toEqual(["id", "tui"]);
    expect((opencodePlugin as { id: string }).id).toBe("headline");
  });

  it("keeps a Pi extension status visible for the session", async () => {
    const configHome = await mkdtemp(join(tmpdir(), "headline-pi-config-"));
    vi.stubEnv("HEADLINE_HOME", configHome);
    const fixture = await readFile(new URL("./fixtures/rss.xml", import.meta.url), "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fixture, { status: 200, headers: { "content-type": "application/rss+xml" } })),
    );

    type Handler = (event: unknown, context: unknown) => Promise<void> | void;
    const handlers = new Map<string, Handler>();
    piExtension({ on: (event: string, handler: Handler) => handlers.set(event, handler) } as never);
    const statuses: Array<string | undefined> = [];
    const context = {
      mode: "tui",
      ui: {
        theme: { fg: (_color: string, text: string) => text },
        setStatus: (_key: string, text: string | undefined) => statuses.push(text),
      },
    };

    await handlers.get("session_start")?.({}, context);
    expect(statuses.at(-1)).toBeUndefined();
    await handlers.get("agent_start")?.({}, context);
    expect(statuses).toContain("• loading headlines…");
    await vi.waitFor(() => expect(statuses.some((line) => line?.includes("headline"))).toBe(true));
    await handlers.get("agent_settled")?.({}, context);
    expect(statuses.at(-1)).toBeUndefined();

    await handlers.get("session_shutdown")?.({}, context);
    expect(statuses.at(-1)).toBeUndefined();
  });

  it("does not contain removed Codex or tmux implementation surfaces", async () => {
    const packageText = await readFile(new URL("../package.json", import.meta.url), "utf8");
    expect(packageText).not.toMatch(/codex|tmux/iu);
  });
});
