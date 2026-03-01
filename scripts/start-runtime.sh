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

echo "[start-runtime] building companion + desktop-agent + desktop-runtime"
npm run build:desktop-stack

echo "[start-runtime] starting runtime host"
SPARK_ROOT_DIR="$ROOT_DIR" \
SPARK_COMPANION_HOST="${SPARK_COMPANION_HOST:-127.0.0.1}" \
SPARK_COMPANION_PORT="${SPARK_COMPANION_PORT:-4343}" \
node dist/apps/desktop-runtime/src/index.js
