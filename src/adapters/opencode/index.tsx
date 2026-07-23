/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { DEFAULT_INTERVAL_MS } from "../../core/config.js";
import { DEFAULT_SOURCES } from "../../core/default-sources.js";
import { formatHeadline } from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { NewsController } from "../../runtime/news-controller.js";
import { MemoryCache } from "../../runtime/memory-cache.js";

function crop(value: string, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) return "";
  if (value.length <= safeWidth) return value;
  return safeWidth === 1 ? "…" : `${value.slice(0, safeWidth - 1)}…`;
}

const tui: TuiPlugin = async (api) => {
  const cache = new MemoryCache();
  let controller: NewsController | undefined;
  let sessionId: string | undefined;
  let disposed = false;

  const getSessionId = (): string | undefined => {
    const route = api.route.current;
    return route.name === "session" && route.params && typeof route.params.sessionID === "string" ? route.params.sessionID : undefined;
  };

  const sync = (): void => {
    if (disposed) return;
    const nextSessionId = getSessionId();
    const status = nextSessionId ? api.state.session.status(nextSessionId) : undefined;
    const shouldRun = Boolean(nextSessionId && status && (status.type === "busy" || status.type === "retry"));
    if (!controller) {
      controller = new NewsController({
        cache,
        intervalMs: DEFAULT_INTERVAL_MS,
        refresh: (signal) => refreshFeeds(DEFAULT_SOURCES, controller?.getSnapshot(), { signal }),
        onInvalidate: () => api.renderer.requestRender(),
      });
    }
    sessionId = nextSessionId;
    if (shouldRun) controller.activate();
    else controller.deactivate();
  };

  const unsubscribe = api.event.on("session.status", (event) => {
    if (!sessionId || event.properties.sessionID === sessionId || event.properties.sessionID === getSessionId()) {
      sync();
      api.renderer.requestRender();
    }
  });
  api.lifecycle.onDispose(() => {
    disposed = true;
    unsubscribe();
    controller?.dispose();
    controller = undefined;
  });

  api.slots.register({
    slots: {
      app_bottom: () => {
        sync();
        const line = controller?.isActive() ? formatHeadline(controller.getHeadline()) : "";
        if (!line) return <box />;
        return <text>{crop(line, 240)}</text>;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "newsbar",
  tui,
};

export default plugin;
