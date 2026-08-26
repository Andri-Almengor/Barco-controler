from __future__ import annotations

from flask import Blueprint, jsonify, request, session

from ..config import load_config_or_default
from ..services.diagnostics import DiagnosticsService


def _allowed() -> bool:
    remote = request.remote_addr or ""
    return remote in {"127.0.0.1", "::1", "localhost"} or bool(session.get("operator_authenticated"))


def create_diagnostics_blueprint(state):
    bp = Blueprint("diagnostics", __name__)

    @bp.get("/diagnostics")
    def diagnostics():
        if not _allowed():
            return jsonify({"ok": False, "error": "Diagnóstico disponible solo localmente o para un operador autenticado"}), 403
        return jsonify(DiagnosticsService(state).run())

    @bp.post("/diagnostics/local")
    def local_diagnostics():
        if not _allowed():
            return jsonify({"ok": False, "error": "Diagnóstico local no autorizado"}), 403
        body = request.get_json(silent=True) or {}
        cfg = body.get("config") if isinstance(body.get("config"), dict) else load_config_or_default()
        return jsonify(DiagnosticsService.local_snapshot(cfg))

    return bp
