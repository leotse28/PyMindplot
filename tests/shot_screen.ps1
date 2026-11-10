param([string]$TitleFilter = "*PyMindplot*", [string]$OutPath = "shot.png")
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class SCWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public struct RECT { public int L; public int T; public int R; public int B; }
}
"@
[SCWin]::SetProcessDPIAware() | Out-Null
$proc = Get-Process python, PyMindplot -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like $TitleFilter -and $_.MainWindowHandle -ne 0 } |
        Select-Object -First 1
if (-not $proc) { Write-Host "no window"; exit 1 }
[SCWin]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600
$rect = New-Object SCWin+RECT
[SCWin]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.R - $rect.L; $h = $rect.B - $rect.T
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.L, $rect.T, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$bmp.Save($OutPath)
$g.Dispose(); $bmp.Dispose()
Write-Host "screen capture ok saved ${w}x$h"
