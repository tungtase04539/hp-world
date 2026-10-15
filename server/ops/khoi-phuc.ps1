# server/ops/khoi-phuc.ps1 — KHÔI PHỤC từ bản sao lưu.
#   Mặc định = DIỄN TẬP (an toàn, không đụng dữ liệu thật): nạp bản sao lưu vào một cơ sở dữ liệu NHÁP tạm thời
#   (container riêng, không có mạng), đếm số dòng từng bảng, so với dữ liệu đang chạy, rồi xoá bản nháp.
#     powershell -ExecutionPolicy Bypass -File server\ops\khoi-phuc.ps1
#     ... -TepSaoLuu "server\data\backups\hp-20261014-031500.dump"   (mặc định: bản mới nhất)
#   KHÔI PHỤC THẬT (thay toàn bộ dữ liệu đang chạy bằng bản sao lưu — người chơi mất tiến độ sau thời điểm sao lưu):
#     ... -KhoiPhucThat         hỏi gõ "DONG Y" để xác nhận; tự sao lưu dữ liệu hiện tại trước khi thay
#   ... -TestMode   (lập trình viên) bản thử;  -KhongHoi  bỏ câu hỏi xác nhận (chỉ dùng trong kiểm thử tự động)
param(
  [string]$TepSaoLuu = '',
  [switch]$KhoiPhucThat,
  [switch]$KhongHoi,
  [switch]$TestMode
)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
$PgImage = 'postgres:17@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3'
$CountSql = "select table_name || '=' || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || quote_ident(table_name), false, true, '')))[1]::text from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"

function Get-Counts([string[]]$execPrefix) {
  $r = Get-CmdOutput 'docker' ($execPrefix + @('psql', '-U', 'hp', '-d', 'hp', '-tA', '-c', $CountSql))
  $h = [ordered]@{}
  if ($r.Code -ne 0) { return $null }
  foreach ($line in ($r.Text -split "`r?`n")) { $p = $line.Split('='); if ($p.Count -eq 2 -and $p[0]) { $h[$p[0]] = [int]$p[1] } }
  return $h
}
# pg_restore đọc file từ stdin (cmd /c "<" giữ nguyên dữ liệu nhị phân; docker cp không ghi được vào tmpfs/root chỉ-đọc)
function Invoke-RestoreStdin([string]$containerCmd, [string]$file) {
  $cmdline = 'docker ' + $containerCmd + ' < "' + $file + '" 2>&1'
  $out = & cmd.exe /d /c $cmdline
  return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
}

Write-Host ''
if ($KhoiPhucThat) { Write-Host '=== KHÔI PHỤC THẬT TỪ BẢN SAO LƯU ===' -ForegroundColor Red } else { Write-Host '=== DIỄN TẬP KHÔI PHỤC (không đụng dữ liệu thật) ===' -ForegroundColor White }
if (-not (Test-DockerReady)) { Write-Loi 'Docker không chạy.'; Exit-Ops 1 }
if ($TepSaoLuu) { $file = Get-Item -LiteralPath $TepSaoLuu -ErrorAction SilentlyContinue } else { $file = Get-LatestBackup }
if (-not $file) { Write-Loi 'Không tìm thấy bản sao lưu nào (server\data\backups\hp-*.dump).'; Exit-Ops 1 }
Write-Dong ("Bản sao lưu: {0} ({1:N0} KB, lúc {2})" -f $file.Name, ($file.Length / 1KB), $file.LastWriteTime)
$st = Get-ServiceState $s
$liveDb = $st['db'] -and $st['db'].State -eq 'running'
$liveExec = @('compose', '-p', $s.Project, '-f', $script:ComposeFile, 'exec', '-T', 'db')

if (-not $KhoiPhucThat) {
  $name = $s.Project + '-drill'
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $null = Get-CmdOutput 'docker' @('rm', '-f', $name)
  Write-Buoc '1/4 Tạo cơ sở dữ liệu nháp (container riêng, không có mạng, xoá khi xong)'
  $r = Get-CmdOutput 'docker' @('run', '-d', '--rm', '--name', $name, '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER', '--security-opt', 'no-new-privileges:true', '--memory', '512m', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=hp', '-e', 'POSTGRES_DB=hp', '-e', 'POSTGRES_PASSWORD=drill-only-not-used', $PgImage)
  if ($r.Code -ne 0) { Write-Loi ('Không tạo được container nháp: ' + $r.Text); Exit-Ops 1 }
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    $p = Get-CmdOutput 'docker' @('exec', $name, 'psql', '-h', '127.0.0.1', '-U', 'hp', '-d', 'hp', '-tAc', 'select 1')   # TCP: máy chủ tạm lúc khởi tạo chỉ nghe socket nội bộ
    if ($p.Code -eq 0 -and $p.Text.Trim() -eq '1') { $ready = $true; break }
  }
  if (-not $ready) { Write-Loi 'Cơ sở dữ liệu nháp không khởi động được.'; $null = Get-CmdOutput 'docker' @('rm', '-f', $name); Exit-Ops 1 }
  Write-Tot 'Sẵn sàng.'
  Write-Buoc '2/4 Nạp bản sao lưu vào bản nháp'
  $rr = Invoke-RestoreStdin ('exec -i ' + $name + ' pg_restore -U hp -d hp --no-owner --exit-on-error') $file.FullName
  if ($rr.Code -ne 0) { Write-Loi ('pg_restore lỗi: ' + $rr.Text); $null = Get-CmdOutput 'docker' @('rm', '-f', $name); Exit-Ops 1 }
  Write-Tot 'Nạp xong, không lỗi.'
  Write-Buoc '3/4 Đếm dữ liệu'
  $drill = Get-Counts @('exec', $name)
  $live = $null; if ($liveDb) { $live = Get-Counts $liveExec }
  $okAll = $true
  if (-not $drill -or $drill.Count -eq 0) { Write-Loi 'Bản nháp không có bảng nào.'; $okAll = $false }
  else {
    foreach ($k in $drill.Keys) {
      $lv = '-'; if ($live -and $live.Contains($k)) { $lv = $live[$k] }
      Write-Dong ("{0,-28} bản sao lưu: {1,8}   đang chạy: {2,8}" -f $k, $drill[$k], $lv)
    }
    if (-not $drill.Contains('schema_migrations') -or $drill['schema_migrations'] -lt 1) { Write-Loi 'Thiếu bảng schema_migrations.'; $okAll = $false }
  }
  Write-Buoc '4/4 Xoá bản nháp'
  $null = Get-CmdOutput 'docker' @('rm', '-f', $name)
  $sw.Stop()
  if ($okAll) {
    Write-Tot ("DIỄN TẬP THÀNH CÔNG sau {0:N1} giây: bản sao lưu {1} khôi phục được ({2} bảng)." -f $sw.Elapsed.TotalSeconds, $file.Name, $drill.Count)
    Write-Dong '(Số dòng "đang chạy" có thể nhiều hơn vì người chơi tiếp tục chơi sau lúc sao lưu.)'
    Exit-Ops 0
  }
  Write-Loi 'DIỄN TẬP THẤT BẠI — bản sao lưu này không dùng được. Báo lập trình viên.'
  Exit-Ops 1
}

# ---------------- KHÔI PHỤC THẬT ----------------
if (-not $liveDb) { Write-Loi 'Cơ sở dữ liệu đang tắt. Mở máy chủ trước (mo-may-chu.ps1 -KhongTunnel) rồi chạy lại.'; Exit-Ops 1 }
if (-not $KhongHoi) {
  Write-Canh 'Toàn bộ dữ liệu hiện tại sẽ bị THAY bằng bản sao lưu trên. Người chơi bị ngắt trong lúc khôi phục.'
  $ans = Read-Host 'Gõ DONG Y (viết hoa) để tiếp tục, hoặc Enter để huỷ'
  if ($ans -ne 'DONG Y') { Write-Dong 'Đã huỷ. Không thay đổi gì.'; Exit-Ops 0 }
}
Write-Buoc '1/5 Sao lưu dữ liệu hiện tại trước khi thay (phòng khi cần quay lại)'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:OpsDir 'sao-luu.ps1') | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Loi 'Không sao lưu được dữ liệu hiện tại → dừng, không khôi phục.'; Exit-Ops 1 }
Write-Buoc '2/5 Tạm dừng game và tunnel'
$wasTunnel = $st['tunnel'] -and $st['tunnel'].State -eq 'running'
$wasQuick = $st['quicktunnel'] -and $st['quicktunnel'].State -eq 'running'
# Tunnel TẠM không dừng (vòng sửa 1 MP-2b): dừng rồi bật lại là ra địa chỉ *.trycloudflare.com MỚI, cả nhóm mất link.
# Game đã dừng nên trong lúc khôi phục không ai vào được; tunnel tạm chỉ trả lỗi tạm thời rồi tự nối lại game.
$null = Invoke-Compose $s ($script:AllProfiles + @('stop', '-t', '8', 'tunnel', 'game'))
Write-Buoc '3/5 Thay cơ sở dữ liệu'
$r = Get-CmdOutput 'docker' ($liveExec + @('psql', '-U', 'hp', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP DATABASE IF EXISTS hp WITH (FORCE)', '-c', 'CREATE DATABASE hp OWNER hp'))
if ($r.Code -ne 0) { Write-Loi ('Không tạo lại được cơ sở dữ liệu: ' + $r.Text); Exit-Ops 1 }
$rr = Invoke-RestoreStdin ('compose -p ' + $s.Project + ' -f "' + $script:ComposeFile + '" exec -T db pg_restore -U hp -d hp --no-owner --exit-on-error') $file.FullName
if ($rr.Code -ne 0) { Write-Loi ('pg_restore lỗi: ' + $rr.Text + ' — khôi phục bản vừa sao lưu ở bước 1 bằng: khoi-phuc.ps1 -KhoiPhucThat -TepSaoLuu <bản mới nhất>'); Exit-Ops 1 }
Write-Tot 'Đã nạp bản sao lưu.'
Write-Buoc '4/5 Mở lại game'
$null = Invoke-Compose $s @('up', '-d', 'game')
$h = Wait-Health $s.GameUrl 120
if (-not $h) { Write-Loi ('Game không khởi động lại được — xem: docker compose -p ' + $s.Project + ' logs game --tail 50'); Exit-Ops 1 }
if ($wasTunnel) { $null = Invoke-Compose $s @('--profile', 'tunnel', 'up', '-d', 'tunnel') }
if ($wasQuick) {
  $stq = Get-ServiceState $s
  if ($stq['quicktunnel'] -and $stq['quicktunnel'].State -eq 'running') { Write-Tot 'Tunnel tạm vẫn chạy — địa chỉ KHÔNG đổi.' }
  else {
    $null = Start-QuickTunnelFresh $s
    $u = $null; $tq = Get-Date
    while (-not $u -and ((Get-Date) - $tq).TotalSeconds -lt 60) { Start-Sleep -Seconds 2; $u = Get-QuickTunnelUrl $s }
    if ($u) { Set-LastQuickUrl $s $u; Write-Canh ('Tunnel tạm có ĐỊA CHỈ MỚI — gửi lại cho mọi người: ' + ($u -replace '^https://', 'wss://')) }
    else { Write-Canh 'Tunnel tạm có ĐỊA CHỈ MỚI — xem trang-thai.ps1.' }
  }
}
Write-Buoc '5/5 Kiểm tra'
$c = Get-Counts $liveExec
foreach ($k in $c.Keys) { Write-Dong ("{0,-28} {1,8}" -f $k, $c[$k]) }
Write-Tot 'KHÔI PHỤC XONG.'
Exit-Ops 0
