#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${SPARK_WIN_EXT_DIR:-/mnt/c/temp/spark-curiosity-extension}"
SYNC_MARKER="$ROOT_DIR/.spark-last-sync-dir"

if [[ ! -d /mnt/c ]] && [[ -z "${SPARK_WIN_EXT_DIR:-}" ]]; then
  TARGET_DIR="/tmp/spark-curiosity-extension"
  echo "WARN: /mnt/c nicht gefunden. Fallback nach $TARGET_DIR"
fi

mkdir -p "$TARGET_DIR"
mkdir -p "$TARGET_DIR/dist"

if ! touch "$TARGET_DIR/.spark-write-test" >/dev/null 2>&1; then
  if [[ -z "${SPARK_WIN_EXT_DIR:-}" ]]; then
    TARGET_DIR="/tmp/spark-curiosity-extension"
    echo "WARN: Ziel nicht beschreibbar. Fallback nach $TARGET_DIR"
    mkdir -p "$TARGET_DIR/dist"
  else
    echo "ERROR: Zielordner nicht beschreibbar: $TARGET_DIR"
    exit 1
  fi
fi
rm -f "$TARGET_DIR/.spark-write-test" >/dev/null 2>&1 || true

# Remove stale root-level JS files from older layouts (best-effort on /mnt/c).
rm -f "$TARGET_DIR/background.js" "$TARGET_DIR/content.js" >/dev/null 2>&1 || true
# Keep manifest/readme, but replace extension runtime artifacts (best-effort cleanup).
rm -rf "$TARGET_DIR/dist" >/dev/null 2>&1 || true
mkdir -p "$TARGET_DIR/dist"

cp "$ROOT_DIR/apps/extension/manifest.json" "$TARGET_DIR/manifest.json"

# Prefer direct workspace build output (apps/extension/dist) over nested paths
EXT_BUILD_DIR="$ROOT_DIR/apps/extension/dist"
if [[ ! -f "$EXT_BUILD_DIR/background.js" || ! -f "$EXT_BUILD_DIR/content.js" ]]; then
  EXT_BUILD_DIR="$ROOT_DIR/apps/extension/dist/apps/extension/src"
fi
if [[ ! -f "$EXT_BUILD_DIR/background.js" || ! -f "$EXT_BUILD_DIR/content.js" ]]; then
  EXT_BUILD_DIR="$ROOT_DIR/dist/apps/extension/src"
fi
if [[ ! -f "$EXT_BUILD_DIR/background.js" || ! -f "$EXT_BUILD_DIR/content.js" ]]; then
  EXT_BUILD_DIR="$ROOT_DIR/dist"
fi
if [[ ! -f "$EXT_BUILD_DIR/background.js" || ! -f "$EXT_BUILD_DIR/content.js" ]]; then
  echo "ERROR: No valid extension build artifacts found."
  echo "Tried: apps/extension/dist/apps/extension/src, apps/extension/dist, dist/apps/extension/src, dist"
  exit 1
fi

cp "$EXT_BUILD_DIR/background.js" "$TARGET_DIR/dist/background.js"
cp "$EXT_BUILD_DIR/content.js" "$TARGET_DIR/dist/content.js"

cat > "$TARGET_DIR/README_SYNC.txt" <<EOF
Spark Curiosity Extension Build (auto-synced from WSL)

Quelle: $ROOT_DIR
Aktualisiert: $(date -Iseconds)

In Chrome laden:
chrome://extensions -> Developer mode -> Load unpacked -> dieser Ordner
EOF

printf '%s\n' "$TARGET_DIR" > "$SYNC_MARKER"
echo "Extension synced to: $TARGET_DIR"
