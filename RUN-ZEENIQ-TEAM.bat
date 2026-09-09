@echo off
cd /d "%~dp0"
if exist "%~dp0ZeenIQ-Oracle-Tools-VIP.exe" (
    start "" "%~dp0ZeenIQ-Oracle-Tools-VIP.exe"
) else if exist "%~dp0ZeenIQ-Oracle-Tools-VIP.exe" (
    start "" "%~dp0ZeenIQ-Oracle-Tools-VIP.exe"
) else if exist "%~dp0ZeenIQ-Oracle-Tools.exe" (
    start "" "%~dp0ZeenIQ-Oracle-Tools.exe"
) else (
    start "" "%~dp0electron.exe"
)
