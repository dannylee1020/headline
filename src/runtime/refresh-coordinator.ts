import { ActivityStore, type FileCacheOptions } from "./file-cache.js";

export class FileRefreshCoordinator {
  private readonly activity: ActivityStore;

  constructor(options: FileCacheOptions = {}) {
    this.activity = new ActivityStore(options);
  }

  async run<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (!(await this.activity.claimRefresh().catch(() => false))) return undefined;
    try {
      return await task();
    } finally {
      await this.activity.releaseRefresh().catch(() => undefined);
    }
  }
}
