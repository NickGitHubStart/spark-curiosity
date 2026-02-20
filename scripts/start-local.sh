#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${SPARK_COMPANION_PORT:-4343}"
HOST="${SPARK_COMPANION_HOST:-0.0.0.0}"
BASE_URL="http://127.0.0.1:${PORT}"
PID_FILE="/tmp/spark-curiosity-companion-${PORT}.pid"
LOG_FILE="/tmp/spark-curiosity-companion-${PORT}.log"
WIN_EXT_DIR="${SPARK_WIN_EXT_DIR:-/mnt/c/temp/spark-curiosity-extension}"
SYNC_MARKER="$ROOT_DIR/.spark-last-sync-dir"

log() {
  printf '[start-local] %s\n' "$1"
}

fail() {
  printf '[start-local] ERROR: %s\n' "$1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command missing: $1"
}

try_open_debug_ui() {
  local url="$1"
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Start-Process '$url'" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /C start "" "$url" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

http_ok() {
  curl -fsS "$1" >/dev/null 2>&1
}

kill_existing_pid_file() {
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" || true)"
    if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      log "Stopping previous companion process from pid file ($old_pid)"
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 1
      if kill -0 "$old_pid" >/dev/null 2>&1; then
        kill -9 "$old_pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$PID_FILE"
  fi
}

wait_for_health() {
  local attempts=40
  local i
  for ((i=1; i<=attempts; i++)); do
    if http_ok "${BASE_URL}/health"; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

assert_extension_artifacts() {
  local src_dir="$ROOT_DIR/apps/extension/dist"
  [[ -f "$src_dir/background.js" ]] || src_dir="$ROOT_DIR/apps/extension/dist/apps/extension/src"
  [[ -f "$src_dir/background.js" ]] || fail "Missing source background artifact (tried apps/extension/dist and .../dist/apps/extension/src)"
  local dst_dir="$WIN_EXT_DIR/dist"

  [[ -f "$dst_dir/background.js" ]] || fail "Missing synced background artifact at $dst_dir/background.js"
  [[ -f "$dst_dir/content.js" ]] || fail "Missing synced content artifact at $dst_dir/content.js"

  rg -n "spark_companion_request" "$dst_dir/background.js" >/dev/null || fail "Synced background.js does not contain spark_companion_request"
  (rg -n "spark_companion_request" "$dst_dir/content.js" >/dev/null || rg -n "requestCompanion" "$dst_dir/content.js" >/dev/null) || fail "Synced content.js missing companion bridge"
  (rg -n "content_script_initialized" "$dst_dir/content.js" >/dev/null || rg -n "content_script" "$dst_dir/content.js" >/dev/null) || true

  if [[ -f "$WIN_EXT_DIR/background.js" || -f "$WIN_EXT_DIR/content.js" ]]; then
    log "Warning: stale root-level JS files exist in $WIN_EXT_DIR (background.js/content.js)."
    log "Warning: they are ignored by current manifest (uses dist/*), but can be deleted manually."
  fi
}

require_cmd npm
require_cmd node
require_cmd curl
require_cmd rg

log "Step 1/7: Building companion"
npm run build -w @spark/companion

log "Step 2/7: Building extension + syncing to Windows"
npm run build:win-ext
if [[ -f "$SYNC_MARKER" ]]; then
  WIN_EXT_DIR="$(cat "$SYNC_MARKER")"
fi

log "Step 3/7: Verifying synced extension artifacts"
assert_extension_artifacts

log "Step 4/7: Stopping previous companion (if any)"
kill_existing_pid_file

if http_ok "${BASE_URL}/health"; then
  fail "Port ${PORT} already serves a process that is not managed by this script. Stop it first."
fi

log "Step 5/7: Starting companion on ${HOST}:${PORT}"
SPARK_COMPANION_HOST="$HOST" SPARK_COMPANION_PORT="$PORT" node dist/apps/companion/src/index.js >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

if ! wait_for_health; then
  log "Companion failed to become healthy. Recent log output:"
  tail -n 80 "$LOG_FILE" || true
  fail "Companion did not start correctly."
fi

log "Step 6/7: Running smoke checks"
RUNTIME_JSON="$(curl -fsS "${BASE_URL}/debug/runtime")"
HEALTH_JSON="$(curl -fsS "${BASE_URL}/health")"
printf '%s\n' "$RUNTIME_JSON" | rg -n "buildId|runtimeId|pid" >/dev/null || fail "debug/runtime response malformed"
printf '%s\n' "$HEALTH_JSON" | rg -n "\"ok\":true|\"ok\": true" >/dev/null || fail "health response malformed"

log "Step 7/7: Opening debug UI"
DEBUG_URL="${BASE_URL}/debug/ui"
if try_open_debug_ui "$DEBUG_URL"; then
  log "Debug UI opened: $DEBUG_URL"
else
  log "Could not auto-open browser. Open manually: $DEBUG_URL"
fi

log "Ready."
log "Companion PID: $(cat "$PID_FILE")"
log "Companion log: $LOG_FILE"
log "Extension folder for Chrome Load Unpacked: $WIN_EXT_DIR"
log "Runtime: $RUNTIME_JSON"
