# Headline

Headline brings the news headline into your favorite coding agent's session. It displays rotating, clickable, real-time news headlines while the agent is actively working. Export your existing RSS reader subscription or configure news sources to keep you informed while waiting for agents to finish work. 


## Choose your sources

### Use subscriptions from your existing RSS reader

Export an OPML subscription list from your RSS reader, then create `${HEADLINE_HOME:-$HOME/.headline}/config.json`:

```json
{
  "sources": {
    "mode": "opml",
    "path": "~/path/to/subscriptions.opml"
  }
}
```

Validate and load it with:

```bash
headline opml inspect ~/path/to/subscriptions.opml
headline refresh
```

OPML gives Headline the feed URLs, names, and folders already maintained by your reader. Headline fetches those RSS or Atom feeds independently; it does not import unread state, starred items, credentials, downloaded articles, or reader-specific filters. Re-export the OPML file only when your subscriptions or folders change.

### Start immediately with built-in providers

No configuration file is required. Headline starts with selected feeds from Axios, BBC, NPR, TechCrunch, and Yahoo Finance. To choose different bundled providers or categories, edit `config.json` as described in **[Configuration](docs/configuration.md)**.

### Add providers through source code

To extend the built-in registry, add first-party RSS/XML feeds and their default selections in [`src/core/default-sources.ts`](src/core/default-sources.ts), update the registry assertions and tests, then rebuild Headline. This keeps custom or contributed providers explicit and version-controlled; arbitrary feed collections are better supplied through OPML.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/headline/main/install.sh | sh
```

The installer builds Headline locally, installs it under `${HEADLINE_HOME:-$HOME/.headline}`, detects Claude Code, OpenCode, and Pi automatically, and registers every compatible agent it finds.

Prerequisites: macOS or Linux, POSIX `sh`, `curl`, `tar`, Node `>=22.19.0`, and npm. 

Set `HEADLINE_HOME` only when you need a custom Headline home directory. The application is installed at `$HEADLINE_HOME/app` and the CLI launcher at `$HEADLINE_HOME/bin/headline`.

The installer stages and validates each build before replacing `$HEADLINE_HOME/app`. User configuration, cache, and state live outside the application directory and remain unchanged across updates. It exits with an error if prerequisites are missing or a detected integration fails.

## Supported agents

- **Claude Code:** command status line with responsive, title-first output.
- **OpenCode:** native TUI plugin using the `app_bottom` slot; requires OpenCode `>=1.18.4 <2`.
- **Pi:** local package using Pi's native extension-status row; tested with Pi `0.81.1` and Node `>=22.19.0`.

Codex and tmux are intentionally not part of v0.

## Built-in provider registry

Headline's zero-configuration registry uses unauthenticated, first-party RSS/XML feeds from these providers:

- Axios — `general` — <https://api.axios.com/feed/>
- BBC — `general`, `world`, `uk`, `business`, `politics`, `technology`, `health`, `education`, `science`, `entertainment`, `sports` — [official feed directory](https://www.bbc.com/news/10628494)
- NPR — `general`, `national`, `world`, `politics`, `business`, `economy`, `technology`, `health`, `science`, `education`, `climate`, `culture`, `sports` — [official topic feeds](https://feeds.npr.org/1001/rss.xml)
- TechCrunch — `technology` — <https://techcrunch.com/feed/>
- Yahoo Finance — `finance` — <https://finance.yahoo.com/news/rssindex>

Run `headline sources` to see the current provider/category capability union. AP is intentionally excluded because it does not provide a free public RSS feed.

Headline retains headline metadata only: title, article URL, source, category, and timestamps. It does not scrape pages, retrieve article bodies, use API keys, send telemetry, or add headlines to model context.

## Configuration

Headline works without a configuration file. To use your RSS reader's OPML export, customize bundled providers, change visibility, or adjust refresh and rotation intervals, edit `${HEADLINE_HOME:-$HOME/.headline}/config.json`.

See **[Configuration](docs/configuration.md)** for every supported field, available provider/category values, defaults, OPML setup, validation behavior, and examples.

## Manual/local development

```bash
npm install
npm run check
npm pack --dry-run
```

After installation, add `$HOME/.headline/bin` to `PATH` if you want to use `headline` directly. The CLI is also available through the installed launcher path.

### CLI operations

The application lives under `$HEADLINE_HOME/app`; `config.json`, `cache/`, and `state/` survive application updates. The home layout is:

```text
$HEADLINE_HOME/
├── app/                  # built Headline application and runtime dependencies
├── bin/headline           # stable CLI launcher
├── config.json           # user settings
├── cache/snapshot.json   # last-good headlines
└── state/refresh.lock   # cross-host refresh lock
```

`headline refresh` is coordinated across hosts and never overlaps another refresh.

Build output is generated in `dist/`. The package is private and is not published by this repository.

### Claude Code

The installer automatically adds the Headline status line and lifecycle hooks while preserving unrelated Claude settings. An existing non-Headline status line is left unchanged and reported as a conflict.

### OpenCode

The installer automatically registers the Headline TUI plugin for OpenCode `>=1.18.4`, preserving unrelated `tui.json` values and comments. Restart OpenCode after installation.

### Pi

The installer automatically installs Headline as a user-scoped Pi package for Pi `>=0.81.1`. Headline uses Pi's native extension-status row; custom footers must include extension statuses to display it.
