import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import {
  formatHeadlineState,
  headlineLayoutPrefix,
  layoutHeadline,
  terminalHyperlink,
  terminalWidth,
} from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { NewsController } from "../../runtime/news-controller.js";
import { FileSnapshotCache } from "../../runtime/file-cache.js";
import { FileRefreshCoordinator } from "../../runtime/refresh-coordinator.js";

const STATUS_KEY = "headline";

export default function headlineExtension(pi: ExtensionAPI): void {
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
    const cache = new FileSnapshotCache();
    const coordinator = new FileRefreshCoordinator();
    updateStatus = () => {
      const visible = visibility === "always" || (visibility === "working" && taskActive);
      try {
        if (!visible) {
          ctx.ui.setStatus(STATUS_KEY, undefined);
          return;
        }
        const width = terminalWidth();
        const headline = controller?.getHeadline();
        const layout = layoutHeadline(headline, width);
        const line = layout
          ? `${ctx.ui.theme.fg("accent", layout.marker)}${ctx.ui.theme.fg("dim", headlineLayoutPrefix(layout).slice(layout.marker.length))}${ctx.ui.theme.bold(ctx.ui.theme.fg("text", terminalHyperlink(layout.title, layout.url)))}`
          : (() => {
              const state = formatHeadlineState(controller?.getSnapshot() ? "unavailable" : "loading", width);
              return `${ctx.ui.theme.fg("accent", state.slice(0, 1))}${ctx.ui.theme.fg("dim", state.slice(1))}`;
            })();
        ctx.ui.setStatus(STATUS_KEY, line);
      } catch {
        // Host rendering must never affect agent execution.
      }
    };

    if (visibility !== "off") {
      controller = new NewsController({
        cache,
        intervalMs: config.intervalMs,
        refreshIntervalMs: config.refreshIntervalMs,
        maxItems: config.maxItems,
        filters: { sourceIds: sourcesForConfig(config).map((source) => source.id) },
        coordinateRefresh: (refresh) => coordinator.run(refresh),
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
