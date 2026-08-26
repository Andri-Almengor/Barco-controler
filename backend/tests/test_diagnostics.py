from __future__ import annotations

import socket
import threading
import unittest

from barco_controller.config import normalize_config
from barco_controller.services.diagnostics import DiagnosticsService


class DiagnosticsTests(unittest.TestCase):
    def test_renderer_vnc_defaults_are_normalized(self):
        cfg = normalize_config({})
        renderer = cfg["renderers"][0]
        self.assertEqual(renderer["vnc_host"], "127.0.0.1")
        self.assertEqual(renderer["vnc_port"], 5900)

    def test_vnc_inspector_requires_rfb_banner(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]

        def serve():
            client, _ = server.accept()
            with client:
                client.sendall(b"RFB 003.008\n")
            server.close()

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        result = DiagnosticsService.inspect_vnc("127.0.0.1", port, timeout=1)
        thread.join(timeout=1)
        self.assertTrue(result["reachable"])
        self.assertEqual(result["protocol"], "RFB")
        self.assertEqual(result["banner"], "RFB 003.008")

    def test_closed_vnc_port_is_not_ready(self):
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        result = DiagnosticsService.inspect_vnc("127.0.0.1", port, timeout=0.1)
        self.assertFalse(result["reachable"])
        self.assertIsNone(result["protocol"])


if __name__ == "__main__":
    unittest.main()
