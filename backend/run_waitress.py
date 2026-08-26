from __future__ import annotations

import argparse

from waitress.server import create_server

from barco_controller import create_app
from barco_controller.config import load_config_or_default


def main() -> None:
    cfg = load_config_or_default()
    server_cfg = cfg.get("server") or {}

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=None, help="Sobrescribe server.host")
    parser.add_argument("--port", type=int, default=None, help="Sobrescribe server.port")
    args = parser.parse_args()

    host = args.host or str(server_cfg.get("host") or "127.0.0.1")
    port = args.port or int(server_cfg.get("port") or 8080)
    app = create_app()
    print(f"[Barco Controller] http://{host}:{port}")
    print("[Barco Controller] Si es la primera ejecución, abre la interfaz local para completar el asistente.")
    create_server(app, host=host, port=port, threads=8).run()


if __name__ == "__main__":
    main()
