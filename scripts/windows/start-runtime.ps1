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
Write-Host "[start-runtime] Started. Check status with: npm run runtime:status:win"
