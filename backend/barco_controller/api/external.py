from __future__ import annotations

from flask import Blueprint, jsonify, redirect, render_template_string, request

from ..security import require_operator


IMAGE_TEMPLATE = """<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}img{width:100%;height:100%;object-fit:contain}</style></head><body><img src='{{ url }}' alt='{{ name }}'></body></html>"""
VIDEO_TEMPLATE = """<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;background:#000}</style></head><body><video src='{{ url }}' autoplay loop muted playsinline controls='false'></video></body></html>"""


def create_external_blueprint(state):
    bp = Blueprint("external", __name__)

    @bp.get("/external-sources")
    @require_operator(state)
    def list_sources():
        return jsonify(state.external_repo.list())

    @bp.post("/external-sources")
    @require_operator(state)
    def save_source():
        try:
            item = state.external_repo.save(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "source": item})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.delete("/external-sources/<source_id>")
    @require_operator(state)
    def delete_source(source_id: str):
        state.external_repo.delete(source_id)
        return jsonify({"ok": True})

    @bp.post("/external-sources/<source_id>/prepare")
    @require_operator(state)
    def prepare(source_id: str):
        try:
            item = state.external.activate(source_id, local_origin=request.host_url.rstrip("/"))
            return jsonify({"ok": True, "wallItem": {"kind": item.kind, "id": item.id, "label": item.label}})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.post("/external-sources/<source_id>/show")
    @require_operator(state)
    def show(source_id: str):
        body = request.get_json(silent=True) or {}
        workplace_id = str(body.get("workplaceId") or "").strip()
        if not workplace_id:
            return jsonify({"ok": False, "error": "workplaceId requerido"}), 400
        try:
            with state.workplace.exclusive(workplace_id, owner=f"external:{source_id}"):
                item = state.external.activate(source_id, local_origin=request.host_url.rstrip("/"))
                state.workplace.apply_locked(workplace_id, item, pre_clear=True)
            return jsonify({"ok": True})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.get("/external-renderer/status")
    @require_operator(state)
    def renderer_status():
        return jsonify(state.external.status())

    @bp.post("/external-renderer/<renderer_id>/stop")
    @require_operator(state)
    def renderer_stop(renderer_id: str):
        state.external.stop(renderer_id)
        return jsonify({"ok": True})

    @bp.get("/renderer/<source_id>")
    def render_source(source_id: str):
        if not state.configured:
            return "Renderer no configurado", 503
        source = state.external_repo.get(source_id)
        if not source or not source.get("enabled", True):
            return "Contenido externo no encontrado", 404
        if source.get("type") == "web":
            return redirect(str(source.get("url")), code=302)
        template = IMAGE_TEMPLATE if source.get("type") == "image" else VIDEO_TEMPLATE
        return render_template_string(template, url=str(source.get("url")), name=str(source.get("name") or "Contenido"))

    return bp
