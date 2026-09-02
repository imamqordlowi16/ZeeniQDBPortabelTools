"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electronAPI = {
    // Oracle DB Operations
    testConnection: (config) => electron_1.ipcRenderer.invoke('oracle:test-connection', config),
    getSchemas: (config) => electron_1.ipcRenderer.invoke('oracle:get-schemas', config),
    getSchemaObjects: (config, schemaName) => electron_1.ipcRenderer.invoke('oracle:get-schema-objects', config, schemaName),
    getObjectDDL: (config, schemaName, objectType, objectName) => electron_1.ipcRenderer.invoke('oracle:get-object-ddl', config, schemaName, objectType, objectName),
    getTableLiveRowCount: (config, schemaName, tableName) => electron_1.ipcRenderer.invoke('oracle:get-table-live-count', config, schemaName, tableName),
    executeQuery: (config, sql, maxRows) => electron_1.ipcRenderer.invoke('oracle:execute-query', config, sql, maxRows),
    importData: (config, options) => electron_1.ipcRenderer.invoke('oracle:import-data', config, options),
    // Schema Compare & Selective Sync
    compareSchemas: (sourceConfig, sourceSchema, targetConfig, targetSchema) => electron_1.ipcRenderer.invoke('compare:run', sourceConfig, sourceSchema, targetConfig, targetSchema),
    generateMigrationSql: (sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData) => electron_1.ipcRenderer.invoke('compare:generate-sql', sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData),
    executeSync: (sourceConfig, sourceSchema, targetConfig, targetSchema, options, selectedItems) => electron_1.ipcRenderer.invoke('compare:execute-sync', sourceConfig, sourceSchema, targetConfig, targetSchema, options, selectedItems),
    cancelSync: (jobId) => electron_1.ipcRenderer.invoke('compare:cancel', jobId),
    // Backup
    startSqlBackup: (config, options) => electron_1.ipcRenderer.invoke('backup:start-sql', config, options),
    startDataPumpBackup: (config, options) => electron_1.ipcRenderer.invoke('backup:start-datapump', config, options),
    cancelBackup: (jobId) => electron_1.ipcRenderer.invoke('backup:cancel', jobId),
    // Restore
    startSqlRestore: (config, options) => electron_1.ipcRenderer.invoke('restore:start-sql', config, options),
    startDataPumpRestore: (config, options) => electron_1.ipcRenderer.invoke('restore:start-datapump', config, options),
    cancelRestore: (jobId) => electron_1.ipcRenderer.invoke('restore:cancel', jobId),
    // Event Listeners
    onLogMessage: (callback) => {
        const listener = (_, log) => callback(log);
        electron_1.ipcRenderer.on('log:message', listener);
        return () => electron_1.ipcRenderer.removeListener('log:message', listener);
    },
    onJobProgress: (callback) => {
        const listener = (_, progress) => callback(progress);
        electron_1.ipcRenderer.on('job:progress', listener);
        return () => electron_1.ipcRenderer.removeListener('job:progress', listener);
    },
    // Storage: Connections
    getConnections: () => electron_1.ipcRenderer.invoke('storage:get-connections'),
    saveConnection: (conn) => electron_1.ipcRenderer.invoke('storage:save-connection', conn),
    deleteConnection: (id) => electron_1.ipcRenderer.invoke('storage:delete-connection', id),
    // Storage: History
    getHistory: () => electron_1.ipcRenderer.invoke('storage:get-history'),
    deleteHistoryItem: (id) => electron_1.ipcRenderer.invoke('storage:delete-history', id),
    clearHistory: () => electron_1.ipcRenderer.invoke('storage:clear-history'),
    // Storage: Schedules
    getSchedules: () => electron_1.ipcRenderer.invoke('storage:get-schedules'),
    saveSchedule: (schedule) => electron_1.ipcRenderer.invoke('storage:save-schedule', schedule),
    deleteSchedule: (id) => electron_1.ipcRenderer.invoke('storage:delete-schedule', id),
    runScheduleNow: (id) => electron_1.ipcRenderer.invoke('storage:run-schedule-now', id),
    // Storage: Settings & Binaries
    getSettings: () => electron_1.ipcRenderer.invoke('storage:get-settings'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('storage:save-settings', settings),
    detectOracleBinaries: (customPath) => electron_1.ipcRenderer.invoke('oracle:detect-binaries', customPath),
    // Native Dialogs & Shell
    selectFolder: (title) => electron_1.ipcRenderer.invoke('dialog:select-folder', title),
    selectFile: (title, filters) => electron_1.ipcRenderer.invoke('dialog:select-file', title, filters),
    openPath: (filePath) => electron_1.ipcRenderer.invoke('shell:open-path', filePath),
    showItemInFolder: (filePath) => electron_1.ipcRenderer.invoke('shell:show-item-in-folder', filePath),
    // Windows Sandbox
    sandboxGetStatus: () => electron_1.ipcRenderer.invoke('sandbox:get-status'),
    sandboxLaunch: (config) => electron_1.ipcRenderer.invoke('sandbox:launch', config),
    sandboxGenerateWsb: (targetPath, config) => electron_1.ipcRenderer.invoke('sandbox:generate-wsb', targetPath, config),
    sandboxEnableFeature: () => electron_1.ipcRenderer.invoke('sandbox:enable-feature'),
    // Dual Network Routing
    networkGetDiagnostics: (corpHost) => electron_1.ipcRenderer.invoke('network:get-diagnostics', corpHost),
    networkGenerateScripts: (config) => electron_1.ipcRenderer.invoke('network:generate-scripts', config),
    networkApplyRouting: (config) => electron_1.ipcRenderer.invoke('network:apply-routing', config),
    networkResetRouting: (config) => electron_1.ipcRenderer.invoke('network:reset-routing', config),
    // Self-Updating Application Engine
    checkForUpdate: (remote) => electron_1.ipcRenderer.invoke('update:check', remote),
    applyUpdate: (remote) => electron_1.ipcRenderer.invoke('update:apply', remote),
    publishUpdate: (remote, newVersion) => electron_1.ipcRenderer.invoke('update:publish', remote, newVersion),
    publishSource: (remote) => electron_1.ipcRenderer.invoke('update:publish-source', remote),
    verifyPin: (pin) => electron_1.ipcRenderer.invoke('update:verify-pin', pin),
    getCurrentVersion: () => electron_1.ipcRenderer.invoke('update:get-version'),
    saveVersion: (version) => electron_1.ipcRenderer.invoke('update:save-version', version),
    openUpdateLog: () => electron_1.ipcRenderer.invoke('update:open-log'),
    onUpdateLogMessage: (callback) => {
        const listener = (_, log) => callback(log);
        electron_1.ipcRenderer.on('update:log', listener);
        return () => electron_1.ipcRenderer.removeListener('update:log', listener);
    },
    // System Tools
    toolsListScripts: () => electron_1.ipcRenderer.invoke('tools:list-scripts'),
    toolsRunScript: (scriptKey) => electron_1.ipcRenderer.invoke('tools:run-script', scriptKey),
    onToolsOutput: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('tools:output', listener);
        return () => electron_1.ipcRenderer.removeListener('tools:output', listener);
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
