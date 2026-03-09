param(
  [string]$Owner = "NickGitHubStart",
  [string]$Repo = "spark-curiosity",
  [string]$Ref = "master",
  [string]$InstallDir = "",
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

$scriptUrl = "https://raw.githubusercontent.com/$Owner/$Repo/$Ref/scripts/windows/install.ps1"
$scriptContent = (Invoke-WebRequest -UseBasicParsing -Uri $scriptUrl).Content
$bootstrap = [scriptblock]::Create($scriptContent)

if ($NoOnboard) {
  & $bootstrap -Owner $Owner -Repo $Repo -Ref $Ref -InstallDir $InstallDir -NoOnboard
} else {
  & $bootstrap -Owner $Owner -Repo $Repo -Ref $Ref -InstallDir $InstallDir
}
