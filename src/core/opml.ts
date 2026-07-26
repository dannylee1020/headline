import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import sax from "sax";
import { canonicalUrl, validHttpUrl } from "./rss.js";
import type { NewsSource } from "./types.js";

export const DEFAULT_MAX_OPML_BYTES = 2 * 1_024 * 1_024;
export const DEFAULT_MAX_OPML_FEEDS = 500;

export interface OpmlParseResult {
  readonly sources: readonly NewsSource[];
  readonly warnings: readonly string[];
}

interface OutlineNode {
  readonly label: string | undefined;
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\p{Cc}+/gu, " ").replace(/\s+/gu, " ").trim();
  return cleaned || undefined;
}

function attribute(attributes: Record<string, unknown>, name: string): string | undefined {
  const target = name.toLowerCase();
  const key = Object.keys(attributes).find((candidate) => candidate.toLowerCase() === target);
  const value = key ? attributes[key] : undefined;
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) {
    const nested = (value as { value?: unknown }).value;
    return typeof nested === "string" ? nested : undefined;
  }
  return undefined;
}

function safeFeedUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!validHttpUrl(candidate)) return undefined;
  const url = new URL(candidate);
  if (url.username || url.password) return undefined;
  return canonicalUrl(url.toString());
}

function sourceId(url: string): string {
  return `opml:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function sourceFromEntry(url: string, name: string | undefined, category: string | undefined): NewsSource {
  const parsed = new URL(url);
  return {
    id: sourceId(url),
    providerId: "opml",
    name: name ?? parsed.hostname,
    category: category ?? "opml",
    url,
  };
}

export function parseOpml(xml: string, maxFeeds = DEFAULT_MAX_OPML_FEEDS): OpmlParseResult {
  const warnings: string[] = [];
  const sources: NewsSource[] = [];
  const seen = new Set<string>();
  const stack: OutlineNode[] = [];
  let sawOpml = false;
  let sawOutline = false;
  let parseError: Error | undefined;

  const parser = sax.parser(true, { trim: false, normalize: false });
  parser.onerror = (error) => {
    parseError = error instanceof Error ? error : new Error(String(error));
    parser.resume();
  };
  parser.onopentag = (tag) => {
    const name = tag.name.toLowerCase();
    if (name === "opml") sawOpml = true;
    if (name !== "outline") return;

    sawOutline = true;
    const attributes = tag.attributes as unknown as Record<string, unknown>;
    const label = cleanLabel(attribute(attributes, "title") ?? attribute(attributes, "text"));
    const rawUrl = attribute(attributes, "xmlUrl");
    const parent = [...stack].reverse().find((node) => node.label)?.label;
    const url = safeFeedUrl(rawUrl);

    if (rawUrl && !url) {
      warnings.push(`skipped OPML feed with an invalid or unsafe URL${label ? ` (${label})` : ""}`);
    } else if (url && sources.length < maxFeeds) {
      if (seen.has(url)) {
        warnings.push(`skipped duplicate OPML feed: ${url}`);
      } else {
        seen.add(url);
        sources.push(sourceFromEntry(url, label, parent));
      }
    } else if (url && sources.length === maxFeeds) {
      warnings.push(`OPML feed limit reached; skipped additional feed${label ? ` (${label})` : ""}`);
    }

    stack.push({ label });
  };
  parser.onclosetag = (name) => {
    if (String(name).toLowerCase() === "outline") stack.pop();
  };

  try {
    parser.write(xml).close();
  } catch (error) {
    parseError = error instanceof Error ? error : new Error(String(error));
  }
  if (parseError) throw new Error(`invalid OPML: ${parseError.message}`);
  if (!sawOpml) throw new Error("invalid OPML: missing <opml> root element");
  if (!sawOutline) warnings.push("OPML contains no outline entries");
  if (!sources.length && sawOutline) warnings.push("OPML contains no valid RSS or Atom feed URLs");
  return { sources, warnings };
}

export function resolveOpmlPath(value: string, configPath: string): string {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? resolve(homedir(), value.slice(2)) : value;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(dirname(configPath), expanded);
}

export async function loadOpmlSources(
  path: string,
  options: { readonly maxBytes?: number; readonly maxFeeds?: number } = {},
): Promise<OpmlParseResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_OPML_BYTES;
  const file = await stat(path);
  if (!file.isFile()) throw new Error(`OPML path is not a file: ${path}`);
  if (file.size > maxBytes) throw new Error(`OPML file exceeds ${maxBytes} byte limit: ${path}`);
  const xml = await readFile(path, "utf8");
  if (Buffer.byteLength(xml, "utf8") > maxBytes) throw new Error(`OPML file exceeds ${maxBytes} byte limit: ${path}`);
  return parseOpml(xml, options.maxFeeds ?? DEFAULT_MAX_OPML_FEEDS);
}
