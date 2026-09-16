"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqlTableGeneratorService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readline_1 = __importDefault(require("readline"));
class SqlTableGeneratorService {
    oracleService;
    constructor(oracleService) {
        this.oracleService = oracleService;
    }
    /**
     * Parse .sql file to extract all Functions, Stored Procedures, and their inner SELECT queries
     */
    async parseSqlFile(filePath) {
        const resolvedPath = path_1.default.resolve(filePath);
        if (!fs_1.default.existsSync(resolvedPath)) {
            throw new Error(`File SQL tidak ditemukan: ${resolvedPath}`);
        }
        const stat = fs_1.default.statSync(resolvedPath);
        const fileName = path_1.default.basename(resolvedPath);
        const fileStream = fs_1.default.createReadStream(resolvedPath, { encoding: 'utf8' });
        const rl = readline_1.default.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        const functions = [];
        let currentFunction = null;
        let currentFunctionLines = [];
        let currentSelectLines = [];
        let capturingSelect = false;
        let currentSelectStartLine = 0;
        let currentSelectLabel = '';
        let lineIdx = 0;
        let selectCounter = 0;
        const fnHeaderRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(FUNCTION|PROCEDURE|PACKAGE\s+BODY|PACKAGE)\s+(?:["']?[A-Za-z0-9_$]+["']?\.)?["']?([A-Za-z0-9_$]+)["']?/i;
        const subprogramRegex = /^\s*(PROCEDURE|FUNCTION)\s+["']?([A-Za-z0-9_$]+)["']?\s*(?:\(|$)/i;
        const finalizeSelect = () => {
            if (currentFunction && currentSelectLines.length > 0) {
                const fullSelect = currentSelectLines.join('\n').trim();
                if (fullSelect.length > 10) {
                    const cols = this.extractColumnsFromSelect(fullSelect);
                    selectCounter++;
                    currentFunction.selectQueries.push({
                        queryIndex: selectCounter,
                        label: currentSelectLabel || `Query #${selectCounter}`,
                        queryText: fullSelect,
                        startLine: currentSelectStartLine,
                        columns: cols,
                        fromClauseSummary: this.extractFromSummary(fullSelect),
                    });
                }
            }
            currentSelectLines = [];
            capturingSelect = false;
            currentSelectLabel = '';
        };
        for await (const line of rl) {
            lineIdx++;
            const trimmed = line.trim();
            // Check for new FUNCTION / PROCEDURE / PACKAGE declaration
            let matchType = null;
            let matchName = null;
            const fnMatch = line.match(fnHeaderRegex);
            if (fnMatch) {
                matchType = fnMatch[1].toUpperCase().replace(/\s+/g, '_');
                matchName = fnMatch[2];
            }
            else {
                const subMatch = line.match(subprogramRegex);
                if (subMatch &&
                    (trimmed.startsWith('PROCEDURE') ||
                        trimmed.startsWith('FUNCTION') ||
                        trimmed.startsWith('procedure') ||
                        trimmed.startsWith('function'))) {
                    matchType = subMatch[1].toUpperCase();
                    matchName = subMatch[2];
                }
            }
            if (matchType && matchName) {
                // Finalize previous select query if open
                finalizeSelect();
                // Finalize previous function
                if (currentFunction) {
                    currentFunction.endLine = lineIdx - 1;
                    currentFunction.rawBody = currentFunctionLines.join('\n').trim();
                    functions.push(currentFunction);
                }
                currentFunctionLines = [];
                const type = matchType === 'PROCEDURE'
                    ? 'PROCEDURE'
                    : matchType === 'PACKAGE_BODY' || matchType === 'PACKAGE'
                        ? 'PACKAGE_BODY'
                        : 'FUNCTION';
                currentFunction = {
                    id: `func_${lineIdx}_${matchName}`,
                    name: matchName,
                    type,
                    startLine: lineIdx,
                    endLine: lineIdx,
                    parameters: this.extractParametersFromHeader(line),
                    selectQueries: [],
                    sourceFile: fileName,
                };
                selectCounter = 0;
                currentFunctionLines.push(line);
                continue;
            }
            // If we are inside a function/procedure, watch for SELECT queries & keep lines
            if (currentFunction) {
                currentFunctionLines.push(line);
                // Detect Cursor start: CURSOR name IS SELECT
                const cursorMatch = line.match(/CURSOR\s+([A-Za-z0-9_$]+)(?:\s*\([^)]*\))?\s+IS\s*(SELECT.*)?/i);
                if (cursorMatch) {
                    finalizeSelect();
                    capturingSelect = true;
                    currentSelectStartLine = lineIdx;
                    currentSelectLabel = `Cursor: ${cursorMatch[1]}`;
                    if (cursorMatch[2]) {
                        currentSelectLines.push(cursorMatch[2]);
                    }
                    continue;
                }
                // Detect FOR r IN (SELECT ...
                const forInMatch = line.match(/FOR\s+[A-Za-z0-9_$]+\s+IN\s*\(\s*(SELECT.*)?/i);
                if (forInMatch) {
                    finalizeSelect();
                    capturingSelect = true;
                    currentSelectStartLine = lineIdx;
                    currentSelectLabel = `Loop Query`;
                    if (forInMatch[1]) {
                        currentSelectLines.push(forInMatch[1]);
                    }
                    continue;
                }
                // Detect Standalone SELECT (e.g. SELECT ... INTO or SELECT ... FROM)
                const selectMatch = line.match(/^\s*(SELECT\s+.*)/i);
                if (selectMatch && !capturingSelect) {
                    capturingSelect = true;
                    currentSelectStartLine = lineIdx;
                    currentSelectLabel = `Select Query`;
                    currentSelectLines.push(selectMatch[1]);
                    continue;
                }
                if (capturingSelect) {
                    // Check if select statement finishes
                    // Common terminations in PL/SQL:
                    // 1) Semicolon ';' at end of query
                    // 2) ') LOOP' or ') TB' or 'LOOP' or 'END;'
                    if (trimmed.includes(';') ||
                        trimmed.endsWith(')') ||
                        trimmed.toUpperCase().includes(') LOOP') ||
                        trimmed.toUpperCase().startsWith('LOOP')) {
                        currentSelectLines.push(line);
                        finalizeSelect();
                    }
                    else {
                        currentSelectLines.push(line);
                    }
                }
            }
        }
        // Finalize last query & function
        finalizeSelect();
        if (currentFunction) {
            currentFunction.endLine = lineIdx;
            currentFunction.rawBody = currentFunctionLines.join('\n').trim();
            functions.push(currentFunction);
        }
        const totalFunctions = functions.filter((f) => f.type === 'FUNCTION').length;
        const totalProcedures = functions.filter((f) => f.type === 'PROCEDURE').length;
        return {
            success: true,
            filePath: resolvedPath,
            fileName,
            fileSizeBytes: stat.size,
            totalLines: lineIdx,
            functions,
            totalFunctions,
            totalProcedures,
        };
    }
    /**
     * Extracts projected columns from a SQL SELECT query text
     */
    extractColumnsFromSelect(selectSql) {
        const columns = [];
        if (!selectSql)
            return columns;
        // Isolate SELECT to FROM clause
        // Need to handle top-level SELECT and find its corresponding top-level FROM
        let cleanSql = selectSql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        cleanSql = cleanSql.replace(/^\s*SELECT\s+(?:DISTINCT\s+|ALL\s+)?/i, '').trim();
        // Find the matching top-level FROM by tracking parenthesis and CASE depth
        let parenDepth = 0;
        let caseDepth = 0;
        let fromIndex = -1;
        for (let i = 0; i < cleanSql.length; i++) {
            const char = cleanSql[i];
            if (char === '(')
                parenDepth++;
            else if (char === ')')
                parenDepth--;
            else if (parenDepth === 0) {
                const remaining = cleanSql.slice(i);
                if (/^CASE\b/i.test(remaining) && (i === 0 || /\s/.test(cleanSql[i - 1]))) {
                    caseDepth++;
                }
                else if (/^END\b/i.test(remaining) && (i === 0 || /\s/.test(cleanSql[i - 1]))) {
                    caseDepth = Math.max(0, caseDepth - 1);
                }
                else if (caseDepth === 0) {
                    if (/^FROM\b/i.test(remaining) && (i === 0 || /\s/.test(cleanSql[i - 1]))) {
                        fromIndex = i;
                        break;
                    }
                }
            }
        }
        const projectionPart = fromIndex !== -1 ? cleanSql.slice(0, fromIndex).trim() : cleanSql;
        // Split items by comma at depth 0 (both parenDepth and caseDepth === 0)
        const rawItems = [];
        let currentItem = '';
        parenDepth = 0;
        caseDepth = 0;
        for (let i = 0; i < projectionPart.length; i++) {
            const char = projectionPart[i];
            if (char === '(')
                parenDepth++;
            else if (char === ')')
                parenDepth--;
            else if (parenDepth === 0) {
                const remaining = projectionPart.slice(i);
                if (/^CASE\b/i.test(remaining) && (i === 0 || /\s/.test(projectionPart[i - 1]))) {
                    caseDepth++;
                }
                else if (/^END\b/i.test(remaining) && (i === 0 || /\s/.test(projectionPart[i - 1]))) {
                    caseDepth = Math.max(0, caseDepth - 1);
                }
            }
            if (char === ',' && parenDepth === 0 && caseDepth === 0) {
                if (currentItem.trim()) {
                    rawItems.push(currentItem.trim());
                }
                currentItem = '';
            }
            else {
                currentItem += char;
            }
        }
        if (currentItem.trim()) {
            rawItems.push(currentItem.trim());
        }
        const seenNames = new Set();
        rawItems.forEach((raw, idx) => {
            const item = raw.trim();
            if (!item)
                return;
            // Extract alias
            // Patterns:
            // expr AS alias
            // expr alias (if alias doesn't have parens and is a simple identifier)
            let alias = '';
            let expression = item;
            const asMatch = item.match(/^(.*?)\s+AS\s+["']?([A-Za-z0-9_$]+)["']?$/i);
            if (asMatch) {
                expression = asMatch[1].trim();
                alias = asMatch[2].trim();
            }
            else {
                // Check for space separated alias at depth 0
                const tokens = item.split(/\s+/);
                if (tokens.length >= 2) {
                    const last = tokens[tokens.length - 1];
                    if (/^[A-Za-z0-9_$]+$/.test(last) && !['END', 'THEN', 'ELSE', 'WHEN', 'NULL'].includes(last.toUpperCase())) {
                        alias = last;
                        expression = tokens.slice(0, -1).join(' ').trim();
                    }
                }
            }
            // If no alias, use column name from expression (e.g. A.SANDIBANK -> SANDIBANK)
            if (!alias) {
                const dotParts = expression.split('.');
                const lastPart = dotParts[dotParts.length - 1].trim();
                const simpleName = lastPart.replace(/[^A-Za-z0-9_$]/g, '');
                alias = simpleName || `COL_${idx + 1}`;
            }
            // Clean alias
            alias = alias.replace(/^["']|["']$/g, '').trim().toUpperCase();
            if (!alias)
                alias = `COL_${idx + 1}`;
            // Deduplicate column name
            let finalName = alias;
            let counter = 2;
            while (seenNames.has(finalName)) {
                finalName = `${alias}_${counter}`;
                counter++;
            }
            seenNames.add(finalName);
            const inferredType = this.inferOracleDataType(expression, finalName);
            columns.push({
                id: `col_${idx + 1}_${finalName}`,
                name: finalName,
                originalExpression: expression,
                alias: finalName,
                inferredType,
                isNullable: true,
                isPrimaryKey: idx === 0 && (finalName.includes('ID') || finalName.includes('NOMOR')),
                included: true,
            });
        });
        return columns;
    }
    /**
     * Smartly infers the appropriate Oracle database data type based on expression & column name
     */
    inferOracleDataType(expression, columnName) {
        const exprUpper = expression.toUpperCase();
        const nameUpper = columnName.toUpperCase();
        // 1. DATE / TIMESTAMP inference
        if (exprUpper.includes('TO_DATE') ||
            exprUpper.includes('SYSDATE') ||
            exprUpper.includes('LAST_DAY') ||
            exprUpper.includes('ADD_MONTHS') ||
            (exprUpper.includes('TRUNC(') && (exprUpper.includes('DATE') || exprUpper.includes('SYSDATE'))) ||
            nameUpper.startsWith('TGL_') ||
            nameUpper.startsWith('TANGGAL') ||
            nameUpper.endsWith('_DATE') ||
            nameUpper === 'POSISI' ||
            nameUpper === 'PERIODE' ||
            nameUpper === 'CREATED_AT' ||
            nameUpper === 'UPDATED_AT') {
            return 'DATE';
        }
        if (exprUpper.includes('TIMESTAMP') || nameUpper.includes('TIMESTAMP')) {
            return 'TIMESTAMP(6)';
        }
        // 2. Financial ratios and decimals with high precision
        if (nameUpper === 'CAR' ||
            nameUpper === 'ROA' ||
            nameUpper === 'ROE' ||
            nameUpper === 'NIM' ||
            nameUpper.includes('NPL') ||
            nameUpper === 'BOPO' ||
            nameUpper === 'LDR' ||
            nameUpper.includes('RATIO') ||
            nameUpper.includes('RASIO') ||
            nameUpper.includes('PERCENT') ||
            nameUpper.includes('PCT') ||
            nameUpper.includes('KURS') ||
            nameUpper.includes('YOY') ||
            nameUpper.includes('YTD') ||
            nameUpper.includes('PREMIRISIKO')) {
            return 'NUMBER(18,6)';
        }
        // 3. Monetary values / Currency / Totals / Balances
        if (nameUpper.includes('NILAI') ||
            nameUpper.includes('_RP') ||
            nameUpper.includes('_VALAS') ||
            nameUpper.includes('_USD') ||
            nameUpper.includes('TOTAL') ||
            nameUpper.includes('SALDO') ||
            nameUpper.includes('NOMINAL') ||
            nameUpper.includes('DEBET') ||
            nameUpper.includes('KREDIT') ||
            nameUpper.includes('JUMLAH') ||
            nameUpper.includes('SURPLUS') ||
            nameUpper.includes('DEFISIT') ||
            nameUpper.includes('ARUS_KAS') ||
            nameUpper.includes('OUTSTANDING') ||
            exprUpper.includes('SUM(') ||
            exprUpper.includes('AVG(')) {
            return 'NUMBER(18,2)';
        }
        // 4. Counts, integers, small identifiers
        if (exprUpper.includes('COUNT(') ||
            nameUpper.startsWith('JML_') ||
            nameUpper.startsWith('TOTAL_ROW') ||
            nameUpper === 'NOMOR' ||
            nameUpper === 'URUT' ||
            nameUpper === 'BULAN' ||
            nameUpper === 'TAHUN' ||
            (nameUpper === 'MINGGU' && exprUpper.includes('NUMBER'))) {
            return 'NUMBER(10)';
        }
        // 5. Generic NVL with numeric 0
        if (exprUpper.match(/NVL\s*\([^,]+,\s*0\)/i) || exprUpper.match(/COALESCE\s*\([^,]+,\s*0\)/i)) {
            return 'NUMBER(18,4)';
        }
        // 6. Text / String literals & Identifiers
        if (nameUpper === 'ID' ||
            nameUpper.startsWith('ID_') ||
            nameUpper.endsWith('_ID') ||
            nameUpper.includes('IDBANK') ||
            nameUpper.includes('SANDI') ||
            nameUpper.includes('KODE') ||
            nameUpper.includes('NPWP')) {
            return 'VARCHAR2(100)';
        }
        if (nameUpper.includes('NAMA') ||
            nameUpper.includes('SEBUTAN') ||
            nameUpper.includes('PROFILE') ||
            nameUpper.includes('DESKRIPSI') ||
            nameUpper.includes('KETERANGAN') ||
            nameUpper.includes('ALAMAT') ||
            nameUpper.includes('JUDUL') ||
            nameUpper.includes('NOTE')) {
            return 'VARCHAR2(500)';
        }
        if (nameUpper.startsWith('IS_') ||
            nameUpper.startsWith('FLAG_') ||
            nameUpper === 'STATUS' ||
            nameUpper === 'STATUS_AKTIF' ||
            nameUpper === 'ISACTIVE') {
            return 'VARCHAR2(10)';
        }
        // Fallback default
        return 'VARCHAR2(100)';
    }
    /**
     * Generates pure DDL SQL string for CREATE TABLE
     */
    generateCreateTableDdl(options) {
        const { schema, tableName, columns, tableComment } = options;
        const activeCols = columns.filter((c) => c.included);
        if (activeCols.length === 0) {
            throw new Error('Paling tidak harus ada 1 kolom yang disertakan untuk membuat tabel.');
        }
        const cleanTable = tableName.trim().toUpperCase();
        const tableIdentifier = schema ? `"${schema.trim().toUpperCase()}"."${cleanTable}"` : `"${cleanTable}"`;
        const colDefs = activeCols.map((c) => {
            const colName = `"${c.name.trim().toUpperCase()}"`;
            const type = c.inferredType.trim().toUpperCase();
            const nullability = c.isNullable === false ? ' NOT NULL' : '';
            const def = c.defaultValue ? ` DEFAULT ${c.defaultValue}` : '';
            return `  ${colName.padEnd(30)} ${type}${def}${nullability}`;
        });
        // Primary key clause
        const pkCols = activeCols.filter((c) => c.isPrimaryKey);
        if (pkCols.length > 0) {
            const pkNames = pkCols.map((c) => `"${c.name.trim().toUpperCase()}"`).join(', ');
            const pkConstraintName = `"PK_${cleanTable.slice(0, 24)}"`;
            colDefs.push(`  CONSTRAINT ${pkConstraintName} PRIMARY KEY (${pkNames})`);
        }
        const ddlLines = [];
        ddlLines.push(`CREATE TABLE ${tableIdentifier} (`);
        ddlLines.push(colDefs.join(',\n'));
        ddlLines.push(`);`);
        if (tableComment) {
            ddlLines.push(`COMMENT ON TABLE ${tableIdentifier} IS '${tableComment.replace(/'/g, "''")}';`);
        }
        return ddlLines.join('\n');
    }
    /**
     * Generates INSERT INTO ... SELECT template
     */
    generateInsertSelectTemplate(tableName, functionName, columns, parameters) {
        const activeCols = columns.filter((c) => c.included);
        const colList = activeCols.map((c) => `"${c.name.trim().toUpperCase()}"`).join(', ');
        const paramPlaceholders = parameters.length > 0 ? parameters.map((_, i) => `:p${i + 1}`).join(', ') : '';
        return `-- Template Pengisian Tabel dari Oracle Table Function
INSERT INTO "${tableName.trim().toUpperCase()}" (
  ${colList}
)
SELECT
  ${colList}
FROM TABLE("${functionName.trim().toUpperCase()}"(${paramPlaceholders}));

COMMIT;`;
    }
    /**
     * Execute CREATE TABLE directly on the target Oracle database
     */
    async executeCreateTable(config, options) {
        const startTime = Date.now();
        const cleanTable = options.tableName.trim().toUpperCase();
        const schema = options.schema || config.schema || config.user || '';
        const ddl = this.generateCreateTableDdl({
            schema,
            tableName: cleanTable,
            columns: options.columns,
            tableComment: options.tableComment,
        });
        let conn = null;
        try {
            conn = await this.oracleService.createConnection(config);
            const tableIdentifier = schema ? `"${schema.toUpperCase()}"."${cleanTable}"` : `"${cleanTable}"`;
            if (options.createStrategy === 'drop_and_recreate') {
                try {
                    await conn.execute(`DROP TABLE ${tableIdentifier} CASCADE CONSTRAINTS`);
                }
                catch (dropErr) {
                    // Ignore ORA-00942 (table or view does not exist)
                    if (!dropErr.message?.includes('ORA-00942')) {
                        console.warn(`Peringatan drop table: ${dropErr.message}`);
                    }
                }
            }
            // Execute create table DDL
            // Remove trailing semicolon if present as Oracle execute doesn't expect it in single DDL
            const cleanDdl = ddl.trim().replace(/;+$/, '');
            await conn.execute(cleanDdl);
            if (options.tableComment) {
                try {
                    await conn.execute(`COMMENT ON TABLE ${tableIdentifier} IS '${options.tableComment.replace(/'/g, "''")}'`);
                }
                catch (commentErr) {
                    console.warn('Gagal menambahkan comment table:', commentErr.message);
                }
            }
            const elapsed = Date.now() - startTime;
            return {
                success: true,
                ddl,
                tableName: cleanTable,
                schema,
                message: `Tabel ${tableIdentifier} berhasil dibuat di database Oracle dalam ${elapsed} ms!`,
                executionTimeMs: elapsed,
            };
        }
        catch (err) {
            const elapsed = Date.now() - startTime;
            return {
                success: false,
                ddl,
                tableName: cleanTable,
                schema,
                error: err.message || 'Gagal mengeksekusi DDL CREATE TABLE ke database Oracle',
                executionTimeMs: elapsed,
            };
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch (closeErr) { }
            }
        }
    }
    // --- Helper methods ---
    extractParametersFromHeader(line) {
        const paramMatch = line.match(/\((.*?)\)/);
        if (!paramMatch)
            return [];
        return paramMatch[1]
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);
    }
    extractFromSummary(selectSql) {
        const match = selectSql.match(/FROM\s+([A-Za-z0-9_$."]+(?:\s+[A-Za-z0-9_$]+)?)/i);
        return match ? match[1].trim() : '-';
    }
}
exports.SqlTableGeneratorService = SqlTableGeneratorService;
