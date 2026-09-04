"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const storageService_1 = require("./services/storageService");
const oracleService_1 = require("./services/oracleService");
const datapumpService_1 = require("./services/datapumpService");
const schedulerService_1 = require("./services/schedulerService");
const sandboxService_1 = require("./services/sandboxService");
const networkService_1 = require("./services/networkService");
const appVersionService_1 = require("./services/appVersionService");
const publishAccessService_1 = require("./services/publishAccessService");
const updateService_1 = require("./services/updateService");
const txtBundleService_1 = require("./services/txtBundleService");
function writeLog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    try {
        fs_1.default.appendFileSync(path_1.default.join(process.cwd(), 'app-runtime.log'), line);
    }
    catch (e) { }
    try {
        if (electron_1.app && electron_1.app.isReady()) {
            fs_1.default.appendFileSync(path_1.default.join(electron_1.app.getPath('userData'), 'app-runtime.log'), line);
        }
    }
    catch (e) { }
}
process.on('uncaughtException', (err) => {
    writeLog(`[UNCAUGHT EXCEPTION] ${err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
    writeLog(`[UNHANDLED REJECTION] ${reason}`);
});
writeLog('Application bootstrap starting...');
let mainWindow = null;
let storageService;
let oracleService;
let datapumpService;
let schedulerService;
let sandboxService;
let networkService;
let txtBundleService;
function initServices() {
    try {
        storageService = new storageService_1.StorageService();
        oracleService = new oracleService_1.OracleService();
        datapumpService = new datapumpService_1.DataPumpService();
        schedulerService = new schedulerService_1.SchedulerService(storageService, oracleService, datapumpService);
        sandboxService = new sandboxService_1.SandboxService();
        networkService = new networkService_1.NetworkService();
        txtBundleService = new txtBundleService_1.TxtBundleService(oracleService);
        writeLog('Services initialized successfully');
    }
    catch (err) {
        writeLog(`[ERROR] Service initialization failed: ${err?.stack || err}`);
    }
}
function createWindow() {
    writeLog('Creating BrowserWindow...');
    mainWindow = new electron_1.BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 1050,
        minHeight: 700,
        title: 'ZeenIQ Oracle Backup & Restore Studio',
        backgroundColor: '#0B0F17',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
        },
    });
    mainWindow.removeMenu();
    mainWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
        writeLog(`[RENDERER LOAD FAILED] code=${code} desc=${desc} url=${url}`);
    });
    mainWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
        writeLog(`[RENDERER CONSOLE] (${level}) ${message} [${sourceId}:${line}]`);
    });
    mainWindow.webContents.on('render-process-gone', (e, details) => {
        writeLog(`[RENDER PROCESS GONE] reason=${details.reason} exitCode=${details.exitCode}`);
    });
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
        writeLog(`Loading dev URL: ${devServerUrl}`);
        mainWindow.loadURL(devServerUrl);
    }
    else {
        const htmlPath = path_1.default.join(__dirname, '../dist/index.html');
        writeLog(`Loading production HTML: ${htmlPath} (exists=${fs_1.default.existsSync(htmlPath)})`);
        mainWindow.loadFile(htmlPath);
    }
    mainWindow.on('closed', () => {
        writeLog('MainWindow closed');
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(() => {
    writeLog('app.whenReady resolved');
    initServices();
    createWindow();
    if (schedulerService) {
        schedulerService.init();
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    writeLog('All windows closed event');
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// Helper to broadcast log & progress to renderer
const sendLog = (log) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log:message', log);
    }
};
const sendProgress = (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('job:progress', progress);
    }
};
const sendUpdateLog = (type, message) => {
    const timestamp = new Date().toTimeString().split(' ')[0];
    const item = { timestamp, type, message };
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:log', item);
    }
};
// ==================== ORACLE IPC HANDLERS ====================
electron_1.ipcMain.handle('oracle:test-connection', async (_, config) => {
    return await oracleService.testConnection(config);
});
electron_1.ipcMain.handle('oracle:get-schemas', async (_, config) => {
    return await oracleService.getSchemas(config);
});
electron_1.ipcMain.handle('oracle:get-schema-objects', async (_, config, schemaName) => {
    return await oracleService.getSchemaObjects(config, schemaName);
});
electron_1.ipcMain.handle('oracle:get-object-ddl', async (_, config, schemaName, objectType, objectName) => {
    return await oracleService.getObjectDDL(config, schemaName, objectType, objectName);
});
electron_1.ipcMain.handle('oracle:get-table-live-count', async (_, config, schemaName, tableName) => {
    return await oracleService.getTableLiveRowCount(config, schemaName, tableName);
});
electron_1.ipcMain.handle('oracle:detect-binaries', async (_, customPath) => {
    return datapumpService.detectOracleBinaries(customPath);
});
electron_1.ipcMain.handle('oracle:execute-query', async (_, config, sql, maxRows) => {
    return await oracleService.executeQuery(config, sql, maxRows);
});
electron_1.ipcMain.handle('oracle:import-data', async (_, config, options) => {
    return await oracleService.importDataBatch(config, options);
});
// ==================== AI COPILOT HANDLERS ====================
electron_1.ipcMain.handle('ai:call-provider', async (_, params) => {
    const startTime = Date.now();
    const { provider, apiKey, model, systemPrompt, userPrompt } = params;
    if (!apiKey || !apiKey.trim()) {
        return { success: false, error: 'API Key belum diisi. Silakan masukkan API Key di Pengaturan AI.' };
    }
    try {
        if (provider === 'gemini') {
            const selectedModel = model === 'gemini-2.5-flash' ? 'gemini-3.6-flash' : (model || 'gemini-3.6-flash');
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    },
                    contents: [
                        {
                            parts: [{ text: userPrompt }]
                        }
                    ],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 2048,
                    }
                })
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.error?.message || `Google Gemini API error (HTTP ${res.status})`;
                return { success: false, error: msg, latencyMs: Date.now() - startTime };
            }
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            return { success: true, content: text, latencyMs: Date.now() - startTime };
        }
        else if (provider === 'claude') {
            const selectedModel = model || 'claude-3-7-sonnet-latest';
            const endpoint = 'https://api.anthropic.com/v1/messages';
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey.trim(),
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: selectedModel,
                    max_tokens: 2048,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userPrompt }
                    ]
                })
            });
            const data = await res.json();
            if (!res.ok) {
                const msg = data.error?.message || `Anthropic Claude API error (HTTP ${res.status})`;
                return { success: false, error: msg, latencyMs: Date.now() - startTime };
            }
            const text = data.content?.[0]?.text || '';
            return { success: true, content: text, latencyMs: Date.now() - startTime };
        }
        return { success: false, error: `Provider AI "${provider}" tidak didukung.` };
    }
    catch (err) {
        return { success: false, error: err.message || 'Gagal menghubungi server AI.', latencyMs: Date.now() - startTime };
    }
});
// ==================== SCHEMA COMPARE & SYNC HANDLERS ====================
electron_1.ipcMain.handle('compare:run', async (_, sourceConfig, sourceSchema, targetConfig, targetSchema) => {
    return await oracleService.compareSchemas(sourceConfig, sourceSchema, targetConfig, targetSchema);
});
electron_1.ipcMain.handle('compare:generate-sql', async (_, sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData) => {
    return await oracleService.generateMigrationSql(sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData);
});
electron_1.ipcMain.handle('compare:execute-sync', async (_, sourceConfig, sourceSchema, targetConfig, targetSchema, options, selectedItems) => {
    const startTime = Date.now();
    const res = await oracleService.executeSync(sourceConfig, sourceSchema, targetConfig, targetSchema, options, selectedItems, sendLog, sendProgress);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    // Save to history
    const historyItem = {
        id: `hist-${Date.now()}`,
        jobId: options.jobId,
        type: 'sync',
        mode: 'schema_sync',
        connectionName: `${sourceConfig.name} -> ${targetConfig.name}`,
        target: `${sourceSchema} -> ${targetSchema} (${selectedItems.length} objects)`,
        timestamp: new Date().toISOString(),
        durationSeconds: duration,
        status: res.success ? 'success' : 'failed',
        filePath: '',
        fileSizeFormatted: '',
        logSummary: res.success
            ? `Successfully synced ${selectedItems.length} object(s) to ${targetSchema}`
            : `Sync failed: ${res.error}`,
    };
    storageService.addHistoryItem(historyItem);
    return res;
});
electron_1.ipcMain.handle('compare:cancel', async (_, jobId) => {
    oracleService.cancelJob(jobId);
    return true;
});
// ==================== BACKUP IPC HANDLERS ====================
electron_1.ipcMain.handle('backup:start-sql', async (_, config, options) => {
    const startTime = Date.now();
    const res = await oracleService.runSqlBackup(config, options, sendLog, sendProgress);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    let fileSizeFormatted = '0 KB';
    if (res.filePath && fs_1.default.existsSync(res.filePath)) {
        const bytes = fs_1.default.statSync(res.filePath).size;
        fileSizeFormatted = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }
    const historyItem = {
        id: `hist-${Date.now()}`,
        jobId: options.jobId,
        type: 'backup',
        mode: 'sql_ddl_data',
        connectionName: config.name,
        target: options.scope === 'full' ? 'FULL DB' : options.targetSchemas.join(', '),
        timestamp: new Date().toISOString(),
        durationSeconds: duration,
        status: res.success ? 'success' : 'failed',
        filePath: res.filePath || '',
        fileSizeFormatted,
        logSummary: res.success ? 'SQL/DDL direct backup completed' : `Failed: ${res.error}`,
    };
    storageService.addHistoryItem(historyItem);
    return res;
});
electron_1.ipcMain.handle('backup:start-datapump', async (_, config, options) => {
    const settings = storageService.getSettings();
    const startTime = Date.now();
    const res = await datapumpService.runExpdp(config, options, settings.expdpPath, sendLog, sendProgress);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    let fileSizeFormatted = '0 KB';
    if (res.filePath && fs_1.default.existsSync(res.filePath)) {
        const bytes = fs_1.default.statSync(res.filePath).size;
        fileSizeFormatted = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }
    const historyItem = {
        id: `hist-${Date.now()}`,
        jobId: options.jobId,
        type: 'backup',
        mode: 'datapump',
        connectionName: config.name,
        target: options.scope === 'full' ? 'FULL DB' : options.targetSchemas.join(', '),
        timestamp: new Date().toISOString(),
        durationSeconds: duration,
        status: res.success ? 'success' : 'failed',
        filePath: res.filePath || '',
        fileSizeFormatted,
        logSummary: res.success ? 'Data Pump expdp completed' : `Failed: ${res.error}`,
    };
    storageService.addHistoryItem(historyItem);
    return res;
});
electron_1.ipcMain.handle('backup:cancel', async (_, jobId) => {
    oracleService.cancelJob(jobId);
    datapumpService.cancelJob(jobId);
    return true;
});
// ==================== RESTORE IPC HANDLERS ====================
electron_1.ipcMain.handle('restore:start-sql', async (_, config, options) => {
    const startTime = Date.now();
    const res = await oracleService.runSqlRestore(config, options, sendLog, sendProgress);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const historyItem = {
        id: `hist-${Date.now()}`,
        jobId: options.jobId,
        type: 'restore',
        mode: 'sql_script',
        connectionName: config.name,
        target: path_1.default.basename(options.backupFilePath),
        timestamp: new Date().toISOString(),
        durationSeconds: duration,
        status: res.success ? 'success' : 'failed',
        filePath: options.backupFilePath,
        fileSizeFormatted: '',
        logSummary: res.success ? 'SQL script restored successfully' : `Restore failed: ${res.error}`,
    };
    storageService.addHistoryItem(historyItem);
    return res;
});
electron_1.ipcMain.handle('restore:start-datapump', async (_, config, options) => {
    const settings = storageService.getSettings();
    const startTime = Date.now();
    const res = await datapumpService.runImpdp(config, options, settings.impdpPath, sendLog, sendProgress);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const historyItem = {
        id: `hist-${Date.now()}`,
        jobId: options.jobId,
        type: 'restore',
        mode: 'datapump',
        connectionName: config.name,
        target: path_1.default.basename(options.backupFilePath),
        timestamp: new Date().toISOString(),
        durationSeconds: duration,
        status: res.success ? 'success' : 'failed',
        filePath: options.backupFilePath,
        fileSizeFormatted: '',
        logSummary: res.success ? 'Data Pump impdp restored successfully' : `Restore failed: ${res.error}`,
    };
    storageService.addHistoryItem(historyItem);
    return res;
});
electron_1.ipcMain.handle('restore:cancel', async (_, jobId) => {
    oracleService.cancelJob(jobId);
    datapumpService.cancelJob(jobId);
    return true;
});
// ==================== STORAGE IPC HANDLERS ====================
electron_1.ipcMain.handle('storage:get-connections', async () => storageService.getConnections());
electron_1.ipcMain.handle('storage:save-connection', async (_, conn) => storageService.saveConnection(conn));
electron_1.ipcMain.handle('storage:delete-connection', async (_, id) => storageService.deleteConnection(id));
electron_1.ipcMain.handle('storage:get-history', async () => storageService.getHistory());
electron_1.ipcMain.handle('storage:delete-history', async (_, id) => storageService.deleteHistoryItem(id));
electron_1.ipcMain.handle('storage:clear-history', async () => storageService.clearHistory());
electron_1.ipcMain.handle('storage:get-schedules', async () => storageService.getSchedules());
electron_1.ipcMain.handle('storage:save-schedule', async (_, schedule) => {
    const res = storageService.saveSchedule(schedule);
    schedulerService.reloadSchedules();
    return res;
});
electron_1.ipcMain.handle('storage:delete-schedule', async (_, id) => {
    const res = storageService.deleteSchedule(id);
    schedulerService.reloadSchedules();
    return res;
});
electron_1.ipcMain.handle('storage:run-schedule-now', async (_, id) => {
    return await schedulerService.executeScheduledBackup(id);
});
electron_1.ipcMain.handle('storage:get-settings', async () => storageService.getSettings());
electron_1.ipcMain.handle('storage:save-settings', async (_, settings) => storageService.saveSettings(settings));
// ==================== DIALOG & SHELL IPC HANDLERS ====================
electron_1.ipcMain.handle('dialog:select-folder', async (_, title) => {
    if (!mainWindow)
        return null;
    const res = await electron_1.dialog.showOpenDialog(mainWindow, {
        title: title || 'Select Folder',
        properties: ['openDirectory', 'createDirectory'],
    });
    if (!res.canceled && res.filePaths.length > 0) {
        return res.filePaths[0];
    }
    return null;
});
electron_1.ipcMain.handle('dialog:select-file', async (_, title, filters) => {
    if (!mainWindow)
        return null;
    const res = await electron_1.dialog.showOpenDialog(mainWindow, {
        title: title || 'Select File',
        properties: ['openFile'],
        filters: filters || [
            { name: 'All Backup Files (*.dmp, *.sql, *.zip)', extensions: ['dmp', 'sql', 'zip'] },
            { name: 'Oracle Dump Files (*.dmp)', extensions: ['dmp'] },
            { name: 'SQL Script Files (*.sql)', extensions: ['sql'] },
            { name: 'ZIP Archives (*.zip)', extensions: ['zip'] },
            { name: 'All Files (*.*)', extensions: ['*'] },
        ],
    });
    if (!res.canceled && res.filePaths.length > 0) {
        return res.filePaths[0];
    }
    return null;
});
electron_1.ipcMain.handle('dialog:select-txt-files', async (_, title) => {
    if (!mainWindow)
        return [];
    const res = await electron_1.dialog.showOpenDialog(mainWindow, {
        title: title || 'Pilih File TXT / Data License',
        properties: ['openFile', 'multiSelections'],
        filters: [
            { name: 'Data Files (*.txt, *.reg, *.csv, *.tsv, *.dat)', extensions: ['txt', 'reg', 'csv', 'tsv', 'dat'] },
            { name: 'Text Files (*.txt)', extensions: ['txt'] },
            { name: 'All Files (*.*)', extensions: ['*'] },
        ],
    });
    if (!res.canceled && res.filePaths.length > 0) {
        return res.filePaths;
    }
    return [];
});
// ==================== TXT BUNDLE IMPORTER HANDLERS ====================
electron_1.ipcMain.handle('txt-bundle:analyze', async (_, sourcePathOrFiles) => {
    return await txtBundleService.analyzeBundle(sourcePathOrFiles);
});
electron_1.ipcMain.handle('txt-bundle:import', async (_, config, options) => {
    return await txtBundleService.executeBundleImport(config, options, (progress) => {
        mainWindow?.webContents.send('txt-bundle:progress', progress);
    });
});
electron_1.ipcMain.handle('shell:open-path', async (_, targetPath) => {
    return await electron_1.shell.openPath(targetPath);
});
electron_1.ipcMain.handle('shell:show-item-in-folder', async (_, targetPath) => {
    electron_1.shell.showItemInFolder(targetPath);
    return true;
});
// ==================== WINDOWS SANDBOX IPC HANDLERS ====================
electron_1.ipcMain.handle('sandbox:get-status', async () => {
    return sandboxService.checkStatus();
});
electron_1.ipcMain.handle('sandbox:launch', async (_, config) => {
    return await sandboxService.launchSandbox(config);
});
electron_1.ipcMain.handle('sandbox:generate-wsb', async (_, targetPath, config) => {
    return sandboxService.saveWsbFile(targetPath, config);
});
electron_1.ipcMain.handle('sandbox:enable-feature', async () => {
    return await sandboxService.enableWindowsSandbox();
});
// ==================== DUAL NETWORK ROUTING IPC HANDLERS ====================
electron_1.ipcMain.handle('network:get-diagnostics', async (_, corpHost) => {
    return await networkService.runDiagnostics(corpHost);
});
electron_1.ipcMain.handle('network:generate-scripts', async (_, config) => {
    return networkService.generateDualNetworkScripts(config);
});
electron_1.ipcMain.handle('network:apply-routing', async (_, config) => {
    return await networkService.applyRouting(config);
});
electron_1.ipcMain.handle('network:reset-routing', async (_, config) => {
    return await networkService.resetRouting(config);
});
// ==================== SELF-UPDATE ENGINE IPC HANDLERS ====================
electron_1.ipcMain.handle('update:get-version', async () => {
    return appVersionService_1.AppVersionService.getCurrentVersion();
});
electron_1.ipcMain.handle('update:save-version', async (_, version) => {
    return appVersionService_1.AppVersionService.setVersion(version);
});
electron_1.ipcMain.handle('update:verify-pin', async (_, pin) => {
    return publishAccessService_1.PublishAccessService.verifyPin(pin);
});
electron_1.ipcMain.handle('update:check', async (_, customRemote) => {
    const settings = storageService.getSettings();
    const remote = customRemote ||
        settings.updateShareRoot ||
        'https://github.com/imamqordlowi16/ZeeniQDBPortabelTools.git';
    const appFolder = updateService_1.UpdateService.getAppFolder();
    sendUpdateLog('info', `Memeriksa pembaruan dari: ${remote}...`);
    try {
        const info = await updateService_1.UpdateService.checkForUpdate(appFolder, remote);
        if (info.error) {
            sendUpdateLog('error', `Gagal cek update: ${info.error}`);
        }
        else if (info.available) {
            sendUpdateLog('warning', `Update tersedia: ${info.commitsBehind} commit baru di remote (v${info.remoteVersion || 'terbaru'}).`);
        }
        else {
            sendUpdateLog('success', `Aplikasi sudah versi terbaru (v${info.currentVersion}).`);
        }
        return info;
    }
    catch (e) {
        sendUpdateLog('error', `Error saat cek update: ${e.message}`);
        return {
            available: false,
            commitsBehind: 0,
            currentVersion: appVersionService_1.AppVersionService.getCurrentVersion(),
            error: e.message,
        };
    }
});
electron_1.ipcMain.handle('update:apply', async (_, customRemote) => {
    const settings = storageService.getSettings();
    const remote = customRemote ||
        settings.updateShareRoot ||
        'https://github.com/imamqordlowi16/ZeeniQDBPortabelTools.git';
    const appFolder = updateService_1.UpdateService.getAppFolder();
    sendUpdateLog('info', `Mempersiapkan proses instalasi update ke ${appFolder}...`);
    updateService_1.UpdateService.launchUpdaterAndExit(remote, appFolder);
});
electron_1.ipcMain.handle('update:publish', async (_, remote, newVersion) => {
    if (newVersion && newVersion.trim()) {
        appVersionService_1.AppVersionService.setVersion(newVersion.trim());
    }
    const appFolder = updateService_1.UpdateService.getAppFolder();
    sendUpdateLog('cmd', `Memulai publish update aplikasi ke remote ${remote}...`);
    try {
        await updateService_1.UpdateService.publishToShare(appFolder, remote, (msg) => {
            sendUpdateLog('info', msg);
        });
        sendUpdateLog('success', `Publish update berhasil selesai.`);
        return { success: true };
    }
    catch (e) {
        sendUpdateLog('error', `Publish update gagal: ${e.message}`);
        return { success: false, error: e.message };
    }
});
electron_1.ipcMain.handle('update:publish-source', async (_, remote) => {
    const sourceRoot = updateService_1.UpdateService.getSourceRoot();
    sendUpdateLog('cmd', `Memulai push source code ke remote ${remote}...`);
    try {
        await updateService_1.UpdateService.publishSource(sourceRoot, remote, (msg) => {
            sendUpdateLog('info', msg);
        });
        sendUpdateLog('success', `Push source code berhasil selesai.`);
        return { success: true };
    }
    catch (e) {
        sendUpdateLog('error', `Push source code gagal: ${e.message}`);
        return { success: false, error: e.message };
    }
});
electron_1.ipcMain.handle('update:open-log', async () => {
    const appFolder = updateService_1.UpdateService.getAppFolder();
    const possibleLogs = [
        path_1.default.join(appFolder, 'zeeniq_oracle_data', 'logs', 'update.log'),
        path_1.default.join(appFolder, 'Data', 'logs', 'update.log'),
        path_1.default.join(electron_1.app.getPath('userData'), 'zeeniq_oracle_data', 'logs', 'update.log'),
    ];
    const target = possibleLogs.find((p) => fs_1.default.existsSync(p));
    if (target) {
        await electron_1.shell.openPath(target);
        return true;
    }
    return false;
});
// ==================== SYSTEM TOOLS IPC HANDLERS ====================
// Registry of all available system tools
const SYSTEM_TOOLS_REGISTRY = {
    'aktifkan-relay-sangfor': {
        label: 'Aktifkan Relay Sangfor → Sandbox',
        script: 'Aktifkan-Relay-Sangfor-Sandbox.ps1',
        scriptType: 'ps1',
        requiresAdmin: true,
        description: 'Mengaktifkan port forwarding (portproxy) dari host ke dalam Windows Sandbox untuk akses Sangfor DB.',
        category: 'Sandbox & VPN',
    },
    'diagnosa-koneksi-db': {
        label: 'Diagnosa Koneksi DB',
        script: 'Diagnosa-Koneksi-DB.ps1',
        scriptType: 'ps1',
        requiresAdmin: false,
        description: 'Mengecek rute jaringan, interface aktif, dan test koneksi TCP ke Database Bank Indonesia (10.161.10.135).',
        category: 'Diagnostik',
    },
    'enable-windows-sandbox': {
        label: 'Enable Windows Sandbox',
        script: 'Enable-Windows-Sandbox.bat',
        scriptType: 'bat',
        requiresAdmin: true,
        description: 'Mengaktifkan fitur Windows Sandbox (Containers-DisposableClientVM) + Hyper-V. Mendukung Win10 dan Win11 semua edisi.',
        category: 'Sandbox & VPN',
    },
    'fix-windows-sandbox': {
        label: 'Fix Black Screen Sandbox',
        script: 'Fix-Windows-Sandbox.bat',
        scriptType: 'bat',
        requiresAdmin: true,
        description: 'Memperbaiki masalah layar hitam (black screen) saat membuka Windows Sandbox dengan reset registry dan layanan vmcompute.',
        category: 'Sandbox & VPN',
    },
    'kunci-rute-db-bi': {
        label: 'Kunci Rute DB BI ke Wi-Fi',
        script: 'Kunci-Rute-DB-BI.ps1',
        scriptType: 'ps1',
        requiresAdmin: true,
        description: 'Memaksa route 10.161.10.135 (DB Bank Indonesia) melewati kartu Wi-Fi. Mencegah Sangfor/Ethernet mencaplok jalur DB.',
        category: 'Network Routing',
    },
    'reset-network-routing': {
        label: 'Reset Network Routing',
        script: 'Reset-Network-Routing.ps1',
        scriptType: 'ps1',
        requiresAdmin: true,
        description: 'Mengembalikan semua metric interface dan static route ke kondisi default Windows. Gunakan jika jaringan kacau.',
        category: 'Network Routing',
    },
    'setup-dual-network': {
        label: 'Setup Dual Network',
        script: 'Setup-Dual-Network.ps1',
        scriptType: 'ps1',
        requiresAdmin: true,
        description: 'Konfigurasi lengkap dual-network: Internet via Ethernet, DB BI via Wi-Fi, DB Proyek via Sangfor — semuanya harmonis.',
        category: 'Network Routing',
    },
};
electron_1.ipcMain.handle('tools:list-scripts', async () => {
    return SYSTEM_TOOLS_REGISTRY;
});
electron_1.ipcMain.handle('tools:run-script', async (_, scriptKey, customParams, customCommand) => {
    const sendToolOutput = (line, streamType) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tools:output', { scriptKey, line, streamType, timestamp: new Date().toTimeString().split(' ')[0] });
        }
    };
    // 1. Custom PowerShell Execution
    if (scriptKey === 'custom' && customCommand && customCommand.trim()) {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            sendToolOutput(`▶ Menjalankan Perintah Kustom:\n  ${customCommand}`, 'system');
            const proc = spawn('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
                '-Command', customCommand,
            ], { windowsHide: false });
            proc.stdout?.on('data', (data) => {
                const lines = data.toString('utf8').split(/\r?\n/);
                lines.forEach((line) => { if (line.trim())
                    sendToolOutput(line, 'stdout'); });
            });
            proc.stderr?.on('data', (data) => {
                const lines = data.toString('utf8').split(/\r?\n/);
                lines.forEach((line) => { if (line.trim())
                    sendToolOutput(line, 'stderr'); });
            });
            proc.on('close', (code) => {
                sendToolOutput(`✔ Perintah selesai dengan exit code: ${code ?? 0}`, 'system');
                resolve({ success: (code ?? 0) === 0 });
            });
            proc.on('error', (err) => {
                sendToolOutput(`✖ Error: ${err.message}`, 'stderr');
                resolve({ success: false, error: err.message });
            });
        });
    }
    // 2. Predefined Tool Execution with Optional Parameter Injection
    const tool = SYSTEM_TOOLS_REGISTRY[scriptKey];
    if (!tool) {
        return { success: false, error: `Unknown script key: ${scriptKey}` };
    }
    // Resolve script path relative to app root
    const appRoot = electron_1.app.isPackaged ? path_1.default.dirname(process.execPath) : path_1.default.resolve(__dirname, '..', '..');
    const scriptPath = path_1.default.join(appRoot, tool.script);
    if (!fs_1.default.existsSync(scriptPath)) {
        return { success: false, error: `Script not found: ${scriptPath}` };
    }
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        let proc;
        if (tool.scriptType === 'ps1') {
            const psArgs = [
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy', 'Bypass',
            ];
            // Build robust PowerShell execution wrapper using UTF-16LE Base64 EncodedCommand
            let scriptCode = `$env:ZEENIQ_NONINTERACTIVE = "1"\n`;
            if (customParams && Object.keys(customParams).length > 0) {
                for (const [k, v] of Object.entries(customParams)) {
                    if (typeof v === 'number') {
                        scriptCode += `$${k} = ${v}\n`;
                    }
                    else if (typeof v === 'boolean') {
                        scriptCode += `$${k} = $${v ? 'true' : 'false'}\n`;
                    }
                    else {
                        const escapedStr = String(v ?? '').replace(/["`$]/g, '`$&');
                        scriptCode += `$${k} = "${escapedStr}"\n`;
                    }
                }
            }
            scriptCode += `& "${scriptPath.replace(/["`$]/g, '`$&')}" -NoPause\n`;
            const encodedCommand = Buffer.from(scriptCode, 'utf16le').toString('base64');
            psArgs.push('-EncodedCommand', encodedCommand);
            proc = spawn('powershell.exe', psArgs, { windowsHide: false });
        }
        else {
            // .bat file
            proc = spawn('cmd.exe', ['/c', scriptPath], { windowsHide: false });
        }
        sendToolOutput(`▶ Menjalankan: ${tool.script}${customParams ? ` (Parameter: ${JSON.stringify(customParams)})` : ''}`, 'system');
        proc.stdout?.on('data', (data) => {
            const lines = data.toString('utf8').split(/\r?\n/);
            lines.forEach((line) => { if (line.trim())
                sendToolOutput(line, 'stdout'); });
        });
        proc.stderr?.on('data', (data) => {
            const lines = data.toString('utf8').split(/\r?\n/);
            lines.forEach((line) => { if (line.trim())
                sendToolOutput(line, 'stderr'); });
        });
        proc.on('close', (code) => {
            sendToolOutput(`✔ Selesai dengan exit code: ${code ?? 0}`, 'system');
            resolve({ success: (code ?? 0) === 0 });
        });
        proc.on('error', (err) => {
            sendToolOutput(`✖ Error: ${err.message}`, 'stderr');
            resolve({ success: false, error: err.message });
        });
    });
});
