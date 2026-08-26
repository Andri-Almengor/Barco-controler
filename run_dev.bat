@echo off
start "Barco backend" cmd /k "cd backend && python -m venv .venv && .venv\Scripts\activate && pip install -r requirements.txt && python run_waitress.py --host 127.0.0.1 --port 8080"
start "Barco frontend" cmd /k "cd frontend && npm install && npm run dev"
