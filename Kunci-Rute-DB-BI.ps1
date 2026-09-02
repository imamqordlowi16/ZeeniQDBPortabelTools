# =========================================================================
# ZeenIQ - Perfect Route Injector for DB
# =========================================================================

param(
    [string]$TargetIP = "10.161.10.135",
    [string]$Gateway = "",
    [switch]$NoPause
)

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
    $Host.UI.RawUI.WindowTitle = "ZeenIQ - Force Route DB to Wi-Fi Gateway"
} catch {}

Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "   ZeenIQ - FORCE INJECT ROUTE DB $TargetIP KE GATEWAY WI-FI" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "SilentlyContinue"

# 1. Cari Kartu Wi-Fi Fisik
$wifiAdapter = Get-NetAdapter | Where-Object { ($_.Name -like "*Wi-Fi*" -or $_.Name -like "*WLAN*" -or $_.InterfaceDescription -like "*Wireless*" -or $_.InterfaceDescription -like "*Wi-Fi*") -and $_.Status -eq "Up" } | Select-Object -First 1

if (-not $wifiAdapter) {
    Write-Host "[!] Kartu Wi-Fi aktif tidak ditemukan. Pastikan Wi-Fi terhubung." -ForegroundColor Red
    if (-not $NoPause -and -not $env:ZEENIQ_NONINTERACTIVE) {
        Write-Host "Tekan Enter untuk keluar..."
        try { Read-Host } catch {}
    }
    exit 1
}

$wifiIndex = $wifiAdapter.InterfaceIndex
$wifiName = $wifiAdapter.Name

# Deteksi Gateway Dinamis Wi-Fi jika tidak diinput manual
$gw = $Gateway
if (-not $gw -or -not $gw.Trim()) {
    $gw = (Get-NetIPConfiguration | Where-Object { $_.InterfaceIndex -eq $wifiIndex -and $_.IPv4DefaultGateway }).IPv4DefaultGateway.NextHop
    if (-not $gw) {
        $gw = (Get-NetRoute -DestinationPrefix "0.0.0.0/0" -InterfaceIndex $wifiIndex -ErrorAction SilentlyContinue | Select-Object -First 1).NextHop
    }
    if (-not $gw) {
        $gw = "10.149.192.1"
    }
}

Write-Host "[1/4] Kartu Wi-Fi Terdeteksi: $wifiName (Index: $wifiIndex)" -ForegroundColor Cyan
Write-Host "  -> Gateway Digunakan : $gw" -ForegroundColor Green

# 2. HAPUS RUTE LAMA
Write-Host "[2/4] Membersihkan rute lama untuk $TargetIP..." -ForegroundColor Cyan
route delete $TargetIP | Out-Null
route delete "$TargetIP" 0.0.0.0 | Out-Null
route delete "$TargetIP" "$gw" | Out-Null

# 3. INJEK RUTE BARU METRIC 1
Write-Host "[3/4] Menginjeksi rute langsung ke $TargetIP via $gw..." -ForegroundColor Cyan
route add $TargetIP mask 255.255.255.255 $gw metric 1 if $wifiIndex | Out-Null

# 4. Uji Koneksi TCP
Write-Host "[4/4] Menguji koneksi TCP ke $TargetIP:1521..." -ForegroundColor Cyan
$tcp = Test-NetConnection -ComputerName $TargetIP -Port 1521 -InformationLevel Detailed
if ($tcp.TcpTestSucceeded) {
    Write-Host "  [+] SUKSES! Database $TargetIP dapat dijangkau lewat adapter Wi-Fi!" -ForegroundColor Green
} else {
    Write-Host "  [!] Rute telah dipasang, namun port 1521 belum merespons." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

if (-not $NoPause -and -not $env:ZEENIQ_NONINTERACTIVE) {
    Write-Host "Tekan tombol ENTER untuk menutup..." -ForegroundColor Yellow
    try { Read-Host } catch {}
}
