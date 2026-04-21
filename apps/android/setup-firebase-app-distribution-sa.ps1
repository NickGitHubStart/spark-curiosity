# Creates a Google service account + JSON key for Firebase App Distribution (Gradle uploads).
# Prerequisite: Google Cloud SDK (gcloud): https://cloud.google.com/sdk/docs/install
# One-time: gcloud auth login
#
# Usage:
#   .\setup-firebase-app-distribution-sa.ps1
#   .\setup-firebase-app-distribution-sa.ps1 -ReplaceKey
#
param(
    [string] $ProjectId = "",
    [switch] $ReplaceKey
)

$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host 'gcloud missing. Install: https://cloud.google.com/sdk/docs/install' -ForegroundColor Red
    exit 1
}

$gsJson = Join-Path $PSScriptRoot "app\google-services.json"
if (-not (Test-Path $gsJson)) {
    Write-Host 'Missing: app\google-services.json (download from Firebase Console).' -ForegroundColor Red
    exit 1
}

if (-not $ProjectId) {
    $ProjectId = (Get-Content $gsJson -Raw | ConvertFrom-Json).project_info.project_id
    if (-not $ProjectId) {
        Write-Host 'Could not read project_id from google-services.json.' -ForegroundColor Red
        exit 1
    }
}

$keyOut = Join-Path $PSScriptRoot "firebase-app-distribution-sa.json"
if ((Test-Path $keyOut) -and -not $ReplaceKey) {
    Write-Host ('Already exists: ' + $keyOut) -ForegroundColor Green
    Write-Host 'For new key: .\setup-firebase-app-distribution-sa.ps1 -ReplaceKey' -ForegroundColor Yellow
    exit 0
}

Write-Host ('Project: ' + $ProjectId) -ForegroundColor Cyan

& gcloud projects describe $ProjectId 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'gcloud cannot read project. Run: gcloud auth login' -ForegroundColor Red
    Write-Host ('Then: gcloud config set project ' + $ProjectId) -ForegroundColor Yellow
    exit 1
}

Write-Host 'Enabling Firebase App Distribution API...' -ForegroundColor Cyan
& gcloud services enable firebaseappdistribution.googleapis.com --project=$ProjectId
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$saAccountId = "firebase-app-dist-upload"
$saEmail = "$saAccountId@$ProjectId.iam.gserviceaccount.com"

& gcloud iam service-accounts describe $saEmail --project=$ProjectId 1>$null 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host ('Creating service account: ' + $saAccountId) -ForegroundColor Cyan
    & gcloud iam service-accounts create $saAccountId `
        --project=$ProjectId `
        --display-name="Firebase App Distribution (Gradle)"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host ('Service account already exists: ' + $saEmail) -ForegroundColor Green
}

Write-Host 'Waiting until service account is visible to IAM...' -ForegroundColor Cyan
$saVisible = $false
for ($i = 1; $i -le 25; $i++) {
    & gcloud iam service-accounts describe $saEmail --project=$ProjectId 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        $saVisible = $true
        break
    }
    Write-Host ('  wait ' + $i + '/25 (3s)') -ForegroundColor DarkGray
    Start-Sleep -Seconds 3
}
if (-not $saVisible) {
    Write-Host 'Timeout. Retry later: .\setup-firebase-app-distribution-sa.ps1' -ForegroundColor Red
    exit 1
}

Write-Host 'Granting Firebase App Distribution Admin...' -ForegroundColor Cyan
$bindingOk = $false
for ($j = 1; $j -le 8; $j++) {
    & gcloud projects add-iam-policy-binding $ProjectId `
        --member="serviceAccount:$saEmail" `
        --role="roles/firebaseappdistro.admin" `
        --quiet
    if ($LASTEXITCODE -eq 0) {
        $bindingOk = $true
        break
    }
    Write-Host ('  binding retry ' + $j + '/8, sleep 5s') -ForegroundColor DarkYellow
    Start-Sleep -Seconds 5
}
if (-not $bindingOk) {
    Write-Host 'add-iam-policy-binding failed. Set role in Cloud Console IAM, then run again.' -ForegroundColor Red
    exit 1
}

if (Test-Path $keyOut) {
    Remove-Item $keyOut -Force
}

Write-Host 'Creating JSON key file (secret, do not commit)...' -ForegroundColor Cyan
& gcloud iam service-accounts keys create $keyOut --iam-account=$saEmail --project=$ProjectId
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host ('Done: ' + $keyOut) -ForegroundColor Green
Write-Host 'Upload: .\upload-app-distribution.ps1' -ForegroundColor Green
