$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Venv = Join-Path $Root ".venv"
$VncScript = Join-Path $Root "scripts\configure_vnc_windows.ps1"

Write-Host "=== Barco Controller - instalacion local ===" -ForegroundColor Cyan

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python no esta instalado o no esta en PATH. Instala Python 3.11 o superior."
}

if (-not (Test-Path $Venv)) { python -m venv $Venv }
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

$knownVnc = @(
  "$env:ProgramFiles\TightVNC\tvnserver.exe",
  "${env:ProgramFiles(x86)}\TightVNC\tvnserver.exe"
) | Where-Object { $_ -and (Test-Path $_) }

Write-Host ""
if ($knownVnc.Count -gt 0) {
  Write-Host "Servidor VNC detectado: $($knownVnc[0])" -ForegroundColor Green
  $answer = Read-Host "Deseas aplicar la configuracion segura recomendada para el renderer en el puerto 5900? [S/n]"
} else {
  Write-Warning "No se detecto un servidor VNC local."
  $answer = Read-Host "Deseas instalar y configurar TightVNC Server para el renderer? [S/n]"
}

if ([string]::IsNullOrWhiteSpace($answer) -or $answer.Trim().ToLowerInvariant() -in @("s", "si", "sí", "y", "yes")) {
  if (-not (Test-Path $VncScript)) { throw "No se encontro $VncScript" }
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$VncScript`"", "-Port", "5900", "-InstallIfMissing")
  Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList $args
} else {
  Write-Host "VNC omitido. Podras configurarlo luego desde la seccion Diagnostico." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Instalacion completada." -ForegroundColor Green
Write-Host "Ejecuta start_controller.bat y abre http://127.0.0.1:8080"
Write-Host "En la primera ejecucion el asistente detectara CTRL, workplaces, fuentes, navegador y VNC local."
