import { loadConfig, type HeadlineConfig } from "../core/config.js";
import { sourcesForConfig } from "../core/default-sources.js";
import { refreshFeeds } from "../core/fetch-feeds.js";
import { ActivityStore, FileSnapshotCache } from "./file-cache.js";
import { FileRefreshCoordinator } from "./refresh-coordinator.js";

export interface RefreshNewsOptions {
  readonly root?: string;
  readonly config?: HeadlineConfig;
  readonly configPath?: string;
  readonly lockHeld?: boolean;
}

export async function refreshNews(options: RefreshNewsOptions = {}): Promise<boolean> {
  const loaded = options.config
    ? { config: options.config }
    : await loadConfig(options.configPath ? { filePath: options.configPath } : {});
  const config = loaded.config;
  const cacheOptions = options.root ? { root: options.root } : {};
  if (config.visibility === "off") {
    if (options.lockHeld) await new ActivityStore(cacheOptions).releaseRefresh().catch(() => undefined);
    return false;
  }

  const cache = new FileSnapshotCache(cacheOptions);
  const coordinator = new FileRefreshCoordinator(cacheOptions);
  const execute = async () => {
    const previous = await cache.read();
    const refreshed = await refreshFeeds(sourcesForConfig(config), previous, {
      timeoutMs: config.timeoutMs,
      maxBytes: config.maxBytes,
      maxItems: config.maxItems,
    });
    await cache.write(refreshed.snapshot);
    return refreshed;
  };
  const result = options.lockHeld
    ? await (async () => {
      try {
        return await execute();
      } finally {
        await new ActivityStore(cacheOptions).releaseRefresh().catch(() => undefined);
      }
    })()
    : await coordinator.run(execute);
  return result !== undefined;
}
