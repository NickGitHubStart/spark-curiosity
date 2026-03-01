param(
  [string]$RepoUrl = "",
  [string]$InstallDir = ""
)

$ErrorActionPreference = 'Stop'

if (-not $RepoUrl) {
  Write-Host "[quick-install] Missing -RepoUrl."
  Write-Host "Example:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\\scripts\\windows\\quick-install.ps1 -RepoUrl https://github.com/ORG_OR_USER/spark-curiosity.git"
  exit 1
}

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:USERPROFILE "spark-curiosity"
}

function Require-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Require-Command "git"
Require-Command "node"
Require-Command "npm"

Write-Host "[quick-install] RepoUrl: $RepoUrl"
Write-Host "[quick-install] InstallDir: $InstallDir"

if (Test-Path $InstallDir) {
  if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "[quick-install] Existing repo found. Pulling latest changes..."
    git -C $InstallDir pull --ff-only
  } else {
    throw "InstallDir exists but is not a git repo: $InstallDir"
  }
} else {
  Write-Host "[quick-install] Cloning repository..."
  git clone $RepoUrl $InstallDir
}

Push-Location $InstallDir
try {
  Write-Host "[quick-install] Installing dependencies..."
  npm install

  Write-Host "[quick-install] Installing background runtime..."
  npm run runtime:install:win

  Write-Host "[quick-install] Checking runtime status..."
  npm run runtime:status:win
}
finally {
  Pop-Location
}

Write-Host "[quick-install] Done."
Write-Host "[quick-install] Debug UI: http://127.0.0.1:4343/debug/ui"
