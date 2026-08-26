from __future__ import annotations

import os
import secrets
import sys
from pathlib import Path

APP_NAME = "BarcoController"
PACKAGE_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = PACKAGE_DIR.parent
IS_FROZEN = bool(getattr(sys, "frozen", False))


def _resource_root() -> Path:
    bundle = getattr(sys, "_MEIPASS", None)
    if bundle:
        return Path(bundle)
    return BACKEND_ROOT


def _installed_data_root() -> Path:
    explicit = os.environ.get("BARCO_DATA_ROOT")
    if explicit:
        return Path(explicit).expanduser().resolve()
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        return Path(base) / APP_NAME
    xdg = os.environ.get("XDG_DATA_HOME")
    return Path(xdg).expanduser() / APP_NAME if xdg else Path.home() / ".local" / "share" / APP_NAME


RESOURCE_ROOT = _resource_root()
RUNTIME_ROOT = _installed_data_root() if IS_FROZEN or os.environ.get("BARCO_DATA_ROOT") else BACKEND_ROOT
CONFIG_DIR = RUNTIME_ROOT / "config"
DATA_DIR = RUNTIME_ROOT / "data"
CONFIG_PATH = CONFIG_DIR / "config.yaml"
STATIC_DIR = RESOURCE_ROOT / "static"
ENDPOINTS_PATH = RESOURCE_ROOT / "config" / "endpoints.yaml"
LOG_DIR = RUNTIME_ROOT / "logs"
SECRET_PATH = DATA_DIR / ".app_secret"


def ensure_runtime_dirs() -> None:
    for path in (CONFIG_DIR, DATA_DIR, LOG_DIR):
        path.mkdir(parents=True, exist_ok=True)


def load_or_create_app_secret() -> str:
    ensure_runtime_dirs()
    try:
        if SECRET_PATH.exists():
            value = SECRET_PATH.read_text(encoding="utf-8").strip()
            if value:
                return value
        value = secrets.token_hex(32)
        SECRET_PATH.write_text(value, encoding="utf-8")
        return value
    except OSError:
        return secrets.token_hex(32)
