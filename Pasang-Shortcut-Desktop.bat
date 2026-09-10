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
(
  echo Set oWS = WScript.CreateObject("WScript.Shell"^)
  echo sDesk = oWS.SpecialFolders("Desktop"^)
  echo Set oLink = oWS.CreateShortcut(sDesk ^& "\ZeenIQ Oracle Tools.lnk"^)
  echo oLink.TargetPath = "%TARGET_EXE%"
  echo oLink.WorkingDirectory = "%TARGET_DIR%"
  echo oLink.Description = "ZeenIQ Oracle & DB Backup Tools"
  echo oLink.Save
  echo sProgs = oWS.SpecialFolders("Programs"^)
  echo Set oLink2 = oWS.CreateShortcut(sProgs ^& "\ZeenIQ Oracle Tools.lnk"^)
  echo oLink2.TargetPath = "%TARGET_EXE%"
  echo oLink2.WorkingDirectory = "%TARGET_DIR%"
  echo oLink2.Description = "ZeenIQ Oracle & DB Backup Tools"
  echo oLink2.Save
) > "%TEMP%\_znq_sc.vbs"
cscript //nologo "%TEMP%\_znq_sc.vbs"
set SC_ERR=%ERRORLEVEL%
del "%TEMP%\_znq_sc.vbs" >nul 2>&1

if %SC_ERR% equ 0 (
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
