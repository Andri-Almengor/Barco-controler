from __future__ import annotations

import time
import unittest

from barco_controller.services.oidc import OIDCSession, TokenSet


class OIDCSessionPreservationTests(unittest.TestCase):
    def test_same_oidc_identity_can_reuse_operator_session(self):
        previous = OIDCSession("https://ctrl.example/auth/realms/OCS", "proxima", None, False)
        previous._token = TokenSet("access-1", "refresh-1", time.time() + 3600)
        previous._well_known = {"token_endpoint": "https://ctrl.example/token"}

        replacement = OIDCSession("https://ctrl.example/auth/realms/OCS", "proxima", None, True)
        preserved = replacement.adopt_session_from(previous)

        self.assertTrue(preserved)
        self.assertTrue(replacement.status()["authenticated"])
        self.assertEqual(replacement.get_access_token(), "access-1")
        self.assertEqual(replacement._well_known, previous._well_known)
        self.assertIsNot(replacement._token, previous._token)

    def test_changed_ctrl_identity_requires_new_login(self):
        previous = OIDCSession("https://ctrl-a.example/auth/realms/OCS", "proxima", None, False)
        previous._token = TokenSet("access-1", "refresh-1", time.time() + 3600)

        replacement = OIDCSession("https://ctrl-b.example/auth/realms/OCS", "proxima", None, False)
        preserved = replacement.adopt_session_from(previous)

        self.assertFalse(preserved)
        self.assertFalse(replacement.status()["authenticated"])

    def test_changed_client_id_requires_new_login(self):
        previous = OIDCSession("https://ctrl.example/auth/realms/OCS", "client-a", None, False)
        previous._token = TokenSet("access-1", "refresh-1", time.time() + 3600)

        replacement = OIDCSession("https://ctrl.example/auth/realms/OCS", "client-b", None, False)
        preserved = replacement.adopt_session_from(previous)

        self.assertFalse(preserved)
        self.assertFalse(replacement.status()["authenticated"])


if __name__ == "__main__":
    unittest.main()
