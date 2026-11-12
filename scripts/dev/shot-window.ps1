# 截取指定标题窗口的图像(PrintWindow,不截全屏)
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinShot {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$title = $args[0]
$out = $args[1]
$h = (Get-Process | Where-Object { $_.MainWindowTitle -match $title } | Select-Object -First 1).MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Host 'window not found'; exit 1 }
$r = New-Object WinShot+RECT
[WinShot]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
[WinShot]::PrintWindow($h, $hdc, 2) | Out-Null
$g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "saved $out ($w x $ht)"
