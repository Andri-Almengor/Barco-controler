from __future__ import annotations

import unittest

from desktop_launcher import _normalize_bind_host, _probe_hosts, _ui_url


class DesktopLauncherTests(unittest.TestCase):
    def test_localhost_is_normalized_to_ipv4_loopback(self):
        self.assertEqual(_normalize_bind_host("localhost"), "127.0.0.1")

    def test_wildcard_binding_is_probed_through_loopback(self):
        self.assertEqual(_probe_hosts("0.0.0.0")[0], "127.0.0.1")
        self.assertEqual(_ui_url("0.0.0.0", 8080), "http://127.0.0.1:8080")

    def test_specific_binding_keeps_host_and_adds_local_fallback(self):
        self.assertEqual(_probe_hosts("192.168.10.20"), ["192.168.10.20", "127.0.0.1"])


if __name__ == "__main__":
    unittest.main()
