from __future__ import annotations

import os
import socket
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
STARTUP_TIMEOUT_SEC = 60.0

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
    """Try to own the single-instance mutex without trusting a stale instance."""
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


def _normalize_bind_host(value: str) -> str:
    host = (value or "127.0.0.1").strip()
    if host.lower() == "localhost":
        return "127.0.0.1"
    return host


def _probe_hosts(bind_host: str) -> list[str]:
    host = _normalize_bind_host(bind_host)
    if host in {"0.0.0.0", "::", "[::]"}:
        return ["127.0.0.1", "::1"]
    hosts = [host]
    if host not in {"127.0.0.1", "::1"}:
        hosts.append("127.0.0.1")
    return hosts


def _ui_url(host: str, port: int) -> str:
    display_host = "127.0.0.1" if host in {"0.0.0.0", "::", "[::]"} else host
    if ":" in display_host and not display_host.startswith("["):
        display_host = f"[{display_host}]"
    return f"http://{display_host}:{port}"


def _is_existing_instance(bind_host: str, port: int) -> bool:
    for host in _probe_hosts(bind_host):
        try:
            response = requests.get(f"{_ui_url(host, port)}/api/health", timeout=0.8)
            if response.ok:
                data = response.json() if "application/json" in (response.headers.get("content-type") or "") else {}
                if isinstance(data, dict) and data.get("ok") is True:
                    return True
        except Exception:
            continue
    return False


def _wait_for_mutex_or_existing_instance(bind_host: str, port: int, timeout_sec: float = 20.0) -> str:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if _is_existing_instance(bind_host, port):
            return "existing"
        if _try_acquire_windows_mutex():
            return "owned"
        time.sleep(0.35)

    if _is_existing_instance(bind_host, port):
        return "existing"
    return "timeout"


def _wait_until_ready(bind_host: str, port: int, server_error: list[BaseException], timeout_sec: float = STARTUP_TIMEOUT_SEC) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if server_error:
            return False
        if _is_existing_instance(bind_host, port):
            return True
        time.sleep(0.2)
    return False


def _port_in_use(host: str, port: int) -> bool:
    target = "127.0.0.1" if host in {"0.0.0.0", "::", "[::]"} else host
    family = socket.AF_INET6 if ":" in target else socket.AF_INET
    try:
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.4)
            return sock.connect_ex((target, port)) == 0
    except Exception:
        return False


def _tray_image() -> Image.Image:
    image = Image.new("RGB", (64, 64), (20, 20, 20))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((5, 5, 59, 59), radius=9, fill=(205, 27, 34))
    draw.rectangle((15, 20, 49, 25), fill=(255, 255, 255))
    draw.rectangle((15, 31, 42, 36), fill=(255, 255, 255))
    draw.rectangle((15, 42, 34, 47), fill=(255, 255, 255))
    return image


def _run_tray(server: Any, ui: str) -> None:
    try:
        import pystray
    except Exception as exc:
        _write_launcher_log(f"pystray no disponible; servidor permanece activo: {exc}")
        while True:
            time.sleep(3600)

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
    host = _normalize_bind_host(str(server_cfg.get("host") or "127.0.0.1"))
    try:
        port = int(server_cfg.get("port") or 8080)
    except Exception:
        port = 8080
    if port < 1 or port > 65535:
        port = 8080

    ui_host = _probe_hosts(host)[0]
    ui = _ui_url(ui_host, port)
    _write_launcher_log(f"Inicio solicitado. bind_host={host} port={port} ui={ui}")

    instance_state = _wait_for_mutex_or_existing_instance(host, port)
    if instance_state == "existing":
        _write_launcher_log("Instancia saludable existente detectada; abriendo interfaz.")
        webbrowser.open(ui, new=2)
        return
    if instance_state == "timeout":
        raise RuntimeError(
            "No se pudo iniciar Barco Controller: otra instancia conserva el bloqueo "
            "pero no responde. Cierra BarcoController.exe desde el Administrador de "
            "tareas y vuelve a abrir la aplicación."
        )

    if _port_in_use(host, port) and not _is_existing_instance(host, port):
        raise RuntimeError(
            f"El puerto {port} ya está siendo usado por otro programa. "
            "Cierra ese proceso o cambia el puerto en la configuración."
        )

    _write_launcher_log("Mutex adquirido; creando servidor Flask/Waitress.")
    try:
        app = create_app()
        server = create_server(app, host=host, port=port, threads=8)
    except Exception as exc:
        raise RuntimeError(f"No se pudo crear el servidor local en {host}:{port}: {exc}") from exc

    server_error: list[BaseException] = []

    def run_server() -> None:
        try:
            server.run()
        except BaseException as exc:  # Keep the real Waitress failure for the launcher thread.
            server_error.append(exc)
            _write_launcher_log(f"ERROR SERVIDOR HTTP: {exc}\n{traceback.format_exc()}")

    thread = threading.Thread(target=run_server, name="barco-http", daemon=True)
    thread.start()

    if not _wait_until_ready(host, port, server_error):
        try:
            server.close()
        except Exception:
            pass
        if server_error:
            raise RuntimeError(
                f"El servidor local no pudo iniciar en {host}:{port}: {server_error[0]}"
            ) from server_error[0]
        raise RuntimeError(
            f"El servidor local no respondió en {ui} después de {int(STARTUP_TIMEOUT_SEC)} segundos. "
            f"Revisa {LOG_DIR / 'launcher.log'} para ver el diagnóstico de arranque."
        )

    _write_launcher_log(f"Servidor listo en {ui}; abriendo navegador.")
    webbrowser.open(ui, new=2)

    try:
        _run_tray(server, ui)
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
