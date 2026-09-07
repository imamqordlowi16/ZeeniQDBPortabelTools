@echo off
setlocal enabledelayedexpansion
title Pasang Shortcut ZeenIQ Oracle Tools
echo ============================================================
echo   ZEENIQ ORACLE & DB TOOLS - PEMASANGAN SHORTCUT
echo ============================================================
echo.

set "TARGET_DIR=%~dp0"
set "TARGET_EXE=%TARGET_DIR%ZeenIQ-Oracle-Tools.exe"

if not exist "%TARGET_EXE%" (
    echo [ERROR] File %TARGET_EXE% tidak ditemukan!
    echo Pastikan file batch ini berada di dalam folder ZeenIQ-Oracle-Tools-Portable.
    pause
    exit /b 1
)

echo Membuat Shortcut di Desktop dan Start Menu...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desk = [Environment]::GetFolderPath('Desktop'); " ^
  "$scDesk = $ws.CreateShortcut((Join-Path $desk 'ZeenIQ Oracle Tools.lnk')); " ^
  "$scDesk.TargetPath = '%TARGET_EXE%'; " ^
  "$scDesk.WorkingDirectory = '%TARGET_DIR%'; " ^
  "$scDesk.Description = 'ZeenIQ Oracle & DB Backup Tools'; " ^
  "$scDesk.IconLocation = '%TARGET_EXE%,0'; " ^
  "$scDesk.Save(); " ^
  "$sm = [Environment]::GetFolderPath('Programs'); " ^
  "$scSm = $ws.CreateShortcut((Join-Path $sm 'ZeenIQ Oracle Tools.lnk')); " ^
  "$scSm.TargetPath = '%TARGET_EXE%'; " ^
  "$scSm.WorkingDirectory = '%TARGET_DIR%'; " ^
  "$scSm.Description = 'ZeenIQ Oracle & DB Backup Tools'; " ^
  "$scSm.IconLocation = '%TARGET_EXE%,0'; " ^
  "$scSm.Save(); "

if %errorlevel% equ 0 (
    echo.
    echo ============================================================
    echo [SUKSES] Shortcut berhasil dibuat!
    echo - Desktop: ZeenIQ Oracle Tools.lnk
    echo - Start Menu: ZeenIQ Oracle Tools
    echo.
    echo Anda sekarang dapat membuka aplikasi langsung dari Desktop!
    echo ============================================================
) else (
    echo.
    echo [PERINGATAN] Gagal membuat shortcut otomatis. Anda tetap dapat
    echo menjalankan aplikasi langsung dengan klik dua kali RUN-ZEENIQ.bat
)

echo.
pause
exit /b 0
