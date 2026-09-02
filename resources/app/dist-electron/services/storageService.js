"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
class StorageService {
    baseDir;
    connectionsFile;
    historyFile;
    schedulesFile;
    settingsFile;
    constructor() {
        this.baseDir = electron_1.app ? path_1.default.join(electron_1.app.getPath('userData'), 'zeeniq_oracle_data') : path_1.default.join(process.cwd(), '.data');
        if (!fs_1.default.existsSync(this.baseDir)) {
            fs_1.default.mkdirSync(this.baseDir, { recursive: true });
        }
        this.connectionsFile = path_1.default.join(this.baseDir, 'connections.json');
        this.historyFile = path_1.default.join(this.baseDir, 'history.json');
        this.schedulesFile = path_1.default.join(this.baseDir, 'schedules.json');
        this.settingsFile = path_1.default.join(this.baseDir, 'settings.json');
        this.initializeDefaults();
    }
    initializeDefaults() {
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
            fs_1.default.writeFileSync(this.connectionsFile, JSON.stringify(defaultConnections, null, 2), 'utf-8');
        }
        if (!fs_1.default.existsSync(this.historyFile)) {
            fs_1.default.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf-8');
        }
        if (!fs_1.default.existsSync(this.schedulesFile)) {
            fs_1.default.writeFileSync(this.schedulesFile, JSON.stringify([], null, 2), 'utf-8');
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
            fs_1.default.writeFileSync(this.settingsFile, JSON.stringify(defaultSettings, null, 2), 'utf-8');
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
        fs_1.default.writeFileSync(this.connectionsFile, JSON.stringify(list, null, 2), 'utf-8');
        return conn;
    }
    deleteConnection(id) {
        const list = this.getConnections();
        const filtered = list.filter((c) => c.id !== id);
        fs_1.default.writeFileSync(this.connectionsFile, JSON.stringify(filtered, null, 2), 'utf-8');
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
        fs_1.default.writeFileSync(this.historyFile, JSON.stringify(list, null, 2), 'utf-8');
    }
    deleteHistoryItem(id) {
        const list = this.getHistory();
        const filtered = list.filter((h) => h.id !== id);
        fs_1.default.writeFileSync(this.historyFile, JSON.stringify(filtered, null, 2), 'utf-8');
        return true;
    }
    clearHistory() {
        fs_1.default.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf-8');
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
        fs_1.default.writeFileSync(this.schedulesFile, JSON.stringify(list, null, 2), 'utf-8');
        return schedule;
    }
    deleteSchedule(id) {
        const list = this.getSchedules();
        const filtered = list.filter((s) => s.id !== id);
        fs_1.default.writeFileSync(this.schedulesFile, JSON.stringify(filtered, null, 2), 'utf-8');
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
        fs_1.default.writeFileSync(this.settingsFile, JSON.stringify(updated, null, 2), 'utf-8');
        return updated;
    }
}
exports.StorageService = StorageService;
