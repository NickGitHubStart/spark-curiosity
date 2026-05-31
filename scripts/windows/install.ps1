param(
  [string]$Owner = "",
  [string]$Repo = "spark-curiosity",
  [string]$Ref = "master",
  [string]$InstallDir = "",
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

function Resolve-GitHubOwner([string]$Value) {
  if ($Value) { return $Value }
  try {
    $remote = git remote get-url origin 2>$null
    if ($remote -match 'github\.com[:/]([^/]+)/') { return $Matches[1] }
  } catch {}
  throw "Missing -Owner. Pass your GitHub user/org or run from a git clone with an origin remote."
}

$Owner = Resolve-GitHubOwner $Owner

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
