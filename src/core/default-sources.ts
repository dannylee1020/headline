import type { NewsSource } from "./types.js";

export const DEFAULT_SOURCES: readonly NewsSource[] = [
  {
    id: "hacker-news",
    name: "Hacker News",
    category: "tech",
    url: "https://news.ycombinator.com/rss",
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    category: "tech",
    url: "https://techcrunch.com/feed/",
  },
  {
    id: "yahoo-finance",
    name: "Yahoo Finance",
    category: "finance",
    url: "https://finance.yahoo.com/news/rssindex",
  },
  {
    id: "npr",
    name: "NPR",
    category: "general",
    url: "https://feeds.npr.org/1001/rss.xml",
  },
];

export function assertDefaultSources(sources: readonly NewsSource[] = DEFAULT_SOURCES): void {
  const expected = [
    ["hacker-news", "tech", "https://news.ycombinator.com/rss"],
    ["techcrunch", "tech", "https://techcrunch.com/feed/"],
    ["yahoo-finance", "finance", "https://finance.yahoo.com/news/rssindex"],
    ["npr", "general", "https://feeds.npr.org/1001/rss.xml"],
  ];
  const actual = sources.map((source) => [source.id, source.category, source.url]);
  if (JSON.stringify(actual) !== JSON.stringify(expected) || sources.some((source) => /google news/i.test(source.name + source.url))) {
    throw new Error("Newsbar source registry must contain exactly the four approved RSS sources");
  }
}
