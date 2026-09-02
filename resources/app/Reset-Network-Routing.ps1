# =========================================================================
# ZeenIQ Oracle Tools - Reset Network Routing to Defaults
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
    $Host.UI.RawUI.WindowTitle = "ZeenIQ Tools - Reset Network Routing"
} catch {}
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Yellow
Write-Host "      ZeenIQ Oracle Tools - Reset Network Routing to Defaults" -ForegroundColor Yellow
Write-Host "=========================================================================" -ForegroundColor Yellow
Write-Host ""

$ErrorActionPreference = "SilentlyContinue"

Write-Host "[1/2] Mengembalikan metric interface ke Automatic..." -ForegroundColor Cyan
Set-NetIPInterface -InterfaceAlias "Ethernet*" -AutomaticMetric Enabled -ErrorAction SilentlyContinue
Set-NetIPInterface -InterfaceAlias "Wi-Fi*" -AutomaticMetric Enabled -ErrorAction SilentlyContinue
Set-NetIPInterface -InterfaceAlias "*aTrust*" -AutomaticMetric Enabled -ErrorAction SilentlyContinue
Set-NetIPInterface -InterfaceAlias "*Sangfor*" -AutomaticMetric Enabled -ErrorAction SilentlyContinue

Write-Host "[2/2] Menghapus static route khusus..." -ForegroundColor Cyan
route delete 10.0.0.0 | Out-Null
route delete 10.161.0.0 | Out-Null
route delete 10.161.10.135 | Out-Null
route delete 10.149.0.0 | Out-Null
route delete 10.240.0.0 | Out-Null
route delete 10.28.224.62 | Out-Null
route delete 10.28.0.0 | Out-Null

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "BERHASIL! Default Windows network routing telah dipulihkan." -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tekan tombol ENTER untuk menutup jendela ini..." -ForegroundColor Yellow
Read-Host
