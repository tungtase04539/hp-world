@echo off
rem Nhap dup = TAO 8 MA MOI dung trong 3 ngay cho buoi choi thu (VAN_HANH.md muc 16.2 buoc 2).
rem Vong sua 1 MP-2b (OPS-NONPROGRAMMER-STEP1): nhap phai "Run with PowerShell" khong truyen duoc tham so, file nay thi duoc.
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tao-ma-moi.ps1" -SoLuong 8 -SoNgay 3 -GhiChu "choi thu"
echo.
pause
