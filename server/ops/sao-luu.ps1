# server/ops/sao-luu.ps1 — SAO LƯU NGAY cơ sở dữ liệu game (tài khoản, nhân vật, báo cáo, mã mời...).
#   powershell -ExecutionPolicy Bypass -File server\ops\sao-luu.ps1
#   ... -ThuMucChep "E:\SaoLuuHaiPhong3D"   chép thêm một bản sang ổ USB / ổ khác (KHÔNG thư mục đám mây chia sẻ)
#       (hoặc đặt BACKUP_COPY_DIR=... trong server\.env để lần nào cũng chép)
#   ... -TestMode   (lập trình viên) bản thử
# Bản sao lưu nằm ở server\data\backups\hp-NGÀY-GIỜ.dump, tự xoá bản cũ hơn 14 ngày. Máy chủ phải đang mở.
# Lỗi → ghi server\data\backups\last_error.txt và gửi Telegram (nếu đã cài).
param(
  [string]$ThuMucChep = '',
  [switch]$TestMode
)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
New-Item -ItemType Directory -Force -Path $script:BackupDir | Out-Null
$logFile = Join-Path $script:BackupDir 'sao-luu.log'
function Write-Log([string]$t) { Add-Content -LiteralPath $logFile -Value ((Get-Date).ToString('s') + ' ' + $t) -Encoding UTF8 }

Write-Host ''
Write-Host '=== SAO LƯU CƠ SỞ DỮ LIỆU ===' -ForegroundColor White
$fail = $null
if (-not (Test-DockerReady)) { $fail = 'Docker không chạy' }
else {
  $st = Get-ServiceState $s
  if (-not $st['db'] -or $st['db'].State -ne 'running') { $fail = 'cơ sở dữ liệu không chạy (hãy mở máy chủ trước)' }
}
$before = Get-LatestBackup
if (-not $fail) {
  Write-Buoc 'Đang sao lưu (pg_dump trong container, không đụng tới file cá nhân)'
  $r = Get-CmdOutput 'docker' @('compose', '-p', $s.Project, '-f', $script:ComposeFile, '--profile', 'backup', 'run', '--rm', '--no-deps', '-e', 'BACKUP_ONCE=1', 'backup')
  $after = Get-LatestBackup
  if ($r.Code -ne 0 -or -not $after -or ($before -and $after.FullName -eq $before.FullName)) { $fail = 'pg_dump lỗi: ' + (($r.Text -split "`r?`n" | Where-Object { $_ -match 'FAIL|error|lỗi' }) -join ' / ') }
}
if ($fail) {
  Write-Loi ('Sao lưu THẤT BẠI: ' + $fail)
  Write-Log ('FAIL ' + $fail)
  Set-Content -LiteralPath (Join-Path $script:BackupDir 'last_error.txt') -Value ((Get-Date).ToString('s') + ' ' + $fail) -Encoding UTF8
  if (-not $s.Test) { if (Send-TelegramAlert ('[Hải Phòng 3D] Sao lưu THẤT BẠI: ' + $fail)) { Write-Dong 'Đã gửi cảnh báo Telegram.' } }
  Exit-Ops 1
}
Write-Tot ("Đã sao lưu: {0} ({1:N0} KB)" -f $after.Name, ($after.Length / 1KB))
Write-Log ('OK ' + $after.Name + ' ' + $after.Length)

$envv = Read-DotEnv
if (-not $ThuMucChep -and $envv['BACKUP_COPY_DIR']) { $ThuMucChep = $envv['BACKUP_COPY_DIR'] }
if ($ThuMucChep) {
  # bản sao lưu chứa TOÀN BỘ chat 30 ngày, báo cáo, tài khoản của người chơi (nhiều em nhỏ): không để ở thư mục đám mây
  # đồng bộ / chia sẻ (vòng sửa 1, SEC-5)
  if ($ThuMucChep -match '(?i)onedrive|google ?drive|dropbox|icloud|mega|box sync') {
    Write-Canh 'Thư mục chép có vẻ là thư mục ĐÁM MÂY. Bản sao lưu chứa chat và tài khoản của người chơi (trẻ em) — nên dùng ổ USB / ổ khác của anh, KHÔNG chia sẻ thư mục này cho ai.'
    Write-Log 'WARN copy dir looks like a cloud-synced folder'
  }
  try {
    New-Item -ItemType Directory -Force -Path $ThuMucChep | Out-Null
    Copy-Item -LiteralPath $after.FullName -Destination (Join-Path $ThuMucChep $after.Name) -Force
    # giữ 14 ngày ở thư mục chép
    Get-ChildItem -LiteralPath $ThuMucChep -Filter 'hp-*.dump' -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
    Write-Tot ('Đã chép thêm sang ' + $ThuMucChep)
    Write-Log ('COPY ' + $ThuMucChep)
  } catch {
    Write-Canh ('Không chép được sang ' + $ThuMucChep + ': ' + $_.Exception.Message)
    Write-Log ('COPYFAIL ' + $_.Exception.Message)
    if (-not $s.Test) { Send-TelegramAlert ('[Hải Phòng 3D] Không chép được bản sao lưu sang ' + $ThuMucChep) | Out-Null }
  }
}
Exit-Ops 0
