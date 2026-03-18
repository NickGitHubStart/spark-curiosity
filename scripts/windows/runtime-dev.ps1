$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

function Start-WatchProcess([string]$command) {
  $p = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command
  return $p
}

function Get-LatestWriteTime([string[]]$paths) {
  $latest = Get-Date "2000-01-01"
  foreach ($p in $paths) {
    if (-not (Test-Path $p)) { continue }
    $item = Get-ChildItem -Path $p -Recurse -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($item -and $item.LastWriteTime -gt $latest) { $latest = $item.LastWriteTime }
  }
  return $latest
}

Write-Host "[runtime-dev] Repo: $RepoRoot"
Push-Location $RepoRoot

try {
  Write-Host "[runtime-dev] Starting build watchers..."
  $watchers = @()
  $watchers += Start-WatchProcess "cd `"$RepoRoot`"; npm run build -w @spark/shared -- --watch"
  $watchers += Start-WatchProcess "cd `"$RepoRoot`"; npm run build -w @spark/companion -- --watch"
  $watchers += Start-WatchProcess "cd `"$RepoRoot`"; npm run build -w @spark/desktop-agent -- --watch"
  $watchers += Start-WatchProcess "cd `"$RepoRoot`"; npm run build -w @spark/desktop-runtime -- --watch"

  Write-Host "[runtime-dev] Starting runtime..."
  cmd /c "npm run runtime:start:win" | Out-Null

  $distPaths = @(
    (Join-Path $RepoRoot "dist\apps\companion\src"),
    (Join-Path $RepoRoot "dist\apps\desktop-agent\src"),
    (Join-Path $RepoRoot "dist\apps\desktop-runtime\src"),
    (Join-Path $RepoRoot "dist\packages\shared\src")
  )
  $lastSeen = Get-LatestWriteTime $distPaths
  $lastRestart = Get-Date "2000-01-01"

  Write-Host "[runtime-dev] Watching dist outputs. Press Ctrl+C to stop."
  while ($true) {
    Start-Sleep -Milliseconds 750
    $latest = Get-LatestWriteTime $distPaths
    if ($latest -gt $lastSeen) {
      $lastSeen = $latest
      $since = (New-TimeSpan -Start $lastRestart -End (Get-Date)).TotalSeconds
      if ($since -lt 2) { continue }
      $lastRestart = Get-Date
      Write-Host "[runtime-dev] Change detected -> runtime restart"
      cmd /c "npm run runtime:restart:win" | Out-Null
    }
  }
}
finally {
  Pop-Location
}
