import sax from "sax";
import type { Headline, NewsSource } from "./types.js";

interface RawItem {
  title?: string;
  link?: string;
  guid?: string;
  published?: string;
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\p{Cc}+/gu, " ").replace(/\s+/gu, " ").trim();
  return cleaned || undefined;
}

export function validHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return value;
  }
}

export function parseRss(source: NewsSource, xml: string, fetchedAt: number, maxItems = 20): readonly Headline[] {
  const parser = sax.parser(true, { trim: false, normalize: false });
  const items: RawItem[] = [];
  let current: RawItem | undefined;
  let field: keyof RawItem | undefined;
  let text = "";
  let parseError: Error | undefined;

  parser.onerror = (error) => {
    parseError = error instanceof Error ? error : new Error(String(error));
    parser.resume();
  };
  parser.onopentag = (tag) => {
    const name = tag.name.toLowerCase();
    if (name === "item" || name === "entry") {
      if (current) items.push(current);
      current = {};
      field = undefined;
      text = "";
      return;
    }
    if (!current) return;
    if (name === "title") {
      field = "title";
      text = "";
    } else if (name === "link") {
      const href = typeof tag.attributes.href === "string" ? tag.attributes.href : undefined;
      if (href) {
        current.link = href;
        field = undefined;
        text = "";
      } else {
        field = "link";
        text = "";
      }
    } else if (name === "guid" || name === "id") {
      field = "guid";
      text = "";
    } else if (name === "pubdate" || name === "published" || name === "updated" || name === "date") {
      field = "published";
      text = "";
    } else {
      field = undefined;
    }
  };
  const appendText = (value: string) => {
    if (current && field) text += value;
  };
  parser.ontext = appendText;
  parser.oncdata = appendText;
  parser.onclosetag = (name) => {
    const normalized = String(name).toLowerCase();
    if (!current) return;
    if (field && ((field === "title" && normalized === "title") || (field === "link" && normalized === "link") || (field === "guid" && (normalized === "guid" || normalized === "id")) || (field === "published" && ["pubdate", "published", "updated", "date"].includes(normalized)))) {
      const value = cleanText(text);
      if (value) current[field] = value;
    }
    if (normalized === "item" || normalized === "entry") {
      items.push(current);
      current = undefined;
      field = undefined;
      text = "";
    }
  };

  try {
    parser.write(xml).close();
  } catch (error) {
    parseError = error instanceof Error ? error : new Error(String(error));
  }
  if (parseError) throw new Error(`invalid RSS/XML from ${source.id}: ${parseError.message}`);

  return items
    .slice(0, maxItems)
    .map((item, index) => {
      const title = cleanText(item.title);
      const url = item.link && validHttpUrl(item.link) ? item.link : undefined;
      if (!title || !url) return undefined;
      const publishedAt = item.published ? Date.parse(item.published) : Number.NaN;
      const guid = cleanText(item.guid);
      return {
        id: `${source.id}:${guid && !validHttpUrl(guid) ? guid : canonicalUrl(url)}`,
        title,
        url,
        sourceId: source.id,
        providerId: source.providerId,
        sourceName: source.name,
        category: source.category,
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
        feedOrdinal: index,
        fetchedAt,
      } satisfies Headline;
    })
    .filter((item): item is Headline => Boolean(item));
}
