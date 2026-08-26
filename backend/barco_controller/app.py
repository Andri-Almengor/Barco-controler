from __future__ import annotations

from flask import Flask, jsonify, request, send_from_directory

from .api.auth import create_auth_blueprint
from .api.cameras import create_cameras_blueprint
from .api.control import create_control_blueprint
from .api.diagnostics import create_diagnostics_blueprint
from .api.external import create_external_blueprint
from .api.routes import create_routes_blueprint
from .api.setup import create_setup_blueprint
from .config import getenv, safe_public_config
from .paths import STATIC_DIR, ensure_runtime_dirs, load_or_create_app_secret
from .security import require_operator
from .state import StateManager


def create_app() -> Flask:
    ensure_runtime_dirs()
    static_dir = STATIC_DIR
    app = Flask(__name__, static_folder=str(static_dir), static_url_path="/")
    state = StateManager()
    app.config["BARCO_STATE"] = state
    app.secret_key = getenv("BARCO_APP_SECRET") or load_or_create_app_secret()
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax")

    app.register_blueprint(create_setup_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_auth_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_control_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_routes_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_cameras_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_external_blueprint(state), url_prefix="/api")
    app.register_blueprint(create_diagnostics_blueprint(state), url_prefix="/api")

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
