# server/ops/tat-may-chu.ps1 — TẮT MÁY CHỦ GAME (tunnel + game + cơ sở dữ liệu). Dữ liệu người chơi được GIỮ NGUYÊN.
#   powershell -ExecutionPolicy Bypass -File server\ops\tat-may-chu.ps1
#   ... -TestMode   (lập trình viên) tắt bản thử; không đụng tới tệp đánh dấu của bản thật
#   ... -XoaDuLieuThu   CHỈ với -TestMode: xoá luôn dữ liệu của bản thử (docker compose down -v)
# Mục tiêu: dừng hẳn trong ≤ 10 giây, rồi kiểm tra không còn gì nghe trên các cổng của máy chủ.
param(
  [switch]$TestMode,
  [switch]$XoaDuLieuThu
)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
$sw = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host ''
Write-Host '=== TẮT MÁY CHỦ GAME HẢI PHÒNG 3D ===' -ForegroundColor White
if ($s.Test) { Write-Canh ("CHẾ ĐỘ THỬ: bộ '{0}', cổng {1}/{2}." -f $s.Project, $s.GamePort, $s.AdminPort) }

Write-Buoc '1/3 Dừng tunnel, game, cơ sở dữ liệu'
if (Test-DockerReady) {
  # tunnel trước (người chơi ngắt ngay), rồi tất cả; game lưu dữ liệu khi nhận tín hiệu dừng (tối đa 8 giây)
  $null = Get-CmdOutput 'docker' (@('compose', '-p', $s.Project, '-f', $script:ComposeFile) + $script:AllProfiles + @('kill', 'tunnel', 'quicktunnel'))
  $downArgs = $script:AllProfiles + @('down', '--timeout', '8', '--remove-orphans')
  if ($XoaDuLieuThu) {
    if (-not $s.Test) { Write-Loi '-XoaDuLieuThu chỉ dùng với -TestMode (bản thật không bao giờ bị xoá dữ liệu bằng script này).'; Exit-Ops 1 }
    $downArgs += '-v'
  }
  $code = Invoke-Compose $s $downArgs
  if ($code -ne 0) { Write-Canh 'docker compose down báo lỗi — xem dòng phía trên.' } else { Write-Tot 'Đã dừng các container.' }
} else {
  Write-Canh 'Docker không chạy — coi như máy chủ đã tắt.'
}

Write-Buoc '2/3 Trả máy về chế độ ngủ bình thường'
if (Stop-KeepAwake $s) { Write-Tot 'Đã tắt tiến trình giữ máy thức.' } else { Write-Dong 'Tiến trình giữ máy thức không chạy.' }
if (-not $s.Test) {
  Remove-Item -LiteralPath $s.Marker -Force -ErrorAction SilentlyContinue
  Write-Tot 'Đã xoá tệp đánh dấu: công cụ đồ hoạ lại được phép chạy.'
}

Write-Buoc '3/3 Kiểm tra không còn cổng nào mở'
$left = @()
for ($i = 0; $i -lt 10; $i++) {
  $left = @(Get-Listeners @($s.GamePort, $s.AdminPort))
  if ($left.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
}
$sw.Stop()
if ($left.Count -eq 0) {
  Write-Tot ("Không còn gì nghe trên cổng {0} và {1}." -f $s.GamePort, $s.AdminPort)
} else {
  foreach ($l in $left) { Write-Loi ("Cổng {0} vẫn đang nghe ở {1} (tiến trình {2})." -f $l.Port, $l.Address, $l.Process) }
}
$secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)
if ($secs -le 10) { Write-Tot ("Tắt xong sau {0} giây." -f $secs) } else { Write-Canh ("Tắt xong sau {0} giây (lâu hơn 10 giây)." -f $secs) }
if ($left.Count -gt 0) { Exit-Ops 2 }
Exit-Ops 0
