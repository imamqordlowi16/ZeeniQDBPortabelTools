@echo off
title ZeenIQ Oracle & Database Tools - Web Edition
color 0b

echo.
echo  ==================================================================
echo     ZeenIQ Oracle & Database Tools - Standalone Web Server
echo  ==================================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo  [ERROR] Node.js tidak ditemukan di sistem ini!
  echo  Silakan pasang Node.js dari https://nodejs.org terlebih dahulu.
  echo.
  pause
  exit /b 1
)

:: Ensure dist directory exists
if not exist "dist\index.html" (
  echo  [INFO] Mengompilasi frontend bundle untuk pertama kali...
  call npm run build
  if %errorlevel% neq 0 (
    echo  [ERROR] Kompilasi web gagal!
    pause
    exit /b 1
  )
)

echo  [INFO] Menjalankan ZeenIQ Web Server di port 3000...
echo  Browser Anda akan otomatis terbuka...
echo.

node server.js --open --port=3000

pause
