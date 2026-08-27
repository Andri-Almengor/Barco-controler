from __future__ import annotations

import ipaddress
import socket

from flask import Blueprint, jsonify, request, session

from ..config import load_config_or_default
from ..services.diagnostics import DiagnosticsService


def _allowed() -> bool:
    remote = request.remote_addr or ""
    return remote in {"127.0.0.1", "::1", "localhost"} or bool(session.get("operator_authenticated"))


def _lan_addresses() -> list[str]:
    values: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
            candidate = str(info[4][0])
            try:
                address = ipaddress.ip_address(candidate)
                if not address.is_loopback and (address.is_private or address.is_link_local):
                    values.add(candidate)
            except ValueError:
                pass
    except Exception:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.4)
            sock.connect(("8.8.8.8", 80))
            candidate = str(sock.getsockname()[0])
            address = ipaddress.ip_address(candidate)
            if not address.is_loopback and (address.is_private or address.is_link_local):
                values.add(candidate)
    except Exception:
        pass
    return sorted(values)


def _network_snapshot(cfg: dict) -> dict:
    server = cfg.get("server") or {}
    enabled = bool(server.get("lan_access", True))
    port = int(server.get("port") or 8080)
    addresses = _lan_addresses() if enabled else []
    urls = [f"http://{address}:{port}" for address in addresses]
    return {
        "enabled": enabled,
        "port": port,
        "addresses": addresses,
        "urls": urls,
    }


def create_diagnostics_blueprint(state):
    bp = Blueprint("diagnostics", __name__)

    @bp.get("/diagnostics")
    def diagnostics():
        if not _allowed():
            return jsonify({"ok": False, "error": "Diagnóstico disponible solo localmente o para un operador autenticado"}), 403
        result = DiagnosticsService(state).run()
        try:
            cfg = state.cfg if state.configured else load_config_or_default()
        except Exception:
            cfg = load_config_or_default()
        network = _network_snapshot(cfg)
        if network["enabled"]:
            detail = (
                "Acceso desde red local habilitado: " + ", ".join(network["urls"])
                if network["urls"]
                else f"Acceso LAN habilitado en puerto {network['port']}; no se detectó IPv4 privada."
            )
            status = "ok" if network["urls"] else "warn"
        else:
            detail = "Acceso desde red local deshabilitado; solo se atiende el equipo servidor."
            status = "warn"
        result.setdefault("checks", []).append({
            "id": "lanAccess",
            "label": "Acceso LAN",
            "status": status,
            "detail": detail,
            "meta": network,
        })
        result["network"] = network
        return jsonify(result)

    @bp.post("/diagnostics/local")
    def local_diagnostics():
        if not _allowed():
            return jsonify({"ok": False, "error": "Diagnóstico local no autorizado"}), 403
        body = request.get_json(silent=True) or {}
        cfg = body.get("config") if isinstance(body.get("config"), dict) else load_config_or_default()
        result = DiagnosticsService.local_snapshot(cfg)
        result["network"] = _network_snapshot(cfg)
        return jsonify(result)

    return bp
