$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

Write-Host "[auto-update-dev] RepoRoot: $RepoRoot"

Push-Location $RepoRoot
try {
  Write-Host "[auto-update-dev] git pull"
  git pull

  Write-Host "[auto-update-dev] npm install"
  npm install

  Write-Host "[auto-update-dev] build desktop stack"
  npm run build:desktop-stack

  Write-Host "[auto-update-dev] restart runtime"
  npm run runtime:stop:win
  npm run runtime:start:win
}
finally {
  Pop-Location
}
