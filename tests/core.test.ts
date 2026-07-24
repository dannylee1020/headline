import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCES } from "../src/core/default-sources.js";
import { fetchFeed, refreshFeeds } from "../src/core/fetch-feeds.js";
import { formatHeadline, formatLinkedHeadline, terminalHyperlink } from "../src/core/format.js";
import { buildPool, selectHeadline } from "../src/core/pool.js";
import { parseRss } from "../src/core/rss.js";
import type { NewsSnapshot } from "../src/core/types.js";

const fixture = await readFile(new URL("./fixtures/rss.xml", import.meta.url), "utf8");

function source() {
  return DEFAULT_SOURCES[0]!;
}

describe("default sources", () => {
  it("contains exactly the approved four feeds", () => {
    expect(DEFAULT_SOURCES.map(({ id, category, url }) => ({ id, category, url }))).toEqual([
      { id: "hacker-news", category: "tech", url: "https://news.ycombinator.com/rss" },
      { id: "techcrunch", category: "tech", url: "https://techcrunch.com/feed/" },
      { id: "yahoo-finance", category: "finance", url: "https://finance.yahoo.com/news/rssindex" },
      { id: "npr", category: "general", url: "https://feeds.npr.org/1001/rss.xml" },
    ]);
    expect(JSON.stringify(DEFAULT_SOURCES)).not.toMatch(/google news/i);
  });
});

describe("RSS normalization", () => {
  it("keeps only normalized title/link metadata", () => {
    const headlines = parseRss(source(), fixture, 1000);
    expect(headlines).toHaveLength(2);
    expect(headlines[0]).toMatchObject({
      title: "A useful & safe headline",
      url: "https://example.com/story-one",
      sourceId: "hacker-news",
      category: "tech",
      publishedAt: Date.parse("Wed, 23 Jul 2026 17:00:00 GMT"),
    });
    expect(headlines[1]?.url).toContain("#fragment");
    expect(JSON.stringify(headlines)).not.toContain("body must not be retained");
  });

  it("removes terminal control characters from feed text", () => {
    const headlines = parseRss(source(), fixture.replace("A useful", "A\u007f useful"), 1000);
    expect(headlines[0]?.title).toBe("A useful & safe headline");
  });
});

describe("headline formatting", () => {
  it("prioritizes provider and headline space", () => {
    const headline = parseRss(source(), fixture, 1000)[0];
    expect(formatHeadline(headline)).toBe("hacker news · A useful & safe headline");
  });

  it("links the headline without displaying the URL", () => {
    const headline = parseRss(source(), fixture, 1000)[0];
    expect(formatLinkedHeadline(headline)).toBe(
      "hacker news · \u001b]8;;https://example.com/story-one\u001b\\A useful & safe headline\u001b]8;;\u001b\\",
    );
    expect(terminalHyperlink("unsafe", "javascript:alert(1)")).toBe("unsafe");
  });
});

describe("feed requests", () => {
  it("uses RSS headers and preserves validators", async () => {
    const calls: RequestInit[] = [];
    const result = await fetchFeed(source(), {
      fetch: async (_input, init) => {
        calls.push(init ?? {});
        return new Response(fixture, {
          status: 200,
          headers: { "content-type": "application/rss+xml", etag: "abc" },
        });
      },
      now: 1234,
    });
    expect((calls[0]?.headers as Record<string, string>)["User-Agent"]).toContain("Newsbar");
    expect((calls[0]?.headers as Record<string, string>).Accept).toContain("application/rss+xml");
    expect(result.etag).toBe("abc");
    expect(result.headlines).toHaveLength(2);
  });

  it("contains a source failure while preserving the last-good source", async () => {
    const previous: NewsSnapshot = {
      version: 1,
      updatedAt: 100,
      sources: [{ source: source(), headlines: parseRss(source(), fixture, 100), fetchedAt: 100 }],
      health: [],
    };
    const result = await refreshFeeds(DEFAULT_SOURCES, previous, {
      now: 200,
      fetch: async (url) => {
        if (String(url).includes("news.ycombinator.com")) throw new Error("offline");
        return new Response(fixture, { status: 200 });
      },
    });
    expect(result.failures).toHaveLength(1);
    expect(result.snapshot.sources.some((item) => item.source.id === "hacker-news")).toBe(true);
    expect(result.snapshot.health.find((item) => item.sourceId === "hacker-news")?.ok).toBe(false);
  });

  it("rejects oversized responses", async () => {
    await expect(fetchFeed(source(), {
      maxBytes: 2,
      fetch: async () => new Response(fixture, { status: 200 }),
    })).rejects.toThrow(/size limit/);
  });
});

describe("pool and rotation", () => {
  const makeHeadline = (sourceId: string, category: "tech" | "finance" | "general", index: number) => ({
    id: `${sourceId}-${index}`,
    title: `${sourceId}-${index}`,
    url: `https://example.com/${sourceId}-${index}`,
    sourceId,
    sourceName: sourceId,
    category,
    publishedAt: 1000 - index,
    feedOrdinal: index,
    fetchedAt: 1000,
  });

  it("interleaves tech sources and categories", () => {
    const snapshot: NewsSnapshot = {
      version: 1,
      updatedAt: 1000,
      health: [],
      sources: [
        { source: DEFAULT_SOURCES[0]!, fetchedAt: 1000, headlines: [makeHeadline("hacker-news", "tech", 0), makeHeadline("hacker-news", "tech", 1)] },
        { source: DEFAULT_SOURCES[1]!, fetchedAt: 1000, headlines: [makeHeadline("techcrunch", "tech", 0), makeHeadline("techcrunch", "tech", 1)] },
        { source: DEFAULT_SOURCES[2]!, fetchedAt: 1000, headlines: [makeHeadline("yahoo-finance", "finance", 0)] },
        { source: DEFAULT_SOURCES[3]!, fetchedAt: 1000, headlines: [makeHeadline("npr", "general", 0)] },
      ],
    };
    const pool = buildPool(snapshot);
    expect(pool.map((item) => item.category)).toEqual(["tech", "finance", "general", "tech", "tech", "tech"]);
    expect(selectHeadline(pool, 0, 8_000)?.title).toBe("hacker-news-0");
    expect(selectHeadline(pool, 8_000, 8_000)?.title).toBe("yahoo-finance-0");
    expect(buildPool(snapshot, 20, { providers: ["hacker-news"], categories: ["tech"] }).map((item) => item.sourceId)).toEqual(["hacker-news", "hacker-news"]);
    expect(buildPool(snapshot, 20, { providers: ["yahoo-finance"], categories: ["finance"] }).map((item) => item.sourceId)).toEqual(["yahoo-finance"]);
  });
});
