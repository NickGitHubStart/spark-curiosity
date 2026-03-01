$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$LogDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir "runtime-windows.log"
$RuntimeLogDir = Join-Path $LogDir "runtime"
New-Item -ItemType Directory -Path $RuntimeLogDir -Force | Out-Null

Push-Location $RepoRoot
try {
  "[$(Get-Date -Format o)] run-runtime.ps1 started" | Out-File -FilePath $LogFile -Append -Encoding utf8
  $env:SPARK_ROOT_DIR = "$RepoRoot"
  $env:SPARK_COMPANION_HOST = "127.0.0.1"
  if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
  $env:SPARK_RUNTIME_LOG_DIR = "$RuntimeLogDir"
  $env:SPARK_WINDOWS_APP_ROOT = "$AppRoot"
  node "dist/apps/desktop-runtime/src/index.js" *>> $LogFile
}
finally {
  Pop-Location
}
