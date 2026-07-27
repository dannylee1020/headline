#!/bin/sh
# Headline source-build installer.
# Usage: curl -fsSL https://raw.githubusercontent.com/dannylee1020/headline/main/install.sh | sh
set -u

REPOSITORY=dannylee1020/headline
REF=main
REF_TYPE=heads
HOME_DIR=${HOME:-}
HEADLINE_HOME=${HEADLINE_HOME:-${HOME_DIR:+$HOME_DIR/.headline}}
INSTALL_DIR=${HEADLINE_HOME:+$HEADLINE_HOME/app}
INSTALL_DIR=${INSTALL_DIR:-$HOME_DIR/.headline/app}
LAUNCHER_PATH=${HEADLINE_HOME:+$HEADLINE_HOME/bin/headline}
LAUNCHER_PATH=${LAUNCHER_PATH:-$HOME_DIR/.headline/bin/headline}

work_dir=
current_ready=
launcher_tmp=
claude_cmd=
opencode_cmd=
pi_cmd=
detected_count=0
failed_count=0
failed_hosts=
unsupported_hosts=

say() {
  printf '%s\n' "$*"
}
success() {
  say "  ✓ $*"
}
failure() {
  say "  ✗ $*"
}
first_word() {
  set -- $1
  printf '%s' "${1:-unknown}"
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

record_failed() {
  failed_count=$((failed_count + 1))
  failed_hosts="${failed_hosts}${failed_hosts:+, }$1"
}

validate_paths() {
  [ -n "$HOME_DIR" ] || fail "HOME must be set for a user-local installation"
  case "$HEADLINE_HOME" in
    ""|/|"$HOME_DIR"|.) fail "HEADLINE_HOME must be a dedicated user-local directory" ;;
    /*) ;;
    *) fail "HEADLINE_HOME must be an absolute path: $HEADLINE_HOME" ;;
  esac
  case "$INSTALL_DIR" in
    ""|/|"$HOME_DIR"|.) fail "Headline application directory must be a dedicated user-local directory" ;;
    /*) ;;
    *) fail "Headline application directory must be an absolute path: $INSTALL_DIR" ;;
  esac
  if [ "$INSTALL_DIR" = "$PWD" ]; then
    fail "Headline application directory must not be the current working directory"
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
  if has_command claude; then
    claude_cmd=$(command -v claude)
    claude_version=$(claude --version 2>/dev/null || true)
    detected_count=$((detected_count + 1))
    success "Claude Code $(first_word "$claude_version")"
  fi

  if has_command opencode; then
    opencode_cmd=$(command -v opencode)
    opencode_version=$(opencode --version 2>/dev/null || true)
    if version_at_least "$opencode_version" "1.18.4"; then
      detected_count=$((detected_count + 1))
      success "OpenCode $(first_word "$opencode_version")"
    else
      unsupported_hosts="${unsupported_hosts}${unsupported_hosts:+, }OpenCode ${opencode_version:-unknown} (<1.18.4)"
      say "  ! OpenCode $(first_word "$opencode_version") requires 1.18.4 or newer"
      opencode_cmd=
    fi
  fi

  if has_command pi; then
    pi_cmd=$(command -v pi)
    pi_version=$(pi --version 2>/dev/null || true)
    if version_at_least "$pi_version" "0.81.1"; then
      detected_count=$((detected_count + 1))
      success "Pi $(first_word "$pi_version")"
    else
      unsupported_hosts="${unsupported_hosts}${unsupported_hosts:+, }Pi ${pi_version:-unknown} (<0.81.1)"
      say "  ! Pi $(first_word "$pi_version") requires 0.81.1 or newer"
      pi_cmd=
    fi
  fi
}

archive_url() {
  printf 'https://codeload.github.com/%s/tar.gz/refs/%s/%s' "$REPOSITORY" "$REF_TYPE" "$REF"
}

build_staging() {
  parent=$(dirname "$INSTALL_DIR")
  mkdir -p "$parent" || abort_install "cannot create install parent: $parent"
  work_dir="$parent/.headline-work.$$"
  if [ -e "$work_dir" ]; then abort_install "staging path already exists: $work_dir"; fi
  mkdir -p "$work_dir/extracted" || abort_install "cannot create staging directory"
  archive="$work_dir/source.tar.gz"
  url=$(archive_url)
  curl -fsSL --retry 3 --retry-delay 1 --location --proto '=https' --tlsv1.2 "$url" -o "$archive" || abort_install "source archive download failed"
  tar -xzf "$archive" -C "$work_dir/extracted" || abort_install "source archive extraction failed"
  success "Source downloaded"

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

  build_log="$work_dir/build.log"
  if (cd "$source_root" && npm ci --no-audit --no-fund && npm run --silent build) >"$build_log" 2>&1; then
    success "Application built"
  else
    cat "$build_log" >&2
    abort_install "source build failed; existing install was not changed"
  fi
  [ -f "$source_root/dist/cli/index.js" ] || abort_install "build did not produce the Headline CLI"
  [ -f "$source_root/dist/adapters/pi/index.js" ] || abort_install "build did not produce the Pi adapter"
  [ -f "$source_root/dist/adapters/opencode/index.js" ] || abort_install "build did not produce the OpenCode adapter"
  node "$source_root/dist/cli/index.js" doctor >/dev/null \
    || abort_install "built CLI entrypoint smoke failed"
  node --input-type=module -e 'await import(process.argv[1]); await import(process.argv[2])' \
    "$source_root/dist/adapters/pi/index.js" "$source_root/dist/adapters/opencode/index.js" \
    || abort_install "built adapter entrypoint import failed"

  current_ready="$parent/.headline-ready.$$"
  if [ -e "$current_ready" ]; then abort_install "ready path already exists: $current_ready"; fi
  mv "$source_root" "$current_ready" || abort_install "cannot prepare built install"
}

promote() {
  if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR" || abort_install "cannot replace existing install at $INSTALL_DIR"
  fi
  if mv "$current_ready" "$INSTALL_DIR"; then
    current_ready=
  else
    abort_install "cannot install application at $INSTALL_DIR"
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
    printf 'exec %s %s "$@"\n' "$(shell_quote "$node_path")" "$(shell_quote "$cli_path")"
  } > "$launcher_tmp" || abort_install "cannot write launcher: $LAUNCHER_PATH"
  chmod 755 "$launcher_tmp" || abort_install "cannot make launcher executable: $LAUNCHER_PATH"
  mv -f "$launcher_tmp" "$LAUNCHER_PATH" || abort_install "cannot install launcher: $LAUNCHER_PATH"
  launcher_tmp=
}

install_claude() {
  node "$INSTALL_DIR/dist/cli/index.js" install claude --launcher "$LAUNCHER_PATH"
}

install_opencode() {
  node "$INSTALL_DIR/dist/cli/index.js" install opencode --plugin-path "$INSTALL_DIR/dist/adapters/opencode/index.js"
}

install_pi() {
  node "$INSTALL_DIR/dist/cli/index.js" install pi --path "$INSTALL_DIR"
}

run_hosts() {
  if [ -n "$claude_cmd" ]; then
    if install_claude >/dev/null; then success "Claude Code connected"; else record_failed "Claude Code"; failure "Claude Code"; fi
  fi
  if [ -n "$opencode_cmd" ]; then
    if install_opencode >/dev/null; then success "OpenCode connected"; else record_failed OpenCode; failure "OpenCode"; fi
  fi
  if [ -n "$pi_cmd" ]; then
    if install_pi >/dev/null; then success "Pi connected"; else record_failed Pi; failure "Pi"; fi
  fi
}

validate_paths
check_tools
say "Headline"
say ""
say "Agents"
detect_hosts

if [ "$detected_count" -eq 0 ]; then
  say "  ! No supported agent found"
  say "    Install Claude Code, OpenCode 1.18.4+, or Pi 0.81.1+, then retry."
  exit 2
fi

say ""
say "Installing"
build_staging
promote
write_launcher
success "Application installed"
run_hosts

say ""
if [ "$failed_count" -gt 0 ]; then
  say "Installed with errors"
  say "  $HEADLINE_HOME"
  say "  Failed: $failed_hosts"
  exit 1
fi
say "Installed"
say "  $HEADLINE_HOME"
if [ -n "$unsupported_hosts" ]; then
  say "  Skipped: $unsupported_hosts"
fi
exit 0
