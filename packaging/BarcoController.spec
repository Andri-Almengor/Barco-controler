# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent
BACKEND = ROOT / "backend"

hiddenimports = []
hiddenimports += collect_submodules("pystray")
hiddenimports += collect_submodules("PIL")

datas = [
    (str(BACKEND / "static"), "static"),
    (str(BACKEND / "config" / "endpoints.yaml"), "config"),
]

a = Analysis(
    [str(BACKEND / "desktop_launcher.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="BarcoController",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="BarcoController",
)
