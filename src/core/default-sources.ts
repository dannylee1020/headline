import type { HeadlineConfig } from "./config.js";
import type { NewsSource, ProviderCategories } from "./types.js";

function feed(
  providerId: string,
  name: string,
  category: string,
  url: string,
  options: Pick<NewsSource, "excludedUrlPathPrefixes"> = {},
): NewsSource {
  return { id: `${providerId}:${category}`, providerId, name, category, url, ...options };
}

/**
 * First-party RSS endpoints. A provider may expose several category feeds;
 * configuration selects the concrete endpoints from this registry.
 */
export const DEFAULT_SOURCES: readonly NewsSource[] = [
  feed("axios", "Axios", "general", "https://api.axios.com/feed/"),

  feed("bbc", "BBC", "general", "https://feeds.bbci.co.uk/news/rss.xml"),
  feed("bbc", "BBC", "world", "https://feeds.bbci.co.uk/news/world/rss.xml"),
  feed("bbc", "BBC", "uk", "https://feeds.bbci.co.uk/news/uk/rss.xml"),
  feed("bbc", "BBC", "business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
  feed("bbc", "BBC", "politics", "https://feeds.bbci.co.uk/news/politics/rss.xml"),
  feed("bbc", "BBC", "technology", "https://feeds.bbci.co.uk/news/technology/rss.xml", {
    excludedUrlPathPrefixes: ["/sounds/", "/iplayer/"],
  }),
  feed("bbc", "BBC", "health", "https://feeds.bbci.co.uk/news/health/rss.xml"),
  feed("bbc", "BBC", "education", "https://feeds.bbci.co.uk/news/education/rss.xml"),
  feed("bbc", "BBC", "science", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"),
  feed("bbc", "BBC", "entertainment", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"),
  feed("bbc", "BBC", "sports", "https://feeds.bbci.co.uk/sport/rss.xml"),

  feed("npr", "NPR", "general", "https://feeds.npr.org/1001/rss.xml"),
  feed("npr", "NPR", "national", "https://feeds.npr.org/1003/rss.xml"),
  feed("npr", "NPR", "world", "https://feeds.npr.org/1004/rss.xml"),
  feed("npr", "NPR", "politics", "https://feeds.npr.org/1014/rss.xml"),
  feed("npr", "NPR", "business", "https://feeds.npr.org/1006/rss.xml"),
  feed("npr", "NPR", "economy", "https://feeds.npr.org/1017/rss.xml"),
  feed("npr", "NPR", "technology", "https://feeds.npr.org/1019/rss.xml"),
  feed("npr", "NPR", "health", "https://feeds.npr.org/1128/rss.xml"),
  feed("npr", "NPR", "science", "https://feeds.npr.org/1007/rss.xml"),
  feed("npr", "NPR", "education", "https://feeds.npr.org/1013/rss.xml"),
  feed("npr", "NPR", "climate", "https://feeds.npr.org/1167/rss.xml"),
  feed("npr", "NPR", "culture", "https://feeds.npr.org/1008/rss.xml"),
  feed("npr", "NPR", "sports", "https://feeds.npr.org/1055/rss.xml"),

  feed("techcrunch", "TechCrunch", "technology", "https://techcrunch.com/feed/"),

  feed("yahoo-finance", "Yahoo Finance", "finance", "https://finance.yahoo.com/news/rssindex"),
];

export const DEFAULT_PROVIDER_IDS: readonly string[] = [...new Set(DEFAULT_SOURCES.map((source) => source.providerId))];
export const SUPPORTED_CATEGORY_IDS: readonly string[] = [...new Set(DEFAULT_SOURCES.map((source) => source.category))];

/** Legacy global category defaults retained for top-level array config compatibility. */
export const DEFAULT_CATEGORIES: readonly string[] = ["general", "finance", "technology"];

/** Exact default feeds, grouped by provider for current configuration. */
export const DEFAULT_PROVIDER_CATEGORIES: ProviderCategories = {
  axios: ["general"],
  bbc: ["general", "technology"],
  npr: ["general", "technology"],
  techcrunch: ["technology"],
  "yahoo-finance": ["finance"],
};

export interface SourceCapability {
  readonly providerId: string;
  readonly name: string;
  readonly categories: readonly string[];
}

export function sourceCapabilities(sources: readonly NewsSource[] = DEFAULT_SOURCES): readonly SourceCapability[] {
  const byProvider = new Map<string, { name: string; categories: string[] }>();
  for (const source of sources) {
    const existing = byProvider.get(source.providerId);
    if (existing) {
      if (!existing.categories.includes(source.category)) existing.categories.push(source.category);
      continue;
    }
    byProvider.set(source.providerId, { name: source.name, categories: [source.category] });
  }
  return [...byProvider].map(([providerId, value]) => ({
    providerId,
    name: value.name,
    categories: value.categories,
  }));
}

export function sourcesForProviderCategories(providers: ProviderCategories): readonly NewsSource[] {
  return DEFAULT_SOURCES.filter((source) => providers[source.providerId]?.includes(source.category));
}

export function sourcesForConfig(
  config: Pick<HeadlineConfig, "providers"> & Partial<Pick<HeadlineConfig, "sources">>,
): readonly NewsSource[] {
  return config.sources ?? sourcesForProviderCategories(config.providers);
}

export function assertDefaultSources(sources: readonly NewsSource[] = DEFAULT_SOURCES): void {
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id) || source.id !== `${source.providerId}:${source.category}` || !/^https?:\/\//u.test(source.url)) {
      throw new Error("Headline source registry contains an invalid or duplicate feed");
    }
    ids.add(source.id);
  }
  const required = ["axios:general", "bbc:general", "bbc:technology", "bbc:sports", "npr:general", "npr:technology", "npr:sports", "techcrunch:technology", "yahoo-finance:finance"];
  if (sources.length !== 27 || required.some((id) => !ids.has(id)) || sources.some((source) => /google news/i.test(source.name + source.url))) {
    throw new Error("Headline source registry is missing an approved first-party feed");
  }
}
