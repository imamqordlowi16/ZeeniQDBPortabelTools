# =========================================================================
# ZeenIQ - Perfect Route Injector for DB 161 (10.161.10.135)
# =========================================================================

# Ensure Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[*] Meminta izin Administrator..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    if (-not $scriptPath) { $scriptPath = $PSCommandPath }
    Start-Process powershell.exe -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs
    exit
}

try {
    $Host.UI.RawUI.WindowTitle = "ZeenIQ - Force Route DB 161 to Wi-Fi Gateway"
} catch {}
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "   ZeenIQ - FORCE INJECT ROUTE DB 161 KE GATEWAY WI-FI (10.149.0.1)" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "SilentlyContinue"

# 1. Cari Kartu Wi-Fi Fisik
$wifiAdapter = Get-NetAdapter | Where-Object { ($_.Name -like "*Wi-Fi*" -or $_.Name -like "*WLAN*" -or $_.InterfaceDescription -like "*Wireless*" -or $_.InterfaceDescription -like "*Wi-Fi*") -and $_.Status -eq "Up" } | Select-Object -First 1

if (-not $wifiAdapter) {
    Write-Host "[!] Kartu Wi-Fi aktif tidak ditemukan. Pastikan Wi-Fi terhubung ke WLAN-NON-CORP." -ForegroundColor Red
    Write-Host "Tekan Enter untuk keluar..."
    Read-Host
    exit
}

$wifiIndex = $wifiAdapter.InterfaceIndex
$wifiName = $wifiAdapter.Name

# Deteksi Gateway Dinamis Wi-Fi
$gw = (Get-NetIPConfiguration | Where-Object { $_.InterfaceIndex -eq $wifiIndex -and $_.IPv4DefaultGateway }).IPv4DefaultGateway.NextHop
if (-not $gw) {
    $gw = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" -InterfaceIndex $wifiIndex -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
}
if (-not $gw) {
    $gw = "10.149.192.1"
}

Write-Host "[1/5] Kartu Wi-Fi Terdeteksi: $wifiName (Index: $wifiIndex)" -ForegroundColor Cyan
Write-Host "  -> Dynamic Gateway Terdeteksi : $gw" -ForegroundColor Green

# 2. HAPUS TOTAL SEMUA RUTE LAMA / ON-LINK / REGISTRY YANG KADALUARSA
Write-Host "[2/5] Membersihkan semua rute lama..." -ForegroundColor Cyan
route delete 10.161.10.135 | Out-Null
route delete 10.161.0.0 | Out-Null
route delete 10.161.10.135 0.0.0.0 | Out-Null
route delete 10.161.0.0 0.0.0.0 | Out-Null
route delete 10.161.10.135 10.149.0.1 | Out-Null
route delete 10.161.0.0 10.149.0.1 | Out-Null
route delete 10.161.10.135 $gw | Out-Null
route delete 10.161.0.0 $gw | Out-Null
Remove-NetRoute -DestinationPrefix "10.161.10.135/32" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Remove-NetRoute -DestinationPrefix "10.161.0.0/16" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null

$regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\PersistentRoutes"
if (Test-Path $regPath) {
    Get-ItemProperty -Path $regPath | Get-Member -MemberType NoteProperty | Where-Object { $_.Name -like "10.161*" } | ForEach-Object {
        Remove-ItemProperty -Path $regPath -Name $_.Name -ErrorAction SilentlyContinue
    }
}
Write-Host "  [+] Pembersihan tuntas." -ForegroundColor Green

# 3. SET METRIC WI-FI
Write-Host "[3/6] Mengatur Metrik Interface $wifiName..." -ForegroundColor Cyan
Set-NetIPInterface -InterfaceIndex $wifiIndex -InterfaceMetric 35 -ErrorAction SilentlyContinue | Out-Null
Write-Host "  [+] Metric Interface $wifiName diatur ke 35 (Internet tetap lewat Ethernet/Tethering)." -ForegroundColor Green

# 4. INJECT RUTE DENGAN NEXTHOP WAJIB GATEWAY AKTIF
Write-Host "[4/6] Menginjeksi Rute Baru DB BI dengan Gateway Nyata $gw..." -ForegroundColor Cyan
route add 10.161.10.135 mask 255.255.255.255 $gw metric 1 if $wifiIndex | Out-Null
route add 10.161.0.0 mask 255.255.0.0 $gw metric 1 if $wifiIndex | Out-Null
route -p add 10.161.10.135 mask 255.255.255.255 $gw metric 1 if $wifiIndex | Out-Null
route -p add 10.161.0.0 mask 255.255.0.0 $gw metric 1 if $wifiIndex | Out-Null
New-NetRoute -InterfaceIndex $wifiIndex -DestinationPrefix "10.161.10.135/32" -NextHop $gw -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Out-Null
New-NetRoute -InterfaceIndex $wifiIndex -DestinationPrefix "10.161.0.0/16" -NextHop $gw -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Out-Null
Write-Host "  [+] Rute presisi 10.161.10.135/32 berhasil disuntikkan ke Gateway $gw." -ForegroundColor Green
Write-Host "  [+] Rute presisi 10.161.10.135/32 berhasil disuntikkan ke Wi-Fi ($wifiName)." -ForegroundColor Green

# 5. TEST KONEKSI TCP PORT 1521
Write-Host "[5/5] Memverifikasi Jalur dan Test Handshake Oracle Port 1521..." -ForegroundColor Cyan
$routeCheck = Find-NetRoute -RemoteIPAddress 10.161.10.135 | Select-Object -First 1
$actualAdapter = Get-NetAdapter -InterfaceIndex $routeCheck.InterfaceIndex -ErrorAction SilentlyContinue
Write-Host "  -> Rute Terverifikasi : $($actualAdapter.Name) -> NextHop: $($routeCheck.NextHop)" -ForegroundColor Green

$tcp = Test-NetConnection -ComputerName 10.161.10.135 -Port 1521 -InformationLevel Detailed
if ($tcp.TcpTestSucceeded) {
    Write-Host ""
    Write-Host "=========================================================================" -ForegroundColor Green
    Write-Host "SUKSES BESAR! DB 161 (10.161.10.135:1521) SUDAH TERHUBUNG DAN HIJAU!" -ForegroundColor Green
    Write-Host "  -> TcpTestSucceeded : TRUE" -ForegroundColor Green
    Write-Host "=========================================================================" -ForegroundColor Green
    Write-Host "Sekarang buka ZeenIQ Oracle Tools dan klik Test Connection pada kedua DB!" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "  -> TcpTestSucceeded : $($tcp.TcpTestSucceeded)" -ForegroundColor Yellow
    Write-Host "  -> NextHop Aktif    : $($routeCheck.NextHop)" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Tekan tombol ENTER untuk menutup jendela ini..." -ForegroundColor Yellow
Read-Host
