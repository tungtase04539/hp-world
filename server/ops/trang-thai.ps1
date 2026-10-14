# server/ops/trang-thai.ps1 — XEM TÌNH TRẠNG MÁY CHỦ: đang chạy không, bao nhiêu người, sao lưu gần nhất, tunnel,
# và AN TOÀN: cổng nào đang mở ở địa chỉ nào (chỉ được là 127.0.0.1 — tức là chỉ máy này).
#   powershell -ExecutionPolicy Bypass -File server\ops\trang-thai.ps1        (-TestMode cho bản thử)
param([switch]$TestMode)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
$bad = 0
Write-Host ''
Write-Host '=== TÌNH TRẠNG MÁY CHỦ GAME HẢI PHÒNG 3D ===' -ForegroundColor White
if ($s.Test) { Write-Canh ("CHẾ ĐỘ THỬ: bộ '{0}', cổng {1}/{2}." -f $s.Project, $s.GamePort, $s.AdminPort) }

Write-Buoc 'Các phần của máy chủ'
$st = @{}
if (Test-DockerReady) {
  $st = Get-ServiceState $s
  $names = @{ game = 'Game'; portal = 'Cổng 127.0.0.1 (portal)'; db = 'Cơ sở dữ liệu'; backup = 'Sao lưu hằng đêm'; tunnel = 'Tunnel tên miền'; quicktunnel = 'Tunnel tạm' }
  foreach ($k in @('game', 'portal', 'db', 'backup', 'tunnel', 'quicktunnel')) {
    $x = $st[$k]
    if (-not $x) { Write-Dong ("{0}: không chạy" -f $names[$k]); continue }
    $txt = "{0}: {1}" -f $names[$k], $x.State
    if ($x.Health) { $txt += " ({0})" -f $x.Health }
    if ($x.State -eq 'running' -and ($x.Health -eq '' -or $x.Health -eq 'healthy')) { Write-Tot $txt } else { Write-Canh $txt }
  }
} else { Write-Canh 'Docker không chạy → máy chủ đang TẮT.' }

Write-Buoc 'Game'
$h = Get-Health $s.GameUrl 3
if ($h -and $h.ok) {
  $up = [TimeSpan]::FromSeconds([double]$h.uptimeS)
  Write-Tot ("Đang chạy {0}g {1}p — người chơi: {2} — kết nối: {3} — dữ liệu: {4} ({5} ms)" -f [int]$up.TotalHours, $up.Minutes, $h.ccu, $h.transport, $h.db, $h.dbMs)
} else { Write-Dong ('Không trả lời ở ' + $s.GameUrl + '/healthz (máy chủ tắt hoặc đang khởi động).') }

$envv = Read-DotEnv
if ($h -and $h.ok -and $envv['ADMIN_TOKEN']) {
  try {
    $dbSize = Get-CmdOutput 'docker' @('compose', '-p', $s.Project, '-f', $script:ComposeFile, 'exec', '-T', 'db', 'psql', '-U', 'hp', '-d', 'hp', '-tAc', "select pg_size_pretty(pg_database_size('hp'))")
    if ($dbSize.Code -eq 0) { Write-Dong ('Dung lượng cơ sở dữ liệu: ' + $dbSize.Text.Trim()) }
  } catch { }
}

Write-Buoc 'Tunnel (đường vào từ Internet)'
if ($st['quicktunnel'] -and $st['quicktunnel'].State -eq 'running') {
  $u = Get-QuickTunnelUrl $s
  if ($u) { Write-Tot ('Tunnel tạm: ' + ($u -replace '^https://', 'wss://')) } else { Write-Canh 'Tunnel tạm đang chạy nhưng chưa có địa chỉ.' }
} elseif ($st['tunnel'] -and $st['tunnel'].State -eq 'running') {
  $pub = $envv['PUBLIC_WS_URL']; if (-not $pub) { $pub = '(chưa đặt PUBLIC_WS_URL trong server\.env)' }
  Write-Tot ('Tunnel tên miền đang chạy: ' + $pub)
} else { Write-Dong 'Không có tunnel: người ngoài KHÔNG vào được (chỉ máy này).' }

Write-Buoc 'Sao lưu'
$b = Get-LatestBackup
if ($b) {
  $age = (Get-Date) - $b.LastWriteTime
  $txt = "Bản gần nhất: {0} ({1:N0} KB), cách đây {2:N1} giờ" -f $b.Name, ($b.Length / 1KB), $age.TotalHours
  if ($age.TotalHours -le 26) { Write-Tot $txt } else { Write-Canh ($txt + ' — quá 1 ngày!') }
  $n = @(Get-ChildItem -LiteralPath $script:BackupDir -Filter 'hp-*.dump' -File).Count
  Write-Dong ("Đang giữ {0} bản trong {1}" -f $n, $script:BackupDir)
} else { Write-Canh 'Chưa có bản sao lưu nào (chạy server\ops\sao-luu.ps1).' }
$errFile = Join-Path $script:BackupDir 'last_error.txt'
if (Test-Path -LiteralPath $errFile) { Write-Loi ('Lần sao lưu gần nhất LỖI: ' + (Get-Content -LiteralPath $errFile -TotalCount 1)) ; $bad++ }
try {
  $drive = Get-PSDrive -Name ((Split-Path -Qualifier $script:ServerDir).TrimEnd(':')) -ErrorAction Stop
  $freeGb = [math]::Round($drive.Free / 1GB, 1)
  if ($freeGb -lt 10) { Write-Canh ("Ổ đĩa còn trống {0} GB — nên dọn bớt." -f $freeGb) } else { Write-Dong ("Ổ đĩa còn trống {0} GB." -f $freeGb) }
} catch { }

Write-Buoc 'Giữ máy thức'
if (Get-KeepAwakeProcess $s) { Write-Tot 'Đang giữ máy không ngủ.' } else { Write-Dong 'Không giữ máy thức (máy chủ tắt, hoặc tiến trình nền đã dừng).' }
if (-not $s.Test) {
  if (Test-Path -LiteralPath $s.Marker) {
    $mAge = ((Get-Date) - (Get-Item -LiteralPath $s.Marker).LastWriteTime).TotalMinutes
    if ($mAge -lt 10) { Write-Tot 'Công cụ đồ hoạ đang bị chặn (đúng: máy chủ đang mở).' } else { Write-Canh 'Tệp đánh dấu cũ (> 10 phút) — tiến trình giữ máy thức có thể đã dừng.' }
  } else { Write-Dong 'Không có tệp đánh dấu (công cụ đồ hoạ được phép chạy).' }
}

Write-Buoc 'AN TOÀN: cổng đang mở trên máy này'
$ports = @($s.GamePort, $s.AdminPort)
$ls = @(Get-Listeners $ports)
if ($ls.Count -eq 0) { Write-Dong ("Không có gì nghe trên cổng {0}." -f ($ports -join ', ')) }
foreach ($l in $ls) {
  if ($l.Address -eq '127.0.0.1' -or $l.Address -eq '::1') { Write-Tot ("Cổng {0}: chỉ {1} (chỉ máy này) — {2}" -f $l.Port, $l.Address, $l.Process) }
  else { Write-Loi ("Cổng {0} đang mở ở {1} — NGƯỜI KHÁC TRONG MẠNG CÓ THỂ VÀO! Chạy tat-may-chu.ps1 và báo lập trình viên." -f $l.Port, $l.Address); $bad++ }
}
# mọi cổng Docker publish của bộ này phải là 127.0.0.1
if (Test-DockerReady) {
  $pub = Get-CmdOutput 'docker' @('ps', '--filter', ('label=com.docker.compose.project=' + $s.Project), '--format', '{{.Names}} {{.Ports}}')
  foreach ($line in ($pub.Text -split "`r?`n")) {
    if (-not $line.Trim()) { continue }
    $exposed = [regex]::Matches($line, '(\S+):(\d+)->') | Where-Object { $_.Groups[1].Value -ne '127.0.0.1' }
    if ($exposed) { Write-Loi ('Container mở cổng ra ngoài 127.0.0.1: ' + $line); $bad++ }
  }
  if ($bad -eq 0) { Write-Tot 'Mọi cổng Docker của máy chủ chỉ mở ở 127.0.0.1. Đường vào từ Internet duy nhất là Cloudflare Tunnel.' }
}
Write-Host ''
if ($bad -gt 0) { Exit-Ops 2 }
Exit-Ops 0
