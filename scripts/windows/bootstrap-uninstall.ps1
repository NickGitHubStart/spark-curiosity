param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
}

$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$ShimPath = Join-Path $AppRoot "bin\spark-curiosity.cmd"
$MetaPath = Join-Path $AppRoot "install-meta.json"
$BinDir = Join-Path $AppRoot "bin"

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

if (Test-Path $MetaPath) {
  Remove-Item $MetaPath -Force
  Write-Host "[bootstrap-uninstall] Removed metadata $MetaPath"
}

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath) {
  $newPath = ($currentPath.Split(';') | Where-Object { $_ -and ($_ -ne $BinDir) }) -join ';'
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "[bootstrap-uninstall] Removed bin dir from USER PATH"
}

Write-Host "[bootstrap-uninstall] Done."
