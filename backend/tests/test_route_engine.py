from __future__ import annotations

import tempfile
import threading
import time
import unittest
from contextlib import contextmanager
from pathlib import Path

from barco_controller.services.route_engine import RouteEngine
from barco_controller.storage.json_store import JsonStore
from barco_controller.storage.repositories import RouteRepository


class FakeWorkplace:
    def __init__(self):
        self.lock = threading.RLock()
        self.applied = []
        self.cleared = []

    @contextmanager
    def exclusive(self, workplace_id, owner, timeout=45):
        acquired = self.lock.acquire(timeout=timeout)
        if not acquired:
            raise TimeoutError
        try:
            yield
        finally:
            self.lock.release()

    def apply_locked(self, workplace_id, item, pre_clear=True):
        self.applied.append((workplace_id, item.id))

    def clear(self, workplace_id, owner="manual"):
        with self.lock:
            self.cleared.append(workplace_id)


class RouteEngineTests(unittest.TestCase):
    def test_stop_cancels_route_waiting_behind_exclusive_lock(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = RouteRepository(JsonStore(Path(tmp) / "routes.json"))
            route = repo.save({"name": "R1", "workplaceId": "wall", "intervalSec": 3, "items": [{"kind": "source", "id": "cam1", "label": "Cam 1"}]})
            wall = FakeWorkplace()
            engine = RouteEngine(repo, wall)

            wall.lock.acquire()
            try:
                engine.start(route["id"])
                time.sleep(0.1)
                engine.stop(route["id"], clear_wall=False)
            finally:
                wall.lock.release()

            time.sleep(0.2)
            self.assertEqual(engine.status(route["id"])["state"], "stopped")
            self.assertEqual(wall.applied, [])


if __name__ == "__main__":
    unittest.main()
