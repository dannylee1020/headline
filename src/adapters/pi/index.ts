import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import { displaySegments, HEADLINE_BULLET, terminalHyperlink } from "../../core/format.js";
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
        const headline = controller?.getHeadline();
        const segments = displaySegments(headline);
        const line = segments
          ? `${ctx.ui.theme.fg("accent", HEADLINE_BULLET)} ${ctx.ui.theme.fg("dim", `${segments.source} · ${segments.category} · `)}${ctx.ui.theme.fg("muted", terminalHyperlink(segments.title, segments.url))}`
          : ctx.ui.theme.fg("dim", controller?.getSnapshot() ? `${HEADLINE_BULLET} headlines unavailable` : `${HEADLINE_BULLET} loading headlines…`);
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
