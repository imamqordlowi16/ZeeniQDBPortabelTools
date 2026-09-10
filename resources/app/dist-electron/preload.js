"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electronAPI = {
    // SSH Tunnel Operations
    testSshConnection: (config) => electron_1.ipcRenderer.invoke('ssh:test-connection', config),
    // Oracle DB Operations
    testConnection: (config) => electron_1.ipcRenderer.invoke('oracle:test-connection', config),
    getSchemas: (config) => electron_1.ipcRenderer.invoke('oracle:get-schemas', config),
    getSchemaObjects: (config, schemaName) => electron_1.ipcRenderer.invoke('oracle:get-schema-objects', config, schemaName),
    getSchemaTableColumns: (config, schemaName) => electron_1.ipcRenderer.invoke('oracle:get-schema-table-columns', config, schemaName),
    getDetailedSchemaColumns: (config, schemaName) => electron_1.ipcRenderer.invoke('schema:get-detailed-columns', config, schemaName),
    getTableColumnDetails: (config, schemaName, tableName) => electron_1.ipcRenderer.invoke('oracle:get-table-column-details', config, schemaName, tableName),
    getObjectDDL: (config, schemaName, objectType, objectName) => electron_1.ipcRenderer.invoke('oracle:get-object-ddl', config, schemaName, objectType, objectName),
    getTableLiveRowCount: (config, schemaName, tableName) => electron_1.ipcRenderer.invoke('oracle:get-table-live-count', config, schemaName, tableName),
    executeQuery: (config, sql, maxRows, targetSchema) => electron_1.ipcRenderer.invoke('oracle:execute-query', config, sql, maxRows, targetSchema),
    fetchCursorRows: (cursorId, count) => electron_1.ipcRenderer.invoke('oracle:fetch-cursor-rows', cursorId, count),
    closeCursor: (cursorId) => electron_1.ipcRenderer.invoke('oracle:close-cursor', cursorId),
    startStreamExport: (config, sql, targetPath, options) => electron_1.ipcRenderer.invoke('oracle:start-stream-export', config, sql, targetPath, options),
    cancelStreamExport: (jobId) => electron_1.ipcRenderer.invoke('oracle:cancel-stream-export', jobId),
    onStreamExportProgress: (callback) => {
        const listener = (_, progress) => callback(progress);
        electron_1.ipcRenderer.on('oracle:stream-export-progress', listener);
        return () => electron_1.ipcRenderer.removeListener('oracle:stream-export-progress', listener);
    },
    dropTable: (config, schemaName, tableName, purge, cascade) => electron_1.ipcRenderer.invoke('oracle:drop-table', config, schemaName, tableName, purge, cascade),
    importData: (config, options) => electron_1.ipcRenderer.invoke('oracle:import-data', config, options),
    callAiProvider: (params) => electron_1.ipcRenderer.invoke('ai:call-provider', params),
    // Oracle DBA & Performance Monitoring
    getExplainPlan: (config, sql) => electron_1.ipcRenderer.invoke('oracle:get-explain-plan', config, sql),
    getActiveSessions: (config) => electron_1.ipcRenderer.invoke('oracle:get-active-sessions', config),
    getLockInfo: (config) => electron_1.ipcRenderer.invoke('oracle:get-lock-info', config),
    killSession: (config, sid, serialNumber) => electron_1.ipcRenderer.invoke('oracle:kill-session', config, sid, serialNumber),
    getTablespaceUsage: (config) => electron_1.ipcRenderer.invoke('oracle:get-tablespace-usage', config),
    getTopSql: (config) => electron_1.ipcRenderer.invoke('oracle:get-top-sql', config),
    // TXT Bundle & Bloomberg Data License Importer
    analyzeTxtBundle: (sourcePathOrFiles) => electron_1.ipcRenderer.invoke('txt-bundle:analyze', sourcePathOrFiles),
    importTxtBundle: (config, options) => electron_1.ipcRenderer.invoke('txt-bundle:import', config, options),
    onTxtBundleProgress: (callback) => {
        const listener = (_, progress) => callback(progress);
        electron_1.ipcRenderer.on('txt-bundle:progress', listener);
        return () => electron_1.ipcRenderer.removeListener('txt-bundle:progress', listener);
    },
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
    selectSaveFile: (defaultName, filters) => electron_1.ipcRenderer.invoke('dialog:save-file', defaultName, filters),
    selectTxtFiles: (title) => electron_1.ipcRenderer.invoke('dialog:select-txt-files', title),
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
    applyUpdate: (remote, clientTier) => electron_1.ipcRenderer.invoke('update:apply', remote, clientTier),
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
    toolsRunScript: (scriptKey, customParams, customCommand) => electron_1.ipcRenderer.invoke('tools:run-script', scriptKey, customParams, customCommand),
    onToolsOutput: (callback) => {
        const listener = (_, data) => callback(data);
        electron_1.ipcRenderer.on('tools:output', listener);
        return () => electron_1.ipcRenderer.removeListener('tools:output', listener);
    },
    // SSIS & ETL Studio
    ssisDetectDtexec: () => electron_1.ipcRenderer.invoke('ssis:detect-dtexec'),
    ssisScanPackages: (folderPath) => electron_1.ipcRenderer.invoke('ssis:scan-packages', folderPath),
    ssisRunPackage: (options) => electron_1.ipcRenderer.invoke('ssis:run-package', options),
    ssisCancelJob: (jobId) => electron_1.ipcRenderer.invoke('ssis:cancel-job', jobId),
    onSsisLog: (callback) => {
        const listener = (_, msg) => callback(msg);
        electron_1.ipcRenderer.on('ssis:log', listener);
        return () => {
            electron_1.ipcRenderer.removeListener('ssis:log', listener);
        };
    },
    // Licensing & Commercial Protection
    getMachineId: () => electron_1.ipcRenderer.invoke('license:get-machine-id'),
    getActiveLicense: () => electron_1.ipcRenderer.invoke('license:get-active'),
    activateLicense: (key, name) => electron_1.ipcRenderer.invoke('license:validate-and-activate', key, name),
    deactivateLicense: () => electron_1.ipcRenderer.invoke('license:deactivate'),
    canApplyUpdates: () => electron_1.ipcRenderer.invoke('license:can-update'),
    getTrialStatus: () => electron_1.ipcRenderer.invoke('license:get-trial-status'),
    openExternal: (url) => electron_1.ipcRenderer.invoke('shell:open-external', url),
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
