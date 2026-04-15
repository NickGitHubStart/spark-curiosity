$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $AppRoot "logs"
$RuntimeLogDir = Join-Path $LogDir "runtime"

# After PC reboot, Startup may run this script from the Git repo (SparkCuriosityRuntime.bat)
# while the user expects the installed bundle under %LOCALAPPDATA%\SparkCuriosity\app.
# Always prefer the installed desktop-runtime bundle when present so autostart matches SparkSetup.exe.
$InstalledApp = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
$BundleMarker = Join-Path $InstalledApp "dist\apps\desktop-runtime\src\index.js"
if ($env:SPARK_USE_REPO_RUNTIME -eq "1") {
  $RunScript = Join-Path $ScriptDir "run-runtime.ps1"
} elseif (Test-Path -LiteralPath $BundleMarker) {
  $RunScript = Join-Path $InstalledApp "scripts\windows\run-runtime.ps1"
} else {
  $RunScript = Join-Path $ScriptDir "run-runtime.ps1"
}

if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
$Port = $env:SPARK_COMPANION_PORT
$PidFile = Join-Path $RuntimeLogDir "runtime-$Port.pid"
$RuntimeLog = Join-Path $LogDir "runtime-windows.log"

New-Item -ItemType Directory -Path $RuntimeLogDir -Force | Out-Null

if (Test-Path $PidFile) {
  $pidText = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($pidText -match '^\d+$') {
    $running = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($running) {
      Write-Host "[start-runtime] Already running (PID=$pidText)"
      exit 0
    }
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Write-Host "[start-runtime] Starting Spark Curiosity runtime in background..."
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$RunScript`""
# Note for developers:
# - run-runtime.ps1 also best-effort restarts the native overlay icon (ActiveWindowWatcher.exe --overlay)
#   so UI/native changes are picked up without manual overlay restart.

# Poll up to 30s (matches desktop-runtime companion health timeout)
$started = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($resp.StatusCode -eq 200) {
      $started = $true
      break
    }
  }
  catch {
    # ignore until timeout
  }
}

if ($started) {
  Write-Host "[start-runtime] Started and healthy on http://127.0.0.1:$Port/health"
  exit 0
}

if (Test-Path $PidFile) {
  $runtimePid = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($runtimePid -match '^\d+$') {
    $proc = Get-Process -Id ([int]$runtimePid) -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "[start-runtime] Runtime process is running (PID=$runtimePid), health endpoint still warming up."
      exit 0
    }
  }
}

Write-Host "[start-runtime] Runtime process not healthy and not running."
if (Test-Path $RuntimeLog) {
  Write-Host "[start-runtime] Last runtime log lines:"
  Get-Content -Path $RuntimeLog -Tail 40
}
exit 1
