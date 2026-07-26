import stringWidth from "string-width";
import type { DisplaySegments, Headline } from "./types.js";

export const HEADLINE_BULLET = "•";
export const DEFAULT_DISPLAY_WIDTH = 80;
const MIN_TITLE_WIDTH = 18;

export interface HeadlineLayout {
  readonly marker: string;
  readonly source?: string;
  readonly category?: string;
  readonly title: string;
  readonly url?: string;
}

export type HeadlineStatus = "loading" | "unavailable";

function graphemes(value: string): readonly string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(({ segment }) => segment);
  }
  return [...value];
}

export function displayWidth(value: string): number {
  return stringWidth(value);
}

export function truncateToWidth(value: string, width: number, ellipsis = "…"): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) return "";
  if (displayWidth(value) <= safeWidth) return value;

  const ellipsisWidth = displayWidth(ellipsis);
  if (ellipsisWidth >= safeWidth) {
    return graphemes(ellipsis).filter((part) => displayWidth(part) <= safeWidth).join("");
  }

  const parts: string[] = [];
  let used = 0;
  for (const part of graphemes(value)) {
    const partWidth = displayWidth(part);
    if (used + partWidth > safeWidth - ellipsisWidth) break;
    parts.push(part);
    used += partWidth;
  }
  return `${parts.join("")}${ellipsis}`;
}

export function terminalWidth(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fallback = DEFAULT_DISPLAY_WIDTH,
): number {
  const stdoutColumns = process.stdout.columns;
  if (typeof stdoutColumns === "number" && stdoutColumns > 0) return stdoutColumns;
  const configured = Number.parseInt(env.COLUMNS ?? "", 10);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return fallback;
}

export function displaySegments(headline: Headline | undefined): DisplaySegments | undefined {
  if (!headline) return undefined;
  return {
    category: headline.category.toLowerCase(),
    source: headline.sourceName.toLowerCase(),
    title: headline.title,
    url: headline.url,
  };
}

export function headlineLayoutPrefix(layout: Pick<HeadlineLayout, "marker" | "source" | "category">): string {
  let prefix = `${layout.marker} `;
  if (layout.source) prefix += layout.source;
  if (layout.source && layout.category) prefix += " · ";
  if (layout.category) prefix += layout.category;
  if (layout.source || layout.category) prefix += " · ";
  return prefix;
}

export function layoutHeadline(headline: Headline | undefined, width: number): HeadlineLayout | undefined {
  const segments = displaySegments(headline);
  if (!segments) return undefined;

  const safeWidth = Math.max(0, Math.floor(width));
  const metadataOptions: readonly Pick<HeadlineLayout, "source" | "category">[] = [
    { source: segments.source, category: segments.category },
    { source: segments.source },
    {},
  ];
  const metadata = metadataOptions.find((option) => {
    const prefixWidth = displayWidth(headlineLayoutPrefix({ marker: HEADLINE_BULLET, ...option }));
    return safeWidth >= prefixWidth + MIN_TITLE_WIDTH;
  }) ?? {};
  const prefix = headlineLayoutPrefix({ marker: HEADLINE_BULLET, ...metadata });
  const title = truncateToWidth(segments.title, safeWidth - displayWidth(prefix));

  return {
    marker: HEADLINE_BULLET,
    ...metadata,
    title,
    ...(segments.url ? { url: segments.url } : {}),
  };
}

export function formatHeadlineLayout(layout: HeadlineLayout): string {
  return `${headlineLayoutPrefix(layout)}${layout.title}`;
}

export function formatHeadlineState(status: HeadlineStatus, width?: number): string {
  const text = status === "loading" ? `${HEADLINE_BULLET} loading headlines…` : `${HEADLINE_BULLET} headlines unavailable`;
  return width === undefined ? text : truncateToWidth(text, width, "");
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

export function formatLinkedHeadline(headline: Headline | undefined, width?: number): string {
  if (width === undefined) {
    const segments = displaySegments(headline);
    if (!segments) return "";
    return `${HEADLINE_BULLET} ${segments.source} · ${segments.category} · ${terminalHyperlink(segments.title, segments.url)}`;
  }
  const layout = layoutHeadline(headline, width);
  if (!layout) return "";
  return `${headlineLayoutPrefix(layout)}${terminalHyperlink(layout.title, layout.url)}`;
}
