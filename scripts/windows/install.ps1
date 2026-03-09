param(
  [string]$Owner = "NickGitHubStart",
  [string]$Repo = "spark-curiosity",
  [string]$Ref = "master",
  [string]$InstallDir = "",
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bootstrap = Join-Path $ScriptDir "bootstrap-install.ps1"

if (-not (Test-Path $Bootstrap)) {
  throw "Missing bootstrap script: $Bootstrap"
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $Bootstrap,
  "-Owner", $Owner,
  "-Repo", $Repo,
  "-Ref", $Ref
)

if ($InstallDir) {
  $args += @("-InstallDir", $InstallDir)
}
if ($NoOnboard) {
  $args += "-NoOnboard"
}

Write-Host "[install] owner=$Owner repo=$Repo ref=$Ref"
if ($NoOnboard) { Write-Host "[install] NoOnboard=true" }

& powershell.exe @args
