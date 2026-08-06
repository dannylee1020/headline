# Configuration

Headline works without a configuration file. To customize it, create JSON at:

```text
${HEADLINE_HOME:-$HOME/.headline}/config.json
```

If `HEADLINE_HOME` is unset, the default path is `$HOME/.headline/config.json`. A legacy config at `${XDG_CONFIG_HOME:-$HOME/.config}/headline/config.json` is copied to the new location on first read when possible.

Use these commands to inspect the active configuration:

```bash
headline config path
headline config show
headline doctor
```

## Fields

| Field | Type | Default | Supported values |
| --- | --- | --- | --- |
| `sources` | object | built-in defaults | A `built-in` or `opml` source configuration |
| `visibility` | string | `working` | `working`, `always`, or `off` |
| `rotationSeconds` | number | `8` | `2` through `60` |
| `refreshMinutes` | number | `15` | `5` through `1440` |

Unknown fields and unsupported values make the configuration invalid.

## Default configuration

Omitting the file or any optional top-level field uses these settings:

```json
{
  "sources": {
    "mode": "built-in",
    "providers": {
      "axios": ["general"],
      "ap": ["general"],
      "bbc": ["general", "technology"],
      "npr": ["general", "technology"],
      "reuters": ["general"],
      "techcrunch": ["technology"],
      "yahoo-finance": ["finance"]
    }
  },
  "visibility": "working",
  "rotationSeconds": 8,
  "refreshMinutes": 15
}
```

## Built-in sources

Use `built-in` mode to select exact categories for each bundled provider:

```json
{
  "sources": {
    "mode": "built-in",
    "providers": {
      "bbc": ["technology", "sports"],
      "npr": ["technology"],
      "techcrunch": ["technology"]
    }
  }
}
```

### Built-in source fields

| Field | Required | Description |
| --- | --- | --- |
| `sources.mode` | Yes | Must be `built-in`. |
| `sources.providers` | No | Maps provider IDs to non-empty category arrays. Omit it to use all default selections. |

Omitting a provider excludes it. At least one provider and one supported category must be selected. Duplicate category values are ignored.

### Available providers and categories

| Provider ID | Name | Categories | Default categories |
| --- | --- | --- | --- |
| `axios` | Axios | `general` | `general` |
| `ap` | AP News | `general` | `general` |
| `bbc` | BBC | `general`, `world`, `uk`, `business`, `politics`, `technology`, `health`, `education`, `science`, `entertainment`, `sports` | `general`, `technology` |
| `npr` | NPR | `general`, `national`, `world`, `politics`, `business`, `economy`, `technology`, `health`, `science`, `education`, `climate`, `culture`, `sports` | `general`, `technology` |
| `reuters` | Reuters | `general` | `general` |
| `techcrunch` | TechCrunch | `technology` | `technology` |
| `yahoo-finance` | Yahoo Finance | `finance` | `finance` |

AP News and Reuters currently use unauthenticated Google News RSS queries because their publishers do not offer free public general-news RSS feeds:

- AP News: `https://news.google.com/rss/search?q=site%3Aapnews.com%20when%3A1d&hl=en-US&gl=US&ceid=US%3Aen`
- Reuters: `https://news.google.com/rss/search?q=site%3Areuters.com%20when%3A1d&hl=en-US&gl=US&ceid=US%3Aen`

Run `headline sources` to inspect the registry supported by the installed build.

## OPML sources

Use `opml` mode to load subscriptions exported by an RSS reader:

```json
{
  "sources": {
    "mode": "opml",
    "path": "~/path/to/subscriptions.opml"
  },
  "visibility": "working",
  "rotationSeconds": 8,
  "refreshMinutes": 15
}
```

### OPML source fields

| Field | Required | Description |
| --- | --- | --- |
| `sources.mode` | Yes | Must be `opml`. |
| `sources.path` | Yes | Path to a local OPML file. `~/...` paths are supported; relative paths resolve beside `config.json`. |

`built-in` and `opml` modes are mutually exclusive. An OPML configuration cannot include `sources.providers`, and a built-in configuration cannot include `sources.path`.

OPML provides feed URLs, names, and folders. Headline fetches the RSS or Atom feeds independently at `refreshMinutes`; it does not import downloaded articles, unread state, starred state, credentials, or reader-specific filters. Re-export the file when the reader's subscriptions or folders change.

Validate an export before using it:

```bash
headline opml inspect ~/path/to/subscriptions.opml
```

## Visibility

| Value | Behavior |
| --- | --- |
| `working` | Show a headline only while the host reports active work. |
| `always` | Keep a headline visible for the host session. |
| `off` | Disable the headline display. |

`rotationSeconds` controls how often the displayed cached headline changes. `refreshMinutes` controls how often Headline polls the selected feeds; rotating a headline does not make a network request.

## Applying changes

Claude Code reads configuration for each status invocation. Restart Pi or OpenCode after changing source selection, names, or folders. Run `headline refresh` to fetch the selected feeds immediately instead of waiting for the next refresh interval.

## Invalid configuration

Run `headline doctor` to see parsing errors, OPML warnings, the effective source mode, and the selected feed count.

Invalid JSON, unknown fields, or unsupported built-in selections fall back to the built-in defaults so a host integration is not interrupted. A valid `opml` configuration with a missing or invalid file stays in OPML mode and returns no built-in fallback headlines.
