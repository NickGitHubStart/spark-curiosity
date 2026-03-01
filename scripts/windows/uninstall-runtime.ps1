$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $AppRoot "logs"
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$StartupBat = Join-Path $StartupDir "SparkCuriosityRuntime.bat"
$StopScript = Join-Path $ScriptDir "stop-runtime.ps1"

if (Test-Path $StartupBat) {
  Remove-Item $StartupBat -Force
  Write-Host "[uninstall-runtime] Removed startup entry: $StartupBat"
} else {
  Write-Host "[uninstall-runtime] Startup entry not found (ok)."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $StopScript

if (Test-Path $LogDir) {
  Write-Host "[uninstall-runtime] Logs kept at $LogDir"
}

Write-Host "[uninstall-runtime] Done."
