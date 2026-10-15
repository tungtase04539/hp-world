@echo off
rem Nhap dup = MO MAY CHU voi duong link TAM (*.trycloudflare.com) cho buoi choi thu (VAN_HANH.md muc 16.2).
rem Vong sua 1 MP-2b (OPS-NONPROGRAMMER-STEP1): nhap phai "Run with PowerShell" khong truyen duoc tham so, file nay thi duoc.
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mo-may-chu.ps1" -TamThoi
echo.
pause
