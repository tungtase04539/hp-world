# server/ops/tao-ma-moi.ps1 — TẠO MÃ MỜI cho người chơi thử (thử nghiệm kín: không có mã thì không tạo được tài khoản).
#   powershell -ExecutionPolicy Bypass -File server\ops\tao-ma-moi.ps1 -SoLuong 10
#   ... -SoLanDung 1     mỗi mã dùng được mấy lần (mặc định 1 = một người)
#   ... -SoNgay 14       mã hết hạn sau bao nhiêu ngày (mặc định 14)
#   ... -GhiChu "nhom ban be"   ghi chú để sau này nhớ đã phát cho ai
#   ... -TestMode        (lập trình viên) bản thử
# Gọi API trang quản trị trên chính máy này (http://127.0.0.1:9101) bằng ADMIN_TOKEN trong server\.env.
# Danh sách mã được in ra màn hình và lưu vào server\data\ma-moi\ (chỉ trên máy này; KHÔNG đăng công khai).
# Cũng có thể tạo mã trên trang quản trị (nút "Tạo mã mời").
param(
  [ValidateRange(1, 500)][int]$SoLuong = 10,
  [ValidateRange(1, 1000)][int]$SoLanDung = 1,
  [ValidateRange(1, 365)][int]$SoNgay = 14,
  [string]$GhiChu = '',
  [switch]$TestMode
)
. "$PSScriptRoot\chung.ps1"
$s = Get-HpSettings -TestMode:$TestMode
Write-Host ''
Write-Host '=== TẠO MÃ MỜI ===' -ForegroundColor White
$envv = Read-DotEnv
if (-not $envv['ADMIN_TOKEN']) { Write-Loi 'Không thấy ADMIN_TOKEN trong server\.env (chạy mo-may-chu.ps1 trước).'; exit 1 }
$h = Get-Health $s.AdminUrl 3
if (-not $h) { Write-Loi 'Máy chủ chưa mở (trang quản trị không trả lời). Chạy mo-may-chu.ps1 trước.'; exit 1 }

$body = @{ count = $SoLuong; uses = $SoLanDung; days = $SoNgay; note = $GhiChu } | ConvertTo-Json -Compress
$headers = @{ Authorization = ('Bearer ' + $envv['ADMIN_TOKEN']) }
try {
  $res = Invoke-RestMethod -Method Post -Uri ($s.AdminUrl + '/admin/api/invites') -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 15 -UseBasicParsing
} catch {
  $code = 0; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
  if ($code -eq 404 -or $code -eq 501) { Write-Loi 'Phiên bản máy chủ này chưa có chức năng tạo mã mời qua API (POST /admin/api/invites). Dùng trang quản trị.' }
  elseif ($code -eq 401 -or $code -eq 403) { Write-Loi 'Trang quản trị từ chối (sai ADMIN_TOKEN?).' }
  else { Write-Loi ('Không tạo được mã: ' + $_.Exception.Message) }
  exit 1
}
$codes = @()
if ($res.codes) { $codes = @($res.codes) } elseif ($res.invites) { $codes = @($res.invites | ForEach-Object { if ($_.code) { $_.code } else { $_ } }) }
if ($codes.Count -eq 0) { Write-Loi 'Máy chủ không trả về mã nào.'; exit 1 }
$dir = Join-Path $script:ServerDir 'data\ma-moi'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ('ma-moi-' + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.txt')
$lines = @("# Mã mời Hải Phòng 3D — tạo lúc $((Get-Date).ToString('s')), mỗi mã dùng $SoLanDung lần, hết hạn sau $SoNgay ngày. Ghi chú: $GhiChu") + $codes
[System.IO.File]::WriteAllLines($file, $lines, (New-Object System.Text.UTF8Encoding($true)))
Write-Tot ("Đã tạo {0} mã (dùng {1} lần, hết hạn sau {2} ngày):" -f $codes.Count, $SoLanDung, $SoNgay)
foreach ($c in $codes) { Write-Host ('      ' + $c) -ForegroundColor Green }
Write-Dong ('Đã lưu vào ' + $file)
Write-Canh 'Gửi riêng từng mã cho từng người. KHÔNG đăng mã lên nhóm công khai.'
exit 0
