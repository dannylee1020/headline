import type { DisplaySegments, Headline } from "./types.js";

export function displaySegments(headline: Headline | undefined): DisplaySegments | undefined {
  if (!headline) return undefined;
  return {
    category: headline.category.toUpperCase(),
    source: headline.sourceName,
    title: headline.title,
    url: headline.url,
  };
}

export function formatHeadline(headline: Headline | undefined): string {
  const segments = displaySegments(headline);
  if (!segments) return "";
  return `NEWS · ${segments.category} · ${segments.source} · ${segments.title}`;
}
