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

kill_process_on_port() {
  local pids
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti :${PORT} 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${PORT}/tcp" 2>&1 | sed 's/^[^:]*: *//' || true)"
  else
    return 0
  fi
  if [[ -n "${pids}" ]]; then
    log "Stopping process(es) on port ${PORT}: ${pids}"
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
    done
    sleep 1
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 0.5
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

  rg -n "spark_bridge" "$dst_dir/background.js" >/dev/null || fail "Synced background.js does not contain spark_bridge handler"
  rg -n "spark_bridge" "$dst_dir/content.js" >/dev/null || fail "Synced content.js missing spark_bridge bridge call"
  rg -n "content.script" "$dst_dir/content.js" >/dev/null || true

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
  log "Port ${PORT} in use; freeing port and restarting..."
  kill_process_on_port
  sleep 0.5
fi
if http_ok "${BASE_URL}/health"; then
  fail "Port ${PORT} still in use after stopping process. Stop it manually."
fi

OLLAMA_URL="${SPARK_OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
OLLAMA_TIMEOUT_MS="${SPARK_OLLAMA_TIMEOUT_MS:-180000}"
AI_PROVIDER="${SPARK_AI_PROVIDER:-ollama}"
ollama_ok() { curl -fsS "${OLLAMA_URL}/api/tags" -m 3 >/dev/null 2>&1; }

if [[ "${AI_PROVIDER,,}" == "grok" ]]; then
  log "Step 4b/7: AI provider=Grok (remote API)"
  if [[ -z "${SPARK_GROK_API_KEY:-}" ]]; then
    fail "SPARK_GROK_API_KEY is missing while SPARK_AI_PROVIDER=grok"
  else
    log "Grok API key detected."
  fi
else
  log "Step 4b/7: Ensuring Ollama is running (optional, for LLM)"
  if ollama_ok; then
    log "Ollama already running at $OLLAMA_URL"
  else
    if command -v systemctl >/dev/null 2>&1; then
      log "Trying to start Ollama via systemctl..."
      sudo -n systemctl start ollama 2>/dev/null && sleep 2 || true
    fi
    if ! ollama_ok && command -v ollama >/dev/null 2>&1; then
      log "Starting Ollama in background (ollama serve)..."
      (ollama serve >> /tmp/ollama-serve.log 2>&1 &)
      sleep 3
    fi
    if ollama_ok; then
      log "Ollama is now running at $OLLAMA_URL"
    else
      log "Ollama not available at $OLLAMA_URL — agent will show 'ollama_unavailable' until Ollama is running."
    fi
  fi
fi

log "Step 5/7: Starting companion on ${HOST}:${PORT}"
SPARK_DATA_DIR="$ROOT_DIR/apps/companion/data" SPARK_COMPANION_HOST="$HOST" SPARK_COMPANION_PORT="$PORT" SPARK_OLLAMA_TIMEOUT_MS="$OLLAMA_TIMEOUT_MS" node dist/apps/companion/src/index.js >"$LOG_FILE" 2>&1 &
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
log "AI provider: ${AI_PROVIDER}"
log "Ollama timeout: ${OLLAMA_TIMEOUT_MS}ms"
log "Extension folder for Chrome Load Unpacked: $WIN_EXT_DIR"
log "Runtime: $RUNTIME_JSON"
