#!/bin/sh
# Headline source-build installer.
# Usage: curl -fsSL https://raw.githubusercontent.com/dannylee1020/headline/main/install.sh | sh
set -u

REPOSITORY=${HEADLINE_REPOSITORY:-dannylee1020/headline}
REF=${HEADLINE_REF:-main}
REF_TYPE=${HEADLINE_REF_TYPE:-heads}
ARCHIVE_URL=${HEADLINE_ARCHIVE_URL:-}
HOME_DIR=${HOME:-}
HEADLINE_HOME=${HEADLINE_HOME:-${HOME_DIR:+$HOME_DIR/.headline}}
INSTALL_DIR=${HEADLINE_INSTALL_DIR:-${HEADLINE_HOME:+$HEADLINE_HOME/app}}
INSTALL_DIR=${INSTALL_DIR:-$HOME_DIR/.headline/app}
LAUNCHER_PATH=${HEADLINE_HOME:+$HEADLINE_HOME/bin/headline}
LAUNCHER_PATH=${LAUNCHER_PATH:-$HOME_DIR/.headline/bin/headline}
DRY_RUN=${HEADLINE_DRY_RUN:-0}
REQUESTED_HOSTS=${HEADLINE_INSTALL_HOSTS:-}
CLAUDE_FORCE=${HEADLINE_CLAUDE_FORCE:-0}
PI_PROJECT=${HEADLINE_PI_PROJECT:-0}

work_dir=
current_ready=
launcher_tmp=
claude_cmd=
opencode_cmd=
pi_cmd=
detected_count=0
installed_count=0
failed_count=0
unsupported_count=0
no_host_count=0
failed_hosts=
installed_hosts=
unsupported_hosts=

say() {
  printf '%s\n' "$*"
}
shell_quote() {
  value=$1
  value=$(printf '%s' "$value" | sed "s/'/'\\\\''/g")
  printf "'%s'" "$value"
}
warn() {
  printf 'headline installer: %s\n' "$*" >&2
}
fail() {
  warn "$*"
  exit 2
}
abort_install() {
  warn "$*"
  exit 1
}

cleanup() {
  if [ -n "${work_dir:-}" ] && [ -d "$work_dir" ]; then
    rm -rf "$work_dir"
  fi
  if [ -n "${launcher_tmp:-}" ] && [ -e "$launcher_tmp" ]; then
    rm -f "$launcher_tmp"
  fi
}
trap cleanup EXIT HUP INT TERM

has_command() {
  command -v "$1" >/dev/null 2>&1
}

requested_host() {
  if [ -z "$REQUESTED_HOSTS" ]; then
    return 0
  fi
  case ",$REQUESTED_HOSTS," in
    *,"$1",*) return 0 ;;
    *) return 1 ;;
  esac
}

version_at_least() {
  node_version=$1
  minimum=$2
  node -e '
    const parse = (value) => {
      const match = String(value).match(/([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?/);
      if (!match) process.exit(2);
      return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
    };
    const a = parse(process.argv[1]);
    const b = parse(process.argv[2]);
    const ok = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
    process.exit(ok ? 0 : 1);
  ' "$node_version" "$minimum" >/dev/null 2>&1
}

record_installed() {
  installed_count=$((installed_count + 1))
  installed_hosts="${installed_hosts}${installed_hosts:+, }$1"
}
record_failed() {
  failed_count=$((failed_count + 1))
  failed_hosts="${failed_hosts}${failed_hosts:+, }$1"
}
record_unsupported() {
  unsupported_count=$((unsupported_count + 1))
  unsupported_hosts="${unsupported_hosts}${unsupported_hosts:+, }$1"
}

validate_paths() {
  [ -n "$HOME_DIR" ] || fail "HOME must be set for a user-local installation"
  case "$HEADLINE_HOME" in
    ""|/|"$HOME_DIR"|.) fail "HEADLINE_HOME must be a dedicated user-local directory" ;;
    /*) ;;
    *) fail "HEADLINE_HOME must be an absolute path: $HEADLINE_HOME" ;;
  esac
  case "$INSTALL_DIR" in
    ""|/|"$HOME_DIR"|.) fail "HEADLINE_INSTALL_DIR must be a dedicated user-local directory" ;;
    /*) ;;
    *) fail "HEADLINE_INSTALL_DIR must be an absolute path: $INSTALL_DIR" ;;
  esac
  if [ "$INSTALL_DIR" = "$PWD" ]; then
    fail "HEADLINE_INSTALL_DIR must not be the current working directory"
  fi
}

check_tools() {
  missing=
  for tool in curl tar node npm; do
    if ! has_command "$tool"; then
      missing="${missing}${missing:+, }$tool"
    fi
  done
  [ -z "$missing" ] || fail "missing required command(s): $missing"
  node_version=$(node --version 2>/dev/null || true)
  version_at_least "$node_version" "22.19.0" || fail "Node >=22.19.0 is required; detected ${node_version:-unknown}"
}

detect_hosts() {
  if requested_host claude && has_command claude; then
    claude_cmd=$(command -v claude)
    claude_version=$(claude --version 2>/dev/null || true)
    detected_count=$((detected_count + 1))
    say "Detected Claude Code: $claude_cmd ${claude_version}"
  elif requested_host claude; then
    no_host_count=$((no_host_count + 1))
  fi

  if requested_host opencode && has_command opencode; then
    opencode_cmd=$(command -v opencode)
    opencode_version=$(opencode --version 2>/dev/null || true)
    if version_at_least "$opencode_version" "1.18.4"; then
      detected_count=$((detected_count + 1))
      say "Detected OpenCode: $opencode_cmd ${opencode_version}"
    else
      unsupported_count=$((unsupported_count + 1))
      unsupported_hosts="${unsupported_hosts}${unsupported_hosts:+, }OpenCode ${opencode_version:-unknown} (<1.18.4)"
      warn "OpenCode ${opencode_version:-unknown} is unsupported; Headline requires >=1.18.4"
      opencode_cmd=
    fi
  elif requested_host opencode; then
    no_host_count=$((no_host_count + 1))
  fi

  if requested_host pi && has_command pi; then
    pi_cmd=$(command -v pi)
    pi_version=$(pi --version 2>/dev/null || true)
    if version_at_least "$pi_version" "0.81.1"; then
      detected_count=$((detected_count + 1))
      say "Detected Pi: $pi_cmd ${pi_version}"
    else
      unsupported_count=$((unsupported_count + 1))
      unsupported_hosts="${unsupported_hosts}${unsupported_hosts:+, }Pi ${pi_version:-unknown} (<0.81.1)"
      warn "Pi ${pi_version:-unknown} is unsupported; Headline requires >=0.81.1"
      pi_cmd=
    fi
  elif requested_host pi; then
    no_host_count=$((no_host_count + 1))
  fi
}

archive_url() {
  if [ -n "$ARCHIVE_URL" ]; then
    case "$ARCHIVE_URL" in
      https://*) printf '%s' "$ARCHIVE_URL" ;;
      *) abort_install "HEADLINE_ARCHIVE_URL must use HTTPS" ;;
    esac
  else
    case "$REF_TYPE" in
      heads|tags) ;;
      *) abort_install "HEADLINE_REF_TYPE must be heads or tags" ;;
    esac
    printf 'https://codeload.github.com/%s/tar.gz/refs/%s/%s' "$REPOSITORY" "$REF_TYPE" "$REF"
  fi
}

build_staging() {
  parent=$(dirname "$INSTALL_DIR")
  mkdir -p "$parent" || abort_install "cannot create install parent: $parent"
  work_dir="$parent/.headline-work.$$"
  if [ -e "$work_dir" ]; then abort_install "staging path already exists: $work_dir"; fi
  mkdir -p "$work_dir/extracted" || abort_install "cannot create staging directory"
  archive="$work_dir/source.tar.gz"
  url=$(archive_url)
  warn "Downloading source archive from $url"
  curl -fsSL --retry 3 --retry-delay 1 --location --proto '=https' --tlsv1.2 "$url" -o "$archive" || abort_install "source archive download failed"
  tar -xzf "$archive" -C "$work_dir/extracted" || abort_install "source archive extraction failed"

  source_root=
  for candidate in "$work_dir"/extracted/*; do
    if [ -f "$candidate/package.json" ]; then
      source_root=$candidate
      break
    fi
  done
  [ -n "$source_root" ] || abort_install "source archive did not contain a repository package.json"
  [ -f "$source_root/package-lock.json" ] || abort_install "source archive did not contain package-lock.json"
  [ -f "$source_root/tsconfig.build.json" ] || abort_install "source archive did not contain the build configuration"
  [ -f "$source_root/install.sh" ] || abort_install "source archive did not contain install.sh"

  warn "Installing locked dependencies and building Headline"
  (cd "$source_root" && npm ci --no-audit --no-fund && npm run build) || abort_install "source build failed; existing install was not changed"
  [ -f "$source_root/dist/cli/index.js" ] || abort_install "build did not produce the Headline CLI"
  [ -f "$source_root/dist/adapters/pi/index.js" ] || abort_install "build did not produce the Pi adapter"
  [ -f "$source_root/dist/adapters/opencode/index.js" ] || abort_install "build did not produce the OpenCode adapter"
  node --input-type=module -e 'await import(process.argv[1]); await import(process.argv[2]); await import(process.argv[3])' \
    "$source_root/dist/cli/index.js" "$source_root/dist/adapters/pi/index.js" "$source_root/dist/adapters/opencode/index.js" \
    || abort_install "built adapter entrypoint import failed"

  current_ready="$parent/.headline-ready.$$"
  if [ -e "$current_ready" ]; then abort_install "ready path already exists: $current_ready"; fi
  mv "$source_root" "$current_ready" || abort_install "cannot prepare built install"
}

promote() {
  backup_path="${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S 2>/dev/null || printf '%s' "$$")"
  if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
    mv "$INSTALL_DIR" "$backup_path" || abort_install "cannot preserve existing install at $backup_path"
  fi
  if mv "$current_ready" "$INSTALL_DIR"; then
    current_ready=
    say "Installed Headline application at $INSTALL_DIR"
    if [ -e "$backup_path" ]; then say "Previous install preserved at $backup_path"; fi
  else
    if [ -e "$backup_path" ]; then mv "$backup_path" "$INSTALL_DIR" 2>/dev/null || true; fi
    abort_install "cannot promote built install; previous install was restored when possible"
  fi
}

write_launcher() {
  launcher_parent=$(dirname "$LAUNCHER_PATH")
  mkdir -p "$launcher_parent" || abort_install "cannot create launcher directory: $launcher_parent"
  launcher_tmp="$LAUNCHER_PATH.$$"
  node_path=$(command -v node)
  cli_path="$INSTALL_DIR/dist/cli/index.js"
  {
    printf '#!/bin/sh\n'
    printf 'exec %s %s "\$@"\n' "$(shell_quote "$node_path")" "$(shell_quote "$cli_path")"
  } > "$launcher_tmp" || abort_install "cannot write launcher: $LAUNCHER_PATH"
  chmod 755 "$launcher_tmp" || abort_install "cannot make launcher executable: $LAUNCHER_PATH"
  mv -f "$launcher_tmp" "$LAUNCHER_PATH" || abort_install "cannot install launcher: $LAUNCHER_PATH"
  launcher_tmp=
  say "Installed Headline CLI launcher at $LAUNCHER_PATH"
}

install_claude() {
  say "Installing Claude Code integration"
  if [ "$CLAUDE_FORCE" = "1" ] || [ "$CLAUDE_FORCE" = "true" ]; then
    HEADLINE_CLAUDE_FORCE=1
    if [ -n "${HEADLINE_CLAUDE_SETTINGS:-}" ]; then HEADLINE_CLAUDE_SETTINGS="$HEADLINE_CLAUDE_SETTINGS" node "$INSTALL_DIR/dist/cli/index.js" install claude --force --launcher "$LAUNCHER_PATH"; else node "$INSTALL_DIR/dist/cli/index.js" install claude --force --launcher "$LAUNCHER_PATH"; fi
  else
    if [ -n "${HEADLINE_CLAUDE_SETTINGS:-}" ]; then HEADLINE_CLAUDE_SETTINGS="$HEADLINE_CLAUDE_SETTINGS" node "$INSTALL_DIR/dist/cli/index.js" install claude --launcher "$LAUNCHER_PATH"; else node "$INSTALL_DIR/dist/cli/index.js" install claude --launcher "$LAUNCHER_PATH"; fi
  fi
}

install_opencode() {
  say "Installing OpenCode TUI integration"
  plugin_path="$INSTALL_DIR/dist/adapters/opencode/index.js"
  if [ -n "${HEADLINE_OPENCODE_CONFIG:-}" ]; then
    node "$INSTALL_DIR/dist/cli/index.js" install opencode --plugin-path "$plugin_path" --config "$HEADLINE_OPENCODE_CONFIG"
  else
    node "$INSTALL_DIR/dist/cli/index.js" install opencode --plugin-path "$plugin_path"
  fi
}

install_pi() {
  say "Installing Pi integration"
  if [ "$PI_PROJECT" = "1" ] || [ "$PI_PROJECT" = "true" ]; then
    node "$INSTALL_DIR/dist/cli/index.js" install pi --path "$INSTALL_DIR" --project
  else
    node "$INSTALL_DIR/dist/cli/index.js" install pi --path "$INSTALL_DIR"
  fi
}

run_hosts() {
  if [ -n "$claude_cmd" ]; then
    if install_claude; then record_installed Claude; else record_failed Claude; warn "Claude Code installation failed; continuing"; fi
  fi
  if [ -n "$opencode_cmd" ]; then
    if install_opencode; then record_installed OpenCode; else record_failed OpenCode; warn "OpenCode installation failed; continuing"; fi
  fi
  if [ -n "$pi_cmd" ]; then
    if install_pi; then record_installed Pi; else record_failed Pi; warn "Pi installation failed; continuing"; fi
  fi
}

validate_paths
check_tools
detect_hosts

if [ "$detected_count" -eq 0 ]; then
  say "No supported coding agent detected (Claude Code, OpenCode >=1.18.4, or Pi >=0.81.1)."
  say "Install one of the supported agents, then rerun this command."
  exit 2
fi

if [ "$DRY_RUN" = "1" ] || [ "$DRY_RUN" = "true" ]; then
  say "Dry run: would build at $INSTALL_DIR, create $LAUNCHER_PATH, and install detected hosts."
  exit 0
fi

build_staging
promote
write_launcher
run_hosts

say ""
say "Headline installation summary"
say "  detected/compatible: $detected_count"
say "  installed: ${installed_hosts:-none}"
say "  unsupported: ${unsupported_hosts:-none}"
say "  failed: ${failed_hosts:-none}"
if [ "$failed_count" -gt 0 ]; then
  say "One or more detected integrations failed. The Headline application is installed; rerun after fixing the reported host issue."
  exit 1
fi
say "All detected Headline integrations installed successfully."
exit 0
