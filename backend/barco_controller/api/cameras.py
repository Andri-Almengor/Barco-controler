from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..security import require_operator


def create_cameras_blueprint(state):
    bp = Blueprint("cameras", __name__)

    @bp.get("/camera-rules")
    @require_operator(state)
    def list_rules():
        return jsonify(state.cameras.list_rules())

    @bp.post("/camera-rules")
    @require_operator(state)
    def save_rule():
        try:
            rule = state.cameras.save_rule(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "rule": rule})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.delete("/camera-rules/<rule_id>")
    @require_operator(state)
    def delete_rule(rule_id: str):
        state.cameras.delete_rule(rule_id)
        return jsonify({"ok": True})

    @bp.post("/camera-rules/<rule_id>/test")
    @require_operator(state)
    def test_rule(rule_id: str):
        try:
            return jsonify({"ok": True, "event": state.cameras.enqueue_event(rule_id, reason="manual-test")})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.get("/camera-engine/status")
    @require_operator(state)
    def status():
        return jsonify(state.cameras.status())

    @bp.post("/camera-engine/start")
    @require_operator(state)
    def start():
        state.cameras.start()
        return jsonify({"ok": True, "status": state.cameras.status()})

    @bp.post("/camera-engine/stop")
    @require_operator(state)
    def stop():
        state.cameras.stop()
        return jsonify({"ok": True, "status": state.cameras.status()})

    return bp
