# Headline

Headline displays real-time news headlines while coding agent is actively working.

## One-command installation

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/headline/main/install.sh | sh
```

The installer builds Headline locally, installs it under `${HEADLINE_HOME:-$HOME/.headline}`, detects Claude Code, OpenCode, and Pi automatically, and registers every compatible agent it finds.

Prerequisites: macOS or Linux, POSIX `sh`, `curl`, `tar`, Node `>=22.19.0`, and npm. 

Set `HEADLINE_HOME` only when you need a custom Headline home directory. The application is installed at `$HEADLINE_HOME/app` and the CLI launcher at `$HEADLINE_HOME/bin/headline`.

The installer stages and builds before changing host configuration, keeps a timestamped previous install, and reports restoration paths. It exits with an error if prerequisites are missing or a detected integration fails.

## Supported agents

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

Headline works without a configuration file. To customize built-in providers, use an exported OPML subscription list, change visibility, or adjust refresh and rotation intervals, edit `${HEADLINE_HOME:-$HOME/.headline}/config.json`.

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

```bash
node dist/cli/index.js install claude
# Explicitly replace another status line only when intended:
node dist/cli/index.js install claude --force
```

The installer creates `<settings>.headline.bak`, preserves unrelated settings/hooks, and refuses a non-Headline status line without `--force`. The installed Claude hooks invoke the stable Headline launcher.

### OpenCode

The source installer writes the stable TUI module path to the global `tui.json` configuration using a JSONC-aware, backup-safe edit. For a manual install into another config, use the CLI's `install opencode --config PATH` command. With the default `working` visibility, the row is visible only for the current session while OpenCode reports `busy` or `retry`; use `always` to keep it visible while the session is open.

### Pi

The source installer invokes `pi install <stable-install-dir>` at user scope. For a project-local install, use the CLI's `install pi --project` command. Pi owns its settings format; Headline does not edit Pi settings directly. Headline publishes a native extension status; with the default `working` visibility it appears between `agent_start` and `agent_settled`, while `always` keeps it visible for the session. Pi's default footer renders extension statuses as its final row; custom footers must render `footerData.getExtensionStatuses()` to preserve that integration.

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
