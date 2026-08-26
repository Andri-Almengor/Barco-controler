from __future__ import annotations

import argparse

from waitress.server import create_server

from barco_controller import create_app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    app = create_app()
    print(f"[Barco Controller] http://{args.host}:{args.port}")
    create_server(app, host=args.host, port=args.port, threads=8).run()


if __name__ == "__main__":
    main()
