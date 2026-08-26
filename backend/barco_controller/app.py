from __future__ import annotations

import secrets

from flask import Flask, jsonify, request, send_from_directory

from .api.auth import create_auth_blueprint
from .api.cameras import create_cameras_blueprint
from .api.control import create_control_blueprint
from .api.routes import create_routes_blueprint
from .config import BACKEND_ROOT, getenv, safe_public_config
from .security import require_operator
from .state import create_state


def create_app() -> Flask:
    static_dir = BACKEND_ROOT / "static"
    app = Flask(__name__, static_folder=str(static_dir), static_url_path="/")
    state = create_state()
    app.config["BARCO_STATE"] = state
    app.secret_key = getenv("BARCO_APP_SECRET") or secrets.token_hex(32)
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

    app.register_blueprint(create_auth_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_control_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_routes_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_cameras_blueprint(state), url_prefix="/api")

    @app.get("/api/config")
    @require_operator(state)
    def public_config():
        return jsonify(safe_public_config(state.cfg))

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        response.headers.setdefault("Cache-Control", "no-store" if request.path.startswith("/api/") else "no-cache")
        return response

    @app.get("/")
    def index():
        if (static_dir / "index.html").exists():
            return send_from_directory(static_dir, "index.html")
        return "Frontend no compilado. Ejecuta npm run build en frontend.", 200

    @app.get("/<path:path>")
    def spa(path: str):
        candidate = static_dir / path
        if candidate.exists() and candidate.is_file():
            return send_from_directory(static_dir, path)
        if (static_dir / "index.html").exists():
            return send_from_directory(static_dir, "index.html")
        return jsonify({"ok": False, "error": "Not found"}), 404

    return app
