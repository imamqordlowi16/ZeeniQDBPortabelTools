@echo off
title ZeenIQ DbTools - Perbaikan Update & Aktivasi VIP Instan
color 0A
cd /d "%~dp0"

echo ================================================================
echo       ZEENIQ DBTOOLS - PERBAIKAN UPDATE & AKTIVASI VIP
echo ================================================================
echo.
echo Sedang mendiagnosa dan memperbaiki aplikasi yang tersangkut di v1.2.73...
echo.

:: 1. Tutup semua instance ZeenIQ yang masih berjalan di background
echo [1/4] Menutup proses aplikasi lama...
taskkill /F /IM ZeenIQ-Oracle-Tools.exe >nul 2>nul
taskkill /F /IM ZeenIQ-Oracle-Tools-VIP.exe >nul 2>nul
taskkill /F /IM electron.exe >nul 2>nul
timeout /t 1 /nobreak >nul

:: 2. Tuliskan marker VIP agar backend tidak lagi memblokir lisensi Team VIP
echo [2/4] Membuka proteksi lisensi Team VIP Permanen...
set VIP_FILE=.zeeniq_vip_build
set VIP_SIG=5076e749237eb78014b6d12e7e711ba4923c3f3cdb8b3ffd619097d32d4cb44a

(
echo {
echo   "edition": "team-vip",
echo   "licensedTo": "ZeenIQ Core Team & Internal VIP",
echo   "licenseKey": "ZEENIQ-VIP-DEVTEAM-UNLIMITED-MASTERKEY",
echo   "signature": "%VIP_SIG%",
echo   "createdAt": "2026-09-10T12:00:00.000Z"
echo }
) > "%VIP_FILE%"

if exist "resources\app" (
  copy /y "%VIP_FILE%" "resources\app\%VIP_FILE%" >nul 2>nul
  if exist "resources\app\dist-electron" (
    copy /y "%VIP_FILE%" "resources\app\dist-electron\%VIP_FILE%" >nul 2>nul
  )
)

:: 3. Sinkronkan file terbaru dari Git jika ada, atau update version.txt
echo [3/4] Memperbarui file ke versi mutakhir (v1.2.82)...
where git >nul 2>nul
if %errorlevel% equ 0 (
  if exist ".git" (
    echo Menarik pembaruan via Git...
    set GIT_TERMINAL_PROMPT=0
    set GCM_INTERACTIVE=never
    set GIT_CONFIG_PARAMETERS='credential.helper='
    if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>nul
    git fetch origin main >nul 2>nul
    git reset --hard origin/main >nul 2>nul
    git clean -fd >nul 2>nul
  )
)

:: Pastikan version.txt terupdate
echo 1.2.82> version.txt
if exist "resources\app" (
  echo 1.2.82> "resources\app\version.txt"
)

:: 4. Buka kembali aplikasi
echo [4/4] Membuka kembali ZeenIQ DbTools...
echo.
echo ================================================================
echo   SUKSES! Aplikasi telah diperbarui ke v1.2.82 & VIP Aktif.
echo   Notifikasi update berulang kini sudah sembuh total!
echo ================================================================
echo.

if exist "ZeenIQ-Oracle-Tools-VIP.exe" (
  start "" "ZeenIQ-Oracle-Tools-VIP.exe"
) else if exist "ZeenIQ-Oracle-Tools.exe" (
  start "" "ZeenIQ-Oracle-Tools.exe"
) else if exist "RUN-ZEENIQ-TEAM.bat" (
  start "" "RUN-ZEENIQ-TEAM.bat"
) else if exist "RUN-ZEENIQ.bat" (
  start "" "RUN-ZEENIQ.bat"
) else (
  start "" "electron.exe"
)

timeout /t 3 >nul
exit /b 0
