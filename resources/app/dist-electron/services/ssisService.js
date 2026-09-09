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
    /**
     * Helper to extract referenced tables and procedures from SQL string
     */
    extractSqlEntities(sql) {
        const tables = new Set();
        const procedures = new Set();
        if (!sql || typeof sql !== 'string')
            return { tables: [], procedures: [] };
        // Tables in FROM / JOIN / INTO / UPDATE / TRUNCATE
        const tablePatterns = [
            /\b(?:FROM|JOIN)\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)/gi,
            /\b(?:INSERT\s+INTO|INTO|UPDATE|TRUNCATE\s+TABLE)\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)/gi,
        ];
        for (const pat of tablePatterns) {
            let match;
            while ((match = pat.exec(sql)) !== null) {
                let t = match[1]?.trim();
                if (t && !['SELECT', 'WHERE', 'SET', 'DUAL', 'ON', 'AS', '(', ')'].includes(t.toUpperCase())) {
                    t = t.replace(/[`"\[\]]/g, '');
                    if (t.length > 2)
                        tables.add(t);
                }
            }
        }
        // Stored Procedures and Function calls (e.g. EXEC sss.proc, sss.siplogging.generatejobid())
        const procPatterns = [
            /\b(?:EXEC|EXECUTE|CALL)\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)+)/gi,
            /\b([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/g,
        ];
        const standardFunctions = new Set([
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NVL', 'ISNULL', 'COALESCE',
            'SUBSTR', 'SUBSTRING', 'LEFT', 'RIGHT', 'YEAR', 'MONTH', 'DAY',
            'TO_DATE', 'TO_CHAR', 'SYSDATE', 'GETDATE', 'ROUND', 'TRUNC',
            'CAST', 'CONVERT', 'ROW_NUMBER', 'OVER', 'PARTITION',
        ]);
        for (const pat of procPatterns) {
            let match;
            while ((match = pat.exec(sql)) !== null) {
                let p = match[1]?.trim();
                if (p) {
                    p = p.replace(/[`"\[\]]/g, '');
                    const upper = p.toUpperCase();
                    if (!standardFunctions.has(upper)) {
                        procedures.add(p);
                    }
                }
            }
        }
        return {
            tables: Array.from(tables),
            procedures: Array.from(procedures),
        };
    }
    /**
     * Parse a single DTSX file for variables, connections, tasks, queries, and tables
     */
    parseDtsx(filePath, relativePath) {
        const stats = fs_1.default.statSync(filePath);
        const content = fs_1.default.readFileSync(filePath, 'utf8');
        // 1. Extract Variables
        const variables = [];
        const varMap = {};
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
            varMap[`${namespace}::${varName}`] = value;
            varMap[varName] = value;
            if (namespace !== 'System') {
                variables.push({
                    name: varName,
                    namespace,
                    dataType,
                    value,
                });
            }
        }
        // 2. Extract Connections & DB Information
        const connections = new Set();
        const connectionDetails = [];
        const connMgrRegex = /<DTS:ConnectionManager\b[\s\S]*?<\/DTS:ConnectionManager>/gi;
        let cmMatch;
        while ((cmMatch = connMgrRegex.exec(content)) !== null) {
            const block = cmMatch[0];
            const name = (block.match(/(?:DTS:|p\d+:)?ObjectName="([^"]+)"/i) || [])[1] || 'Unknown Connection';
            const connStr = (block.match(/ConnectionString="([^"]+)"/i) || [])[1] || '';
            const creationName = (block.match(/CreationName="([^"]+)"/i) || [])[1] || 'ODBC';
            if (connStr) {
                connections.add(connStr);
            }
            let host;
            let port;
            let database;
            let user;
            let dsn;
            let dbType = 'generic';
            // Check if name has format host:port/service.user or ip:port/service (e.g. dc1devdbo03:1521/DEV02.SOURCE)
            const hostPortMatch = name.match(/([a-zA-Z0-9_.-]+):(\d+)\/([a-zA-Z0-9_]+)(?:\.([a-zA-Z0-9_]+))?/i);
            if (hostPortMatch) {
                host = hostPortMatch[1];
                port = parseInt(hostPortMatch[2], 10);
                database = hostPortMatch[3];
                if (hostPortMatch[4]) {
                    user = hostPortMatch[4];
                }
            }
            // Check DSN
            const dsnMatch = connStr.match(/Dsn=([^;]+)/i);
            if (dsnMatch) {
                dsn = dsnMatch[1].trim();
            }
            // Check User ID / UID
            const uidMatch = connStr.match(/(?:uid|User ID)=([^;]+)/i);
            if (uidMatch) {
                user = uidMatch[1].trim();
            }
            // Determine DB Type
            if (port === 1521 ||
                (database && (database.toLowerCase() === 'dev02' || database.toLowerCase() === 'prd02')) ||
                creationName.toLowerCase().includes('ora')) {
                dbType = 'oracle';
            }
            else if ((dsn && (dsn.toLowerCase().includes('impala') || dsn.toLowerCase().includes('hive'))) ||
                name.toLowerCase().includes('impala') ||
                name.toLowerCase().includes('hive')) {
                dbType = 'impala';
            }
            else if (port === 1433 ||
                connStr.toLowerCase().includes('initial catalog') ||
                creationName.toLowerCase().includes('sqlncli')) {
                dbType = 'sqlserver';
            }
            connectionDetails.push({
                name,
                creationName,
                connectionString: connStr,
                host,
                port,
                database,
                dsn,
                user,
                dbType,
            });
        }
        // 3. Extract SQL Details, Tables & Procedures
        const sqlDetails = [];
        const allTables = new Set();
        const allProcedures = new Set();
        // A. Execute SQL Tasks
        const sqlTaskRegex = /<DTS:Executable\b[^>]*ExecutableType="(?:Microsoft\.)?ExecuteSQLTask"[^>]*>([\s\S]*?)<\/DTS:Executable>/gi;
        let stMatch;
        let sqlTaskIdx = 1;
        while ((stMatch = sqlTaskRegex.exec(content)) !== null) {
            const block = stMatch[1];
            const nameMatch = stMatch[0].match(/(?:DTS:|p\d+:)?ObjectName="([^"]+)"/i);
            const taskName = nameMatch ? nameMatch[1] : `Execute SQL Task #${sqlTaskIdx++}`;
            const rawSqlMatch = block.match(/SqlStatementSource="([^"]+)"/i) ||
                block.match(/<SqlStatementSource>([\s\S]*?)<\/SqlStatementSource>/i);
            let sql = rawSqlMatch ? rawSqlMatch[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') : '';
            // If SQL points to a variable name like User::Log_Start, dereference it
            if (sql.startsWith('User::') || sql.startsWith('System::') || varMap[sql]) {
                const resolved = varMap[sql];
                if (resolved) {
                    sql = resolved.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
                }
            }
            if (sql && sql.trim().length > 0) {
                const entities = this.extractSqlEntities(sql);
                entities.tables.forEach((t) => allTables.add(t));
                entities.procedures.forEach((p) => allProcedures.add(p));
                sqlDetails.push({
                    id: `sql-task-${sqlTaskIdx++}`,
                    name: taskName,
                    type: 'ExecuteSqlTask',
                    sql: sql.trim(),
                    referencedTables: entities.tables,
                    referencedProcedures: entities.procedures,
                });
            }
        }
        // B. DataFlow Components (Source & Destination)
        const compRegex = /<component\b[^>]*name="([^"]+)"[\s\S]*?<\/component>/gi;
        let compMatch;
        let compIdx = 1;
        while ((compMatch = compRegex.exec(content)) !== null) {
            const compName = compMatch[1];
            const block = compMatch[0];
            const sqlCmd = block.match(/<property[^>]*name="SqlCommand"[^>]*>([\s\S]*?)<\/property>/i);
            const tableNameProp = block.match(/<property[^>]*name="(?:TableName|OpenRowset)"[^>]*>([\s\S]*?)<\/property>/i);
            if (sqlCmd && sqlCmd[1].trim().length > 0) {
                const query = sqlCmd[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim();
                const entities = this.extractSqlEntities(query);
                entities.tables.forEach((t) => allTables.add(t));
                entities.procedures.forEach((p) => allProcedures.add(p));
                sqlDetails.push({
                    id: `df-src-${compIdx++}`,
                    name: compName,
                    type: 'DataFlowSource',
                    sql: query,
                    referencedTables: entities.tables,
                    referencedProcedures: entities.procedures,
                });
            }
            else if (tableNameProp && tableNameProp[1].trim().length > 0) {
                const tbl = tableNameProp[1].replace(/[`"\[\]]/g, '').trim();
                if (tbl && tbl !== 'none') {
                    allTables.add(tbl);
                    sqlDetails.push({
                        id: `df-dest-${compIdx++}`,
                        name: compName,
                        type: 'DataFlowDestination',
                        targetTable: tbl,
                        referencedTables: [tbl],
                        referencedProcedures: [],
                    });
                }
            }
        }
        // C. Variables containing raw SQL expressions
        variables.forEach((v) => {
            const val = v.value.trim();
            const isSql = val.startsWith('WITH ') ||
                val.startsWith('SELECT ') ||
                val.startsWith('INSERT ') ||
                val.startsWith('UPDATE ') ||
                val.startsWith('TRUNCATE ');
            if (isSql && !sqlDetails.some((d) => d.sql === val)) {
                const query = val.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
                const entities = this.extractSqlEntities(query);
                entities.tables.forEach((t) => allTables.add(t));
                entities.procedures.forEach((p) => allProcedures.add(p));
                sqlDetails.push({
                    id: `var-${v.name}`,
                    name: `Variabel: ${v.name}`,
                    type: 'VariableQuery',
                    sql: query,
                    referencedTables: entities.tables,
                    referencedProcedures: entities.procedures,
                });
            }
        });
        // 4. Count tasks
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
            connectionDetails,
            tasksCount: {
                dataFlow: dataFlowMatches ? dataFlowMatches.length : 0,
                sqlTask: sqlMatches ? sqlMatches.length : 0,
            },
            sqlDetails,
            allTables: Array.from(allTables),
            allProcedures: Array.from(allProcedures),
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
