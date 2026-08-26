from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = BACKEND_ROOT / "config"
DATA_DIR = BACKEND_ROOT / "data"


class ConfigurationError(RuntimeError):
    pass


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ConfigurationError(
            f"No existe {path.name}. Copia config/config.yaml.example a config/config.yaml y configúralo."
        )
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def load_config() -> dict[str, Any]:
    return _load_yaml(CONFIG_DIR / "config.yaml")


def load_endpoints() -> dict[str, Any]:
    return _load_yaml(CONFIG_DIR / "endpoints.yaml")


def getenv(name: str | None, default: str | None = None) -> str | None:
    if not name:
        return default
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def safe_public_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Return only configuration that is safe and useful for the browser."""
    return {
        "workplaces": cfg.get("workplaces", []),
        "routes": cfg.get("routes", {}),
        "cameras": {
            "default_duration_sec": (cfg.get("cameras") or {}).get("default_duration_sec", 15),
            "default_cooldown_sec": (cfg.get("cameras") or {}).get("default_cooldown_sec", 20),
        },
    }
