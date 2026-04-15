# Umgebungsvariablen – Übersicht

## LLM / AI ändern

Um das Modell zu wechseln, diese Werte in `%LOCALAPPDATA%\SparkCuriosity\config\runtime.env` ändern:

```env
SPARK_GROK_API_KEY=xai-...          # Direkter API Key (xai- oder sk- Prefix)
SPARK_MODEL=grok-4-1-fast      # Modellname (xAI: **Hyphens**, nicht `grok-4.1-fast` mit Punkt — wird im Code zu `grok-4-1-fast` korrigiert)
SPARK_CLOUD_PROXY_URL=https://...   # Wenn gesetzt UND kein direkter Key → Proxy-Modus
SPARK_OPENAI_API_KEY=sk-proj-...    # Für Whisper STT (oder OPENAI_API_KEY als Fallback)
```

**Wichtig:** `readRuntimeSetting()` in `config.ts` liest bei jedem Aufruf frisch von Disk — Änderungen in `runtime.env` wirken nach Runtime-Neustart sofort.

**Routing (seit Maerz 2026):**
- **Global Default: `grok-4-1-fast`** — alle Installationen nutzen den Cloud Proxy, der serverseitig an `api.x.ai` weiterleitet (`XAI_API_KEY` als Worker Secret).
- Wenn `SPARK_GROK_API_KEY` mit `xai-`/`sk-` beginnt → Companion geht **direkt** an `api.x.ai/v1` (bypassed Proxy).
- Wenn Key kein `xai-`/`sk-` Prefix hat → Companion geht ueber Cloud Proxy. Proxy routet: `@cf/` Modelle → Workers AI, alles andere → xAI API.
- `@cf/` Modelle (Cloudflare Workers AI) sind als Fallback verfuegbar, werden aber nicht aktiv genutzt.

## Config-Ladereihenfolge (config.ts)

1. `<ROOT_DIR>/.env` — Dev-Overrides
2. `<ROOT_DIR>/config/runtime.env` — Bundled Defaults
3. `SPARK_RUNTIME_CONFIG_PATH` — Expliziter Pfad (gesetzt von run-runtime.ps1)
4. `SPARK_WINDOWS_APP_ROOT/config/runtime.env` — Installierter User-Config

Bereits gesetzte Werte werden NICHT überschrieben (first wins).

## Kritische Startup-Variablen

| Variable | Default | Gesetzt von | Zweck |
|----------|---------|-------------|-------|
| `SPARK_ROOT_DIR` | `process.cwd()` | run-runtime.ps1 | App-Root für alle Pfadauflösungen |
| `SPARK_WINDOWS_APP_ROOT` | – | run-runtime.ps1 | `%LOCALAPPDATA%\SparkCuriosity` |
| `SPARK_RUNTIME_CONFIG_PATH` | – | run-runtime.ps1 | Pfad zur runtime.env |
| `SPARK_COMPANION_HOST` | `0.0.0.0` | run-runtime.ps1 (`127.0.0.1`) | Server-Interface |
| `SPARK_COMPANION_PORT` | `4343` | run-runtime.ps1 | HTTP-Port |
| `SPARK_COMPANION_URL` | `http://127.0.0.1:4343` | desktop-runtime | URL für desktop-agent + overlay |
| `SPARK_USE_REPO_RUNTIME` | – (nicht gesetzt) | manuell | Wenn `1`: `start-runtime.ps1` / `run-runtime.ps1` nutzen das **Git-Repo** statt `%LOCALAPPDATA%\SparkCuriosity\app`, auch wenn dort ein installiertes Bundle liegt. Nur für Entwicklung. |

## Native Exe / Overlay

| Variable | Default | Zweck |
|----------|---------|-------|
| `SPARK_WINDOWS_NATIVE_EXE` | – (auto-detect) | **Expliziter** Pfad zu ActiveWindowWatcher.exe. Überschreibt ALLE Auto-Detection! |
| `SPARK_ICON_PATH` | `<ROOT>/apps/companion/data/assets/icon_round.jpg` | Overlay-Icon |
| `SPARK_SKIP_AUTOSTART` | `0` | Wenn `1`: Overlay nicht auto-starten |

**WARNUNG:** `SPARK_WINDOWS_NATIVE_EXE` als User-Level Env-Variable kann die Auto-Detection komplett brechen wenn sie auf einen stale Pfad zeigt. Immer prüfen: `[Environment]::GetEnvironmentVariable('SPARK_WINDOWS_NATIVE_EXE', 'User')`

## Agent-Timing

| Variable | Default | Zweck |
|----------|---------|-------|
| `SPARK_DESKTOP_POLL_MS` | `750` | Wie oft active window gepollt wird (ms) |
| `SPARK_DESKTOP_HEARTBEAT_SECONDS` | `90` | Heartbeat-Intervall desktop-agent → companion |
| `SPARK_IDLE_NEXT_CHECK_SECONDS` | `1200` | Agent-Entscheidungsintervall bei Idle (20min) |
| `SPARK_POLICY_NEXT_CHECK_SECONDS` | `120` | Curated-Gate Check-Intervall |
| `SPARK_AI_TIMEOUT_MS` | `120000` | Timeout für AI-Calls |

## Sonstige

| Variable | Zweck |
|----------|-------|
| `SPARK_DISCORD_BUG_WEBHOOK` | Discord Webhook für Bug-Reports |
| `SPARK_FALLBACK_REDIRECT_URL` | Standard-Redirect-Ziel (default: todoist.com) |
| `SPARK_CDP_PORT` | Chrome DevTools Protocol Port (default: 9222) |
| `SPARK_CHROME_PATH` | Expliziter Chrome-Pfad |
| `SPARK_UPDATE_MANIFEST_URL` | URL für Auto-Update Manifest |
| `SPARK_NO_ONBOARD` | Wenn `1`: Onboarding überspringen |
