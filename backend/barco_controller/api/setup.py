from __future__ import annotations

from typing import Any

import requests
from flask import Blueprint, jsonify, request

from ..config import load_config_or_default, safe_public_config, save_config
from ..security import setup_access_allowed
from ..services.external_sources import ExternalRendererService


def _issuer_from(cfg: dict[str, Any]) -> tuple[str, bool, int]:
    barco = cfg.get("barco") or {}
    base = str(barco.get("base_url") or "").strip().rstrip("/")
    if not base:
        raise ValueError("La dirección del servidor CTRL es requerida")
    realm = str((barco.get("oidc") or {}).get("realm") or "OCS").strip()
    verify = bool((barco.get("tls") or {}).get("verify_tls", True))
    timeout = max(3, min(30, int(barco.get("request_timeout_sec") or 15)))
    return f"{base}/auth/realms/{realm}", verify, timeout


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

    @bp.post("/setup/config")
    def set_config():
        if not setup_access_allowed(state):
            return deny()
        body = request.get_json(silent=True) or {}
        cfg = body.get("config") if isinstance(body.get("config"), dict) else body
        try:
            saved = save_config(cfg)
            state.reload()
            return jsonify({"ok": True, "config": safe_public_config(saved), "restartRequiredForServerBinding": True})
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
