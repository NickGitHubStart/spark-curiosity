# Build Android APK for sideloading / GitHub Releases (debug).
$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")
$AndroidRoot = Join-Path $RepoRoot "apps\android"
$Example = Join-Path $AndroidRoot "app\google-services.json.example"
$GsJson = Join-Path $AndroidRoot "app\google-services.json"
$OutDir = Join-Path $RepoRoot "dist-release"
$OutApk = Join-Path $OutDir "spark-curiosity-android.apk"

if (-not (Test-Path $GsJson)) {
  if (-not (Test-Path $Example)) {
    throw "Missing google-services.json.example (required for local APK builds without Firebase setup)."
  }
  Copy-Item $Example $GsJson
  Write-Host "Copied google-services.json.example to google-services.json (CI stub for build only)" -ForegroundColor Yellow
}

Push-Location $AndroidRoot
try {
  & .\gradlew.bat assembleDebug --no-daemon -q
  if ($LASTEXITCODE -ne 0) { throw "gradlew assembleDebug failed" }
} finally {
  Pop-Location
}

$built = Join-Path $AndroidRoot "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $built)) { throw "APK not found at $built" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item $built $OutApk -Force
Write-Host "APK: $OutApk" -ForegroundColor Green
