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

export function buildPool(snapshot: NewsSnapshot, maxItems = 20, filters: NewsFilters = {}): readonly Headline[] {
  const providers = filters.providers?.length ? new Set(filters.providers) : undefined;
  const categories = filters.categories?.length ? new Set(filters.categories) : undefined;
  const bySource = new Map<string, Headline[]>();
  for (const sourceSnapshot of snapshot.sources) {
    if (providers && !providers.has(sourceSnapshot.source.id)) continue;
    if (categories && !categories.has(sourceSnapshot.source.category)) continue;
    const items = deduplicate([...sourceSnapshot.headlines].sort(newestFirst)).slice(0, maxItems);
    bySource.set(sourceSnapshot.source.id, items);
  }
  const tech = roundRobin([
    bySource.get("hacker-news") ?? [],
    bySource.get("techcrunch") ?? [],
  ]);
  const finance = bySource.get("yahoo-finance") ?? [];
  const general = bySource.get("npr") ?? [];
  return roundRobin([tech, finance, general]);
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
