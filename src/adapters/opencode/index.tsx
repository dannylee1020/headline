/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui";

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
) {
  const text = formatHeadlineState(status, width);
  return (
    <text>
      <span style={{ fg: theme.accent }}>{text.slice(0, 1)}</span>
      <span style={{ fg: theme.textMuted }}>{text.slice(1)}</span>
    </text>
  );
}

export function linkedHeadline(
  headline: Headline | undefined,
  width: number,
  theme: Pick<TuiThemeCurrent, "accent" | "textMuted">,
) {
  const layout = layoutHeadline(headline, width);
  if (!layout) return undefined;
  const prefix = headlineLayoutPrefix(layout);
  return {
    marker: { text: layout.marker, fg: theme.accent },
    metadata: { text: prefix.slice(layout.marker.length), fg: theme.textMuted },
    title: { text: layout.title, fg: theme.textMuted, url: layout.url },
  };
}

export function renderLinkedHeadline(line: NonNullable<ReturnType<typeof linkedHeadline>>) {
  return (
    <text>
      <span style={{ fg: line.marker.fg }}>{line.marker.text}</span>
      <span style={{ fg: line.metadata.fg }}>{line.metadata.text}</span>
      <b style={{ fg: line.title.fg }}>
        {line.title.url ? <a href={line.title.url}>{line.title.text}</a> : line.title.text}
      </b>
    </text>
  );
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
        const line = linkedHeadline(controller.getHeadline(), api.renderer.width, api.theme.current);
        return line
          ? renderLinkedHeadline(line)
          : styledState(controller.getSnapshot() ? "unavailable" : "loading", api.renderer.width, api.theme.current);
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "headline",
  tui,
};

export default plugin;
