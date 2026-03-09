param(
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Installer = Join-Path $RepoRoot "scripts\windows\install-runtime.ps1"

if (-not (Test-Path $Installer)) {
  throw "Installer not found: $Installer"
}

Write-Host "[install-local] Repo root: $RepoRoot"
if ($NoOnboard) { $env:SPARK_NO_ONBOARD = "1" }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Installer
