from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from .config import DATA_DIR, ConfigurationError, getenv, is_configured, load_config, load_endpoints
from .services.camera_engine import CameraEngine
from .services.ctrl_api import CtrlApiClient
from .services.external_sources import ExternalRendererService
from .services.oidc import OIDCSession
from .services.route_engine import RouteEngine
from .services.workplace import WorkplaceController
from .storage.json_store import JsonStore
from .storage.repositories import CameraRuleRepository, ExternalSourceRepository, RouteRepository


@dataclass
class AppState:
    cfg: dict[str, Any]
    endpoints: dict[str, Any]
    oidc: OIDCSession
    ctrl: CtrlApiClient
    workplace: WorkplaceController
    route_repo: RouteRepository
    camera_repo: CameraRuleRepository
    external_repo: ExternalSourceRepository
    external: ExternalRendererService
    routes: RouteEngine
    cameras: CameraEngine


def create_state() -> AppState:
    cfg = load_config()
    endpoints = load_endpoints()
    barco_cfg = cfg.get("barco") or {}
    oidc_cfg = barco_cfg.get("oidc") or {}
    base_url = str(barco_cfg.get("base_url") or "").rstrip("/")
    if not base_url:
        raise ConfigurationError("barco.base_url no está configurado")
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
    external_repo = ExternalSourceRepository(JsonStore(DATA_DIR / "external_sources.json"))
    external = ExternalRendererService(external_repo, cfg)
    routes = RouteEngine(route_repo, workplace, external, cfg)
    cameras = CameraEngine(camera_repo, workplace, routes, cfg)
    return AppState(cfg, endpoints, oidc, ctrl, workplace, route_repo, camera_repo, external_repo, external, routes, cameras)


class StateManager:
    """Reloadable runtime so the application can boot before CTRL is configured."""

    def __init__(self):
        self._lock = threading.RLock()
        self._state: AppState | None = None
        self._error: str | None = None
        self.reload(silent=True)

    @property
    def configured(self) -> bool:
        with self._lock:
            return self._state is not None and is_configured()

    @property
    def config_error(self) -> str | None:
        with self._lock:
            return self._error

    def get(self) -> AppState:
        with self._lock:
            if self._state is None:
                raise ConfigurationError(self._error or "Barco Controller no está configurado")
            return self._state

    def reload(self, *, silent: bool = False) -> bool:
        try:
            new_state = create_state()
        except Exception as exc:
            with self._lock:
                self._error = str(exc)
                self._state = None
            if silent:
                return False
            raise

        with self._lock:
            previous = self._state
            self._state = new_state
            self._error = None
        if previous:
            try:
                previous.routes.stop_all(clear_wall=False)
            except Exception:
                pass
            try:
                previous.cameras.stop()
            except Exception:
                pass
        return True

    def __getattr__(self, name: str) -> Any:
        return getattr(self.get(), name)
