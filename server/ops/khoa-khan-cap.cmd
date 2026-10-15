@echo off
rem Nhap dup = NGAT KHAN CAP duong vao tu Internet (du lieu giu nguyen).
rem Vong sua 1 MP-2b (OPS-NONPROGRAMMER-STEP1): nhap phai "Run with PowerShell" khong truyen duoc tham so, file nay thi duoc.
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0khoa-khan-cap.ps1"
echo.
pause
