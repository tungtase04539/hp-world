# server/ops/mo-may-chu.ps1 — MỞ MÁY CHỦ GAME Hải Phòng 3D trên máy này.
# Cách chạy: nhấp phải → "Run with PowerShell", hoặc trong PowerShell:
#   powershell -ExecutionPolicy Bypass -File server\ops\mo-may-chu.ps1            (tự chọn tunnel: tên miền nếu đã cài, không thì không bật)
#   ... -TamThoi       bật tunnel TẠM (địa chỉ *.trycloudflare.com ngẫu nhiên) để thử nhanh
#   ... -KhongTunnel   chỉ chạy trên máy này (không ai ở ngoài vào được)
#   ... -KhongSaoLuu   không bật dịch vụ sao lưu hằng đêm
#   ... -KhongMoTrang  không tự mở trang quản trị
#   ... -TestMode      (dành cho lập trình viên) chạy bản thử với HPMP_PROJECT/HPMP_GAME_PORT/HPMP_ADMIN_PORT riêng,
#                      KHÔNG ghi tệp đánh dấu, KHÔNG mở trình duyệt
# Không cần quyền quản trị. Không mở cổng nào ra Internet: mọi cổng chỉ ở 127.0.0.1; người chơi vào qua Cloudflare Tunnel.
param(
  [switch]$TamThoi,
  [switch]$KhongTunnel,
  [switch]$KhongSaoLuu,
  [switch]$KhongMoTrang,
  [switch]$KhongBuild,
  [switch]$TestMode
)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
$t0 = Get-Date
Write-Host ''
Write-Host '=== MỞ MÁY CHỦ GAME HẢI PHÒNG 3D ===' -ForegroundColor White
if ($s.Test) { Write-Canh ("CHẾ ĐỘ THỬ: bộ '{0}', cổng {1}/{2}. Không ghi tệp đánh dấu, không mở trình duyệt." -f $s.Project, $s.GamePort, $s.AdminPort) }

Write-Buoc '1/6 Kiểm tra Docker'
if (-not (Start-DockerIfNeeded)) { Write-Loi 'Docker chưa sẵn sàng. Mở Docker Desktop, đợi biểu tượng cá voi đứng yên rồi chạy lại.'; Exit-Ops 1 }
Write-Tot 'Docker đang chạy.'

Write-Buoc '2/6 Khoá bí mật (server\.env)'
if (-not (Initialize-EnvFile)) { Exit-Ops 1 }
$envv = Read-DotEnv
Write-Tot 'Có đủ khoá bí mật.'
New-Item -ItemType Directory -Force -Path $script:BackupDir | Out-Null

# chọn tunnel
$mode = 'none'
if ($TamThoi) { $mode = 'quick' }
elseif (-not $KhongTunnel -and $envv['TUNNEL_TOKEN']) { $mode = 'named' }
if ($KhongTunnel) { $mode = 'none' }

Write-Buoc '3/6 Khởi động game + cơ sở dữ liệu (lần đầu mất vài phút để dựng)'
$profiles = @()
if (-not $KhongSaoLuu) { $profiles += @('--profile', 'backup') }
$upArgs = $profiles + @('up', '-d', '--remove-orphans')
if (-not $KhongBuild) { $upArgs += '--build' }
$upArgs += @('game', 'db', 'portal')
if (-not $KhongSaoLuu) { $upArgs += 'backup' }
$code = Invoke-Compose $s $upArgs
if ($code -ne 0) { Write-Loi 'docker compose báo lỗi (xem dòng phía trên). Thử chạy lại; nếu vẫn lỗi xem VAN_HANH.md mục "Sự cố".'; Exit-Ops 1 }

$h = Wait-Health $s.GameUrl 150
if (-not $h) { Write-Loi ('Máy chủ game không trả lời ở ' + $s.GameUrl + '/healthz sau 150 giây.'); Write-Dong 'Xem nhật ký:  docker compose -p ' + $s.Project + ' logs game --tail 50'; Exit-Ops 1 }
Write-Tot ("Game chạy: kiểu kết nối {0}, cơ sở dữ liệu {1}, đang chơi {2} người." -f $h.transport, $h.db, $h.ccu)

Write-Buoc '4/6 Giữ máy không ngủ'
$awakePid = Start-KeepAwake $s
Start-Sleep -Milliseconds 800
if (Get-KeepAwakeProcess $s) { Write-Tot ("Đã bật (tiến trình nền {0}). Nhớ CẮM SẠC." -f $awakePid) } else { Write-Canh 'Không bật được tiến trình giữ máy thức — hãy tự tắt chế độ ngủ trong Cài đặt > Nguồn.' }
if (-not $s.Test) {
  Set-Content -LiteralPath $s.Marker -Value ("hpworld server live since {0}" -f (Get-Date).ToString('s')) -Encoding ASCII
  Write-Tot 'Đã báo cho công cụ đồ hoạ: KHÔNG chạy kiểm tra đồ hoạ nặng trong lúc máy chủ mở.'
}

Write-Buoc '5/6 Kết nối Internet (Cloudflare Tunnel)'
$publicUrl = $null
if ($mode -eq 'named') {
  $code = Invoke-Compose $s @('--profile', 'tunnel', 'up', '-d', '--build', 'tunnel')
  if ($code -ne 0) { Write-Loi 'Không bật được tunnel tên miền (xem lỗi ở trên). Người chơi ngoài chưa vào được.' }
  else {
    Start-Sleep -Seconds 4
    $st = Get-ServiceState $s
    if ($st['tunnel'] -and $st['tunnel'].State -eq 'running') { Write-Tot 'Tunnel tên miền đang chạy.' } else { Write-Loi 'Tunnel tên miền không chạy — kiểm tra TUNNEL_TOKEN trong server\.env.' }
    if ($envv['PUBLIC_HTTP_URL'] -and $envv['PUBLIC_HTTP_URL'] -notmatch '127\.0\.0\.1|localhost') { $publicUrl = $envv['PUBLIC_HTTP_URL'] }
  }
} elseif ($mode -eq 'quick') {
  $code = Invoke-Compose $s @('--profile', 'quicktunnel', 'up', '-d', 'quicktunnel')
  if ($code -ne 0) { Write-Loi 'Không bật được tunnel tạm.' }
  else {
    $tq = Get-Date
    while (-not $publicUrl -and ((Get-Date) - $tq).TotalSeconds -lt 60) { Start-Sleep -Seconds 2; $publicUrl = Get-QuickTunnelUrl $s }
    if ($publicUrl) {
      # Địa chỉ mới cần ~20–60 giây để tên miền có trên Internet. Hỏi DNS CÔNG CỘNG (1.1.1.1), KHÔNG hỏi qua modem:
      # hỏi modem quá sớm làm nó nhớ "không tồn tại" vài phút (vòng sửa 1, SO-10).
      Write-Dong 'Đợi địa chỉ tạm có hiệu lực trên Internet (tối đa 90 giây)...'
      $hostName = ($publicUrl -replace '^https://', '').TrimEnd('/')
      $dnsOk = $false; $td = Get-Date
      while (-not $dnsOk -and ((Get-Date) - $td).TotalSeconds -lt 90) {
        try { $r = Resolve-DnsName -Name $hostName -Server 1.1.1.1 -DnsOnly -Type A -ErrorAction Stop; if ($r) { $dnsOk = $true } } catch { Start-Sleep -Seconds 3 }
      }
      if ($dnsOk) { Start-Sleep -Seconds 10; Write-Tot 'Tunnel tạm đang chạy (địa chỉ đổi mỗi lần bật).' }
      else { Write-Canh 'Tên miền tạm chưa có trên Internet sau 90 giây — đợi thêm 1–2 phút rồi mới mở / gửi địa chỉ.' }
    } else { Write-Loi 'Chưa lấy được địa chỉ tunnel tạm sau 60 giây — xem: docker compose -p ' + $s.Project + ' --profile quicktunnel logs quicktunnel' }
  }
} else {
  Write-Dong 'Không bật tunnel: chỉ máy này vào được (thêm -TamThoi để thử qua Internet, hoặc cài tên miền — VAN_HANH.md).'
}

Write-Buoc '6/6 Xong'
$secs = [int]((Get-Date) - $t0).TotalSeconds
Write-Tot ("Máy chủ đã mở sau {0} giây." -f $secs)
Write-Dong ('Trang quản trị (chỉ máy này):  ' + $s.AdminUrl + '/admin')
if ($publicUrl) {
  $wss = $publicUrl -replace '^https://', 'wss://' -replace '^http://', 'ws://'
  Write-Host ''
  Write-Host ('   ĐỊA CHỈ MÁY CHỦ CHO NGƯỜI CHƠI:  ' + $wss) -ForegroundColor Green
  Write-Dong ('   Đo mạng:  netprobe.html?s=' + $wss)
  if ($mode -eq 'quick') {
    Write-Canh 'Địa chỉ tạm chỉ dùng để thử; KHÔNG đăng lên mạng xã hội. Tắt máy chủ là địa chỉ mất.'
    Write-Canh 'Nếu máy này báo "không tìm thấy" địa chỉ: đợi 1–2 phút (bộ nhớ DNS của modem) rồi thử lại; người chơi ở mạng khác vào được ngay.'
  }
}
Write-Dong 'Xem tình trạng:  server\ops\trang-thai.ps1     Tắt máy chủ:  server\ops\tat-may-chu.ps1'
Write-Dong 'Khẩn cấp (ngắt Internet ngay, giữ dữ liệu):  server\ops\khoa-khan-cap.ps1'

if (-not $s.Test -and -not $KhongMoTrang) {
  try { Start-Process ($s.AdminUrl + '/admin') | Out-Null } catch { }
}
Exit-Ops 0
