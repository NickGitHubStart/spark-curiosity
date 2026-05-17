param(
  [string]$Distro = "",
  [string]$LinuxRepoPath = "/home/<user>/projects/spark-curiosity",
  [string]$LocalTarget = "",
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

# --- Resolve WSL distro name ---
if (-not $Distro) {
  if ($PSScriptRoot -like "\\wsl$\*") {
    $parts = $PSScriptRoot.TrimStart("\").Split("\")
    if ($parts.Length -ge 3 -and $parts[0] -eq "wsl$") {
      $Distro = $parts[1]
      $repoWinParts = $parts[2..($parts.Length - 3)]
      $LinuxRepoPath = "/" + ($repoWinParts -join "/")
    }
  }
}
if (-not $Distro) {
  $list = & wsl.exe -l -q 2>$null
  if (-not $list) { throw "No WSL distro found." }
  $Distro = ($list | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
}

if (-not $LocalTarget) {
  $LocalTarget = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
}

$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$BinDir = Join-Path $AppRoot "bin"

# --- Build dist bundle in WSL ---
Write-Host "[install-from-wsl] Building dist bundle in WSL ($Distro)..."
$bundleDir = "$LinuxRepoPath/dist-windows-bundle"
& wsl.exe -d $Distro -e bash -c "cd '$LinuxRepoPath' && bash scripts/create-windows-dist-bundle.sh '$bundleDir'"
if ($LASTEXITCODE -ne 0) {
  throw "Bundle build failed in WSL."
}

# --- Copy zip to Windows via WSL mount ---
New-Item -ItemType Directory -Path $LocalTarget -Force | Out-Null
$drive = $LocalTarget.Substring(0, 1).ToLower()
$rest = $LocalTarget.Substring(2).Replace("\", "/")
$wslTarget = "/mnt/$drive$rest"
$zipLinux = "$bundleDir/spark-curiosity-windows.zip"

Write-Host "[install-from-wsl] Copying bundle to $LocalTarget ..."
& wsl.exe -d $Distro -e bash -c "mkdir -p '$wslTarget' && cp '$zipLinux' '$wslTarget/'"
if ($LASTEXITCODE -ne 0) {
  throw "Copy of bundle zip failed."
}

# --- Extract (to temp first so we can replace or use new folder if locked) ---
$zipPath = Join-Path $LocalTarget "spark-curiosity-windows.zip"
if (-not (Test-Path $zipPath)) {
  throw "Zip not found: $zipPath"
}
$extractTarget = Join-Path $LocalTarget "spark-curiosity"
$tempExtract = Join-Path $LocalTarget "install-temp"
if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue }
Expand-Archive -Path $zipPath -DestinationPath $tempExtract -Force
$extractedFolder = Join-Path $tempExtract "spark-curiosity"
if (-not (Test-Path $extractedFolder)) {
  throw "Zip enthaelt kein spark-curiosity Verzeichnis."
}

if (Test-Path $extractTarget) {
  $stopScript = Join-Path $extractTarget "scripts\windows\stop-runtime.ps1"
  if (Test-Path $stopScript) {
    Write-Host "[install-from-wsl] Stopping existing runtime..."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  $removed = $false
  try {
    Remove-Item $extractTarget -Recurse -Force -ErrorAction Stop
    $removed = $true
  } catch {
    Start-Sleep -Seconds 2
    try { Remove-Item $extractTarget -Recurse -Force -ErrorAction Stop; $removed = $true } catch { }
  }
  if ($removed) {
    Move-Item -Path $extractedFolder -Destination $LocalTarget -Force
  } else {
    $extractTarget = Join-Path $LocalTarget ("spark-curiosity-" + (Get-Date -Format "yyyyMMdd-HHmm"))
    New-Item -ItemType Directory -Path $extractTarget -Force | Out-Null
    Move-Item -Path (Join-Path $extractedFolder "*") -Destination $extractTarget -Force
    Remove-Item $extractedFolder -Force -ErrorAction SilentlyContinue
    Write-Host "[install-from-wsl] Alter Ordner war gesperrt; neues Install unter: $extractTarget"
  }
} else {
  Move-Item -Path $extractedFolder -Destination $LocalTarget -Force
}
if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue }

# --- Find and run installer ---
$runtimeInstaller = Join-Path $extractTarget "scripts\windows\install-runtime.ps1"
if (-not (Test-Path $runtimeInstaller)) {
  $alt = Join-Path $extractTarget "scripts\install-runtime.ps1"
  if (Test-Path $alt) { $runtimeInstaller = $alt }
  else { throw "install-runtime.ps1 not found in bundle." }
}

if ($NoOnboard) { $env:SPARK_NO_ONBOARD = "1" }
Write-Host "[install-from-wsl] Running runtime installer (SkipBuild)..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeInstaller -SkipBuild

# --- Create spark-curiosity.cmd shim + PATH ---
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
$shimPath = Join-Path $BinDir "spark-curiosity.cmd"
$shimLines = @(
  "@echo off"
  "setlocal"
  "set ROOT=$extractTarget"
  "if ""%~1""=="""" goto :status"
  "if /I ""%~1""==""start""  goto :start"
  "if /I ""%~1""==""stop""   goto :stop"
  "if /I ""%~1""==""status"" goto :status"
  "if /I ""%~1""==""uninstall"" goto :uninstall"
  "echo Usage: spark-curiosity [start^|stop^|status^|uninstall]"
  "exit /b 1"
  ""
  ":start"
  "pushd ""%ROOT%"""
  "call npm run runtime:start:win"
  "popd"
  "exit /b %ERRORLEVEL%"
  ""
  ":stop"
  "pushd ""%ROOT%"""
  "call npm run runtime:stop:win"
  "popd"
  "exit /b %ERRORLEVEL%"
  ""
  ":status"
  "pushd ""%ROOT%"""
  "call npm run runtime:status:win"
  "popd"
  "exit /b %ERRORLEVEL%"
  ""
  ":uninstall"
  "pushd ""%ROOT%"""
  "call npm run runtime:uninstall:win"
  "popd"
  "exit /b %ERRORLEVEL%"
)
Set-Content -Path $shimPath -Value ($shimLines -join "`r`n") -Encoding Ascii

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
$pathParts = @()
if ($currentPath) { $pathParts = $currentPath.Split(';') | Where-Object { $_ } }
if (-not ($pathParts -contains $BinDir)) {
  $newPath = if ($currentPath) { "$currentPath;$BinDir" } else { $BinDir }
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  Write-Host "[install-from-wsl] Added to USER PATH: $BinDir"
}

Write-Host ""
Write-Host "[install-from-wsl] Done."
Write-Host "[install-from-wsl] App: $extractTarget"
Write-Host "[install-from-wsl] Shim: $shimPath"
Write-Host "[install-from-wsl] Open a NEW terminal, then: spark-curiosity status"
Write-Host "[install-from-wsl] Setup: http://127.0.0.1:4343/setup"

