# Spark Curiosity

An open-source AI companion that watches what you are doing (browser tabs, apps, media) and gently nudges you toward your goals — blocking feeds, suggesting better content, and learning from a personal memory file.

Works on **Windows** (background service + overlay) and **Android** (accessibility + floating bubble).

**License:** [MIT](LICENSE)

---

## Download & install

**→ [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** — step-by-step guide with download links and API key setup.

| Platform | Download |
|----------|----------|
| Windows | [`SparkSetup.exe`](https://github.com/NickGitHubStart/spark-curiosity/releases/latest) from [GitHub Releases](https://github.com/NickGitHubStart/spark-curiosity/releases/latest) |
| Android | [`spark-curiosity-android.apk`](https://github.com/NickGitHubStart/spark-curiosity/releases/latest) from [GitHub Releases](https://github.com/NickGitHubStart/spark-curiosity/releases/latest) |

After installing on Windows, add your **xAI API key** to:

`%LOCALAPPDATA%\SparkCuriosity\config\runtime.env`

```env
SPARK_GROK_API_KEY=xai-your-key-here
SPARK_MODEL=grok-4-1-fast
```

Then open **http://127.0.0.1:4343/onboard** to finish setup. Details: [Getting Started](docs/GETTING-STARTED.md).

---

## What it does

- Detects your active window, browser URL, and playing media
- Sends context to a local companion server (Windows) or cloud worker (Android)
- LLM decides whether to close a tab, show a quote, ask a question, or update your memory
- Chrome extension adds page-level context (video title, post text) on supported sites

```
ActiveWindowWatcher.exe  →  Desktop Agent  →  Companion  →  LLM (Grok / Ollama)
     (Windows native)         (Node.js)         (Node.js)
```

---

## Quick start (developers)

```powershell
git clone https://github.com/NickGitHubStart/spark-curiosity.git
cd spark-curiosity
npm install
cp .env.example .env    # add keys locally — never commit
npm run build:desktop-stack
npm run runtime:start:win
```

Setup UI: http://127.0.0.1:4343/onboard

---

## Repository layout

| Path | Description |
|------|-------------|
| `apps/companion/` | HTTP server, LLM, memory, onboarding UI |
| `apps/desktop-agent/` | Window tracking & command execution |
| `apps/desktop-runtime/` | Starts companion + agent + overlay |
| `apps/desktop-native/` | C# `ActiveWindowWatcher.exe` for Windows |
| `apps/android/` | Android app (Kotlin / Compose) |
| `apps/cloud-proxy/` | Cloudflare Worker (optional backend) |
| `packages/shared/` | Shared TypeScript types |

---

## Useful commands

| Command | Description |
|---------|-------------|
| `npm run runtime:start:win` | Start background service |
| `npm run runtime:stop:win` | Stop service |
| `npm run runtime:status:win` | Check if running |
| `npm run build:installer:win` | Build `dist-installer\SparkSetup.exe` |
| `npm run test:companion` | Run tests |

---

## Documentation

- [Getting Started](docs/GETTING-STARTED.md) — downloads, API keys, Android pairing
- [Environment variables](docs/env-variables.md)
- [Architecture](docs/architecture-startup.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)

---

## Debug (local only)

```
http://127.0.0.1:4343/health
http://127.0.0.1:4343/debug/ui
http://127.0.0.1:4343/debug/runtime
http://127.0.0.1:4343/memory
```
