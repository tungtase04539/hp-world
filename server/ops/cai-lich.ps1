# server/ops/cai-lich.ps1 — CÀI LỊCH SAO LƯU tự động mỗi đêm bằng Task Scheduler của Windows (cho tài khoản hiện tại,
# không cần quyền quản trị). Chạy MỘT LẦN khi anh muốn bật; chạy lại với -Go để gỡ lịch.
#   powershell -ExecutionPolicy Bypass -File server\ops\cai-lich.ps1                    cài: 03:30 mỗi đêm chạy sao-luu.ps1
#   ... -Gio "02:45"                    đổi giờ
#   ... -ThuMucChep "D:\OneDrive\SaoLuuHaiPhong3D"   chép thêm sang ổ khác / đám mây
#   ... -Go                             gỡ lịch
# Ghi chú: dịch vụ "backup" trong docker compose cũng sao lưu mỗi đêm lúc 03:15 khi máy chủ mở. Lịch này là lớp thứ hai,
# chạy được cả khi chỉ có cơ sở dữ liệu, và chép sang thư mục thứ hai. Máy phải đang bật (không ngủ) vào giờ đó.
# Script này được CUNG CẤP sẵn — lập trình viên không tự chạy nó trên máy anh.
param(
  [string]$Gio = '03:30',
  [string]$ThuMucChep = '',
  [switch]$Go
)
. "$PSScriptRoot\chung.ps1"
$taskName = 'HaiPhong3D - Sao luu may chu'
if ($Go) {
  try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop; Write-Tot 'Đã gỡ lịch sao lưu.' } catch { Write-Dong 'Không có lịch nào để gỡ.' }
  exit 0
}
$script = Join-Path $script:OpsDir 'sao-luu.ps1'
$arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '"'
if ($ThuMucChep) { $arg += ' -ThuMucChep "' + $ThuMucChep + '"' }
$at = [datetime]::ParseExact($Gio, 'HH:mm', $null)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg -WorkingDirectory $script:ServerDir
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Sao luu co so du lieu may chu game Hai Phong 3D (server/ops/sao-luu.ps1)' -Force | Out-Null
Write-Tot ("Đã cài lịch '{0}': {1} mỗi đêm." -f $taskName, $Gio)
Write-Dong 'Xem/sửa trong Task Scheduler (Trình lập lịch tác vụ). Gỡ: cai-lich.ps1 -Go'
exit 0
