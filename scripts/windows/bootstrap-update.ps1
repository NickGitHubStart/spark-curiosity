$ErrorActionPreference = "Stop"

$AppRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
$MetaPath = Join-Path $AppRoot "install-meta.json"

if (-not (Test-Path $MetaPath)) {
  throw "Missing install metadata: $MetaPath. Re-run bootstrap install first."
}

$meta = Get-Content -Path $MetaPath | ConvertFrom-Json
$owner = [string]$meta.owner
$repo = [string]$meta.repo
$ref = [string]$meta.ref
$installDir = [string]$meta.installDir

if (-not $owner -or -not $repo -or -not $ref -or -not $installDir) {
  throw "Invalid install metadata. Re-run bootstrap install."
}

$installScript = Join-Path $installDir "scripts\windows\bootstrap-install.ps1"
if (-not (Test-Path $installScript)) {
  throw "Missing bootstrap-install script at $installScript"
}

Write-Host "[bootstrap-update] Updating from $owner/$repo ref=$ref..."
powershell -NoProfile -ExecutionPolicy Bypass -File $installScript -Owner $owner -Repo $repo -Ref $ref -InstallDir $installDir
Write-Host "[bootstrap-update] Done."
