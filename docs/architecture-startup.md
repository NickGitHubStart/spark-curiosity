# Startup-Architektur

## Prozess-Kette (installierte Version)

```
SparkCuriosity.bat (Autostart)
  └─ start-runtime.ps1
       └─ run-runtime.ps1 (setzt Env-Vars, liest runtime.env)
            └─ node.exe dist/apps/desktop-runtime/src/index.js
                 ├─ Companion (HTTP-Server :4343)
                 │    ├─ AI Agent (Grok API)
                 │    ├─ Extension-API (Chrome Extension)
                 │    ├─ STT Endpoint (Whisper)
                 │    ├─ Debug UI (/debug/ui)
                 │    └─ Onboarding UI (/onboard)
                 ├─ Desktop-Agent (Fenster-Polling)
                 │    ├─ Native Provider (ActiveWindowWatcher.exe --watch)
                 │    └─ PS-Fallback (GetForegroundWindow via PowerShell)
                 └─ Overlay (ActiveWindowWatcher.exe --overlay)
                      ├─ WPF Chat-Panel
                      ├─ System Tray Icon
                      └─ WASAPI Mikrofon (STT)
```

## Window-Detection-Kette

```
getActiveWindow()                    # providers/index.ts
  ├─ getActiveWindowWindowsNative()  # Versuch 1: Native exe --watch Listener
  │    ├─ getExePath()               # Prüft SPARK_WINDOWS_NATIVE_EXE, dann Kandidaten
  │    ├─ startListener(--watch)     # Persistent, liefert JSON pro Fensterwechsel
  │    └─ runCommand(exe, [], 5000)  # One-shot Fallback wenn Listener noch nicht bereit
  │
  └─ getActiveWindowWindows()        # Versuch 2: PowerShell-Fallback (wenn native null)
       ├─ GetForegroundWindow()      # Win32 API via PowerShell
       └─ SHELL_PROCESSES Filter     # Filtert powershell/cmd/conhost raus
```

## Kritische Dateipfade (installiert)

```
%LOCALAPPDATA%\SparkCuriosity\
  ├─ app\                           # SPARK_ROOT_DIR
  │    ├─ node.exe                  # Gebundelte Node.js Runtime
  │    ├─ native\
  │    │    └─ ActiveWindowWatcher.exe  # .NET 6 WPF App
  │    ├─ dist\                     # Kompiliertes TypeScript
  │    ├─ scripts\windows\          # PS1 Startup-Scripts
  │    └─ apps\companion\data\      # Templates, Prompts, User-Memory
  ├─ config\
  │    └─ runtime.env               # User-Config (API Keys, Model)
  ├─ logs\
  │    ├─ runtime\runtime-4343.log  # Runtime-Log
  │    └─ runtime-windows.log       # PS1-Script-Log
  └─ extension\                     # Chrome Extension CRX
```

## Nach PC-Neustart

- Autostart (`%APPDATA%\...\Startup\SparkCuriosity.bat` vom Installer) ruft **`{app}\scripts\windows\start-runtime.ps1`** auf — `{app}` ist **`%LOCALAPPDATA%\SparkCuriosity\app`**.
- Zusätzlich kann **`SparkCuriosityRuntime.bat`** existieren (von `install-runtime.ps1` im Dev-Repo). Früher zeigte die auf das **Repo**-`start-runtime.ps1` und startete damit veraltetes JS, während der Installer bereits ein neues Bundle unter `...\app` hatte. **Behoben:** `start-runtime.ps1` und `run-runtime.ps1` wählen automatisch **`%LOCALAPPDATA%\SparkCuriosity\app`**, sobald dort `dist/apps/desktop-runtime/src/index.js` existiert. `install-runtime.ps1` schreibt den Startup-Batch so, dass er direkt die installierte `start-runtime.ps1` nutzt, falls vorhanden.
- Nur wenn du absichtlich das **Repo** statt des installierten Bundles starten willst: **`SPARK_USE_REPO_RUNTIME=1`** setzen (User- oder Prozess-Umgebung).
- `run-runtime.ps1` setzt **`SPARK_ROOT_DIR`** auf dieses App-Verzeichnis und startet **`node.exe dist/apps/desktop-runtime/...`** dort.
- **Overlay** (`ActiveWindowWatcher.exe --overlay`) und **Watch** (`--watch`) werden aus **`%LOCALAPPDATA%\SparkCuriosity\app\native\ActiveWindowWatcher.exe`** aufgelöst, sobald das **installierte Bundle** (`node.exe` + `native\...`) erkannt wird — auch wenn in `runtime.env` noch ein veraltetes **`SPARK_WINDOWS_NATIVE_EXE`** steht (wird dann ignoriert).

## Build & Deploy

```bash
# 1. TypeScript kompilieren
npm run build

# 2. dist-package erstellen (inkl. native exe, node.exe, dependencies)
powershell -File scripts/build-dist.ps1

# 3. Installer bauen
"C:/Users/.../Inno Setup 6/ISCC.exe" installer/spark-setup.iss

# Ergebnis: dist-installer/SparkSetup.exe
```
