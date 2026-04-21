# Spark Android: Debug-Seite (Port 4567) + Logcat-Snapshot
# Voraussetzung: USB-Debugging, Handy per USB, Debug-APK installiert, Bedienungshilfen-Service aktiv.
$ErrorActionPreference = "Continue"

$adb = Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
  Write-Error "adb nicht gefunden: $adb (Android SDK platform-tools installieren)."
  exit 1
}

$out = Join-Path $env:TEMP ("spark-logcat-{0:yyyyMMdd-HHmmss}.txt" -f (Get-Date))

Write-Host "[spark-phone-debug] Geräte:"
& $adb devices -l
$devices = & $adb devices | Select-String "device$" | Where-Object { $_ -notmatch "List of devices" }
if (-not $devices) {
  Write-Error "Kein Gerät verbunden. USB anschließen, USB-Debugging erlauben, dann erneut ausführen."
  exit 1
}

Write-Host "[spark-phone-debug] Port-Forward: PC localhost:4567 -> Handy:4567 (DebugHttpServer)"
& $adb forward --remove tcp:4567 2>$null
& $adb forward tcp:4567 tcp:4567

Write-Host "[spark-phone-debug] Logcat-Snapshot -> $out"
# Kern-Tags für Agent / VPN / Boot; sendEvent-Fehler erscheinen unter SparkAccessibility
# *:S zuerst = nur die genannten Tags (in PowerShell '*:S' quoten, sonst expandiert *)
& $adb logcat -d '*:S' 'SparkAccessibility:D' 'SparkDebugServer:D' 'SparkVPN:D' 'SparkBoot:D' | Out-File -FilePath $out -Encoding utf8

Write-Host ""
Write-Host "=== Debug-Webseite (vom PC) ==="
Write-Host "  Browser:  http://localhost:4567"
Write-Host "  (Seite aktualisiert alle 2s; zeigt URL, Platform, Commands, Log)"
Write-Host ""
Write-Host "=== Direkt auf dem Handy (ohne PC) ==="
Write-Host "  Chrome:   http://127.0.0.1:4567"
Write-Host "  (nur wenn Debug-Build + Bedienungshilfen für Spark aktiv)"
Write-Host ""
Write-Host "=== Live-Logs (optional, Ctrl+C zum Beenden) ==="
Write-Host "  & `"$adb`" logcat '*:S' 'SparkAccessibility:D' 'SparkDebugServer:D' 'SparkVPN:D' 'SparkBoot:D'"
Write-Host ""
Write-Host "Log-Datei: $out"
