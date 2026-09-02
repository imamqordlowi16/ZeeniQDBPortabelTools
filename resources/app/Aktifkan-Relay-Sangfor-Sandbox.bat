@echo off
title ZeenIQ - Sangfor to Sandbox Port Relay
color 0A

:: 1. Request Admin Privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [*] Meminta hak Administrator...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/k \"\"%~dpnx0\"\"' -Verb RunAs"
    exit /b
)

cls
echo =========================================================================
echo      ZeenIQ - JEMBATAN RELAY PORT SANGFOR KE WINDOWS SANDBOX
echo =========================================================================
echo.

echo [1/3] Memastikan Service IP Helper Aktif...
sc config iphlpsvc start= auto >nul 2>&1
net start iphlpsvc >nul 2>&1

echo [2/3] Mengaktifkan Port Forwarding untuk DB 62 dan DB 125...
:: Relay untuk DB 62 (Port 1522 -> 10.28.224.62:1521)
netsh interface portproxy delete v4tov4 listenport=1522 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy add v4tov4 listenport=1522 listenaddress=0.0.0.0 connectport=1521 connectaddress=10.28.224.62

:: Relay untuk DB 125 (Port 1523 -> 10.28.224.125:1522)
netsh interface portproxy delete v4tov4 listenport=1523 listenaddress=0.0.0.0 >nul 2>&1
netsh interface portproxy add v4tov4 listenport=1523 listenaddress=0.0.0.0 connectport=1522 connectaddress=10.28.224.125

netsh advfirewall firewall delete rule name="ZeenIQ_Relay_1522" >nul 2>&1
netsh advfirewall firewall add rule name="ZeenIQ_Relay_1522" dir=in action=allow protocol=TCP localport=1522 >nul 2>&1
netsh advfirewall firewall delete rule name="ZeenIQ_Relay_1523" >nul 2>&1
netsh advfirewall firewall add rule name="ZeenIQ_Relay_1523" dir=in action=allow protocol=TCP localport=1523 >nul 2>&1
echo   [+] Port 1522 terhubung ke DB 62 (10.28.224.62:1521) [AKTIF]
echo   [+] Port 1523 terhubung ke DB 125 (10.28.224.125:1522) [AKTIF]
echo.

echo [3/3] Mendeteksi IP Gateway Virtual Switch Hyper-V...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $ip = (Get-NetIPAddress -InterfaceAlias '*vEthernet*' -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress; if (-not $ip) { $ip = '172.29.160.1' }; Write-Host \"  -> IP Host Gateway untuk Sandbox : $ip\" -ForegroundColor Green; }"
echo.

echo =========================================================================
echo BERHASIL! Port Relay Siap Digunakan di Dalam Windows Sandbox:
echo =========================================================================
echo.
echo Di dalam ZeenIQ (Windows Sandbox):
echo   - DB 1 (Bank Indonesia)  : Host = 10.161.10.135    ^| Port = 1521
echo   - DB 2 (Sangfor DB 62)   : Host = 172.29.160.1     ^| Port = 1522  (Service: XEPDB1, User: system)
echo   - DB 3 (Sangfor DB 125)  : Host = 172.29.160.1     ^| Port = 1523  (Service: sss.corp.bi.go.id / XEPDB1)
echo.
echo =========================================================================
echo Tekan tombol apa saja untuk menutup jendela ini...
pause >nul
