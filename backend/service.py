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


class BarcoControllerService(win32serviceutil.ServiceFramework):
    _svc_name_ = "BarcoController"
    _svc_display_name_ = "Barco Controller"
    _svc_description_ = "Control de recorridos y eventos de cámaras para Barco CTRL"

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
        servicemanager.LogInfoMsg("Barco Controller iniciado")
        app = create_app()
        self.server = create_server(app, host="0.0.0.0", port=8080, threads=8)
        thread = threading.Thread(target=self.server.run, daemon=True)
        thread.start()
        win32event.WaitForSingleObject(self.stop_event, win32event.INFINITE)
        servicemanager.LogInfoMsg("Barco Controller detenido")


if __name__ == "__main__":
    win32serviceutil.HandleCommandLine(BarcoControllerService)
