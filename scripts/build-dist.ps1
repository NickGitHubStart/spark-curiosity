###############################################################################
# build-dist.ps1  –  Creates a distributable package for the Spark installer
#
# Usage:  powershell -File scripts\build-dist.ps1 [-GrokApiKey "xai-..."] [-CloudProxyUrl "https://..."]
#
# Output: dist-package\  (ready for Inno Setup to bundle)
#
# Cloudflare-Proxy: SPARK_CLOUD_PROXY_URL steuert xAI + Whisper-STT (Companion: GROK_BASE_URL /audio/transcriptions).
# Default: spark-proxy.spark-curiosity.workers.dev — überschreiben mit $env:SPARK_CLOUD_PROXY_URL oder -CloudProxyUrl "".
###############################################################################
param(
  [string]$GrokApiKey = $env:SPARK_GROK_API_KEY,
  [string]$SparkModel = $(if ($env:SPARK_MODEL) { $env:SPARK_MODEL } else { "grok-4-1-fast" }),
  [string]$CloudProxyUrl = $env:SPARK_CLOUD_PROXY_URL,
  [string]$DiscordBugWebhook = $env:SPARK_DISCORD_BUG_WEBHOOK,
  [string]$NodeVersion = "20.18.1"
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")
$Dist = Join-Path $RepoRoot "dist-package"

# Load .env from repo root so baked-in values (webhook, keys) are available
$dotEnvPath = Join-Path $RepoRoot ".env"
if (Test-Path $dotEnvPath) {
  foreach ($line in Get-Content $dotEnvPath) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $idx = $t.IndexOf('=')
    if ($idx -le 0) { continue }
    $key = $t.Substring(0, $idx).Trim()
    $val = $t.Substring($idx + 1).Trim()
    # Only set if not already provided via param/env
    if (-not [Environment]::GetEnvironmentVariable($key)) {
      [Environment]::SetEnvironmentVariable($key, $val)
    }
  }
  # Backfill params from loaded .env if they were empty
  if ([string]::IsNullOrWhiteSpace($DiscordBugWebhook)) { $DiscordBugWebhook = $env:SPARK_DISCORD_BUG_WEBHOOK }
  if ([string]::IsNullOrWhiteSpace($GrokApiKey)) { $GrokApiKey = $env:SPARK_GROK_API_KEY }
}

if ([string]::IsNullOrWhiteSpace($CloudProxyUrl)) {
  $CloudProxyUrl = "https://spark-proxy.spark-curiosity.workers.dev"
}

Write-Host "=== Spark Build Pipeline ===" -ForegroundColor Cyan
Write-Host "  RepoRoot:    $RepoRoot"
Write-Host "  Output:      $Dist"
Write-Host "  NodeVersion: $NodeVersion"
Write-Host "  CloudProxy:  $CloudProxyUrl" -ForegroundColor DarkGray

# ---- Clean previous build ----
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Path $Dist -Force | Out-Null

# ---- Step 1: npm install + build ----
# npm writes warnings to stderr; with $ErrorActionPreference Stop, PowerShell would treat them as terminating errors.
function Invoke-NpmStep {
  param([string[]]$NpmArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    & npm @NpmArgs 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm $($NpmArgs -join ' ') failed with exit $LASTEXITCODE" }
  } finally {
    $ErrorActionPreference = $prev
  }
}
Push-Location $RepoRoot
try {
  Write-Host "`n[1/6] npm install..." -ForegroundColor Yellow
  Invoke-NpmStep @("ci", "--ignore-scripts")
  Write-Host "[2/6] TypeScript build..." -ForegroundColor Yellow
  Invoke-NpmStep @("run", "build")
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

# Native overlay — MUST be dotnet publish into dist-package/native (not dotnet build to bin/Release).
# `dotnet build` only writes under apps/.../bin/Release/...; the Inno installer bundles $Dist/native only.
# Skipping publish or copying stale files from bin/ silently ships an outdated ActiveWindowWatcher.exe.
$nativeCsproj = Join-Path $RepoRoot "apps\desktop-native\windows\ActiveWindowWatcher\ActiveWindowWatcher.csproj"
$nativeDest = Join-Path $Dist "native"
New-Item -ItemType Directory -Path $nativeDest -Force | Out-Null
if (Get-Command dotnet -ErrorAction SilentlyContinue) {
  Write-Host "Publishing ActiveWindowWatcher (self-contained)..."
  # -c Release: Debug-only `dotnet build` under bin/Debug does NOT feed the installer; only this publish output lands in dist-package/native.
  dotnet publish $nativeCsproj -c Release -r win-x64 --self-contained true -o $nativeDest --nologo -v quiet
  $aw = Join-Path $nativeDest "ActiveWindowWatcher.exe"
  if (Test-Path $aw) {
    $i = Get-Item $aw
    Write-Host "ActiveWindowWatcher published to $nativeDest" -ForegroundColor Green
    Write-Host ("  -> {0:N1} MB, LastWrite: {1}" -f ($i.Length / 1MB), $i.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
  } else {
    Write-Host "ActiveWindowWatcher published to $nativeDest (warning: ActiveWindowWatcher.exe missing)" -ForegroundColor Yellow
  }
} else {
  # Fallback: copy pre-built binaries if dotnet CLI not available
  $nativeSrc = Join-Path $RepoRoot "apps\desktop-native\windows\ActiveWindowWatcher\bin\Release\net6.0-windows\win-x64\publish"
  if (-not (Test-Path $nativeSrc)) {
    $nativeSrc = Join-Path $RepoRoot "apps\desktop-native\windows\ActiveWindowWatcher\bin\Release\net6.0-windows"
  }
  if (Test-Path $nativeSrc) {
    Get-ChildItem $nativeSrc -Filter "*.exe" | ForEach-Object { Copy-Item $_.FullName $nativeDest -Force }
    Get-ChildItem $nativeSrc -Filter "*.dll" | ForEach-Object { Copy-Item $_.FullName $nativeDest -Force }
    Get-ChildItem $nativeSrc -Filter "*.json" | ForEach-Object { Copy-Item $_.FullName $nativeDest -Force }
  }
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
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    & npm install --omit=dev --ignore-scripts 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm install in dist-package failed with exit $LASTEXITCODE" }
  } finally {
    $ErrorActionPreference = $prevEa
  }
} finally { Pop-Location }

# ---- Step 5: Write baked-in config ----
Write-Host "[6/6] Writing runtime config..." -ForegroundColor Yellow
$configDir = Join-Path $Dist "config"
New-Item -ItemType Directory -Path $configDir -Force | Out-Null
$envLines = @(
  "SPARK_GROK_API_KEY=$GrokApiKey"
  "SPARK_MODEL=$SparkModel"
)
if ($CloudProxyUrl) {
  $envLines += "SPARK_CLOUD_PROXY_URL=$CloudProxyUrl"
}
if ($DiscordBugWebhook) {
  $envLines += "SPARK_DISCORD_BUG_WEBHOOK=$DiscordBugWebhook"
}
$envContent = $envLines -join "`n"
Set-Content -Path (Join-Path $configDir "runtime.env") -Value $envContent -Encoding Ascii

# ---- Step 6: Entry shim ----
$shimContent = @"
@echo off
set SPARK_ROOT_DIR=%~dp0
set SPARK_COMPANION_HOST=127.0.0.1
if not defined SPARK_COMPANION_PORT set SPARK_COMPANION_PORT=4343
"%~dp0node.exe" "%~dp0dist\apps\desktop-runtime\src\index.js" %*
"@
Set-Content -Path (Join-Path $Dist "spark-runtime.cmd") -Value $shimContent -Encoding Ascii

# ---- Done ----
$totalSize = [math]::Round(((Get-ChildItem $Dist -Recurse | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "`n=== Build complete: $totalSize MB ===" -ForegroundColor Green
Write-Host "  Output: $Dist"
Write-Host "  Next:   Run Inno Setup compiler on installer\spark-setup.iss"
