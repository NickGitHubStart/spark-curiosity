###############################################################################
# build-installer.ps1 – dist-package + SparkSetup.exe
#
# 1) scripts\build-dist.ps1
# 2) Inno Setup ISCC auf installer\spark-setup.iss
#
# Output: dist-installer\SparkSetup.exe
###############################################################################
$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..")
$Iss = Join-Path $RepoRoot "installer\spark-setup.iss"

$pkgPath = Join-Path $RepoRoot "package.json"
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$appVer = $pkg.version
if ([string]::IsNullOrWhiteSpace($appVer)) { throw "package.json missing version" }
Write-Host "App version (from package.json): $appVer" -ForegroundColor Cyan

# ISCC liegt bei winget/Standard-Install oft unter LOCALAPPDATA\Programs\Inno Setup 6\
# und ist meist NICHT in PATH — `where ISCC` / `where.exe ISCC` scheitern dann mit Exit 1
# obwohl Inno installiert ist. Deshalb hier feste Kandidatenpfade statt PATH-Suche.

$candidates = @(
  (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe")
)
$iscc = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) {
  Write-Error "ISCC.exe nicht gefunden. Inno Setup 6 installieren (z. B. winget install JRSoftware.InnoSetup) oder Pfad in diesem Skript ergänzen."
}

Write-Host "=== build-dist ===" -ForegroundColor Cyan
& (Join-Path $RepoRoot "scripts\build-dist.ps1")
if (-not $?) { throw "build-dist.ps1 failed" }

Write-Host "`n=== ISCC: $iscc ===" -ForegroundColor Cyan
Push-Location $RepoRoot
try {
  & $iscc "/DMyAppVersion=$appVer" $Iss
  if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit $LASTEXITCODE" }
} finally { Pop-Location }

$out = Join-Path $RepoRoot "dist-installer\SparkSetup.exe"
Write-Host "`n=== Fertig: $out ===" -ForegroundColor Green
if (Test-Path $out) {
  $len = (Get-Item $out).Length
  Write-Host ("  Größe: {0:N1} MB" -f ($len / 1MB))
}
