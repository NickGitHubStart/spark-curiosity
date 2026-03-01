$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

Push-Location $RepoRoot
try {
  Write-Host "[doctor] Building shared + companion..."
  npm run build -w @spark/shared
  npm run build -w @spark/companion

  Write-Host "[doctor] Starting companion in foreground on 127.0.0.1:4343"
  Write-Host "[doctor] Press Ctrl+C to stop."
  $env:SPARK_COMPANION_HOST = "127.0.0.1"
  $env:SPARK_COMPANION_PORT = "4343"
  node "dist/apps/companion/src/index.js"
}
finally {
  Pop-Location
}
