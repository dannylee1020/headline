# Headline

Headline is a private v0 TypeScript package that shows rotating RSS headlines while **Claude Code**, **OpenCode**, or **Pi** is actively working.

## One-command source installation

After this repository is pushed to `dannylee1020/headline` on `main`:

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/headline/main/install.sh | sh
```

The installer downloads the source archive, runs `npm ci` and `npm run build` locally, and installs the application to `${HEADLINE_HOME:-$HOME/.headline}/app`. It creates the `headline` CLI launcher at `${HEADLINE_HOME:-$HOME/.headline}/bin/headline`, detects all supported agents present in `PATH`, and attempts each independently.

Prerequisites: POSIX `sh`, `curl`, `tar`, Node `>=22.19.0`, and npm. GitHub CLI, Git, Bun, jq, Deno, tmux, sudo, and root access are not required. v0 targets macOS/Linux; Windows installation is not included.

### Installer controls

```bash
HEADLINE_REF=<branch-or-tag> \
HEADLINE_ARCHIVE_URL=<https-archive-url> \
HEADLINE_HOME="$HOME/.headline" \
HEADLINE_INSTALL_DIR="$HOME/.headline/app" \
HEADLINE_DRY_RUN=1 \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/dannylee1020/headline/main/install.sh)"
```

Other controls:

- `HEADLINE_REPOSITORY` — source repository, default `dannylee1020/headline`.
- `HEADLINE_REF_TYPE` — `heads` or `tags`, default `heads`.
- `HEADLINE_CLAUDE_FORCE=1` — explicitly replace a foreign Claude status line.
- `HEADLINE_CLAUDE_SETTINGS` — alternate Claude settings file.
- `HEADLINE_OPENCODE_CONFIG` — alternate OpenCode `tui.json` file.
- `HEADLINE_PI_PROJECT=1` — install Pi into the current project with `pi install -l` instead of user scope.
- `HEADLINE_INSTALL_HOSTS=claude,opencode,pi` — limit/override host detection for testing.
- `HEADLINE_HOME` — Headline home directory, default `$HOME/.headline`.
- `HEADLINE_INSTALL_DIR` — application directory, default `$HEADLINE_HOME/app`.

The default `main` archive is mutable. Pin a tag, commit archive URL, or trusted fork when reproducibility matters. The installer stages and builds before changing host configuration, keeps a timestamped previous install, and reports restoration paths.

Exit codes:

- `0` — every detected compatible host installed successfully, or dry run completed.
- `1` — at least one detected host installation failed.
- `2` — prerequisites missing, no supported host detected, or no compatible host available.

## Supported hosts

- **Claude Code:** command status line, installed through the built CLI.
- **OpenCode:** native TUI plugin using the `app_bottom` slot; requires OpenCode `>=1.18.4 <2`.
- **Pi:** local package using Pi's native extension-status row; tested with Pi `0.81.1` and Node `>=22.19.0`.

Codex and tmux are intentionally not part of v0.

## Sources

Headline's built-in registry uses unauthenticated, first-party RSS/XML feeds from these providers:

- Axios — `general` — <https://api.axios.com/feed/>
- BBC — `general`, `world`, `uk`, `business`, `politics`, `technology`, `health`, `education`, `science`, `entertainment`, `sports` — [official feed directory](https://www.bbc.com/news/10628494)
- NPR — `general`, `national`, `world`, `politics`, `business`, `economy`, `technology`, `health`, `science`, `education`, `climate`, `culture`, `sports` — [official topic feeds](https://feeds.npr.org/1001/rss.xml)
- TechCrunch — `technology` — <https://techcrunch.com/feed/>
- Yahoo Finance — `finance` — <https://finance.yahoo.com/news/rssindex>

Run `headline sources` to see the current provider/category capability union. AP is intentionally excluded because it does not provide a free public RSS feed.

Headline retains headline metadata only: title, article URL, source, category, and timestamps. It does not scrape pages, retrieve article bodies, use API keys, send telemetry, or add headlines to model context.

## Configuration

Headline reads an optional JSON configuration file from `${HEADLINE_HOME:-$HOME/.headline}/config.json`. Existing configurations under `${XDG_CONFIG_HOME:-$HOME/.config}/headline/config.json` are migrated on first read.

```json
{
  "version": 2,
  "sources": {
    "mode": "built-in",
    "providers": {
      "bbc": ["technology", "sports"],
      "npr": ["technology"],
      "techcrunch": ["technology"]
    }
  },
  "visibility": "working",
  "rotationSeconds": 8,
  "refreshMinutes": 15
}
```

- `sources.mode` — `built-in` (default) or `opml`; the modes are mutually exclusive.
- `sources.providers` — in `built-in` mode, maps each enabled provider to the exact RSS categories to fetch. Omit a provider to exclude it. Run `headline sources` to list the supported mapping.
- `sources.path` — in `opml` mode, path to an OPML subscription export. Relative paths are resolved beside `config.json`; `~/...` paths are supported.
- `visibility` — `working` (default), `always`, or `off`. `working` shows Headline only while the host is processing a task.
- `rotationSeconds` — headline rotation interval from 2 to 60 seconds; this only rotates cached headlines.
- `refreshMinutes` — RSS polling interval from 5 to 1440 minutes; default 15.

Omit `sources` to use the defaults: Axios `general`; BBC `general` and `technology`; NPR `general` and `technology`; TechCrunch `technology`; and Yahoo Finance `finance`. Version 1 configs with separate provider/category arrays and version 2 configs with top-level `providers` remain readable. Invalid configuration falls back to built-in defaults; an invalid or missing OPML file stays in OPML mode and produces no built-in headlines. Run `headline doctor` to print the effective source mode, feed count, path, and diagnostics. Restart Pi or OpenCode after changing the file; Claude reads it for each status invocation.

### Use an existing RSS reader subscription list

Most RSS readers can export subscriptions as an `.opml` file. Export that file from NetNewsWire, Feedly, FreshRSS, Miniflux, or another reader, then configure:

```json
{
  "version": 2,
  "sources": {
    "mode": "opml",
    "path": "~/Documents/subscriptions.opml"
  }
}
```

Headline reads the feed URLs, names, and folders from the OPML file. It then fetches those public HTTP(S) feeds independently, caches their headlines, and displays them through the coding-agent integrations. OPML transfers the subscription list—not the reader's downloaded articles, unread state, starred state, credentials, or filters. Re-export the file when subscriptions change. Use `headline opml inspect PATH` to validate an export without modifying it.

## Manual/local development

```bash
npm install
npm run check
npm pack --dry-run
```

After installation, add `$HOME/.headline/bin` to `PATH` if you want to use `headline` directly. The CLI is also available through the installed launcher path.

### CLI operations

```bash
headline doctor
headline config path
headline config show
headline sources
headline opml inspect ~/Documents/subscriptions.opml
headline refresh
headline cache clear
```

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

```bash
node dist/cli/index.js install claude
# Explicitly replace another status line only when intended:
node dist/cli/index.js install claude --force
```

The installer creates `<settings>.headline.bak`, preserves unrelated settings/hooks, and refuses a non-Headline status line without `--force`. Set `HEADLINE_CLAUDE_SETTINGS` for a temporary test file. The installed Claude hooks invoke the stable Headline launcher.

### OpenCode

The source installer writes the stable TUI module path to the global `tui.json` configuration using a JSONC-aware, backup-safe edit. Set `HEADLINE_OPENCODE_CONFIG` to test another file. With the default `working` visibility, the row is visible only for the current session while OpenCode reports `busy` or `retry`; use `always` to keep it visible while the session is open.

### Pi

The source installer invokes `pi install <stable-install-dir>` at user scope. Set `HEADLINE_PI_PROJECT=1` for `pi install -l` project scope. Pi owns its settings format; Headline does not edit Pi settings directly. Headline publishes a native extension status; with the default `working` visibility it appears between `agent_start` and `agent_settled`, while `always` keeps it visible for the session. Pi's default footer renders extension statuses as its final row; custom footers must render `footerData.getExtensionStatuses()` to preserve that integration.

## Runtime behavior

- Feeds refresh with bounded concurrency, a five-second timeout, RSS/XML `Accept`, descriptive `User-Agent`, and a one MiB response limit.
- Headline rotation reads the persistent cache; RSS polling happens only at `refreshMinutes` and is coordinated across active hosts.
- A failed source does not discard healthy sources or last-good data.
- Rotation is deterministic: the headline changes at the configured interval (eight seconds by default) without writing an index on every tick.
- Headline text uses terminal-native hyperlinks where supported, opening the RSS article URL without displaying it; some terminals require Cmd-click or Ctrl-click.
- Where the host exposes theme colors, the display uses a small accent-colored `•`, a dim provider and divider, and a slightly muted headline to stay quiet while remaining easy to spot.
- Claude status invocations return cached/loading output immediately; refresh happens in at most one bounded worker.
- `HEADLINE_OFFLINE=1` or `PI_OFFLINE=1` can suppress network requests in host integrations.
- Configuration, cache, and runtime state are organized under `HEADLINE_HOME` as `config.json`, `cache/`, and `state/`; `HEADLINE_CACHE_DIR` remains available for tests and overrides.
- OPML imports are limited to a bounded local file and feed count; invalid entries are skipped with diagnostics, and one failed feed does not hide healthy feeds.
- `working` visibility uses Claude activity hooks, OpenCode `busy`/`retry` state, or Pi's `agent_start`/`agent_settled` events; `always` keeps the selected headline visible for the host session.

To restore Claude settings, stop Claude Code and replace the settings file with its `.headline.bak` copy. Remove `$HEADLINE_HOME/app` and `$HEADLINE_HOME/bin/headline` only after removing host registrations; keep `config.json`, `cache/`, and `state/` if you plan to reinstall.

## Validation

```bash
sh -n install.sh
npm run typecheck
npm test
npm run build
npm run check
npm ls --omit=dev --all
```

Live GitHub archive availability, publisher feeds, and OpenCode runtime smoke are environment-dependent and are not deterministic CI requirements. Feed usage terms remain the responsibility of any future public or commercial release.
