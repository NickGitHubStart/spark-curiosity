#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT_DIR/.env"
  set +a
fi

PORT="${SPARK_COMPANION_PORT:-4343}"
HOST="${SPARK_COMPANION_HOST:-0.0.0.0}"
BASE_URL="http://127.0.0.1:${PORT}"
PID_FILE="/tmp/spark-curiosity-companion-${PORT}.pid"
LOG_FILE="/tmp/spark-curiosity-companion-${PORT}.log"

log() { printf '[start-desktop] %s\n' "$1"; }
fail() { printf '[start-desktop] ERROR: %s\n' "$1" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Required command missing: $1"; }

http_ok() { curl -fsS "$1" >/dev/null 2>&1; }

wait_for_health() {
  local attempts=50
  local i
  for ((i=1; i<=attempts; i++)); do
    if http_ok "${BASE_URL}/health"; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

kill_existing_pid_file() {
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" || true)"
    if [[ -n "${old_pid}" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      log "Stopping previous companion process ($old_pid)"
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 1
      kill -9 "$old_pid" >/dev/null 2>&1 || true
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
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
    sleep 1
    for pid in $pids; do kill -9 "$pid" 2>/dev/null || true; done
  fi
}

check_platform_requirements() {
  case "$(uname -s)" in
    Linux)
      if ! command -v xdotool >/dev/null 2>&1; then
        log "Warning: xdotool fehlt. Aktives Fenster kann sonst nicht zuverlässig gelesen werden."
        log "Installiere: sudo apt-get install xdotool"
      fi
      if ! command -v xdg-open >/dev/null 2>&1; then
        log "Warning: xdg-open fehlt. Redirects können dann nicht geöffnet werden."
      fi
      ;;
    Darwin)
      if ! command -v osascript >/dev/null 2>&1; then
        log "Warning: osascript fehlt. Aktives Fenster/Tabs können dann nicht gelesen werden."
      fi
      ;;
    *)
      # Windows/andere: Desktop-Agent nutzt PowerShell/cmd fallback.
      ;;
  esac
}

cleanup() {
  if [[ -n "${DESKTOP_PID:-}" ]] && kill -0 "$DESKTOP_PID" >/dev/null 2>&1; then
    kill "$DESKTOP_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

require_cmd npm
require_cmd node
require_cmd curl

check_platform_requirements

log "Step 1/4: Build companion + desktop-agent"
npm run build -w @spark/companion
npm run build -w @spark/desktop-agent

log "Step 2/4: Restart companion"
kill_existing_pid_file
if http_ok "${BASE_URL}/health"; then
  kill_process_on_port
fi

SPARK_COMPANION_HOST="$HOST" \
SPARK_COMPANION_PORT="$PORT" \
node dist/apps/companion/src/index.js >"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

if ! wait_for_health; then
  tail -n 100 "$LOG_FILE" || true
  fail "Companion did not become healthy on ${BASE_URL}"
fi

log "Step 3/4: Companion healthy at ${BASE_URL}"
log "Step 4/4: Start desktop agent (Ctrl+C to stop both)"
SPARK_COMPANION_URL="$BASE_URL" npm run dev -w @spark/desktop-agent &
DESKTOP_PID=$!

wait "$DESKTOP_PID"
