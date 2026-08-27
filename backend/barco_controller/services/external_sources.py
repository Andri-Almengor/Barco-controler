from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

from ..paths import RUNTIME_ROOT
from ..storage.repositories import ExternalSourceRepository
from .workplace import WallItem


class ExternalRendererError(RuntimeError):
    pass


class ExternalRendererService:
    """Render Internet content on a local browser and expose it to CTRL through a VNC source."""

    def __init__(self, repository: ExternalSourceRepository, cfg: dict[str, Any]):
        self.repository = repository
        self.cfg = cfg
        self._lock = threading.RLock()
        self._processes: dict[str, subprocess.Popen[Any]] = {}
        self._active: dict[str, dict[str, Any]] = {}

    @staticmethod
    def _hidden_process_kwargs(*, new_process_group: bool = False) -> dict[str, Any]:
        if os.name != "nt":
            return {}
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if new_process_group:
            flags |= getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return {"startupinfo": startupinfo, "creationflags": flags}

    @staticmethod
    def detect_browsers() -> list[dict[str, str]]:
        candidates: list[tuple[str, str]] = []
        if os.name == "nt":
            program_files = [os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")]
            for root in [value for value in program_files if value]:
                candidates.extend([
                    ("Microsoft Edge", str(Path(root) / "Microsoft/Edge/Application/msedge.exe")),
                    ("Google Chrome", str(Path(root) / "Google/Chrome/Application/chrome.exe")),
                ])
        else:
            for label, name in (("Google Chrome", "google-chrome"), ("Chromium", "chromium"), ("Chromium", "chromium-browser"), ("Microsoft Edge", "microsoft-edge")):
                resolved = shutil.which(name)
                if resolved:
                    candidates.append((label, resolved))
        seen = set()
        result = []
        for label, path in candidates:
            if path in seen or not Path(path).exists():
                continue
            seen.add(path)
            result.append({"name": label, "path": path})
        return result

    def _renderer(self, renderer_id: str) -> dict[str, Any]:
        for renderer in self.cfg.get("renderers") or []:
            if str(renderer.get("id")) == str(renderer_id):
                return renderer
        raise ExternalRendererError(f"Renderer no encontrado: {renderer_id}")

    def renderer_for_source(self, source_id: str) -> dict[str, Any]:
        source = self.repository.get(source_id)
        if not source:
            raise ValueError("Contenido externo no encontrado")
        return self._renderer(str(source.get("rendererId") or "main"))

    def _browser_path(self, renderer: dict[str, Any]) -> str:
        configured = str(renderer.get("browser_path") or "").strip()
        if configured and Path(configured).exists():
            return configured
        detected = self.detect_browsers()
        if detected:
            return detected[0]["path"]
        raise ExternalRendererError("No se encontró Microsoft Edge, Chrome o Chromium. Configura browser_path.")

    @staticmethod
    def _profile_path(renderer: dict[str, Any]) -> Path:
        configured = str(renderer.get("profile_dir") or "data/browser-profile-main").strip()
        path = Path(configured)
        if not path.is_absolute():
            path = RUNTIME_ROOT / path
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _target_url(self, source: dict[str, Any], local_origin: str) -> str:
        if source.get("type") == "web":
            return str(source["url"])
        return f"{local_origin.rstrip('/')}/api/renderer/{quote(str(source['id']))}"

    def _args(self, browser: str, renderer: dict[str, Any], target_url: str) -> list[str]:
        args = [
            browser,
            "--no-first-run",
            "--no-default-browser-check",
            "--new-window",
            "--start-maximized",
            "--window-position=0,0",
            "--disable-background-mode",
            f"--user-data-dir={self._profile_path(renderer)}",
        ]
        mode = str(renderer.get("launch_mode") or "kiosk").lower()
        if mode == "app":
            args.append(f"--app={target_url}")
        elif mode == "fullscreen":
            args.extend(["--start-fullscreen", target_url])
        else:
            args.extend(["--kiosk", "--disable-session-crashed-bubble"])
            if "msedge" in Path(browser).name.lower():
                args.append("--edge-kiosk-type=fullscreen")
            args.append(target_url)
        args.extend(str(value) for value in (renderer.get("extra_args") or []))
        return args

    @staticmethod
    def _windows_process_tree(root_pid: int) -> set[int]:
        if os.name != "nt":
            return {root_pid}
        try:
            from ctypes import wintypes

            TH32CS_SNAPPROCESS = 0x00000002
            INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

            class PROCESSENTRY32W(ctypes.Structure):
                _fields_ = [
                    ("dwSize", wintypes.DWORD),
                    ("cntUsage", wintypes.DWORD),
                    ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
                    ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD),
                    ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long),
                    ("dwFlags", wintypes.DWORD),
                    ("szExeFile", ctypes.c_wchar * 260),
                ]

            kernel32 = ctypes.windll.kernel32
            snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            if snapshot == INVALID_HANDLE_VALUE:
                return {root_pid}
            try:
                entry = PROCESSENTRY32W()
                entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
                parent_map: dict[int, int] = {}
                if kernel32.Process32FirstW(snapshot, ctypes.byref(entry)):
                    while True:
                        parent_map[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
                        if not kernel32.Process32NextW(snapshot, ctypes.byref(entry)):
                            break
            finally:
                kernel32.CloseHandle(snapshot)

            result = {root_pid}
            changed = True
            while changed:
                changed = False
                for pid, parent in parent_map.items():
                    if parent in result and pid not in result:
                        result.add(pid)
                        changed = True
            return result
        except Exception:
            return {root_pid}

    @classmethod
    def _force_browser_foreground(cls, root_pid: int, timeout: float = 6.0) -> bool:
        if os.name != "nt":
            return True
        try:
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            SW_RESTORE = 9
            HWND_TOPMOST = -1
            SWP_NOSIZE = 0x0001
            SWP_NOMOVE = 0x0002
            SWP_SHOWWINDOW = 0x0040

            deadline = time.time() + timeout
            while time.time() < deadline:
                pids = cls._windows_process_tree(root_pid)
                windows: list[int] = []

                @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
                def enum_proc(hwnd, _lparam):
                    if not user32.IsWindowVisible(hwnd):
                        return True
                    pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    if int(pid.value) in pids:
                        windows.append(int(hwnd))
                    return True

                user32.EnumWindows(enum_proc, 0)
                if windows:
                    hwnd = windows[0]
                    user32.ShowWindow(hwnd, SW_RESTORE)
                    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
                    user32.BringWindowToTop(hwnd)
                    user32.SetForegroundWindow(hwnd)
                    return True
                time.sleep(0.2)
        except Exception:
            return False
        return False

    @classmethod
    def _terminate_process(cls, process: subprocess.Popen[Any]) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=5,
                    check=False,
                    **cls._hidden_process_kwargs(),
                )
            else:
                process.terminate()
                process.wait(timeout=3)
        except Exception:
            try:
                process.kill()
            except Exception:
                pass

    def activate(self, source_id: str, *, local_origin: str) -> WallItem:
        source = self.repository.get(source_id)
        if not source:
            raise ValueError("Contenido externo no encontrado")
        if not source.get("enabled", True):
            raise ValueError("El contenido externo está deshabilitado")
        renderer = self._renderer(str(source.get("rendererId") or "main"))
        barco_source_id = str(renderer.get("barco_source_id") or "").strip()
        if not barco_source_id:
            raise ExternalRendererError("El renderer no tiene asociada una fuente VNC de Barco")

        browser = self._browser_path(renderer)
        target_url = self._target_url(source, local_origin)
        renderer_id = str(renderer.get("id") or "main")

        with self._lock:
            previous = self._processes.pop(renderer_id, None)
            if previous:
                self._terminate_process(previous)
            process = subprocess.Popen(
                self._args(browser, renderer, target_url),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                **self._hidden_process_kwargs(new_process_group=True),
            )
            self._processes[renderer_id] = process
            self._active[renderer_id] = {
                "rendererId": renderer_id,
                "sourceId": source_id,
                "sourceName": source.get("name"),
                "sourceType": source.get("type"),
                "url": source.get("url"),
                "pid": process.pid,
                "startedAt": time.time(),
                "barcoSourceId": barco_source_id,
                "foregroundReady": False,
            }

        foreground_ready = self._force_browser_foreground(process.pid)
        with self._lock:
            if renderer_id in self._active:
                self._active[renderer_id]["foregroundReady"] = foreground_ready

        delay = max(0.0, float(renderer.get("startup_delay_sec") or 0))
        if delay:
            time.sleep(delay)
        return WallItem("source", barco_source_id, str(renderer.get("barco_source_label") or source.get("name") or "Renderer"))

    def stop(self, renderer_id: str) -> None:
        with self._lock:
            process = self._processes.pop(renderer_id, None)
            self._active.pop(renderer_id, None)
        if process:
            self._terminate_process(process)

    def status(self) -> dict[str, Any]:
        with self._lock:
            active = []
            for renderer_id, value in list(self._active.items()):
                process = self._processes.get(renderer_id)
                row = dict(value)
                row["running"] = bool(process and process.poll() is None)
                active.append(row)
            return {"active": active, "detectedBrowsers": self.detect_browsers()}