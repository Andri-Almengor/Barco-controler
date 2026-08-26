from __future__ import annotations

from flask import Blueprint, jsonify, request, session

from ..services.oidc import OIDCError


def create_auth_blueprint(state):
    bp = Blueprint("auth", __name__)

    @bp.post("/login")
    def login():
        if not state.configured:
            return jsonify({"ok": False, "error": "Completa la configuración inicial", "setupRequired": True}), 409
        body = request.get_json(silent=True) or {}
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        if not username or not password:
            return jsonify({"ok": False, "error": "Usuario y contraseña son requeridos"}), 400
        try:
            state.oidc.login_password_grant(username, password)
            session.clear()
            session["operator_authenticated"] = True
            return jsonify({"ok": True, **state.oidc.status()})
        except OIDCError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 401

    @bp.post("/logout")
    def logout():
        if state.configured:
            try:
                state.oidc.logout()
            except Exception:
                pass
        session.clear()
        return jsonify({"ok": True})

    @bp.get("/status")
    def status():
        if not state.configured:
            return jsonify({"configured": False, "authenticated": False, "accessValid": False, "expiresAt": None})
        status = state.oidc.status()
        status["configured"] = True
        if not session.get("operator_authenticated"):
            status = {**status, "authenticated": False, "accessValid": False}
        return jsonify(status)

    return bp
