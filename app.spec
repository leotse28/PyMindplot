# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

ROOT = Path(SPECPATH)
APP = ROOT / "app"

block_cipher = None

datas = [
    (str(APP / "web"), "web"),
    (str(ROOT / "assets" / "icon.png"), "assets"),
]

a = Analysis(
    [str(APP / "main.py")],
    pathex=[str(APP)],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "webview",
        "webview.platforms.edgechromium",
        "webview.platforms.winforms",
        "clr_loader",
        "pythonnet",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter", "unittest", "test", "pydoc_data",
        "numpy", "PIL", "matplotlib", "pandas",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="PyMindplot",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "assets" / "icon.ico"),
)
