# server/ops/khoa-khan-cap.ps1 — NGẮT INTERNET KHẨN CẤP: dừng NGAY tunnel (mọi người chơi bị ngắt), máy chủ game và
# dữ liệu vẫn chạy trên máy này. Dùng khi: mạng nhà bị nghẽn/tấn công, thấy điều gì lạ, hoặc cần dừng ngay lập tức.
#   powershell -ExecutionPolicy Bypass -File server\ops\khoa-khan-cap.ps1      (-TestMode cho bản thử)
# Mở lại đường vào: chạy lại mo-may-chu.ps1 (hoặc -TamThoi). Tắt hẳn: tat-may-chu.ps1.
param([switch]$TestMode)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host ''
Write-Host '=== NGẮT INTERNET KHẨN CẤP ===' -ForegroundColor Red
$r = Get-CmdOutput 'docker' (@('compose', '-p', $s.Project, '-f', $script:ComposeFile) + $script:AllProfiles + @('kill', 'tunnel', 'quicktunnel'))
$null = Get-CmdOutput 'docker' (@('compose', '-p', $s.Project, '-f', $script:ComposeFile) + $script:AllProfiles + @('rm', '-f', 'tunnel', 'quicktunnel'))
$st = Get-ServiceState $s
$sw.Stop()
$still = @('tunnel', 'quicktunnel') | Where-Object { $st[$_] -and $st[$_].State -eq 'running' }
if ($still) { Write-Loi ('Tunnel vẫn chạy: ' + ($still -join ', ') + ' — hãy tắt Docker Desktop hoặc rút mạng.'); exit 1 }
Write-Tot ("Đã ngắt đường vào từ Internet sau {0:N1} giây. Người chơi bị ngắt; dữ liệu vẫn an toàn." -f $sw.Elapsed.TotalSeconds)
Write-Dong 'Máy chủ game vẫn chạy trên máy này (trang quản trị vẫn mở). Tắt hẳn: tat-may-chu.ps1'
exit 0
