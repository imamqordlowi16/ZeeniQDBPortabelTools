# =========================================================================
# ZeenIQ - Diagnostic Tool for DB 161 (10.161.10.135)
# =========================================================================

$Host.UI.RawUI.WindowTitle = "ZeenIQ - Network & Route Diagnostic"
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "         DIAGNOSA RUTE & KONEKSI KE DATABASE BANK INDONESIA (10.161)" -ForegroundColor Cyan
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Mengecek Jalur Routing Windows untuk IP 10.161.10.135..." -ForegroundColor Yellow
$route = Find-NetRoute -RemoteIPAddress 10.161.10.135 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($route) {
    $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
    Write-Host "  -> Dikirim lewat Interface : $($adapter.Name) ($($adapter.InterfaceDescription))" -ForegroundColor Green
    Write-Host "  -> NextHop / Gateway       : $($route.NextHop)" -ForegroundColor Green
    Write-Host "  -> Metric Jalur            : $($route.RouteMetric)" -ForegroundColor Green
} else {
    Write-Host "  [!] Rute tidak ditemukan secara spesifik!" -ForegroundColor Red
}

Write-Host ""
Write-Host "[2/4] Daftar Semua Interface & Metrik Aktif:" -ForegroundColor Yellow
Get-NetIPInterface -AddressFamily IPv4 | Where-Object { $_.ConnectionState -eq "Connected" } | Format-Table InterfaceAlias, InterfaceIndex, InterfaceMetric, AutomaticMetric -AutoSize

Write-Host "[3/4] Rute Khusus untuk IP 10.x.x.x:" -ForegroundColor Yellow
Get-NetRoute -DestinationPrefix "10*" -AddressFamily IPv4 -ErrorAction SilentlyContinue | Format-Table DestinationPrefix, NextHop, RouteMetric, InterfaceAlias -AutoSize

Write-Host "[4/4] Test Koneksi TCP Port 1521 ke 10.161.10.135:" -ForegroundColor Yellow
$tcp = Test-NetConnection -ComputerName 10.161.10.135 -Port 1521 -InformationLevel Detailed
Write-Host "  -> TcpTestSucceeded : $($tcp.TcpTestSucceeded)" -ForegroundColor $(if ($tcp.TcpTestSucceeded) { "Green" } else { "Red" })
Write-Host "  -> SourceAddress    : $($tcp.SourceAddress)" -ForegroundColor Cyan
Write-Host "  -> RoundTripTime    : $($tcp.PingReplyDetails.RoundTripTime) ms" -ForegroundColor Cyan

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "Hasil diagnosa selesai. Silakan foto atau salin hasil di atas." -ForegroundColor Yellow
Write-Host "Tekan tombol ENTER untuk menutup..." -ForegroundColor Yellow
Read-Host
