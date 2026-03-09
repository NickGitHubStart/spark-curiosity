param(
  [string]$InstallDir = "",
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
}

$zipUrl = "__DIST_BASE_URL__/spark-curiosity-windows.zip"
$tmpRoot = Join-Path $env:TEMP "spark-curiosity-dist-install"
$zipPath = Join-Path $tmpRoot "spark-curiosity-windows.zip"
$extractDir = Join-Path $tmpRoot "extract"

Write-Host "[dist-install] Downloading release bundle..."
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$srcDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
if (-not $srcDir) { $srcDir = Get-Item $extractDir }

if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
robocopy $srcDir.FullName $InstallDir /E /NFL /NDL /NJH /NJS /NP | Out-Null

$runtimeInstall = Join-Path $InstallDir "scripts\windows\install-runtime.ps1"
if (-not (Test-Path $runtimeInstall)) {
  throw "Missing runtime installer in bundle: $runtimeInstall"
}

if ($NoOnboard) {
  $env:SPARK_NO_ONBOARD = "1"
}

Write-Host "[dist-install] Running runtime installer..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeInstall

Write-Host "[dist-install] Done."
Write-Host "[dist-install] Setup: http://127.0.0.1:4343/setup"
Write-Host "[dist-install] Debug UI: http://127.0.0.1:4343/debug/ui"
