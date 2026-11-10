param(
  [string]$TitleFilter = "*showcase*",
  [string]$OutPath = "D:\AIworkspace\AIcoding\mindmap-app\tests\shot.png"
)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ShotWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
[ShotWin]::SetProcessDPIAware() | Out-Null
$proc = Get-Process python, PyMindplot -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like $TitleFilter -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Host "no window"; exit 1 }
[ShotWin]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 900
$rect = New-Object ShotWin+RECT
[ShotWin]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.R - $rect.L
$h = $rect.B - $rect.T
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.L, $rect.T, 0, 0, $bmp.Size)
$bmp.Save($OutPath)
$g.Dispose()
$bmp.Dispose()
Write-Host "saved ${w}x$h -> $OutPath"
