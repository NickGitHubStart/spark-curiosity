param(
  [string]$Owner = "",
  [string]$Repo = "spark-curiosity",
  [string]$Ref = "master",
  [string]$Version = "",
  [string]$InstallDir = "",
  [switch]$NoOnboard,
  [string]$GitHubToken = "",
  [switch]$UseSourceInstall
)

$ErrorActionPreference = "Stop"

function Resolve-GitHubOwner([string]$Value) {
  if ($Value) { return $Value }
  try {
    $remote = git remote get-url origin 2>$null
    if ($remote -match 'github\.com[:/]([^/]+)/') { return $Matches[1] }
  } catch {}
  throw "Missing -Owner. Pass your GitHub user/org or run from a git clone with an origin remote."
}

$Owner = Resolve-GitHubOwner $Owner

$token = if ($GitHubToken) { $GitHubToken } else { $env:GITHUB_TOKEN }
$headers = @{ "User-Agent" = "spark-curiosity-installer" }
if ($token) {
  $headers["Authorization"] = "Bearer $token"
}

if ($UseSourceInstall) {
  $scriptContent = ""
  $scriptUrl = "https://raw.githubusercontent.com/$Owner/$Repo/$Ref/scripts/windows/install.ps1"
  try {
    $scriptContent = (Invoke-WebRequest -UseBasicParsing -Uri $scriptUrl -Headers $headers).Content
  } catch {
    if (-not $token) {
      throw "Could not fetch source installer via raw URL. Set GITHUB_TOKEN or use release-based install."
    }
    $apiUrl = "https://api.github.com/repos/$Owner/$Repo/contents/scripts/windows/install.ps1?ref=$Ref"
    $headers["Accept"] = "application/vnd.github.raw"
    $scriptContent = (Invoke-WebRequest -UseBasicParsing -Uri $apiUrl -Headers $headers).Content
  }
  $bootstrap = [scriptblock]::Create($scriptContent)
  if ($NoOnboard) {
    & $bootstrap -Owner $Owner -Repo $Repo -Ref $Ref -InstallDir $InstallDir -NoOnboard
  } else {
    & $bootstrap -Owner $Owner -Repo $Repo -Ref $Ref -InstallDir $InstallDir
  }
  exit 0
}

if (-not $InstallDir) {
  $InstallDir = Join-Path $env:LOCALAPPDATA "SparkCuriosity\app"
}

$releaseApiUrl = if ($Version) {
  "https://api.github.com/repos/$Owner/$Repo/releases/tags/$Version"
} else {
  "https://api.github.com/repos/$Owner/$Repo/releases/latest"
}

Write-Host "[install] Fetching release metadata..."
$release = Invoke-WebRequest -UseBasicParsing -Uri $releaseApiUrl -Headers $headers | Select-Object -ExpandProperty Content | ConvertFrom-Json

$asset = $release.assets | Where-Object { $_.name -eq "spark-curiosity-windows.zip" } | Select-Object -First 1
if (-not $asset) {
  $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
}
if (-not $asset) {
  throw "No ZIP release asset found. Expected spark-curiosity-windows.zip."
}

$tmpRoot = Join-Path $env:TEMP "spark-curiosity-install"
$zipPath = Join-Path $tmpRoot "spark-curiosity.zip"
$extractDir = Join-Path $tmpRoot "extract"
New-Item -ItemType Directory -Path $tmpRoot -Force | Out-Null
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

Write-Host "[install] Downloading asset $($asset.name)..."
Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -Headers $headers -OutFile $zipPath
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$srcDir = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
if (-not $srcDir) {
  $srcDir = Get-Item $extractDir
}

if (Test-Path $InstallDir) {
  Remove-Item $InstallDir -Recurse -Force
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
robocopy $srcDir.FullName $InstallDir /E /NFL /NDL /NJH /NJS /NP | Out-Null

$appRoot = Join-Path $env:LOCALAPPDATA "SparkCuriosity"
New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
$metaPath = Join-Path $appRoot "install-meta.json"
$meta = @{
  owner = $Owner
  repo = $Repo
  ref = $Ref
  version = $release.tag_name
  installDir = $InstallDir
  mode = "release"
}
$meta | ConvertTo-Json | Set-Content -Path $metaPath -Encoding Ascii

$runtimeInstall = Join-Path $InstallDir "scripts\windows\install-runtime.ps1"
if (-not (Test-Path $runtimeInstall)) {
  throw "Missing runtime installer inside release artifact: $runtimeInstall"
}

if ($NoOnboard) {
  $env:SPARK_NO_ONBOARD = "1"
}

Write-Host "[install] Running runtime installer from release..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtimeInstall
Write-Host "[install] Done."
Write-Host "[install] Release: $($release.tag_name)"
Write-Host "[install] Debug UI: http://127.0.0.1:4343/debug/ui"
