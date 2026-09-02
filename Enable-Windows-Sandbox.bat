@echo off
:: =========================================================================
:: ZeenIQ Oracle Tools - Windows Sandbox Universal Installer / Enabler
:: Supports Windows 10 & Windows 11 (Pro, Enterprise, Education, and Home)
:: =========================================================================

title ZeenIQ Tools - Windows Sandbox Installer
color 0B

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Requesting Administrator Privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo =========================================================================
echo       ZeenIQ Oracle Tools - Windows Sandbox Auto-Enabler
echo =========================================================================
echo.
echo [1/4] Checking Hardware Virtualization (Intel VT-x / AMD-V in BIOS)...
powershell -Command "$v = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled; if ($v) { Write-Host '  [OK] CPU Hardware Virtualization is ENABLED in BIOS' -ForegroundColor Green } else { Write-Host '  [CRITICAL WARNING] CPU Virtualization is DISABLED in BIOS/UEFI.' -ForegroundColor Red; Write-Host '  => Windows Sandbox requires Intel VT-x / AMD-V enabled in your laptop BIOS.' -ForegroundColor Yellow; Write-Host '  => Please restart PC, enter BIOS (F2/F10/Del/F12), and Enable Intel Virtualization Technology (VT-x).' -ForegroundColor Yellow }"

echo.
echo [2/4] Enabling Virtual Machine Platform and Hyper-V...
echo   Activating VirtualMachinePlatform (please wait, do not close)...
dism /online /Enable-Feature /FeatureName:"VirtualMachinePlatform" /All /NoRestart
echo   Activating Hyper-V (please wait, do not close)...
dism /online /Enable-Feature /FeatureName:"Microsoft-Hyper-V-All" /All /NoRestart

echo.
echo [3/4] Enabling Windows Sandbox Feature (Containers-DisposableClientVM)...
echo   Activating Containers-DisposableClientVM...
dism /online /Enable-Feature /FeatureName:"Containers-DisposableClientVM" /All /NoRestart

if %errorLevel% equ 0 (
    echo   [OK] Standard Windows Sandbox feature enabled successfully!
) else (
    echo   [INFO] Standard feature not found. Installing Windows Sandbox packages for Windows Home Edition...
    dir /b %SystemRoot%\servicing\Packages\*Containers*.mum > "%TEMP%\sandbox.txt" 2>nul
    for /f %%i in ('findstr /i . "%TEMP%\sandbox.txt" 2^>nul') do (
        echo   Installing package: %%i
        dism /online /norestart /add-package:"%SystemRoot%\servicing\Packages\%%i"
    )
    del "%TEMP%\sandbox.txt" >nul 2>&1
    dism /online /enable-feature /featurename:Containers-DisposableClientVM /LimitAccess /ALL /norestart
)

echo.
echo [4/4] Verifying Windows Sandbox Executable...
if exist "%SystemRoot%\System32\WindowsSandbox.exe" (
    echo   [SUCCESS] WindowsSandbox.exe found at %SystemRoot%\System32\WindowsSandbox.exe!
) else if exist "%SystemRoot%\Sysnative\WindowsSandbox.exe" (
    echo   [SUCCESS] WindowsSandbox.exe found at %SystemRoot%\Sysnative\WindowsSandbox.exe!
) else (
    echo   [NOTICE] Feature registered. Windows Sandbox will be ready after BIOS VT-x is enabled and PC is restarted.
)

echo.
echo =========================================================================
echo Installation complete! 
echo IMPORTANT: 
echo 1. If CPU Virtualization in BIOS is False, ENABLE Intel VT-x in BIOS first!
echo 2. You MUST RESTART your computer once for changes to take effect.
echo =========================================================================
echo.
set /p REBOOT="Do you want to restart your computer now? (Y/N, default N): "
if /i "%REBOOT%"=="Y" (
    echo Restarting Windows in 5 seconds...
    shutdown /r /t 5
) else (
    echo You can restart your computer later when you are ready.
)
pause
