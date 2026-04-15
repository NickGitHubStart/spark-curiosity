param([switch]$SkipBuild)

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

function Read-EnvMap([string]$Path) {
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in (Get-Content -Path $Path)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    if ($key) { $map[$key] = $value }
  }
  return $map
}

$existing = Read-EnvMap $EnvFile
$sparkModel = if ($env:SPARK_MODEL) { $env:SPARK_MODEL } elseif ($existing["SPARK_MODEL"]) { $existing["SPARK_MODEL"] } elseif ($existing["SPARK_GROK_MODEL"]) { $existing["SPARK_GROK_MODEL"] } else { "@cf/qwen/qwen3-30b-a3b-fp8" }
$grokKey = if ($env:SPARK_GROK_API_KEY) { $env:SPARK_GROK_API_KEY } elseif ($existing["SPARK_GROK_API_KEY"]) { $existing["SPARK_GROK_API_KEY"] } else { "" }
$nativeExe = if ($env:SPARK_WINDOWS_NATIVE_EXE) { $env:SPARK_WINDOWS_NATIVE_EXE } elseif ($existing["SPARK_WINDOWS_NATIVE_EXE"]) { $existing["SPARK_WINDOWS_NATIVE_EXE"] } else { "" }

$envLines = @(
  "SPARK_GROK_API_KEY=$grokKey"
  "SPARK_MODEL=$sparkModel"
)
if ($nativeExe) {
  $envLines += "SPARK_WINDOWS_NATIVE_EXE=$nativeExe"
}

# Preserve any extra keys already stored.
foreach ($key in $existing.Keys) {
  if ($key -in @("SPARK_GROK_API_KEY","SPARK_MODEL","SPARK_GROK_MODEL","SPARK_WINDOWS_NATIVE_EXE")) { continue }
  $envLines += "$key=$($existing[$key])"
}

Set-Content -Path $EnvFile -Value ($envLines -join "`n") -Encoding Ascii
Write-Host "[install-runtime] Runtime config written (preserved existing values): $EnvFile"

Push-Location $RepoRoot
try {
  Write-Host "[install-runtime] npm install"
  if ($SkipBuild) {
    npm install --omit=dev
  } else {
    npm install
  }

  if ($SkipBuild) {
    $runtimeDist = Join-Path $RepoRoot "dist\apps\desktop-runtime"
    if (-not (Test-Path (Join-Path $runtimeDist "src\index.js"))) {
      throw "SkipBuild set but dist not found at $runtimeDist - run without -SkipBuild or use a dist bundle."
    }
    Write-Host "[install-runtime] Using existing dist (SkipBuild)"
  } else {
    Write-Host "[install-runtime] build desktop stack"
    npm run build:desktop-stack
  }
}
finally {
  Pop-Location
}

# Prefer installed bundle (SparkSetup / sync) so reboot autostart never runs stale repo JS.
$InstalledStart = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app\scripts\windows\start-runtime.ps1"
$StartTarget = if (Test-Path -LiteralPath $InstalledStart) { $InstalledStart } else { $StartScript }
$batContent = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$StartTarget" >> "$LogDir\startup.log" 2>&1
"@
Set-Content -Path $StartupBat -Value $batContent -Encoding Ascii

Write-Host "[install-runtime] Startup entry created: $StartupBat"
Write-Host "[install-runtime] Launching runtime now..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $StartScript

$SetupUrl = "http://127.0.0.1:4343/onboard"
$hasSetup = -not [string]::IsNullOrWhiteSpace($grokKey)
if ($env:SPARK_NO_ONBOARD -eq "1") {
  Write-Host "[install-runtime] SPARK_NO_ONBOARD=1 -> skipping setup UI auto-open."
  Write-Host "[install-runtime] Done. Debug UI: http://127.0.0.1:4343/debug/ui"
} elseif ($hasSetup) {
  Write-Host "[install-runtime] Existing setup detected -> skipping setup UI auto-open."
  Write-Host "[install-runtime] Done. Debug UI: http://127.0.0.1:4343/debug/ui"
} else {
  Write-Host "[install-runtime] Opening setup UI: $SetupUrl"
  Start-Process $SetupUrl | Out-Null
  Write-Host "[install-runtime] Done. Setup: $SetupUrl"
}

# Optional auto-update via scheduled task (only if bootstrap install metadata exists).
$autoUpdateDisabled = ($env:SPARK_AUTO_UPDATE -eq "0")
$metaPath = Join-Path $AppRoot "install-meta.json"
if (-not $autoUpdateDisabled -and (Test-Path $metaPath)) {
  $taskName = "SparkCuriosityAutoUpdate"
  $updateScript = Join-Path $RepoRoot "scripts\\windows\\bootstrap-update.ps1"
  $taskCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$updateScript`""
  schtasks /Create /F /SC DAILY /ST 03:00 /RL LIMITED /TN $taskName /TR $taskCmd | Out-Null
  Write-Host "[install-runtime] Auto-update task ensured: $taskName (daily 03:00)"
} elseif ($autoUpdateDisabled) {
  Write-Host "[install-runtime] SPARK_AUTO_UPDATE=0 -> auto-update task skipped."
} else {
  Write-Host "[install-runtime] No install metadata found; auto-update task not created."
}
