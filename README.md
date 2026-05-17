# Spark Curiosity

Desktop activity monitor powered by LLM. Tracks active windows/browser tabs, blocks distractions (social media feeds), and curates content based on user goals stored in a continuously updated memory file.

## Architecture

```
ActiveWindowWatcher.exe (C# WinAPI)
        â”‚ JSON context (app, title, url)
        â–¼
  Desktop Agent (Node.js)
        â”‚ POST /event
        â–¼
  Companion Server (Node.js HTTP)
        â”‚ LLM decision (Grok/Ollama)
        â–¼
  Desktop Agent opens redirect URL via OS
```

| Component | Path | Role |
|-----------|------|------|
| **Companion** | `apps/companion/` | HTTP server, LLM calls, memory, curated page, debug UI |
| **Desktop Agent** | `apps/desktop-agent/` | Polls active window, sends events, executes redirects |
| **Desktop Runtime** | `apps/desktop-runtime/` | Orchestrates companion + agent as one process |
| **Desktop Native** | `apps/desktop-native/` | C# ActiveWindowWatcher for Windows |
| **Shared** | `packages/shared/` | TypeScript types shared across packages |

**Brain (Obsidian vault):** HTTP API summary in [docs/brain-api.md](docs/brain-api.md). Prefer `/brain/*` over legacy `/vault/*`.

## Quick start (Windows)

```powershell
npm install
npm run build:desktop-stack
npm run runtime:start:win
```

Setup UI opens at `http://127.0.0.1:4343/setup` for API key + template.

**Windows (Entwicklung) â€“ App komplett neu starten inkl. Build:** siehe [docs/windows-app-neustart.md](docs/windows-app-neustart.md).

## Windows-Installer (`SparkSetup.exe`)

**Hochladen fÃ¼r Nutzer:** Die Datei heiÃŸt immer **`SparkSetup.exe`**.

**Nach dem Build liegt sie hier:**

`<repo>\dist-installer\SparkSetup.exe`

(relativ zum Repo: `dist-installer\SparkSetup.exe`)

### Release (neue Version verteilen)

**Immer aktuell auf deinem PC (empfohlen):** im Repo-Root **`npm run update:win`**. Das baut `dist-package` + Installer, **kopiert `dist-package` direkt nach** `%LOCALAPPDATA%\SparkCuriosity\app` (Ã¼berschreibt u.â€¯a. `native\ActiveWindowWatcher.exe` â€” kein â€žaltes Binaryâ€œ mehr), sichert/restauriert `user-memory.md`, startet die Runtime neu.

**Nur Installer bauen / fÃ¼r andere Nutzer:** **`npm run release:win`** â†’ dann **`dist-installer\SparkSetup.exe`** installieren oder verteilen. Wenn du nur lokal testest, reicht **`update:win`** und du musst die `.exe` nicht manuell installieren.

1. **Build ausfÃ¼hren (empfohlen):** `npm run release:win` â€” gleichwertig zu: `scripts\build-dist.ps1` + Inno, siehe auch `scripts\build-installer.ps1`.
2. **Alternativ nur Installer ohne Tests:** `npm run build:installer:win` bzw. `powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1` (sucht `ISCC.exe` automatisch).
   - **Oder manuell:**
   ```powershell
   cd <repo>
   # ActiveWindowWatcher: build-dist.ps1 macht dotnet publish -> dist-package/native (nicht nur dotnet build nach bin/)
   powershell -ExecutionPolicy Bypass -File scripts\build-dist.ps1
   & "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe" installer\spark-setup.iss
   ```
   Alternative Pfade fÃ¼r `ISCC.exe`: `C:\Program Files (x86)\Inno Setup 6\` (klassisch) oder nach Installation mit winget meist `%LocalAppData%\Programs\Inno Setup 6\`.

3. **`SparkSetup.exe`** aus `dist-installer\` in **Google Drive** hochladen und die bestehende Datei **ersetzen** (gleicher Dateiname).

4. **Download-Link:** Der **gleiche** Drive-Link bleibt gÃ¼ltig, solange die neue Datei die alte am gleichen Ort ersetzt.

## Commands

| Command | What it does |
|---------|-------------|
| `npm run build:desktop-stack` | Build shared + companion + agent + runtime |
| `npm run runtime:start:win` | Start background runtime |
| `npm run runtime:stop:win` | Stop runtime |
| `npm run runtime:status:win` | Check runtime status |
| `npm run runtime:doctor:win` | Diagnose issues |
| `npm run build:installer:win` | `dist-package` + `dist-installer\SparkSetup.exe` (Inno Setup nÃ¶tig) |
| `npm run release:win` | Tests + `dist-package` + `dist-installer\SparkSetup.exe` |
| `npm run sync:spark:win` | `dist-package` â†’ `%LOCALAPPDATA%\SparkCuriosity\app` (nach `release:win`) |
| `npm run update:win` | **`release:win` + sync + Runtime start** â€” lokale Installation immer auf Repo-Stand |
| `npm run test:companion` | Run companion tests |

## Debug endpoints

```
http://127.0.0.1:4343/health
http://127.0.0.1:4343/debug/ui
http://127.0.0.1:4343/debug/runtime
http://127.0.0.1:4343/debug/stats
http://127.0.0.1:4343/debug/traces?limit=20
http://127.0.0.1:4343/debug/simulate-popup?kind=quote   (nur localhost â€“ startet natives Windows-Popup)
http://127.0.0.1:4343/memory
http://127.0.0.1:4343/policy/curated-gate
```

## AI configuration

Set in `.env` or via `http://127.0.0.1:4343/setup`:

```env
SPARK_AI_PROVIDER=grok
SPARK_GROK_API_KEY=your_key
SPARK_GROK_MODEL=grok-4-1-fast
```

Fallback: `SPARK_AI_PROVIDER=ollama` with local Ollama (`ollama pull phi3:mini`).

