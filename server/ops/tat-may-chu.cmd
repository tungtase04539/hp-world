@echo off
rem Nhap dup = TAT MAY CHU (du lieu giu nguyen; link tam chet luon).
rem Vong sua 1 MP-2b (OPS-NONPROGRAMMER-STEP1): nhap phai "Run with PowerShell" khong truyen duoc tham so, file nay thi duoc.
chcp 65001 >nul
cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tat-may-chu.ps1"
echo.
pause
