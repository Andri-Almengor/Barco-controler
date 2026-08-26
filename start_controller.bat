@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Barco Controller no esta instalado. Ejecuta primero:
  echo powershell -ExecutionPolicy Bypass -File install_windows.ps1
  pause
  exit /b 1
)
cd backend
"..\.venv\Scripts\python.exe" run_waitress.py
