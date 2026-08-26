from __future__ import annotations

from functools import wraps

from flask import jsonify, session


def require_operator(state):
    """Require both this browser session and a valid CTRL access token."""
    def decorator(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
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
