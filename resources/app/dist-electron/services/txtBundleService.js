"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TxtBundleService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class TxtBundleService {
    oracleService;
    constructor(oracleService) {
        this.oracleService = oracleService;
    }
    /**
     * Scan folder or list of files and inspect schema structure
     */
    async analyzeBundle(sourcePathOrFiles) {
        try {
            let filePaths = [];
            let sourceDir = '';
            if (typeof sourcePathOrFiles === 'string') {
                sourceDir = path_1.default.resolve(sourcePathOrFiles);
                if (!fs_1.default.existsSync(sourceDir)) {
                    throw new Error(`Direktori sumber tidak ditemukan: ${sourceDir}`);
                }
                const stat = fs_1.default.statSync(sourceDir);
                if (stat.isDirectory()) {
                    const files = fs_1.default.readdirSync(sourceDir);
                    filePaths = files
                        .filter((f) => /\.(txt|reg|csv|tsv|dat)$/i.test(f))
                        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                        .map((f) => path_1.default.join(sourceDir, f));
                }
                else {
                    filePaths = [sourceDir];
                    sourceDir = path_1.default.dirname(sourceDir);
                }
            }
            else if (Array.isArray(sourcePathOrFiles)) {
                filePaths = sourcePathOrFiles.filter((f) => fs_1.default.existsSync(f));
                if (filePaths.length > 0) {
                    sourceDir = path_1.default.dirname(filePaths[0]);
                }
            }
            if (filePaths.length === 0) {
                throw new Error('Tidak ditemukan file data TXT/REG/CSV pada jalur yang dipilih.');
            }
            // Check first file to detect format
            const sampleFile = filePaths[0];
            const sampleContent = fs_1.default.readFileSync(sampleFile, 'utf8');
            const lines = sampleContent.split(/\r?\n/).map((l) => l.trim());
            const isBloomberg = lines.some((l) => l === 'START-OF-FIELDS' || l === 'START-OF-DATA') ||
                lines.some((l) => l.startsWith('RUNDATE='));
            if (isBloomberg) {
                return this.analyzeBloombergBundle(sourceDir, filePaths);
            }
            else {
                return this.analyzeDelimitedBundle(sourceDir, filePaths);
            }
        }
        catch (err) {
            return {
                sourcePath: typeof sourcePathOrFiles === 'string' ? sourcePathOrFiles : '',
                totalFiles: 0,
                sampleFiles: [],
                fileType: 'unknown',
                suggestedTableName: 'DATA_IMPORT',
                columns: [],
                previewRows: [],
                totalEstimatedRows: 0,
                error: err.message || String(err),
            };
        }
    }
    /**
     * Analyze Bloomberg Data License bundle (e.g. DSSK_OBLIGASINEGARA-*.txt)
     */
    analyzeBloombergBundle(sourceDir, filePaths) {
        let replyFileName = '';
        const bbgFields = [];
        const previewRows = [];
        const rawSampleLines = [];
        let rowsPerFile = 0;
        let rundateSample = '';
        // Scan the first few files to extract fields and metadata
        const sampleFilesCount = Math.min(filePaths.length, 5);
        for (let i = 0; i < sampleFilesCount; i++) {
            const filePath = filePaths[i];
            const fileName = path_1.default.basename(filePath);
            const content = fs_1.default.readFileSync(filePath, 'utf8');
            const lines = content.split(/\r?\n/).map((l) => l.trim());
            let rundate = '';
            let section = 'HEADER';
            const fileRows = [];
            for (const line of lines) {
                if (!line)
                    continue;
                if (line.startsWith('RUNDATE=')) {
                    rundate = line.split('=')[1].trim();
                    if (!rundateSample)
                        rundateSample = rundate;
                }
                if (line.startsWith('REPLYFILENAME=')) {
                    replyFileName = line.split('=')[1].trim();
                }
                if (line === 'START-OF-FIELDS') {
                    section = 'FIELDS';
                    continue;
                }
                if (line === 'END-OF-FIELDS') {
                    section = 'WAIT_DATA';
                    continue;
                }
                if (line === 'START-OF-DATA') {
                    section = 'DATA';
                    continue;
                }
                if (line === 'END-OF-DATA') {
                    section = 'FOOTER';
                    continue;
                }
                if (section === 'FIELDS') {
                    if (!bbgFields.includes(line)) {
                        bbgFields.push(line);
                    }
                }
                else if (section === 'DATA') {
                    // Strictly lines between START-OF-DATA and END-OF-DATA
                    if (rawSampleLines.length < 10) {
                        rawSampleLines.push(line);
                    }
                    const parts = line.split('|');
                    const securityId = parts[0]?.trim() || '';
                    const statusCode = parts[1] ? parseInt(parts[1], 10) : 0;
                    const numFields = parts[2] ? parseInt(parts[2], 10) : 0;
                    const fieldValues = parts.slice(3, 3 + bbgFields.length);
                    // Format rundate YYYYMMDD -> YYYY-MM-DD
                    let formattedRundate = rundate;
                    if (rundate && rundate.length === 8 && /^\d{8}$/.test(rundate)) {
                        formattedRundate = `${rundate.slice(0, 4)}-${rundate.slice(4, 6)}-${rundate.slice(6, 8)}`;
                    }
                    const rowObj = {
                        RUNDATE: formattedRundate,
                        SECURITY_ID: securityId,
                        STATUS_CODE: statusCode,
                        NUM_FIELDS: numFields,
                    };
                    bbgFields.forEach((fieldName, fIdx) => {
                        const rawVal = fieldValues[fIdx]?.trim();
                        if (rawVal !== undefined && rawVal !== '') {
                            const numVal = parseFloat(rawVal);
                            rowObj[fieldName] = !isNaN(numVal) && isFinite(Number(rawVal)) ? numVal : rawVal;
                        }
                        else {
                            rowObj[fieldName] = null;
                        }
                    });
                    rowObj.FILE_NAME = fileName;
                    fileRows.push(rowObj);
                }
            }
            if (rowsPerFile === 0 && fileRows.length > 0) {
                rowsPerFile = fileRows.length;
            }
            if (previewRows.length < 20) {
                previewRows.push(...fileRows.slice(0, 20 - previewRows.length));
            }
        }
        // Build suggested table name with DATA_ prefix
        let suggestedTable = '';
        if (replyFileName) {
            suggestedTable = replyFileName.replace(/\.(REG|TXT|DAT)$/i, '');
        }
        else if (sourceDir) {
            suggestedTable = path_1.default.basename(sourceDir);
        }
        suggestedTable = suggestedTable
            .toUpperCase()
            .replace(/[^A-Z0-9_]/g, '_');
        if (!suggestedTable.startsWith('DATA_')) {
            suggestedTable = `DATA_${suggestedTable}`;
        }
        suggestedTable = suggestedTable.slice(0, 30);
        if (!suggestedTable || suggestedTable === 'DATA_')
            suggestedTable = 'DATA_BBG_LICENSE';
        // Construct recommended columns
        const columns = [
            {
                name: 'RUNDATE',
                type: 'VARCHAR2(10)',
                isNullable: false,
                sampleValue: previewRows[0]?.RUNDATE || '2025-07-01',
                sourceType: 'header',
                sourceKey: 'RUNDATE',
                isMetadata: true,
            },
            {
                name: 'SECURITY_ID',
                type: 'VARCHAR2(50)',
                isNullable: false,
                sampleValue: previewRows[0]?.SECURITY_ID || 'CTIDR1Y Govt',
                sourceType: 'token',
                sourceIndex: 0,
                sourceKey: 'SECURITY_ID',
            },
            {
                name: 'STATUS_CODE',
                type: 'NUMBER(4)',
                isNullable: true,
                sampleValue: 0,
                sourceType: 'token',
                sourceIndex: 1,
                sourceKey: 'STATUS_CODE',
            },
            {
                name: 'NUM_FIELDS',
                type: 'NUMBER(4)',
                isNullable: true,
                sampleValue: bbgFields.length,
                sourceType: 'token',
                sourceIndex: 2,
                sourceKey: 'NUM_FIELDS',
            },
        ];
        // Infer column data types for bbgFields
        bbgFields.forEach((f, fIdx) => {
            let isNumeric = true;
            let sampleVal = null;
            for (const row of previewRows) {
                const val = row[f];
                if (val !== null && val !== undefined) {
                    if (sampleVal === null)
                        sampleVal = val;
                    if (typeof val !== 'number') {
                        isNumeric = false;
                    }
                }
            }
            columns.push({
                name: f.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
                type: isNumeric ? 'NUMBER(18,6)' : 'VARCHAR2(100)',
                isNullable: true,
                sampleValue: sampleVal,
                sourceType: 'field',
                sourceIndex: 3 + fIdx,
                sourceKey: f,
            });
        });
        // Add metadata columns
        columns.push({
            name: 'FILE_NAME',
            type: 'VARCHAR2(150)',
            isNullable: true,
            sampleValue: path_1.default.basename(filePaths[0]),
            sourceType: 'metadata',
            sourceKey: 'FILE_NAME',
            isMetadata: true,
        });
        columns.push({
            name: 'LOAD_TIMESTAMP',
            type: 'DATE',
            isNullable: true,
            sampleValue: 'SYSDATE',
            sourceType: 'metadata',
            sourceKey: 'LOAD_TIMESTAMP',
            isMetadata: true,
        });
        // Build interactive sampleTokens from the real START-OF-DATA row
        const sampleTokens = [];
        const firstRawLine = rawSampleLines[0] || '';
        const sampleParts = firstRawLine ? firstRawLine.split('|') : [];
        // Token 0: Security ID / Ticker
        sampleTokens.push({
            index: 0,
            label: 'Token 0 (Ticker / Security ID)',
            sampleValue: sampleParts[0]?.trim() || previewRows[0]?.SECURITY_ID || 'CTIDR1Y Govt',
            suggestedName: 'SECURITY_ID',
            suggestedType: 'VARCHAR2(50)',
            sourceType: 'token',
            sourceKey: 'SECURITY_ID',
        });
        // Token 1: Status Code
        sampleTokens.push({
            index: 1,
            label: 'Token 1 (Status Code)',
            sampleValue: sampleParts[1]?.trim() || '0',
            suggestedName: 'STATUS_CODE',
            suggestedType: 'NUMBER(4)',
            sourceType: 'token',
            sourceKey: 'STATUS_CODE',
        });
        // Token 2: Num Fields
        sampleTokens.push({
            index: 2,
            label: 'Token 2 (Jumlah Field)',
            sampleValue: sampleParts[2]?.trim() || String(bbgFields.length),
            suggestedName: 'NUM_FIELDS',
            suggestedType: 'NUMBER(4)',
            sourceType: 'token',
            sourceKey: 'NUM_FIELDS',
        });
        // Tokens for each Bloomberg Field (Token 3, 4, ...)
        bbgFields.forEach((f, fIdx) => {
            const tokenIdx = 3 + fIdx;
            const rawVal = sampleParts[tokenIdx]?.trim() || String(previewRows[0]?.[f] ?? '');
            const isNum = rawVal !== '' && !isNaN(parseFloat(rawVal)) && isFinite(Number(rawVal));
            sampleTokens.push({
                index: tokenIdx,
                label: `Token ${tokenIdx} (${f})`,
                sampleValue: rawVal || '-',
                suggestedName: f.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
                suggestedType: isNum ? 'NUMBER(18,6)' : 'VARCHAR2(100)',
                sourceType: 'field',
                sourceKey: f,
            });
        });
        // Any remaining tokens in the raw line
        if (sampleParts.length > 3 + bbgFields.length) {
            for (let k = 3 + bbgFields.length; k < sampleParts.length; k++) {
                const extraVal = sampleParts[k]?.trim();
                if (extraVal) {
                    const isNum = !isNaN(parseFloat(extraVal)) && isFinite(Number(extraVal));
                    sampleTokens.push({
                        index: k,
                        label: `Token ${k}`,
                        sampleValue: extraVal,
                        suggestedName: `FIELD_${k}`,
                        suggestedType: isNum ? 'NUMBER(18,6)' : 'VARCHAR2(100)',
                        sourceType: 'token',
                        sourceKey: `TOKEN_${k}`,
                    });
                }
            }
        }
        // Header & Metadata tokens
        sampleTokens.push({
            index: -1,
            label: 'Header: RUNDATE (Tanggal File)',
            sampleValue: previewRows[0]?.RUNDATE || '2025-12-01',
            suggestedName: 'RUNDATE',
            suggestedType: 'VARCHAR2(10)',
            sourceType: 'header',
            sourceKey: 'RUNDATE',
        });
        sampleTokens.push({
            index: -2,
            label: 'Metadata: FILE_NAME (Nama File TXT)',
            sampleValue: path_1.default.basename(filePaths[0]),
            suggestedName: 'FILE_NAME',
            suggestedType: 'VARCHAR2(150)',
            sourceType: 'metadata',
            sourceKey: 'FILE_NAME',
        });
        sampleTokens.push({
            index: -3,
            label: 'Metadata: LOAD_TIMESTAMP (SYSDATE)',
            sampleValue: 'SYSDATE',
            suggestedName: 'LOAD_TIMESTAMP',
            suggestedType: 'DATE',
            sourceType: 'metadata',
            sourceKey: 'LOAD_TIMESTAMP',
        });
        const totalEstimatedRows = filePaths.length * (rowsPerFile || 6);
        return {
            sourcePath: sourceDir,
            totalFiles: filePaths.length,
            sampleFiles: filePaths.slice(0, 5).map((f) => path_1.default.basename(f)),
            fileType: 'bloomberg',
            suggestedTableName: suggestedTable,
            columns,
            previewRows,
            totalEstimatedRows,
            rawSampleLines,
            sampleTokens,
            rundateSample,
        };
    }
    /**
     * Analyze Generic Delimited bundle (CSV, Pipe, Tab, Semicolon)
     */
    analyzeDelimitedBundle(sourceDir, filePaths) {
        const sampleFile = filePaths[0];
        const content = fs_1.default.readFileSync(sampleFile, 'utf8');
        const lines = content
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length === 0) {
            throw new Error('File sampel kosong.');
        }
        // Detect delimiter
        const headerLine = lines[0];
        const delimiters = ['|', ',', '\t', ';'];
        let bestDelim = ',';
        let maxCols = 0;
        for (const d of delimiters) {
            const count = headerLine.split(d).length;
            if (count > maxCols) {
                maxCols = count;
                bestDelim = d;
            }
        }
        const rawHeaders = headerLine.split(bestDelim).map((h) => h.trim().replace(/^["']|["']$/g, ''));
        const columns = [];
        const previewRows = [];
        // Parse up to 20 sample rows
        for (let i = 1; i < Math.min(lines.length, 21); i++) {
            const parts = lines[i].split(bestDelim).map((p) => p.trim().replace(/^["']|["']$/g, ''));
            const rowObj = {};
            rawHeaders.forEach((h, idx) => {
                const val = parts[idx] ?? '';
                const numVal = parseFloat(val);
                rowObj[h] = !isNaN(numVal) && isFinite(Number(val)) ? numVal : val;
            });
            previewRows.push(rowObj);
        }
        // Infer types
        rawHeaders.forEach((h) => {
            let isNumeric = true;
            let sampleVal = null;
            for (const row of previewRows) {
                const val = row[h];
                if (val !== null && val !== undefined && val !== '') {
                    if (sampleVal === null)
                        sampleVal = val;
                    if (typeof val !== 'number') {
                        isNumeric = false;
                    }
                }
            }
            columns.push({
                name: h.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30),
                type: isNumeric ? 'NUMBER(18,6)' : 'VARCHAR2(255)',
                isNullable: true,
                sampleValue: sampleVal,
            });
        });
        // Metadata columns
        columns.push({
            name: 'FILE_NAME',
            type: 'VARCHAR2(150)',
            isNullable: true,
            sampleValue: path_1.default.basename(sampleFile),
            isMetadata: true,
        });
        columns.push({
            name: 'LOAD_TIMESTAMP',
            type: 'DATE',
            isNullable: true,
            sampleValue: 'SYSDATE',
            isMetadata: true,
        });
        // Build sample tokens for delimited file
        const sampleTokens = rawHeaders.map((h, idx) => ({
            index: idx,
            label: `Kolom ${idx + 1} (${h})`,
            sampleValue: String(previewRows[0]?.[h] ?? ''),
            suggestedName: h,
            suggestedType: columns[idx]?.type || 'VARCHAR2(255)',
            sourceType: 'field',
            sourceKey: h,
        }));
        sampleTokens.push({
            index: -2,
            label: 'Metadata: FILE_NAME (Nama File)',
            sampleValue: path_1.default.basename(sampleFile),
            suggestedName: 'FILE_NAME',
            suggestedType: 'VARCHAR2(150)',
            sourceType: 'metadata',
            sourceKey: 'FILE_NAME',
        });
        sampleTokens.push({
            index: -3,
            label: 'Metadata: LOAD_TIMESTAMP (SYSDATE)',
            sampleValue: 'SYSDATE',
            suggestedName: 'LOAD_TIMESTAMP',
            suggestedType: 'DATE',
            sourceType: 'metadata',
            sourceKey: 'LOAD_TIMESTAMP',
        });
        let suggestedTable = path_1.default
            .basename(sourceDir || sampleFile)
            .replace(/\.(txt|csv|tsv|reg)$/i, '')
            .toUpperCase()
            .replace(/[^A-Z0-9_]/g, '_');
        if (!suggestedTable.startsWith('DATA_')) {
            suggestedTable = `DATA_${suggestedTable}`;
        }
        suggestedTable = suggestedTable.slice(0, 30);
        if (!suggestedTable || suggestedTable === 'DATA_')
            suggestedTable = 'DATA_IMPORT';
        const totalEstimatedRows = filePaths.length * (lines.length - 1);
        return {
            sourcePath: sourceDir,
            totalFiles: filePaths.length,
            sampleFiles: filePaths.slice(0, 5).map((f) => path_1.default.basename(f)),
            fileType: 'delimited',
            suggestedTableName: suggestedTable,
            columns,
            previewRows,
            totalEstimatedRows,
            rawSampleLines: lines.slice(1, 11),
            sampleTokens,
        };
    }
    /**
     * Execute Table Creation & Batch Data Insertion into Oracle
     */
    async executeBundleImport(config, options, onProgress) {
        const startTime = Date.now();
        let conn = null;
        try {
            // 1. Resolve files
            let filePaths = options.filePaths || [];
            if (filePaths.length === 0 && options.sourcePath) {
                const p = path_1.default.resolve(options.sourcePath);
                if (fs_1.default.existsSync(p)) {
                    const stat = fs_1.default.statSync(p);
                    if (stat.isDirectory()) {
                        filePaths = fs_1.default
                            .readdirSync(p)
                            .filter((f) => /\.(txt|reg|csv|tsv|dat)$/i.test(f))
                            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
                            .map((f) => path_1.default.join(p, f));
                    }
                    else {
                        filePaths = [p];
                    }
                }
            }
            if (filePaths.length === 0) {
                throw new Error('Tidak ada file yang dapat di-import.');
            }
            // 2. Connect to Oracle
            conn = await this.oracleService.createConnection(config);
            const schema = (options.schema || config.schema || config.user).toUpperCase();
            const tableName = options.tableName.toUpperCase().replace(/[^A-Z0-9_]/g, '');
            const fullTableName = `"${schema}"."${tableName}"`;
            // 3. Check if table exists
            let tableExists = false;
            try {
                const checkSql = `SELECT 1 FROM ALL_TABLES WHERE OWNER = :1 AND TABLE_NAME = :2`;
                const res = await conn.execute(checkSql, [schema, tableName]);
                tableExists = (res.rows && res.rows.length > 0) || false;
            }
            catch (e) {
                tableExists = false;
            }
            // 4. Handle table strategy
            if (options.createTableStrategy === 'drop_and_recreate') {
                if (tableExists) {
                    try {
                        await conn.execute(`DROP TABLE ${fullTableName} PURGE`);
                        tableExists = false;
                    }
                    catch (e) {
                        await conn.execute(`DROP TABLE ${fullTableName}`);
                        tableExists = false;
                    }
                }
            }
            // 5. Create table if not exists or dropped
            if (!tableExists && options.createTableStrategy !== 'append_only') {
                const colDefinitions = options.columns.map((c) => {
                    const nullability = c.isNullable ? '' : ' NOT NULL';
                    const isSysdate = c.name === 'LOAD_TIMESTAMP' ||
                        (c.sourceType === 'metadata' && c.sourceKey === 'LOAD_TIMESTAMP');
                    const defaultVal = isSysdate ? ' DEFAULT SYSDATE' : '';
                    return `  "${c.name}" ${c.type}${defaultVal}${nullability}`;
                });
                const createTableSql = `CREATE TABLE ${fullTableName} (\n${colDefinitions.join(',\n')}\n)`;
                await conn.execute(createTableSql);
                tableExists = true;
            }
            // 6. Truncate if requested
            if (tableExists && options.truncateBefore) {
                try {
                    await conn.execute(`TRUNCATE TABLE ${fullTableName}`);
                }
                catch (e) {
                    await conn.execute(`DELETE FROM ${fullTableName}`);
                    await conn.commit();
                }
            }
            // 7. Prepare Insert SQL
            // Filter out LOAD_TIMESTAMP if it defaults to SYSDATE and we don't bind it
            const bindColumns = options.columns.filter((c) => c.name !== 'LOAD_TIMESTAMP' &&
                !(c.sourceType === 'metadata' && c.sourceKey === 'LOAD_TIMESTAMP'));
            const colList = bindColumns.map((c) => `"${c.name}"`).join(', ');
            const valList = bindColumns.map((_, idx) => `:${idx + 1}`).join(', ');
            const insertSql = `INSERT INTO ${fullTableName} (${colList}) VALUES (${valList})`;
            // 8. Stream & parse files in batches
            let totalInsertedRows = 0;
            const batchRows = [];
            const batchSize = options.batchSize || 500;
            for (let fileIdx = 0; fileIdx < filePaths.length; fileIdx++) {
                const filePath = filePaths[fileIdx];
                const fileName = path_1.default.basename(filePath);
                const content = fs_1.default.readFileSync(filePath, 'utf8');
                const lines = content.split(/\r?\n/).map((l) => l.trim());
                const isBloomberg = lines.some((l) => l === 'START-OF-FIELDS' || l === 'START-OF-DATA') ||
                    lines.some((l) => l.startsWith('RUNDATE='));
                if (isBloomberg) {
                    this.parseBloombergRows(lines, fileName, bindColumns, batchRows);
                }
                else {
                    this.parseDelimitedRows(lines, fileName, bindColumns, batchRows);
                }
                // Execute batch insert if chunk reached
                if (batchRows.length >= batchSize) {
                    await conn.executeMany(insertSql, batchRows, { autoCommit: false });
                    totalInsertedRows += batchRows.length;
                    batchRows.length = 0;
                }
                // Report progress
                if (onProgress) {
                    onProgress({
                        currentFile: fileIdx + 1,
                        totalFiles: filePaths.length,
                        currentFileName: fileName,
                        processedRows: totalInsertedRows + batchRows.length,
                        percent: Math.round(((fileIdx + 1) / filePaths.length) * 100),
                    });
                }
            }
            // Flush remaining rows
            if (batchRows.length > 0) {
                await conn.executeMany(insertSql, batchRows, { autoCommit: false });
                totalInsertedRows += batchRows.length;
                batchRows.length = 0;
            }
            // Commit final transaction
            await conn.commit();
            const executionTimeMs = Date.now() - startTime;
            return {
                success: true,
                tableName,
                schema,
                totalFilesProcessed: filePaths.length,
                totalRowsInserted: totalInsertedRows,
                executionTimeMs,
            };
        }
        catch (err) {
            if (conn) {
                try {
                    await conn.rollback();
                }
                catch (e) { }
            }
            return {
                success: false,
                tableName: options.tableName,
                schema: (options.schema || config.schema || config.user).toUpperCase(),
                totalFilesProcessed: 0,
                totalRowsInserted: 0,
                executionTimeMs: Date.now() - startTime,
                error: err.message || String(err),
            };
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch (e) { }
            }
        }
    }
    parseBloombergRows(lines, fileName, targetColumns, outBatch) {
        let rundate = '';
        const fields = [];
        let section = 'HEADER';
        for (const line of lines) {
            if (!line)
                continue;
            if (line.startsWith('RUNDATE='))
                rundate = line.split('=')[1].trim();
            if (line === 'START-OF-FIELDS') {
                section = 'FIELDS';
                continue;
            }
            if (line === 'END-OF-FIELDS') {
                section = 'WAIT_DATA';
                continue;
            }
            if (line === 'START-OF-DATA') {
                section = 'DATA';
                continue;
            }
            if (line === 'END-OF-DATA') {
                section = 'FOOTER';
                continue;
            }
            if (section === 'FIELDS') {
                fields.push(line);
            }
            else if (section === 'DATA') {
                const parts = line.split('|');
                const securityId = parts[0]?.trim() || '';
                const statusCode = parts[1] ? parseInt(parts[1], 10) : 0;
                const numFields = parts[2] ? parseInt(parts[2], 10) : 0;
                const fieldValues = parts.slice(3, 3 + fields.length);
                let formattedRundate = rundate;
                if (rundate && rundate.length === 8 && /^\d{8}$/.test(rundate)) {
                    formattedRundate = `${rundate.slice(0, 4)}-${rundate.slice(4, 6)}-${rundate.slice(6, 8)}`;
                }
                const rowMap = {
                    RUNDATE: formattedRundate,
                    SECURITY_ID: securityId,
                    STATUS_CODE: isNaN(statusCode) ? 0 : statusCode,
                    NUM_FIELDS: isNaN(numFields) ? 0 : numFields,
                    FILE_NAME: fileName,
                };
                fields.forEach((f, idx) => {
                    const colName = f.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                    const raw = fieldValues[idx]?.trim();
                    if (raw !== undefined && raw !== '') {
                        const num = parseFloat(raw);
                        rowMap[colName] = !isNaN(num) && isFinite(Number(raw)) ? num : raw;
                    }
                    else {
                        rowMap[colName] = null;
                    }
                });
                // Map into targetColumns array order
                const rowArray = targetColumns.map((col) => {
                    let val = null;
                    if (col.sourceType === 'token' && col.sourceIndex !== undefined) {
                        val = parts[col.sourceIndex]?.trim();
                    }
                    else if (col.sourceType === 'field' && col.sourceIndex !== undefined) {
                        val = parts[col.sourceIndex]?.trim();
                    }
                    else if (col.sourceKey && rowMap[col.sourceKey] !== undefined) {
                        val = rowMap[col.sourceKey];
                    }
                    else if (rowMap[col.name] !== undefined) {
                        val = rowMap[col.name];
                    }
                    else if (col.sourceType === 'header' && (col.sourceKey === 'RUNDATE' || col.name.includes('DATE'))) {
                        val = formattedRundate;
                    }
                    else if (col.sourceType === 'metadata' && (col.sourceKey === 'FILE_NAME' || col.name === 'FILE_NAME')) {
                        val = fileName;
                    }
                    else if (col.sourceIndex !== undefined && parts[col.sourceIndex] !== undefined) {
                        val = parts[col.sourceIndex]?.trim();
                    }
                    if (val === undefined || val === null || val === '')
                        return null;
                    // Convert numeric if column type is NUMBER
                    if (col.type && col.type.toUpperCase().startsWith('NUMBER')) {
                        const num = parseFloat(String(val).replace(/,/g, ''));
                        return !isNaN(num) && isFinite(Number(num)) ? num : null;
                    }
                    // Convert Date if column type is DATE
                    if (col.type && col.type.toUpperCase().startsWith('DATE')) {
                        if (val instanceof Date)
                            return val;
                        const sVal = String(val).trim();
                        if (/^\d{4}-\d{2}-\d{2}$/.test(sVal)) {
                            const [y, m, d] = sVal.split('-').map(Number);
                            return new Date(y, m - 1, d);
                        }
                        else if (/^\d{8}$/.test(sVal)) {
                            const y = parseInt(sVal.slice(0, 4), 10);
                            const m = parseInt(sVal.slice(4, 6), 10);
                            const d = parseInt(sVal.slice(6, 8), 10);
                            return new Date(y, m - 1, d);
                        }
                    }
                    return val;
                });
                outBatch.push(rowArray);
            }
        }
    }
    parseDelimitedRows(lines, fileName, targetColumns, outBatch) {
        if (lines.length < 2)
            return;
        const headerLine = lines[0];
        const delimiters = ['|', ',', '\t', ';'];
        let bestDelim = ',';
        let maxCols = 0;
        for (const d of delimiters) {
            const count = headerLine.split(d).length;
            if (count > maxCols) {
                maxCols = count;
                bestDelim = d;
            }
        }
        const rawHeaders = headerLine
            .split(bestDelim)
            .map((h) => h.trim().replace(/^["']|["']$/g, '').toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(bestDelim).map((p) => p.trim().replace(/^["']|["']$/g, ''));
            const rowMap = {
                FILE_NAME: fileName,
            };
            rawHeaders.forEach((h, idx) => {
                const val = parts[idx] ?? '';
                const numVal = parseFloat(val);
                rowMap[h] = !isNaN(numVal) && isFinite(Number(val)) ? numVal : val;
            });
            const rowArray = targetColumns.map((col) => {
                const val = rowMap[col.name];
                if (val === undefined || val === null || val === '')
                    return null;
                return val;
            });
            outBatch.push(rowArray);
        }
    }
}
exports.TxtBundleService = TxtBundleService;
