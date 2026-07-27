import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEffect, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installClaude } from "../src/adapters/claude/install.js";
import opencodePlugin, { linkedHeadline, renderLinkedHeadline } from "../src/adapters/opencode/index.js";
import piExtension from "../src/adapters/pi/index.js";
import { DEFAULT_SOURCES } from "../src/core/default-sources.js";
import type { NewsSnapshot } from "../src/core/types.js";
import { FileSnapshotCache } from "../src/runtime/file-cache.js";

vi.mock("solid-js", async () => vi.importActual("solid-js/dist/solid.js"));
vi.mock("@opentui/solid/jsx-runtime", () => {
  const element = (type: string, props: Record<string, unknown>) => ({ type, props });
  return { Fragment: "fragment", jsx: element, jsxs: element, jsxDEV: element };
});
vi.mock("@opentui/solid/jsx-dev-runtime", () => {
  const element = (type: string, props: Record<string, unknown>) => ({ type, props });
  return { Fragment: "fragment", jsx: element, jsxs: element, jsxDEV: element };
});

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

  it("uses native OpenCode styling for the linked title", () => {
    const line = linkedHeadline({
      id: "headline-1",
      title: "A useful headline",
      url: "https://example.com/story",
      sourceId: "npr:general",
      providerId: "npr",
      sourceName: "NPR",
      category: "general",
      fetchedAt: 1000,
      feedOrdinal: 0,
    }, 80, { accent: "accent", textMuted: "muted" } as never);

    expect(line).toMatchObject({
      marker: { text: "●", fg: "accent" },
      metadata: { text: " npr · news · ", fg: "muted" },
      title: { text: "A useful headline ↗", fg: "muted", url: "https://example.com/story" },
    });

    const rendered = renderLinkedHeadline(line!) as unknown as {
      type: string;
      props: { content?: unknown; marginLeft?: number; children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    expect(rendered.type).toBe("text");
    expect(rendered.props.content).toBeUndefined();
    expect(rendered.props.marginLeft).toBe(1);
    expect(rendered.props.children.map((child) => child.type)).toEqual(["span", "span", "a"]);
    expect(rendered.props.children[2]?.props).toMatchObject({
      href: "https://example.com/story",
      style: { fg: "muted", bold: true },
      children: "A useful headline ↗",
    });
  });

  it("reactively replaces the OpenCode loading state after cache hydration", async () => {
    const home = await mkdtemp(join(tmpdir(), "headline-opencode-config-"));
    vi.stubEnv("HEADLINE_HOME", home);
    await writeFile(join(home, "config.json"), JSON.stringify({
      sources: { mode: "built-in", providers: { npr: ["general"] } },
      visibility: "always",
    }));
    const source = DEFAULT_SOURCES.find((candidate) => candidate.id === "npr:general")!;
    const snapshot: NewsSnapshot = {
      version: 1,
      updatedAt: Date.now(),
      health: [{ sourceId: source.id, ok: true, fetchedAt: Date.now() }],
      sources: [{
        source,
        fetchedAt: Date.now(),
        headlines: [{
          id: "npr-1",
          title: "Cached OpenCode headline",
          url: "https://example.com/opencode",
          sourceId: source.id,
          providerId: source.providerId,
          sourceName: source.name,
          category: source.category,
          fetchedAt: Date.now(),
          feedOrdinal: 0,
        }],
      }],
    };
    await new FileSnapshotCache({ root: join(home, "cache") }).write(snapshot);

    let renderSlot: (() => unknown) | undefined;
    let disposePlugin = () => {};
    const api = {
      route: { current: { name: "session", params: { sessionID: "session-1" } } },
      state: { session: { status: () => undefined } },
      event: { on: () => () => {} },
      lifecycle: { onDispose: (callback: () => void) => { disposePlugin = callback; } },
      slots: { register: (plugin: { slots: { app_bottom: () => unknown } }) => { renderSlot = plugin.slots.app_bottom; } },
      renderer: { width: 80, requestRender: vi.fn() },
      theme: { current: { accent: "accent", textMuted: "muted" } },
    };
    await (opencodePlugin.tui as unknown as (value: unknown) => Promise<void>)(api);

    let rendered: unknown;
    let renderCount = 0;
    const disposeRoot = createRoot((dispose) => {
      createEffect(() => {
        renderCount += 1;
        rendered = renderSlot?.();
      });
      return dispose;
    });
    await vi.waitFor(() => {
      expect(renderCount).toBeGreaterThan(1);
      expect(JSON.stringify(rendered)).toContain("Cached OpenCode headline");
    });

    disposePlugin();
    disposeRoot();
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
        theme: {
          fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
          bold: (text: string) => `<bold>${text}</bold>`,
        },
        setStatus: (_key: string, text: string | undefined) => statuses.push(text),
      },
    };

    await handlers.get("session_start")?.({}, context);
    expect(statuses.at(-1)).toBeUndefined();
    await handlers.get("agent_start")?.({}, context);
    expect(statuses.some((line) => line?.includes("loading headlines"))).toBe(true);
    await vi.waitFor(() => expect(statuses.some((line) => line?.includes("A useful & safe headline") || line?.includes("Second headline"))).toBe(true));
    const rendered = statuses.find((line) => line?.includes("A useful & safe headline") || line?.includes("Second headline"));
    expect(rendered).toContain("<accent>");
    expect(rendered).toContain("<dim>");
    expect(rendered).toContain("<bold><dim>");
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
