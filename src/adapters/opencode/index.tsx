/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { StyledText, TextAttributes, type TextChunk } from "@opentui/core";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import {
  formatHeadlineState,
  headlineLayoutPrefix,
  layoutHeadline,
} from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { NewsController } from "../../runtime/news-controller.js";
import type { Headline } from "../../core/types.js";
import { FileSnapshotCache } from "../../runtime/file-cache.js";
import { FileRefreshCoordinator } from "../../runtime/refresh-coordinator.js";

function styledState(
  status: "loading" | "unavailable",
  width: number,
  theme: Pick<TuiThemeCurrent, "accent" | "textMuted">,
): StyledText {
  const text = formatHeadlineState(status, width);
  return new StyledText([
    { __isChunk: true, text: text.slice(0, 1), fg: theme.accent },
    { __isChunk: true, text: text.slice(1), fg: theme.textMuted },
  ]);
}

export function linkedHeadline(
  headline: Headline | undefined,
  width: number,
  theme: Pick<TuiThemeCurrent, "accent" | "textMuted" | "text">,
): StyledText | undefined {
  const layout = layoutHeadline(headline, width);
  if (!layout) return undefined;
  const prefix = headlineLayoutPrefix(layout);
  const titleChunk: TextChunk = {
    __isChunk: true,
    text: layout.title,
    fg: theme.text,
    attributes: TextAttributes.BOLD,
    ...(layout.url ? { link: { url: layout.url } } : {}),
  };
  return new StyledText([
    { __isChunk: true, text: layout.marker, fg: theme.accent },
    { __isChunk: true, text: prefix.slice(layout.marker.length), fg: theme.textMuted },
    titleChunk,
  ]);
}

const tui: TuiPlugin = async (api) => {
  const config = (await loadConfig()).config;
  const sources = sourcesForConfig(config);
  const cache = new FileSnapshotCache();
  const coordinator = new FileRefreshCoordinator();
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
    const shouldRun = config.visibility === "always"
      ? Boolean(nextSessionId)
      : config.visibility === "working"
        ? Boolean(nextSessionId && status && (status.type === "busy" || status.type === "retry"))
        : false;
    if (!controller) {
      controller = new NewsController({
        cache,
        intervalMs: config.intervalMs,
        refreshIntervalMs: config.refreshIntervalMs,
        maxItems: config.maxItems,
        filters: { sourceIds: sources.map((source) => source.id) },
        coordinateRefresh: (refresh) => coordinator.run(refresh),
        refresh: (signal) => refreshFeeds(sources, controller?.getSnapshot(), {
          signal,
          timeoutMs: config.timeoutMs,
          maxBytes: config.maxBytes,
          maxItems: config.maxItems,
        }),
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
        if (!controller?.isActive()) return <box />;
        const line = linkedHeadline(controller.getHeadline(), api.renderer.width, api.theme.current)
          ?? styledState(controller.getSnapshot() ? "unavailable" : "loading", api.renderer.width, api.theme.current);
        return <text content={line} />;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "headline",
  tui,
};

export default plugin;
