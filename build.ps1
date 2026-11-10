# Build a portable single-file EXE for the PyMindplot desktop app.
# Usage: .\build.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "[1/3] Installing dependencies..." -ForegroundColor Cyan
python -m pip install -r requirements.txt | Out-Null

Write-Host "[2/3] Generating icon..." -ForegroundColor Cyan
if (Test-Path "make_icon.py") { python make_icon.py }

Write-Host "[3/3] Building portable EXE..." -ForegroundColor Cyan
python -m PyInstaller app.spec --noconfirm --distpath "$root\dist" --workpath "$root\build2"

$exe = Get-ChildItem "$root\dist\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
    $mb = [math]::Round($exe.Length / 1MB, 2)
    Write-Host ""
    Write-Host "Build OK -> $($exe.FullName) ($mb MB)" -ForegroundColor Green
} else {
    Write-Error "Build failed: EXE not found."
}
