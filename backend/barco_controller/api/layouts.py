from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..security import require_operator
from ..services.workplace import WallItem, WallPlacement


def create_layouts_blueprint(state):
    bp = Blueprint("layouts", __name__)

    @bp.get("/layouts")
    @require_operator(state)
    def list_layouts():
        return jsonify(state.layout_repo.list())

    @bp.post("/layouts")
    @require_operator(state)
    def save_layout():
        try:
            layout = state.layout_repo.save(request.get_json(silent=True) or {})
            return jsonify({"ok": True, "layout": layout})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400

    @bp.delete("/layouts/<layout_id>")
    @require_operator(state)
    def delete_layout(layout_id: str):
        state.layout_repo.delete(layout_id)
        return jsonify({"ok": True})

    @bp.post("/layouts/<layout_id>/show")
    @require_operator(state)
    def show_layout(layout_id: str):
        layout = state.layout_repo.get(layout_id)
        if not layout:
            return jsonify({"ok": False, "error": "Composición mixta no encontrada"}), 404

        body = request.get_json(silent=True) or {}
        workplace_id = str(body.get("workplaceId") or layout.get("workplaceId") or "").strip()
        if not workplace_id:
            return jsonify({"ok": False, "error": "workplaceId requerido"}), 400

        try:
            placements: list[WallPlacement] = []
            used_renderers: set[str] = set()

            with state.workplace.exclusive(workplace_id, owner=f"layout:{layout_id}"):
                for entry in layout.get("items") or []:
                    kind = str(entry.get("kind") or "source").lower()
                    item_id = str(entry.get("id") or "").strip()
                    label = str(entry.get("label") or item_id)
                    geometry = dict(entry.get("geometry") or {})

                    if kind == "external":
                        source = state.external_repo.get(item_id)
                        if not source:
                            raise ValueError(f"Contenido externo no encontrado: {label}")
                        renderer_id = str(source.get("rendererId") or "main")
                        if renderer_id in used_renderers:
                            raise ValueError(
                                f"El renderer '{renderer_id}' aparece más de una vez. "
                                "Una fuente VNC solo puede mostrar un contenido externo distinto a la vez."
                            )
                        used_renderers.add(renderer_id)
                        wall_item = state.external.activate(item_id, local_origin=request.host_url.rstrip("/"))
                    elif kind in {"source", "composition"}:
                        wall_item = WallItem(kind, item_id, label)
                    else:
                        raise ValueError(f"Tipo de elemento no soportado: {kind}")

                    placements.append(WallPlacement(wall_item, geometry))

                state.workplace.apply_layout_locked(workplace_id, placements, pre_clear=True)

            return jsonify({"ok": True, "items": len(placements)})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    return bp
