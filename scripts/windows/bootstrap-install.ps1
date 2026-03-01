param(
  [string]$Owner = "NickGitHubStart",
  [string]$Repo = "spark-curiosity",
  [string]$Ref = "master",
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Require-Command "node"
Require-Command "npm"

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
}

$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$TmpRoot = Join-Path $env:TEMP "spark-curiosity-bootstrap"
$ZipPath = Join-Path $TmpRoot "repo.zip"
$ExtractDir = Join-Path $TmpRoot "repo"
$BinDir = Join-Path $AppRoot "bin"
$ShimPath = Join-Path $BinDir "spark-curiosity.cmd"

$ZipUrl = "https://github.com/$Owner/$Repo/archive/refs/heads/$Ref.zip"

Write-Host "[bootstrap] Downloading $ZipUrl"
New-Item -ItemType Directory -Path $TmpRoot -Force | Out-Null
New-Item -ItemType Directory -Path $AppRoot -Force | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $ZipUrl -OutFile $ZipPath

if (Test-Path $ExtractDir) {
  Remove-Item $ExtractDir -Recurse -Force
}
New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force

$RepoDir = Get-ChildItem -Path $ExtractDir -Directory | Select-Object -First 1
if (-not $RepoDir) {
  throw "Could not find extracted repo directory."
}

if (Test-Path $InstallDir) {
  Write-Host "[bootstrap] Cleaning old install: $InstallDir"
  Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

Write-Host "[bootstrap] Copying files to $InstallDir"
robocopy $RepoDir.FullName $InstallDir /E /NFL /NDL /NJH /NJS /NP | Out-Null

Push-Location $InstallDir
try {
  Write-Host "[bootstrap] npm install"
  npm install

  Write-Host "[bootstrap] runtime install"
  npm run runtime:install:win
}
finally {
  Pop-Location
}

New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$shim = @"
@echo off
setlocal
set ROOT=$InstallDir
if "%~1"=="" goto :status
if /I "%~1"=="start"  goto :start
if /I "%~1"=="stop"   goto :stop
if /I "%~1"=="status" goto :status
if /I "%~1"=="uninstall" goto :uninstall
echo Usage: spark-curiosity [start^|stop^|status^|uninstall]
exit /b 1

:start
pushd "%ROOT%"
call npm run runtime:start:win
popd
exit /b %ERRORLEVEL%

:stop
pushd "%ROOT%"
call npm run runtime:stop:win
popd
exit /b %ERRORLEVEL%

:status
pushd "%ROOT%"
call npm run runtime:status:win
popd
exit /b %ERRORLEVEL%

:uninstall
pushd "%ROOT%"
call npm run runtime:uninstall:win
popd
exit /b %ERRORLEVEL%
"@
Set-Content -Path $ShimPath -Value $shim -Encoding Ascii

Write-Host ""
Write-Host "[bootstrap] Installed successfully."
Write-Host "[bootstrap] App dir: $InstallDir"
Write-Host "[bootstrap] Control shim: $ShimPath"
Write-Host "[bootstrap] Debug UI: http://127.0.0.1:4343/debug/ui"
Write-Host ""
Write-Host "Commands:"
Write-Host "  `"$ShimPath`" status"
Write-Host "  `"$ShimPath`" start"
Write-Host "  `"$ShimPath`" stop"
