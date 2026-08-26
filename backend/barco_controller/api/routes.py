from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..security import require_operator


def create_routes_blueprint(state):
    bp = Blueprint("routes", __name__)

    @bp.get("/routes")
    @require_operator(state)
    def list_routes():
        return jsonify(state.route_repo.list())

    @bp.post("/routes")
    @require_operator(state)
    def save_route():
        try:
            route = state.route_repo.save(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "route": route})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.delete("/routes/<route_id>")
    @require_operator(state)
    def delete_route(route_id: str):
        try:
            state.routes.stop(route_id, clear_wall=False)
        except Exception:
            pass
        state.route_repo.delete(route_id)
        return jsonify({"ok": True})

    @bp.get("/routes/runtime")
    @require_operator(state)
    def runtime_all():
        return jsonify(state.routes.statuses())

    @bp.get("/routes/<route_id>/runtime")
    @require_operator(state)
    def runtime(route_id: str):
        return jsonify(state.routes.status(route_id))

    @bp.post("/routes/<route_id>/start")
    @require_operator(state)
    def start(route_id: str):
        try:
            return jsonify({"ok": True, "runtime": state.routes.start(route_id)})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.post("/routes/<route_id>/stop")
    @require_operator(state)
    def stop(route_id: str):
        try:
            body = request.get_json(silent=True) or {}
            return jsonify({"ok": True, "runtime": state.routes.stop(route_id, clear_wall=bool(body.get("clearWall", True)))})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.post("/routes/<route_id>/pause")
    @require_operator(state)
    def pause(route_id: str):
        return jsonify({"ok": True, "runtime": state.routes.pause(route_id)})

    @bp.post("/routes/<route_id>/resume")
    @require_operator(state)
    def resume(route_id: str):
        try:
            return jsonify({"ok": True, "runtime": state.routes.resume(route_id)})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.get("/routes/logs")
    @require_operator(state)
    def logs():
        return jsonify(state.routes.logs())

    return bp
