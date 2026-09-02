@echo off
title ZeenIQ Oracle Backup & Sync Studio
echo ========================================================
echo   Launching ZeenIQ Oracle Tools Desktop Application...
echo ========================================================
echo.

cd /d "%~dp0"

IF NOT EXIST "node_modules" (
    echo [INFO] First-time setup: Installing dependencies...
    call npm install
)

echo [INFO] Building application bundle...
call npm run build

echo [INFO] Starting ZeenIQ Oracle Tools Desktop Application...
call npm start

pause
