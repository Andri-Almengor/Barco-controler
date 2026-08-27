from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from barco_controller.storage.json_store import JsonStore
from barco_controller.storage.repositories import CameraRuleRepository, LayoutRepository, RouteRepository


class RepositoryTests(unittest.TestCase):
    def test_camera_password_is_never_exposed(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = CameraRuleRepository(JsonStore(Path(tmp) / "cameras.json"))
            saved = repo.save({"name": "Cam 1", "password": "secret", "workplaceId": "wp", "itemId": "source"})
            self.assertNotIn("password", saved)
            self.assertTrue(saved["hasPassword"])
            listed = repo.list_public()[0]
            self.assertNotIn("password", listed)
            self.assertEqual(repo.get_raw(listed["id"])["password"], "secret")

    def test_blank_password_preserves_existing_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = CameraRuleRepository(JsonStore(Path(tmp) / "cameras.json"))
            first = repo.save({"name": "Cam", "password": "secret"})
            repo.save({"id": first["id"], "name": "Cam editada", "password": ""})
            self.assertEqual(repo.get_raw(first["id"])["password"], "secret")

    def test_route_items_are_normalized(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = RouteRepository(JsonStore(Path(tmp) / "routes.json"))
            route = repo.save({"name": "R", "workplaceId": "wp", "items": [{"compositionId": "abc", "label": "Comp"}]})
            self.assertEqual(route["items"][0], {"kind": "composition", "id": "abc", "label": "Comp"})

    def test_layout_items_keep_geometry_and_external_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = LayoutRepository(JsonStore(Path(tmp) / "layouts.json"))
            layout = repo.save({
                "name": "Mixto",
                "workplaceId": "wp",
                "items": [{
                    "kind": "external",
                    "id": "web-1",
                    "label": "Dashboard",
                    "geometry": {"x": 100, "y": 50, "width": 900, "height": 500},
                }],
            })
            item = layout["items"][0]
            self.assertEqual(item["kind"], "external")
            self.assertEqual(item["id"], "web-1")
            self.assertEqual(item["geometry"], {"type": "px", "x": 100, "y": 50, "width": 900, "height": 500})


if __name__ == "__main__":
    unittest.main()
