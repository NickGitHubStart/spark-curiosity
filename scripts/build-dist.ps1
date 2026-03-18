###############################################################################
# build-dist.ps1  –  Creates a distributable package for the Spark installer
#
# Usage:  powershell -File scripts\build-dist.ps1 [-GrokApiKey "xai-..."]
#
# Output: dist-package\  (ready for Inno Setup to bundle)
###############################################################################
param(
  [string]$GrokApiKey = $env:SPARK_GROK_API_KEY,
  [string]$NodeVersion = "20.18.1"
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")
$Dist = Join-Path $RepoRoot "dist-package"

Write-Host "=== Spark Build Pipeline ===" -ForegroundColor Cyan
Write-Host "  RepoRoot:    $RepoRoot"
Write-Host "  Output:      $Dist"
Write-Host "  NodeVersion: $NodeVersion"

# ---- Clean previous build ----
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Path $Dist -Force | Out-Null

# ---- Step 1: npm install + build ----
Push-Location $RepoRoot
try {
  Write-Host "`n[1/6] npm install..." -ForegroundColor Yellow
  npm ci --ignore-scripts 2>&1 | Out-Null
  Write-Host "[2/6] TypeScript build..." -ForegroundColor Yellow
  npm run build 2>&1 | Out-Null
} finally { Pop-Location }

# ---- Step 2: Download Node.js binary ----
$NodeZip = Join-Path $env:TEMP "node-v$NodeVersion-win-x64.zip"
$NodeExe = Join-Path $Dist "node.exe"
if (-not (Test-Path $NodeExe)) {
  Write-Host "[3/6] Downloading Node.js v$NodeVersion..." -ForegroundColor Yellow
  $nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
  if (-not (Test-Path $NodeZip)) {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $NodeZip -UseBasicParsing
  }
  $extractDir = Join-Path $env:TEMP "node-extract-$NodeVersion"
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $NodeZip -DestinationPath $extractDir -Force
  Copy-Item (Join-Path $extractDir "node-v$NodeVersion-win-x64\node.exe") $NodeExe
  Remove-Item $extractDir -Recurse -Force
  Write-Host "  node.exe: $([math]::Round((Get-Item $NodeExe).Length / 1MB, 1)) MB"
}

# ---- Step 3: Copy application files ----
Write-Host "[4/6] Copying application files..." -ForegroundColor Yellow

# Compiled JS
Copy-Item -Recurse (Join-Path $RepoRoot "dist") (Join-Path $Dist "dist")

# Companion data (templates, prompts, assets)
$companionData = Join-Path $Dist "apps\companion"
New-Item -ItemType Directory -Path $companionData -Force | Out-Null
Copy-Item -Recurse (Join-Path $RepoRoot "apps\companion\data") (Join-Path $companionData "data")
Copy-Item -Recurse (Join-Path $RepoRoot "apps\companion\prompts") (Join-Path $companionData "prompts")

# Chrome extension source
$extDest = Join-Path $Dist "apps\desktop-agent\extension"
New-Item -ItemType Directory -Path (Split-Path $extDest) -Force | Out-Null
Copy-Item -Recurse (Join-Path $RepoRoot "apps\desktop-agent\extension") $extDest

# Native overlay (pre-built C# binary)
$nativeSrc = Join-Path $RepoRoot "apps\desktop-native\windows\ActiveWindowWatcher\bin\Release\net6.0-windows"
if (Test-Path $nativeSrc) {
  $nativeDest = Join-Path $Dist "native"
  New-Item -ItemType Directory -Path $nativeDest -Force | Out-Null
  Copy-Item (Join-Path $nativeSrc "ActiveWindowWatcher.exe") $nativeDest
  Copy-Item (Join-Path $nativeSrc "ActiveWindowWatcher.dll") $nativeDest
  # Copy all required .dll runtime files
  Get-ChildItem $nativeSrc -Filter "*.dll" | ForEach-Object { Copy-Item $_.FullName $nativeDest -Force }
  Get-ChildItem $nativeSrc -Filter "*.json" | ForEach-Object { Copy-Item $_.FullName $nativeDest -Force }
}

# Scripts
$scriptsDest = Join-Path $Dist "scripts\windows"
New-Item -ItemType Directory -Path $scriptsDest -Force | Out-Null
Copy-Item (Join-Path $RepoRoot "scripts\windows\run-runtime.ps1") $scriptsDest
Copy-Item (Join-Path $RepoRoot "scripts\windows\start-runtime.ps1") $scriptsDest
Copy-Item (Join-Path $RepoRoot "scripts\windows\stop-runtime.ps1") $scriptsDest
Copy-Item (Join-Path $RepoRoot "scripts\windows\install-runtime.ps1") $scriptsDest

# Root package.json (needed for version info)
Copy-Item (Join-Path $RepoRoot "package.json") $Dist

# Icon
$iconSrc = Join-Path $RepoRoot "icon_round.jpg"
if (Test-Path $iconSrc) { Copy-Item $iconSrc $Dist }

# ---- Step 4: Production node_modules ----
Write-Host "[5/6] Installing production dependencies..." -ForegroundColor Yellow
Push-Location $Dist
try {
  # Copy package files needed for npm install
  Copy-Item (Join-Path $RepoRoot "package-lock.json") $Dist -ErrorAction SilentlyContinue
  & $NodeExe -e "1" 2>$null  # Verify node.exe works
  npm install --omit=dev --ignore-scripts 2>&1 | Out-Null
} finally { Pop-Location }

# ---- Step 5: Write baked-in config ----
Write-Host "[6/6] Writing runtime config..." -ForegroundColor Yellow
$configDir = Join-Path $Dist "config"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$envContent = @(
  "SPARK_GROK_API_KEY=$GrokApiKey"
  "SPARK_GROK_MODEL=grok-4-1-fast-reasoning"
) -join "`n"
Set-Content -Path (Join-Path $configDir "runtime.env") -Value $envContent -Encoding Ascii

# ---- Step 6: Entry shim ----
$shimContent = @"
@echo off
set SPARK_ROOT_DIR=%~dp0
"%~dp0node.exe" "%~dp0dist\apps\desktop-runtime\src\index.js" %*
"@
Set-Content -Path (Join-Path $Dist "spark-runtime.cmd") -Value $shimContent -Encoding Ascii

# ---- Done ----
$totalSize = [math]::Round(((Get-ChildItem $Dist -Recurse | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "`n=== Build complete: $totalSize MB ===" -ForegroundColor Green
Write-Host "  Output: $Dist"
Write-Host "  Next:   Run Inno Setup compiler on installer\spark-setup.iss"
