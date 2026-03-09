param(
  [string]$Owner = "NickGitHubStart",
  [string]$Repo = "spark-curiosity",
  [string]$Ref = "master",
  [string]$InstallDir = "",
  [switch]$NoOnboard,
  [string]$GitHubToken = ""
)

$ErrorActionPreference = "Stop"

$scriptContent = ""
$scriptUrl = "https://raw.githubusercontent.com/$Owner/$Repo/$Ref/scripts/windows/install.ps1"
try {
  $scriptContent = (Invoke-WebRequest -UseBasicParsing -Uri $scriptUrl).Content
} catch {
  $token = if ($GitHubToken) { $GitHubToken } else { $env:GITHUB_TOKEN }
  if (-not $token) {
    throw "Could not fetch installer via raw URL. For private repos set GITHUB_TOKEN or pass -GitHubToken."
  }
  $apiUrl = "https://api.github.com/repos/$Owner/$Repo/contents/scripts/windows/install.ps1?ref=$Ref"
  $headers = @{
    Authorization = "Bearer $token"
    "User-Agent" = "spark-curiosity-installer"
    Accept = "application/vnd.github.raw"
  }
  $scriptContent = (Invoke-WebRequest -UseBasicParsing -Uri $apiUrl -Headers $headers).Content
}

$bootstrap = [scriptblock]::Create($scriptContent)

if ($NoOnboard) {
  & $bootstrap -Owner $Owner -Repo $Repo -Ref $Ref -InstallDir $InstallDir -NoOnboard
} else {
  & $bootstrap -Owner $Owner -Repo $Repo -Ref $Ref -InstallDir $InstallDir
}
