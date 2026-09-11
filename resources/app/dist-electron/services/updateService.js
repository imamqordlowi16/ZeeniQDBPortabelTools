"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const https_1 = __importDefault(require("https"));
const unzipper_1 = __importDefault(require("unzipper"));
const appVersionService_1 = require("./appVersionService");
class UpdateService {
    static BRANCH = 'main';
    static getAppFolder() {
        if (electron_1.app && electron_1.app.isPackaged) {
            return path_1.default.dirname(process.execPath);
        }
        // In development mode, check if the standalone portable folder exists
        const devPortableDir = path_1.default.join(process.cwd(), 'ZeenIQ-Oracle-Tools-Portable');
        if (fs_1.default.existsSync(path_1.default.join(devPortableDir, '.git'))) {
            return devPortableDir;
        }
        return process.cwd();
    }
    static getSourceRoot() {
        return process.cwd();
    }
    static async hasGit() {
        return new Promise((resolve) => {
            try {
                (0, child_process_1.execFile)('git', ['--version'], (err, stdout) => {
                    if (err || !stdout || !stdout.toLowerCase().includes('git version')) {
                        resolve(false);
                    }
                    else {
                        resolve(true);
                    }
                });
            }
            catch {
                resolve(false);
            }
        });
    }
    static compareVersions(v1, v2) {
        if (!v1 || !v2)
            return 0;
        const p1 = v1.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
        const p2 = v2.trim().replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
        while (p1.length < 3)
            p1.push(0);
        while (p2.length < 3)
            p2.push(0);
        for (let i = 0; i < 3; i++) {
            if (p1[i] > p2[i])
                return 1;
            if (p1[i] < p2[i])
                return -1;
        }
        return 0;
    }
    static parseGitHubRemote(remote) {
        const match = (remote || '').match(/github\.com[/:]([^/]+)\/([^/\.]+)(?:\.git)?/i);
        if (match) {
            return { owner: match[1], repo: match[2] };
        }
        return null;
    }
    static async fetchHttpsText(url, headers = {}) {
        return new Promise((resolve, reject) => {
            const agent = new https_1.default.Agent({ rejectUnauthorized: false });
            const req = https_1.default.get(url, { agent, headers: { 'User-Agent': 'ZeenIQ-Oracle-Tools', ...headers } }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return this.fetchHttpsText(res.headers.location, headers).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                }
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => resolve(data.trim()));
            });
            req.on('error', reject);
            req.setTimeout(12000, () => {
                req.destroy(new Error('Timeout fetching ' + url));
            });
        });
    }
    static async checkForUpdate(appFolder, remote) {
        const currentVersion = appVersionService_1.AppVersionService.getCurrentVersion();
        if (!remote || !remote.trim()) {
            return {
                available: false,
                commitsBehind: 0,
                currentVersion,
                error: 'Path remote git / share belum dikonfigurasi.',
            };
        }
        const trimmedRemote = remote.trim();
        const gitAvailable = await this.hasGit();
        const gitDir = path_1.default.join(appFolder, '.git');
        const ghInfo = this.parseGitHubRemote(trimmedRemote);
        // Kasus 1: Remote adalah folder lokal atau network share (UNC path / drive letter)
        if (fs_1.default.existsSync(trimmedRemote) && !ghInfo) {
            const shareVerFile = path_1.default.join(trimmedRemote, 'version.txt');
            if (fs_1.default.existsSync(shareVerFile)) {
                try {
                    const remoteVer = fs_1.default.readFileSync(shareVerFile, 'utf8').trim();
                    const isNewer = this.compareVersions(remoteVer, currentVersion) > 0;
                    return {
                        available: isNewer,
                        commitsBehind: isNewer ? 1 : 0,
                        currentVersion,
                        remoteVersion: remoteVer,
                        changelog: isNewer ? [`Pembaruan v${remoteVer} tersedia di network share`] : [],
                        error: null,
                    };
                }
                catch (e) {
                    return {
                        available: false,
                        commitsBehind: 0,
                        currentVersion,
                        error: `Gagal membaca version.txt dari share: ${e?.message || e}`,
                    };
                }
            }
        }
        // Kasus 2: Remote adalah GitHub (Online) -> SELALU gunakan Direct HTTPS (100% Mandiri, Bebas Git & Bebas Login)
        if (ghInfo) {
            try {
                // Ambil version.txt langsung via HTTPS (Git-Free)
                const rawUrl = `https://raw.githubusercontent.com/${ghInfo.owner}/${ghInfo.repo}/main/version.txt`;
                const remoteVer = await this.fetchHttpsText(rawUrl);
                const isNewer = this.compareVersions(remoteVer, currentVersion) > 0;
                // Ambil commit messages terbaru via GitHub API publik
                let changelog = [];
                try {
                    const commitsApiUrl = `https://api.github.com/repos/${ghInfo.owner}/${ghInfo.repo}/commits?per_page=5`;
                    const commitsJson = await this.fetchHttpsText(commitsApiUrl);
                    const commits = JSON.parse(commitsJson);
                    if (Array.isArray(commits)) {
                        changelog = commits.map((c) => {
                            const sha = (c.sha || '').substring(0, 7);
                            const msg = (c.commit?.message || '').split('\n')[0];
                            return `${sha} - ${msg}`;
                        });
                    }
                }
                catch (e) { }
                return {
                    available: isNewer,
                    commitsBehind: isNewer ? Math.max(changelog.length, 1) : 0,
                    currentVersion,
                    remoteVersion: remoteVer,
                    changelog,
                    error: null,
                };
            }
            catch (e) {
                return {
                    available: false,
                    commitsBehind: 0,
                    currentVersion,
                    error: `Gagal memeriksa pembaruan dari server online (${e?.message || e}). Periksa koneksi internet Anda.`,
                };
            }
        }
        return {
            available: false,
            commitsBehind: 0,
            currentVersion,
            error: 'Path remote pembaruan tidak valid atau tidak dapat diakses.',
        };
    }
    static DEFAULT_REMOTE_SHARE = 'https://github.com/imamqordlowi16/ZeeniQTools.git';
    static async publishToShare(appFolder, remote, onLog) {
        const validRemote = (remote && remote.trim()) ? remote.trim() : this.DEFAULT_REMOTE_SHARE;
        const gitDir = path_1.default.join(appFolder, '.git');
        if (!fs_1.default.existsSync(gitDir)) {
            onLog(`Inisialisasi git repository di ${appFolder}...`);
            await this.runGitChecked(appFolder, onLog, ['init', '-b', this.BRANCH]);
            const gitignore = path_1.default.join(appFolder, '.gitignore');
            if (!fs_1.default.existsSync(gitignore)) {
                fs_1.default.writeFileSync(gitignore, 'zeeniq_oracle_data/\nData/\nlogs/\n*.log\ntemp/\nstorage/\napp-runtime.log\nnode_modules/\n', 'utf8');
            }
        }
        const hasRemote = (await this.runGit(appFolder, ['remote', 'get-url', 'origin'])).exitCode === 0;
        if (!hasRemote) {
            await this.runGitChecked(appFolder, onLog, ['remote', 'add', 'origin', validRemote]);
        }
        else {
            await this.runGitChecked(appFolder, onLog, ['remote', 'set-url', 'origin', validRemote]);
        }
        // Fetch remote agar commit selalu bersambung (fast-forward)
        const fetch = await this.runGit(appFolder, ['fetch', 'origin', this.BRANCH]);
        if (fetch.exitCode === 0) {
            await this.runGit(appFolder, ['reset', '--mixed', `origin/${this.BRANCH}`]);
        }
        const curVer = appVersionService_1.AppVersionService.getCurrentVersion();
        const versionFile = path_1.default.join(appFolder, 'version.txt');
        fs_1.default.writeFileSync(versionFile, curVer, 'utf8');
        await this.runGitChecked(appFolder, onLog, ['add', '-A']);
        const diffRes = await this.runGit(appFolder, ['diff', '--cached', '--quiet']);
        if (diffRes.exitCode === 0) {
            onLog('Gak ada perubahan buat di-publish (folder aplikasi sama persis seperti commit terakhir).');
            return;
        }
        await this.runGitChecked(appFolder, onLog, ['commit', '-m', `Publish v${curVer}`]);
        await this.runGitChecked(appFolder, onLog, ['push', '-u', 'origin', this.BRANCH]);
        onLog(`Berhasil dipublish ke ${validRemote} (v${curVer}).`);
    }
    static async publishSource(sourceRoot, remote, onLog) {
        const gitDir = path_1.default.join(sourceRoot, '.git');
        if (!fs_1.default.existsSync(gitDir)) {
            await this.runGitChecked(sourceRoot, onLog, ['init', '-b', this.BRANCH]);
            onLog(`'${sourceRoot}' baru dijadikan git repo.`);
        }
        const hasRemote = (await this.runGit(sourceRoot, ['remote', 'get-url', 'origin'])).exitCode === 0;
        if (!hasRemote) {
            await this.runGitChecked(sourceRoot, onLog, ['remote', 'add', 'origin', remote]);
        }
        else {
            await this.runGitChecked(sourceRoot, onLog, ['remote', 'set-url', 'origin', remote]);
        }
        await this.runGitChecked(sourceRoot, onLog, ['add', '-A']);
        const diff = await this.runGit(sourceRoot, ['diff', '--cached', '--quiet']);
        if (diff.exitCode === 0) {
            onLog('Gak ada perubahan buat di-push (source code sama persis seperti commit terakhir).');
            return;
        }
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
        await this.runGitChecked(sourceRoot, onLog, ['commit', '-m', `Update source ${timestamp}`]);
        await this.runGitChecked(sourceRoot, onLog, ['push', '-u', 'origin', this.BRANCH]);
        onLog(`Source code berhasil di-push ke ${remote}.`);
    }
    static async downloadFile(url, destFile, onProgress) {
        return new Promise((resolve, reject) => {
            const agent = new https_1.default.Agent({ rejectUnauthorized: false });
            const req = https_1.default.get(url, { agent, headers: { 'User-Agent': 'ZeenIQ-Oracle-Tools' } }, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return this.downloadFile(res.headers.location, destFile, onProgress).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`Gagal mengunduh file: HTTP ${res.statusCode}`));
                }
                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let downloaded = 0;
                let lastReport = 0;
                const fileStream = fs_1.default.createWriteStream(destFile);
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    const now = Date.now();
                    if (now - lastReport > 400 || downloaded === totalBytes) {
                        lastReport = now;
                        if (totalBytes > 0) {
                            const pct = Math.round((downloaded / totalBytes) * 100);
                            onProgress?.(`Mengunduh pembaruan: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} / ${(totalBytes / 1024 / 1024).toFixed(1)} MB)...`);
                        }
                        else {
                            onProgress?.(`Mengunduh pembaruan: ${(downloaded / 1024 / 1024).toFixed(1)} MB...`);
                        }
                    }
                });
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
                fileStream.on('error', (err) => {
                    try {
                        fs_1.default.unlinkSync(destFile);
                    }
                    catch (e) { }
                    reject(err);
                });
            });
            req.on('error', (err) => {
                try {
                    fs_1.default.unlinkSync(destFile);
                }
                catch (e) { }
                reject(err);
            });
            req.setTimeout(300000, () => {
                req.destroy(new Error('Timeout mengunduh update (>300 detik)'));
            });
        });
    }
    static async downloadAndExtractZip(zipUrl, targetDir, onProgress) {
        const tempZipPath = path_1.default.join(os_1.default.tmpdir(), `zeeniq_update_${crypto_1.default.randomBytes(4).toString('hex')}.zip`);
        const extractDir = path_1.default.join(targetDir, 'extracted');
        fs_1.default.mkdirSync(extractDir, { recursive: true });
        onProgress?.('Menghubungi server unduhan...');
        await this.downloadFile(zipUrl, tempZipPath, onProgress);
        onProgress?.('Mengekstrak paket pembaruan...');
        await new Promise((resolve, reject) => {
            fs_1.default.createReadStream(tempZipPath)
                .pipe(unzipper_1.default.Extract({ path: extractDir }))
                .on('close', resolve)
                .on('error', reject);
        });
        try {
            fs_1.default.unlinkSync(tempZipPath);
        }
        catch (e) { }
        // Temukan folder utama di dalam hasil ekstraksi (misal ZeeniQDBPortabelTools-main)
        const entries = fs_1.default.readdirSync(extractDir);
        for (const entry of entries) {
            const full = path_1.default.join(extractDir, entry);
            if (fs_1.default.statSync(full).isDirectory()) {
                return full;
            }
        }
        return extractDir;
    }
    static sanitizeStagingFolder(stagingFolder) {
        try {
            const checkAndClean = (dir) => {
                if (!fs_1.default.existsSync(dir))
                    return;
                const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path_1.default.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        // Hapus folder sistem internal atau data jika terbawa di staging
                        if (['zeeniq_oracle_data', 'Data', 'data', 'logs', 'temp', '.git'].includes(entry.name)) {
                            try {
                                fs_1.default.rmSync(fullPath, { recursive: true, force: true });
                            }
                            catch (e) { }
                            continue;
                        }
                        checkAndClean(fullPath);
                    }
                    else {
                        // Deteksi teks pointer Git LFS (< 1000 byte dan diawali "version https://git-lfs")
                        // Khususnya untuk file .exe, .dll, .bin, atau di folder instantclient
                        const ext = path_1.default.extname(entry.name).toLowerCase();
                        const isBinaryType = ['.exe', '.dll', '.bin', '.dat', '.pak'].includes(ext) || fullPath.includes('instantclient');
                        if (isBinaryType) {
                            try {
                                const stat = fs_1.default.statSync(fullPath);
                                if (stat.size < 1000) {
                                    const content = fs_1.default.readFileSync(fullPath, 'utf8');
                                    if (content.includes('git-lfs') || content.startsWith('version https://')) {
                                        // Hapus file pointer Git LFS ini agar TIDAK menimpa binary asli di aplikasi!
                                        fs_1.default.unlinkSync(fullPath);
                                    }
                                }
                            }
                            catch (e) { }
                        }
                    }
                }
            };
            checkAndClean(stagingFolder);
        }
        catch (e) {
            console.warn('Error sanitizing staging folder:', e);
        }
    }
    static async prepareAndLaunchUpdater(remote, appFolder, onLog) {
        const trimmedRemote = (remote || '').trim();
        const ghInfo = this.parseGitHubRemote(trimmedRemote);
        // Kasus A: Remote adalah direktori lokal / network share UNC
        if (fs_1.default.existsSync(trimmedRemote) && !ghInfo) {
            onLog?.(`Menggunakan staging pembaruan dari share lokal: ${trimmedRemote}`);
            this.launchUpdaterAndExit(trimmedRemote, appFolder);
            return;
        }
        // Kasus B: Remote adalah GitHub (Online) -> SELALU gunakan unduhan langsung HTTPS mandiri (Bebas Git & Bebas Login)
        if (ghInfo) {
            onLog?.('Mengunduh paket pembaruan langsung dari server online via HTTPS...');
            const zipUrl = `https://codeload.github.com/${ghInfo.owner}/${ghInfo.repo}/zip/refs/heads/main`;
            const tempBase = path_1.default.join(os_1.default.tmpdir(), `zeeniq_staging_${crypto_1.default.randomBytes(4).toString('hex')}`);
            fs_1.default.mkdirSync(tempBase, { recursive: true });
            try {
                const stagingFolder = await this.downloadAndExtractZip(zipUrl, tempBase, onLog);
                onLog?.('Memverifikasi integritas paket dan melindungi binary sistem...');
                this.sanitizeStagingFolder(stagingFolder);
                onLog?.('Pembaruan siap dipasang. Menjalankan updater mandiri...');
                this.launchUpdaterAndExit(stagingFolder, appFolder);
                return;
            }
            catch (err) {
                onLog?.(`Peringatan: Unduhan via Node.js gagal (${err.message}). Mencoba updater mandiri...`);
            }
        }
        // Fallback: jalankan updater dengan remote yang tersedia
        this.launchUpdaterAndExit(trimmedRemote, appFolder);
    }
    static launchUpdaterAndExit(remote, appFolder) {
        const pid = process.pid.toString();
        const tempDir = os_1.default.tmpdir();
        const guid = crypto_1.default.randomBytes(8).toString('hex');
        const stagedUpdater = path_1.default.join(tempDir, `ZeenIQDbTools.Updater_${guid}.exe`);
        // Cari updater executable di beberapa kandidat lokasi
        const possibleUpdaters = [
            path_1.default.join(appFolder, 'ZeenIQDbTools.Updater.exe'),
            path_1.default.join(process.cwd(), 'ZeenIQDbTools.Updater.exe'),
            path_1.default.join(process.cwd(), 'ZeenIQDbTools.Updater', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'publish', 'ZeenIQDbTools.Updater.exe'),
            path_1.default.join(process.cwd(), 'ZeenIQDbTools.Updater', 'bin', 'Release', 'net10.0-windows', 'win-x64', 'ZeenIQDbTools.Updater.exe'),
        ];
        let sourceUpdater = possibleUpdaters.find((p) => fs_1.default.existsSync(p));
        if (sourceUpdater) {
            try {
                fs_1.default.copyFileSync(sourceUpdater, stagedUpdater);
            }
            catch (e) {
                console.error('Failed to stage updater binary:', e);
            }
        }
        if (fs_1.default.existsSync(stagedUpdater)) {
            // Jalankan standalone .NET updater
            const child = (0, child_process_1.spawn)(stagedUpdater, [pid, remote, appFolder], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.unref();
        }
        else {
            // Fallback: buat script updater batch mandiri di %TEMP% (100% Bebas Git)
            const fallbackBat = path_1.default.join(tempDir, `ZeenIQDbTools.Updater_${guid}.bat`);
            const isDir = fs_1.default.existsSync(remote);
            let updateCommands = '';
            if (isDir) {
                // Mode A Staging: robocopy (Exclude data, logs, temp, dan file LFS pointer)
                updateCommands = `
echo Menerapkan file pembaruan ke folder aplikasi...
robocopy "${remote}" "%DEST%" /E /XD zeeniq_oracle_data Data data logs temp .git instantclient /XF electron.exe ZeenIQ-Oracle-Tools.exe ZeenIQ-Oracle-Tools-VIP.exe /R:2 /W:1 /NFL /NDL >nul
`;
            }
            else {
                // Mode B: Unduhan via PowerShell murni (100% Bebas Git & Bebas Login)
                updateCommands = `
echo Mengunduh pembaruan online secara mandiri via HTTPS...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}; $zip = Join-Path $env:TEMP 'zeeniq_up.zip'; $dir = Join-Path $env:TEMP 'zeeniq_up'; Remove-Item -Force -Recurse $dir -ErrorAction SilentlyContinue; Invoke-WebRequest -Uri 'https://codeload.github.com/imamqordlowi16/ZeeniQDBPortabelTools/zip/refs/heads/main' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $dir -Force; $src = (Get-ChildItem -Path $dir | Select-Object -First 1).FullName; Get-ChildItem -Path $src -Recurse | Where-Object { $_.Length -lt 1000 -and (Select-String -Path $_.FullName -Pattern 'git-lfs' -Quiet) } | Remove-Item -Force; robocopy $src '%DEST%' /E /XD zeeniq_oracle_data Data data logs temp .git instantclient /XF electron.exe ZeenIQ-Oracle-Tools.exe ZeenIQ-Oracle-Tools-VIP.exe /R:2 /W:1 /NFL /NDL; Remove-Item -Force $zip; Remove-Item -Force -Recurse $dir;"
`;
            }
            const batContent = `@echo off
setlocal
set PID=${pid}
set REMOTE=${remote}
set DEST=${appFolder}

:: Pastikan seluruh proses aplikasi dan child-nya sudah benar-benar tertutup
taskkill /F /PID %PID% >nul 2>nul
taskkill /F /IM ZeenIQ-Oracle-Tools.exe >nul 2>nul
taskkill /F /IM ZeenIQ-Oracle-Tools-VIP.exe >nul 2>nul
taskkill /F /IM electron.exe >nul 2>nul
timeout /t 2 /nobreak >nul

if exist "%DEST%\\.git\\index.lock" del /f /q "%DEST%\\.git\\index.lock" >nul 2>nul

${updateCommands}

:: Pastikan version.txt di root aplikasi selalu sinkron
if exist "%DEST%\\resources\\app\\version.txt" (
  copy /y "%DEST%\\resources\\app\\version.txt" "%DEST%\\version.txt" >nul 2>nul
)

if exist "%DEST%\\ZeenIQ-Oracle-Tools-VIP.exe" (
  start "" "%DEST%\\ZeenIQ-Oracle-Tools-VIP.exe"
) else if exist "%DEST%\\ZeenIQ-Oracle-Tools.exe" (
  start "" "%DEST%\\ZeenIQ-Oracle-Tools.exe"
) else if exist "%DEST%\\RUN-ZEENIQ-TEAM.bat" (
  start "" "%DEST%\\RUN-ZEENIQ-TEAM.bat"
) else if exist "%DEST%\\RUN-ZEENIQ.bat" (
  start "" "%DEST%\\RUN-ZEENIQ.bat"
) else if exist "%DEST%\\start-app.bat" (
  start "" "%DEST%\\start-app.bat"
) else if exist "%DEST%\\electron.exe" (
  start "" "%DEST%\\electron.exe"
)
exit /b 0
`;
            fs_1.default.writeFileSync(fallbackBat, batContent, 'utf8');
            const child = (0, child_process_1.spawn)('cmd.exe', ['/c', fallbackBat], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.unref();
        }
        if (electron_1.app) {
            electron_1.app.quit();
        }
        else {
            process.exit(0);
        }
    }
    static firstLine(str) {
        if (!str)
            return '';
        const lines = str.split(/\r?\n/).filter((l) => l.trim().length > 0);
        return lines.length > 0 ? lines[0].trim() : str.trim();
    }
    static redactRemote(msg, remote) {
        if (!remote || !msg)
            return msg;
        return msg.replace(new RegExp(remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<remote>');
    }
    static runGit(workDir, args, onData) {
        return new Promise((resolve) => {
            const env = {
                ...process.env,
                GIT_TERMINAL_PROMPT: '0',
                GCM_INTERACTIVE: 'never',
                GIT_CONFIG_PARAMETERS: "'credential.helper='",
            };
            const child = (0, child_process_1.spawn)('git', args, {
                cwd: workDir,
                env,
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            let timer;
            const resetTimer = () => {
                if (timer)
                    clearTimeout(timer);
                // 5 menit inactivity timeout
                timer = setTimeout(() => {
                    try {
                        child.kill();
                    }
                    catch (e) { }
                    resolve({
                        exitCode: -1,
                        stdout,
                        stderr: `${stderr}\nTimeout (inaktif >5 menit) saat menjalankan git ${args.join(' ')}`,
                    });
                }, 300000);
            };
            resetTimer();
            child.stdout?.on('data', (d) => {
                resetTimer();
                const str = d.toString();
                stdout += str;
                if (onData) {
                    const lines = str.split(/\r?\n/).filter((l) => l.trim().length > 0);
                    for (const line of lines)
                        onData(line);
                }
            });
            child.stderr?.on('data', (d) => {
                resetTimer();
                const str = d.toString();
                stderr += str;
                if (onData) {
                    const lines = str.split(/\r?\n/).filter((l) => l.trim().length > 0);
                    for (const line of lines)
                        onData(line);
                }
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    exitCode: code ?? 0,
                    stdout,
                    stderr,
                });
            });
            child.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    exitCode: 1,
                    stdout,
                    stderr: err.message,
                });
            });
        });
    }
    static async runGitChecked(workDir, onLog, args) {
        const res = await this.runGit(workDir, args, (line) => {
            onLog(line);
        });
        if (res.exitCode !== 0) {
            throw new Error(`git ${args.join(' ')} gagal (exit ${res.exitCode}).`);
        }
    }
}
exports.UpdateService = UpdateService;
