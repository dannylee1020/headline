# Newsbar

Newsbar is a private v0 TypeScript package that shows rotating RSS headlines while **Claude Code**, **OpenCode**, or **Pi** is actively working.

## One-command source installation

After this repository is pushed to `dannylee1020/newsbar` on `main`:

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/newsbar/main/install.sh | sh
```

The installer downloads the source archive, runs `npm ci` and `npm run build` locally, and installs to `${XDG_DATA_HOME:-$HOME/.local/share}/newsbar`. It detects all supported agents present in `PATH` and attempts each independently.

Prerequisites: POSIX `sh`, `curl`, `tar`, Node `>=22.19.0`, and npm. GitHub CLI, Git, Bun, jq, Deno, tmux, sudo, and root access are not required. v0 targets macOS/Linux; Windows installation is not included.

### Installer controls

```bash
NEWSBAR_REF=<branch-or-tag> \
NEWSBAR_ARCHIVE_URL=<https-archive-url> \
NEWSBAR_INSTALL_DIR="$HOME/.local/share/newsbar" \
NEWSBAR_DRY_RUN=1 \
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/dannylee1020/newsbar/main/install.sh)"
```

Other controls:

- `NEWSBAR_REPOSITORY` — source repository, default `dannylee1020/newsbar`.
- `NEWSBAR_REF_TYPE` — `heads` or `tags`, default `heads`.
- `NEWSBAR_CLAUDE_FORCE=1` — explicitly replace a foreign Claude status line.
- `NEWSBAR_CLAUDE_SETTINGS` — alternate Claude settings file.
- `NEWSBAR_OPENCODE_CONFIG` — alternate OpenCode `tui.json` file.
- `NEWSBAR_PI_PROJECT=1` — install Pi into the current project with `pi install -l` instead of user scope.
- `NEWSBAR_INSTALL_HOSTS=claude,opencode,pi` — limit/override host detection for testing.

The default `main` archive is mutable. Pin a tag, commit archive URL, or trusted fork when reproducibility matters. The installer stages and builds before changing host configuration, keeps a timestamped previous install, and reports restoration paths.

Exit codes:

- `0` — every detected compatible host installed successfully, or dry run completed.
- `1` — at least one detected host installation failed.
- `2` — prerequisites missing, no supported host detected, or no compatible host available.

## Supported hosts

- **Claude Code:** command status line, installed through the built CLI.
- **OpenCode:** native TUI plugin using the `app_bottom` slot; requires OpenCode `>=1.18.4 <2`.
- **Pi:** local package using a below-editor widget; tested with Pi `0.81.1` and Node `>=22.19.0`.

Codex and tmux are intentionally not part of v0.

## Sources

Exactly these unauthenticated RSS/XML feeds are used:

- Hacker News — `tech` — <https://news.ycombinator.com/rss>
- TechCrunch — `tech` — <https://techcrunch.com/feed/>
- Yahoo Finance — `finance` — <https://finance.yahoo.com/news/rssindex>
- NPR — `general` — <https://feeds.npr.org/1001/rss.xml>

Newsbar retains headline metadata only: title, article URL, source, category, and timestamps. It does not scrape pages, retrieve article bodies, use API keys, send telemetry, or add headlines to model context.

## Manual/local development

```bash
npm install
npm run check
npm pack --dry-run
```

Build output is generated in `dist/`. The package is private and is not published by this repository.

### Claude Code

```bash
node dist/cli/index.js install claude
# Explicitly replace another status line only when intended:
node dist/cli/index.js install claude --force
```

The installer creates `<settings>.newsbar.bak`, preserves unrelated settings/hooks, and refuses a non-Newsbar status line without `--force`. Set `NEWSBAR_CLAUDE_SETTINGS` for a temporary test file.

### OpenCode

The source installer writes the stable TUI module path to the global `tui.json` configuration using a JSONC-aware, backup-safe edit. Set `NEWSBAR_OPENCODE_CONFIG` to test another file. The row is visible only for the current session while OpenCode reports `busy` or `retry`.

### Pi

The source installer invokes `pi install <stable-install-dir>` at user scope. Set `NEWSBAR_PI_PROJECT=1` for `pi install -l` project scope. Pi owns its settings format; Newsbar does not edit Pi settings directly.

## Runtime behavior

- Feeds refresh concurrently with a five-second timeout, RSS/XML `Accept`, descriptive `User-Agent`, and a one MiB response limit.
- A failed source does not discard healthy sources or last-good data.
- Rotation is deterministic: the headline changes every eight seconds without writing an index on every tick.
- Claude status invocations return cached/loading output immediately; refresh happens in at most one bounded worker.
- `NEWSBAR_OFFLINE=1` or `PI_OFFLINE=1` can suppress network requests in host integrations.
- Cache state is stored under `NEWSBAR_CACHE_DIR`, `XDG_CACHE_HOME/newsbar`, `%LOCALAPPDATA%/newsbar`, or `~/.cache/newsbar` depending on platform.

To restore Claude settings, stop Claude Code and replace the settings file with its `.newsbar.bak` copy. Remove the stable Newsbar install directory only after removing host registrations.

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
