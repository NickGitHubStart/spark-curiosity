$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $AppRoot "logs"
$ConfigDir = Join-Path $AppRoot "config"
$EnvFile = Join-Path $ConfigDir "runtime.env"
$StartupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$StartupBat = Join-Path $StartupDir "SparkCuriosityRuntime.bat"
$StartScript = Join-Path $ScriptDir "start-runtime.ps1"

Write-Host "[install-runtime] RepoRoot: $RepoRoot"
Write-Host "[install-runtime] AppRoot: $AppRoot"

New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

function Read-EnvValue([string]$Path, [string]$Key) {
  if (-not (Test-Path $Path)) { return "" }
  foreach ($line in (Get-Content -Path $Path)) {
    if ($line -match "^\s*$Key\s*=") {
      return ($line.Substring($line.IndexOf('=') + 1).Trim())
    }
  }
  return ""
}

$grokModel = if ($env:SPARK_GROK_MODEL) { $env:SPARK_GROK_MODEL } else { "grok-2-latest" }
$grokKey = if ($env:SPARK_GROK_API_KEY) { $env:SPARK_GROK_API_KEY } else { Read-EnvValue $EnvFile "SPARK_GROK_API_KEY" }
$envContent = @(
  "SPARK_AI_PROVIDER=grok"
  "SPARK_GROK_API_KEY=$grokKey"
  "SPARK_GROK_MODEL=$grokModel"
)
Set-Content -Path $EnvFile -Value ($envContent -join "`n") -Encoding Ascii
Write-Host "[install-runtime] Runtime config written: $EnvFile"

Push-Location $RepoRoot
try {
  Write-Host "[install-runtime] npm install"
  npm install

  Write-Host "[install-runtime] build desktop stack"
  npm run build:desktop-stack
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

$SetupUrl = "http://127.0.0.1:4343/setup"
Write-Host "[install-runtime] Opening setup UI: $SetupUrl"
Start-Process $SetupUrl | Out-Null
Write-Host "[install-runtime] Done. Setup: $SetupUrl"
