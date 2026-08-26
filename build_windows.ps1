param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Dist = Join-Path $Root "dist"
$InstallerOut = Join-Path $Root "installer_output"

Write-Host "=== Build BarcoController-Setup.exe ===" -ForegroundColor Cyan

if (-not (Get-Command python.exe -ErrorAction SilentlyContinue)) { throw "Python 3.11+ requerido para construir el instalador." }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "Node.js/npm requerido para construir el frontend." }

Push-Location $Frontend
try {
  if (Test-Path "package-lock.json") { npm ci } else { npm install }
  npm run build
} finally { Pop-Location }

python -m pip install --upgrade pip
python -m pip install -r (Join-Path $Backend "requirements.txt")
python -m pip install "pyinstaller==6.10.0"

if (-not $SkipTests) {
  Push-Location $Backend
  try { python -m unittest discover -s tests -p "test_*.py" -v }
  finally { Pop-Location }
}

if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
if (Test-Path $InstallerOut) { Remove-Item $InstallerOut -Recurse -Force }

pyinstaller --noconfirm --clean (Join-Path $Root "packaging\BarcoController.spec")

$Iscc = @(
  "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Iscc) {
  if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
    Write-Host "Instalando Inno Setup para generar el Setup.exe..." -ForegroundColor Yellow
    winget install --id JRSoftware.InnoSetup --exact --silent --accept-package-agreements --accept-source-agreements
    $Iscc = @(
      "$env:ProgramFiles(x86)\Inno Setup 6\ISCC.exe",
      "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
}
if (-not $Iscc) { throw "No se encontró Inno Setup 6 (ISCC.exe)." }

& $Iscc (Join-Path $Root "packaging\BarcoController.iss")

$SetupExe = Join-Path $InstallerOut "BarcoController-Setup.exe"
if (-not (Test-Path $SetupExe)) { throw "No se generó $SetupExe" }
Write-Host "OK: $SetupExe" -ForegroundColor Green
