# gpu_watchdog.ps1 — chốt an toàn: tối đa 1 Chrome headless dùng GPU (ANGLE d3d11) trên toàn máy.
# Thừa → kill bản MỚI hơn (giữ bản cũ nhất = bản đang giữ khoá). Ghi log để agent/điều phối xem.
# Chạy nền: Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','tools\qa\gpu_watchdog.ps1'
# (sau mỗi lần khởi động lại máy). Log ở %LOCALAPPDATA%\hpworld\ — KHÔNG để trong thư mục tạm của phiên (2026-10-15 thư mục
# scratchpad bị xoá sạch, script + log mất theo).
$dir = Join-Path $env:LOCALAPPDATA 'hpworld'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'gpu_watchdog.log'
"$(Get-Date -Format s) watchdog start pid=$PID" | Out-File -Append -Encoding utf8 $log
while ($true) {
  try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
      Where-Object { $_.CommandLine -and $_.CommandLine -match '--headless' -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'swiftshader' }
    if ($procs -and @($procs).Count -gt 1) {
      $sorted = @($procs) | Sort-Object CreationDate
      $keep = $sorted[0]
      foreach ($p in $sorted[1..($sorted.Count - 1)]) {
        "$(Get-Date -Format s) KILL extra GPU chrome pid=$($p.ProcessId) (keep $($keep.ProcessId)); parent=$($p.ParentProcessId)" | Out-File -Append -Encoding utf8 $log
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      }
    }
  } catch { "$(Get-Date -Format s) err $_" | Out-File -Append -Encoding utf8 $log }
  Start-Sleep -Seconds 3
}
