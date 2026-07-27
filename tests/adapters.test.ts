import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installClaude } from "../src/adapters/claude/install.js";
import opencodePlugin, { linkedHeadline, renderLinkedHeadline } from "../src/adapters/opencode/index.js";
import piExtension from "../src/adapters/pi/index.js";

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
      marker: { text: "•", fg: "accent" },
      metadata: { text: " npr · general · ", fg: "muted" },
      title: { text: "A useful headline", fg: "muted", url: "https://example.com/story" },
    });

    const rendered = renderLinkedHeadline(line!) as unknown as {
      type: string;
      props: { content?: unknown; children: Array<{ type: string; props: Record<string, unknown> }> };
    };
    expect(rendered.type).toBe("text");
    expect(rendered.props.content).toBeUndefined();
    expect(rendered.props.children.map((child) => child.type)).toEqual(["span", "span", "b"]);
    expect(rendered.props.children[2]?.props.children).toMatchObject({
      type: "a",
      props: { href: "https://example.com/story", children: "A useful headline" },
    });
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
