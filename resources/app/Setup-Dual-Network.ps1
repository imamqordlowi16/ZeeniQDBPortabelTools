# =========================================================================
# ZeenIQ Oracle Tools - Smart Dual Network & Sangfor Coexistence Setup
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
    $Host.UI.RawUI.WindowTitle = "ZeenIQ Tools - Smart Dual-Network & Sangfor Routing Setup"
} catch {}
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "      ZeenIQ Oracle Tools - Smart Dual-Network & Sangfor Coexistence" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "SilentlyContinue"

# 1. Bersihkan rute lama
Write-Host "[1/6] Membersihkan tabel rute lama..." -ForegroundColor Cyan
route delete 10.161.0.0 | Out-Null
route delete 10.161.10.135 | Out-Null
route delete 10.149.0.0 | Out-Null
route delete 10.240.0.0 | Out-Null
route delete 10.28.224.62 | Out-Null
route delete 10.28.0.0 | Out-Null
Remove-NetRoute -DestinationPrefix "10.161.0.0/16" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Remove-NetRoute -DestinationPrefix "10.161.10.135/32" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Remove-NetRoute -DestinationPrefix "10.28.224.62/32" -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
Write-Host "  [+] Pembersihan tabel routing selesai." -ForegroundColor Green

# 2. Deteksi Adapters
Write-Host "[2/6] Mendeteksi Kartu Jaringan (Wi-Fi, Ethernet, Sangfor)..." -ForegroundColor Cyan
$wifi = (Get-NetIPConfiguration | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" -or $_.InterfaceAlias -like "*Wireless*" -or $_.InterfaceAlias -like "*WLAN*" } | Select-Object -First 1)
$gw = $null
if ($wifi -and $wifi.IPv4DefaultGateway) {
    $gw = $wifi.IPv4DefaultGateway.NextHop
}
$wifiIfIndex = $null
$wifiName = "Wi-Fi"
if ($wifi) {
    $wifiIfIndex = $wifi.InterfaceIndex
    $wifiName = $wifi.InterfaceAlias
}

# 3. Atur Metrik Interface
Write-Host "[3/6] Mengatur Metrik Prioritas Interface..." -ForegroundColor Cyan
Get-NetAdapter | Where-Object { ($_.Name -like "*Ethernet*" -or $_.InterfaceDescription -like "*NDIS*" -or $_.InterfaceDescription -like "*Ethernet*") -and $_.Status -eq "Up" } | ForEach-Object {
    Set-NetIPInterface -InterfaceIndex $_.InterfaceIndex -InterfaceMetric 5 -ErrorAction SilentlyContinue
    Write-Host "  [+] Ethernet ($($_.Name)) diatur ke Metric 5 (JALUR UTAMA INTERNET & SANGFOR)" -ForegroundColor Green
}
if ($wifiIfIndex) {
    Set-NetIPInterface -InterfaceIndex $wifiIfIndex -InterfaceMetric 35 -ErrorAction SilentlyContinue
    Write-Host "  [+] Wi-Fi ($wifiName) diatur ke Metric 35 (Default route tidak mencaplok internet)" -ForegroundColor Green
}
$atrust = Get-NetAdapter | Where-Object { $_.Name -like "*aTrust*" -or $_.InterfaceDescription -like "*Sangfor*" -or $_.InterfaceDescription -like "*aTrust*" } | Select-Object -First 1
if ($atrust) {
    Set-NetIPInterface -InterfaceIndex $atrust.InterfaceIndex -InterfaceMetric 150 -ErrorAction SilentlyContinue
    Write-Host "  [+] Sangfor aTrust ($($atrust.Name)) diatur ke Metric 150 (Tidak mencaplok 10.161.x.x)" -ForegroundColor Green
}

# 4. Daftarkan Rute Presisi ke Wi-Fi (WLAN-NON-CORP)
Write-Host "[4/6] Mengunci Rute Database Bank Indonesia ke Kartu Wi-Fi..." -ForegroundColor Cyan
if ($gw -and $wifiIfIndex) {
    Write-Host "  [+] Gateway Wi-Fi: $gw (Interface Index: $wifiIfIndex)" -ForegroundColor Green
    route -p add 10.161.10.135 mask 255.255.255.255 $gw IF $wifiIfIndex metric 1 | Out-Null
    route -p add 10.161.0.0 mask 255.255.0.0 $gw IF $wifiIfIndex metric 1 | Out-Null
    route -p add 10.149.0.0 mask 255.255.0.0 $gw IF $wifiIfIndex metric 1 | Out-Null
    route -p add 10.240.0.0 mask 255.255.0.0 $gw IF $wifiIfIndex metric 1 | Out-Null
    
    New-NetRoute -InterfaceIndex $wifiIfIndex -DestinationPrefix "10.161.10.135/32" -NextHop $gw -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Out-Null
    New-NetRoute -InterfaceIndex $wifiIfIndex -DestinationPrefix "10.161.0.0/16" -NextHop $gw -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Out-Null
    Write-Host "  [+] Rute 10.161.10.135/32 dan 10.161.0.0/16 berhasil dikunci ke Wi-Fi." -ForegroundColor Green
} elseif ($wifiIfIndex) {
    Write-Host "  [+] Mengikat rute langsung ke Interface Wi-Fi (IF $wifiIfIndex)..." -ForegroundColor Yellow
    route -p add 10.161.10.135 mask 255.255.255.255 0.0.0.0 IF $wifiIfIndex metric 1 | Out-Null
    route -p add 10.161.0.0 mask 255.255.0.0 0.0.0.0 IF $wifiIfIndex metric 1 | Out-Null
} else {
    Write-Host "  [!] Wi-Fi tidak terdeteksi. Pastikan Wi-Fi menyala dan terhubung ke WLAN-NON-CORP." -ForegroundColor Red
}

# 5. Rute DB 62 ke Sangfor
Write-Host "[5/6] Mengunci Rute DB Proyek 62 ke Sangfor aTrust..." -ForegroundColor Cyan
if ($atrust -and $atrust.Status -eq "Up") {
    $atrustIpConfig = Get-NetIPConfiguration -InterfaceIndex $atrust.InterfaceIndex -ErrorAction SilentlyContinue
    $atrustGw = $atrustIpConfig.IPv4DefaultGateway.NextHop
    if ($atrustGw) {
        route -p add 10.28.224.62 mask 255.255.255.255 $atrustGw IF $atrust.InterfaceIndex metric 1 | Out-Null
        route -p add 10.28.0.0 mask 255.255.0.0 $atrustGw IF $atrust.InterfaceIndex metric 1 | Out-Null
        New-NetRoute -InterfaceIndex $atrust.InterfaceIndex -DestinationPrefix "10.28.224.62/32" -NextHop $atrustGw -RouteMetric 1 -PolicyStore ActiveStore -ErrorAction SilentlyContinue | Out-Null
    } else {
        route -p add 10.28.224.62 mask 255.255.255.255 0.0.0.0 IF $atrust.InterfaceIndex metric 1 | Out-Null
        route -p add 10.28.0.0 mask 255.255.0.0 0.0.0.0 IF $atrust.InterfaceIndex metric 1 | Out-Null
    }
    Write-Host "  [+] DB Proyek (10.28.224.62) terkunci khusus via Sangfor ($($atrust.Name))." -ForegroundColor Green
} else {
    Write-Host "  [*] Sangfor aTrust standby / belum terhubung." -ForegroundColor Gray
}

# 6. Flush DNS & Mapping hosts
Write-Host "[6/6] Mendaftarkan Hostname DNS & Membersihkan Socket Cache..." -ForegroundColor Cyan
$hostsPath = "$env:windir\System32\drivers\etc\hosts"
$hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
if ($hostsContent -notmatch "dc1sssdb002") {
    [System.IO.File]::AppendAllText($hostsPath, [Environment]::NewLine + "10.161.10.135  dc1sssdb002.corp.bi.go.id  dc1sssdbo02.corp.bi.go.id  sss.corp.bi.go.id")
    Write-Host "  [+] Mapping DNS dc1sssdb002 -> 10.161.10.135 berhasil didaftarkan ke hosts." -ForegroundColor Green
} else {
    Write-Host "  [+] Mapping DNS Bank Indonesia sudah aktif di hosts." -ForegroundColor Green
}
ipconfig /flushdns | Out-Null
Write-Host "  [+] DNS Cache dibersihkan." -ForegroundColor Green

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "BERHASIL! Dual-Network dan Sangfor telah di-konfigurasi secara harmonis:" -ForegroundColor Green
Write-Host " - Internet & Sandbox        --> Jalur ETHERNET (Metric 20)" -ForegroundColor White
Write-Host " - DB Bank Indonesia (10.161)--> Jalur WI-FI (WLAN-NON-CORP) (Metric 2/1)" -ForegroundColor White
Write-Host " - DB Proyek 62 (10.28.224)  --> Jalur SANGFOR aTrust (Metric 150/1)" -ForegroundColor White
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Pengaturan selesai. Anda dapat menutup jendela ini kapan saja." -ForegroundColor Green
Write-Host "Tekan tombol ENTER untuk menutup jendela ini..." -ForegroundColor Yellow
Read-Host
