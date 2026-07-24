/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { StyledText, type TextChunk } from "@opentui/core";
import { loadConfig } from "../../core/config.js";
import { sourcesForConfig } from "../../core/default-sources.js";
import { displaySegments } from "../../core/format.js";
import { refreshFeeds } from "../../core/fetch-feeds.js";
import { NewsController } from "../../runtime/news-controller.js";
import type { Headline } from "../../core/types.js";
import { MemoryCache } from "../../runtime/memory-cache.js";

function crop(value: string, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) return "";
  if (value.length <= safeWidth) return value;
  return safeWidth === 1 ? "…" : `${value.slice(0, safeWidth - 1)}…`;
}

function linkedHeadline(headline: Headline | undefined, width: number): StyledText | undefined {
  const segments = displaySegments(headline);
  if (!segments) return undefined;
  const prefix = `${segments.source} · `;
  const title = crop(segments.title, Math.max(0, width - prefix.length));
  const titleChunk: TextChunk = {
    __isChunk: true,
    text: title,
    ...(segments.url ? { link: { url: segments.url } } : {}),
  };
  return new StyledText([{ __isChunk: true, text: prefix }, titleChunk]);
}

const tui: TuiPlugin = async (api) => {
  const config = (await loadConfig()).config;
  const sources = sourcesForConfig(config);
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
    const shouldRun = config.visibility === "always"
      ? Boolean(nextSessionId)
      : config.visibility === "working"
        ? Boolean(nextSessionId && status && (status.type === "busy" || status.type === "retry"))
        : false;
    if (!controller) {
      controller = new NewsController({
        cache,
        intervalMs: config.intervalMs,
        feedTtlMs: config.feedTtlMs,
        maxItems: config.maxItems,
        filters: config,
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
        const line = controller?.isActive() ? linkedHeadline(controller.getHeadline(), 240) : undefined;
        if (!line) return <box />;
        return <text content={line} />;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: "newsbar",
  tui,
};

export default plugin;
