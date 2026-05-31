# Getting Started

This guide covers **downloading Spark Curiosity**, **installing it**, and **connecting your own AI API key**.

---

## Downloads

Pre-built binaries are published on **[GitHub Releases](https://github.com/NickGitHubStart/spark-curiosity/releases/latest)**.

| Platform | File | What it is |
|----------|------|------------|
| **Windows** | [`SparkSetup.exe`](https://github.com/NickGitHubStart/spark-curiosity/releases/latest) | Recommended installer — bundles Node.js, the companion server, desktop agent, and native overlay |
| **Windows (alt.)** | `spark-curiosity-windows.zip` | Portable ZIP from CI — same contents, manual setup |
| **Android** | `spark-curiosity-android.apk` | Debug/release APK for sideloading |

> **Note:** If a file is not attached to the latest release yet, build it locally — see [Build from source](#build-from-source) below.

Direct release page: **https://github.com/NickGitHubStart/spark-curiosity/releases/latest**

---

## Windows setup

### 1. Install

1. Download **`SparkSetup.exe`** from [Releases](https://github.com/NickGitHubStart/spark-curiosity/releases/latest).
2. Run the installer (no admin required — installs to `%LOCALAPPDATA%\SparkCuriosity\`).
3. Spark starts in the background and opens the onboarding page in your browser.

### 2. Add your API key

Spark needs an LLM provider. The simplest option is a **direct xAI (Grok) key**:

1. Get an API key from [x.ai](https://x.ai/).
2. Open (or create) this file:

   ```
   %LOCALAPPDATA%\SparkCuriosity\config\runtime.env
   ```

3. Add or update:

   ```env
   SPARK_GROK_API_KEY=xai-your-key-here
   SPARK_MODEL=grok-4-1-fast
   ```

4. Restart Spark:

   ```powershell
   npm run runtime:stop:win   # if you have the repo cloned
   # or kill Spark from Task Manager, then run Spark from the Start Menu / Startup entry
   ```

5. Open **http://127.0.0.1:4343/onboard** and finish onboarding (pick a template, load the browser extension, enable the overlay).

### Optional: local Ollama (no cloud key)

If you run [Ollama](https://ollama.com/) locally:

```env
SPARK_AI_PROVIDER=ollama
SPARK_LOCAL_LLM_MODEL=phi3:mini
```

Pull the model first: `ollama pull phi3:mini`

### Optional: voice input (Whisper STT)

Add an OpenAI key for microphone transcription:

```env
SPARK_OPENAI_API_KEY=sk-your-openai-key-here
```

Restart the runtime after any change to `runtime.env`.

### Verify

| URL | Purpose |
|-----|---------|
| http://127.0.0.1:4343/health | Server is running |
| http://127.0.0.1:4343/debug/runtime | Shows whether keys are detected (`grokKeyPresent`, `sttReady`) |
| http://127.0.0.1:4343/onboard | Setup wizard |

---

## Android setup

### 1. Install the APK

1. Download **`spark-curiosity-android.apk`** from [Releases](https://github.com/NickGitHubStart/spark-curiosity/releases/latest).
2. Enable **Install unknown apps** for your browser or file manager.
3. Install the APK.

### 2. Grant permissions

On first launch, enable:

- **Accessibility service** — detects which app/page you are on
- **Display over other apps** — floating chat bubble
- **Usage access** (optional but recommended)
- **Notification access** — for media detection (YouTube, Spotify, etc.)
- **Microphone** — for voice input

### 3. Connect to AI

The Android app talks to a **cloud companion** (Cloudflare Worker). You have two options:

#### Option A — Use the default cloud (easiest)

Tap **Start** on the setup screen. The app registers an installation token automatically.  
The server operator’s API keys are used — you do not paste a key on the phone.

> To use **your own** keys with the default cloud, you must [deploy your own cloud proxy](#self-hosted-cloud-proxy) and rebuild the APK with your worker URL (see below).

#### Option B — Pair with your Windows PC

If Spark is already running on Windows:

1. On Windows, open **http://127.0.0.1:4343/pair** and show the QR code.
2. On Android, tap **Pair with existing device** and scan the QR code.

Memory and settings sync through the cloud; your Windows `runtime.env` key is used for AI decisions on both devices.

---

## Self-hosted cloud proxy

For full control (your xAI + OpenAI keys on the server, Android + shared memory):

1. Deploy `apps/cloud-proxy` to Cloudflare Workers:

   ```bash
   cd apps/cloud-proxy
   npm install
   wrangler secret put XAI_API_KEY      # your xAI key
   wrangler secret put OPENAI_API_KEY     # optional, for STT
   wrangler deploy
   ```

2. **Windows:** point the companion at your worker:

   ```env
   SPARK_CLOUD_PROXY_URL=https://your-worker.workers.dev
   ```

   On first onboarding, Spark registers a token and saves it to `runtime.env` as `SPARK_GROK_API_KEY`.

3. **Android:** change `CLOUD_BASE_URL` in `apps/android/app/build.gradle.kts`, then rebuild the APK:

   ```powershell
   cd apps/android
   .\gradlew.bat assembleDebug
   ```

   Output: `apps/android/app/build/outputs/apk/debug/app-debug.apk`

See [apps/cloud-proxy/wrangler.toml](../apps/cloud-proxy/wrangler.toml) and [docs/env-variables.md](env-variables.md) for all options.

---

## Build from source

Requirements: **Node.js 20+**, **Git**, **.NET 6 SDK** (Windows native), **Inno Setup 6** (Windows installer).

```powershell
git clone https://github.com/NickGitHubStart/spark-curiosity.git
cd spark-curiosity
npm install
cp .env.example .env          # add your keys locally — never commit .env
npm run build:desktop-stack
npm run runtime:start:win
```

| Command | Output |
|---------|--------|
| `npm run build:installer:win` | `dist-installer\SparkSetup.exe` |
| `npm run release:win` | Tests + installer |
| `cd apps/android; .\gradlew.bat assembleDebug` | Android APK |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Agent does nothing | Check http://127.0.0.1:4343/debug/runtime — `grokKeyPresent` must be `true` |
| High CPU on Windows | Ensure `ActiveWindowWatcher.exe` exists under `%LOCALAPPDATA%\SparkCuriosity\app\native\` |
| Port 4343 in use | Stop other Spark/dev instances: `npm run runtime:stop:win` |
| Android cannot connect | Check network; verify `CLOUD_BASE_URL` matches your deployed worker |

More: [critical-pitfalls.md](critical-pitfalls.md) · [windows-runtime-install.md](windows-runtime-install.md)
