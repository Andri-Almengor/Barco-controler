param(
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$Utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $Utf8
$OutputEncoding = $Utf8

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Dist = Join-Path $Root "dist"
$InstallerOut = Join-Path $Root "installer_output"

Write-Host "=== Build BarcoController-Setup.exe ===" -ForegroundColor Cyan

function Find-InnoCompiler {
  $candidates = New-Object System.Collections.Generic.List[string]

  $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { $candidates.Add($command.Source) }

  if ($env:ProgramFiles) {
    $candidates.Add((Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"))
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"))
  }
  if ($env:LOCALAPPDATA) {
    $candidates.Add((Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"))
  }

  $registryRoots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )

  foreach ($rootPath in $registryRoots) {
    if (-not (Test-Path $rootPath)) { continue }
    try {
      Get-ChildItem $rootPath -ErrorAction SilentlyContinue | ForEach-Object {
        try {
          $item = Get-ItemProperty $_.PSPath -ErrorAction Stop
          if ($item.DisplayName -like "Inno Setup*") {
            $installLocation = [string]$item.InstallLocation
            if ($installLocation) {
              $candidates.Add((Join-Path $installLocation "ISCC.exe"))
            }
          }
        } catch { }
      }
    } catch { }
  }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ($candidate -and (Test-Path $candidate -PathType Leaf)) {
      return (Resolve-Path $candidate).Path
    }
  }
  return $null
}

$PythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
$PythonPrefix = @()
if (-not $PythonCommand) {
  $PythonCommand = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($PythonCommand) { $PythonPrefix = @("-3.11") }
}
if (-not $PythonCommand) { throw "Python 3.11+ requerido para construir el instalador." }
$PythonExe = $PythonCommand.Source

function Invoke-Python {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $PythonExe @PythonPrefix @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Python terminó con código $LASTEXITCODE." }
}

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) { $NpmCommand = Get-Command npm.exe -ErrorAction SilentlyContinue }
if (-not $NpmCommand) { throw "Node.js/npm requerido para construir el frontend." }
$NpmExe = $NpmCommand.Source

Push-Location $Frontend
try {
  if (Test-Path "package-lock.json") { & $NpmExe ci } else { & $NpmExe install }
  if ($LASTEXITCODE -ne 0) { throw "npm install/ci terminó con código $LASTEXITCODE." }
  & $NpmExe run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build terminó con código $LASTEXITCODE." }
} finally { Pop-Location }

Invoke-Python -m pip install --upgrade pip
Invoke-Python -m pip install -r (Join-Path $Backend "requirements.txt")
Invoke-Python -m pip install "pyinstaller==6.10.0"

if (-not $SkipTests) {
  Push-Location $Backend
  try { Invoke-Python -m unittest discover -s tests -p "test_*.py" -v }
  finally { Pop-Location }
}

if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
if (Test-Path $InstallerOut) { Remove-Item $InstallerOut -Recurse -Force }

Invoke-Python -m PyInstaller --noconfirm --clean (Join-Path $Root "packaging\BarcoController.spec")

$Iscc = Find-InnoCompiler
if (-not $Iscc) {
  $Winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($Winget) {
    Write-Host "Inno Setup no fue detectado. Instalando Inno Setup 6 para el usuario actual..." -ForegroundColor Yellow
    & $Winget.Source install --id JRSoftware.InnoSetup --exact --scope user --silent --accept-package-agreements --accept-source-agreements
    $wingetExit = $LASTEXITCODE
    if ($wingetExit -ne 0) {
      Write-Host "WinGet terminó con código $wingetExit. Se volverá a comprobar por si Inno Setup ya estaba instalado." -ForegroundColor Yellow
    }

    for ($attempt = 1; $attempt -le 15 -and -not $Iscc; $attempt++) {
      Start-Sleep -Milliseconds 500
      $Iscc = Find-InnoCompiler
    }
  }
}

if (-not $Iscc) {
  $expectedUserPath = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe" } else { "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" }
  throw "No se encontró Inno Setup 6 (ISCC.exe). Se revisaron PATH, Program Files, LocalAppData y el Registro. Ruta de usuario esperada: $expectedUserPath"
}

Write-Host "Inno Setup detectado: $Iscc" -ForegroundColor Green
& $Iscc (Join-Path $Root "packaging\BarcoController.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup terminó con código $LASTEXITCODE." }

$SetupExe = Join-Path $InstallerOut "BarcoController-Setup.exe"
if (-not (Test-Path $SetupExe)) { throw "No se generó $SetupExe" }
Write-Host "OK: $SetupExe" -ForegroundColor Green
