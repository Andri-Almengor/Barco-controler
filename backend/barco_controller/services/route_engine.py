from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any

from ..storage.repositories import RouteRepository
from .external_sources import ExternalRendererService
from .workplace import WallItem, WorkplaceController


@dataclass
class RouteRuntime:
    route_id: str
    state: str = "stopped"
    index: int = 0
    last_error: str | None = None
    last_item: dict[str, Any] | None = None
    next_run_at: float | None = None
    generation: int = 0
    wake: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None


class RouteEngine:
    """Backend route scheduler with explicit state and cancellation generation."""

    def __init__(self, routes: RouteRepository, workplace: WorkplaceController, external: ExternalRendererService | None = None, cfg: dict[str, Any] | None = None):
        self.routes = routes
        self.workplace = workplace
        self.external = external
        self.cfg = cfg or {}
        self._runtimes: dict[str, RouteRuntime] = {}
        self._lock = threading.RLock()
        self._events: list[dict[str, Any]] = []

    def _local_origin(self) -> str:
        server = self.cfg.get("server") or {}
        port = int(server.get("port") or 8080)
        return f"http://127.0.0.1:{port}"

    def _resolve_item(self, raw_item: dict[str, Any]) -> WallItem:
        kind = str(raw_item.get("kind") or "composition").lower()
        item_id = str(raw_item.get("id") or "")
        label = str(raw_item.get("label") or "")
        if kind == "external":
            if not self.external:
                raise RuntimeError("El renderer externo no está disponible")
            return self.external.activate(item_id, local_origin=self._local_origin())
        return WallItem(kind=kind, id=item_id, label=label)

    def _log(self, level: str, message: str, **extra: Any) -> None:
        with self._lock:
            self._events.insert(0, {"ts": time.time(), "level": level, "message": message, **extra})
            del self._events[300:]

    def logs(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._events)

    def _runtime(self, route_id: str) -> RouteRuntime:
        with self._lock:
            return self._runtimes.setdefault(route_id, RouteRuntime(route_id=route_id))

    def start(self, route_id: str, *, reset_index: bool = False) -> dict[str, Any]:
        route = self.routes.get(route_id)
        if not route:
            raise ValueError("Recorrido no encontrado")
        if not route.get("workplaceId"):
            raise ValueError("El recorrido no tiene workplace")
        if not route.get("items"):
            raise ValueError("El recorrido no tiene elementos")

        runtime = self._runtime(route_id)
        with self._lock:
            runtime.generation += 1
            if reset_index:
                runtime.index = 0
            runtime.state = "running"
            runtime.last_error = None
            runtime.next_run_at = time.time()
            runtime.wake.set()
            generation = runtime.generation
            if runtime.thread is None or not runtime.thread.is_alive():
                runtime.thread = threading.Thread(target=self._worker, args=(route_id, generation), daemon=True, name=f"route-{route_id[:8]}")
                runtime.thread.start()
            else:
                threading.Thread(target=self._ensure_worker_after_exit, args=(route_id, generation), daemon=True).start()
        self._log("ok", f"Recorrido iniciado: {route.get('name')}", routeId=route_id)
        return self.status(route_id)

    def _ensure_worker_after_exit(self, route_id: str, generation: int) -> None:
        time.sleep(0.05)
        runtime = self._runtime(route_id)
        old_thread = runtime.thread
        if old_thread and old_thread is not threading.current_thread():
            old_thread.join(timeout=2)
        with self._lock:
            if runtime.state == "running" and runtime.generation == generation and (runtime.thread is None or not runtime.thread.is_alive()):
                runtime.thread = threading.Thread(target=self._worker, args=(route_id, generation), daemon=True, name=f"route-{route_id[:8]}")
                runtime.thread.start()

    def stop(self, route_id: str, *, clear_wall: bool = True) -> dict[str, Any]:
        route = self.routes.get(route_id)
        runtime = self._runtime(route_id)
        with self._lock:
            runtime.state = "stopped"
            runtime.generation += 1
            runtime.next_run_at = None
            runtime.wake.set()
        if clear_wall and route and route.get("workplaceId"):
            try:
                self.workplace.clear(str(route["workplaceId"]), owner=f"route-stop:{route_id}")
            except Exception as exc:
                self._log("warn", f"Recorrido detenido, pero no se pudo limpiar el wall: {exc}", routeId=route_id)
        self._log("warn", f"Recorrido detenido: {route.get('name') if route else route_id}", routeId=route_id)
        return self.status(route_id)

    def pause(self, route_id: str) -> dict[str, Any]:
        runtime = self._runtime(route_id)
        with self._lock:
            if runtime.state == "running":
                runtime.state = "paused"
                runtime.generation += 1
                runtime.next_run_at = None
                runtime.wake.set()
        self._log("info", "Recorrido pausado", routeId=route_id)
        return self.status(route_id)

    def resume(self, route_id: str) -> dict[str, Any]:
        return self.start(route_id, reset_index=False)

    def status(self, route_id: str) -> dict[str, Any]:
        runtime = self._runtime(route_id)
        route = self.routes.get(route_id)
        with self._lock:
            return {"routeId": route_id, "routeName": route.get("name") if route else None, "state": runtime.state, "index": runtime.index, "lastError": runtime.last_error, "lastItem": runtime.last_item, "nextRunAt": runtime.next_run_at}

    def statuses(self) -> list[dict[str, Any]]:
        route_ids = {str(r.get("id")) for r in self.routes.list() if r.get("id")}
        with self._lock:
            route_ids.update(self._runtimes.keys())
        return [self.status(route_id) for route_id in route_ids]

    def state_for_workplace(self, workplace_id: str) -> list[dict[str, Any]]:
        return [self.status(str(route["id"])) for route in self.routes.list() if str(route.get("workplaceId")) == str(workplace_id)]

    def stop_all(self, *, clear_wall: bool = False) -> None:
        for route in self.routes.list():
            route_id = str(route.get("id") or "")
            if route_id:
                try:
                    self.stop(route_id, clear_wall=clear_wall)
                except Exception:
                    pass

    def _worker(self, route_id: str, generation: int) -> None:
        runtime = self._runtime(route_id)
        while True:
            with self._lock:
                if runtime.generation != generation or runtime.state != "running":
                    return
            route = self.routes.get(route_id)
            if not route or not route.get("items"):
                with self._lock:
                    runtime.state = "error"
                    runtime.last_error = "El recorrido fue eliminado o quedó vacío"
                    runtime.next_run_at = None
                return

            items = route["items"]
            idx = runtime.index % len(items)
            raw_item = items[idx]
            try:
                workplace_id = str(route["workplaceId"])
                with self.workplace.exclusive(workplace_id, owner=f"route:{route_id}"):
                    with self._lock:
                        if runtime.generation != generation or runtime.state != "running":
                            return
                    item = self._resolve_item(raw_item)
                    with self._lock:
                        if runtime.generation != generation or runtime.state != "running":
                            return
                    self.workplace.apply_locked(workplace_id, item, pre_clear=True)
                with self._lock:
                    if runtime.generation != generation or runtime.state != "running":
                        return
                    runtime.last_item = {"index": idx, **raw_item}
                    runtime.index = (idx + 1) % len(items)
                    runtime.last_error = None
                self._log("ok", f"Recorrido {route.get('name')}: {raw_item.get('label') or raw_item.get('id')}", routeId=route_id)
            except Exception as exc:
                with self._lock:
                    if runtime.generation != generation:
                        return
                    runtime.last_error = str(exc)
                self._log("err", f"Error en recorrido {route.get('name')}: {exc}", routeId=route_id)

            interval = max(3, int(route.get("intervalSec") or 30))
            deadline = time.time() + interval
            with self._lock:
                runtime.next_run_at = deadline
                runtime.wake.clear()
            while time.time() < deadline:
                with self._lock:
                    if runtime.generation != generation or runtime.state != "running":
                        runtime.next_run_at = None
                        return
                remaining = max(0.05, min(0.5, deadline - time.time()))
                if runtime.wake.wait(remaining):
                    runtime.wake.clear()
                    with self._lock:
                        if runtime.generation != generation or runtime.state != "running":
                            runtime.next_run_at = None
                            return
