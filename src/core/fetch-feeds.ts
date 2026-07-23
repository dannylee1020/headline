import { DEFAULT_MAX_BYTES, DEFAULT_MAX_ITEMS, DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT } from "./config.js";
import { parseRss, validHttpUrl } from "./rss.js";
import type { FeedFailure, FeedResult, FetchLike, NewsSource, NewsSnapshot, SourceSnapshot } from "./types.js";

export interface FetchFeedOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxItems?: number;
  readonly userAgent?: string;
  readonly now?: number;
  readonly signal?: AbortSignal;
}

function timeoutSignal(timeoutMs: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("feed request timed out")), timeoutMs);
  const abort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) abort();
    else parent.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const announced = Number(response.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maxBytes) throw new Error("feed response exceeds size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("feed response exceeds size limit");
        throw new Error("feed response exceeds size limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchFeed(source: NewsSource, options: FetchFeedOptions = {}, previous?: SourceSnapshot): Promise<FeedResult> {
  if (!validHttpUrl(source.url)) throw new Error(`invalid source URL: ${source.url}`);
  const signal = timeoutSignal(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal);
  try {
    const fetcher = options.fetch ?? fetch;
    const response = await fetcher(source.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9",
        "User-Agent": source.userAgent ?? options.userAgent ?? DEFAULT_USER_AGENT,
        ...(previous?.etag ? { "If-None-Match": previous.etag } : {}),
        ...(previous?.lastModified ? { "If-Modified-Since": previous.lastModified } : {}),
      },
      signal: signal.signal,
    });
    if (response.url && !validHttpUrl(response.url)) throw new Error("feed redirected to a non-HTTP(S) URL");
    if (response.status === 304 && previous) {
      return {
        source,
        headlines: previous.headlines,
        fetchedAt: options.now ?? Date.now(),
        ...(previous.etag ? { etag: previous.etag } : {}),
        ...(previous.lastModified ? { lastModified: previous.lastModified } : {}),
      };
    }
    if (!response.ok) throw new Error(`feed returned HTTP ${response.status}`);
    const body = await readBounded(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    const fetchedAt = options.now ?? Date.now();
    const headlines = parseRss(source, body, fetchedAt, options.maxItems ?? DEFAULT_MAX_ITEMS);
    return {
      source,
      headlines,
      fetchedAt,
      ...(response.headers.get("etag") ? { etag: response.headers.get("etag")! } : {}),
      ...(response.headers.get("last-modified") ? { lastModified: response.headers.get("last-modified")! } : {}),
    };
  } finally {
    signal.dispose();
  }
}

export interface RefreshFeedsOptions extends FetchFeedOptions {
  readonly sources?: readonly NewsSource[];
}

export async function refreshFeeds(
  sources: readonly NewsSource[],
  previous: NewsSnapshot | undefined,
  options: RefreshFeedsOptions = {},
): Promise<{ snapshot: NewsSnapshot; failures: readonly FeedFailure[] }> {
  const previousById = new Map(previous?.sources.map((item) => [item.source.id, item]) ?? []);
  const now = options.now ?? Date.now();
  const settled = await Promise.allSettled(sources.map((source) => fetchFeed(source, options, previousById.get(source.id))));
  const failures: FeedFailure[] = [];
  const next: SourceSnapshot[] = [];
  const health = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index]!;
    const result = settled[index]!;
    if (result.status === "fulfilled") {
      const value = result.value;
      next.push({
        source: value.source,
        headlines: value.headlines,
        fetchedAt: value.fetchedAt,
        ...(value.etag ? { etag: value.etag } : {}),
        ...(value.lastModified ? { lastModified: value.lastModified } : {}),
      });
      health.push({ sourceId: source.id, ok: true, fetchedAt: value.fetchedAt });
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push({ source, error: message });
      const old = previousById.get(source.id);
      if (old) next.push(old);
      health.push({ sourceId: source.id, ok: false, ...(old?.fetchedAt ? { fetchedAt: old.fetchedAt } : {}), error: message });
    }
  }
  return {
    snapshot: { version: 1, sources: next, health, updatedAt: now },
    failures,
  };
}
