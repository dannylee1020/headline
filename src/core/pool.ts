import { canonicalUrl, validHttpUrl } from "./rss.js";
import type { CategoryFilter, Headline, NewsFilters, NewsSnapshot } from "./types.js";

function newestFirst(a: Headline, b: Headline): number {
  const aDate = a.publishedAt ?? Number.NEGATIVE_INFINITY;
  const bDate = b.publishedAt ?? Number.NEGATIVE_INFINITY;
  return bDate - aDate || a.feedOrdinal - b.feedOrdinal;
}

function deduplicate(headlines: readonly Headline[]): Headline[] {
  const result: Headline[] = [];
  const seen = new Set<string>();
  for (const headline of headlines) {
    if (!validHttpUrl(headline.url)) continue;
    const key = canonicalUrl(headline.url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(headline);
  }
  return result;
}

function deduplicatePreferSpecific(headlines: readonly Headline[]): Headline[] {
  const result: Headline[] = [];
  const indexes = new Map<string, number>();
  for (const headline of headlines) {
    const key = canonicalUrl(headline.url);
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, result.length);
      result.push(headline);
      continue;
    }
    const existing = result[existingIndex]!;
    if (existing.category === "general" && headline.category !== "general") result[existingIndex] = headline;
  }
  return result;
}

function roundRobin(groups: readonly (readonly Headline[])[]): Headline[] {
  const output: Headline[] = [];
  const indexes = groups.map(() => 0);
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!;
      const itemIndex = indexes[groupIndex]!;
      if (itemIndex < group.length) {
        output.push(group[itemIndex]!);
        indexes[groupIndex] = itemIndex + 1;
        remaining = true;
      }
    }
  }
  return output;
}

function providerIdOf(sourceId: string, providerId: string | undefined): string {
  return providerId ?? sourceId.split(":", 1)[0]!;
}

export function buildPool(snapshot: NewsSnapshot, maxItems = 20, filters: NewsFilters = {}): readonly Headline[] {
  const providers = filters.providers?.length ? new Set(filters.providers) : undefined;
  const categories = filters.categories?.length ? new Set(filters.categories) : undefined;
  const byCategory = new Map<string, Map<string, Headline[][]>>();

  for (const sourceSnapshot of snapshot.sources) {
    const source = sourceSnapshot.source;
    const providerId = providerIdOf(source.id, source.providerId);
    if (providers && !providers.has(providerId)) continue;
    if (categories && !categories.has(source.category)) continue;

    const items = deduplicate([...sourceSnapshot.headlines].sort(newestFirst)).slice(0, maxItems);
    const byProvider = byCategory.get(source.category) ?? new Map<string, Headline[][]>();
    const feeds = byProvider.get(providerId) ?? [];
    feeds.push(items);
    byProvider.set(providerId, feeds);
    byCategory.set(source.category, byProvider);
  }

  const categoryPools: Headline[][] = [];
  for (const byProvider of byCategory.values()) {
    const providerPools = [...byProvider.values()].map((feeds) => roundRobin(feeds));
    categoryPools.push(roundRobin(providerPools));
  }
  return deduplicatePreferSpecific(roundRobin(categoryPools));
}

export function filterPool(pool: readonly Headline[], category: CategoryFilter): readonly Headline[] {
  return category === "all" ? pool : pool.filter((headline) => headline.category === category);
}

export function selectHeadline(
  pool: readonly Headline[],
  now: number,
  intervalMs = 8_000,
  category: CategoryFilter = "all",
): Headline | undefined {
  const candidates = filterPool(pool, category);
  if (!candidates.length) return undefined;
  const slot = Math.max(0, Math.floor(now / intervalMs));
  return candidates[slot % candidates.length];
}
