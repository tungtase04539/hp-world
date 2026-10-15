# server/ops/chung.ps1 — phần dùng chung cho các script vận hành máy chủ Hải Phòng 3D (S5).
# Không chạy trực tiếp: các script khác nạp nó bằng  . "$PSScriptRoot\chung.ps1"
# Tương thích Windows PowerShell 5.1. Không cần quyền quản trị.
#
# Biến môi trường (chỉ dùng khi THỬ NGHIỆM; chủ dự án không cần đặt gì):
#   HPMP_TEST=1            chế độ thử: KHÔNG ghi tệp đánh dấu "máy chủ đang chạy", không mở trình duyệt
#   HPMP_PROJECT           tên bộ Docker (mặc định hpworld)
#   HPMP_GAME_PORT         cổng game trên máy (mặc định 9100)
#   HPMP_ADMIN_PORT        cổng trang quản trị (mặc định 9101)
#   HPMP_EDGE_SUBNET / HPMP_BACKEND_SUBNET / HPMP_IMAGE / HPMP_TUNNEL_IMAGE   (xem docker-compose.yml)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$script:OpsDir      = $PSScriptRoot
$script:ServerDir   = Split-Path -Parent $PSScriptRoot
$script:RepoDir     = Split-Path -Parent $script:ServerDir
$script:ComposeFile = Join-Path $script:ServerDir 'docker-compose.yml'
$script:EnvFile     = Join-Path $script:ServerDir '.env'
$script:BackupDir   = Join-Path $script:ServerDir 'data\backups'
$script:AllProfiles = @('--profile', 'tunnel', '--profile', 'quicktunnel', '--profile', 'backup')

# Giữ cửa sổ mở khi script được chạy bằng "nhấp phải → Run with PowerShell" / nhấp đúp (tiến trình cha là Explorer):
# nếu không, cửa sổ đóng ngay và anh không đọc được kết quả / lỗi / mã mời (vòng sửa 1, SO-9).
# Không dừng khi chạy trong cửa sổ PowerShell sẵn có, khi HPMP_TEST=1 hoặc HPMP_NO_PAUSE=1 (lịch tự động, kiểm thử).
function Wait-Dong {
  if ($env:HPMP_TEST -eq '1' -or $env:HPMP_NO_PAUSE -eq '1') { return }
  $pn = ''
  try {
    $pp = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID) -ErrorAction Stop).ParentProcessId
    $pn = (Get-Process -Id $pp -ErrorAction Stop).ProcessName
  } catch { $pn = '' }
  if ($pn -eq 'explorer') { Write-Host ''; Read-Host 'Nhấn Enter để đóng cửa sổ' | Out-Null }
}
function Exit-Ops([int]$code = 0) { Wait-Dong; exit $code }

function Write-Buoc([string]$text)  { Write-Host ''; Write-Host ('>> ' + $text) -ForegroundColor Cyan }
function Write-Tot([string]$text)   { Write-Host ('   [OK] ' + $text) -ForegroundColor Green }
function Write-Canh([string]$text)  { Write-Host ('   [CHÚ Ý] ' + $text) -ForegroundColor Yellow }
function Write-Loi([string]$text)   { Write-Host ('   [LỖI] ' + $text) -ForegroundColor Red }
function Write-Dong([string]$text)  { Write-Host ('   ' + $text) }

# Cấu hình đang dùng (bản thật hoặc bản thử).
function Get-HpSettings([switch]$TestMode) {
  $test = [bool]$TestMode -or ($env:HPMP_TEST -eq '1')
  $proj = 'hpworld'; if ($env:HPMP_PROJECT) { $proj = $env:HPMP_PROJECT }
  $gp = 9100; if ($env:HPMP_GAME_PORT) { $gp = [int]$env:HPMP_GAME_PORT }
  $ap = 9101; if ($env:HPMP_ADMIN_PORT) { $ap = [int]$env:HPMP_ADMIN_PORT }
  if ($test -and ($proj -eq 'hpworld' -or $gp -eq 9100 -or $ap -eq 9101)) {
    throw 'Chế độ thử (TestMode / HPMP_TEST=1) phải dùng bộ Docker và cổng riêng: đặt HPMP_PROJECT, HPMP_GAME_PORT, HPMP_ADMIN_PORT khác bản thật (hpworld / 9100 / 9101).'
  }
  if ($test) { $env:HPMP_TEST = '1' }
  # bản thử dựng ảnh RIÊNG (vòng sửa 2: thiếu dòng này thì bản thử ghi đè ảnh hpworld-game:local của bản thật)
  if ($test -and -not $env:HPMP_IMAGE) { $env:HPMP_IMAGE = $proj + '-game:local' }
  # để docker compose nội suy đúng cổng / tên ảnh
  $env:HPMP_GAME_PORT = [string]$gp
  $env:HPMP_ADMIN_PORT = [string]$ap
  $tmp = $env:TEMP
  return [pscustomobject]@{
    Test      = $test
    Project   = $proj
    GamePort  = $gp
    AdminPort = $ap
    Marker    = Join-Path $tmp 'hpworld_server_live.txt'      # tools/qa/gpulock.mjs đọc tệp này (chỉ bản thật ghi)
    AwakeRun  = Join-Path $tmp ("hpmp_{0}_awake.run" -f $proj)
    AwakePid  = Join-Path $tmp ("hpmp_{0}_awake.pid" -f $proj)
    GameUrl   = "http://127.0.0.1:$gp"
    AdminUrl  = "http://127.0.0.1:$ap"
  }
}

# Đọc server/.env thành bảng KEY → giá trị (không in ra màn hình).
function Read-DotEnv([string]$path = $script:EnvFile) {
  $h = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $h }
  foreach ($line in [System.IO.File]::ReadAllLines($path)) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    $m = [regex]::Match($t, '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
    if (-not $m.Success) { continue }
    $v = $m.Groups[2].Value
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
    elseif ($v.StartsWith('#')) { $v = '' }
    else { $v = [regex]::Replace($v, '\s+#.*$', '') }
    $h[$m.Groups[1].Value] = $v
  }
  return $h
}

# docker compose cho đúng bộ (project) và file. Trả về mã thoát.
function Invoke-Compose([object]$s, [string[]]$composeArgs) {
  $all = @('compose', '-p', $s.Project, '-f', $script:ComposeFile) + $composeArgs
  & docker @all | Out-Host
  return $LASTEXITCODE
}

# Chạy lệnh ngoài, gộp stdout+stderr thành chuỗi (không làm PowerShell 5.1 báo lỗi giả).
function Get-CmdOutput([string]$exe, [string[]]$cmdArgs) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = ($cmdArgs | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false
  # Process.Start dùng thư mục của tiến trình, KHÔNG theo Push-Location → đặt rõ thư mục hiện tại của PowerShell
  $psi.WorkingDirectory = (Get-Location).ProviderPath
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  $errTask = $p.StandardError.ReadToEndAsync()
  $out = $p.StandardOutput.ReadToEnd()
  $p.WaitForExit()
  return [pscustomobject]@{ Code = $p.ExitCode; Text = ($out + $errTask.Result) }
}

function Test-DockerReady { $r = Get-CmdOutput 'docker' @('info', '--format', '{{.ServerVersion}}'); return ($r.Code -eq 0) }

# Bật Docker Desktop nếu chưa chạy, chờ tối đa $timeoutSec giây.
function Start-DockerIfNeeded([int]$timeoutSec = 180) {
  if (Test-DockerReady) { return $true }
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (-not (Test-Path -LiteralPath $exe)) { Write-Loi 'Không thấy Docker Desktop. Hãy cài Docker Desktop rồi chạy lại.'; return $false }
  Write-Dong 'Docker chưa chạy — đang mở Docker Desktop (có thể mất 1–2 phút)...'
  Start-Process -FilePath $exe | Out-Null
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    Start-Sleep -Seconds 3
    if (Test-DockerReady) { return $true }
  }
  return $false
}

# Tạo server/.env (bí mật ngẫu nhiên) nếu chưa có — cần Node.js trên máy.
function Initialize-EnvFile {
  if (Test-Path -LiteralPath $script:EnvFile) {
    $e = Read-DotEnv
    if ($e['ADMIN_TOKEN'] -and $e['DB_PASSWORD'] -and $e['JWT_PRIVATE_KEY'] -and $e['TICKET_HMAC_KEY'] -and $e['RECOVERY_PEPPER']) { return $true }
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Loi 'Cần Node.js 24 để tạo khoá bí mật lần đầu (https://nodejs.org).'; return $false }
  Push-Location $script:ServerDir
  try {
    $r = Get-CmdOutput 'node' @('-e', "import('./src/config.js').then(m => { const r = m.ensureEnvFile(); console.log(r.created ? 'created' : 'updated'); })")
  } finally { Pop-Location }
  if ($r.Code -ne 0) { Write-Loi ('Không tạo được server/.env: ' + $r.Text); return $false }
  Write-Tot 'Đã tạo khoá bí mật trong server\.env (KHÔNG gửi file này cho ai).'
  return $true
}

function Get-Health([string]$baseUrl, [int]$timeoutSec = 3) {
  try { return Invoke-RestMethod -Uri ($baseUrl + '/healthz') -TimeoutSec $timeoutSec -UseBasicParsing } catch { return $null }
}

function Wait-Health([string]$baseUrl, [int]$timeoutSec = 120) {
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $timeoutSec) {
    $h = Get-Health $baseUrl 2
    if ($h -and $h.ok) { return $h }
    Start-Sleep -Seconds 2
  }
  return $null
}

# Các socket đang NGHE trên các cổng cho trước: [{Port, Address, Process}]
function Get-Listeners([int[]]$ports) {
  $out = @()
  foreach ($p in $ports) {
    $c = $null
    try { $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop } catch { $c = $null }
    foreach ($x in @($c)) {
      if (-not $x) { continue }
      $pn = ''
      try { $pn = (Get-Process -Id $x.OwningProcess -ErrorAction Stop).ProcessName } catch { }
      $out += [pscustomobject]@{ Port = $p; Address = $x.LocalAddress; Process = $pn }
    }
  }
  return $out
}

# Tìm địa chỉ tunnel tạm (https://xxx.trycloudflare.com) của container quicktunnel ĐANG CHẠY — chỉ đọc nhật ký TỪ LÚC
# container khởi động lần này (vòng sửa 1 MP-2b, OPS-STALE-TUNNEL-URL: mọi dịch vụ có restart "no", nên sau khi máy khởi
# động lại container cũ còn nằm đó ở trạng thái Exited; `up -d` chạy lại CHÍNH nó và nhật ký vẫn còn địa chỉ CŨ đã chết —
# đọc cả nhật ký thì 2 giây đầu lấy đúng địa chỉ cũ và in nó ra màu xanh cho anh gửi mọi người).
function Get-QuickTunnelUrl([object]$s) {
  $ps = Get-CmdOutput 'docker' @('compose', '-p', $s.Project, '-f', $script:ComposeFile, '--profile', 'quicktunnel', 'ps', '-q', 'quicktunnel')
  $id = (($ps.Text -split "`r?`n") | Where-Object { $_ -match '^[0-9a-f]{12,64}$' } | Select-Object -First 1)
  if (-not $id) { return $null }
  $ins = Get-CmdOutput 'docker' @('inspect', '-f', '{{.State.Running}}|{{.State.StartedAt}}', $id)
  $p = $ins.Text.Trim().Split('|')
  if ($ins.Code -ne 0 -or $p.Count -lt 2 -or $p[0] -ne 'true' -or -not $p[1]) { return $null }
  $r = Get-CmdOutput 'docker' @('logs', '--since', $p[1].Trim(), $id)
  $m = [regex]::Matches($r.Text, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($m.Count -gt 0) { return $m[$m.Count - 1].Value }
  return $null
}

# Bật tunnel tạm bằng một container MỚI (xoá container cũ trước — nhật ký cũ đi theo nó). Trả về mã thoát.
function Start-QuickTunnelFresh([object]$s) {
  $null = Get-CmdOutput 'docker' @('compose', '-p', $s.Project, '-f', $script:ComposeFile, '--profile', 'quicktunnel', 'rm', '-f', '-s', 'quicktunnel')
  return (Invoke-Compose $s @('--profile', 'quicktunnel', 'up', '-d', '--force-recreate', '--no-deps', 'quicktunnel'))
}

# ---- Phiên bản (vòng sửa 1 MP-2b, DEPLOY-VERSION-GAP) ----------------------------------------------------------------
# Mã nguồn trên máy này: git HEAD rút gọn 7 ký tự, thêm "+" khi có tệp đã sửa mà chưa commit. $null khi không có git.
function Get-RepoBuild {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $null }
  $r = Get-CmdOutput 'git' @('-C', $script:RepoDir, 'rev-parse', 'HEAD')
  if ($r.Code -ne 0) { return $null }
  $full = $r.Text.Trim()
  if ($full -notmatch '^[0-9a-f]{40}$') { return $null }
  $d = Get-CmdOutput 'git' @('-C', $script:RepoDir, 'status', '--porcelain', '--untracked-files=no')
  $dirty = ($d.Code -eq 0 -and $d.Text.Trim().Length -gt 0)
  $short = $full.Substring(0, 7)
  if ($dirty) { $short += '+' }
  return [pscustomobject]@{ Full = $full; Short = $short; Dirty = $dirty }
}

# Trang chơi bạn bè mở (GitHub Pages): version.json do .github/workflows/deploy-pages.yml ghi khi đưa bản lên.
function Get-PagesBuild([object]$s) {
  $base = 'https://tungtase04539.github.io/hp-world/'
  if ($env:HPMP_PAGES_URL) { $base = $env:HPMP_PAGES_URL } elseif ($s.Test) { return $null }
  if (-not $base.EndsWith('/')) { $base += '/' }
  try {
    $v = Invoke-RestMethod -Uri ($base + 'version.json?t=' + [DateTime]::UtcNow.Ticks) -TimeoutSec 8 -UseBasicParsing -Headers @{ 'Cache-Control' = 'no-cache' }
    if ($v -and $v.sha -match '^[0-9a-f]{7,40}$') { return [pscustomobject]@{ Ok = $true; Sha = [string]$v.sha; Url = $base } }
    return [pscustomobject]@{ Ok = $false; Sha = $null; Url = $base; Why = 'không đọc được' }
  } catch {
    $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -eq 404) { return [pscustomobject]@{ Ok = $false; Sha = $null; Url = $base; Why = 'bản cũ, chưa có version.json' } }
    return $null   # không có mạng / GitHub chậm: không kết luận gì
  }
}

# So 3 bản: mã trên máy ($repo), máy chủ đang chạy (/healthz "build"), trang chơi trên GitHub Pages. Trả về số cảnh báo.
function Test-BuildVersions([object]$s, [object]$health, [object]$repo) {
  $warn = 0
  if (-not $repo) { Write-Dong 'Không đọc được phiên bản mã nguồn (không có git) — bỏ qua so phiên bản.'; return 0 }
  $srv = $null; if ($health -and $health.build) { $srv = [string]$health.build }
  if ($srv -and $srv -ne $repo.Short) {
    Write-Canh ("Máy chủ đang chạy BẢN CŨ ({0}); mã trên máy là bản {1}. Để dùng bản mới: TRƯỚC buổi chơi chạy tat-may-chu.ps1 rồi mo-may-chu.ps1 (mọi người đang chơi bị ngắt ~10 giây)." -f $srv, $repo.Short)
    $warn++
  } elseif ($srv) { Write-Tot ("Máy chủ chạy đúng bản mã trên máy ({0})." -f $srv) }
  $pg = Get-PagesBuild $s
  if ($pg -and -not $pg.Ok) {
    Write-Canh ("Trang chơi của bạn bè ({0}) là {1} — nhờ lập trình viên ĐƯA BẢN MỚI LÊN GITHUB PAGES trước buổi chơi." -f $pg.Url, $pg.Why)
    $warn++
  } elseif ($pg) {
    $same = $repo.Full.StartsWith($pg.Sha) -or $pg.Sha.StartsWith($repo.Full)
    $ahead = $false
    if (-not $same) { $a = Get-CmdOutput 'git' @('-C', $script:RepoDir, 'merge-base', '--is-ancestor', $repo.Full, $pg.Sha); $ahead = ($a.Code -eq 0) }
    if ($same -or $ahead) { Write-Tot ("Trang chơi của bạn bè (GitHub Pages) có đủ bản này ({0})." -f $pg.Sha.Substring(0, 7)) }
    else {
      Write-Canh ("Trang chơi của bạn bè (GitHub Pages) là bản {0}, KHÁC mã trên máy ({1}) — nhờ lập trình viên đưa bản mới lên GitHub Pages trước buổi chơi." -f $pg.Sha.Substring(0, 7), $repo.Short)
      $warn++
    }
  }
  return $warn
}

# Địa chỉ tunnel tạm đã in lần trước (server/data, không commit) — để báo "ĐỊA CHỈ ĐÃ ĐỔI, gửi lại cho mọi người".
function Get-LastQuickUrlFile([object]$s) { return (Join-Path $script:ServerDir ("data\quicktunnel_{0}.txt" -f $s.Project)) }
function Get-LastQuickUrl([object]$s) {
  $f = Get-LastQuickUrlFile $s
  if (Test-Path -LiteralPath $f) { try { return ((Get-Content -LiteralPath $f -TotalCount 1).Trim()) } catch { } }
  return $null
}
function Set-LastQuickUrl([object]$s, [string]$url) {
  $f = Get-LastQuickUrlFile $s
  try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f) | Out-Null; Set-Content -LiteralPath $f -Value $url -Encoding ASCII } catch { }
}

function Get-ServiceState([object]$s) {
  $r = Get-CmdOutput 'docker' @('compose', '-p', $s.Project, '-f', $script:ComposeFile, '--profile', 'tunnel', '--profile', 'quicktunnel', '--profile', 'backup', 'ps', '-a', '--format', '{{.Service}}|{{.State}}|{{.Health}}|{{.Publishers}}')
  $h = @{}
  foreach ($line in ($r.Text -split "`r?`n")) {
    $p = $line.Split('|')
    if ($p.Count -lt 3 -or -not $p[0]) { continue }
    # một dịch vụ có thể có thêm container chạy-một-lần (docker compose run): giữ container đang chạy
    if ($h.ContainsKey($p[0]) -and $h[$p[0]].State -eq 'running') { continue }
    $h[$p[0]] = [pscustomobject]@{ State = $p[1]; Health = $p[2]; Raw = $line }
  }
  return $h
}

# Giữ máy thức: tiến trình nền giu-may-thuc.ps1 (SetThreadExecutionState). Bản thật còn chạm tệp đánh dấu mỗi phút.
function Start-KeepAwake([object]$s) {
  Stop-KeepAwake $s | Out-Null
  Set-Content -LiteralPath $s.AwakeRun -Value ("hpworld keep-awake {0} {1}" -f $s.Project, (Get-Date).ToString('s')) -Encoding ASCII
  $helper = Join-Path $script:OpsDir 'giu-may-thuc.ps1'
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ('"' + $helper + '"'), '-RunFile', ('"' + $s.AwakeRun + '"'))
  if (-not $s.Test) { $argList += @('-Marker', ('"' + $s.Marker + '"')) }
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $s.AwakePid -Value $p.Id -Encoding ASCII
  return $p.Id
}

function Get-KeepAwakeProcess([object]$s) {
  if (-not (Test-Path -LiteralPath $s.AwakePid)) { return $null }
  $id = 0
  try { $id = [int]((Get-Content -LiteralPath $s.AwakePid -TotalCount 1).Trim()) } catch { return $null }
  try { $p = Get-Process -Id $id -ErrorAction Stop; if ($p.ProcessName -match 'powershell') { return $p } } catch { }
  return $null
}

function Stop-KeepAwake([object]$s) {
  Remove-Item -LiteralPath $s.AwakeRun -Force -ErrorAction SilentlyContinue
  $p = Get-KeepAwakeProcess $s
  if ($p) {
    try { $p.WaitForExit(4000) | Out-Null } catch { }
    try { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction Stop } } catch { }
  }
  Remove-Item -LiteralPath $s.AwakePid -Force -ErrorAction SilentlyContinue
  return [bool]$p
}

function Get-LatestBackup {
  if (-not (Test-Path -LiteralPath $script:BackupDir)) { return $null }
  return Get-ChildItem -LiteralPath $script:BackupDir -Filter 'hp-*.dump' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

# Gửi cảnh báo Telegram nếu đã cấu hình (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID trong server/.env). Không lỗi nếu chưa có.
function Send-TelegramAlert([string]$text) {
  $e = Read-DotEnv
  if (-not $e['TELEGRAM_BOT_TOKEN'] -or -not $e['TELEGRAM_CHAT_ID']) { return $false }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $body = @{ chat_id = $e['TELEGRAM_CHAT_ID']; text = $text; disable_web_page_preview = $true } | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Method Post -Uri ('https://api.telegram.org/bot' + $e['TELEGRAM_BOT_TOKEN'] + '/sendMessage') -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 10 -UseBasicParsing | Out-Null
    return $true
  } catch { return $false }
}
