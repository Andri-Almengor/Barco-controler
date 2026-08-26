from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any

import yaml

BACKEND_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = BACKEND_ROOT / "config"
DATA_DIR = BACKEND_ROOT / "data"
CONFIG_PATH = CONFIG_DIR / "config.yaml"

DEFAULT_CONFIG: dict[str, Any] = {
    "server": {
        "host": "127.0.0.1",
        "port": 8080,
        "cors_origins": [],
        "trust_proxy": False,
    },
    "barco": {
        "base_url": "",
        "api_base": "/api",
        "oidc": {
            "realm": "OCS",
            "client_id": "proxima",
            "client_secret_env": "CTRL_CLIENT_SECRET",
        },
        "tls": {"verify_tls": True},
        "request_timeout_sec": 30,
        "pre_clear_delay_ms": 600,
    },
    "workplaces": [],
    "routes": {"default_interval_sec": 30, "minimum_interval_sec": 3},
    "cameras": {
        "reconnect_delay_sec": 2,
        "default_duration_sec": 15,
        "default_cooldown_sec": 20,
        "frame_width": 640,
        "frame_height": 360,
    },
    "renderers": [
        {
            "id": "main",
            "name": "Renderer principal",
            "barco_source_id": "",
            "barco_source_label": "Renderer web local",
            "vnc_host": "127.0.0.1",
            "vnc_port": 5900,
            "browser_path": "",
            "launch_mode": "kiosk",
            "startup_delay_sec": 1.5,
            "profile_dir": "data/browser-profile-main",
            "extra_args": [],
        }
    ],
}


class ConfigurationError(RuntimeError):
    pass


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _load_yaml(path: Path, *, required: bool = True) -> dict[str, Any]:
    if not path.exists():
        if required:
            raise ConfigurationError(f"No existe {path.name}")
        return {}
    with path.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle) or {}
        if not isinstance(value, dict):
            raise ConfigurationError(f"{path.name} debe contener un objeto YAML")
        return value


def normalize_config(value: dict[str, Any] | None) -> dict[str, Any]:
    cfg = _deep_merge(DEFAULT_CONFIG, value or {})

    server = cfg.setdefault("server", {})
    server["host"] = str(server.get("host") or "127.0.0.1").strip()
    server["port"] = max(1, min(65535, int(server.get("port") or 8080)))

    barco = cfg.setdefault("barco", {})
    barco["base_url"] = str(barco.get("base_url") or "").strip().rstrip("/")
    barco["api_base"] = "/" + str(barco.get("api_base") or "api").strip("/")
    barco["request_timeout_sec"] = max(3, min(120, int(barco.get("request_timeout_sec") or 30)))
    barco["pre_clear_delay_ms"] = max(0, min(10000, int(barco.get("pre_clear_delay_ms") or 0)))

    oidc = barco.setdefault("oidc", {})
    oidc["realm"] = str(oidc.get("realm") or "OCS").strip()
    oidc["client_id"] = str(oidc.get("client_id") or "proxima").strip()
    oidc["client_secret_env"] = str(oidc.get("client_secret_env") or "CTRL_CLIENT_SECRET").strip()
    barco.setdefault("tls", {})["verify_tls"] = bool((barco.get("tls") or {}).get("verify_tls", True))

    workplaces = []
    for workplace in cfg.get("workplaces") or []:
        if not isinstance(workplace, dict):
            continue
        item = dict(workplace)
        item["id"] = str(item.get("id") or "").strip()
        item["name"] = str(item.get("name") or item["id"] or "Workplace").strip()
        geom = item.get("geometry") if isinstance(item.get("geometry"), dict) else {}
        item["geometry"] = {
            "type": str(geom.get("type") or "px"),
            "x": int(geom.get("x") or 0),
            "y": int(geom.get("y") or 0),
            "width": max(1, int(geom.get("width") or 1920)),
            "height": max(1, int(geom.get("height") or 1080)),
        }
        if item["id"]:
            workplaces.append(item)
    cfg["workplaces"] = workplaces

    renderers = []
    seen = set()
    for renderer in cfg.get("renderers") or []:
        if not isinstance(renderer, dict):
            continue
        item = dict(renderer)
        renderer_id = str(item.get("id") or "main").strip() or "main"
        if renderer_id in seen:
            continue
        seen.add(renderer_id)
        item["id"] = renderer_id
        item["name"] = str(item.get("name") or renderer_id).strip()
        item["barco_source_id"] = str(item.get("barco_source_id") or "").strip()
        item["barco_source_label"] = str(item.get("barco_source_label") or item["name"]).strip()
        item["vnc_host"] = str(item.get("vnc_host") or "127.0.0.1").strip() or "127.0.0.1"
        item["vnc_port"] = max(1, min(65535, int(item.get("vnc_port") or 5900)))
        item["browser_path"] = str(item.get("browser_path") or "").strip()
        item["launch_mode"] = str(item.get("launch_mode") or "kiosk").strip().lower()
        if item["launch_mode"] not in {"kiosk", "app", "fullscreen"}:
            item["launch_mode"] = "kiosk"
        item["startup_delay_sec"] = max(0.0, min(30.0, float(item.get("startup_delay_sec") or 0)))
        item["profile_dir"] = str(item.get("profile_dir") or f"data/browser-profile-{renderer_id}").strip()
        extra_args = item.get("extra_args") or []
        item["extra_args"] = [str(v) for v in extra_args] if isinstance(extra_args, list) else []
        renderers.append(item)
    cfg["renderers"] = renderers or copy.deepcopy(DEFAULT_CONFIG["renderers"])
    return cfg


def is_configured() -> bool:
    if not CONFIG_PATH.exists():
        return False
    try:
        cfg = load_config()
        return bool((cfg.get("barco") or {}).get("base_url"))
    except Exception:
        return False


def load_config(*, required: bool = True) -> dict[str, Any]:
    raw = _load_yaml(CONFIG_PATH, required=required)
    return normalize_config(raw)


def load_config_or_default() -> dict[str, Any]:
    try:
        return load_config(required=False)
    except Exception:
        return normalize_config({})


def save_config(value: dict[str, Any]) -> dict[str, Any]:
    cfg = normalize_config(value)
    if not (cfg.get("barco") or {}).get("base_url"):
        raise ConfigurationError("La dirección del servidor Barco CTRL es requerida")
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_PATH.with_suffix(".yaml.tmp")
    with tmp.open("w", encoding="utf-8", newline="\n") as handle:
        yaml.safe_dump(cfg, handle, allow_unicode=True, sort_keys=False)
    tmp.replace(CONFIG_PATH)
    return cfg


def load_endpoints() -> dict[str, Any]:
    return _load_yaml(CONFIG_DIR / "endpoints.yaml")


def getenv(name: str | None, default: str | None = None) -> str | None:
    if not name:
        return default
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def safe_public_config(cfg: dict[str, Any]) -> dict[str, Any]:
    """Configuration that can be displayed in the administration UI."""
    value = normalize_config(cfg)
    return {
        "server": value.get("server", {}),
        "barco": {
            "base_url": (value.get("barco") or {}).get("base_url", ""),
            "api_base": (value.get("barco") or {}).get("api_base", "/api"),
            "oidc": dict((value.get("barco") or {}).get("oidc") or {}),
            "tls": dict((value.get("barco") or {}).get("tls") or {}),
            "request_timeout_sec": (value.get("barco") or {}).get("request_timeout_sec", 30),
            "pre_clear_delay_ms": (value.get("barco") or {}).get("pre_clear_delay_ms", 600),
        },
        "workplaces": value.get("workplaces", []),
        "routes": value.get("routes", {}),
        "cameras": value.get("cameras", {}),
        "renderers": value.get("renderers", []),
    }
