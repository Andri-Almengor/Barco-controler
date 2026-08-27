from __future__ import annotations

import unittest

from barco_controller.services.workplace import WallItem, WallPlacement, WorkplaceController


class FakeApi:
    def __init__(self):
        self.calls = []

    def request(self, method, endpoint, **kwargs):
        self.calls.append((method, endpoint, kwargs))
        return {}


def make_controller(api: FakeApi) -> WorkplaceController:
    return WorkplaceController(
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


class WorkplaceLayoutTests(unittest.TestCase):
    def test_layout_payload_contains_multiple_geometries(self):
        api = FakeApi()
        controller = make_controller(api)
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

    def test_overlapping_placements_keep_geometry_and_layer_order(self):
        api = FakeApi()
        controller = make_controller(api)
        placements = [
            WallPlacement(
                WallItem("source", "source-back", "Background"),
                {"type": "px", "x": 0, "y": 0, "width": 1600, "height": 900},
            ),
            WallPlacement(
                WallItem("source", "source-middle", "Middle"),
                {"type": "px", "x": 200, "y": 100, "width": 1200, "height": 700},
            ),
            WallPlacement(
                WallItem("composition", "comp-front", "Front"),
                {"type": "px", "x": 450, "y": 220, "width": 720, "height": 420},
            ),
        ]

        controller.apply_layout_locked("wall-main", placements, pre_clear=False)

        payload = api.calls[0][2]["json_body"]
        self.assertEqual(
            [entry["content"]["id"] for entry in payload],
            ["source-back", "source-middle", "comp-front"],
        )
        self.assertEqual(
            payload[1]["geometry"],
            {"type": "px", "x": 200, "y": 100, "width": 1200, "height": 700},
        )
        self.assertEqual(
            payload[2]["geometry"],
            {"type": "px", "x": 450, "y": 220, "width": 720, "height": 420},
        )
        self.assertLess(payload[1]["geometry"]["x"], payload[0]["geometry"]["width"])
        self.assertLess(payload[2]["geometry"]["x"], payload[1]["geometry"]["x"] + payload[1]["geometry"]["width"])


if __name__ == "__main__":
    unittest.main()
