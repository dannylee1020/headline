import type { DisplaySegments, Headline } from "./types.js";

export const HEADLINE_BULLET = "•";

export function displaySegments(headline: Headline | undefined): DisplaySegments | undefined {
  if (!headline) return undefined;
  return {
    category: headline.category.toLowerCase(),
    source: headline.sourceName.toLowerCase(),
    title: headline.title,
    url: headline.url,
  };
}

export function formatHeadline(headline: Headline | undefined): string {
  const segments = displaySegments(headline);
  if (!segments) return "";
  return `${HEADLINE_BULLET} ${segments.source} · ${segments.category} · ${segments.title}`;
}

export function terminalHyperlink(text: string, url: string | undefined): string {
  if (!url) return text;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return text;
    return `\u001b]8;;${parsed.href}\u001b\\${text}\u001b]8;;\u001b\\`;
  } catch {
    return text;
  }
}

export function formatLinkedHeadline(headline: Headline | undefined): string {
  const segments = displaySegments(headline);
  if (!segments) return "";
  return `${HEADLINE_BULLET} ${segments.source} · ${segments.category} · ${terminalHyperlink(segments.title, segments.url)}`;
}
