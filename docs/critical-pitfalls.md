# Kritische Stolperfallen

## 1. Stale User-Level Env-Variablen (Windows)

**Problem:** Windows User-Level Env-Variablen (`[Environment]::SetEnvironmentVariable($k,$v,'User')`) bleiben persistent bestehen und überschreiben die Auto-Detection.

**Besonders gefährlich:** `SPARK_WINDOWS_NATIVE_EXE` — wird VOR der Kandidaten-Suche geprüft. Zeigt sie auf einen alten Pfad, findet der Code die exe nie, egal ob sie am richtigen Ort liegt.

**Diagnose:**
```powershell
[Environment]::GetEnvironmentVariable('SPARK_WINDOWS_NATIVE_EXE', 'User')
```

**Fix:**
```powershell
[Environment]::SetEnvironmentVariable('SPARK_WINDOWS_NATIVE_EXE', '', 'User')
```

**WICHTIG:** Änderungen an User-Level Env-Vars wirken nur in NEU gestarteten Prozessen. Laufende Prozesse (und deren Kinder) behalten den alten Wert. Nach Entfernung muss die Runtime komplett neu gestartet werden — idealerweise aus einer frischen Shell.

## 2. Port-Konflikte: Dev vs. Installiert

**Problem:** Dev-Instanz und installierte Version nutzen beide Port 4343. Wenn die Dev-Instanz läuft, kann die installierte nicht starten (EADDRINUSE). Der Browser zeigt dann die Dev-Instanz, die andere Config/Pfade hat.

**Diagnose:**
```powershell
Get-NetTCPConnection -LocalPort 4343 -State Listen | ForEach-Object {
  Get-Process -Id $_.OwningProcess | Select-Object Id, Path
}
```

**Erkennung:** Wenn `Path` = `C:\Program Files\nodejs\node.exe` → Dev-Instanz. Wenn `Path` = `...\AppData\Local\SparkCuriosity\app\node.exe` → Installiert.

## 3. existsSync Race bei Installation

**Problem:** Direkt nach Inno Setup Installation kann `existsSync` für große Dateien (67MB native exe) `false` zurückgeben — Windows Defender scannt die Datei.

**Lösung im Code:** `resolveNativeExePathWithRetry()` in desktop-runtime (3 Retries, 3s Abstand).

## 4. STT Audio-Pipeline: Kanal-Kompatibilität

**Problem:** WASAPI liefert je nach Mikrofon/Treiber verschiedene Formate:
- Mono (1ch) — z.B. Headset-Mikrofone
- Stereo (2ch) — Standard
- Multi-Channel (>2ch) — USB-Audio-Interfaces

NAudio's `ToMono()` akzeptiert NUR exakt 2 Kanäle. Für andere Kanalanzahlen muss alternativ konvertiert werden.

**Lösung:** `if channels==2 → ToMono(); else if channels>2 → MultiplexingSampleProvider`

## 5. Installer: Alle postinstall-Einträge starten gleichzeitig

**Problem:** Inno Setup `[Run]` Einträge mit `nowait postinstall` feuern ALLE gleichzeitig wenn der User "Fertig" klickt. Wenn der Overlay vor dem Companion-Server startet, schlägt die Verbindung fehl.

**Lösung:** Overlay-Start mit `timeout /t 8 /nobreak >nul &` verzögern.

## 6. PowerShell-Prozess im Fallback erkannt

**Problem:** Wenn native exe nicht verfügbar, fällt desktop-agent auf PowerShell-Script zurück. Dieses erkennt dann das eigene PowerShell-Fenster des Launchers als "aktives Fenster".

**Lösung:** Shell-Prozess-Filter in `windows.ts`: `SHELL_PROCESSES = /^(powershell|pwsh|cmd|conhost|WindowsTerminal|wt)$/i`

## 7. ActiveWindowWatcher: `dotnet build` ≠ Installer-Binary

**Problem:** Nur `dotnet build` (oder eine alte Datei unter `bin/Release/...`) zu aktualisieren reicht nicht. Der Windows-Installer packt **`dist-package/native/ActiveWindowWatcher.exe`**, und die entsteht nur durch **`dotnet publish -o <dist-package/native>`** in `scripts/build-dist.ps1`.

**Regel:** Release immer mit `npm run build:installer:win` bzw. `scripts/build-installer.ps1` bauen — dann läuft `publish` frisch in `dist-package/native`. Manuell `dotnet build` im `.csproj`-Ordner aktualisiert den Installer-Inhalt **nicht**.
