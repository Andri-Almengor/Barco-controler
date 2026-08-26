from __future__ import annotations

import os
import platform
import socket
import subprocess
import time
from pathlib import Path
from typing import Any

import requests

from ..config import normalize_config
from .external_sources import ExternalRendererService


class DiagnosticsService:
    """Read-only readiness checks for CTRL, renderer, Internet and local VNC."""

    def __init__(self, state: Any):
        self.state = state

    @staticmethod
    def _check(check_id: str, label: str, status: str, detail: str, **meta: Any) -> dict[str, Any]:
        return {"id": check_id, "label": label, "status": status, "detail": detail, "meta": meta or {}}

    @staticmethod
    def _renderer_config(cfg: dict[str, Any]) -> dict[str, Any]:
        renderers = cfg.get("renderers") or []
        return dict(renderers[0]) if renderers else {}

    @staticmethod
    def _find_windows_vnc() -> dict[str, Any]:
        result: dict[str, Any] = {
            "platform": platform.system(),
            "product": None,
            "executable": None,
            "service": None,
            "serviceRunning": False,
        }
        if os.name != "nt":
            return result

        candidates = [
            ("TightVNC", Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "TightVNC" / "tvnserver.exe", "tvnserver"),
            ("TightVNC", Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "TightVNC" / "tvnserver.exe", "tvnserver"),
            ("UltraVNC", Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "uvnc bvba" / "UltraVNC" / "winvnc.exe", "uvnc_service"),
            ("UltraVNC", Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "UltraVNC" / "winvnc.exe", "uvnc_service"),
        ]
        for product, path, service_name in candidates:
            if path.exists():
                result.update(product=product, executable=str(path), service=service_name)
                try:
                    proc = subprocess.run(
                        ["sc.exe", "query", service_name],
                        capture_output=True,
                        text=True,
                        timeout=2,
                        check=False,
                    )
                    output = (proc.stdout or "") + (proc.stderr or "")
                    result["serviceRunning"] = "RUNNING" in output
                except Exception:
                    pass
                break
        return result

    @staticmethod
    def inspect_vnc(host: str, port: int, timeout: float = 1.5) -> dict[str, Any]:
        installed = DiagnosticsService._find_windows_vnc()
        info = {
            **installed,
            "host": host,
            "port": port,
            "reachable": False,
            "protocol": None,
            "banner": None,
        }
        try:
            with socket.create_connection((host, port), timeout=timeout) as client:
                client.settimeout(timeout)
                banner = client.recv(32)
                text = banner.decode("ascii", errors="replace").strip()
                info["reachable"] = True
                info["banner"] = text
                if text.startswith("RFB "):
                    info["protocol"] = "RFB"
        except OSError as exc:
            info["error"] = str(exc)
        return info

    @staticmethod
    def local_snapshot(cfg: dict[str, Any]) -> dict[str, Any]:
        cfg = normalize_config(cfg)
        renderer = DiagnosticsService._renderer_config(cfg)
        host = str(renderer.get("vnc_host") or "127.0.0.1")
        port = int(renderer.get("vnc_port") or 5900)
        vnc = DiagnosticsService.inspect_vnc(host, port)
        browsers = ExternalRendererService.detect_browsers()
        return {
            "time": time.time(),
            "platform": platform.platform(),
            "vnc": vnc,
            "browsers": browsers,
            "recommended": {
                "vncHost": "127.0.0.1",
                "vncPort": port,
                "windowsInstallCommand": (
                    f"powershell -ExecutionPolicy Bypass -File scripts\\configure_vnc_windows.ps1 "
                    f"-InstallIfMissing -Port {port}"
                ),
            },
        }

    def run(self) -> dict[str, Any]:
        configured = bool(getattr(self.state, "configured", False))
        try:
            cfg = self.state.cfg if configured else normalize_config({})
        except Exception:
            cfg = normalize_config({})
        renderer = self._renderer_config(cfg)
        workplace_id = str(((cfg.get("workplaces") or [{}])[0]).get("id") or "") if cfg.get("workplaces") else ""
        vnc_host = str(renderer.get("vnc_host") or "127.0.0.1")
        vnc_port = int(renderer.get("vnc_port") or 5900)
        checks: list[dict[str, Any]] = []

        checks.append(self._check("controller", "Barco Controller", "ok", "Backend en ejecución"))
        checks.append(self._check(
            "config", "Configuración", "ok" if configured else "error",
            "Configuración cargada" if configured else "Falta completar la configuración inicial",
        ))

        browsers = ExternalRendererService.detect_browsers()
        configured_browser = str(renderer.get("browser_path") or "").strip()
        browser_ok = bool((configured_browser and Path(configured_browser).exists()) or browsers)
        checks.append(self._check(
            "browser", "Navegador renderer", "ok" if browser_ok else "error",
            (f"Configurado: {configured_browser}" if configured_browser and Path(configured_browser).exists()
             else f"Detectado: {browsers[0]['name']}" if browsers else "No se encontró Edge, Chrome o Chromium"),
            detected=browsers,
        ))

        vnc = self.inspect_vnc(vnc_host, vnc_port)
        vnc_ok = bool(vnc.get("reachable") and vnc.get("protocol") == "RFB")
        vnc_detail = (
            f"RFB disponible en {vnc_host}:{vnc_port} ({vnc.get('banner')})" if vnc_ok
            else f"No hay servidor RFB respondiendo en {vnc_host}:{vnc_port}"
        )
        if vnc.get("product"):
            vnc_detail += f" · {vnc['product']} detectado"
        checks.append(self._check("vnc", "Servidor VNC", "ok" if vnc_ok else "error", vnc_detail, **vnc))

        internet_ok = False
        internet_detail = "Sin comprobar"
        try:
            response = requests.get("https://www.gstatic.com/generate_204", timeout=4, allow_redirects=True)
            internet_ok = response.status_code < 500
            internet_detail = f"Internet disponible (HTTP {response.status_code})"
        except Exception as exc:
            internet_detail = f"No se pudo acceder a Internet: {exc}"
        checks.append(self._check("internet", "Internet", "ok" if internet_ok else "warn", internet_detail))

        if not configured:
            checks.extend([
                self._check("ctrl", "Servidor CTRL", "warn", "Se comprobará después de configurar CTRL"),
                self._check("oidc", "OIDC", "warn", "Sin sesión CTRL"),
                self._check("workplace", "Workplace", "warn", "Sin workplace configurado"),
                self._check("rendererSource", "Fuente renderer en CTRL", "warn", "Sin fuente VNC asociada"),
            ])
        else:
            try:
                _ = self.state.oidc.token_endpoint
                checks.append(self._check("ctrl", "Servidor CTRL", "ok", "OIDC discovery responde correctamente"))
            except Exception as exc:
                checks.append(self._check("ctrl", "Servidor CTRL", "error", f"CTRL/OIDC no responde: {exc}"))

            try:
                auth = self.state.oidc.status()
                auth_ok = bool(auth.get("authenticated") and auth.get("accessValid"))
                checks.append(self._check(
                    "oidc", "Sesión OIDC", "ok" if auth_ok else "warn",
                    "Token de operador válido" if auth_ok else "No hay token de operador válido; inicia sesión nuevamente",
                    **auth,
                ))
            except Exception as exc:
                checks.append(self._check("oidc", "Sesión OIDC", "error", str(exc)))

            workplace_ok = False
            workplace_detail = "No hay workplace configurado"
            if workplace_id:
                try:
                    inventory = self.state.workplace.list_workplaces()
                    workplace_ok = any(str(x.get("id") or x.get("_id") or "") == workplace_id for x in inventory)
                    workplace_detail = (
                        f"Workplace {workplace_id} encontrado en CTRL" if workplace_ok
                        else f"El workplace {workplace_id} no apareció en el inventario de CTRL"
                    )
                except Exception as exc:
                    workplace_detail = f"No se pudo consultar el workplace: {exc}"
            checks.append(self._check("workplace", "Workplace", "ok" if workplace_ok else "error", workplace_detail))

            source_id = str(renderer.get("barco_source_id") or "")
            source_ok = False
            source_detail = "No hay fuente renderer asociada"
            if source_id and workplace_id:
                try:
                    sources = self.state.workplace.list_sources(workplace_id)
                    source_ok = any(str(x.get("id") or x.get("_id") or "") == source_id for x in sources)
                    source_detail = (
                        f"Fuente {source_id} disponible en el workplace" if source_ok
                        else f"La fuente {source_id} no apareció entre las fuentes del workplace"
                    )
                except Exception as exc:
                    source_detail = f"No se pudo validar la fuente renderer: {exc}"
            checks.append(self._check("rendererSource", "Fuente renderer en CTRL", "ok" if source_ok else "error", source_detail))

        try:
            active = self.state.external.status().get("active", []) if configured else []
            running = next((x for x in active if x.get("running")), None)
            checks.append(self._check(
                "renderer", "Renderer", "ok" if running else "warn",
                f"Activo: {running.get('sourceName')}" if running else "Renderer listo pero sin contenido activo",
                active=active,
            ))
        except Exception as exc:
            checks.append(self._check("renderer", "Renderer", "warn", f"No se pudo consultar el renderer: {exc}"))

        critical = {"controller", "config", "browser", "vnc", "ctrl", "workplace", "rendererSource"}
        ready = all(c["status"] == "ok" for c in checks if c["id"] in critical)
        return {
            "ready": ready,
            "time": time.time(),
            "checks": checks,
            "vnc": vnc,
            "install": {
                "supported": os.name == "nt",
                "package": "GlavSoft.TightVNC",
                "script": "scripts/configure_vnc_windows.ps1",
                "requiresAdministrator": True,
                "command": f"powershell -ExecutionPolicy Bypass -File scripts\\configure_vnc_windows.ps1 -InstallIfMissing -Port {vnc_port}",
            },
        }
