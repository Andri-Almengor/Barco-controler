from __future__ import annotations

import unittest

from desktop_launcher import _effective_bind_host, _normalize_bind_host, _probe_hosts, _ui_url


class DesktopLauncherTests(unittest.TestCase):
    def test_localhost_is_normalized_to_ipv4_loopback(self):
        self.assertEqual(_normalize_bind_host("localhost"), "127.0.0.1")

    def test_wildcard_binding_is_probed_through_loopback(self):
        self.assertEqual(_probe_hosts("0.0.0.0")[0], "127.0.0.1")
        self.assertEqual(_ui_url("0.0.0.0", 8080), "http://127.0.0.1:8080")

    def test_specific_binding_keeps_host_and_adds_local_fallback(self):
        self.assertEqual(_probe_hosts("192.168.10.20"), ["192.168.10.20", "127.0.0.1"])

    def test_lan_access_uses_all_ipv4_interfaces(self):
        self.assertEqual(
            _effective_bind_host({"host": "127.0.0.1", "lan_access": True}),
            "0.0.0.0",
        )

    def test_lan_access_can_be_disabled_for_local_only_operation(self):
        self.assertEqual(
            _effective_bind_host({"host": "127.0.0.1", "lan_access": False}),
            "127.0.0.1",
        )


if __name__ == "__main__":
    unittest.main()
