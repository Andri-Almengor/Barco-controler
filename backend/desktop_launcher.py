from __future__ import annotations

import os
import threading
import time
import webbrowser
from typing import Any

import requests
from PIL import Image, ImageDraw
from waitress.server import create_server

from barco_controller import create_app
from barco_controller.config import load_config_or_default
from barco_controller.paths import LOG_DIR, ensure_runtime_dirs

APP_TITLE = "Barco Controller"

_MUTEX_HANDLE = None

def _acquire_windows_mutex() -> bool:
    global _MUTEX_HANDLE
    if os.name != "nt":
        return True
    import ctypes
    kernel32 = ctypes.windll.kernel32
    _MUTEX_HANDLE = kernel32.CreateMutexW(None, False, "Local\\BarcoControllerDesktop")
    return kernel32.GetLastError() != 183


def _ui_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def _is_existing_instance(port: int) -> bool:
    try:
        response = requests.get(f"{_ui_url(port)}/api/health", timeout=0.8)
        return response.ok
    except Exception:
        return False


def _wait_until_ready(port: int, timeout_sec: float = 12.0) -> bool:
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
    except Exception:
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

    if not _acquire_windows_mutex() or _is_existing_instance(port):
        webbrowser.open(_ui_url(port), new=2)
        return

    app = create_app()
    try:
        server = create_server(app, host=host, port=port, threads=8)
    except Exception as exc:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        (LOG_DIR / "launcher-error.log").write_text(str(exc), encoding="utf-8")
        raise

    thread = threading.Thread(target=server.run, name="barco-http", daemon=True)
    thread.start()

    if _wait_until_ready(port):
        webbrowser.open(_ui_url(port), new=2)

    _run_tray(server, port)


if __name__ == "__main__":
    main()
