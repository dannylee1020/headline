import type { NewsSnapshot, SourceCache } from "../core/types.js";

export class MemoryCache implements SourceCache {
  private snapshot?: NewsSnapshot;

  async read(): Promise<NewsSnapshot | undefined> {
    return this.snapshot;
  }

  async write(snapshot: NewsSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }
}
