from __future__ import annotations

import os
from functools import wraps

from flask import jsonify, request, session


def require_operator(state):
    """Require a configured system, browser session and valid CTRL access token."""
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            if not getattr(state, "configured", True):
                return jsonify({"ok": False, "error": "Barco Controller requiere configuración inicial", "setupRequired": True}), 409
            if not session.get("operator_authenticated"):
                return jsonify({"ok": False, "error": "Sesión de operador requerida"}), 401
            try:
                state.oidc.ensure_access()
            except Exception:
                session.clear()
                return jsonify({"ok": False, "error": "La sesión de CTRL expiró. Inicia sesión nuevamente."}), 401
            return fn(*args, **kwargs)
        return wrapped
    return decorator


def setup_access_allowed(state) -> bool:
    """Initial configuration is local-only by default; later edits require operator auth."""
    if getattr(state, "configured", False):
        if not session.get("operator_authenticated"):
            return False
        try:
            state.oidc.ensure_access()
            return True
        except Exception:
            return False
    if os.environ.get("BARCO_ALLOW_REMOTE_SETUP") == "1":
        return True
    remote = request.remote_addr or ""
    return remote in {"127.0.0.1", "::1", "localhost"}
