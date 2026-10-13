Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path assets -Force | Out-Null
$bmp = New-Object System.Drawing.Bitmap 256,256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)
$rect = New-Object System.Drawing.Rectangle -ArgumentList 0,0,256,256
$c1 = [System.Drawing.Color]::FromArgb(255,79,140,255)
$c2 = [System.Drawing.Color]::FromArgb(255,45,212,167)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $rect,$c1,$c2,45
$g.FillEllipse($brush, 8, 8, 240, 240)
$font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI',96,([System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$fmt.LineAlignment = 'Center'
$white = [System.Drawing.Brushes]::White
$rectF = New-Object System.Drawing.RectangleF -ArgumentList 0,0,256,256
$g.DrawString('D', $font, $white, $rectF, $fmt)
$g.Dispose()
# PNG в памяти
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$ms.Close()
$bmp.Dispose()
# ICO-контейнер: заголовок + одна запись (PNG-compressed, 256x256) + PNG
$fs = [System.IO.File]::Create((Join-Path (Get-Location) 'assets\icon.ico'))
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([uint16]0)          # reserved
$bw.Write([uint16]1)          # type: icon
$bw.Write([uint16]1)          # count
$bw.Write([byte]0)            # width 0 = 256
$bw.Write([byte]0)            # height 0 = 256
$bw.Write([byte]0)            # colors
$bw.Write([byte]0)            # reserved
$bw.Write([uint16]1)          # planes
$bw.Write([uint16]32)         # bpp
$bw.Write([uint32]$png.Length)
$bw.Write([uint32]22)         # offset = 6 + 16
$bw.Write($png)
$bw.Close()
$fs.Close()
Get-Item (Join-Path (Get-Location) 'assets\icon.ico') | Select-Object Name, Length
