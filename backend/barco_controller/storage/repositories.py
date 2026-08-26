from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import urlparse

from .json_store import JsonStore


def normalize_route_item(item: dict[str, Any]) -> dict[str, str]:
    kind = str(item.get("kind") or "composition").strip().lower()
    if kind not in {"composition", "source", "external"}:
        kind = "composition"
    item_id = str(item.get("id") or item.get("sourceId") or item.get("compositionId") or item.get("externalId") or "").strip()
    return {"kind": kind, "id": item_id, "label": str(item.get("label") or "")}


class RouteRepository:
    def __init__(self, store: JsonStore):
        self.store = store

    def list(self) -> list[dict[str, Any]]:
        value = self.store.read()
        return value if isinstance(value, list) else []

    def get(self, route_id: str) -> dict[str, Any] | None:
        return next((r for r in self.list() if str(r.get("id")) == str(route_id)), None)

    def save(self, body: dict[str, Any]) -> dict[str, Any]:
        routes = self.list()
        route_id = str(body.get("id") or uuid.uuid4())
        items = body.get("items") or []
        if not isinstance(items, list):
            raise ValueError("items debe ser una lista")
        route = {
            "id": route_id,
            "name": str(body.get("name") or "Recorrido").strip() or "Recorrido",
            "intervalSec": max(3, int(body.get("intervalSec") or 30)),
            "workplaceId": str(body.get("workplaceId") or "").strip(),
            "items": [normalize_route_item(item) for item in items if isinstance(item, dict)],
            "updatedAt": int(time.time()),
        }
        routes = [r for r in routes if str(r.get("id")) != route_id]
        routes.insert(0, route)
        self.store.write(routes)
        return route

    def delete(self, route_id: str) -> None:
        self.store.write([r for r in self.list() if str(r.get("id")) != str(route_id)])


class CameraRuleRepository:
    SECRET_FIELDS = {"password"}

    def __init__(self, store: JsonStore):
        self.store = store

    def list_raw(self) -> list[dict[str, Any]]:
        value = self.store.read()
        return value if isinstance(value, list) else []

    @classmethod
    def public_rule(cls, rule: dict[str, Any]) -> dict[str, Any]:
        result = dict(rule)
        password = str(result.pop("password", "") or "")
        result["hasPassword"] = bool(password)
        return result

    def list_public(self) -> list[dict[str, Any]]:
        return [self.public_rule(r) for r in self.list_raw()]

    def get_raw(self, rule_id: str) -> dict[str, Any] | None:
        return next((r for r in self.list_raw() if str(r.get("id")) == str(rule_id)), None)

    def save(self, body: dict[str, Any]) -> dict[str, Any]:
        rules = self.list_raw()
        rule_id = str(body.get("id") or uuid.uuid4())
        existing = self.get_raw(rule_id) or {}
        password = body.get("password")
        if password in (None, "", "••••••••"):
            password = existing.get("password", "")

        display_kind = str(body.get("displayKind") or "source").lower()
        if display_kind not in {"source", "composition"}:
            display_kind = "source"

        rule = {
            "id": rule_id,
            "name": str(body.get("name") or "Nueva cámara").strip() or "Nueva cámara",
            "enabled": bool(body.get("enabled", True)),
            "rtspUrl": str(body.get("rtspUrl") or body.get("ip") or "").strip(),
            "username": str(body.get("username") or "").strip(),
            "password": str(password or ""),
            "workplaceId": str(body.get("workplaceId") or "").strip(),
            "displayKind": display_kind,
            "itemId": str(body.get("itemId") or body.get("wallSourceId") or body.get("compositionId") or "").strip(),
            "itemLabel": str(body.get("itemLabel") or body.get("wallSourceLabel") or body.get("compositionLabel") or "").strip(),
            "group": str(body.get("group") or "").strip(),
            "groupCompositionId": str(body.get("groupCompositionId") or "").strip(),
            "priority": int(body.get("priority") or 1),
            "durationSec": max(1, int(body.get("durationSec") or 15)),
            "cooldownSec": max(0, int(body.get("cooldownSec") or 20)),
            "scheduleStart": str(body.get("scheduleStart") or "00:00"),
            "scheduleEnd": str(body.get("scheduleEnd") or "23:59"),
            "enabledHoursOnly": bool(body.get("enabledHoursOnly", False)),
            "detectionMode": str(body.get("detectionMode") or "manual"),
            "minArea": max(1, int(body.get("minArea") or 2500)),
            "updatedAt": int(time.time()),
        }
        rules = [r for r in rules if str(r.get("id")) != rule_id]
        rules.insert(0, rule)
        self.store.write(rules)
        return self.public_rule(rule)

    def delete(self, rule_id: str) -> None:
        self.store.write([r for r in self.list_raw() if str(r.get("id")) != str(rule_id)])


class ExternalSourceRepository:
    VALID_TYPES = {"web", "image", "video"}

    def __init__(self, store: JsonStore):
        self.store = store

    def list(self) -> list[dict[str, Any]]:
        value = self.store.read()
        return value if isinstance(value, list) else []

    def get(self, source_id: str) -> dict[str, Any] | None:
        return next((item for item in self.list() if str(item.get("id")) == str(source_id)), None)

    @staticmethod
    def _validate_url(url: str) -> str:
        url = str(url or "").strip()
        parsed = urlparse(url)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
            raise ValueError("La URL debe comenzar con http:// o https://")
        return url

    def save(self, body: dict[str, Any]) -> dict[str, Any]:
        items = self.list()
        source_id = str(body.get("id") or uuid.uuid4())
        kind = str(body.get("type") or "web").strip().lower()
        if kind not in self.VALID_TYPES:
            raise ValueError("Tipo externo no soportado")
        item = {
            "id": source_id,
            "name": str(body.get("name") or "Contenido externo").strip() or "Contenido externo",
            "type": kind,
            "url": self._validate_url(str(body.get("url") or "")),
            "rendererId": str(body.get("rendererId") or "main").strip() or "main",
            "enabled": bool(body.get("enabled", True)),
            "updatedAt": int(time.time()),
        }
        items = [entry for entry in items if str(entry.get("id")) != source_id]
        items.insert(0, item)
        self.store.write(items)
        return item

    def delete(self, source_id: str) -> None:
        self.store.write([item for item in self.list() if str(item.get("id")) != str(source_id)])
