# server/ops/giu-may-thuc.ps1 — S5. Tiến trình NỀN giữ máy không ngủ trong lúc máy chủ game chạy.
# mo-may-chu.ps1 tự bật nó (cửa sổ ẩn); tat-may-chu.ps1 tự tắt nó. Anh không cần chạy tay.
#   - Gọi Windows SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED): máy không tự ngủ khi rảnh
#     (màn hình vẫn được tắt để tiết kiệm điện). Kiểm tra bằng `powercfg /requests` (cửa sổ quản trị): mục SYSTEM.
#   - Bản thật (-Marker): chạm tệp %TEMP%\hpworld_server_live.txt mỗi phút → công cụ kiểm tra đồ hoạ (gpulock) biết
#     máy chủ đang chạy và CHỜ, không mở Chrome 3D (tránh màn xanh giữa buổi chơi).
#   - Dừng khi tệp -RunFile bị xoá (tat-may-chu.ps1 xoá nó) hoặc khi tiến trình bị tắt; khi dừng thì trả lại chế độ ngủ bình thường.
param(
  [Parameter(Mandatory = $true)][string]$RunFile,
  [string]$Marker = '',
  [int]$IntervalSec = 60
)
$ErrorActionPreference = 'Continue'
Add-Type -Namespace HpWorld -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$ES_CONTINUOUS = [uint32]2147483648        # 0x80000000
$ES_SYSTEM_REQUIRED = [uint32]1            # 0x00000001
$keep = [uint32]($ES_CONTINUOUS + $ES_SYSTEM_REQUIRED)

[void][HpWorld.Power]::SetThreadExecutionState($keep)
$last = [datetime]::MinValue
try {
  while (Test-Path -LiteralPath $RunFile) {
    if (((Get-Date) - $last).TotalSeconds -ge $IntervalSec) {
      [void][HpWorld.Power]::SetThreadExecutionState($keep)
      if ($Marker) {
        try { Set-Content -LiteralPath $Marker -Value ("hpworld server live; helper pid={0}; touched {1}" -f $PID, (Get-Date).ToString('s')) -Encoding ASCII } catch { }
      }
      $last = Get-Date
    }
    Start-Sleep -Seconds 2
  }
} finally {
  [void][HpWorld.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}
