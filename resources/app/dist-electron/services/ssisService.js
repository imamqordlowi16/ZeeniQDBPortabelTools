"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SsisService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
class SsisService {
    activeProcesses = new Map();
    /**
     * Search for dtexec.exe across standard SQL Server installations or PATH
     */
    detectDtexec() {
        const candidatePaths = [
            'C:\\Program Files (x86)\\Microsoft SQL Server\\150\\DTS\\Binn\\DTExec.exe', // SQL 2019 x86 (Common for SSIS 32-bit Impala)
            'C:\\Program Files\\Microsoft SQL Server\\150\\DTS\\Binn\\DTExec.exe', // SQL 2019 x64
            'C:\\Program Files (x86)\\Microsoft SQL Server\\160\\DTS\\Binn\\DTExec.exe', // SQL 2022 x86
            'C:\\Program Files\\Microsoft SQL Server\\160\\DTS\\Binn\\DTExec.exe', // SQL 2022 x64
            'C:\\Program Files (x86)\\Microsoft SQL Server\\140\\DTS\\Binn\\DTExec.exe', // SQL 2017 x86
            'C:\\Program Files\\Microsoft SQL Server\\140\\DTS\\Binn\\DTExec.exe', // SQL 2017 x64
            'C:\\Program Files (x86)\\Microsoft SQL Server\\130\\DTS\\Binn\\DTExec.exe', // SQL 2016 x86
            'C:\\Program Files\\Microsoft SQL Server\\130\\DTS\\Binn\\DTExec.exe', // SQL 2016 x64
        ];
        for (const p of candidatePaths) {
            if (fs_1.default.existsSync(p)) {
                return p;
            }
        }
        // Check system PATH
        try {
            const stdout = (0, child_process_1.execSync)('where dtexec', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            const firstLine = stdout.trim().split(/\r?\n/)[0];
            if (firstLine && fs_1.default.existsSync(firstLine)) {
                return firstLine;
            }
        }
        catch {
            // not found in path
        }
        return null;
    }
    /**
     * Format file size to human readable string
     */
    formatBytes(bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    /**
     * Parse a single DTSX file for variables, connections, and tasks
     */
    parseDtsx(filePath, relativePath) {
        const stats = fs_1.default.statSync(filePath);
        const content = fs_1.default.readFileSync(filePath, 'utf8');
        // Extract Variables (supporting DTS:, p4:, or no prefix)
        const variables = [];
        const varRegex = /<DTS:Variable\b[^>]*?(?:DTS:|p\d+:)?ObjectName="([^"]+)"[^>]*>([\s\S]*?)<\/DTS:Variable>/gi;
        let varMatch;
        while ((varMatch = varRegex.exec(content)) !== null) {
            const varName = varMatch[1];
            const varBody = varMatch[2];
            let value = '';
            const valMatch = varBody.match(/<(?:DTS:)?VariableValue[^>]*>([\s\S]*?)<\/(?:DTS:)?VariableValue>/i);
            if (valMatch) {
                value = valMatch[1].trim();
            }
            let namespace = 'User';
            const nsMatch = varMatch[0].match(/(?:DTS:|p\d+:)?Namespace="([^"]+)"/i);
            if (nsMatch) {
                namespace = nsMatch[1];
            }
            let dataType = 'String';
            const dtMatch = varMatch[0].match(/(?:DTS:|p\d+:)?DataType="([^"]+)"/i);
            if (dtMatch) {
                dataType = dtMatch[1];
            }
            // Filter out system variables if any
            if (namespace !== 'System') {
                variables.push({
                    name: varName,
                    namespace,
                    dataType,
                    value,
                });
            }
        }
        // Extract Connections
        const connections = new Set();
        const connRegex = /ConnectionString="([^"]+)"/g;
        let connMatch;
        while ((connMatch = connRegex.exec(content)) !== null) {
            connections.add(connMatch[1]);
        }
        // Count tasks
        const dataFlowMatches = content.match(/(?:DTS:)?ExecutableType="(?:Microsoft\.)?Pipeline"/gi);
        const sqlMatches = content.match(/(?:DTS:)?ExecutableType="(?:Microsoft\.)?ExecuteSQLTask"/gi);
        return {
            name: path_1.default.basename(filePath),
            fullPath: filePath,
            relativePath,
            sizeBytes: stats.size,
            sizeFormatted: this.formatBytes(stats.size),
            variables,
            connections: Array.from(connections),
            tasksCount: {
                dataFlow: dataFlowMatches ? dataFlowMatches.length : 0,
                sqlTask: sqlMatches ? sqlMatches.length : 0,
            },
        };
    }
    /**
     * Scan folder recursively for .dtsx packages, .sln, and .dtproj files
     */
    scanFolder(folderPath) {
        if (!fs_1.default.existsSync(folderPath)) {
            throw new Error(`Folder tidak ditemukan: ${folderPath}`);
        }
        const packages = [];
        const solutions = [];
        const projects = [];
        const walk = (currentDir) => {
            const items = fs_1.default.readdirSync(currentDir, { withFileTypes: true });
            for (const item of items) {
                const full = path_1.default.join(currentDir, item.name);
                const rel = path_1.default.relative(folderPath, full);
                if (item.isDirectory()) {
                    // Skip bin, obj, .git, node_modules to avoid duplicated compiled dtsx
                    if (['bin', 'obj', '.git', 'node_modules'].includes(item.name.toLowerCase())) {
                        continue;
                    }
                    walk(full);
                }
                else {
                    const ext = path_1.default.extname(item.name).toLowerCase();
                    if (ext === '.dtsx') {
                        try {
                            packages.push(this.parseDtsx(full, rel));
                        }
                        catch (e) {
                            console.error(`Failed to parse dtsx ${full}:`, e.message);
                        }
                    }
                    else if (ext === '.sln') {
                        solutions.push(item.name);
                    }
                    else if (ext === '.dtproj') {
                        projects.push(item.name);
                    }
                }
            }
        };
        walk(folderPath);
        // Sort packages alphabetically
        packages.sort((a, b) => a.name.localeCompare(b.name));
        return {
            folderPath,
            packages,
            solutions,
            projects,
            detectedDtexecPath: this.detectDtexec() || undefined,
        };
    }
    /**
     * Build dtexec arguments from options
     */
    buildDtexecCommand(options) {
        const dtexec = options.dtexecPath || this.detectDtexec() || 'dtexec';
        const args = ['/FILE', options.packagePath];
        // Variables parameter injection (/Set \Package.Variables[User::P_Tahun].Properties[Value];"2024")
        if (options.variables) {
            for (const [key, val] of Object.entries(options.variables)) {
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    const varPath = key.includes('::') ? key : `User::${key}`;
                    args.push('/Set', `\\Package.Variables[${varPath}].Properties[Value];"${val}"`);
                }
            }
        }
        if (options.maxConcurrent !== undefined) {
            args.push('/MAXCONCURRENT', String(options.maxConcurrent));
        }
        else {
            args.push('/MAXCONCURRENT', '-1');
        }
        if (options.checkpointing === false || options.checkpointing === undefined) {
            args.push('/CHECKPOINTING', 'OFF');
        }
        if (options.reporting) {
            args.push('/REPORTING', options.reporting);
        }
        else {
            args.push('/REPORTING', 'EWCDI');
        }
        if (options.extraArgs && options.extraArgs.length > 0) {
            args.push(...options.extraArgs);
        }
        const displayCommand = `"${dtexec}" ${args.map((a) => (a.includes(' ') || a.includes(';') ? `"${a}"` : a)).join(' ')}`;
        return { cmd: dtexec, args, displayCommand };
    }
    /**
     * Execute SSIS package via dtexec.exe with real-time log streaming
     */
    executePackage(options, onLog) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const { cmd, args, displayCommand } = this.buildDtexecCommand(options);
            const sendLog = (line, streamType = 'stdout') => {
                onLog({
                    jobId: options.jobId,
                    line,
                    streamType,
                    timestamp: new Date().toTimeString().split(' ')[0],
                });
            };
            sendLog(`================================================================================`, 'system');
            sendLog(`▶ Memulai Eksekusi Paket SSIS: ${path_1.default.basename(options.packagePath)}`, 'system');
            sendLog(`  Target File: ${options.packagePath}`, 'system');
            sendLog(`  Command: ${displayCommand}`, 'system');
            sendLog(`================================================================================\n`, 'system');
            let proc;
            try {
                const packageDir = path_1.default.dirname(options.packagePath);
                proc = (0, child_process_1.spawn)(cmd, args, {
                    cwd: packageDir,
                    windowsHide: true,
                    shell: false,
                });
            }
            catch (err) {
                const errorMsg = `Gagal memulai proses dtexec: ${err?.message || err}`;
                sendLog(`✖ ${errorMsg}`, 'error');
                return resolve({
                    jobId: options.jobId,
                    success: false,
                    exitCode: -1,
                    durationSeconds: 0,
                    error: errorMsg,
                });
            }
            this.activeProcesses.set(options.jobId, proc);
            proc.stdout?.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    if (line.trim().length > 0) {
                        let streamType = 'stdout';
                        if (line.includes('Error:') || line.includes('0x') || line.includes('Failed')) {
                            streamType = 'error';
                        }
                        else if (line.includes('Warning:')) {
                            streamType = 'stdout';
                        }
                        else if (line.includes('succeeded') || line.includes('Selesai')) {
                            streamType = 'success';
                        }
                        sendLog(line, streamType);
                    }
                }
            });
            proc.stderr?.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                const lines = text.split(/\r?\n/);
                for (const line of lines) {
                    if (line.trim().length > 0) {
                        sendLog(line, 'stderr');
                    }
                }
            });
            proc.on('close', (exitCode) => {
                this.activeProcesses.delete(options.jobId);
                const durationSeconds = Math.round((Date.now() - startTime) / 1000);
                const success = (exitCode ?? 0) === 0;
                sendLog(`\n--------------------------------------------------------------------------------`, 'system');
                if (success) {
                    sendLog(`✔ Eksekusi Paket SSIS SELESAI DENGAN SUKSES (Exit Code: 0, Durasi: ${durationSeconds}s)`, 'success');
                }
                else {
                    sendLog(`✖ Eksekusi Paket SSIS GAGAL (Exit Code: ${exitCode ?? -1}, Durasi: ${durationSeconds}s)`, 'error');
                }
                sendLog(`--------------------------------------------------------------------------------\n`, 'system');
                resolve({
                    jobId: options.jobId,
                    success,
                    exitCode: exitCode ?? -1,
                    durationSeconds,
                    error: success ? undefined : `Process exited with code ${exitCode}`,
                });
            });
            proc.on('error', (err) => {
                this.activeProcesses.delete(options.jobId);
                const durationSeconds = Math.round((Date.now() - startTime) / 1000);
                sendLog(`✖ Kesalahan Fatal Proses: ${err.message}`, 'error');
                resolve({
                    jobId: options.jobId,
                    success: false,
                    exitCode: -1,
                    durationSeconds,
                    error: err.message,
                });
            });
        });
    }
    /**
     * Cancel/kill active execution job
     */
    cancelJob(jobId) {
        const proc = this.activeProcesses.get(jobId);
        if (!proc || !proc.pid) {
            return false;
        }
        try {
            if (process.platform === 'win32') {
                (0, child_process_1.execSync)(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' });
            }
            else {
                proc.kill('SIGKILL');
            }
            this.activeProcesses.delete(jobId);
            return true;
        }
        catch (e) {
            console.error(`Failed to kill process for job ${jobId}:`, e.message);
            return false;
        }
    }
}
exports.SsisService = SsisService;
