# Windows: App / Runtime neu starten (Entwicklung)

Damit siehst du **Companion-Änderungen** (z. B. `/debug/ui`, neue Endpoints) und das **Spark-Icon unten rechts** (Overlay) zuverlässig mit dem aktuellen Stand.

## Wann so vorgehen?

- Nach Änderungen an **TypeScript**: `apps/companion`, `apps/desktop-agent`, `apps/desktop-runtime`
- Nach Änderungen am **nativen Overlay** (C#): `apps/desktop-native/windows/ActiveWindowWatcher/`
- Wenn die **Debug-Seite** oder andere Web-UI **alt** wirkt → sehr wahrscheinlich läuft noch ein alter **Node**-Prozess ohne neuen Build
- Wenn das **Spark-Icon** fehlt oder sich **komisch** verhält → oft alte `ActiveWindowWatcher.exe --overlay`-Instanz; ein sauberer Neustart der Runtime hilft

Alle Befehle im **Repo-Root** (PowerShell), z. B.:

`C:\Users\…\projects\sparky`

---

## Kurz: nur Neustart (Code unverändert)

```powershell
cd C:\Pfad\zu\sparky
npm run runtime:stop:win
npm run runtime:start:win
```

---

## Vollständig: Stop → Native bauen → TypeScript bauen → Start

**Empfohlen**, wenn du Code geändert hast (entspricht dem üblichen Entwickler-Flow):

```powershell
cd C:\Pfad\zu\sparky

# Falls `dotnet` in der IDE-Shell nicht gefunden wird:
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

npm run runtime:stop:win

dotnet build apps\desktop-native\windows\ActiveWindowWatcher\ActiveWindowWatcher.csproj -c Release

npm run build:desktop-stack

npm run runtime:start:win
```

| Schritt | Zweck |
|--------|--------|
| `runtime:stop:win` | Beendet die laufende Runtime (Companion + Desktop-Agent). |
| `dotnet build … Release` | Neue `ActiveWindowWatcher.exe` (Overlay, Popups, Tab-Helfer, …). |
| `build:desktop-stack` | Baut Shared, Companion, Desktop-Agent, Desktop-Runtime nach `dist/`. |
| `runtime:start:win` | Startet alles wieder; prüft `/health`. |

---

## Was macht das Skript beim Start?

`scripts/windows/run-runtime.ps1` setzt u. a. `SPARK_ROOT_DIR` und `SPARK_WINDOWS_NATIVE_EXE` auf die **Release-`.exe`** im Repo.

Zusätzlich wird **best effort** jede laufende `ActiveWindowWatcher.exe` mit Argument **`--overlay`** beendet, bevor die Runtime ein neues Overlay startet. So bleibt nicht versehentlich eine **alte** Overlay-Version hängen.

Details und Checkliste stehen auch als Kommentar oben in `scripts/windows/run-runtime.ps1`.

---

## Prüfen, ob alles da ist

1. **Health:** im Browser  
   `http://127.0.0.1:4343/health`  
   → `"ok": true`

2. **Runtime-Infos:**  
   `http://127.0.0.1:4343/debug/runtime`  
   → u. a. `windowsNativeExe` (Pfad zur genutzten `ActiveWindowWatcher.exe`)

3. **Overlay-Prozess** (optional, PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='ActiveWindowWatcher.exe'" |
  Select-Object ProcessId, CommandLine
```

Mindestens **eine** Zeile sollte `--overlay` enthalten (schwebendes Spark-Icon / Chat).

**Debug-UI hart neu laden:** `http://127.0.0.1:4343/debug/ui` mit **Strg+F5**, damit der Browser nicht aus dem Cache bedient.

---

## Schneller: nur Companion

Nur wenn du **ausschließlich** `apps/companion` geändert hast:

```powershell
npm run runtime:stop:win
npm run build -w @spark/companion
npm run runtime:start:win
```

Wenn du unsicher bist oder Agent/Runtime auch geändert wurden: immer **`npm run build:desktop-stack`**.

---

## `.env` / API-Keys

Änderungen an der **`.env`** im Projektroot greifen beim **Companion-Start**. Nach Anpassungen: Runtime wie oben **neu starten** (mindestens Stop → Start; nach Code-Änderungen zusätzlich bauen).

---

## Siehe auch

- Installation / Basis-Befehle: [windows-runtime-install.md](./windows-runtime-install.md) (Abschnitt „Manuell starten/stoppen“)
- Installer-Build: [README.md](../README.md) (Abschnitt Windows-Installer)
