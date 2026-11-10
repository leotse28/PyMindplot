param([string]$TitleFilter = "*PyMindplot*", [string]$OutPath = "shot.png")
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class PWWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
[PWWin]::SetProcessDPIAware() | Out-Null
$proc = Get-Process python, PyMindplot -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like $TitleFilter -and $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
if (-not $proc) { Write-Host "no window"; exit 1 }
$rect = New-Object PWWin+RECT
[PWWin]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.R - $rect.L; $h = $rect.B - $rect.T
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
$ok = [PWWin]::PrintWindow([IntPtr]$proc.MainWindowHandle, $dc, 2)
$g.ReleaseHdc($dc)
$bmp.Save($OutPath)
$g.Dispose(); $bmp.Dispose()
Write-Host "printwindow ok=$ok saved ${w}x$h"
