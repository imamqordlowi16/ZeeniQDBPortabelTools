"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TxtBundleService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
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
        let detectedNumFields = 0;
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
                    if (detectedNumFields === 0 && numFields > 0) {
                        detectedNumFields = numFields;
                    }
                    // Jumlah field data dilihat langsung dari Token 2 (parts[2])
                    const activeFieldCount = numFields > 0 ? numFields : bbgFields.length;
                    const fieldValues = parts.slice(3, 3 + activeFieldCount);
                    // Format rundate YYYYMMDD -> YYYY-MM-DD
                    let formattedRundate = rundate;
                    if (rundate && rundate.length === 8 && /^\d{8}$/.test(rundate)) {
                        formattedRundate = `${rundate.slice(0, 4)}-${rundate.slice(4, 6)}-${rundate.slice(6, 8)}`;
                    }
                    const rowObj = {
                        ID: crypto_1.default.randomUUID(),
                        RUNDATE: formattedRundate,
                        SECURITY_ID: securityId,
                        STATUS_CODE: statusCode,
                        NUM_FIELDS: numFields,
                    };
                    for (let fIdx = 0; fIdx < activeFieldCount; fIdx++) {
                        const fieldName = (bbgFields[fIdx] || `FIELD_${fIdx + 1}`).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                        const rawVal = fieldValues[fIdx]?.trim();
                        if (rawVal !== undefined && rawVal !== '') {
                            const numVal = parseFloat(rawVal);
                            rowObj[fieldName] = !isNaN(numVal) && isFinite(Number(rawVal)) ? numVal : rawVal;
                        }
                        else {
                            rowObj[fieldName] = null;
                        }
                        rowObj[`FIELD_${fIdx + 1}`] = rowObj[fieldName];
                        rowObj[`TOKEN_${3 + fIdx}`] = rowObj[fieldName];
                    }
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
        // Construct recommended columns (Diawali kolom ID / GUID default)
        const columns = [
            {
                name: 'ID',
                type: 'VARCHAR2(36)',
                isNullable: false,
                sampleValue: previewRows[0]?.ID || crypto_1.default.randomUUID(),
                sourceType: 'guid',
                sourceKey: 'ID',
                isMetadata: true,
            },
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
        ];
        const totalDataFields = detectedNumFields > 0 ? detectedNumFields : (bbgFields.length || 2);
        columns.push({
            name: 'NUM_FIELDS',
            type: 'NUMBER(4)',
            isNullable: true,
            sampleValue: totalDataFields,
            sourceType: 'token',
            sourceIndex: 2,
            sourceKey: 'NUM_FIELDS',
        });
        // Infer column data types for data fields (Token 3, Token 4, ...) based on Token 2
        for (let fIdx = 0; fIdx < totalDataFields; fIdx++) {
            const fName = (bbgFields[fIdx] || `FIELD_${fIdx + 1}`).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            let isNumeric = true;
            let sampleVal = null;
            for (const row of previewRows) {
                const val = row[fName] ?? (bbgFields[fIdx] ? row[bbgFields[fIdx]] : undefined);
                if (val !== null && val !== undefined) {
                    if (sampleVal === null)
                        sampleVal = val;
                    if (typeof val !== 'number') {
                        isNumeric = false;
                    }
                }
            }
            columns.push({
                name: fName,
                type: isNumeric ? 'NUMBER(18,6)' : 'VARCHAR2(100)',
                isNullable: true,
                sampleValue: sampleVal,
                sourceType: 'token',
                sourceIndex: 3 + fIdx,
                sourceKey: fName,
            });
        }
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
        // Header & Metadata & GUID tokens
        sampleTokens.unshift({
            index: -4,
            label: 'ID (GUID / Primary Key)',
            sampleValue: previewRows[0]?.ID || crypto_1.default.randomUUID(),
            suggestedName: 'ID',
            suggestedType: 'VARCHAR2(36)',
            sourceType: 'guid',
            sourceKey: 'ID',
        });
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
        // Token 2: Num Fields (Jumlah Field ditentukan dari sini)
        sampleTokens.push({
            index: 2,
            label: `Token 2 (Jumlah Field Data: ${totalDataFields} Field)`,
            sampleValue: sampleParts[2]?.trim() || String(totalDataFields),
            suggestedName: 'NUM_FIELDS',
            suggestedType: 'NUMBER(4)',
            sourceType: 'token',
            sourceKey: 'NUM_FIELDS',
        });
        // Tokens for each Field Data according to Token 2 count (Token 3, 4, ...)
        for (let fIdx = 0; fIdx < totalDataFields; fIdx++) {
            const tokenIdx = 3 + fIdx;
            const fName = (bbgFields[fIdx] || `FIELD_${fIdx + 1}`).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
            const rawVal = sampleParts[tokenIdx]?.trim() || String(previewRows[0]?.[fName] ?? '');
            const isNum = rawVal !== '' && !isNaN(parseFloat(rawVal)) && isFinite(Number(rawVal));
            sampleTokens.push({
                index: tokenIdx,
                label: `Token ${tokenIdx} (Field Data ${fIdx + 1}: ${fName})`,
                sampleValue: rawVal || '-',
                suggestedName: fName,
                suggestedType: isNum ? 'NUMBER(18,6)' : 'VARCHAR2(100)',
                sourceType: 'token',
                sourceKey: fName,
            });
        }
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
            detectedNumFields: totalDataFields,
        };
    }
    /**
     * Parse single delimited line supporting RFC 4180 quotes, escaped quotes, and commas inside quotes
     */
    parseDelimitedLine(text, delimiter = ',') {
        const results = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '"') {
                if (inQuotes && text[i + 1] === '"') {
                    cur += '"';
                    i++; // Skip escaped quote
                }
                else {
                    inQuotes = !inQuotes;
                }
            }
            else if (ch === delimiter && !inQuotes) {
                results.push(cur.trim());
                cur = '';
            }
            else {
                cur += ch;
            }
        }
        results.push(cur.trim());
        return results.map((v) => v.replace(/^["']|["']$/g, '').trim());
    }
    /**
     * Find and parse accompanying .sql DDL file in the same directory (e.g. KINERJABANK_EXCEL.sql)
     */
    findAccompanyingSqlDdl(sampleFilePath) {
        try {
            const dir = path_1.default.dirname(sampleFilePath);
            const baseName = path_1.default.basename(sampleFilePath).replace(/\.(csv|txt|tsv|reg|dat)$/i, '');
            const candidates = [
                path_1.default.join(dir, `${baseName}.sql`),
                path_1.default.join(dir, `${baseName.replace(/_DATA_TABLE$/i, '')}.sql`),
                path_1.default.join(dir, `${baseName.replace(/_DATA$/i, '')}.sql`),
                path_1.default.join(dir, `${baseName.replace(/_TABLE$/i, '')}.sql`),
            ];
            let foundSqlPath = candidates.find((p) => fs_1.default.existsSync(p));
            if (!foundSqlPath && fs_1.default.existsSync(dir)) {
                const allSql = fs_1.default.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.sql'));
                if (allSql.length === 1) {
                    foundSqlPath = path_1.default.join(dir, allSql[0]);
                }
            }
            if (!foundSqlPath)
                return null;
            const sqlContent = fs_1.default.readFileSync(foundSqlPath, 'utf8');
            const tableMatch = sqlContent.match(/CREATE\s+TABLE\s+(?:\"?([A-Za-z0-9_]+)\"?\.)?\"?([A-Za-z0-9_]+)\"?\s*\(([\s\S]+?)\)\s*(?:NOCOMPRESS|LOGGING|PCTFREE|STORAGE|;|$)/i);
            if (!tableMatch)
                return null;
            const tableName = tableMatch[2];
            const body = tableMatch[3];
            const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
            const columns = new Map();
            for (const line of lines) {
                const clean = line.replace(/,$/, '').trim();
                if (/^(?:CONSTRAINT|PRIMARY|KEY|FOREIGN|UNIQUE|CHECK)/i.test(clean))
                    continue;
                const colMatch = clean.match(/^\"?([A-Za-z0-9_]+)\"?\s+([A-Za-z0-9_]+(?:\s*\([^)]+\))?)(?:\s+(NOT\s+NULL))?/i);
                if (colMatch) {
                    columns.set(colMatch[1].toUpperCase(), {
                        type: colMatch[2].toUpperCase().replace(/\s+/g, ''),
                        isNullable: !colMatch[3],
                    });
                }
            }
            return { tableName, columns };
        }
        catch (e) {
            return null;
        }
    }
    /**
     * Flexible Date & Timestamp Parser for Oracle batch insertion
     */
    parseFlexDate(val) {
        if (val === null || val === undefined)
            return null;
        if (val instanceof Date)
            return isNaN(val.getTime()) ? null : val;
        const sVal = String(val).trim();
        if (!sVal)
            return null;
        // 1. DD-MON-YY or DD-MON-YYYY with optional time, fractional seconds, and AM/PM
        // e.g. 14-MAR-25 21.10.31.000000000, 02-JAN-25 10.15.19.000000000, 06-AUG-24, 15-PEB-2023 10:15:00
        const monMatch = sVal.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2,4})(?:[\sT]+(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?(?:[.](\d+))?(?:\s*([AP]M))?)?$/i);
        if (monMatch) {
            const day = parseInt(monMatch[1], 10);
            const monStr = monMatch[2].toLowerCase();
            let year = parseInt(monMatch[3], 10);
            if (year < 100)
                year += year < 50 ? 2000 : 1900;
            const months = {
                jan: 0,
                feb: 1,
                peb: 1,
                mar: 2,
                apr: 3,
                may: 4,
                mei: 4,
                jun: 5,
                jul: 6,
                aug: 7,
                agu: 7,
                ags: 7,
                sep: 8,
                oct: 9,
                okt: 9,
                nov: 10,
                nop: 10,
                dec: 11,
                des: 11,
            };
            if (months[monStr] !== undefined) {
                let hr = monMatch[4] ? parseInt(monMatch[4], 10) : 0;
                const min = monMatch[5] ? parseInt(monMatch[5], 10) : 0;
                const sec = monMatch[6] ? parseInt(monMatch[6], 10) : 0;
                const ms = monMatch[7] ? parseInt(monMatch[7].slice(0, 3).padEnd(3, '0'), 10) : 0;
                const ampm = monMatch[8]?.toUpperCase();
                if (ampm === 'PM' && hr < 12)
                    hr += 12;
                if (ampm === 'AM' && hr === 12)
                    hr = 0;
                return new Date(year, months[monStr], day, hr, min, sec, ms);
            }
        }
        // 2. YYYY-MM-DD or YYYY/MM/DD with optional time and fractional seconds
        if (/^\d{4}[\/\-]\d{2}[\/\-]\d{2}/.test(sVal)) {
            const parts = sVal.split(/[- \/:.T]/).map(Number);
            return new Date(parts[0], parts[1] - 1, parts[2], parts[3] || 0, parts[4] || 0, parts[5] || 0, parts[6] ? parseInt(String(parts[6]).slice(0, 3).padEnd(3, '0'), 10) : 0);
        }
        // 3. YYYYMMDD
        if (/^\d{8}$/.test(sVal)) {
            const y = parseInt(sVal.slice(0, 4), 10);
            const m = parseInt(sVal.slice(4, 6), 10);
            const d = parseInt(sVal.slice(6, 8), 10);
            return new Date(y, m - 1, d);
        }
        // 4. DD/MM/YYYY or DD-MM-YYYY with optional time
        const dmyMatch = sVal.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[\sT]+(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?(?:\s*([AP]M))?)?$/i);
        if (dmyMatch) {
            const d = parseInt(dmyMatch[1], 10);
            const m = parseInt(dmyMatch[2], 10);
            const y = parseInt(dmyMatch[3], 10);
            let hr = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
            const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
            const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
            const ampm = dmyMatch[7]?.toUpperCase();
            if (ampm === 'PM' && hr < 12)
                hr += 12;
            if (ampm === 'AM' && hr === 12)
                hr = 0;
            return new Date(y, m - 1, d, hr, min, sec);
        }
        return null;
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
        // Check for accompanying .sql file in same folder
        const sqlDdl = this.findAccompanyingSqlDdl(sampleFile);
        // Detect delimiter
        const headerLine = lines[0];
        const delimiters = ['|', ',', '\t', ';'];
        let bestDelim = ',';
        let maxCols = 0;
        for (const d of delimiters) {
            const parts = this.parseDelimitedLine(headerLine, d);
            if (parts.length > maxCols) {
                maxCols = parts.length;
                bestDelim = d;
            }
        }
        const rawHeaders = this.parseDelimitedLine(headerLine, bestDelim);
        const columns = [
            {
                name: 'ID',
                type: 'VARCHAR2(36)',
                isNullable: false,
                sampleValue: crypto_1.default.randomUUID(),
                sourceType: 'guid',
                sourceKey: 'ID',
                isMetadata: true,
            },
        ];
        const previewRows = [];
        // Parse up to 20 sample rows
        for (let i = 1; i < Math.min(lines.length, 21); i++) {
            const lineText = lines[i];
            if (!lineText || !lineText.trim())
                continue;
            const parts = this.parseDelimitedLine(lineText, bestDelim);
            const rowObj = {
                ID: crypto_1.default.randomUUID(),
            };
            rawHeaders.forEach((h, idx) => {
                const val = parts[idx] ?? '';
                const cleanStr = String(val).replace(/,/g, '').trim();
                // Preserves leading zeroes for codes / IDs (e.g. '037', '01')
                const hasLeadingZero = cleanStr.length > 1 && /^0\d+$/.test(cleanStr);
                const isNumeric = !hasLeadingZero &&
                    cleanStr !== '' &&
                    !isNaN(Number(cleanStr)) &&
                    isFinite(Number(cleanStr)) &&
                    /^[-+]?\d+(\.\d+)?$/.test(cleanStr);
                rowObj[h] = isNumeric ? parseFloat(cleanStr) : val;
            });
            previewRows.push(rowObj);
        }
        // Infer types based on DDL SQL or content and column names (Financial / Transaction pattern)
        rawHeaders.forEach((h, hIdx) => {
            const upperName = h.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30);
            const sqlCol = sqlDdl?.columns.get(upperName);
            let inferredType = 'VARCHAR2(100)';
            let isNullable = true;
            if (sqlCol) {
                inferredType = sqlCol.type;
                isNullable = sqlCol.isNullable;
            }
            else {
                let isNumeric = true;
                let hasLeadingZero = false;
                let sampleVal = null;
                let hasValue = false;
                let matchesDate = false;
                for (const row of previewRows) {
                    const val = row[h];
                    if (val !== null && val !== undefined && val !== '') {
                        hasValue = true;
                        if (sampleVal === null)
                            sampleVal = val;
                        const sVal = String(val).trim();
                        if (sVal.length > 1 && /^0\d+$/.test(sVal)) {
                            hasLeadingZero = true;
                        }
                        if (this.parseFlexDate(sVal) !== null) {
                            matchesDate = true;
                        }
                        const clean = sVal.replace(/,/g, '');
                        if (isNaN(Number(clean)) || !isFinite(Number(clean)) || !/^[-+]?\d+(\.\d+)?$/.test(clean)) {
                            isNumeric = false;
                        }
                    }
                }
                if (!hasValue || hasLeadingZero)
                    isNumeric = false;
                if (upperName.startsWith('ID_') ||
                    upperName.startsWith('KODE_') ||
                    upperName.startsWith('SANDI_') ||
                    upperName.startsWith('NO_') ||
                    upperName.startsWith('NOREK') ||
                    upperName.includes('KODE') ||
                    upperName === 'CIF' ||
                    upperName === 'NPWP' ||
                    upperName === 'NIK' ||
                    hasLeadingZero) {
                    inferredType = 'VARCHAR2(50)';
                }
                else if (upperName.startsWith('TANGGAL_') ||
                    upperName.endsWith('_DATE') ||
                    upperName.endsWith('_TGL') ||
                    upperName.startsWith('TGL_') ||
                    upperName.includes('TANGGAL') ||
                    matchesDate) {
                    inferredType = matchesDate ? 'DATE' : 'VARCHAR2(50)';
                }
                else if (upperName === 'TAHUN') {
                    inferredType = 'NUMBER(4)';
                }
                else if (upperName === 'BULAN') {
                    inferredType = 'NUMBER(2)';
                }
                else if (isNumeric) {
                    if (upperName.includes('RATE') || upperName.includes('PERSEN') || upperName.includes('YIELD')) {
                        inferredType = 'NUMBER(12,6)';
                    }
                    else if (upperName.includes('NOMINAL') ||
                        upperName.includes('PROCEED') ||
                        upperName.includes('NILAI') ||
                        upperName.includes('TOTAL') ||
                        upperName.includes('SALDO')) {
                        inferredType = 'NUMBER(20,4)';
                    }
                    else if (upperName.includes('JANGKA_WAKTU') ||
                        upperName.includes('HARI') ||
                        upperName.includes('COUNT') ||
                        upperName.includes('JUMLAH')) {
                        inferredType = 'NUMBER(10)';
                    }
                    else {
                        inferredType = 'NUMBER(18,6)';
                    }
                }
                else if (upperName === 'STATUS_SETELMEN' ||
                    upperName === 'TIPE_TRANSAKSI' ||
                    upperName === 'SERI' ||
                    upperName === 'JENIS_USAHA') {
                    inferredType = 'VARCHAR2(50)';
                }
                else {
                    inferredType = 'VARCHAR2(255)';
                }
            }
            columns.push({
                name: upperName,
                type: inferredType,
                isNullable,
                sampleValue: previewRows[0]?.[h] ?? null,
                sourceType: 'field',
                sourceIndex: hIdx,
                sourceKey: h,
            });
        });
        // Metadata columns
        columns.push({
            name: 'FILE_NAME',
            type: 'VARCHAR2(150)',
            isNullable: true,
            sampleValue: path_1.default.basename(sampleFile),
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
        // Build sample tokens for delimited file
        const sampleTokens = rawHeaders.map((h, idx) => {
            const upperName = h.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30);
            const matchedCol = columns.find((c) => c.name === upperName);
            return {
                index: idx,
                label: `Kolom ${idx + 1} (${h})`,
                sampleValue: String(previewRows[0]?.[h] ?? ''),
                suggestedName: upperName,
                suggestedType: matchedCol?.type || 'VARCHAR2(255)',
                sourceType: 'field',
                sourceKey: h,
            };
        });
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
        // Determine suggested table name
        let suggestedTable = '';
        if (sqlDdl?.tableName) {
            suggestedTable = sqlDdl.tableName.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        }
        else if (filePaths.length === 1 || path_1.default.extname(sampleFile)) {
            let base = path_1.default
                .basename(sampleFile)
                .replace(/\.(csv|txt|tsv|reg|dat)$/i, '')
                .toUpperCase()
                .replace(/[^A-Z0-9_]/g, '_');
            base = base.replace(/_DATA_TABLE$/i, '').replace(/_DATA$/i, '').replace(/_TABLE$/i, '');
            suggestedTable = base;
        }
        else if (sourceDir) {
            suggestedTable = path_1.default
                .basename(sourceDir)
                .toUpperCase()
                .replace(/[^A-Z0-9_]/g, '_');
            if (!suggestedTable.startsWith('DATA_')) {
                suggestedTable = `DATA_${suggestedTable}`;
            }
        }
        suggestedTable = suggestedTable.slice(0, 30);
        if (!suggestedTable)
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
            // Handle metadata columns toggle
            if (!options.includeMetadata) {
                options.columns = options.columns.filter((c) => !c.isMetadata && c.name !== 'FILE_NAME' && c.name !== 'LOAD_TIMESTAMP');
            }
            // 2. Connect to Oracle
            conn = await this.oracleService.createConnection(config);
            // Configure session NLS date and timestamp formats to 24-hour clock to prevent ORA-01849
            try {
                await conn.execute(`ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'`);
                await conn.execute(`ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF'`);
                await conn.execute(`ALTER SESSION SET NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF TZR'`);
            }
            catch (nlsErr) {
                console.warn('Gagal mengatur session NLS date/timestamp format:', nlsErr);
            }
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
                        await conn.execute(`DROP TABLE ${fullTableName} CASCADE CONSTRAINTS PURGE`);
                        tableExists = false;
                    }
                    catch (e) {
                        await conn.execute(`DROP TABLE ${fullTableName} CASCADE CONSTRAINTS`);
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
                    const isGuid = c.name === 'ID' ||
                        c.sourceType === 'guid' ||
                        c.sourceKey === 'ID';
                    const defaultVal = isSysdate
                        ? ' DEFAULT SYSDATE'
                        : isGuid
                            ? ' DEFAULT SYS_GUID()'
                            : '';
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
            // 8. Stream & parse files in batches (Turbo Batch 20,000 rows)
            let totalInsertedRows = 0;
            const batchRows = [];
            const batchSize = options.batchSize || 20000;
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
                // Execute batch insert if chunk reached & commit to keep memory & undo log optimal
                if (batchRows.length >= batchSize) {
                    await conn.executeMany(insertSql, batchRows, { autoCommit: false });
                    totalInsertedRows += batchRows.length;
                    batchRows.length = 0;
                    await conn.commit();
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
                const numFields = parts[2] ? parseInt(parts[2], 10) : fields.length;
                const activeFieldCount = numFields > 0 ? numFields : fields.length;
                const fieldValues = parts.slice(3, 3 + activeFieldCount);
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
                for (let idx = 0; idx < activeFieldCount; idx++) {
                    const colName = (fields[idx] || `FIELD_${idx + 1}`).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                    const raw = fieldValues[idx]?.trim();
                    if (raw !== undefined && raw !== '') {
                        const num = parseFloat(raw);
                        rowMap[colName] = !isNaN(num) && isFinite(Number(raw)) ? num : raw;
                    }
                    else {
                        rowMap[colName] = null;
                    }
                    rowMap[`FIELD_${idx + 1}`] = rowMap[colName];
                    rowMap[`TOKEN_${3 + idx}`] = rowMap[colName];
                }
                // Map into targetColumns array order
                const rowArray = targetColumns.map((col) => {
                    if (col.sourceType === 'guid' || col.name === 'ID') {
                        return crypto_1.default.randomUUID();
                    }
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
                    // Convert Date/Timestamp if column type is DATE or TIMESTAMP
                    const upperType = col.type ? col.type.toUpperCase() : '';
                    if (upperType.startsWith('DATE') || upperType.startsWith('TIMESTAMP')) {
                        return this.parseFlexDate(val);
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
            const parts = this.parseDelimitedLine(headerLine, d);
            if (parts.length > maxCols) {
                maxCols = parts.length;
                bestDelim = d;
            }
        }
        const rawHeaders = this.parseDelimitedLine(headerLine, bestDelim).map((h) => h.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
        for (let i = 1; i < lines.length; i++) {
            const lineText = lines[i];
            if (!lineText || !lineText.trim())
                continue;
            const parts = this.parseDelimitedLine(lineText, bestDelim);
            const rowMap = {
                FILE_NAME: fileName,
            };
            rawHeaders.forEach((h, idx) => {
                const val = parts[idx] ?? '';
                rowMap[h] = val;
            });
            const rowArray = targetColumns.map((col) => {
                if (col.sourceType === 'guid' || col.name === 'ID') {
                    return crypto_1.default.randomUUID();
                }
                if (col.name === 'LOAD_TIMESTAMP' || col.sourceKey === 'LOAD_TIMESTAMP') {
                    return new Date();
                }
                if (col.name === 'FILE_NAME' || col.sourceKey === 'FILE_NAME') {
                    return fileName;
                }
                let val = rowMap[col.name];
                if (val === undefined && col.sourceKey) {
                    val = rowMap[col.sourceKey];
                }
                if (val === undefined && col.sourceIndex !== undefined) {
                    val = parts[col.sourceIndex];
                }
                if (val === undefined || val === null || val === '')
                    return null;
                // Convert numeric if column type is NUMBER
                if (col.type && col.type.toUpperCase().startsWith('NUMBER')) {
                    const cleanStr = String(val).replace(/,/g, '').trim();
                    if (cleanStr === '' || cleanStr === 'null' || cleanStr === '-')
                        return null;
                    const num = parseFloat(cleanStr);
                    return !isNaN(num) && isFinite(Number(cleanStr)) ? num : null;
                }
                // Convert Date/Timestamp if column type is DATE or TIMESTAMP
                const upperType = col.type ? col.type.toUpperCase() : '';
                if (upperType.startsWith('DATE') || upperType.startsWith('TIMESTAMP')) {
                    return this.parseFlexDate(val);
                }
                return String(val);
            });
            outBatch.push(rowArray);
        }
    }
}
exports.TxtBundleService = TxtBundleService;
