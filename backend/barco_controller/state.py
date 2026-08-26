from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import DATA_DIR, getenv, load_config, load_endpoints
from .services.camera_engine import CameraEngine
from .services.ctrl_api import CtrlApiClient
from .services.oidc import OIDCSession
from .services.route_engine import RouteEngine
from .services.workplace import WorkplaceController
from .storage.json_store import JsonStore
from .storage.repositories import CameraRuleRepository, RouteRepository


@dataclass
class AppState:
    cfg: dict[str, Any]
    endpoints: dict[str, Any]
    oidc: OIDCSession
    ctrl: CtrlApiClient
    workplace: WorkplaceController
    route_repo: RouteRepository
    camera_repo: CameraRuleRepository
    routes: RouteEngine
    cameras: CameraEngine


def create_state() -> AppState:
    cfg = load_config()
    endpoints = load_endpoints()
    barco_cfg = cfg.get("barco") or {}
    oidc_cfg = barco_cfg.get("oidc") or {}
    base_url = str(barco_cfg.get("base_url") or "").rstrip("/")
    if not base_url:
        raise RuntimeError("barco.base_url no está configurado")
    issuer = f"{base_url}/auth/realms/{oidc_cfg.get('realm', 'OCS')}"
    verify_tls = bool((barco_cfg.get("tls") or {}).get("verify_tls", True))
    timeout = int(barco_cfg.get("request_timeout_sec") or 30)
    oidc = OIDCSession(
        issuer,
        str(oidc_cfg.get("client_id") or "proxima"),
        getenv(str(oidc_cfg.get("client_secret_env") or "")),
        verify_tls,
        timeout=min(timeout, 30),
    )
    ctrl = CtrlApiClient(base_url, str(barco_cfg.get("api_base") or "/api"), oidc, verify_tls, timeout=timeout)
    workplace = WorkplaceController(cfg, endpoints, ctrl)
    route_repo = RouteRepository(JsonStore(DATA_DIR / "routes.json"))
    camera_repo = CameraRuleRepository(JsonStore(DATA_DIR / "camera_rules.json"))
    routes = RouteEngine(route_repo, workplace)
    cameras = CameraEngine(camera_repo, workplace, routes, cfg)
    return AppState(cfg, endpoints, oidc, ctrl, workplace, route_repo, camera_repo, routes, cameras)
