from __future__ import annotations

import socket
import threading

try:
    import servicemanager
    import win32event
    import win32service
    import win32serviceutil
except ImportError as exc:
    raise SystemExit("Para instalar como servicio ejecuta: pip install pywin32") from exc

from waitress.server import create_server
from barco_controller import create_app
from barco_controller.config import load_config_or_default


class BarcoControllerService(win32serviceutil.ServiceFramework):
    _svc_name_ = "BarcoController"
    _svc_display_name_ = "Barco Controller"
    _svc_description_ = "Control de recorridos, cámaras y contenido para Barco CTRL"

    def __init__(self, args):
        super().__init__(args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        socket.setdefaulttimeout(60)
        self.server = None

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        if self.server is not None:
            try:
                self.server.close()
            except Exception:
                pass

    def SvcDoRun(self):
        cfg = load_config_or_default()
        server_cfg = cfg.get("server") or {}
        host = str(server_cfg.get("host") or "0.0.0.0")
        port = int(server_cfg.get("port") or 8080)
        servicemanager.LogInfoMsg(f"Barco Controller iniciado en {host}:{port}")
        servicemanager.LogInfoMsg("Nota: el renderer visual de Internet debe ejecutarse en una sesión interactiva de Windows; Session 0 de un servicio no muestra ventanas.")
        app = create_app()
        self.server = create_server(app, host=host, port=port, threads=8)
        thread = threading.Thread(target=self.server.run, daemon=True)
        thread.start()
        win32event.WaitForSingleObject(self.stop_event, win32event.INFINITE)
        servicemanager.LogInfoMsg("Barco Controller detenido")


if __name__ == "__main__":
    win32serviceutil.HandleCommandLine(BarcoControllerService)
