import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { refreshFeeds } from "../src/core/fetch-feeds.js";
import { buildPool } from "../src/core/pool.js";
import { loadOpmlSources, parseOpml } from "../src/core/opml.js";
import type { NewsSnapshot } from "../src/core/types.js";

const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="Technology">
      <outline type="rss" text="Example Blog" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com/" />
      <outline type="rss" title="Example Blog duplicate" xmlurl="https://example.com/feed.xml" />
      <outline type="rss" text="Unsafe" xmlUrl="ftp://example.com/feed.xml" />
    </outline>
    <outline text="News">
      <outline text="Nested">
        <outline type="rss" text="Another Blog" xmlUrl="https://another.example/feed.atom" />
      </outline>
    </outline>
    <outline text="Folder only" />
  </body>
</opml>`;

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "headline-opml-"));
}

function snapshotFor(source: NewsSnapshot["sources"][number]["source"]): NewsSnapshot {
  return {
    version: 1,
    updatedAt: 1000,
    health: [{ sourceId: source.id, ok: true, fetchedAt: 1000 }],
    sources: [{
      source,
      fetchedAt: 1000,
      headlines: [{
        id: `${source.id}:1`,
        title: `${source.name} headline`,
        url: `${source.url}/story`,
        sourceId: source.id,
        providerId: source.providerId,
        sourceName: source.name,
        category: source.category,
        feedOrdinal: 0,
        fetchedAt: 1000,
      }],
    }],
  };
}

describe("OPML sources", () => {
  it("parses nested subscriptions, preserves folders, and warns on duplicates", () => {
    const result = parseOpml(opml);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => ({ name: source.name, category: source.category, url: source.url }))).toEqual([
      { name: "Example Blog", category: "Technology", url: "https://example.com/feed.xml" },
      { name: "Another Blog", category: "Nested", url: "https://another.example/feed.atom" },
    ]);
    expect(result.sources[0]?.id).toMatch(/^opml:[a-f0-9]{16}$/);
    expect(result.warnings).toEqual([
      "skipped duplicate OPML feed: https://example.com/feed.xml",
      "skipped OPML feed with an invalid or unsafe URL (Unsafe)",
    ]);
  });

  it("rejects documents without an OPML root", () => {
    expect(() => parseOpml("<rss><channel /></rss>")).toThrow(/missing <opml> root/);
  });

  it("loads an OPML source mode relative to the config file", async () => {
    const root = await tempRoot();
    await writeFile(join(root, "subscriptions.opml"), opml);
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify({
      sources: { mode: "opml", path: "subscriptions.opml" },
    }));

    const loaded = await loadConfig({ filePath: configPath });
    expect(loaded.errors).toEqual([]);
    expect(loaded.warnings).toHaveLength(2);
    expect(loaded.config.sourceMode).toBe("opml");
    expect(loaded.config.opmlPath).toBe(join(root, "subscriptions.opml"));
    expect(loaded.config.sources.map((source) => source.name)).toEqual(["Example Blog", "Another Blog"]);
    expect(loaded.config.providers).toEqual({});
  });

  it("keeps OPML mode empty instead of falling back to built-ins when the file is missing", async () => {
    const root = await tempRoot();
    const configPath = join(root, "config.json");
    await writeFile(configPath, JSON.stringify({ sources: { mode: "opml", path: "missing.opml" } }));

    const loaded = await loadConfig({ filePath: configPath });
    expect(loaded.errors[0]).toMatch(/could not load OPML/);
    expect(loaded.config.sourceMode).toBe("opml");
    expect(loaded.config.sources).toEqual([]);
  });

  it("filters cached headlines to the selected OPML sources", () => {
    const [selected, excluded] = parseOpml(opml).sources;
    const selectedSnapshot = snapshotFor(selected!);
    const excludedSnapshot = snapshotFor(excluded!);
    const snapshot: NewsSnapshot = {
      ...selectedSnapshot,
      sources: [...selectedSnapshot.sources, ...excludedSnapshot.sources],
      health: [...selectedSnapshot.health, ...excludedSnapshot.health],
    };
    expect(buildPool(snapshot, 20, { sourceIds: [selected!.id] }).map((headline) => headline.sourceId)).toEqual([selected!.id]);
    expect(buildPool(snapshot, 20, { sourceIds: [] })).toEqual([]);
  });

  it("limits concurrent feed requests while preserving all results", async () => {
    const root = await tempRoot();
    await mkdir(root, { recursive: true });
    const sources = parseOpml(`<opml><body>${Array.from({ length: 5 }, (_, index) => `<outline text="Feed ${index}" xmlUrl="https://example.com/${index}.xml" />`).join("")}</body></opml>`).sources;
    let active = 0;
    let maximum = 0;
    const result = await refreshFeeds(sources, undefined, {
      concurrency: 2,
      fetch: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Response("<rss><channel><item><title>Headline</title><link>https://example.com/story</link></item></channel></rss>", { status: 200 });
      },
      now: 1000,
    });
    expect(maximum).toBe(2);
    expect(result.snapshot.sources).toHaveLength(5);
    expect(result.failures).toEqual([]);
  });
});
