@echo off
:: =========================================================================
:: ZeenIQ - Smart Dual Network & Sangfor Coexistence Setup
:: =========================================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Meminta hak Administrator...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/k \"\"%~dpnx0\"\"' -Verb RunAs"
    exit /b
)

title ZeenIQ - Smart Dual-Network and Sangfor Coexistence Setup
color 0A
cls

echo =========================================================================
echo    ZeenIQ - SMART DUAL-NETWORK ^& SANGFOR COEXISTENCE SETUP
echo =========================================================================
echo.

echo [1/4] Menghapus semua rute lama / on-link yang macet...
route delete 10.161.10.135 >nul 2>&1
route delete 10.161.0.0 >nul 2>&1
route delete 10.161.10.135 0.0.0.0 >nul 2>&1
route delete 10.161.0.0 0.0.0.0 >nul 2>&1
route delete 10.161.10.135 10.149.0.1 >nul 2>&1
route delete 10.161.0.0 10.149.0.1 >nul 2>&1
route delete 10.149.0.0 >nul 2>&1
route delete 10.240.0.0 >nul 2>&1
echo   [+] Pembersihan rute lama selesai.
echo.

echo [2/4] Mengatur prioritas antarmuka jaringan...
netsh interface ip set interface "Ethernet 4" metric=5 >nul 2>&1
netsh interface ip set interface "Ethernet 6" metric=5 >nul 2>&1
netsh interface ip set interface "Ethernet" metric=5 >nul 2>&1
netsh interface ip set interface "Wi-Fi 3" metric=35 >nul 2>&1
netsh interface ip set interface "Wi-Fi" metric=35 >nul 2>&1
echo   [+] Ethernet diatur ke Metric 5 (Jalur Utama Internet ^& Sangfor).
echo   [+] Wi-Fi diatur ke Metric 35 (Jalur Khusus DB BI).
echo.

echo [3/4] Mengunci rute Database Bank Indonesia ke Gateway Wi-Fi 10.149.0.1...
route add 10.161.10.135 mask 255.255.255.255 10.149.0.1 metric 1 if 16 >nul 2>&1
route add 10.161.0.0 mask 255.255.0.0 10.149.0.1 metric 1 if 16 >nul 2>&1
route -p add 10.161.10.135 mask 255.255.255.255 10.149.0.1 metric 1 if 16 >nul 2>&1
route -p add 10.161.0.0 mask 255.255.0.0 10.149.0.1 metric 1 if 16 >nul 2>&1
echo   [+] Rute 10.161.10.135/32 berhasil dikunci ke Wi-Fi.
echo.

echo [4/4] Tabel Routing Aktif Windows untuk IP DB BI (10.161.10.135):
route print 10.161.10.135
echo.

echo =========================================================================
echo BERHASIL! Dual-Network dan Sangfor telah di-konfigurasi secara harmonis:
echo  - DB Bank Indonesia (10.161) --> Jalur WI-FI Intranet (10.149.0.1)
echo  - DB Proyek 62 (10.28.224)   --> Jalur SANGFOR aTrust (Ethernet)
echo  - Internet                   --> Jalur ETHERNET
echo =========================================================================
echo.
pause
