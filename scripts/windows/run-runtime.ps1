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
  $env:SPARK_ROOT_DIR = "$RepoRoot"
  $env:SPARK_COMPANION_HOST = "127.0.0.1"
  if (-not $env:SPARK_COMPANION_PORT) { $env:SPARK_COMPANION_PORT = "4343" }
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
  $env:SPARK_RUNTIME_LOG_DIR = "$RuntimeLogDir"
  $env:SPARK_WINDOWS_APP_ROOT = "$AppRoot"
  node "dist/apps/desktop-runtime/src/index.js" *>> $LogFile
}
finally {
  Pop-Location
}
