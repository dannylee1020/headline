import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { DEFAULT_INTERVAL_MS } from "../../core/config.js";
import { DEFAULT_SOURCES } from "../../core/default-sources.js";
import { formatHeadline } from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { NewsController } from "../../runtime/news-controller.js";
import { MemoryCache } from "../../runtime/memory-cache.js";

const WIDGET_KEY = "newsbar";

export default function newsbarExtension(pi: ExtensionAPI): void {
  let controller: NewsController | undefined;
  let tuiEnabled = false;
  let requestRender = (): void => {};
  let clearWidget = (): void => {};

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    tuiEnabled = true;
    const cache = new MemoryCache();
    controller = new NewsController({
      cache,
      intervalMs: DEFAULT_INTERVAL_MS,
      refresh: (signal) => refreshFeeds(DEFAULT_SOURCES, controller?.getSnapshot(), { signal }),
      onInvalidate: () => requestRender(),
    });

    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        requestRender = () => tui.requestRender();
        clearWidget = () => ctx.ui.setWidget(WIDGET_KEY, undefined);
        return {
        invalidate: () => tui.requestRender(),
        render: (width: number) => {
          const line = formatHeadline(controller?.getHeadline());
          if (!line || !controller?.isActive()) return [];
          return [truncateToWidth(theme.fg("dim", line), Math.max(0, width))];
        },
        dispose: () => {
          // Controller owns timers and requests; shutdown performs final disposal.
        },
        };
      },
      { placement: "belowEditor" },
    );
  });

  pi.on("agent_start", async () => {
    if (!tuiEnabled) return;
    controller?.activate();
  });

  pi.on("agent_settled", async () => {
    if (!tuiEnabled) return;
    controller?.deactivate();
  });

  pi.on("session_shutdown", async () => {
    controller?.dispose();
    controller = undefined;
    clearWidget();
    requestRender = () => {};
    clearWidget = () => {};
    tuiEnabled = false;
  });
}
