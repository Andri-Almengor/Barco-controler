from __future__ import annotations

from flask import Blueprint, jsonify, request, session

from ..services.oidc import OIDCError


def create_auth_blueprint(state):
    bp = Blueprint("auth", __name__)

    @bp.post("/login")
    def login():
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
        state.oidc.logout()
        session.clear()
        return jsonify({"ok": True})

    @bp.get("/status")
    def status():
        status = state.oidc.status()
        if not session.get("operator_authenticated"):
            status = {**status, "authenticated": False, "accessValid": False}
        return jsonify(status)

    return bp
