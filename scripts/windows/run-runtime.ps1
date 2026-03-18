$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\logs"
$ConfigDir = Join-Path $AppRoot "config"
$EnvFile = Join-Path $ConfigDir "runtime.env"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$null = New-Item -ItemType Directory -Path $ConfigDir -Force
$LogFile = Join-Path $LogDir "runtime-windows.log"
$RuntimeLogDir = Join-Path $LogDir "runtime"
New-Item -ItemType Directory -Path $RuntimeLogDir -Force | Out-Null

Push-Location $RepoRoot
try {
  "[$(Get-Date -Format o)] run-runtime.ps1 started" | Out-File -FilePath $LogFile -Append -Encoding utf8
  # Developer notes (startup correctness):
  # 1) This script starts the Node runtime (companion + desktop-agent orchestration).
  # 2) The native overlay/chat icon is started by desktop-runtime as:
  #      ActiveWindowWatcher.exe --overlay
  # 3) If an older overlay instance is still running, it may keep the old UI/native behavior.
  #    Therefore we MUST restart overlay as part of a runtime restart.
  # 4) After restarting, if the chat panel was already open, close it and reopen once.
  #
  # Testing checklist:
  # - /debug/runtime should show openAiKeyPresent (if you want Whisper STT).
  # - Overlay mic: speak >= 0.5s, expect text inserted into the textarea.
  "[$(Get-Date -Format o)] developer_startup_notes_logged" | Out-File -FilePath $LogFile -Append -Encoding utf8
  $env:SPARK_ROOT_DIR = "$RepoRoot"
  $env:SPARK_COMPANION_HOST = "127.0.0.1"
  if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
  $env:SPARK_WINDOWS_NATIVE_EXE = "$RepoRoot\apps\desktop-native\windows\ActiveWindowWatcher\bin\Release\net6.0-windows\ActiveWindowWatcher.exe"

  # Kill any stale process on companion port to avoid EADDRINUSE
  $staleProcs = Get-NetTCPConnection -LocalPort ([int]$env:SPARK_COMPANION_PORT) -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq "Listen" } |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($stalePid in $staleProcs) {
    if ($stalePid -and $stalePid -ne $PID) {
      "[$(Get-Date -Format o)] killing stale process on port $($env:SPARK_COMPANION_PORT) (PID=$stalePid)" | Out-File -FilePath $LogFile -Append -Encoding utf8
      Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
  }

  # Restart overlay icon (best-effort):
  # Kill only processes started in `--overlay` mode.
  try {
    $overlayProcs = Get-CimInstance Win32_Process -Filter "Name='ActiveWindowWatcher.exe'" | Where-Object {
      $_.CommandLine -like "*--overlay*"
    }
    foreach ($op in $overlayProcs) {
      if ($op.ProcessId -and ($op.ProcessId -ne $PID)) {
        "[$(Get-Date -Format o)] killing stale overlay process (PID=$($op.ProcessId))" | Out-File -FilePath $LogFile -Append -Encoding utf8
        Stop-Process -Id $op.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {
    # non-fatal; runtime will respawn overlay anyway
    "[$(Get-Date -Format o)] overlay restart: CIM failed (continuing)" | Out-File -FilePath $LogFile -Append -Encoding utf8
  }

  if (Test-Path $EnvFile) {
    foreach ($line in (Get-Content -Path $EnvFile)) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $idx = $line.IndexOf('=')
      $key = $line.Substring(0, $idx).Trim()
      $value = $line.Substring($idx + 1).Trim()
      if ($key) {
        [Environment]::SetEnvironmentVariable($key, $value)
      }
    }
  }
  if (-not $env:SPARK_AI_PROVIDER) { $env:SPARK_AI_PROVIDER = "grok" }
  $env:SPARK_RUNTIME_CONFIG_PATH = "$EnvFile"
  $env:SPARK_RUNTIME_LOG_DIR = "$RuntimeLogDir"
  $env:SPARK_WINDOWS_APP_ROOT = "$AppRoot"
  node "dist/apps/desktop-runtime/src/index.js" *>> $LogFile
}
finally {
  Pop-Location
}
