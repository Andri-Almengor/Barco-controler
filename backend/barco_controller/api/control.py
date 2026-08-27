from __future__ import annotations

import time
from flask import Blueprint, jsonify, request

from ..security import require_operator
from ..services.workplace import WallItem, WallPlacement


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
            state.workplace.apply(
                workplace_id,
                WallItem(kind, item_id, str(body.get("label") or "")),
                owner="manual",
            )
            return jsonify({"ok": True})
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 502

    @bp.post("/workplace/layout")
    @require_operator(state)
    def apply_manual_layout():
        """Apply an unsaved visual layout directly to a CTRL workplace.

        Manual Control and the composition editor use this endpoint so the
        operator can drag, overlap and resize content with the mouse and deploy
        the exact geometry without first creating a stored composition.
        """
        body = request.get_json(silent=True) or {}
        workplace_id = str(body.get("workplaceId") or "").strip()
        entries = body.get("items") or []
        if not workplace_id:
            return jsonify({"ok": False, "error": "workplaceId requerido"}), 400
        if not isinstance(entries, list) or not entries:
            return jsonify({"ok": False, "error": "El layout debe contener al menos un elemento"}), 400

        try:
            placements: list[WallPlacement] = []
            used_renderers: set[str] = set()

            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                kind = str(entry.get("kind") or "source").strip().lower()
                item_id = str(entry.get("id") or "").strip()
                label = str(entry.get("label") or item_id)
                geometry = dict(entry.get("geometry") or {})
                if not item_id:
                    raise ValueError("Uno de los elementos del layout no tiene id")

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
                    wall_item = state.external.activate(
                        item_id,
                        local_origin=request.host_url.rstrip("/"),
                    )
                elif kind in {"source", "composition"}:
                    wall_item = WallItem(kind, item_id, label)
                else:
                    raise ValueError(f"Tipo de elemento no soportado: {kind}")

                placements.append(WallPlacement(wall_item, geometry))

            if not placements:
                raise ValueError("El layout no contiene elementos válidos")

            state.workplace.apply_layout(
                workplace_id,
                placements,
                owner="manual-layout",
            )
            return jsonify({"ok": True, "items": len(placements)})
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
