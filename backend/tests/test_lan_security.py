from __future__ import annotations

import unittest

from barco_controller.app import _private_or_local_client


class LanSecurityTests(unittest.TestCase):
    def test_loopback_is_allowed(self):
        self.assertTrue(_private_or_local_client("127.0.0.1"))
        self.assertTrue(_private_or_local_client("::1"))

    def test_rfc1918_clients_are_allowed(self):
        self.assertTrue(_private_or_local_client("192.168.68.25"))
        self.assertTrue(_private_or_local_client("10.20.30.40"))
        self.assertTrue(_private_or_local_client("172.16.5.8"))

    def test_public_clients_are_rejected(self):
        self.assertFalse(_private_or_local_client("8.8.8.8"))
        self.assertFalse(_private_or_local_client("1.1.1.1"))


if __name__ == "__main__":
    unittest.main()
