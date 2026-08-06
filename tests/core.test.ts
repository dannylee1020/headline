import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOURCES, assertDefaultSources, sourceCapabilities, sourcesForConfig } from "../src/core/default-sources.js";
import { fetchFeed, refreshFeeds } from "../src/core/fetch-feeds.js";
import {
  displayWidth,
  formatHeadline,
  formatHeadlineLayout,
  formatHeadlineState,
  formatLinkedHeadline,
  layoutHeadline,
  terminalHyperlink,
} from "../src/core/format.js";
import { buildPool, selectHeadline } from "../src/core/pool.js";
import { parseRss } from "../src/core/rss.js";
import type { NewsSnapshot } from "../src/core/types.js";

const fixture = await readFile(new URL("./fixtures/rss.xml", import.meta.url), "utf8");

function source(id = "axios:general") {
  return DEFAULT_SOURCES.find((item) => item.id === id)!;
}

describe("default sources", () => {
  it("contains the approved providers and RSS category feeds", () => {
    assertDefaultSources();
    expect([...new Set(DEFAULT_SOURCES.map(({ providerId }) => providerId))]).toEqual(["axios", "ap", "bbc", "npr", "reuters", "techcrunch", "yahoo-finance"]);
    expect(sourceCapabilities()).toEqual([
      { providerId: "axios", name: "Axios", categories: ["general"] },
      { providerId: "ap", name: "AP News", categories: ["general"] },
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
      { providerId: "reuters", name: "Reuters", categories: ["general"] },
      { providerId: "techcrunch", name: "TechCrunch", categories: ["technology"] },
      { providerId: "yahoo-finance", name: "Yahoo Finance", categories: ["finance"] },
    ]);
    expect(sourcesForConfig({ providers: {
      axios: ["general"],
      ap: ["general"],
      bbc: ["general", "technology"],
      npr: ["general", "technology"],
      reuters: ["general"],
      techcrunch: ["technology"],
      "yahoo-finance": ["finance"],
    } }).map(({ id }) => id)).toEqual([
      "axios:general", "ap:general", "bbc:general", "bbc:technology", "npr:general", "npr:technology", "reuters:general", "techcrunch:technology", "yahoo-finance:finance",
    ]);
    expect(DEFAULT_SOURCES.find(({ id }) => id === "ap:general")?.url).toContain("site%3Aapnews.com");
    expect(DEFAULT_SOURCES.find(({ id }) => id === "reuters:general")?.url).toContain("site%3Areuters.com");
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

  it("excludes non-article BBC technology entries", () => {
    const mixedFeed = fixture.replace("</channel>", `
      <item>
        <title>Tech Life</title>
        <link>https://www.bbc.co.uk/sounds/play/example</link>
      </item>
      <item>
        <title>Tech Now</title>
        <link>https://www.bbc.co.uk/iplayer/episode/example</link>
      </item>
    </channel>`);
    const headlines = parseRss(source("bbc:technology"), mixedFeed, 1000);
    expect(headlines.map((headline) => headline.title)).toEqual(["A useful & safe headline", "Second headline"]);
  });
});

describe("headline formatting", () => {
  it("prioritizes provider and headline space", () => {
    const headline = parseRss(source(), fixture, 1000)[0];
    expect(formatHeadline(headline)).toBe("• axios · news · A useful & safe headline");
  });

  it("links the headline without displaying the URL", () => {
    const headline = parseRss(source(), fixture, 1000)[0];
    expect(formatLinkedHeadline(headline)).toBe(
      "• axios · news · \u001b]8;;https://example.com/story-one\u001b\\A useful & safe headline\u001b]8;;\u001b\\",
    );
    expect(terminalHyperlink("unsafe", "javascript:alert(1)")).toBe("unsafe");
  });

  it("prioritizes title space as the available width narrows", () => {
    const headline = parseRss(source(), fixture, 1000)[0];
    const wide = layoutHeadline(headline, 80)!;
    expect(formatHeadlineLayout(wide)).toBe("• axios · news · A useful & safe headline");

    const medium = layoutHeadline(headline, 30)!;
    expect(medium.source).toBe("axios");
    expect(medium.category).toBeUndefined();
    expect(displayWidth(formatHeadlineLayout(medium))).toBeLessThanOrEqual(30);

    const narrow = layoutHeadline(headline, 20)!;
    expect(narrow.source).toBeUndefined();
    expect(narrow.category).toBeUndefined();
    expect(displayWidth(formatHeadlineLayout(narrow))).toBeLessThanOrEqual(20);
  });

  it("keeps status messages within narrow widths", () => {
    expect(displayWidth(formatHeadlineState("loading", 10))).toBeLessThanOrEqual(10);
    expect(displayWidth(formatHeadlineState("unavailable", 10))).toBeLessThanOrEqual(10);
  });

  it("truncates Unicode by display cells without splitting grapheme clusters", () => {
    const headline = { ...parseRss(source(), fixture, 1000)[0]!, title: "東京 👩‍💻 headline" };
    const layout = layoutHeadline(headline, 8)!;
    expect(displayWidth(formatHeadlineLayout(layout))).toBeLessThanOrEqual(8);
    expect(layout.title.endsWith("…")).toBe(true);
    expect(layout.title).not.toContain("👩");
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

  it("filters stale excluded entries when a feed returns not modified", async () => {
    const bbcTechnology = source("bbc:technology");
    const previous = {
      source: bbcTechnology,
      fetchedAt: 100,
      headlines: [{
        id: "tech-life",
        title: "Tech Life",
        url: "https://www.bbc.co.uk/sounds/play/example",
        sourceId: bbcTechnology.id,
        providerId: bbcTechnology.providerId,
        sourceName: bbcTechnology.name,
        category: bbcTechnology.category,
        feedOrdinal: 0,
        fetchedAt: 100,
      }],
    };
    const result = await fetchFeed(bbcTechnology, {
      fetch: async () => new Response(null, { status: 304 }),
      now: 200,
    }, previous);
    expect(result.headlines).toEqual([]);
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
    expect(buildPool(snapshot, 20, { providers: { bbc: ["sports"] } }).map((item) => item.sourceId)).toEqual(["bbc:sports"]);
    expect(buildPool(snapshot, 20, { providers: { "yahoo-finance": ["finance"] } }).map((item) => item.sourceId)).toEqual(["yahoo-finance:finance"]);
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
