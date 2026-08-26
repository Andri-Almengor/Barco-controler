from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

APP_TITLE = "Barco Controller Builder"
REQUIRED_MARKERS = (
    "build_windows.ps1",
    "backend",
    "frontend",
    "packaging",
)

KNOWN_PYTHON = (
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Python/Python311/python.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Python311/python.exe",
)
KNOWN_NPM = (
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs/npm.cmd",
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "nodejs/npm.cmd",
)
KNOWN_ISCC = (
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Inno Setup 6/ISCC.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Inno Setup 6/ISCC.exe",
)


def _valid_project(path: Path) -> bool:
    return all((path / marker).exists() for marker in REQUIRED_MARKERS)


def find_project_root() -> Path | None:
    starts: list[Path] = []
    if getattr(sys, "frozen", False):
        starts.append(Path(sys.executable).resolve().parent)
    else:
        starts.append(Path(__file__).resolve().parents[1])
    starts.extend([Path.cwd(), Path(sys.argv[0]).resolve().parent])

    seen: set[Path] = set()
    for start in starts:
        current = start
        for _ in range(6):
            if current in seen:
                break
            seen.add(current)
            if _valid_project(current):
                return current
            if current.parent == current:
                break
            current = current.parent
    return None


def _find_executable(names: tuple[str, ...], known: tuple[Path, ...] = ()) -> str | None:
    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    for path in known:
        if str(path) and path.exists():
            return str(path)
    return None


def detect_tools() -> dict[str, str | None]:
    return {
        "powershell": _find_executable(("pwsh.exe", "powershell.exe")),
        "python": _find_executable(("python.exe", "py.exe"), KNOWN_PYTHON),
        "npm": _find_executable(("npm.cmd", "npm.exe"), KNOWN_NPM),
        "iscc": _find_executable(("ISCC.exe",), KNOWN_ISCC),
        "winget": _find_executable(("winget.exe",)),
    }


def augmented_path(tools: dict[str, str | None]) -> str:
    entries: list[str] = []
    for key in ("python", "npm", "iscc"):
        value = tools.get(key)
        if value:
            entries.append(str(Path(value).parent))
    entries.append(os.environ.get("PATH", ""))
    return os.pathsep.join(dict.fromkeys(filter(None, entries)))


class BuilderApp:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title(APP_TITLE)
        self.root.geometry("860x620")
        self.root.minsize(760, 520)

        self.project = tk.StringVar(value=str(find_project_root() or ""))
        self.skip_tests = tk.BooleanVar(value=False)
        self.install_missing = tk.BooleanVar(value=True)
        self.status = tk.StringVar(value="Listo para comprobar el proyecto.")
        self.tool_vars = {name: tk.StringVar(value="—") for name in ("Python", "Node/npm", "Inno Setup", "PowerShell")}
        self.building = False

        self._build_ui()
        self._refresh_tools()

    def _build_ui(self) -> None:
        frame = ttk.Frame(self.root, padding=18)
        frame.pack(fill="both", expand=True)

        ttk.Label(frame, text="Barco Controller Builder", font=("Segoe UI", 19, "bold")).pack(anchor="w")
        ttk.Label(frame, text="Genera BarcoController-Setup.exe sin memorizar comandos de compilación.").pack(anchor="w", pady=(2, 16))

        project_box = ttk.LabelFrame(frame, text="Proyecto", padding=10)
        project_box.pack(fill="x")
        row = ttk.Frame(project_box)
        row.pack(fill="x")
        ttk.Entry(row, textvariable=self.project).pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Seleccionar…", command=self._choose_project).pack(side="left", padx=(8, 0))

        tools_box = ttk.LabelFrame(frame, text="Herramientas", padding=10)
        tools_box.pack(fill="x", pady=(12, 0))
        tools_grid = ttk.Frame(tools_box)
        tools_grid.pack(fill="x")
        for index, (name, variable) in enumerate(self.tool_vars.items()):
            ttk.Label(tools_grid, text=name, font=("Segoe UI", 9, "bold")).grid(row=index, column=0, sticky="w", pady=2)
            ttk.Label(tools_grid, textvariable=variable).grid(row=index, column=1, sticky="w", padx=(12, 0), pady=2)
        ttk.Button(tools_box, text="Volver a comprobar", command=self._refresh_tools).pack(anchor="e", pady=(6, 0))

        options = ttk.Frame(frame)
        options.pack(fill="x", pady=(12, 0))
        ttk.Checkbutton(options, text="Instalar herramientas faltantes con WinGet", variable=self.install_missing).pack(anchor="w")
        ttk.Checkbutton(options, text="Omitir pruebas backend", variable=self.skip_tests).pack(anchor="w")

        actions = ttk.Frame(frame)
        actions.pack(fill="x", pady=(12, 0))
        self.build_button = ttk.Button(actions, text="Generar instalador", command=self._start_build)
        self.build_button.pack(side="left")
        ttk.Button(actions, text="Abrir carpeta de salida", command=self._open_output).pack(side="left", padx=(8, 0))
        ttk.Label(actions, textvariable=self.status).pack(side="right")

        log_box = ttk.LabelFrame(frame, text="Proceso", padding=6)
        log_box.pack(fill="both", expand=True, pady=(12, 0))
        self.log = tk.Text(log_box, wrap="word", state="disabled", font=("Consolas", 9), bg="#11151a", fg="#e6edf3", insertbackground="white")
        self.log.pack(side="left", fill="both", expand=True)
        scrollbar = ttk.Scrollbar(log_box, orient="vertical", command=self.log.yview)
        scrollbar.pack(side="right", fill="y")
        self.log.configure(yscrollcommand=scrollbar.set)

    def _append(self, text: str) -> None:
        def write() -> None:
            self.log.configure(state="normal")
            self.log.insert("end", text.rstrip() + "\n")
            self.log.see("end")
            self.log.configure(state="disabled")
        self.root.after(0, write)

    def _choose_project(self) -> None:
        selected = filedialog.askdirectory(title="Selecciona la carpeta raíz de Barco-controler")
        if selected:
            self.project.set(selected)

    def _refresh_tools(self) -> dict[str, str | None]:
        tools = detect_tools()
        mapping = {
            "Python": tools["python"],
            "Node/npm": tools["npm"],
            "Inno Setup": tools["iscc"],
            "PowerShell": tools["powershell"],
        }
        for name, value in mapping.items():
            self.tool_vars[name].set(value or "No detectado")
        return tools

    def _install_package(self, winget: str, package: str, label: str) -> None:
        self._append(f"Instalando {label} con WinGet…")
        command = [winget, "install", "--id", package, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements"]
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        if result.stdout:
            self._append(result.stdout)
        if result.stderr:
            self._append(result.stderr)
        if result.returncode != 0:
            raise RuntimeError(f"WinGet no pudo instalar {label} (código {result.returncode}).")

    def _ensure_tools(self) -> dict[str, str | None]:
        tools = self._refresh_tools()
        missing = []
        if not tools["python"]:
            missing.append(("Python.Python.3.11", "Python 3.11"))
        if not tools["npm"]:
            missing.append(("OpenJS.NodeJS.LTS", "Node.js LTS"))
        if not tools["iscc"]:
            missing.append(("JRSoftware.InnoSetup", "Inno Setup 6"))
        if not tools["powershell"]:
            raise RuntimeError("PowerShell no está disponible en este Windows.")

        if missing:
            if not self.install_missing.get():
                names = ", ".join(label for _, label in missing)
                raise RuntimeError(f"Faltan herramientas: {names}. Activa la instalación automática o instálalas manualmente.")
            winget = tools.get("winget")
            if not winget:
                raise RuntimeError("Faltan herramientas y WinGet no está disponible para instalarlas automáticamente.")
            for package, label in missing:
                self._install_package(winget, package, label)
            tools = detect_tools()
            self.root.after(0, self._refresh_tools)

        if not tools["python"] or not tools["npm"]:
            raise RuntimeError("Python o Node se instalaron, pero Windows aún no los detecta. Cierra y vuelve a abrir Builder.exe.")
        return tools

    def _start_build(self) -> None:
        if self.building:
            return
        project = Path(self.project.get().strip())
        if not _valid_project(project):
            messagebox.showerror(APP_TITLE, "La carpeta seleccionada no parece ser la raíz de Barco-controler.")
            return
        self.building = True
        self.build_button.configure(state="disabled")
        self.status.set("Compilando…")
        threading.Thread(target=self._build_worker, args=(project,), daemon=True).start()

    def _build_worker(self, project: Path) -> None:
        try:
            tools = self._ensure_tools()
            powershell = tools["powershell"] or "powershell.exe"
            script = project / "build_windows.ps1"
            command = [powershell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)]
            if self.skip_tests.get():
                command.append("-SkipTests")

            env = os.environ.copy()
            env["PATH"] = augmented_path(tools)
            self._append("=== Generando BarcoController-Setup.exe ===")
            self._append(f"Proyecto: {project}")
            process = subprocess.Popen(
                command,
                cwd=project,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            assert process.stdout is not None
            for line in process.stdout:
                self._append(line)
            code = process.wait()
            setup = project / "installer_output" / "BarcoController-Setup.exe"
            if code != 0:
                raise RuntimeError(f"La compilación terminó con código {code}.")
            if not setup.exists():
                raise RuntimeError("La compilación terminó, pero no se encontró BarcoController-Setup.exe.")
            self._append(f"OK: {setup}")
            self.root.after(0, lambda: self.status.set("Instalador generado"))
            self.root.after(0, lambda: messagebox.showinfo(APP_TITLE, f"Instalador generado correctamente:\n\n{setup}"))
        except Exception as exc:
            self._append(f"ERROR: {exc}")
            self.root.after(0, lambda: self.status.set("Error"))
            self.root.after(0, lambda exc=exc: messagebox.showerror(APP_TITLE, str(exc)))
        finally:
            self.building = False
            self.root.after(0, lambda: self.build_button.configure(state="normal"))

    def _open_output(self) -> None:
        project = Path(self.project.get().strip())
        output = project / "installer_output"
        output.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(output))  # type: ignore[attr-defined]
        else:
            messagebox.showinfo(APP_TITLE, str(output))

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    BuilderApp().run()
