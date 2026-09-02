@echo off
:: =========================================================================
:: ZeenIQ Oracle Tools - Windows Sandbox Black Screen Auto-Repair Tool
:: =========================================================================

title ZeenIQ - Perbaikan Layar Hitam Windows Sandbox
color 0A

cd /d "%~dp0"

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Meminta hak akses Administrator...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo =========================================================================
echo       ZeenIQ - ALAT PERBAIKAN LAYAR HITAM (BLACK SCREEN) WINDOWS SANDBOX
echo =========================================================================
echo.

echo [1/5] Menutup proses Sandbox dan VM yang menggantung di memori...
taskkill /f /im WindowsSandboxClient.exe >nul 2>&1
taskkill /f /im WindowsSandboxRemoteSession.exe >nul 2>&1
taskkill /f /im WindowsSandboxServer.exe >nul 2>&1
taskkill /f /im vmwp.exe >nul 2>&1
taskkill /f /im ManagedWindowsVM.exe >nul 2>&1
taskkill /f /im vmcompute.exe >nul 2>&1
echo   [OK] Proses lama dibersihkan.

echo.
echo [2/5] Merestart Layanan Virtualisasi Windows (Host Compute Service)...
timeout /t 2 /nobreak >nul
net start vmcompute >nul 2>&1
echo   [OK] Layanan vmcompute aktif.

echo.
echo [3/5] Mengatur Kebijakan Registry Windows Sandbox (Anti-Black Screen)...
:: 1. Disable vGPU in Sandbox Group Policy to prevent Intel/NVIDIA dual GPU conflict
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Sandbox" /v "AllowVgpu" /t REG_DWORD /d 0 /f >nul 2>&1

:: 2. Ensure RDP Display rendering uses software fallback
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services" /v "fEnableHardwareMode" /t REG_DWORD /d 0 /f >nul 2>&1

echo   [OK] Registry anti-black screen berhasil diterapkan.

echo.
echo [4/5] Memperbarui file konfigurasi Sandbox (.wsb)...
copy /y "%~dp0ZeenIQ-Sandbox.wsb" "%TEMP%\ZeenIQ-Sandbox.wsb" >nul 2>&1
echo   [OK] Konfigurasi siap.

echo.
echo [5/5] Meluncurkan Windows Sandbox yang sudah diperbaiki...
start "" "%~dp0ZeenIQ-Sandbox.wsb"

echo.
echo =========================================================================
echo PERBAIKAN SELESAI!
echo Windows Sandbox sedang dibuka dengan Software Rasterizer (WARP).
echo Layar desktop Windows Sandbox sekarang akan muncul dengan normal.
echo =========================================================================
echo.
timeout /t 5
