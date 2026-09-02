"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
class SandboxService {
    rootDir;
    portableDir;
    constructor() {
        if (electron_1.app && electron_1.app.isPackaged) {
            // In packaged portable execution, process.execPath is in ZeenIQ-Oracle-Tools-Portable
            this.portableDir = path_1.default.dirname(process.execPath);
            this.rootDir = this.portableDir;
        }
        else {
            this.rootDir = path_1.default.resolve(__dirname, '..', '..');
            this.portableDir = path_1.default.join(this.rootDir, 'ZeenIQ-Oracle-Tools-Portable');
        }
    }
    /**
     * Return the actual directory containing portable executable
     */
    getResolvedPortableDir() {
        if (electron_1.app && electron_1.app.isPackaged) {
            return path_1.default.dirname(process.execPath);
        }
        if (fs_1.default.existsSync(this.portableDir)) {
            return this.portableDir;
        }
        // Check if running from app directory inside portable
        const candidate = path_1.default.resolve(this.rootDir, '..', '..');
        if (fs_1.default.existsSync(path_1.default.join(candidate, 'ZeenIQ-Oracle-Tools.exe'))) {
            return candidate;
        }
        return this.portableDir;
    }
    /**
     * Check if Windows Sandbox is supported and installed on this machine
     */
    checkStatus() {
        const isWindows = process.platform === 'win32';
        const portablePath = this.getResolvedPortableDir();
        if (!isWindows) {
            return {
                isSupported: false,
                isEnabled: false,
                portableAppPath: portablePath,
                portableAppExists: false,
            };
        }
        const sysRoot = process.env.SystemRoot || 'C:\\Windows';
        const sandboxExe1 = path_1.default.join(sysRoot, 'System32', 'WindowsSandbox.exe');
        const sandboxExe2 = path_1.default.join(sysRoot, 'Sysnative', 'WindowsSandbox.exe');
        const isInstalled = fs_1.default.existsSync(sandboxExe1) || fs_1.default.existsSync(sandboxExe2);
        // Check if executable exists in portable path or current process
        const portableExe = path_1.default.join(portablePath, 'ZeenIQ-Oracle-Tools.exe');
        const portableExists = fs_1.default.existsSync(portableExe) || (electron_1.app && electron_1.app.isPackaged && fs_1.default.existsSync(process.execPath));
        return {
            isSupported: true,
            isEnabled: isInstalled,
            executablePath: isInstalled ? (fs_1.default.existsSync(sandboxExe1) ? sandboxExe1 : sandboxExe2) : undefined,
            portableAppPath: portablePath,
            portableAppExists: Boolean(portableExists),
        };
    }
    /**
     * Generate XML content for .wsb configuration file
     */
    generateWsbContent(config) {
        const mappedFoldersXml = config.mappedFolders
            .filter((f) => f.hostFolder && fs_1.default.existsSync(f.hostFolder))
            .map((f) => {
            const sandboxFolderTag = f.sandboxFolder ? `      <SandboxFolder>${f.sandboxFolder}</SandboxFolder>\n` : '';
            return `    <MappedFolder>\n      <HostFolder>${f.hostFolder}</HostFolder>\n${sandboxFolderTag}      <ReadOnly>${f.readOnly ? 'true' : 'false'}</ReadOnly>\n    </MappedFolder>`;
        })
            .join('\n');
        let formattedCommand = config.logonCommand;
        if (formattedCommand && !formattedCommand.startsWith('cmd.exe')) {
            formattedCommand = `cmd.exe /c start "" "${formattedCommand}"`;
        }
        const logonCommandXml = formattedCommand
            ? `  <LogonCommand>\n    <Command>${formattedCommand}</Command>\n  </LogonCommand>\n`
            : '';
        const memoryXml = config.memoryInMB ? `  <MemoryInMB>${config.memoryInMB}</MemoryInMB>\n` : '  <MemoryInMB>4096</MemoryInMB>\n';
        const vGpuXml = `  <VGpu>${config.vGpu === true ? 'Enable' : 'Disable'}</VGpu>\n`;
        return `<Configuration>
  <Networking>${config.networking !== false ? 'Enable' : 'Disable'}</Networking>
${vGpuXml}${memoryXml}  <MappedFolders>
${mappedFoldersXml}
  </MappedFolders>
${logonCommandXml}</Configuration>
`;
    }
    /**
     * Launch Windows Sandbox with configuration
     */
    async launchSandbox(config) {
        const status = this.checkStatus();
        if (!status.isSupported) {
            return { success: false, error: 'Windows Sandbox is only supported on Windows OS.' };
        }
        if (!status.isEnabled) {
            return {
                success: false,
                error: 'Windows Sandbox is not enabled yet. Please click "⚡ Install / Aktifkan Sandbox" first.',
            };
        }
        try {
            const xmlContent = this.generateWsbContent(config);
            // Try writing to rootDir, fallback to temp dir
            let wsbPath = path_1.default.join(this.rootDir, 'ZeenIQ-Sandbox.wsb');
            try {
                fs_1.default.writeFileSync(wsbPath, xmlContent, 'utf8');
            }
            catch (e) {
                wsbPath = path_1.default.join(os_1.default.tmpdir(), 'ZeenIQ-Sandbox.wsb');
                fs_1.default.writeFileSync(wsbPath, xmlContent, 'utf8');
            }
            // Launch .wsb using native shell association
            await electron_1.shell.openPath(wsbPath);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'Failed to launch Windows Sandbox' };
        }
    }
    /**
     * Save customized .wsb file to a user specified path
     */
    saveWsbFile(targetFilePath, config) {
        try {
            const xmlContent = this.generateWsbContent(config);
            fs_1.default.writeFileSync(targetFilePath, xmlContent, 'utf8');
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'Failed to write .wsb file' };
        }
    }
    /**
     * Raw installer batch script content for Windows Sandbox
     */
    getEnableScriptContent() {
        return `@echo off
:: =========================================================================
:: ZeenIQ Oracle Tools - Windows Sandbox Universal Installer / Enabler
:: Supports Windows 10 & Windows 11 (Pro, Enterprise, Education, and Home)
:: =========================================================================

title ZeenIQ Tools - Windows Sandbox Installer
color 0B

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [INFO] Requesting Administrator Privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo =========================================================================
echo       ZeenIQ Oracle Tools - Windows Sandbox Auto-Enabler
echo =========================================================================
echo.
echo [1/4] Checking Hardware Virtualization (Intel VT-x / AMD-V in BIOS)...
powershell -Command "$v = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled; if ($v) { Write-Host '  [OK] CPU Hardware Virtualization is ENABLED in BIOS' -ForegroundColor Green } else { Write-Host '  [CRITICAL WARNING] CPU Virtualization is DISABLED in BIOS/UEFI.' -ForegroundColor Red; Write-Host '  => Windows Sandbox requires Intel VT-x / AMD-V enabled in your laptop BIOS.' -ForegroundColor Yellow; Write-Host '  => Please restart PC, enter BIOS (F2/F10/Del/F12), and Enable Intel Virtualization Technology (VT-x).' -ForegroundColor Yellow }"

echo.
echo [2/4] Enabling Virtual Machine Platform and Hyper-V...
echo   Activating VirtualMachinePlatform (please wait, do not close)...
dism /online /Enable-Feature /FeatureName:"VirtualMachinePlatform" /All /NoRestart
echo   Activating Hyper-V (please wait, do not close)...
dism /online /Enable-Feature /FeatureName:"Microsoft-Hyper-V-All" /All /NoRestart

echo.
echo [3/4] Enabling Windows Sandbox Feature (Containers-DisposableClientVM)...
echo   Activating Containers-DisposableClientVM...
dism /online /Enable-Feature /FeatureName:"Containers-DisposableClientVM" /All /NoRestart

if %errorLevel% equ 0 (
    echo   [OK] Standard Windows Sandbox feature enabled successfully!
) else (
    echo   [INFO] Standard feature not found. Installing Windows Sandbox packages for Windows Home Edition...
    dir /b %SystemRoot%\\servicing\\Packages\\*Containers*.mum > "%TEMP%\\sandbox.txt" 2>nul
    for /f %%i in ('findstr /i . "%TEMP%\\sandbox.txt" 2^>nul') do (
        echo   Installing package: %%i
        dism /online /norestart /add-package:"%SystemRoot%\\servicing\\Packages\\%%i"
    )
    del "%TEMP%\\sandbox.txt" >nul 2>&1
    dism /online /enable-feature /featurename:Containers-DisposableClientVM /LimitAccess /ALL /norestart
)

echo.
echo [4/4] Verifying Windows Sandbox Executable...
if exist "%SystemRoot%\\System32\\WindowsSandbox.exe" (
    echo   [SUCCESS] WindowsSandbox.exe found at %SystemRoot%\\System32\\WindowsSandbox.exe!
) else if exist "%SystemRoot%\\Sysnative\\WindowsSandbox.exe" (
    echo   [SUCCESS] WindowsSandbox.exe found at %SystemRoot%\\Sysnative\\WindowsSandbox.exe!
) else (
    echo   [NOTICE] Feature registered. Windows Sandbox will be ready after BIOS VT-x is enabled and PC is restarted.
)

echo.
echo =========================================================================
echo Installation complete! 
echo IMPORTANT: 
echo 1. If CPU Virtualization in BIOS is False, ENABLE Intel VT-x in BIOS first!
echo 2. You MUST RESTART your computer once for changes to take effect.
echo =========================================================================
echo.
set /p REBOOT="Do you want to restart your computer now? (Y/N, default N): "
if /i "%REBOOT%"=="Y" (
    echo Restarting Windows in 5 seconds...
    shutdown /r /t 5
) else (
    echo You can restart your computer later when you are ready.
)
pause
`;
    }
    /**
     * Trigger automatic Windows Sandbox installation / enablement script with Admin UAC
     */
    async enableWindowsSandbox() {
        try {
            const scriptContent = this.getEnableScriptContent();
            // Determine where to write the script
            let scriptPath = path_1.default.join(this.rootDir, 'Enable-Windows-Sandbox.bat');
            try {
                fs_1.default.writeFileSync(scriptPath, scriptContent, 'utf8');
            }
            catch (e) {
                // If rootDir is read-only or error, write to TEMP directory
                scriptPath = path_1.default.join(os_1.default.tmpdir(), 'Enable-Windows-Sandbox.bat');
                fs_1.default.writeFileSync(scriptPath, scriptContent, 'utf8');
            }
            (0, child_process_1.exec)(`powershell -Command "Start-Process '${scriptPath}' -Verb RunAs"`);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message || 'Failed to trigger Sandbox enabler script' };
        }
    }
}
exports.SandboxService = SandboxService;
