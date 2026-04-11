###############################################################################
# sync-local-spark-install.ps1 — copy dist-package → %LOCALAPPDATA%\SparkCuriosity\app
#
# Same payload as SparkSetup.exe (Inno), but direct overwrite so no stale native/*.exe.
# Preserves user-memory.md like the Inno upgrade hook.
#
# Prereq: dist-package exists (npm run build:installer:win or npm run release:win)
###############################################################################
$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")
$Dist = Join-Path $RepoRoot "dist-package"
$Install = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
$UserMemoryRel = "apps\companion\data\user-memory.md"
$TmpBackup = Join-Path $env:TEMP "spark-user-memory.sync-backup.md"

if (-not (Test-Path $Dist)) {
  Write-Error "dist-package not found. Run first: npm run release:win"
}

$destUserMem = Join-Path $Install $UserMemoryRel
if (Test-Path $destUserMem) {
  Copy-Item -LiteralPath $destUserMem -Destination $TmpBackup -Force
  Write-Host "[sync] Backed up user-memory.md" -ForegroundColor DarkGray
}

Write-Host "[sync] Stopping runtime + overlay..." -ForegroundColor Cyan
$stopScript = Join-Path $RepoRoot "scripts\windows\stop-runtime.ps1"
if (Test-Path $stopScript) {
  try { & $stopScript } catch { Write-Host "[sync] stop-runtime: $_" -ForegroundColor Yellow }
}
for ($k = 0; $k -lt 3; $k++) {
  Get-Process -Name "ActiveWindowWatcher" -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 800
}

Write-Host "[sync] Copying dist-package to $Install" -ForegroundColor Cyan
New-Item -ItemType Directory -Path $Install -Force | Out-Null
Get-ChildItem -LiteralPath $Dist -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Install $_.Name) -Recurse -Force
}

# Ensure native overlay exe is not a stale locked copy (Copy-Item can silently leave old file)
$srcAw = Join-Path $Dist "native\ActiveWindowWatcher.exe"
$dstAw = Join-Path $Install "native\ActiveWindowWatcher.exe"
if ((Test-Path $srcAw) -and (Test-Path $dstAw)) {
  $zs = (Get-Item -LiteralPath $srcAw).Length
  $zd = (Get-Item -LiteralPath $dstAw).Length
  if ($zs -ne $zd) {
    Write-Host "[sync] Retrying native\ActiveWindowWatcher.exe (was locked; $zd vs $zs bytes)..." -ForegroundColor Yellow
    for ($try = 0; $try -lt 8; $try++) {
      Get-Process -Name "ActiveWindowWatcher" -ErrorAction SilentlyContinue | Stop-Process -Force
      Start-Sleep -Milliseconds 600
      try {
        Copy-Item -LiteralPath $srcAw -Destination $dstAw -Force
        if ((Get-Item -LiteralPath $dstAw).Length -eq $zs) { break }
      }
      catch { }
      if ($try -eq 7) {
        Write-Error "[sync] Could not overwrite native\ActiveWindowWatcher.exe - close Spark overlay or end task manually, then run npm run sync:spark:win again."
      }
    }
  }
}

if (Test-Path $TmpBackup) {
  $destDir = Split-Path $destUserMem -Parent
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  Copy-Item -LiteralPath $TmpBackup -Destination $destUserMem -Force
  Remove-Item -LiteralPath $TmpBackup -Force -ErrorAction SilentlyContinue
  Write-Host "[sync] Restored user-memory.md" -ForegroundColor DarkGray
}

$aw = Join-Path $Install "native\ActiveWindowWatcher.exe"
if (Test-Path $aw) {
  $i = Get-Item $aw
  Write-Host "[sync] OK native\ActiveWindowWatcher.exe  $($i.Length) bytes  $($i.LastWriteTimeUtc.ToString('s')) UTC" -ForegroundColor Green
} else {
  Write-Host "[sync] WARNING: native\ActiveWindowWatcher.exe missing" -ForegroundColor Yellow
}

Write-Host "[sync] Done. Start runtime: npm run runtime:start:win" -ForegroundColor Green
