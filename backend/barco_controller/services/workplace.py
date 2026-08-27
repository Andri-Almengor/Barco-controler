from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Iterator

from .ctrl_api import CtrlApiClient


@dataclass(frozen=True)
class WallItem:
    kind: str
    id: str
    label: str = ""


@dataclass(frozen=True)
class WallPlacement:
    item: WallItem
    geometry: dict[str, Any]


class WorkplaceController:
    """Single writer for Barco workplaces.

    Every wall mutation passes through this class. A per-workplace RLock makes
    route steps, manual operations, mixed layouts and camera interruptions
    mutually exclusive.
    """

    def __init__(self, cfg: dict[str, Any], endpoints: dict[str, Any], api: CtrlApiClient):
        self.cfg = cfg
        self.endpoints = endpoints
        self.api = api
        self._locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.Lock()
        self._owners: dict[str, str] = {}
        self._owners_guard = threading.RLock()

    def geometry_for(self, workplace_id: str) -> dict[str, Any]:
        for workplace in self.cfg.get("workplaces", []):
            if str(workplace.get("id")) == str(workplace_id):
                geometry = workplace.get("geometry")
                if isinstance(geometry, dict):
                    return geometry
        return {"type": "px", "x": 0, "y": 0, "width": 1920, "height": 1080}

    def _lock_for(self, workplace_id: str) -> threading.RLock:
        with self._locks_guard:
            return self._locks.setdefault(workplace_id, threading.RLock())

    @contextmanager
    def exclusive(self, workplace_id: str, owner: str, timeout: float = 45) -> Iterator[None]:
        lock = self._lock_for(workplace_id)
        acquired = lock.acquire(timeout=timeout)
        if not acquired:
            raise TimeoutError(f"Workplace {workplace_id} ocupado por otra operación")
        with self._owners_guard:
            previous = self._owners.get(workplace_id)
            self._owners[workplace_id] = owner
        try:
            yield
        finally:
            with self._owners_guard:
                if previous:
                    self._owners[workplace_id] = previous
                else:
                    self._owners.pop(workplace_id, None)
            lock.release()

    def owner(self, workplace_id: str) -> str | None:
        with self._owners_guard:
            return self._owners.get(workplace_id)

    @staticmethod
    def _content(item: WallItem) -> dict[str, str]:
        content_type = "Source" if item.kind.lower() == "source" else "Composition"
        return {"type": content_type, "id": item.id}

    def _payload(self, workplace_id: str, item: WallItem) -> list[dict[str, Any]]:
        return [{"geometry": self.geometry_for(workplace_id), "content": self._content(item)}]

    @staticmethod
    def _layout_payload(placements: list[WallPlacement]) -> list[dict[str, Any]]:
        payload: list[dict[str, Any]] = []
        for placement in placements:
            if not placement.item.id:
                raise ValueError("Uno de los elementos del layout no tiene id")
            geometry = dict(placement.geometry or {})
            payload.append({
                "geometry": {
                    "type": str(geometry.get("type") or "px"),
                    "x": int(geometry.get("x") or 0),
                    "y": int(geometry.get("y") or 0),
                    "width": max(1, int(geometry.get("width") or 1)),
                    "height": max(1, int(geometry.get("height") or 1)),
                },
                "content": WorkplaceController._content(placement.item),
            })
        return payload

    def _pre_clear_delay(self) -> None:
        delay_ms = int(((self.cfg.get("barco") or {}).get("pre_clear_delay_ms") or 600))
        if delay_ms > 0:
            time.sleep(delay_ms / 1000)

    def clear_locked(self, workplace_id: str) -> None:
        endpoint = self.endpoints["operate"]["clear_workplace_content"].format(workplaceId=workplace_id)
        self.api.request("DELETE", endpoint)

    def apply_locked(self, workplace_id: str, item: WallItem, *, pre_clear: bool = True) -> None:
        if not item.id:
            raise ValueError("El contenido no tiene id")
        if pre_clear:
            self.clear_locked(workplace_id)
            self._pre_clear_delay()
        endpoint = self.endpoints["operate"]["set_workplace_content"].format(workplaceId=workplace_id)
        self.api.request("PUT", endpoint, json_body=self._payload(workplace_id, item))

    def apply_layout_locked(self, workplace_id: str, placements: list[WallPlacement], *, pre_clear: bool = True) -> None:
        if not placements:
            raise ValueError("El layout no tiene elementos")
        if pre_clear:
            self.clear_locked(workplace_id)
            self._pre_clear_delay()
        endpoint = self.endpoints["operate"]["set_workplace_content"].format(workplaceId=workplace_id)
        self.api.request("PUT", endpoint, json_body=self._layout_payload(placements))

    def apply(self, workplace_id: str, item: WallItem, owner: str = "manual") -> None:
        with self.exclusive(workplace_id, owner):
            self.apply_locked(workplace_id, item)

    def apply_layout(self, workplace_id: str, placements: list[WallPlacement], owner: str = "layout") -> None:
        with self.exclusive(workplace_id, owner):
            self.apply_layout_locked(workplace_id, placements)

    def clear(self, workplace_id: str, owner: str = "manual") -> None:
        with self.exclusive(workplace_id, owner):
            self.clear_locked(workplace_id)

    def get_content(self, workplace_id: str) -> Any:
        endpoint = self.endpoints["operate"]["get_workplace_content"].format(workplaceId=workplace_id)
        return self.api.request("GET", endpoint)

    def list_workplaces(self) -> list[dict[str, Any]]:
        endpoint = self.endpoints["operate"].get("list_workplaces", "/operate/v3/workplaces")
        return self._unwrap(self.api.request("GET", endpoint))

    def list_compositions(self) -> list[dict[str, Any]]:
        endpoint = self.endpoints["operate"]["list_compositions"]
        return self._unwrap(self.api.request("GET", endpoint))

    def list_sources(self, workplace_id: str | None = None) -> list[dict[str, Any]]:
        endpoint = self.endpoints["operate"]["list_sources"]
        params = {"workplaceId": workplace_id} if workplace_id else None
        return self._unwrap(self.api.request("GET", endpoint, params=params))

    @staticmethod
    def _unwrap(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for key in ("data", "items", "results", "value", "workplaces", "sources", "compositions"):
                if isinstance(value.get(key), list):
                    return value[key]
        return []
