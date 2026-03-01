$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $AppRoot "logs"
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$StartupBat = Join-Path $StartupDir "SparkCuriosityRuntime.bat"
$StartScript = Join-Path $ScriptDir "start-runtime.ps1"

Write-Host "[install-runtime] RepoRoot: $RepoRoot"
Write-Host "[install-runtime] AppRoot: $AppRoot"

New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

Push-Location $RepoRoot
try {
  Write-Host "[install-runtime] npm install"
  npm install

  Write-Host "[install-runtime] build companion + desktop-agent + desktop-runtime"
  npm run build -w @spark/companion
  npm run build -w @spark/desktop-agent
  npm run build -w @spark/desktop-runtime
}
finally {
  Pop-Location
}

$batContent = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$StartScript" >> "$LogDir\startup.log" 2>&1
"@
Set-Content -Path $StartupBat -Value $batContent -Encoding Ascii

Write-Host "[install-runtime] Startup entry created: $StartupBat"
Write-Host "[install-runtime] Launching runtime now..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $StartScript
Write-Host "[install-runtime] Done. Debug UI: http://127.0.0.1:4343/debug/ui"
