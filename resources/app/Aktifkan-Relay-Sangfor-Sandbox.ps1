# =========================================================================
# ZeenIQ Oracle Tools - Sangfor to Sandbox Bridge Relay
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
    $Host.UI.RawUI.WindowTitle = "ZeenIQ - Sangfor to Sandbox Port Relay Manager"
} catch {}
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "      ZeenIQ - JEMBATAN RELAY PORT SANGFOR KE WINDOWS SANDBOX" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

# 1. Pastikan Layanan IP Helper Aktif
Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue
Start-Service iphlpsvc -ErrorAction SilentlyContinue

# 2. Deteksi IP Host pada vSwitch Hyper-V Sandbox
$vSwitchIp = (Get-NetIPAddress -InterfaceAlias "*vEthernet*" -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
if (-not $vSwitchIp) {
    $vSwitchIp = (Get-NetIPAddress -InterfaceAlias "*Default Switch*" -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
}
if (-not $vSwitchIp) {
    $vSwitchIp = "172.29.160.1"
}

Write-Host "[1/3] IP Host Gateway untuk Sandbox terdeteksi: $vSwitchIp" -ForegroundColor Cyan

# 3. Tambahkan Portproxy Relay di Windows Host
Write-Host "[2/3] Mengaktifkan Port Forwarding untuk DB 62 dan DB 125..." -ForegroundColor Cyan

# DB 62 (Port 1522 -> 10.28.224.62:1521)
netsh interface portproxy delete v4tov4 listenport=1522 listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=1522 listenaddress=0.0.0.0 connectport=1521 connectaddress=10.28.224.62 | Out-Null

# DB 125 (Port 1523 -> 10.28.224.125:1522)
netsh interface portproxy delete v4tov4 listenport=1523 listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=1523 listenaddress=0.0.0.0 connectport=1522 connectaddress=10.28.224.125 | Out-Null

# Allow Firewall
netsh advfirewall firewall delete rule name="ZeenIQ_Relay_1522" | Out-Null
netsh advfirewall firewall add rule name="ZeenIQ_Relay_1522" dir=in action=allow protocol=TCP localport=1522 | Out-Null
netsh advfirewall firewall delete rule name="ZeenIQ_Relay_1523" | Out-Null
netsh advfirewall firewall add rule name="ZeenIQ_Relay_1523" dir=in action=allow protocol=TCP localport=1523 | Out-Null
Write-Host "  [+] Port Relay 1522 & 1523 aktif dan diizinkan oleh Windows Firewall." -ForegroundColor Green

# 4. Tampilkan Status Portproxy
Write-Host ""
Write-Host "[3/3] Tabel Port Forwarding Aktif di Host:" -ForegroundColor Cyan
netsh interface portproxy show all

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "SUKSES! Relay Jaringan Siap Digunakan di Dalam Windows Sandbox:" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Di dalam ZeenIQ (Windows Sandbox), gunakan konfigurasi berikut:" -ForegroundColor Yellow
Write-Host "  🔴 DB 1 (Bank Indonesia) : Host = 10.161.10.135    | Port = 1521 (Service: sss.corp.bi.go.id, User: SSS)" -ForegroundColor White
Write-Host "  🟢 DB 2 (Sangfor DB 62)  : Host = $vSwitchIp     | Port = 1522 (Service: XEPDB1, User: system)" -ForegroundColor White
Write-Host "  🟢 DB 3 (Sangfor DB 125) : Host = $vSwitchIp     | Port = 1523 (Service: SSSSTAGING / XEPDB1)" -ForegroundColor White
Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tekan tombol ENTER untuk menutup..." -ForegroundColor Yellow
Read-Host
