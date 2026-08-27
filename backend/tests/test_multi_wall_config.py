from __future__ import annotations

import unittest

from barco_controller.config import normalize_config


class MultiWallConfigTests(unittest.TestCase):
    def test_legacy_workplaces_become_primary_then_secondary(self):
        cfg = normalize_config({
            "workplaces": [
                {"id": "main", "name": "Wall principal"},
                {"id": "crisis", "name": "Sala de crisis"},
                {"id": "office", "name": "Oficina"},
            ]
        })
        self.assertEqual(cfg["workplaces"][0]["role"], "primary")
        self.assertEqual(cfg["workplaces"][1]["role"], "secondary")
        self.assertEqual(cfg["workplaces"][2]["role"], "secondary")

    def test_only_one_primary_is_kept(self):
        cfg = normalize_config({
            "workplaces": [
                {"id": "a", "name": "A", "role": "primary"},
                {"id": "b", "name": "B", "role": "primary"},
            ]
        })
        self.assertEqual([w["role"] for w in cfg["workplaces"]], ["primary", "secondary"])


if __name__ == "__main__":
    unittest.main()
