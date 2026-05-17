# Windows Runtime Install (OpenClaw-style)

Ziel: Spark Curiosity als Hintergrunddienst auf Windows starten, ohne Browser-Extension.

## Voraussetzungen
- Windows 10/11
- Node.js 20+ (`node -v`)
- Git
- PowerShell

**Privates Repo:** FÃ¼r private Repositories musst du vor dem Klonen eingeloggt sein (z.â€¯B. Git Credential Manager, `gh auth login`, oder SSH-Key bei GitHub). Dann funktioniert `git clone https://...` bzw. `git clone git@github.com:<org>/spark-curiosity.git` wie gewohnt.

## Installation
0. Bedeutung von `org`:
- In `https://github.com/<org>/spark-curiosity.git` ist `<org>` der GitHub-Owner.
- Das kann ein Benutzername oder eine Organisation sein.
- Beispiel: `https://github.com/acme-labs/spark-curiosity.git`

1. Repository klonen und in den Ordner wechseln:
```powershell
git clone https://github.com/<dein-org>/spark-curiosity.git
cd spark-curiosity
```

2. Runtime installieren (baut alles und richtet Autostart ein):
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\install-runtime.ps1
```

Was das Skript macht:
- startet sofort den Hintergrunddienst + Autostart
- Ã¶ffnet sofort `http://127.0.0.1:4343/setup` (API-Key + Vorlage)
- speichert Einstellungen in `%LOCALAPPDATA%\SparkCuriosity\config\runtime.env`
- setzt Desktop-Runtime standardmÃ¤ÃŸig auf `SPARK_AI_PROVIDER=grok` (kein Ollama-Zwang)
- `npm install`
- Build von `@spark/companion`, `@spark/desktop-agent`, `@spark/desktop-runtime`
- Startup-Entry in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SparkCuriosityRuntime.bat`
- Start der Runtime im Hintergrund

Alternativ per npm:
```powershell
npm run runtime:install:win
```

## One-Script-Flow fuer fremde Nutzer
Wenn ein Nutzer nur eine Repo-URL hat, reicht ein Skript:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\quick-install.ps1 -RepoUrl https://github.com/<org>/spark-curiosity.git
```

Optional eigenes Zielverzeichnis:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows\quick-install.ps1 -RepoUrl https://github.com/<org>/spark-curiosity.git -InstallDir C:\Tools\spark-curiosity
```

## OpenClaw-Style Bootstrap (kein manuelles clone)
Direkt aus dem Internet starten (wie ein Bootstrap-Installer):
```powershell
iwr https://raw.githubusercontent.com/<org>/spark-curiosity/master/install.ps1 -UseBasicParsing | iex
```

Dieser Pfad ist fuer oeffentliche Distribution gedacht (Installer-Script + Release-Assets oeffentlich).

Privates Repo (beste Praxis):
- Source privat lassen
- Release-Assets/Installer oeffentlich bereitstellen (separates Distribution-Repo oder Domain)
- Endnutzer nutzt weiterhin den einfachen One-liner oben ohne Auth

### Minimal Dist Setup (empfohlen)
Einmalig:
1. Public Repo erstellen, z.B. `<org>/spark-curiosity-dist`
2. Im privaten Source-Repo diese GitHub Secrets setzen:
   - `DIST_REPO_SLUG` = `<org>/spark-curiosity-dist`
   - `DIST_REPO_TOKEN` = GitHub Token mit `contents:write` fuer das dist repo
3. Release im Source-Repo publishen

Dann passiert automatisch:
- CI baut `spark-curiosity-windows.zip`
- CI schreibt ins dist repo:
  - `install.ps1` (public installer)
  - `windows/spark-curiosity-windows.zip`
  - `manifest.json`

Endnutzer-Befehl (ohne Auth):
```powershell
iwr https://raw.githubusercontent.com/<org>/spark-curiosity-dist/main/install.ps1 -UseBasicParsing | iex
```

Wichtig:
- Nicht jeder Commit muss verÃ¶ffentlicht werden.
- Nur wenn Nutzer neue Versionen bekommen sollen: neuen Release erstellen.

Privates Repo (direkt, mit Token):
```powershell
$env:GITHUB_TOKEN = "ghp_xxx"
git clone https://github.com/<org>/spark-curiosity.git
cd spark-curiosity
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Owner <org> -Repo spark-curiosity -Ref master -GitHubToken $env:GITHUB_TOKEN -UseSourceInstall
```

Optional mit Branch/Owner:
```powershell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/<org>/spark-curiosity/master/install.ps1 -UseBasicParsing).Content)) -Owner <org> -Repo spark-curiosity -Ref master
```

Ohne Onboarding-UI (wie `--no-onboard`):
```powershell
& ([scriptblock]::Create((iwr https://raw.githubusercontent.com/<org>/spark-curiosity/master/install.ps1 -UseBasicParsing).Content)) -NoOnboard
```

Das installiert nach `%LOCALAPPDATA%\SparkCuriosity\app`, richtet Runtime ein und erstellt:
- `%LOCALAPPDATA%\SparkCuriosity\bin\spark-curiosity.cmd`
- globale PATH-Integration (neues Terminal oeffnen, dann `spark-curiosity` direkt nutzbar)

**Nutzer-Memory (`user-memory.md`) bei Installation Ã¼ber SparkSetup.exe:**  
`%LOCALAPPDATA%\SparkCuriosity\app\apps\companion\data\user-memory.md`  
(Companion nutzt `apps/companion/data` relativ zur App-Root; optional `SPARK_DATA_DIR` setzen, dann dort.)

**Upgrade mit SparkSetup.exe:** Der Installer ruft vor dem Start `scripts/windows/stop-runtime.ps1` auf (wartet bis fertig), danach `start-runtime.ps1`. So wird eine bereits laufende Runtime beendet; sonst wÃ¼rde `start-runtime` mit â€žAlready runningâ€œ abbrechen und weder Companion noch das ActiveWindowWatcher-Overlay (`--overlay`) wÃ¼rden die neu installierten Dateien laden.

Steuerung danach:
```powershell
%LOCALAPPDATA%\SparkCuriosity\bin\spark-curiosity.cmd status
%LOCALAPPDATA%\SparkCuriosity\bin\spark-curiosity.cmd start
%LOCALAPPDATA%\SparkCuriosity\bin\spark-curiosity.cmd stop
%LOCALAPPDATA%\SparkCuriosity\bin\spark-curiosity.cmd update
```

Nach neuem Terminal auch direkt:
```powershell
spark-curiosity status
spark-curiosity start
spark-curiosity stop
spark-curiosity update
```

Direkt nach Installation sind diese Commands nicht nÃ¶tig. Standard-Flow:
1. Install laufen lassen
2. Setup-Seite `http://127.0.0.1:4343/setup` ausfÃ¼llen
3. Fertig; Spark lÃ¤uft dauerhaft im Hintergrund + Autostart

### â€žDie Website ist nicht erreichbarâ€œ / ERR_CONNECTION_REFUSED (127.0.0.1)
Wenn beim Ã–ffnen von `http://127.0.0.1:4343/setup` oder `/debug/ui` die Verbindung abgelehnt wird: Die Runtime lÃ¤uft nicht (noch nicht gestartet oder beendet). Runtime starten:
```powershell
spark-curiosity start
```
Status prÃ¼fen: `spark-curiosity status`. Logs: `%LOCALAPPDATA%\SparkCuriosity\logs\runtime-windows.log`.

Wenn Runtime nicht hochkommt:
```powershell
npm run runtime:doctor:win
```
Das startet den Companion im Vordergrund und zeigt den echten Fehler direkt im Terminal.

## PrÃ¼fen
- Debug UI: `http://127.0.0.1:4343/debug/ui`
- Logs:
  - `%LOCALAPPDATA%\SparkCuriosity\logs\runtime-windows.log`
  - `%LOCALAPPDATA%\SparkCuriosity\logs\startup.log`

## Native Windows Tracking (empfohlen)
Wenn du die beste Erkennung von aktiver App + Browser-URL willst, baue den Windows-Native-Collector:
```powershell
cd <repo>\apps\desktop-native\windows\ActiveWindowWatcher
dotnet build -c Release
```

Dann setze (optional) explizit den Pfad:
```powershell
setx SPARK_WINDOWS_NATIVE_EXE "<repo>\apps\desktop-native\windows\ActiveWindowWatcher\bin\Release\net6.0-windows\ActiveWindowWatcher.exe"
```

Der Desktop-Agent nutzt den Native-Collector automatisch, wenn er vorhanden ist.

## Installation von WSL aus (Repo in WSL, Windows-Installer)
Wenn das Repo unter WSL liegt (z.â€¯B. `\\wsl$\Ubuntu\home\<user>\projects\spark-curiosity`), von **Windows PowerShell** aus:
```powershell
& "\\wsl$\Ubuntu\home\<user>\projects\spark-curiosity\install-from-wsl.cmd"
```
- **Dist-Bundle (empfohlen):** Nur Build-Output + Skripte werden kopiert, kein volles Repo. Schneller.
```powershell
& "\\wsl$\Ubuntu\...\install-from-wsl.cmd" -UseDistBundle
```
- Ohne Kopie (laufen direkt von WSL-Pfad): `-CopyToLocal:$false`
- Ohne Setup-UI: `-NoOnboard`

## Manuell starten/stoppen
- Status:
```powershell
npm run runtime:status:win
```

- Starten:
```powershell
npm run runtime:start:win
```

- Stoppen:
```powershell
npm run runtime:stop:win
```

**Nach Code-Ã„nderungen (Companion, Agent, Runtime, C#-Overlay):** vollstÃ¤ndiger Ablauf mit Build und Overlay-Hinweisen â†’ [windows-app-neustart.md](./windows-app-neustart.md).

## Deinstallation
```powershell
npm run runtime:uninstall:win
```

Entfernt den Autostart und stoppt laufende Runtime-Prozesse.

