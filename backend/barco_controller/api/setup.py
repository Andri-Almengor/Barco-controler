from __future__ import annotations

from typing import Any

import requests
from flask import Blueprint, jsonify, request

from ..config import (
    getenv,
    load_config_or_default,
    load_endpoints,
    normalize_config,
    safe_public_config,
    save_config,
)
from ..paths import CONFIG_PATH
from ..security import setup_access_allowed
from ..services.ctrl_api import CtrlApiClient
from ..services.external_sources import ExternalRendererService
from ..services.oidc import OIDCSession
from ..services.workplace import WorkplaceController


def _issuer_from(cfg: dict[str, Any]) -> tuple[str, bool, int]:
    barco = cfg.get("barco") or {}
    base = str(barco.get("base_url") or "").strip().rstrip("/")
    if not base:
        raise ValueError("La dirección del servidor CTRL es requerida")
    realm = str((barco.get("oidc") or {}).get("realm") or "OCS").strip()
    verify = bool((barco.get("tls") or {}).get("verify_tls", True))
    timeout = max(3, min(30, int(barco.get("request_timeout_sec") or 15)))
    return f"{base}/auth/realms/{realm}", verify, timeout


def _id_of(value: dict[str, Any] | None) -> str:
    if not isinstance(value, dict):
        return ""
    for key in ("id", "_id", "workplaceId", "sourceId", "uuid"):
        candidate = value.get(key)
        if candidate not in (None, ""):
            return str(candidate)
    return ""


def _temporary_workplace(cfg: dict[str, Any], username: str, password: str) -> tuple[WorkplaceController, OIDCSession]:
    cfg = normalize_config(cfg)
    if not username or not password:
        raise ValueError("Usuario y contraseña CTRL son requeridos para la detección inicial")
    issuer, verify, timeout = _issuer_from(cfg)
    barco = cfg.get("barco") or {}
    oidc_cfg = barco.get("oidc") or {}
    oidc = OIDCSession(
        issuer,
        str(oidc_cfg.get("client_id") or "proxima"),
        getenv(str(oidc_cfg.get("client_secret_env") or "")),
        verify,
        timeout=timeout,
    )
    oidc.login_password_grant(username, password)
    ctrl = CtrlApiClient(
        str(barco.get("base_url") or "").rstrip("/"),
        str(barco.get("api_base") or "/api"),
        oidc,
        verify,
        timeout=timeout,
    )
    return WorkplaceController(cfg, load_endpoints(), ctrl), oidc


def create_setup_blueprint(state):
    bp = Blueprint("setup", __name__)

    def deny():
        return jsonify({"ok": False, "error": "La configuración inicial solo puede realizarse localmente o con una sesión de operador"}), 403

    @bp.get("/setup/status")
    def setup_status():
        return jsonify({
            "configured": state.configured,
            "configError": state.config_error,
            "remoteSetupEnabled": False,
        })

    @bp.get("/setup/config")
    def get_config():
        if not setup_access_allowed(state):
            return deny()
        cfg = state.cfg if state.configured else load_config_or_default()
        return jsonify(safe_public_config(cfg))

    @bp.get("/setup/browsers")
    def browsers():
        if not setup_access_allowed(state):
            return deny()
        return jsonify(ExternalRendererService.detect_browsers())

    @bp.post("/setup/test")
    def test_config():
        if not setup_access_allowed(state):
            return deny()
        body = request.get_json(silent=True) or {}
        cfg = body.get("config") if isinstance(body.get("config"), dict) else body
        try:
            issuer, verify, timeout = _issuer_from(cfg)
            url = issuer.rstrip("/") + "/.well-known/openid-configuration"
            response = requests.get(url, verify=verify, timeout=timeout)
            response.raise_for_status()
            data = response.json()
            return jsonify({
                "ok": True,
                "issuer": data.get("issuer") or issuer,
                "tokenEndpoint": data.get("token_endpoint"),
                "authorizationEndpoint": data.get("authorization_endpoint"),
            })
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.post("/setup/discover")
    def discover_ctrl_inventory():
        """Discover workplaces and sources without persisting operator credentials.

        During first setup the request includes temporary CTRL credentials. Once the
        application is configured, an already-authenticated operator can omit them and
        reuse the current CTRL session.
        """
        if not setup_access_allowed(state):
            return deny()
        body = request.get_json(silent=True) or {}
        cfg = body.get("config") if isinstance(body.get("config"), dict) else load_config_or_default()
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        requested_workplace_id = str(body.get("workplaceId") or "").strip()

        temporary_oidc: OIDCSession | None = None
        try:
            if state.configured and not username and not password:
                workplace_service = state.workplace
                auth_mode = "existing-session"
            else:
                workplace_service, temporary_oidc = _temporary_workplace(cfg, username, password)
                auth_mode = "temporary"

            warnings: list[str] = []
            try:
                workplaces = workplace_service.list_workplaces()
            except Exception as exc:
                workplaces = []
                warnings.append(f"No se pudieron enumerar workplaces: {exc}")

            selected_id = requested_workplace_id
            if not selected_id:
                configured_workplaces = normalize_config(cfg).get("workplaces") or []
                if configured_workplaces:
                    selected_id = str(configured_workplaces[0].get("id") or "")
            if not selected_id and workplaces:
                selected_id = _id_of(workplaces[0])

            try:
                sources = workplace_service.list_sources(selected_id) if selected_id else []
            except Exception as exc:
                sources = []
                warnings.append(f"No se pudieron enumerar fuentes: {exc}")

            try:
                compositions = workplace_service.list_compositions()
            except Exception as exc:
                compositions = []
                warnings.append(f"No se pudieron enumerar composiciones: {exc}")

            if not workplaces and not sources and not compositions:
                detail = "; ".join(warnings) or "CTRL no devolvió inventario"
                return jsonify({"ok": False, "error": detail}), 502

            return jsonify({
                "ok": True,
                "authMode": auth_mode,
                "selectedWorkplaceId": selected_id,
                "workplaces": workplaces,
                "sources": sources,
                "compositions": compositions,
                "warnings": warnings,
            })
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502
        finally:
            if temporary_oidc is not None:
                temporary_oidc.logout()

    @bp.post("/setup/config")
    def set_config():
        if not setup_access_allowed(state):
            return deny()
        body = request.get_json(silent=True) or {}
        cfg = body.get("config") if isinstance(body.get("config"), dict) else body
        previous = load_config_or_default()
        previous_was_configured = bool((previous.get("barco") or {}).get("base_url"))
        try:
            saved = save_config(cfg)
            try:
                state.reload()
            except Exception as reload_exc:
                # Never leave a broken configuration persisted. Restore the last
                # known-good file, or remove the failed first-run file entirely.
                if previous_was_configured:
                    save_config(previous)
                else:
                    try:
                        CONFIG_PATH.unlink(missing_ok=True)
                    except Exception:
                        pass
                state.reload(silent=True)
                raise RuntimeError(
                    f"La nueva configuración no pudo cargarse y se restauró la anterior: {reload_exc}"
                ) from reload_exc
            return jsonify({
                "ok": True,
                "config": safe_public_config(saved),
                "restartRequiredForServerBinding": (
                    (previous.get("server") or {}).get("host") != (saved.get("server") or {}).get("host")
                    or (previous.get("server") or {}).get("port") != (saved.get("server") or {}).get("port")
                ),
            })
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.post("/setup/reload")
    def reload_runtime():
        if not setup_access_allowed(state):
            return deny()
        try:
            state.reload()
            return jsonify({"ok": True})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    return bp
