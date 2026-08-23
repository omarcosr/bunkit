param()
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'BunKit Gallery')
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) { Write-Output 'WINDOW NOT FOUND'; exit 1 }
$hwnd = [IntPtr]$win.Current.NativeWindowHandle
[Win32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

$wr = $win.Current.BoundingRectangle
function CaptureBrightness {
  $bmp = New-Object System.Drawing.Bitmap ([int]$wr.Width), ([int]$wr.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen([int]$wr.X, [int]$wr.Y, 0, 0, $bmp.Size)
  $sum = 0; $n = 0
  for ($x = 60; $x -lt [int]$wr.Width - 20; $x += 4) { for ($y = 45; $y -lt [int]$wr.Height - 10; $y += 4) {
    $c = $bmp.GetPixel($x, $y); $sum += ($c.R + $c.G + $c.B); $n++
  } }
  return [int]($sum / $n / 3)
}

# find the Dark mode checkbox
$cb = $null
$boxes = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox)))
foreach ($e in $boxes) { if ($e.Current.Name -match 'Dark') { $cb = $e; break } }
if (-not $cb) { Write-Output 'checkbox NOT FOUND'; exit 1 }

$light = CaptureBrightness
Write-Output ("brightness BEFORE toggle: " + $light)

$tg = $null
if (-not $cb.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tg)) { Write-Output 'no TogglePattern'; exit 1 }
$tg.Toggle()
Start-Sleep -Milliseconds 900
$dark = CaptureBrightness
Write-Output ("brightness AFTER toggle:  " + $dark)
Write-Output ("delta: " + ($dark - $light))

# toggle back so the app returns to the starting theme
$tg.Toggle()
Start-Sleep -Milliseconds 600
$back = CaptureBrightness
Write-Output ("brightness toggled back:  " + $back)
