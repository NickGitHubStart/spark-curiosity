$ErrorActionPreference = 'Stop'

if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
$Port = $env:SPARK_COMPANION_PORT
$RuntimeLogDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\logs\runtime"
$PidFile = Join-Path $RuntimeLogDir "runtime-$Port.pid"
$RuntimeLog = Join-Path $env:LOCALAPPDATA "SparkCuriosity\logs\runtime-windows.log"

$running = $false
$pidText = ""

if (Test-Path $PidFile) {
  $pidText = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($pidText -match '^\d+$') {
    $proc = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($proc) {
      $running = $true
    }
  }
}

$runtimeProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*scripts\\windows\\run-runtime.ps1*" -or
  $_.CommandLine -like "*dist/apps/desktop-runtime/src/index.js*"
}
if (-not $running -and $runtimeProcesses) {
  $running = $true
  $pidText = ($runtimeProcesses | Select-Object -First 1).ProcessId
}

$healthOk = $false
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
  if ($resp.StatusCode -eq 200) { $healthOk = $true }
}
catch {
  $healthOk = $false
}

if ($running) {
  Write-Host "[status-runtime] runtime process: RUNNING (PID=$pidText)"
} else {
  Write-Host "[status-runtime] runtime process: STOPPED"
}

if ($healthOk) {
  Write-Host "[status-runtime] companion health: OK (http://127.0.0.1:$Port/health)"
  exit 0
}

Write-Host "[status-runtime] companion health: NOT REACHABLE"
if (Test-Path $RuntimeLog) {
  Write-Host "[status-runtime] Last runtime log lines:"
  Get-Content -Path $RuntimeLog -Tail 20
}
if ($running) { exit 1 }
exit 0
