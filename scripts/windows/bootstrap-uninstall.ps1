param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
}

$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$ShimPath = Join-Path $AppRoot "bin\spark-curiosity.cmd"

if (Test-Path $InstallDir) {
  Push-Location $InstallDir
  try {
    npm run runtime:uninstall:win
  } catch {
    Write-Host "[bootstrap-uninstall] runtime uninstall failed: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
}

if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
  Write-Host "[bootstrap-uninstall] Removed $InstallDir"
}

if (Test-Path $ShimPath) {
  Remove-Item $ShimPath -Force
  Write-Host "[bootstrap-uninstall] Removed shim $ShimPath"
}

Write-Host "[bootstrap-uninstall] Done."
