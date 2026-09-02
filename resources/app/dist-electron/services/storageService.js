"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const electron_1 = require("electron");
class StorageService {
    baseDir;
    portableDataDir = null;
    connectionsFile;
    historyFile;
    schedulesFile;
    settingsFile;
    constructor() {
        this.baseDir = this.resolveDataDirectory();
        if (!fs_1.default.existsSync(this.baseDir)) {
            try {
                fs_1.default.mkdirSync(this.baseDir, { recursive: true });
            }
            catch (e) { }
        }
        this.connectionsFile = path_1.default.join(this.baseDir, 'connections.json');
        this.historyFile = path_1.default.join(this.baseDir, 'history.json');
        this.schedulesFile = path_1.default.join(this.baseDir, 'schedules.json');
        this.settingsFile = path_1.default.join(this.baseDir, 'settings.json');
        this.initializeDefaults();
    }
    isRunningInSandbox() {
        if (process.platform !== 'win32')
            return false;
        const username = (process.env.USERNAME || '').toLowerCase();
        const userInfoName = (os_1.default.userInfo()?.username || '').toLowerCase();
        return (username === 'wdagutilityaccount' ||
            userInfoName === 'wdagutilityaccount' ||
            process.cwd().toLowerCase().includes('wdagutilityaccount') ||
            (electron_1.app && process.execPath.toLowerCase().includes('wdagutilityaccount')));
    }
    resolveDataDirectory() {
        const isSandbox = this.isRunningInSandbox();
        // 1. If running inside Windows Sandbox, ALWAYS write to the mapped portable data folder!
        if (isSandbox) {
            const execDir = electron_1.app ? path_1.default.dirname(process.execPath) : process.cwd();
            const mappedDataDir = path_1.default.join(execDir, 'data');
            try {
                if (!fs_1.default.existsSync(mappedDataDir)) {
                    fs_1.default.mkdirSync(mappedDataDir, { recursive: true });
                }
                console.log('[StorageService] Running in Windows Sandbox. Persistent mapped data dir:', mappedDataDir);
                return mappedDataDir;
            }
            catch (e) {
                console.warn('[StorageService] Failed to create sandbox mapped data dir, falling back:', e);
            }
        }
        // 2. Check if running as packaged portable on host
        if (electron_1.app && electron_1.app.isPackaged) {
            const exeDir = path_1.default.dirname(process.execPath);
            const exeDataDir = path_1.default.join(exeDir, 'data');
            if (fs_1.default.existsSync(exeDataDir)) {
                this.portableDataDir = exeDataDir;
                return exeDataDir;
            }
        }
        // 3. Host dev / standard location
        const appRoot = path_1.default.resolve(__dirname, '..', '..');
        const repoPortableDataDir = path_1.default.join(appRoot, 'ZeenIQ-Oracle-Tools-Portable', 'data');
        if (fs_1.default.existsSync(path_1.default.join(appRoot, 'ZeenIQ-Oracle-Tools-Portable'))) {
            this.portableDataDir = repoPortableDataDir;
        }
        const hostDir = electron_1.app ? path_1.default.join(electron_1.app.getPath('userData'), 'zeeniq_oracle_data') : path_1.default.join(process.cwd(), '.data');
        return hostDir;
    }
    syncToPortable(filename, content) {
        if (this.portableDataDir) {
            try {
                if (!fs_1.default.existsSync(this.portableDataDir)) {
                    fs_1.default.mkdirSync(this.portableDataDir, { recursive: true });
                }
                fs_1.default.writeFileSync(path_1.default.join(this.portableDataDir, filename), content, 'utf-8');
            }
            catch (e) { }
        }
    }
    initializeDefaults() {
        // If portable data directory exists and has connections, import them if host connections missing
        if (this.portableDataDir && fs_1.default.existsSync(path_1.default.join(this.portableDataDir, 'connections.json'))) {
            if (!fs_1.default.existsSync(this.connectionsFile)) {
                try {
                    fs_1.default.copyFileSync(path_1.default.join(this.portableDataDir, 'connections.json'), this.connectionsFile);
                }
                catch (e) { }
            }
        }
        if (!fs_1.default.existsSync(this.connectionsFile)) {
            const defaultConnections = [
                {
                    id: 'conn-prd-template',
                    name: 'Oracle PRD Corp (dc1sssdbo02.corp.bi.go.id)',
                    environment: 'PRD',
                    host: 'dc1sssdbo02.corp.bi.go.id',
                    port: 1521,
                    connectionType: 'serviceName',
                    serviceName: 'SSSDPRD',
                    user: 'SYSTEM',
                    privilege: 'NORMAL',
                    createdAt: new Date().toISOString(),
                },
                {
                    id: 'conn-dev-template',
                    name: 'Oracle DEV (Development Database)',
                    environment: 'DEV',
                    host: 'localhost',
                    port: 1521,
                    connectionType: 'serviceName',
                    serviceName: 'ORCLDEV',
                    user: 'SCOTT',
                    privilege: 'NORMAL',
                    createdAt: new Date().toISOString(),
                },
            ];
            const jsonStr = JSON.stringify(defaultConnections, null, 2);
            fs_1.default.writeFileSync(this.connectionsFile, jsonStr, 'utf-8');
            this.syncToPortable('connections.json', jsonStr);
        }
        if (!fs_1.default.existsSync(this.historyFile)) {
            fs_1.default.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf-8');
        }
        if (!fs_1.default.existsSync(this.schedulesFile)) {
            fs_1.default.writeFileSync(this.schedulesFile, JSON.stringify([], null, 2), 'utf-8');
        }
        if (!fs_1.default.existsSync(this.settingsFile)) {
            if (this.portableDataDir && fs_1.default.existsSync(path_1.default.join(this.portableDataDir, 'settings.json'))) {
                try {
                    fs_1.default.copyFileSync(path_1.default.join(this.portableDataDir, 'settings.json'), this.settingsFile);
                }
                catch (e) { }
            }
            if (!fs_1.default.existsSync(this.settingsFile)) {
                const defaultFolder = path_1.default.join(electron_1.app ? electron_1.app.getPath('documents') : process.cwd(), 'OracleBackups');
                if (!fs_1.default.existsSync(defaultFolder)) {
                    try {
                        fs_1.default.mkdirSync(defaultFolder, { recursive: true });
                    }
                    catch (e) { }
                }
                const defaultSettings = {
                    defaultBackupFolder: defaultFolder,
                    autoCompressZip: true,
                    maxParallelThreads: 4,
                    theme: 'dark',
                    updateShareRoot: 'C:\\ZeenIQTools\\ZeeniQDbToolsShare\\ZeeniQDbTools.git',
                    sourceGitRemote: '',
                    autoCheckUpdate: true,
                };
                const jsonStr = JSON.stringify(defaultSettings, null, 2);
                fs_1.default.writeFileSync(this.settingsFile, jsonStr, 'utf-8');
                this.syncToPortable('settings.json', jsonStr);
            }
        }
    }
    // Connections
    getConnections() {
        try {
            if (fs_1.default.existsSync(this.connectionsFile)) {
                const raw = fs_1.default.readFileSync(this.connectionsFile, 'utf-8');
                return JSON.parse(raw);
            }
        }
        catch (err) {
            console.error('Failed to read connections:', err);
        }
        return [];
    }
    saveConnection(conn) {
        const list = this.getConnections();
        const existingIndex = list.findIndex((c) => c.id === conn.id);
        if (existingIndex >= 0) {
            list[existingIndex] = { ...conn };
        }
        else {
            list.unshift(conn);
        }
        const jsonStr = JSON.stringify(list, null, 2);
        fs_1.default.writeFileSync(this.connectionsFile, jsonStr, 'utf-8');
        this.syncToPortable('connections.json', jsonStr);
        return conn;
    }
    deleteConnection(id) {
        const list = this.getConnections();
        const filtered = list.filter((c) => c.id !== id);
        const jsonStr = JSON.stringify(filtered, null, 2);
        fs_1.default.writeFileSync(this.connectionsFile, jsonStr, 'utf-8');
        this.syncToPortable('connections.json', jsonStr);
        return true;
    }
    getConnectionById(id) {
        return this.getConnections().find((c) => c.id === id);
    }
    // History
    getHistory() {
        try {
            if (fs_1.default.existsSync(this.historyFile)) {
                const raw = fs_1.default.readFileSync(this.historyFile, 'utf-8');
                return JSON.parse(raw);
            }
        }
        catch (err) {
            console.error('Failed to read history:', err);
        }
        return [];
    }
    addHistoryItem(item) {
        const list = this.getHistory();
        list.unshift(item);
        if (list.length > 500) {
            list.length = 500;
        }
        const jsonStr = JSON.stringify(list, null, 2);
        fs_1.default.writeFileSync(this.historyFile, jsonStr, 'utf-8');
        this.syncToPortable('history.json', jsonStr);
    }
    deleteHistoryItem(id) {
        const list = this.getHistory();
        const filtered = list.filter((h) => h.id !== id);
        const jsonStr = JSON.stringify(filtered, null, 2);
        fs_1.default.writeFileSync(this.historyFile, jsonStr, 'utf-8');
        this.syncToPortable('history.json', jsonStr);
        return true;
    }
    clearHistory() {
        const jsonStr = JSON.stringify([], null, 2);
        fs_1.default.writeFileSync(this.historyFile, jsonStr, 'utf-8');
        this.syncToPortable('history.json', jsonStr);
    }
    // Schedules
    getSchedules() {
        try {
            if (fs_1.default.existsSync(this.schedulesFile)) {
                const raw = fs_1.default.readFileSync(this.schedulesFile, 'utf-8');
                return JSON.parse(raw);
            }
        }
        catch (err) {
            console.error('Failed to read schedules:', err);
        }
        return [];
    }
    saveSchedule(schedule) {
        const list = this.getSchedules();
        const existingIdx = list.findIndex((s) => s.id === schedule.id);
        if (existingIdx >= 0) {
            list[existingIdx] = { ...schedule };
        }
        else {
            list.push(schedule);
        }
        const jsonStr = JSON.stringify(list, null, 2);
        fs_1.default.writeFileSync(this.schedulesFile, jsonStr, 'utf-8');
        this.syncToPortable('schedules.json', jsonStr);
        return schedule;
    }
    deleteSchedule(id) {
        const list = this.getSchedules();
        const filtered = list.filter((s) => s.id !== id);
        const jsonStr = JSON.stringify(filtered, null, 2);
        fs_1.default.writeFileSync(this.schedulesFile, jsonStr, 'utf-8');
        this.syncToPortable('schedules.json', jsonStr);
        return true;
    }
    // Settings
    getSettings() {
        try {
            if (fs_1.default.existsSync(this.settingsFile)) {
                const raw = fs_1.default.readFileSync(this.settingsFile, 'utf-8');
                return JSON.parse(raw);
            }
        }
        catch (err) {
            console.error('Failed to read settings:', err);
        }
        const defaultFolder = path_1.default.join(electron_1.app ? electron_1.app.getPath('documents') : process.cwd(), 'OracleBackups');
        return {
            defaultBackupFolder: defaultFolder,
            autoCompressZip: true,
            maxParallelThreads: 4,
            theme: 'dark',
            updateShareRoot: 'C:\\ZeenIQTools\\ZeeniQDbToolsShare\\ZeeniQDbTools.git',
            sourceGitRemote: '',
            autoCheckUpdate: true,
        };
    }
    saveSettings(settings) {
        const current = this.getSettings();
        const updated = { ...current, ...settings };
        const jsonStr = JSON.stringify(updated, null, 2);
        fs_1.default.writeFileSync(this.settingsFile, jsonStr, 'utf-8');
        this.syncToPortable('settings.json', jsonStr);
        return updated;
    }
}
exports.StorageService = StorageService;
