#!/usr/bin/env bash
set -euo pipefail

# Spark Curiosity Companion Start Script
# Startet den Companion-Server und beendet alte Prozesse automatisch

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SPARK_COMPANION_PORT:-4343}"
HOST="${SPARK_COMPANION_HOST:-127.0.0.1}"

echo "🚀 Starting Spark Companion..."
echo "   Port: $PORT"
echo "   Host: $HOST"
echo "   Provider: ${SPARK_AI_PROVIDER:-local}"

# Prüfe ob Port bereits belegt ist
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "⚠️  Port $PORT ist bereits belegt. Beende alten Prozess..."
    lsof -ti:$PORT | xargs -r kill -9
    sleep 1
    echo "✅ Alter Prozess beendet."
fi

# Starte Companion
cd "$ROOT_DIR"
SPARK_AI_PROVIDER="${SPARK_AI_PROVIDER:-local}" npm run dev -w @spark/companion
