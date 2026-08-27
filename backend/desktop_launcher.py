from __future__ import annotations

import os
import threading
import time
import traceback
import webbrowser
from typing import Any

import requests
from PIL import Image, ImageDraw
from waitress.server import create_server

from barco_controller import create_app
from barco_controller.config import load_config_or_default
from barco_controller.paths import LOG_DIR, ensure_runtime_dirs

APP_TITLE = "Barco Controller"
MUTEX_NAME = "Local\\BarcoControllerDesktop"
ERROR_ALREADY_EXISTS = 183

_MUTEX_HANDLE = None


def _write_launcher_log(message: str) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with (LOG_DIR / "launcher.log").open("a", encoding="utf-8") as handle:
            handle.write(f"[{stamp}] {message}\n")
    except Exception:
        pass


def _close_mutex_handle() -> None:
    global _MUTEX_HANDLE
    if os.name == "nt" and _MUTEX_HANDLE:
        try:
            import ctypes
            ctypes.windll.kernel32.CloseHandle(_MUTEX_HANDLE)
        except Exception:
            pass
    _MUTEX_HANDLE = None


def _try_acquire_windows_mutex() -> bool:
    """Try to own the single-instance mutex without trusting a stale instance.

    During an in-place upgrade the old process can retain the mutex for a short
    period after its HTTP server has already stopped. In that situation the new
    process must wait and retry instead of opening a dead localhost URL and
    exiting.
    """
    global _MUTEX_HANDLE
    if os.name != "nt":
        return True

    import ctypes

    kernel32 = ctypes.windll.kernel32
    kernel32.SetLastError(0)
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle:
        return False

    if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        kernel32.CloseHandle(handle)
        return False

    _MUTEX_HANDLE = handle
    return True


def _ui_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def _is_existing_instance(port: int) -> bool:
    try:
        response = requests.get(f"{_ui_url(port)}/api/health", timeout=0.8)
        return response.ok
    except Exception:
        return False


def _wait_for_mutex_or_existing_instance(port: int, timeout_sec: float = 20.0) -> str:
    """Return 'owned' when this process owns the mutex or 'existing' when a
    healthy previous instance is serving HTTP.

    This explicitly handles the shutdown window produced by installer upgrades.
    """
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if _is_existing_instance(port):
            return "existing"
        if _try_acquire_windows_mutex():
            return "owned"
        time.sleep(0.35)

    # One final health check avoids a false failure on a slow machine.
    if _is_existing_instance(port):
        return "existing"
    return "timeout"


def _wait_until_ready(port: int, timeout_sec: float = 20.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if _is_existing_instance(port):
            return True
        time.sleep(0.2)
    return False


def _tray_image() -> Image.Image:
    image = Image.new("RGB", (64, 64), (20, 20, 20))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((5, 5, 59, 59), radius=9, fill=(205, 27, 34))
    draw.rectangle((15, 20, 49, 25), fill=(255, 255, 255))
    draw.rectangle((15, 31, 42, 36), fill=(255, 255, 255))
    draw.rectangle((15, 42, 34, 47), fill=(255, 255, 255))
    return image


def _run_tray(server: Any, port: int) -> None:
    try:
        import pystray
    except Exception as exc:
        _write_launcher_log(f"pystray no disponible; servidor permanece activo: {exc}")
        while True:
            time.sleep(3600)

    ui = _ui_url(port)

    def open_ui(icon=None, item=None):
        webbrowser.open(ui, new=2)

    def exit_app(icon, item=None):
        try:
            server.close()
        except Exception:
            pass
        _close_mutex_handle()
        icon.stop()

    icon = pystray.Icon(
        "barco-controller",
        _tray_image(),
        APP_TITLE,
        menu=pystray.Menu(
            pystray.MenuItem("Abrir Barco Controller", open_ui, default=True),
            pystray.MenuItem("Salir", exit_app),
        ),
    )
    icon.run()


def main() -> None:
    ensure_runtime_dirs()
    cfg = load_config_or_default()
    server_cfg = cfg.get("server") or {}
    host = str(server_cfg.get("host") or "127.0.0.1")
    port = int(server_cfg.get("port") or 8080)
    ui = _ui_url(port)

    _write_launcher_log(f"Inicio solicitado. host={host} port={port}")

    instance_state = _wait_for_mutex_or_existing_instance(port)
    if instance_state == "existing":
        _write_launcher_log("Instancia saludable existente detectada; abriendo interfaz.")
        webbrowser.open(ui, new=2)
        return
    if instance_state == "timeout":
        raise RuntimeError(
            "No se pudo iniciar Barco Controller: otra instancia conserva el bloqueo "
            "pero no responde en el puerto local. Cierra BarcoController.exe desde el "
            "Administrador de tareas y vuelve a abrir la aplicación."
        )

    _write_launcher_log("Mutex adquirido; creando servidor Flask/Waitress.")
    app = create_app()
    server = create_server(app, host=host, port=port, threads=8)

    thread = threading.Thread(target=server.run, name="barco-http", daemon=True)
    thread.start()

    if not _wait_until_ready(port):
        try:
            server.close()
        except Exception:
            pass
        raise RuntimeError(f"El servidor local no respondió en {ui} después de 20 segundos.")

    _write_launcher_log(f"Servidor listo en {ui}; abriendo navegador.")
    webbrowser.open(ui, new=2)

    try:
        _run_tray(server, port)
    finally:
        _close_mutex_handle()


def _run_with_crash_log() -> None:
    try:
        main()
    except Exception as exc:
        _write_launcher_log(f"ERROR FATAL: {exc}\n{traceback.format_exc()}")
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            (LOG_DIR / "launcher-error.log").write_text(
                f"{exc}\n\n{traceback.format_exc()}", encoding="utf-8"
            )
        except Exception:
            pass
        _close_mutex_handle()
        raise


if __name__ == "__main__":
    _run_with_crash_log()
