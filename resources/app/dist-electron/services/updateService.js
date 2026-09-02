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
    static async checkForUpdate(appFolder, remote) {
        const currentVersion = appVersionService_1.AppVersionService.getCurrentVersion();
        const gitDir = path_1.default.join(appFolder, '.git');
        if (!fs_1.default.existsSync(gitDir)) {
            try {
                await this.runGit(appFolder, ['init', '-b', this.BRANCH]);
                const gitignore = path_1.default.join(appFolder, '.gitignore');
                if (!fs_1.default.existsSync(gitignore)) {
                    fs_1.default.writeFileSync(gitignore, 'zeeniq_oracle_data/\nData/\nlogs/\n*.log\ntemp/\nstorage/\napp-runtime.log\nnode_modules/\n', 'utf8');
                }
                await this.runGit(appFolder, ['remote', 'add', 'origin', remote]);
            }
            catch (e) {
                return {
                    available: false,
                    commitsBehind: 0,
                    currentVersion,
                    error: `Folder belum menjadi git repo: ${e?.message || e}`,
                };
            }
        }
        if (!remote || !remote.trim()) {
            return {
                available: false,
                commitsBehind: 0,
                currentVersion,
                error: 'Path remote git / share belum dikonfigurasi.',
            };
        }
        // Pastikan remote origin sesuai
        try {
            const getUrlRes = await this.runGit(appFolder, ['remote', 'get-url', 'origin']);
            if (getUrlRes.exitCode === 0) {
                if (getUrlRes.stdout.trim() !== remote.trim()) {
                    await this.runGit(appFolder, ['remote', 'set-url', 'origin', remote]);
                }
            }
            else {
                await this.runGit(appFolder, ['remote', 'add', 'origin', remote]);
            }
        }
        catch (e) { }
        // Fetch langsung dari remote git repository portable
        const fetchRes = await this.runGit(appFolder, ['fetch', remote, this.BRANCH]);
        if (fetchRes.exitCode !== 0) {
            const sanitizedErr = this.redactRemote(this.firstLine(fetchRes.stderr || fetchRes.stdout), remote);
            return {
                available: false,
                commitsBehind: 0,
                currentVersion,
                error: `git fetch gagal: ${sanitizedErr}`,
            };
        }
        // Hitung jumlah commit yang tertinggal terhadap remote git portable
        const countRes = await this.runGit(appFolder, ['rev-list', '--count', 'HEAD..FETCH_HEAD']);
        if (countRes.exitCode !== 0) {
            return {
                available: false,
                commitsBehind: 0,
                currentVersion,
                error: `git rev-list gagal: ${this.firstLine(countRes.stderr || countRes.stdout)}`,
            };
        }
        const commitsBehind = parseInt(countRes.stdout.trim(), 10) || 0;
        // Baca version.txt / resources/app/version.txt dari FETCH_HEAD remote Git
        let remoteVersion;
        try {
            const showRes = await this.runGit(appFolder, ['show', 'FETCH_HEAD:version.txt']);
            if (showRes.exitCode === 0 && showRes.stdout.trim()) {
                remoteVersion = showRes.stdout.trim();
            }
            else {
                const showAppRes = await this.runGit(appFolder, ['show', 'FETCH_HEAD:resources/app/version.txt']);
                if (showAppRes.exitCode === 0 && showAppRes.stdout.trim()) {
                    remoteVersion = showAppRes.stdout.trim();
                }
            }
        }
        catch (e) { }
        // Dapatkan log commit baru dari remote Git portable
        let changelog = [];
        try {
            const logRes = await this.runGit(appFolder, ['log', 'HEAD..FETCH_HEAD', '--pretty=format:%h - %s', '-n', '8']);
            if (logRes.exitCode === 0 && logRes.stdout.trim()) {
                changelog = logRes.stdout.trim().split('\n').filter(Boolean);
            }
        }
        catch (e) { }
        return {
            available: commitsBehind > 0,
            commitsBehind,
            currentVersion,
            remoteVersion,
            changelog,
            error: null,
        };
    }
    static DEFAULT_REMOTE_SHARE = 'C:\\ZeenIQTools\\ZeeniQDbToolsShare\\ZeeniQDbTools.git';
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
            // Fallback: buat script updater batch mandiri di %TEMP%
            const fallbackBat = path_1.default.join(tempDir, `ZeenIQDbTools.Updater_${guid}.bat`);
            const exeName = 'ZeenIQ-Oracle-Tools.exe';
            const batContent = `@echo off
setlocal
set PID=${pid}
set REMOTE=${remote}
set DEST=${appFolder}

:: Tunggu proses utama keluar
timeout /t 2 /nobreak >nul

cd /d "%DEST%"
if not exist ".git" (
  git init -b main
  git remote add origin "%REMOTE%"
)

git fetch origin main
git reset --hard origin/main
git clean -fd

if exist "%DEST%\\${exeName}" (
  start "" "%DEST%\\${exeName}"
) else if exist "%DEST%\\start-app.bat" (
  start "" "%DEST%\\start-app.bat"
) else if exist "%DEST%\\RUN-ZEENIQ.bat" (
  start "" "%DEST%\\RUN-ZEENIQ.bat"
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
            const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
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
