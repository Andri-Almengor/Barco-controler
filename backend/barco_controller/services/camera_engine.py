from __future__ import annotations

import queue
import threading
import time
import uuid
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

try:
    import cv2  # type: ignore
except Exception:  # pragma: no cover
    cv2 = None

from ..storage.repositories import CameraRuleRepository
from .route_engine import RouteEngine
from .workplace import WallItem, WorkplaceController


class CameraEngine:
    def __init__(self, repo: CameraRuleRepository, workplace: WorkplaceController, routes: RouteEngine, cfg: dict[str, Any]):
        self.repo = repo
        self.workplace = workplace
        self.routes = routes
        self.cfg = cfg
        self._running = False
        self._stop = threading.Event()
        self._workers: dict[str, threading.Thread] = {}
        self._processor: threading.Thread | None = None
        self._queue: queue.PriorityQueue[tuple[int, int, dict[str, Any]]] = queue.PriorityQueue()
        self._event_seq = 0
        self._active_event: dict[str, Any] | None = None
        self._active_until = 0.0
        self._last_trigger: dict[str, float] = {}
        self._logs: list[dict[str, Any]] = []
        self._lock = threading.RLock()

    def _log(self, level: str, message: str, **extra: Any) -> None:
        with self._lock:
            self._logs.insert(0, {"ts": time.time(), "level": level, "message": message, **extra})
            del self._logs[300:]

    def list_rules(self) -> list[dict[str, Any]]:
        return self.repo.list_public()

    def save_rule(self, body: dict[str, Any]) -> dict[str, Any]:
        rule = self.repo.save(body)
        self._log("ok", f"Regla guardada: {rule['name']}", ruleId=rule["id"])
        if self._running:
            self.restart()
        return rule

    def delete_rule(self, rule_id: str) -> None:
        self.repo.delete(rule_id)
        self._log("warn", "Regla eliminada", ruleId=rule_id)
        if self._running:
            self.restart()

    def _within_schedule(self, rule: dict[str, Any]) -> bool:
        if not rule.get("enabledHoursOnly"):
            return True
        now = time.strftime("%H:%M")
        start = str(rule.get("scheduleStart") or "00:00")
        end = str(rule.get("scheduleEnd") or "23:59")
        return start <= now <= end if start <= end else now >= start or now <= end

    def enqueue_event(self, rule_id: str, reason: str = "manual") -> dict[str, Any]:
        rule = self.repo.get_raw(rule_id)
        if not rule:
            raise ValueError("Regla no encontrada")
        if not rule.get("enabled"):
            raise ValueError("La regla está deshabilitada")
        if not self._within_schedule(rule):
            raise ValueError("La regla está fuera del horario configurado")
        now = time.time()
        cooldown = max(0, int(rule.get("cooldownSec") or 0))
        if reason != "manual-test" and now - self._last_trigger.get(rule_id, 0) < cooldown:
            raise ValueError("Evento ignorado por cooldown")
        self._last_trigger[rule_id] = now
        event = {
            "id": str(uuid.uuid4()),
            "ruleId": rule_id,
            "ruleName": rule.get("name") or rule_id,
            "workplaceId": str(rule.get("workplaceId") or ""),
            "displayKind": str(rule.get("displayKind") or "source"),
            "itemId": str(rule.get("itemId") or ""),
            "itemLabel": str(rule.get("itemLabel") or ""),
            "group": str(rule.get("group") or ""),
            "groupCompositionId": str(rule.get("groupCompositionId") or ""),
            "priority": int(rule.get("priority") or 1),
            "durationSec": max(1, int(rule.get("durationSec") or 15)),
            "ts": now,
            "reason": reason,
        }
        if not event["workplaceId"] or not event["itemId"]:
            raise ValueError("La regla necesita workplace y fuente/composición de salida")
        with self._lock:
            self._event_seq += 1
            sequence = self._event_seq
        self._queue.put((-event["priority"], sequence, event))
        self._log("info", f"Evento en cola: {event['ruleName']}", ruleId=rule_id)
        return event

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            self._stop.clear()
            self._processor = threading.Thread(target=self._processor_loop, daemon=True, name="camera-events")
            self._processor.start()
            for rule in self.repo.list_raw():
                if rule.get("enabled") and rule.get("detectionMode") == "frame_diff":
                    thread = threading.Thread(target=self._monitor_rule, args=(rule,), daemon=True, name=f"camera-{str(rule['id'])[:8]}")
                    self._workers[str(rule["id"])] = thread
                    thread.start()
        self._log("ok", "Motor de cámaras iniciado")

    def stop(self) -> None:
        with self._lock:
            self._running = False
            self._stop.set()
            workers = list(self._workers.values())
            processor = self._processor
        current = threading.current_thread()
        for worker in workers:
            if worker is not current and worker.is_alive():
                worker.join(timeout=3)
        if processor is not None and processor is not current and processor.is_alive():
            processor.join(timeout=3)
        with self._lock:
            self._workers = {}
            self._processor = None
        self._log("warn", "Motor de cámaras detenido")

    def restart(self) -> None:
        self.stop()
        self.start()

    def status(self) -> dict[str, Any]:
        with self._lock:
            queued = [entry[2] for entry in list(self._queue.queue)[:20]]
            return {
                "running": self._running,
                "opencvAvailable": cv2 is not None,
                "activeEvent": self._active_event,
                "activeUntil": self._active_until,
                "queue": queued,
                "logs": list(self._logs[:100]),
                "rulesCount": len(self.repo.list_raw()),
            }

    def _processor_loop(self) -> None:
        while not self._stop.is_set():
            try:
                _, _, event = self._queue.get(timeout=0.4)
            except queue.Empty:
                continue

            bundle = [event]
            time.sleep(0.12)
            deferred: list[tuple[int, int, dict[str, Any]]] = []
            while True:
                try:
                    entry = self._queue.get_nowait()
                except queue.Empty:
                    break
                candidate = entry[2]
                same_group = bool(event.get("group")) and candidate.get("group") == event.get("group")
                same_workplace = candidate.get("workplaceId") == event.get("workplaceId")
                if same_group and same_workplace:
                    bundle.append(candidate)
                else:
                    deferred.append(entry)
            for entry in deferred:
                self._queue.put(entry)

            chosen = sorted(bundle, key=lambda e: (-int(e.get("priority") or 0), float(e.get("ts") or 0)))[0]
            if len(bundle) > 1 and chosen.get("groupCompositionId"):
                chosen = dict(chosen)
                chosen["displayKind"] = "composition"
                chosen["itemId"] = chosen["groupCompositionId"]
                chosen["itemLabel"] = f"Grupo {chosen.get('group')}"
                chosen["ruleName"] = f"Grupo {chosen.get('group')}"
            self._process_event(chosen)

    def _process_event(self, event: dict[str, Any]) -> None:
        workplace_id = event["workplaceId"]
        duration = max(1, int(event.get("durationSec") or 15))
        item = WallItem(event["displayKind"], event["itemId"], event.get("itemLabel") or "")
        owner = f"camera:{event['id']}"
        try:
            with self.workplace.exclusive(workplace_id, owner, timeout=60):
                with self._lock:
                    self._active_event = event
                    self._active_until = time.time() + duration
                self._log("info", f"Interrupción activa: {event['ruleName']}", workplaceId=workplace_id)
                self.workplace.apply_locked(workplace_id, item, pre_clear=True)
                deadline = time.time() + duration
                while time.time() < deadline and not self._stop.is_set():
                    time.sleep(min(0.25, deadline - time.time()))
                self.workplace.clear_locked(workplace_id)
                self._log("ok", f"Interrupción finalizada: {event['ruleName']}", workplaceId=workplace_id)
        except Exception as exc:
            self._log("err", f"Error procesando evento {event['ruleName']}: {exc}", workplaceId=workplace_id)
        finally:
            with self._lock:
                self._active_event = None
                self._active_until = 0.0

    @staticmethod
    def _rtsp_url(rule: dict[str, Any]) -> str:
        raw = str(rule.get("rtspUrl") or "").strip()
        if not raw:
            return ""
        username = str(rule.get("username") or "")
        password = str(rule.get("password") or "")
        if not username and not password:
            return raw
        parts = urlsplit(raw)
        if parts.username is not None:
            return raw
        host = parts.hostname or ""
        if not host:
            return raw
        userinfo = quote(username, safe="")
        if password:
            userinfo += ":" + quote(password, safe="")
        netloc = f"{userinfo}@{host}"
        if parts.port:
            netloc += f":{parts.port}"
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))

    def _monitor_rule(self, rule: dict[str, Any]) -> None:
        if cv2 is None:
            self._log("err", f"OpenCV no disponible para {rule.get('name')}")
            return
        rtsp_url = self._rtsp_url(rule)
        if not rtsp_url:
            self._log("err", f"Regla sin RTSP: {rule.get('name')}")
            return

        camera_cfg = self.cfg.get("cameras") or {}
        width = max(160, int(camera_cfg.get("frame_width") or 640))
        height = max(90, int(camera_cfg.get("frame_height") or 360))
        reconnect_delay = max(1, int(camera_cfg.get("reconnect_delay_sec") or 2))
        min_area = max(1, int(rule.get("minArea") or 2500))
        previous = None
        capture = None

        self._log("info", f"Monitoreando {rule.get('name')}", ruleId=rule.get("id"))
        while self._running and not self._stop.is_set():
            if not self._within_schedule(rule):
                time.sleep(1)
                continue
            try:
                if capture is None or not capture.isOpened():
                    capture = cv2.VideoCapture(rtsp_url)
                    time.sleep(0.5)
                ok, frame = capture.read()
                if not ok or frame is None:
                    if capture is not None:
                        capture.release()
                    capture = None
                    previous = None
                    time.sleep(reconnect_delay)
                    continue
                frame = cv2.resize(frame, (width, height))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                gray = cv2.GaussianBlur(gray, (21, 21), 0)
                if previous is None:
                    previous = gray
                    time.sleep(0.25)
                    continue
                delta = cv2.absdiff(previous, gray)
                threshold = cv2.threshold(delta, 25, 255, cv2.THRESH_BINARY)[1]
                threshold = cv2.dilate(threshold, None, iterations=2)
                contours, _ = cv2.findContours(threshold.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                previous = gray
                if any(cv2.contourArea(contour) >= min_area for contour in contours):
                    try:
                        self.enqueue_event(str(rule["id"]), reason="frame_diff")
                    except ValueError:
                        pass
                time.sleep(0.25)
            except Exception as exc:
                self._log("err", f"Monitor {rule.get('name')}: {exc}", ruleId=rule.get("id"))
                if capture is not None:
                    capture.release()
                capture = None
                previous = None
                time.sleep(reconnect_delay)
        if capture is not None:
            capture.release()
