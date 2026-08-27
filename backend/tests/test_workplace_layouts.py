from __future__ import annotations

import unittest

from barco_controller.services.workplace import WallItem, WallPlacement, WorkplaceController


class FakeApi:
    def __init__(self):
        self.calls = []

    def request(self, method, endpoint, **kwargs):
        self.calls.append((method, endpoint, kwargs))
        return {}


class WorkplaceLayoutTests(unittest.TestCase):
    def test_layout_payload_contains_multiple_geometries(self):
        api = FakeApi()
        controller = WorkplaceController(
            {"barco": {"pre_clear_delay_ms": 0}},
            {"operate": {
                "clear_workplace_content": "/workplaces/{workplaceId}/content",
                "set_workplace_content": "/workplaces/{workplaceId}/content",
                "get_workplace_content": "/workplaces/{workplaceId}/content",
                "list_compositions": "/compositions",
                "list_sources": "/sources",
            }},
            api,
        )
        placements = [
            WallPlacement(WallItem("source", "source-1", "Cam"), {"x": 0, "y": 0, "width": 960, "height": 1080}),
            WallPlacement(WallItem("composition", "comp-1", "Comp"), {"x": 960, "y": 0, "width": 960, "height": 1080}),
        ]

        controller.apply_layout_locked("wp", placements, pre_clear=False)

        self.assertEqual(len(api.calls), 1)
        method, endpoint, kwargs = api.calls[0]
        self.assertEqual(method, "PUT")
        self.assertEqual(endpoint, "/workplaces/wp/content")
        payload = kwargs["json_body"]
        self.assertEqual(len(payload), 2)
        self.assertEqual(payload[0]["content"], {"type": "Source", "id": "source-1"})
        self.assertEqual(payload[1]["content"], {"type": "Composition", "id": "comp-1"})
        self.assertEqual(payload[1]["geometry"]["x"], 960)


if __name__ == "__main__":
    unittest.main()
