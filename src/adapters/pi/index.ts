import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import { formatLinkedHeadline } from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { NewsController } from "../../runtime/news-controller.js";
import { MemoryCache } from "../../runtime/memory-cache.js";

const STATUS_KEY = "newsbar";

export default function newsbarExtension(pi: ExtensionAPI): void {
  let controller: NewsController | undefined;
  let updateStatus = (): void => {};
  let taskActive = false;
  let visibility: "always" | "working" | "off" = "working";

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const loaded = await loadConfig();
    const config = loaded.config;
    visibility = config.visibility;
    taskActive = false;
    const cache = new MemoryCache();
    updateStatus = () => {
      const visible = visibility === "always" || (visibility === "working" && taskActive);
      try {
        if (!visible) {
          ctx.ui.setStatus(STATUS_KEY, undefined);
          return;
        }
        const headline = controller?.getHeadline();
        const line = headline
          ? formatLinkedHeadline(headline)
          : controller?.getSnapshot()
            ? "Headlines unavailable"
            : "Loading headlines…";
        ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", line));
      } catch {
        // Host rendering must never affect agent execution.
      }
    };

    if (visibility !== "off") {
      controller = new NewsController({
        cache,
        intervalMs: config.intervalMs,
        feedTtlMs: config.feedTtlMs,
        maxItems: config.maxItems,
        filters: config,
        refresh: (signal) => refreshFeeds(sourcesForConfig(config), controller?.getSnapshot(), {
          signal,
          timeoutMs: config.timeoutMs,
          maxBytes: config.maxBytes,
          maxItems: config.maxItems,
        }),
        onInvalidate: () => updateStatus(),
      });
      if (visibility === "always") controller.activate();
    }
    updateStatus();
  });

  pi.on("agent_start", () => {
    taskActive = true;
    if (visibility === "working") controller?.activate();
    updateStatus();
  });

  pi.on("agent_settled", () => {
    taskActive = false;
    if (visibility === "working") controller?.deactivate();
    updateStatus();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    updateStatus = () => {};
    taskActive = false;
    controller?.dispose();
    controller = undefined;
    try {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    } catch {
      // Ignore teardown failures.
    }
  });
}
