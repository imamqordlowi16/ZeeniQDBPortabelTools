"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkService = void 0;
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const net_1 = __importDefault(require("net"));
const electron_1 = require("electron");
class NetworkService {
    rootDir;
    constructor() {
        if (electron_1.app && electron_1.app.isPackaged) {
            this.rootDir = path_1.default.dirname(process.execPath);
        }
        else {
            this.rootDir = path_1.default.resolve(__dirname, '..', '..');
        }
    }
    /**
     * Scan network interfaces using PowerShell
     */
    async getNetworkInterfaces() {
        return new Promise((resolve) => {
            const psCommand = `Get-NetIPConfiguration | ForEach-Object {
        $adapter = $_.InterfaceAlias
        $ipv4 = ($_.IPv4Address | Select-Object -First 1).IPAddress
        $gw = ($_.IPv4DefaultGateway | Select-Object -First 1).NextHop
        $intf = Get-NetIPInterface -InterfaceAlias $adapter -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
        [PSCustomObject]@{
          Alias = $adapter
          IP = $ipv4
          Gateway = $gw
          Metric = $intf.InterfaceMetric
          Status = $intf.ConnectionState
        }
      } | ConvertTo-Json -Compress`;
            (0, child_process_1.exec)(`powershell -NoProfile -Command "${psCommand.replace(/\n/g, ' ')}"`, (err, stdout) => {
                if (err || !stdout.trim()) {
                    // Fallback to os.networkInterfaces()
                    const interfaces = os_1.default.networkInterfaces();
                    const list = [];
                    for (const [name, addrs] of Object.entries(interfaces)) {
                        const ipv4 = addrs?.find((a) => a.family === 'IPv4' && !a.internal);
                        if (ipv4) {
                            const isWifi = name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wireless') || name.toLowerCase().includes('wlan');
                            const isEth = name.toLowerCase().includes('ethernet') || name.toLowerCase().includes('eth') || name.toLowerCase().includes('lan');
                            list.push({
                                name,
                                alias: name,
                                ip: ipv4.address,
                                status: 'Up',
                                type: isWifi ? 'Wi-Fi' : isEth ? 'Ethernet' : 'Other',
                            });
                        }
                    }
                    return resolve(list);
                }
                try {
                    const parsed = JSON.parse(stdout.trim());
                    const items = Array.isArray(parsed) ? parsed : [parsed];
                    const result = items
                        .filter((item) => item.IP)
                        .map((item) => {
                        const alias = item.Alias || '';
                        const isWifi = alias.toLowerCase().includes('wi-fi') || alias.toLowerCase().includes('wireless') || alias.toLowerCase().includes('wlan');
                        const isEth = alias.toLowerCase().includes('ethernet') || alias.toLowerCase().includes('eth') || alias.toLowerCase().includes('lan');
                        return {
                            name: alias,
                            alias,
                            ip: item.IP || '',
                            gateway: item.Gateway || undefined,
                            metric: typeof item.Metric === 'number' ? item.Metric : undefined,
                            status: item.Status === 'Connected' || item.Status === 1 ? 'Up' : 'Down',
                            type: isWifi ? 'Wi-Fi' : isEth ? 'Ethernet' : 'Other',
                        };
                    });
                    resolve(result);
                }
                catch (e) {
                    resolve([]);
                }
            });
        });
    }
    /**
     * Test TCP Reachability of host:port
     */
    async testTcpReachability(host, port = 1521, timeoutMs = 3000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const socket = new net_1.default.Socket();
            socket.setTimeout(timeoutMs);
            socket.connect(port, host, () => {
                const latency = Date.now() - startTime;
                socket.destroy();
                resolve({ reachable: true, latencyMs: latency });
            });
            socket.on('error', (err) => {
                socket.destroy();
                resolve({ reachable: false, error: err.message || 'Connection refused or unreachable' });
            });
            socket.on('timeout', () => {
                socket.destroy();
                resolve({ reachable: false, error: 'Connection timed out' });
            });
        });
    }
    /**
     * Scan VPN status (specifically Sangfor IDaaS / aTrust / EasyConnect)
     */
    async getVpnStatus() {
        return new Promise((resolve) => {
            const psCmd = `$adapters = Get-NetAdapter | Select-Object Name, InterfaceDescription, Status; $procs = Get-Process | Where-Object { $_.ProcessName -like '*atrust*' -or $_.ProcessName -like '*sangfor*' -or $_.ProcessName -like '*easyconnect*' } | Select-Object ProcessName -First 1; [PSCustomObject]@{ Adapters = $adapters; Process = if ($procs) { $procs.ProcessName } else { $null } } | ConvertTo-Json -Compress`;
            (0, child_process_1.exec)(`powershell -NoProfile -Command "${psCmd}"`, (err, stdout) => {
                if (err || !stdout.trim()) {
                    return resolve(undefined);
                }
                try {
                    const parsed = JSON.parse(stdout.trim());
                    const adapters = Array.isArray(parsed.Adapters) ? parsed.Adapters : parsed.Adapters ? [parsed.Adapters] : [];
                    const procName = parsed.Process;
                    // Look for Sangfor / aTrust / VPN adapter
                    const vpnAdapter = adapters.find((a) => {
                        const name = (a.Name || '').toLowerCase();
                        const desc = (a.InterfaceDescription || '').toLowerCase();
                        return name.includes('sangfor') || name.includes('atrust') || name.includes('easyconnect') || name.includes('vpn') ||
                            desc.includes('sangfor') || desc.includes('atrust') || desc.includes('easyconnect') || desc.includes('tap-windows');
                    });
                    if (vpnAdapter || procName) {
                        const name = vpnAdapter?.Name || 'Sangfor aTrust';
                        const desc = vpnAdapter?.InterfaceDescription || 'Sangfor aTrust Tunnel';
                        const isSangfor = (name + desc + (procName || '')).toLowerCase().includes('sangfor') ||
                            (name + desc + (procName || '')).toLowerCase().includes('atrust') ||
                            (name + desc + (procName || '')).toLowerCase().includes('easyconnect');
                        const isConnected = vpnAdapter?.Status === 'Up';
                        return resolve({
                            name,
                            alias: name,
                            description: desc,
                            isSangfor,
                            isConnected,
                            processRunning: Boolean(procName),
                            processName: procName || undefined,
                        });
                    }
                    resolve(undefined);
                }
                catch (e) {
                    resolve(undefined);
                }
            });
        });
    }
    /**
     * Run full diagnostics for Corp DB & Internet & VPN
     */
    async runDiagnostics(corpHost = 'dc1sssdbo02.corp.bi.go.id') {
        const [interfaces, vpn, corpRes, internetRes] = await Promise.all([
            this.getNetworkInterfaces(),
            this.getVpnStatus(),
            this.testTcpReachability(corpHost, 1521, 3500),
            this.testTcpReachability('8.8.8.8', 53, 3000),
        ]);
        const wifi = interfaces.find((i) => i.type === 'Wi-Fi');
        const ethernet = interfaces.find((i) => i.type === 'Ethernet');
        return {
            ethernet,
            wifi,
            vpn,
            corpHost,
            corpReachable: corpRes.reachable,
            corpLatencyMs: corpRes.latencyMs,
            corpError: corpRes.error,
            internetReachable: internetRes.reachable,
            internetLatencyMs: internetRes.latencyMs,
            allInterfaces: interfaces,
        };
    }
    /**
     * Generate Dual-Network batch scripts (Setup & Reset)
     */
    generateDualNetworkScripts(config) {
        const corpSubnet = config.corpHostOrSubnet.trim() || '10.161.0.0';
        const mask = config.corpMask.trim() || '255.255.0.0';
        const wifiGw = config.wifiGateway ? config.wifiGateway.trim() : '';
        const setupPs1 = `# =========================================================================
# ZeenIQ Oracle Tools - Smart Dual Network & Sangfor Coexistence Setup
# =========================================================================

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[*] Meminta izin Administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File \`"$PSCommandPath\`"" -Verb RunAs
    exit
}

$Host.UI.RawUI.WindowTitle = "ZeenIQ Tools - Smart Dual-Network & Sangfor Routing Setup"
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "      ZeenIQ Oracle Tools - Smart Dual-Network & Sangfor Coexistence" -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""

$ErrorActionPreference = "SilentlyContinue"

# 1. Bersihkan rute lama agar tidak terjadi conflict
Write-Host "[1/6] Membersihkan rute lama agar tidak terjadi conflict..." -ForegroundColor Cyan
route delete ${corpSubnet} | Out-Null
route delete 10.161.0.0 | Out-Null
route delete 10.161.10.135 | Out-Null
route delete 10.149.0.0 | Out-Null
route delete 10.240.0.0 | Out-Null
route delete 10.28.224.62 | Out-Null
route delete 10.28.0.0 | Out-Null
Write-Host "  [+] Pembersihan tabel routing selesai." -ForegroundColor Green

Write-Host "[2/6] Mengatur Metrik Prioritas Interface..." -ForegroundColor Cyan
Set-NetIPInterface -InterfaceAlias "*Wi-Fi*" -InterfaceMetric 5
Set-NetIPInterface -InterfaceAlias "*Wireless*" -InterfaceMetric 5
Set-NetIPInterface -InterfaceAlias "*WLAN*" -InterfaceMetric 5
Set-NetIPInterface -InterfaceAlias "Ethernet*" -InterfaceMetric ${config.ethernetMetric || 10}
Set-NetIPInterface -InterfaceAlias "*aTrust*" -InterfaceMetric 100
Set-NetIPInterface -InterfaceAlias "*Sangfor*" -InterfaceMetric 100
Write-Host "  [+] Metrik: Wi-Fi (5) > Ethernet (${config.ethernetMetric || 10}) > Sangfor aTrust (100)" -ForegroundColor Green

Write-Host "[3/6] Mengunci Rute Database Bank Indonesia ke Kartu Wi-Fi Fisik..." -ForegroundColor Cyan
$customGw = '${wifiGw}'
$wifi = (Get-NetIPConfiguration | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" -or $_.InterfaceAlias -like "*Wireless*" -or $_.InterfaceAlias -like "*WLAN*" } | Select-Object -First 1)
$gw = $null
if ($customGw) {
    $gw = $customGw
} elseif ($wifi -and $wifi.IPv4DefaultGateway) {
    $gw = $wifi.IPv4DefaultGateway.NextHop
}
$ifIndex = $null
if ($wifi) {
    $ifIndex = $wifi.InterfaceIndex
}

if ($gw -and $ifIndex) {
    Write-Host "  [+] Gateway Wi-Fi Ditemukan: $gw (Interface ID: $ifIndex)" -ForegroundColor Green
    Write-Host "  [+] Menambahkan rute presisi DB Bank Indonesia (${corpSubnet} & 10.161.10.135)..." -ForegroundColor Green
    route -p add 10.161.10.135 mask 255.255.255.255 $gw IF $ifIndex metric 1 | Out-Null
    route -p add ${corpSubnet} mask ${mask} $gw IF $ifIndex metric 1 | Out-Null
    route -p add 10.161.0.0 mask 255.255.0.0 $gw IF $ifIndex metric 1 | Out-Null
    route -p add 10.149.0.0 mask 255.255.0.0 $gw IF $ifIndex metric 1 | Out-Null
    route -p add 10.240.0.0 mask 255.255.0.0 $gw IF $ifIndex metric 1 | Out-Null
} elseif ($gw) {
    Write-Host "  [+] Gateway Wi-Fi Ditemukan: $gw" -ForegroundColor Green
    route -p add 10.161.10.135 mask 255.255.255.255 $gw metric 1 | Out-Null
    route -p add ${corpSubnet} mask ${mask} $gw metric 1 | Out-Null
    route -p add 10.161.0.0 mask 255.255.0.0 $gw metric 1 | Out-Null
    route -p add 10.149.0.0 mask 255.255.0.0 $gw metric 1 | Out-Null
    route -p add 10.240.0.0 mask 255.255.0.0 $gw metric 1 | Out-Null
} elseif ($ifIndex) {
    Write-Host "  [+] Gateway Wi-Fi kosong, mengikat ke Interface Wi-Fi (IF $ifIndex)..." -ForegroundColor Yellow
    route -p add 10.161.10.135 mask 255.255.255.255 0.0.0.0 IF $ifIndex metric 1 | Out-Null
    route -p add ${corpSubnet} mask ${mask} 0.0.0.0 IF $ifIndex metric 1 | Out-Null
    route -p add 10.161.0.0 mask 255.255.0.0 0.0.0.0 IF $ifIndex metric 1 | Out-Null
    route -p add 10.149.0.0 mask 255.255.0.0 0.0.0.0 IF $ifIndex metric 1 | Out-Null
    route -p add 10.240.0.0 mask 255.255.0.0 0.0.0.0 IF $ifIndex metric 1 | Out-Null
} else {
    Write-Host "  [!] Kartu Wi-Fi tidak terdeteksi aktif." -ForegroundColor Red
}

Write-Host "[4/6] Mengunci Rute DB Proyek 62 ke Sangfor aTrust (aTrustVNIC)..." -ForegroundColor Cyan
$atrust = Get-NetAdapter | Where-Object { $_.Name -like "*aTrust*" -or $_.InterfaceDescription -like "*Sangfor*" -or $_.InterfaceDescription -like "*aTrust*" } | Select-Object -First 1
if ($atrust -and $atrust.Status -eq "Up") {
    $atrustIpConfig = Get-NetIPConfiguration -InterfaceIndex $atrust.InterfaceIndex -ErrorAction SilentlyContinue
    $atrustGw = $atrustIpConfig.IPv4DefaultGateway.NextHop
    if ($atrustGw) {
        route -p add 10.28.224.62 mask 255.255.255.255 $atrustGw IF $atrust.InterfaceIndex metric 1 | Out-Null
        route -p add 10.28.0.0 mask 255.255.0.0 $atrustGw IF $atrust.InterfaceIndex metric 1 | Out-Null
    } else {
        route -p add 10.28.224.62 mask 255.255.255.255 0.0.0.0 IF $atrust.InterfaceIndex metric 1 | Out-Null
        route -p add 10.28.0.0 mask 255.255.0.0 0.0.0.0 IF $atrust.InterfaceIndex metric 1 | Out-Null
    }
    Write-Host "  [+] Tunnel Sangfor aTrust AKTIF: DB Proyek (10.28.224.62) terkunci ke Sangfor." -ForegroundColor Green
} else {
    Write-Host "  [*] Sangfor aTrust standby / belum terhubung." -ForegroundColor Gray
}

Write-Host "[5/6] Mendaftarkan Hostname DNS Bank Indonesia ke Windows Hosts..." -ForegroundColor Cyan
$hostsPath = "$env:windir\\System32\\drivers\\etc\\hosts"
$hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
if ($hostsContent -notmatch "dc1sssdb002") {
    [System.IO.File]::AppendAllText($hostsPath, [Environment]::NewLine + "10.161.10.135  dc1sssdb002.corp.bi.go.id  dc1sssdbo02.corp.bi.go.id  sss.corp.bi.go.id")
    Write-Host "  [+] Mapping DNS dc1sssdb002 -> 10.161.10.135 berhasil didaftarkan ke hosts." -ForegroundColor Green
} else {
    Write-Host "  [+] Mapping DNS Bank Indonesia sudah aktif di hosts." -ForegroundColor Green
}

Write-Host "[6/6] Membersihkan DNS & Socket Cache Windows..." -ForegroundColor Cyan
ipconfig /flushdns | Out-Null
Write-Host "  [+] DNS Cache dibersihkan." -ForegroundColor Green

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "BERHASIL! Dual-Network dan Sangfor telah di-konfigurasi secara harmonis:" -ForegroundColor Green
Write-Host " - Internet & Sandbox        --> Jalur ETHERNET (Metric ${config.ethernetMetric})" -ForegroundColor White
Write-Host " - DB Bank Indonesia (${corpSubnet})--> Jalur WI-FI Intranet (Metric 1)" -ForegroundColor White
Write-Host " - DB Proyek 62 (10.28.224)  --> Jalur SANGFOR aTrust (Metric 1)" -ForegroundColor White
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tekan tombol apa saja untuk menutup jendela ini..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
`;
        const resetPs1 = `# =========================================================================
# ZeenIQ Oracle Tools - Reset Network Routing to Defaults
# =========================================================================

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[*] Meminta izin Administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File \`"$PSCommandPath\`"" -Verb RunAs
    exit
}

$Host.UI.RawUI.WindowTitle = "ZeenIQ Tools - Reset Network Routing"
Clear-Host

Write-Host "=========================================================================" -ForegroundColor Yellow
Write-Host "      ZeenIQ Oracle Tools - Reset Network Routing to Defaults" -ForegroundColor Yellow
Write-Host "=========================================================================" -ForegroundColor Yellow
Write-Host ""

$ErrorActionPreference = "SilentlyContinue"

Write-Host "[1/2] Mengembalikan metric interface ke Automatic..." -ForegroundColor Cyan
Set-NetIPInterface -InterfaceAlias "Ethernet*" -AutomaticMetric Enabled
Set-NetIPInterface -InterfaceAlias "Wi-Fi*" -AutomaticMetric Enabled

Write-Host "[2/2] Menghapus static route khusus..." -ForegroundColor Cyan
route delete 10.0.0.0 | Out-Null
route delete 10.161.0.0 | Out-Null
route delete 10.161.10.135 | Out-Null
route delete 10.149.0.0 | Out-Null
route delete 10.240.0.0 | Out-Null
route delete 10.28.224.62 | Out-Null

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "BERHASIL! Default Windows network routing telah dipulihkan." -ForegroundColor Green
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Tekan tombol apa saja untuk menutup jendela ini..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
`;
        const setupBat = `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Dual-Network.ps1"\r\n`;
        const resetBat = `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reset-Network-Routing.ps1"\r\n`;
        let setupPsPath = path_1.default.join(this.rootDir, 'Setup-Dual-Network.ps1');
        let resetPsPath = path_1.default.join(this.rootDir, 'Reset-Network-Routing.ps1');
        let setupPath = path_1.default.join(this.rootDir, 'Setup-Dual-Network.bat');
        let resetPath = path_1.default.join(this.rootDir, 'Reset-Network-Routing.bat');
        try {
            fs_1.default.writeFileSync(setupPsPath, setupPs1, 'utf8');
            fs_1.default.writeFileSync(resetPsPath, resetPs1, 'utf8');
            fs_1.default.writeFileSync(setupPath, setupBat, 'utf8');
            fs_1.default.writeFileSync(resetPath, resetBat, 'utf8');
        }
        catch (e) {
            setupPsPath = path_1.default.join(os_1.default.tmpdir(), 'Setup-Dual-Network.ps1');
            resetPsPath = path_1.default.join(os_1.default.tmpdir(), 'Reset-Network-Routing.ps1');
            setupPath = path_1.default.join(os_1.default.tmpdir(), 'Setup-Dual-Network.bat');
            resetPath = path_1.default.join(os_1.default.tmpdir(), 'Reset-Network-Routing.bat');
            fs_1.default.writeFileSync(setupPsPath, setupPs1, 'utf8');
            fs_1.default.writeFileSync(resetPsPath, resetPs1, 'utf8');
            fs_1.default.writeFileSync(setupPath, setupBat, 'utf8');
            fs_1.default.writeFileSync(resetPath, resetBat, 'utf8');
        }
        return { setupScriptPath: setupPath, resetScriptPath: resetPath };
    }
    /**
     * Apply routing directly by triggering elevated script
     */
    async applyRouting(config) {
        try {
            this.generateDualNetworkScripts(config);
            const psPath = path_1.default.join(this.rootDir, 'Setup-Dual-Network.ps1');
            (0, child_process_1.exec)(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${psPath}\\"' -Verb RunAs"`);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'Failed to execute routing setup' };
        }
    }
    /**
     * Reset routing by triggering elevated reset script
     */
    async resetRouting(config) {
        try {
            this.generateDualNetworkScripts(config);
            const psPath = path_1.default.join(this.rootDir, 'Reset-Network-Routing.ps1');
            (0, child_process_1.exec)(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \\"${psPath}\\"' -Verb RunAs"`);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'Failed to execute routing reset' };
        }
    }
}
exports.NetworkService = NetworkService;
