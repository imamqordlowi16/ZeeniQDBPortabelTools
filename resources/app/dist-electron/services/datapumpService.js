"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataPumpService = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const oracledb_1 = __importDefault(require("oracledb"));
class DataPumpService {
    runningProcesses = new Map();
    detectOracleBinaries(customOracleHome) {
        const pathsToCheck = [];
        // Check inside the portable application folder
        const appDir = electron_1.app && electron_1.app.isPackaged ? path_1.default.dirname(process.execPath) : process.cwd();
        const portableClientPaths = [
            path_1.default.join(appDir, 'instantclient'),
            path_1.default.join(appDir, 'oracle_client'),
            path_1.default.join(appDir, 'oracle_client', 'bin'),
            path_1.default.join(appDir, 'instantclient_tools'),
            path_1.default.join(appDir, 'bin'),
            path_1.default.join(appDir, 'tools'),
            path_1.default.join(process.cwd(), 'instantclient'),
            path_1.default.join(process.cwd(), 'oracle_client'),
            path_1.default.join(process.cwd(), 'bin'),
        ];
        for (const p of portableClientPaths) {
            if (fs_1.default.existsSync(p))
                pathsToCheck.push(p);
        }
        if (customOracleHome && fs_1.default.existsSync(customOracleHome)) {
            pathsToCheck.push(path_1.default.join(customOracleHome, 'bin'));
            pathsToCheck.push(customOracleHome);
        }
        if (process.env.ORACLE_HOME && fs_1.default.existsSync(process.env.ORACLE_HOME)) {
            pathsToCheck.push(path_1.default.join(process.env.ORACLE_HOME, 'bin'));
            pathsToCheck.push(process.env.ORACLE_HOME);
        }
        if (process.env.PATH) {
            const pathDirs = process.env.PATH.split(path_1.default.delimiter);
            pathsToCheck.push(...pathDirs);
        }
        let expdpPath;
        let impdpPath;
        const isWindows = process.platform === 'win32';
        const expdpName = isWindows ? 'expdp.exe' : 'expdp';
        const impdpName = isWindows ? 'impdp.exe' : 'impdp';
        for (const dir of pathsToCheck) {
            if (!dir)
                continue;
            const testExp = path_1.default.join(dir, expdpName);
            if (!expdpPath && fs_1.default.existsSync(testExp)) {
                expdpPath = testExp;
            }
            const testImp = path_1.default.join(dir, impdpName);
            if (!impdpPath && fs_1.default.existsSync(testImp)) {
                impdpPath = testImp;
            }
            if (expdpPath && impdpPath)
                break;
        }
        return {
            expdpFound: !!expdpPath,
            expdpPath: expdpPath,
            impdpFound: !!impdpPath,
            impdpPath: impdpPath,
            oracleHome: process.env.ORACLE_HOME || customOracleHome,
        };
    }
    cancelJob(jobId) {
        const proc = this.runningProcesses.get(jobId);
        if (proc) {
            try {
                if (process.platform === 'win32') {
                    (0, child_process_1.spawn)('taskkill', ['/pid', proc.pid?.toString() || '', '/f', '/t']);
                }
                else {
                    proc.kill('SIGTERM');
                }
                this.runningProcesses.delete(jobId);
                return true;
            }
            catch (e) {
                console.error('Failed to kill process:', e);
            }
        }
        return false;
    }
    async runExpdp(config, options, customExpdpPath, onLog, onProgress) {
        const startTime = Date.now();
        const emitLog = (type, message) => {
            if (onLog) {
                onLog({
                    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    timestamp: new Date().toLocaleTimeString(),
                    type,
                    message,
                });
            }
        };
        const binaryInfo = this.detectOracleBinaries(customExpdpPath);
        const expdpExe = customExpdpPath && fs_1.default.existsSync(customExpdpPath)
            ? customExpdpPath
            : (binaryInfo.expdpPath || 'expdp');
        emitLog('info', `Initializing Oracle Data Pump (expdp) Export: ${options.jobId}`);
        emitLog('info', `Using executable: ${expdpExe}`);
        // Create temp directory for parameter file (.par)
        const outDir = options.outputDir || process.cwd();
        if (!fs_1.default.existsSync(outDir)) {
            fs_1.default.mkdirSync(outDir, { recursive: true });
        }
        const baseName = options.outputFileName.replace(/\.(dmp|par|log)$/i, '');
        const parFilePath = path_1.default.join(outDir, `${baseName}.par`);
        const dumpFileName = `${baseName}.dmp`;
        const logFileName = `${baseName}_exp.log`;
        const finalDumpPath = path_1.default.join(outDir, dumpFileName);
        const finalLogPath = path_1.default.join(outDir, logFileName);
        // Build PARFILE lines
        const parLines = [];
        // Directory
        const dirObject = options.datapumpDirectory || 'DATA_PUMP_DIR';
        parLines.push(`DIRECTORY=${dirObject}`);
        parLines.push(`DUMPFILE=${dumpFileName}`);
        parLines.push(`LOGFILE=${logFileName}`);
        // Scope
        if (options.scope === 'full') {
            parLines.push('FULL=YES');
        }
        else if (options.scope === 'schema') {
            parLines.push(`SCHEMAS=${options.targetSchemas.join(',')}`);
        }
        else if (options.scope === 'tables' && options.targetTables && options.targetTables.length > 0) {
            const tableList = options.targetTables.map(t => `${t.schema}.${t.table}`).join(',');
            parLines.push(`TABLES=${tableList}`);
        }
        // Content: ALL / DATA_ONLY / METADATA_ONLY
        if (options.includeData === false && options.includeDdl !== false) {
            parLines.push('CONTENT=METADATA_ONLY');
        }
        else if (options.includeData !== false && options.includeDdl === false) {
            parLines.push('CONTENT=DATA_ONLY');
        }
        else {
            parLines.push('CONTENT=ALL');
        }
        // Compression
        if (options.compressZip) {
            parLines.push('COMPRESSION=ALL');
        }
        // Parallel
        if (options.parallel && options.parallel > 1) {
            parLines.push(`PARALLEL=${options.parallel}`);
        }
        // Flashback / Query
        if (options.flashbackScn) {
            parLines.push(`FLASHBACK_SCN=${options.flashbackScn}`);
        }
        if (options.flashbackTime) {
            parLines.push(`FLASHBACK_TIME="${options.flashbackTime}"`);
        }
        if (options.rowFilterClause) {
            parLines.push(`QUERY=${options.rowFilterClause}`);
        }
        fs_1.default.writeFileSync(parFilePath, parLines.join('\r\n'), 'utf-8');
        emitLog('info', `Generated Parameter File (${parFilePath}):\n${parLines.join('\n')}`);
        // Build connection credentials string
        let connString = '';
        const connectTarget = config.serviceName || config.sid || 'orcl';
        const hostPort = `${config.host}:${config.port}/${connectTarget}`;
        if (config.privilege === 'SYSDBA') {
            connString = `"${config.user}/${config.password || ''}@//${hostPort} AS SYSDBA"`;
        }
        else {
            connString = `"${config.user}/${config.password || ''}@//${hostPort}"`;
        }
        const args = [connString, `parfile="${parFilePath}"`];
        return new Promise((resolve) => {
            emitLog('info', `Spawning expdp process...`);
            const child = (0, child_process_1.spawn)(expdpExe, args, {
                shell: true,
                windowsHide: true,
                env: {
                    ...process.env,
                    ...(binaryInfo.oracleHome ? { ORACLE_HOME: binaryInfo.oracleHome } : {}),
                }
            });
            this.runningProcesses.set(options.jobId, child);
            let processedObjects = 0;
            let totalRows = 0;
            const handleOutput = (data, isError) => {
                const text = data.toString('utf-8');
                const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
                for (const line of lines) {
                    if (line.includes('ORA-') || line.includes('UDE-') || line.includes('KUP-')) {
                        emitLog('error', line);
                    }
                    else if (line.startsWith('Export:') ||
                        line.startsWith('Version ') ||
                        line.startsWith('Copyright ') ||
                        line.startsWith('Connected to:') ||
                        line.startsWith('Starting "')) {
                        // Normal startup banner from expdp CLI
                        emitLog('info', line);
                    }
                    else if (line.includes('Total estimation') || line.includes('Processing object type') || line.includes('. . exported')) {
                        emitLog('stdout', line);
                        processedObjects++;
                        if (line.includes('rows')) {
                            const match = line.match(/([0-9,]+)\s+rows/);
                            if (match) {
                                totalRows += parseInt(match[1].replace(/,/g, ''), 10) || 0;
                            }
                        }
                    }
                    else {
                        emitLog(isError ? 'stderr' : 'stdout', line);
                    }
                    if (onProgress) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'running',
                            percentage: Math.min(95, processedObjects * 5),
                            currentStep: line.substring(0, 70),
                            processedObjects,
                            processedRows: totalRows,
                            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000)
                        });
                    }
                }
            };
            child.stdout?.on('data', (d) => handleOutput(d, false));
            child.stderr?.on('data', (d) => handleOutput(d, true));
            child.on('close', async (code) => {
                this.runningProcesses.delete(options.jobId);
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                // Clean up parfile
                try {
                    if (fs_1.default.existsSync(parFilePath))
                        fs_1.default.unlinkSync(parFilePath);
                }
                catch (e) { }
                if (code === 0 || code === 5) {
                    // Exit code 0 is success, 5 is completed with warnings in expdp
                    emitLog('success', `Data Pump export selesai di server (exit code ${code}) dalam ${elapsed}s!`);
                    // Otomatis tarik file .dmp dan .log langsung ke laptop pengguna!
                    emitLog('info', `📥 Mengunduh file dump (.dmp) dari server Oracle ke laptop...`);
                    const downloadedDmp = await this.downloadFileFromOracleDirectory(config, dirObject, dumpFileName, finalDumpPath, emitLog);
                    await this.downloadFileFromOracleDirectory(config, dirObject, logFileName, finalLogPath, emitLog);
                    if (!downloadedDmp) {
                        emitLog('info', `📌 File dump tetap tersimpan di Server Oracle: [${dirObject}] -> ${dumpFileName}`);
                        emitLog('info', `💡 Cek path fisik folder di server via SQL: SELECT DIRECTORY_PATH FROM ALL_DIRECTORIES WHERE DIRECTORY_NAME = '${dirObject}';`);
                    }
                    if (onProgress) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'completed',
                            percentage: 100,
                            currentStep: downloadedDmp ? 'Export & Download Selesai' : 'Export Completed (Server)',
                            processedObjects,
                            processedRows: totalRows,
                            elapsedSeconds: elapsed,
                            outputFilePath: finalDumpPath
                        });
                    }
                    resolve({ success: true, filePath: finalDumpPath });
                }
                else {
                    const errorMsg = `expdp process exited with error code ${code}`;
                    emitLog('error', errorMsg);
                    if (onProgress) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'failed',
                            percentage: 0,
                            currentStep: 'Failed',
                            elapsedSeconds: elapsed,
                            error: errorMsg
                        });
                    }
                    resolve({ success: false, error: errorMsg, filePath: finalDumpPath });
                }
            });
            child.on('error', (err) => {
                this.runningProcesses.delete(options.jobId);
                const errorMsg = `Failed to spawn expdp: ${err.message}. Ensure Oracle Client tools (expdp) are installed and added to PATH or configured in Settings.`;
                emitLog('error', errorMsg);
                if (onProgress) {
                    onProgress({
                        jobId: options.jobId,
                        status: 'failed',
                        percentage: 0,
                        currentStep: 'Failed to launch expdp',
                        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                        error: errorMsg
                    });
                }
                resolve({ success: false, error: errorMsg });
            });
        });
    }
    async runImpdp(config, options, customImpdpPath, onLog, onProgress) {
        const startTime = Date.now();
        const emitLog = (type, message) => {
            if (onLog) {
                onLog({
                    id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                    timestamp: new Date().toLocaleTimeString(),
                    type,
                    message,
                });
            }
        };
        const binaryInfo = this.detectOracleBinaries(customImpdpPath);
        const impdpExe = customImpdpPath && fs_1.default.existsSync(customImpdpPath)
            ? customImpdpPath
            : (binaryInfo.impdpPath || 'impdp');
        emitLog('info', `Initializing Oracle Data Pump (impdp) Restore: ${options.jobId}`);
        emitLog('info', `Using executable: ${impdpExe}`);
        const baseDir = path_1.default.dirname(options.backupFilePath);
        const dumpFileName = path_1.default.basename(options.backupFilePath);
        const baseName = dumpFileName.replace(/\.(dmp|par|log)$/i, '');
        const parFilePath = path_1.default.join(baseDir, `${baseName}_imp.par`);
        const logFileName = `${baseName}_imp.log`;
        // Build PARFILE
        const parLines = [];
        const dirObject = options.datapumpDirectory || 'DATA_PUMP_DIR';
        parLines.push(`DIRECTORY=${dirObject}`);
        parLines.push(`DUMPFILE=${dumpFileName}`);
        parLines.push(`LOGFILE=${logFileName}`);
        // Remap Schema (e.g. REMAP_SCHEMA=HR:HR_DEV)
        if (options.remapSchemaFrom && options.remapSchemaTo) {
            parLines.push(`REMAP_SCHEMA=${options.remapSchemaFrom}:${options.remapSchemaTo}`);
        }
        // Remap Tablespace (e.g. REMAP_TABLESPACE=USERS:USERS_DEV)
        if (options.remapTablespaceFrom && options.remapTablespaceTo) {
            parLines.push(`REMAP_TABLESPACE=${options.remapTablespaceFrom}:${options.remapTablespaceTo}`);
        }
        // Table Exists Action
        if (options.tableExistsAction) {
            parLines.push(`TABLE_EXISTS_ACTION=${options.tableExistsAction}`);
        }
        // Content: ALL / DATA_ONLY / METADATA_ONLY
        if (options.includeData === false && options.includeDdl !== false) {
            parLines.push('CONTENT=METADATA_ONLY');
        }
        else if (options.includeData !== false && options.includeDdl === false) {
            parLines.push('CONTENT=DATA_ONLY');
        }
        // Parallel
        if (options.parallel && options.parallel > 1) {
            parLines.push(`PARALLEL=${options.parallel}`);
        }
        fs_1.default.writeFileSync(parFilePath, parLines.join('\r\n'), 'utf-8');
        emitLog('info', `Generated Parameter File (${parFilePath}):\n${parLines.join('\n')}`);
        let connString = '';
        const connectTarget = config.serviceName || config.sid || 'orcl';
        const hostPort = `${config.host}:${config.port}/${connectTarget}`;
        if (config.privilege === 'SYSDBA') {
            connString = `"${config.user}/${config.password || ''}@//${hostPort} AS SYSDBA"`;
        }
        else {
            connString = `"${config.user}/${config.password || ''}@//${hostPort}"`;
        }
        const args = [connString, `parfile="${parFilePath}"`];
        return new Promise((resolve) => {
            emitLog('info', `Spawning impdp process...`);
            const child = (0, child_process_1.spawn)(impdpExe, args, {
                shell: true,
                windowsHide: true,
                env: {
                    ...process.env,
                    ...(binaryInfo.oracleHome ? { ORACLE_HOME: binaryInfo.oracleHome } : {}),
                }
            });
            this.runningProcesses.set(options.jobId, child);
            let processedObjects = 0;
            const handleOutput = (data, isError) => {
                const text = data.toString('utf-8');
                const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
                for (const line of lines) {
                    if (line.includes('ORA-') || line.includes('UDI-') || line.includes('KUP-')) {
                        emitLog('error', line);
                    }
                    else if (line.includes('Processing object type') || line.includes('. . imported')) {
                        emitLog('stdout', line);
                        processedObjects++;
                    }
                    else {
                        emitLog(isError ? 'stderr' : 'stdout', line);
                    }
                    if (onProgress) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'running',
                            percentage: Math.min(95, processedObjects * 5),
                            currentStep: line.substring(0, 70),
                            processedObjects,
                            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000)
                        });
                    }
                }
            };
            child.stdout?.on('data', (d) => handleOutput(d, false));
            child.stderr?.on('data', (d) => handleOutput(d, true));
            child.on('close', (code) => {
                this.runningProcesses.delete(options.jobId);
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                try {
                    if (fs_1.default.existsSync(parFilePath))
                        fs_1.default.unlinkSync(parFilePath);
                }
                catch (e) { }
                if (code === 0 || code === 5) {
                    emitLog('success', `Data Pump import completed with exit code ${code} in ${elapsed}s!`);
                    if (onProgress) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'completed',
                            percentage: 100,
                            currentStep: 'Import Completed Successfully',
                            processedObjects,
                            elapsedSeconds: elapsed
                        });
                    }
                    resolve({ success: true });
                }
                else {
                    const errorMsg = `impdp process exited with code ${code}`;
                    emitLog('error', errorMsg);
                    if (onProgress) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'failed',
                            percentage: 0,
                            currentStep: 'Failed',
                            elapsedSeconds: elapsed,
                            error: errorMsg
                        });
                    }
                    resolve({ success: false, error: errorMsg });
                }
            });
            child.on('error', (err) => {
                this.runningProcesses.delete(options.jobId);
                const errorMsg = `Failed to spawn impdp: ${err.message}. Ensure Oracle Client tools (impdp) are installed and added to PATH or configured in Settings.`;
                emitLog('error', errorMsg);
                if (onProgress) {
                    onProgress({
                        jobId: options.jobId,
                        status: 'failed',
                        percentage: 0,
                        currentStep: 'Failed to launch impdp',
                        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                        error: errorMsg
                    });
                }
                resolve({ success: false, error: errorMsg });
            });
        });
    }
    async downloadFileFromOracleDirectory(config, dirObject, fileName, targetLocalPath, emitLog) {
        let connection = null;
        try {
            const connectTarget = config.serviceName
                ? `${config.host}:${config.port}/${config.serviceName}`
                : `${config.host}:${config.port}:${config.sid || 'orcl'}`;
            connection = await oracledb_1.default.getConnection({
                user: config.user,
                password: config.password,
                connectString: connectTarget,
                privilege: config.privilege === 'SYSDBA' ? oracledb_1.default.SYSDBA : undefined,
            });
            const plsql = `
        DECLARE
          l_bfile BFILE;
          l_len   NUMBER;
        BEGIN
          l_bfile := BFILENAME(:dir, :file);
          IF DBMS_LOB.FILEEXISTS(l_bfile) = 1 THEN
            DBMS_LOB.FILEOPEN(l_bfile, DBMS_LOB.FILE_READONLY);
            l_len := DBMS_LOB.GETLENGTH(l_bfile);
            DBMS_LOB.CREATETEMPORARY(:lob, FALSE);
            DBMS_LOB.LOADFROMFILE(:lob, l_bfile, l_len);
            DBMS_LOB.FILECLOSE(l_bfile);
            :status := 1;
            :file_size := l_len;
            :err_msg := 'OK';
          ELSE
            :status := 0;
            :file_size := 0;
            :err_msg := 'File tidak ditemukan di direktori Oracle ' || :dir;
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            :status := -1;
            :file_size := 0;
            :err_msg := SQLERRM;
        END;
      `;
            const result = await connection.execute(plsql, {
                dir: dirObject,
                file: fileName,
                status: { dir: oracledb_1.default.BIND_OUT, type: oracledb_1.default.NUMBER },
                file_size: { dir: oracledb_1.default.BIND_OUT, type: oracledb_1.default.NUMBER },
                err_msg: { dir: oracledb_1.default.BIND_OUT, type: oracledb_1.default.STRING, maxSize: 1000 },
                lob: { dir: oracledb_1.default.BIND_OUT, type: oracledb_1.default.BLOB },
            });
            if (result.outBinds.status === 1 && result.outBinds.lob) {
                const lob = result.outBinds.lob;
                const totalBytes = result.outBinds.file_size || 0;
                const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
                emitLog('info', `Mentransfer ${fileName} (${totalMB} MB) dari server ke laptop...`);
                const writeStream = fs_1.default.createWriteStream(targetLocalPath);
                await new Promise((resolve, reject) => {
                    lob.pipe(writeStream);
                    writeStream.on('finish', () => resolve());
                    writeStream.on('error', (err) => reject(err));
                    lob.on('error', (err) => reject(err));
                });
                emitLog('success', `✅ File ${fileName} (${totalMB} MB) berhasil didownload ke laptop: ${targetLocalPath}`);
                return true;
            }
            else {
                const err = result.outBinds.err_msg || 'Gagal membaca file dari server';
                emitLog('warning', `⚠️ Info transfer: ${err}. File tetap tersimpan aman di server Oracle.`);
                return false;
            }
        }
        catch (e) {
            emitLog('warning', `⚠️ Info transfer: ${e.message}. File dump (.dmp) tetap tersimpan di server database Oracle.`);
            return false;
        }
        finally {
            if (connection) {
                try {
                    await connection.close();
                }
                catch (_) { }
            }
        }
    }
}
exports.DataPumpService = DataPumpService;
