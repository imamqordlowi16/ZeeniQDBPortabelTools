# =========================================================================
# ZeenIQ Oracle Tools - Sangfor to Sandbox Bridge Relay
# =========================================================================

param(
    [int]$Relay1Port = 1522,
    [string]$Relay1Target = "10.28.224.62:1521",
    [int]$Relay2Port = 1523,
    [string]$Relay2Target = "10.28.224.125:1522",
    [switch]$NoPause
)

# Ensure Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    if (-not $env:ZEENIQ_NONINTERACTIVE) {
        Write-Host "[*] Meminta izin Administrator..." -ForegroundColor Yellow
        $scriptPath = $MyInvocation.MyCommand.Path
        if (-not $scriptPath) { $scriptPath = $PSCommandPath }
        try {
            Start-Process powershell.exe -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`"" -Verb RunAs
            exit
        } catch {}
    } else {
        Write-Host "[!] Script dijalankan dalam mode non-elevated. Pastikan ZeenIQ dijalankan sebagai Administrator jika perintah netsh memerlukan hak akses admin." -ForegroundColor Yellow
    }
}

try {
    $Host.UI.RawUI.WindowTitle = "ZeenIQ - Sangfor to Sandbox Port Relay Manager"
} catch {}

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

# Parse Target Host & Port
$target1Parts = $Relay1Target.Split(':')
$target1Host = if ($target1Parts.Length -gt 0 -and $target1Parts[0].Trim()) { $target1Parts[0].Trim() } else { "10.28.224.62" }
$target1ConnectPort = if ($target1Parts.Length -gt 1 -and [int]::TryParse($target1Parts[1].Trim(), [ref]$null)) { [int]$target1Parts[1].Trim() } else { 1521 }

$target2Parts = $Relay2Target.Split(':')
$target2Host = if ($target2Parts.Length -gt 0 -and $target2Parts[0].Trim()) { $target2Parts[0].Trim() } else { "10.28.224.125" }
$target2ConnectPort = if ($target2Parts.Length -gt 1 -and [int]::TryParse($target2Parts[1].Trim(), [ref]$null)) { [int]$target2Parts[1].Trim() } else { 1522 }

# 3. Tambahkan Portproxy Relay di Windows Host
Write-Host "[2/3] Mengaktifkan Port Forwarding:" -ForegroundColor Cyan
Write-Host ("  -> Relay 1: Listen Port " + $Relay1Port + " ==> Connect to " + $target1Host + ":" + $target1ConnectPort) -ForegroundColor Cyan
Write-Host ("  -> Relay 2: Listen Port " + $Relay2Port + " ==> Connect to " + $target2Host + ":" + $target2ConnectPort) -ForegroundColor Cyan

# DB 1 Relay
netsh interface portproxy delete v4tov4 listenport=$Relay1Port listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$Relay1Port listenaddress=0.0.0.0 connectport=$target1ConnectPort connectaddress=$target1Host | Out-Null

# DB 2 Relay
netsh interface portproxy delete v4tov4 listenport=$Relay2Port listenaddress=0.0.0.0 | Out-Null
netsh interface portproxy add v4tov4 listenport=$Relay2Port listenaddress=0.0.0.0 connectport=$target2ConnectPort connectaddress=$target2Host | Out-Null

# Allow Firewall
netsh advfirewall firewall delete rule name="ZeenIQ_Relay_$Relay1Port" | Out-Null
netsh advfirewall firewall add rule name="ZeenIQ_Relay_$Relay1Port" dir=in action=allow protocol=TCP localport=$Relay1Port | Out-Null
netsh advfirewall firewall delete rule name="ZeenIQ_Relay_$Relay2Port" | Out-Null
netsh advfirewall firewall add rule name="ZeenIQ_Relay_$Relay2Port" dir=in action=allow protocol=TCP localport=$Relay2Port | Out-Null
Write-Host "  [+] Port Relay $Relay1Port & $Relay2Port aktif dan diizinkan oleh Windows Firewall." -ForegroundColor Green

# 4. Tampilkan Status Portproxy
Write-Host ""
Write-Host "[3/3] Tabel Port Forwarding Aktif di Host:" -ForegroundColor Cyan
netsh interface portproxy show all

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "SUKSES! Relay Jaringan Siap Digunakan di Dalam Windows Sandbox:" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Di dalam ZeenIQ (Windows Sandbox / DBeaver), gunakan konfigurasi berikut:" -ForegroundColor Yellow
Write-Host "  🟢 DB 1 Relay : Host = $vSwitchIp | Port = $Relay1Port" -ForegroundColor White
Write-Host "  🟢 DB 2 Relay : Host = $vSwitchIp | Port = $Relay2Port" -ForegroundColor White
Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

if (-not $NoPause -and -not $env:ZEENIQ_NONINTERACTIVE) {
    Write-Host "Tekan tombol ENTER untuk menutup..." -ForegroundColor Yellow
    try { Read-Host } catch {}
}
