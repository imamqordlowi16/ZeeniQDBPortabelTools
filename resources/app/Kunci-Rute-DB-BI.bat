@echo off
:: =========================================================================
:: ZeenIQ - Dynamic Route Injector for DB 161 (10.161.10.135)
:: =========================================================================

:: Self-elevation to Administrator with /k
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Meminta izin Administrator...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/k \"\"%~dpnx0\"\"' -Verb RunAs"
    exit /b
)

title ZeenIQ - Dynamic Route Lock ke DB Bank Indonesia
color 0A
cls

echo =========================================================================
echo       ZeenIQ - INJEKSI RUTE DINAMIS DATABASE BANK INDONESIA (10.161)
echo =========================================================================
echo.

echo [1/4] Mendeteksi Kartu Wi-Fi dan Gateway Aktif secara Otomatis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $wifi = Get-NetIPConfiguration | Where-Object { ($_.InterfaceAlias -like '*Wi-Fi*' -or $_.InterfaceAlias -like '*WLAN*') -and $_.IPv4DefaultGateway } | Select-Object -First 1; if ($wifi) { $gw = $wifi.IPv4DefaultGateway.NextHop; $idx = $wifi.InterfaceIndex; $name = $wifi.InterfaceAlias; Write-Host \"  [OK] Wi-Fi Terdeteksi : $name (Interface Index: $idx)\" -ForegroundColor Cyan; Write-Host \"  [OK] Gateway Aktif     : $gw\" -ForegroundColor Green; route delete 10.161.10.135 | Out-Null; route delete 10.161.0.0 | Out-Null; route delete 10.161.10.135 10.149.0.1 | Out-Null; route delete 10.161.0.0 10.149.0.1 | Out-Null; route delete 10.161.10.135 $gw | Out-Null; route delete 10.161.0.0 $gw | Out-Null; route add 10.161.10.135 mask 255.255.255.255 $gw metric 1 if $idx; route add 10.161.0.0 mask 255.255.0.0 $gw metric 1 if $idx; route -p add 10.161.10.135 mask 255.255.255.255 $gw metric 1 if $idx; route -p add 10.161.0.0 mask 255.255.0.0 $gw metric 1 if $idx; Set-NetIPInterface -InterfaceIndex $idx -InterfaceMetric 25 -ErrorAction SilentlyContinue; } else { Write-Host '  [!] Wi-Fi aktif tidak ditemukan. Pastikan terhubung ke WLAN-NON-CORP.' -ForegroundColor Red; } }"

echo.
echo [2/4] Memeriksa Jalur Aktif untuk IP 10.161.10.135...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $r = Find-NetRoute -RemoteIPAddress 10.161.10.135 -ErrorAction SilentlyContinue | Select-Object -First 1; if ($r) { Write-Host \"  -> Interface : $($r.InterfaceAlias)\" -ForegroundColor Green; Write-Host \"  -> NextHop   : $($r.NextHop)\" -ForegroundColor Green; Write-Host \"  -> Metric    : $($r.RouteMetric)\" -ForegroundColor Green; } }"

echo.
echo [3/4] Melakukan Test Koneksi Port Oracle 1521 ke 10.161.10.135...
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $t = Test-NetConnection -ComputerName 10.161.10.135 -Port 1521; if ($t.TcpTestSucceeded) { Write-Host '  [SUCCESS] Port 1521 TERHUBUNG! DB BI SIAP DIGUNAKAN!' -ForegroundColor Green; } else { Write-Host \"  -> TcpTestSucceeded : $($t.TcpTestSucceeded)\" -ForegroundColor Yellow; Write-Host \"  -> SourceAddress    : $($t.SourceAddress)\" -ForegroundColor Cyan; } }"

echo.
echo =========================================================================
echo SELESAI!
echo Sekarang kembali ke ZeenIQ Oracle Tools dan klik 'Test PRD Connection'!
echo =========================================================================
echo.
pause
