# Uploads the debug APK to Firebase App Distribution (see firebase-setup.txt).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "app\google-services.json")) {
    Write-Host "Fehlt: app\google-services.json - bitte aus Firebase Console laden (siehe firebase-setup.txt)." -ForegroundColor Red
    exit 1
}

$hasSa = Test-Path "firebase-app-distribution-sa.json"
if (-not $hasSa -and -not $env:FIREBASE_TOKEN) {
    Write-Host "Hinweis: Weder firebase-app-distribution-sa.json noch FIREBASE_TOKEN." -ForegroundColor Yellow
    Write-Host "  Dauerhaft: Service Account JSON als firebase-app-distribution-sa.json (siehe firebase-setup.txt)." -ForegroundColor Yellow
    Write-Host '  Oder: firebase login:ci und $env:FIREBASE_TOKEN = "..."' -ForegroundColor Gray
    Write-Host "  Oder: firebase login (interaktiv) in dieser Session." -ForegroundColor Yellow
    Write-Host ""
}

& .\gradlew.bat --stop 2>$null
& .\gradlew.bat assembleDebug appDistributionUploadDebug
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Fertig. Tester erhalten E-Mail und sehen die neue Version in der Firebase App Distribution App." -ForegroundColor Green
