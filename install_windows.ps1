$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Venv = Join-Path $Root ".venv"

Write-Host "=== Barco Controller - instalacion local ===" -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python no esta instalado o no esta en PATH. Instala Python 3.11 o superior."
}

if (-not (Test-Path $Venv)) {
  python -m venv $Venv
}
$Py = Join-Path $Venv "Scripts\python.exe"
& $Py -m pip install --upgrade pip
& $Py -m pip install -r (Join-Path $Backend "requirements.txt")

if (Get-Command npm -ErrorAction SilentlyContinue) {
  Push-Location $Frontend
  try {
    if (Test-Path "package-lock.json") { npm ci } else { npm install }
    npm run build
  } finally { Pop-Location }
} else {
  Write-Warning "Node.js/npm no esta instalado. El backend quedo listo, pero debes compilar el frontend antes de usar la interfaz integrada."
}

Write-Host "Instalacion completada." -ForegroundColor Green
Write-Host "Ejecuta start_controller.bat y abre http://127.0.0.1:8080"
Write-Host "En la primera ejecucion el asistente te pedira la direccion de CTRL y el resto de parametros."
