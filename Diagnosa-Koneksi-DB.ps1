# =========================================================================
# ZeenIQ - Diagnostic Tool for Database Connectivity & Routing
# =========================================================================

param(
    [string]$TargetHost = "10.161.10.135",
    [int]$TargetPort = 1521,
    [switch]$NoPause
)

try {
    $Host.UI.RawUI.WindowTitle = "ZeenIQ - Network & Route Diagnostic"
} catch {}

Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "         DIAGNOSA RUTE & KONEKSI KE DATABASE ($TargetHost : $TargetPort)" -ForegroundColor Cyan
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Mengecek Jalur Routing Windows untuk IP $TargetHost..." -ForegroundColor Yellow
$route = Find-NetRoute -RemoteIPAddress $TargetHost -ErrorAction SilentlyContinue | Select-Object -First 1
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

Write-Host "[4/4] Test Koneksi TCP Port $TargetPort ke ${TargetHost}:" -ForegroundColor Yellow
$tcp = Test-NetConnection -ComputerName $TargetHost -Port $TargetPort -InformationLevel Detailed
Write-Host "  -> TcpTestSucceeded : $($tcp.TcpTestSucceeded)" -ForegroundColor $(if ($tcp.TcpTestSucceeded) { "Green" } else { "Red" })
Write-Host "  -> SourceAddress    : $($tcp.SourceAddress)" -ForegroundColor Cyan
if ($tcp.PingReplyDetails) {
    Write-Host "  -> RoundTripTime    : $($tcp.PingReplyDetails.RoundTripTime) ms" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "Hasil diagnosa selesai." -ForegroundColor Yellow
Write-Host ""

if (-not $NoPause -and -not $env:ZEENIQ_NONINTERACTIVE) {
    Write-Host "Tekan tombol ENTER untuk menutup..." -ForegroundColor Yellow
    try { Read-Host } catch {}
}
