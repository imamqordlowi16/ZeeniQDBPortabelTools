"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const croner_1 = require("croner");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class SchedulerService {
    storage;
    oracleService;
    datapumpService;
    activeCrons = new Map();
    constructor(storage, oracleService, datapumpService) {
        this.storage = storage;
        this.oracleService = oracleService;
        this.datapumpService = datapumpService;
    }
    init() {
        this.reloadSchedules();
    }
    reloadSchedules() {
        // Stop all running crons
        for (const [id, cron] of this.activeCrons.entries()) {
            cron.stop();
        }
        this.activeCrons.clear();
        // Load active schedules
        const schedules = this.storage.getSchedules();
        for (const sched of schedules) {
            if (sched.enabled) {
                this.scheduleJob(sched);
            }
        }
    }
    scheduleJob(sched) {
        try {
            const cron = new croner_1.Cron(sched.cronExpression, { protect: true }, async () => {
                await this.executeScheduledBackup(sched.id);
            });
            this.activeCrons.set(sched.id, cron);
            // Update next run time
            const nextDate = cron.nextRun();
            sched.nextRun = nextDate ? nextDate.toISOString() : undefined;
            this.storage.saveSchedule(sched);
        }
        catch (err) {
            console.error(`Failed to register schedule ${sched.name}:`, err);
        }
    }
    async executeScheduledBackup(scheduleId) {
        const schedules = this.storage.getSchedules();
        const sched = schedules.find(s => s.id === scheduleId);
        if (!sched)
            return false;
        const conn = this.storage.getConnectionById(sched.connectionId);
        if (!conn) {
            console.error(`Scheduled backup failed: Connection ${sched.connectionId} not found.`);
            return false;
        }
        const settings = this.storage.getSettings();
        const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const jobId = `sched-${sched.id}-${timestamp}`;
        const outDir = sched.backupOptions.outputDir || settings.defaultBackupFolder;
        const baseName = `${sched.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_${timestamp}`;
        const backupOpts = {
            ...sched.backupOptions,
            jobId,
            outputDir: outDir,
            outputFileName: baseName
        };
        const startTime = Date.now();
        let isSuccess = false;
        let filePath = '';
        let errorMsg = '';
        try {
            if (backupOpts.mode === 'datapump') {
                const res = await this.datapumpService.runExpdp(conn, backupOpts, settings.expdpPath);
                isSuccess = res.success;
                filePath = res.filePath || '';
                errorMsg = res.error || '';
            }
            else {
                const res = await this.oracleService.runSqlBackup(conn, backupOpts, () => { }, () => { });
                isSuccess = res.success;
                filePath = res.filePath || '';
                errorMsg = res.error || '';
            }
        }
        catch (e) {
            isSuccess = false;
            errorMsg = e.message || String(e);
        }
        const duration = Math.floor((Date.now() - startTime) / 1000);
        let fileSizeFormatted = '0 KB';
        if (filePath && fs_1.default.existsSync(filePath)) {
            const bytes = fs_1.default.statSync(filePath).size;
            fileSizeFormatted = (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        }
        // Add History
        const historyItem = {
            id: `hist-${Date.now()}`,
            jobId,
            type: 'backup',
            mode: backupOpts.mode,
            connectionName: conn.name,
            target: backupOpts.scope === 'full' ? 'FULL DB' : backupOpts.targetSchemas.join(', '),
            timestamp: new Date().toISOString(),
            durationSeconds: duration,
            status: isSuccess ? 'success' : 'failed',
            filePath,
            fileSizeFormatted,
            logSummary: isSuccess ? 'Scheduled backup executed successfully' : `Error: ${errorMsg}`
        };
        this.storage.addHistoryItem(historyItem);
        // Update Schedule metadata
        sched.lastRun = new Date().toISOString();
        sched.lastStatus = isSuccess ? 'success' : 'failed';
        const cronInstance = this.activeCrons.get(sched.id);
        if (cronInstance) {
            const nextRun = cronInstance.nextRun();
            sched.nextRun = nextRun ? nextRun.toISOString() : undefined;
        }
        this.storage.saveSchedule(sched);
        // Retention Cleanup if configured
        if (sched.retentionDays && sched.retentionDays > 0) {
            this.cleanupOldBackups(outDir, sched.name, sched.retentionDays);
        }
        return isSuccess;
    }
    cleanupOldBackups(folder, schedulePrefix, retentionDays) {
        try {
            if (!fs_1.default.existsSync(folder))
                return;
            const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
            const safePrefix = schedulePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
            const files = fs_1.default.readdirSync(folder);
            for (const f of files) {
                if (f.startsWith(safePrefix)) {
                    const fullPath = path_1.default.join(folder, f);
                    const stat = fs_1.default.statSync(fullPath);
                    if (stat.mtimeMs < cutoffTime) {
                        fs_1.default.unlinkSync(fullPath);
                    }
                }
            }
        }
        catch (e) {
            console.error('Retention cleanup error:', e);
        }
    }
}
exports.SchedulerService = SchedulerService;
