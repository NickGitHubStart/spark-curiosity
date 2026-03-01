$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $AppRoot "logs"
$RuntimeLogDir = Join-Path $LogDir "runtime"

if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
$Port = $env:SPARK_COMPANION_PORT
$PidFile = Join-Path $RuntimeLogDir "runtime-$Port.pid"
$RunScript = Join-Path $ScriptDir "run-runtime.ps1"
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

$started = $false
for ($i = 0; $i -lt 40; $i++) {
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

Write-Host "[start-runtime] Runtime did not become healthy in time."
if (Test-Path $RuntimeLog) {
  Write-Host "[start-runtime] Last runtime log lines:"
  Get-Content -Path $RuntimeLog -Tail 40
}
exit 1
