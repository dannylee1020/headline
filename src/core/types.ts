export type Category = string;
export type CategoryFilter = Category | "all";

export interface NewsSource {
  /** Stable identifier for this concrete feed endpoint. */
  readonly id: string;
  /** Logical publisher identifier shared by the publisher's category feeds. */
  readonly providerId: string;
  readonly name: string;
  readonly category: Category;
  readonly url: string;
  readonly userAgent?: string;
}

export interface Headline {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly sourceId: string;
  readonly providerId: string;
  readonly sourceName: string;
  readonly category: Category;
  readonly publishedAt?: number;
  readonly feedOrdinal: number;
  readonly fetchedAt: number;
}

export interface SourceSnapshot {
  readonly source: NewsSource;
  readonly headlines: readonly Headline[];
  readonly fetchedAt: number;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface SourceHealth {
  readonly sourceId: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly fetchedAt?: number;
}

export interface NewsSnapshot {
  readonly version: 1;
  readonly sources: readonly SourceSnapshot[];
  readonly health: readonly SourceHealth[];
  readonly updatedAt: number;
}

export interface SourceCache {
  read(): Promise<NewsSnapshot | undefined>;
  write(snapshot: NewsSnapshot): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface FeedResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FetchOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs: number;
  readonly maxBytes: number;
  readonly userAgent: string;
  readonly now: number;
  readonly signal?: AbortSignal;
}

export interface FeedResult {
  readonly source: NewsSource;
  readonly headlines: readonly Headline[];
  readonly fetchedAt: number;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface FeedFailure {
  readonly source: NewsSource;
  readonly error: string;
}

export interface RefreshResult {
  readonly snapshot: NewsSnapshot;
  readonly failures: readonly FeedFailure[];
}

export interface TimerScheduler {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface NewsFilters {
  readonly providers?: readonly string[];
  readonly categories?: readonly Category[];
}

export interface ControllerOptions {
  readonly cache: SourceCache;
  readonly clock?: Clock;
  readonly scheduler?: TimerScheduler;
  readonly refresh: (signal: AbortSignal) => Promise<RefreshResult>;
  readonly coordinateRefresh?: (refresh: () => Promise<RefreshResult>) => Promise<RefreshResult | undefined>;
  readonly intervalMs?: number;
  readonly refreshIntervalMs?: number;
  readonly maxItems?: number;
  readonly filters?: NewsFilters;
  readonly onInvalidate: () => void;
}

export interface DisplaySegments {
  readonly category: string;
  readonly source: string;
  readonly title: string;
  readonly url?: string;
}
