#!/usr/bin/env bash
# Build desktop stack and pack a minimal Windows bundle (dist + scripts + package*.json).
# Use for install-from-wsl -UseDistBundle or for release artifacts.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
OUT_DIR="${1:-$REPO_ROOT/dist-windows-bundle}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
BUNDLE_NAME="spark-curiosity"
STAGING="$OUT_DIR/$BUNDLE_NAME"
rm -rf "$STAGING"
mkdir -p "$STAGING"

echo "[bundle] Building desktop stack..."
npm run build:desktop-stack

echo "[bundle] Copying dist + scripts + package files..."
cp -a dist "$STAGING/"
mkdir -p "$STAGING/scripts"
cp -a scripts/windows "$STAGING/scripts/"
cp package.json "$STAGING/"
[[ -f package-lock.json ]] && cp package-lock.json "$STAGING/"

# Workspace package.json only (so npm install --omit=dev works)
for w in apps/companion apps/desktop-runtime apps/extension apps/desktop-agent packages/shared; do
  if [[ -f "$w/package.json" ]]; then
    mkdir -p "$STAGING/$w"
    cp "$w/package.json" "$STAGING/$w/"
  fi
done

# Companion runtime data: templates, prompts, user-memory
if [[ -d apps/companion/data ]]; then
  cp -a apps/companion/data "$STAGING/apps/companion/"
fi
if [[ -d apps/companion/prompts ]]; then
  cp -a apps/companion/prompts "$STAGING/apps/companion/"
fi

echo "[bundle] Staging at $STAGING"
ZIP_PATH="$OUT_DIR/spark-curiosity-windows.zip"
rm -f "$ZIP_PATH"
if command -v zip >/dev/null 2>&1; then
  (cd "$OUT_DIR" && zip -r spark-curiosity-windows.zip "$BUNDLE_NAME")
elif command -v python3 >/dev/null 2>&1; then
  (cd "$OUT_DIR" && python3 -c "
import zipfile, os
with zipfile.ZipFile('spark-curiosity-windows.zip', 'w', zipfile.ZIP_DEFLATED) as z:
  for r, _, fs in os.walk('$BUNDLE_NAME'):
    for f in fs:
      path = os.path.join(r, f)
      z.write(path, path)
")
else
  echo "[bundle] Need zip or python3: sudo apt install zip" >&2
  exit 1
fi
echo "[bundle] Created $ZIP_PATH"
echo "$ZIP_PATH"
