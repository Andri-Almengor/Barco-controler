from __future__ import annotations

import time
from flask import Blueprint, jsonify, request

from ..security import require_operator
from ..services.workplace import WallItem


def create_control_blueprint(state):
    bp = Blueprint("control", __name__)

    @bp.get("/health")
    def health():
        return jsonify({"ok": True, "time": time.time()})

    @bp.get("/workplaces")
    @require_operator(state)
    def workplaces():
        return jsonify(state.cfg.get("workplaces", []))

    @bp.get("/compositions")
    @require_operator(state)
    def compositions():
        try:
            return jsonify(state.workplace.list_compositions())
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.get("/sources")
    @require_operator(state)
    def sources():
        workplace_id = str(request.args.get("workplaceId") or "").strip()
        if not workplace_id:
            return jsonify({"ok": False, "error": "workplaceId requerido"}), 400
        try:
            return jsonify(state.workplace.list_sources(workplace_id))
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.get("/workplace/content")
    @require_operator(state)
    def content():
        workplace_id = str(request.args.get("workplaceId") or "").strip()
        if not workplace_id:
            return jsonify({"ok": False, "error": "workplaceId requerido"}), 400
        try:
            return jsonify(state.workplace.get_content(workplace_id))
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.post("/workplace/apply")
    @require_operator(state)
    def apply():
        body = request.get_json(silent=True) or {}
        workplace_id = str(body.get("workplaceId") or "").strip()
        item_id = str(body.get("id") or body.get("itemId") or "").strip()
        kind = str(body.get("kind") or "composition").strip().lower()
        if not workplace_id or not item_id:
            return jsonify({"ok": False, "error": "workplaceId e itemId son requeridos"}), 400
        try:
            state.workplace.apply(workplace_id, WallItem(kind, item_id, str(body.get("label") or "")), owner="manual")
            return jsonify({"ok": True})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.delete("/workplace/clear")
    @require_operator(state)
    def clear():
        workplace_id = str(request.args.get("workplaceId") or "").strip()
        if not workplace_id:
            return jsonify({"ok": False, "error": "workplaceId requerido"}), 400
        try:
            state.workplace.clear(workplace_id, owner="manual-clear")
            return jsonify({"ok": True})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    return bp
