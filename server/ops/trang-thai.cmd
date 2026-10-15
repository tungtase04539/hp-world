@echo off
rem Nhap dup = XEM TINH TRANG may chu (so nguoi choi, dia chi link tam, phien ban, an toan).
rem Vong sua 1 MP-2b (OPS-NONPROGRAMMER-STEP1): nhap phai "Run with PowerShell" khong truyen duoc tham so, file nay thi duoc.
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0trang-thai.ps1"
echo.
pause
