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

# Tìm địa chỉ tunnel tạm (https://xxx.trycloudflare.com) trong nhật ký container quicktunnel.
function Get-QuickTunnelUrl([object]$s) {
  $r = Get-CmdOutput 'docker' @('compose', '-p', $s.Project, '-f', $script:ComposeFile, '--profile', 'quicktunnel', 'logs', '--no-log-prefix', 'quicktunnel')
  $m = [regex]::Matches($r.Text, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($m.Count -gt 0) { return $m[$m.Count - 1].Value }
  return $null
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
