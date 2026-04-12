$ErrorActionPreference = 'Stop'

if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
$Port = $env:SPARK_COMPANION_PORT
$RuntimeLogDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\logs\runtime"
$PidFile = Join-Path $RuntimeLogDir "runtime-$Port.pid"

$stoppedAny = $false

if (Test-Path $PidFile) {
  $pidText = (Get-Content -Path $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
  if ($pidText -match '^\d+$') {
    $proc = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($proc) {
      Stop-Process -Id ([int]$pidText) -Force
      Write-Host "[stop-runtime] Stopped runtime PID=$pidText"
      $stoppedAny = $true
    }
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$runtimeProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -like "*scripts\\windows\\run-runtime.ps1*" -or
  $_.CommandLine -like "*dist/apps/desktop-runtime/src/index.js*"
}

foreach ($proc in $runtimeProcesses) {
  try {
    Stop-Process -Id $proc.ProcessId -Force
    Write-Host "[stop-runtime] Stopped process $($proc.ProcessId)"
    $stoppedAny = $true
  }
  catch {
    Write-Host "[stop-runtime] Could not stop process $($proc.ProcessId): $($_.Exception.Message)"
  }
}

# Best-effort: kill overlay so ActiveWindowWatcher does not keep stale UI after runtime stop (matches run-runtime.ps1 overlay kill on start).
try {
  $overlayProcs = Get-CimInstance Win32_Process -Filter "Name='ActiveWindowWatcher.exe'" | Where-Object {
    $_.CommandLine -like "*--overlay*"
  }
  foreach ($op in $overlayProcs) {
    if ($op.ProcessId -and ($op.ProcessId -ne $PID)) {
      Stop-Process -Id $op.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host "[stop-runtime] Stopped overlay ActiveWindowWatcher (PID=$($op.ProcessId))"
      $stoppedAny = $true
    }
  }
} catch {
  # non-fatal
}

if (-not $stoppedAny) {
  Write-Host "[stop-runtime] No running runtime process found."
}
