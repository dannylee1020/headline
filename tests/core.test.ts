import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCES, assertDefaultSources, sourceCapabilities, sourcesForConfig } from "../src/core/default-sources.js";
import { fetchFeed, refreshFeeds } from "../src/core/fetch-feeds.js";
import { formatHeadline, formatLinkedHeadline, terminalHyperlink } from "../src/core/format.js";
import { buildPool, selectHeadline } from "../src/core/pool.js";
import { parseRss } from "../src/core/rss.js";
import type { NewsSnapshot } from "../src/core/types.js";

const fixture = await readFile(new URL("./fixtures/rss.xml", import.meta.url), "utf8");

function source(id = "axios:general") {
  return DEFAULT_SOURCES.find((item) => item.id === id)!;
}

describe("default sources", () => {
  it("contains the approved providers and first-party category feeds", () => {
    assertDefaultSources();
    expect([...new Set(DEFAULT_SOURCES.map(({ providerId }) => providerId))]).toEqual(["axios", "bbc", "npr", "yahoo-finance"]);
    expect(sourceCapabilities()).toEqual([
      { providerId: "axios", name: "Axios", categories: ["general"] },
      {
        providerId: "bbc",
        name: "BBC",
        categories: ["general", "world", "uk", "business", "politics", "technology", "health", "education", "science", "entertainment", "sports"],
      },
      {
        providerId: "npr",
        name: "NPR",
        categories: ["general", "national", "world", "politics", "business", "economy", "technology", "health", "science", "education", "climate", "culture", "sports"],
      },
      { providerId: "yahoo-finance", name: "Yahoo Finance", categories: ["finance"] },
    ]);
    expect(sourcesForConfig({ providers: ["axios", "bbc", "npr", "yahoo-finance"], categories: ["general", "finance"] }).map(({ id }) => id)).toEqual([
      "axios:general", "bbc:general", "npr:general", "yahoo-finance:finance",
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
      sourceId: "axios:general",
      providerId: "axios",
      category: "general",
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
    expect(formatHeadline(headline)).toBe("• axios · A useful & safe headline");
  });

  it("links the headline without displaying the URL", () => {
    const headline = parseRss(source(), fixture, 1000)[0];
    expect(formatLinkedHeadline(headline)).toBe(
      "• axios · \u001b]8;;https://example.com/story-one\u001b\\A useful & safe headline\u001b]8;;\u001b\\",
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
    expect((calls[0]?.headers as Record<string, string>)["User-Agent"]).toContain("Headline");
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
    const result = await refreshFeeds([source(), source("bbc:general")], previous, {
      now: 200,
      fetch: async (url) => {
        if (String(url).includes("api.axios.com")) throw new Error("offline");
        return new Response(fixture, { status: 200 });
      },
    });
    expect(result.failures).toHaveLength(1);
    expect(result.snapshot.sources.some((item) => item.source.id === "axios:general")).toBe(true);
    expect(result.snapshot.health.find((item) => item.sourceId === "axios:general")?.ok).toBe(false);
  });

  it("rejects oversized responses", async () => {
    await expect(fetchFeed(source(), {
      maxBytes: 2,
      fetch: async () => new Response(fixture, { status: 200 }),
    })).rejects.toThrow(/size limit/);
  });
});

describe("pool and rotation", () => {
  const makeHeadline = (providerId: string, category: string, index: number, url = `https://example.com/${providerId}-${category}-${index}`) => ({
    id: `${providerId}-${category}-${index}`,
    title: `${providerId}-${category}-${index}`,
    url,
    sourceId: `${providerId}:${category}`,
    providerId,
    sourceName: providerId,
    category,
    publishedAt: 1000 - index,
    feedOrdinal: index,
    fetchedAt: 1000,
  });

  it("interleaves providers and categories from the registry", () => {
    const snapshot: NewsSnapshot = {
      version: 1,
      updatedAt: 1000,
      health: [],
      sources: [
        { source: source("axios:general"), fetchedAt: 1000, headlines: [makeHeadline("axios", "general", 0), makeHeadline("axios", "general", 1)] },
        { source: source("bbc:general"), fetchedAt: 1000, headlines: [makeHeadline("bbc", "general", 0), makeHeadline("bbc", "general", 1)] },
        { source: source("bbc:sports"), fetchedAt: 1000, headlines: [makeHeadline("bbc", "sports", 0)] },
        { source: source("npr:sports"), fetchedAt: 1000, headlines: [makeHeadline("npr", "sports", 0)] },
        { source: source("yahoo-finance:finance"), fetchedAt: 1000, headlines: [makeHeadline("yahoo-finance", "finance", 0)] },
      ],
    };
    const pool = buildPool(snapshot);
    expect(pool.map((item) => item.category)).toEqual(["general", "sports", "finance", "general", "sports", "general", "general"]);
    expect(selectHeadline(pool, 0, 8_000)?.title).toBe("axios-general-0");
    expect(selectHeadline(pool, 8_000, 8_000)?.title).toBe("bbc-sports-0");
    expect(buildPool(snapshot, 20, { providers: ["bbc"], categories: ["sports"] }).map((item) => item.sourceId)).toEqual(["bbc:sports"]);
    expect(buildPool(snapshot, 20, { providers: ["yahoo-finance"], categories: ["finance"] }).map((item) => item.sourceId)).toEqual(["yahoo-finance:finance"]);
  });

  it("prefers a specific category over a duplicate general headline", () => {
    const duplicateUrl = "https://example.com/duplicate";
    const snapshot: NewsSnapshot = {
      version: 1,
      updatedAt: 1000,
      health: [],
      sources: [
        { source: source("bbc:general"), fetchedAt: 1000, headlines: [makeHeadline("bbc", "general", 0, duplicateUrl)] },
        { source: source("bbc:technology"), fetchedAt: 1000, headlines: [makeHeadline("bbc", "technology", 0, duplicateUrl)] },
      ],
    };
    expect(buildPool(snapshot)[0]?.category).toBe("technology");
  });
});
