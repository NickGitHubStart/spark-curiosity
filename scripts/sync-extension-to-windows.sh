#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${SPARK_WIN_EXT_DIR:-/mnt/c/temp/spark-curiosity-extension}"

if [[ ! -d /mnt/c ]]; then
  echo "ERROR: /mnt/c nicht gefunden. Dieses Script ist fuer WSL -> Windows Sync gedacht."
  exit 1
fi

mkdir -p "$TARGET_DIR"
mkdir -p "$TARGET_DIR/dist"

cp "$ROOT_DIR/apps/extension/manifest.json" "$TARGET_DIR/manifest.json"

EXT_BUILD_DIR="$ROOT_DIR/dist/apps/extension/src"
if [[ -f "$EXT_BUILD_DIR/background.js" && -f "$EXT_BUILD_DIR/content.js" ]]; then
  cp "$EXT_BUILD_DIR/background.js" "$TARGET_DIR/dist/background.js"
  cp "$EXT_BUILD_DIR/content.js" "$TARGET_DIR/dist/content.js"
else
  # Fallback for legacy build layouts.
  cp "$ROOT_DIR/dist/background.js" "$TARGET_DIR/dist/background.js"
  cp "$ROOT_DIR/dist/content.js" "$TARGET_DIR/dist/content.js"
fi

cat > "$TARGET_DIR/README_SYNC.txt" <<EOF
Spark Curiosity Extension Build (auto-synced from WSL)

Quelle: $ROOT_DIR
Aktualisiert: $(date -Iseconds)

In Chrome laden:
chrome://extensions -> Developer mode -> Load unpacked -> dieser Ordner
EOF

echo "Extension synced to: $TARGET_DIR"
