"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryBeautyService = exports.QueryBeautyService = void 0;
exports.beautifyOracleQuery = beautifyOracleQuery;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const XLSX = __importStar(require("xlsx"));
/**
 * Intelligent Oracle SQL & PL/SQL Query Beautifier
 * Handles SELECT, INSERT, UPDATE, MERGE, subqueries, and CURSOR ... IS declarations.
 */
function beautifyOracleQuery(rawSql) {
    if (!rawSql || typeof rawSql !== 'string')
        return '';
    const text = rawSql.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!text)
        return '';
    // If text contains multiple "Cursor <name> is", split and beautify each cursor block
    const cursorSplitRegex = /(?=Cursor\s+[a-zA-Z0-9_]+\s+is)/i;
    const parts = text.split(cursorSplitRegex);
    if (parts.length > 1) {
        return parts
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
            .map((p) => beautifySingleStatementOrCursor(p))
            .join('\n\n');
    }
    return beautifySingleStatementOrCursor(text);
}
function beautifySingleStatementOrCursor(block) {
    const clean = block.trim();
    if (!clean)
        return '';
    // Check if block starts with CURSOR <name> IS
    const cursorMatch = clean.match(/^cursor\s+([a-zA-Z0-9_]+)\s+is\s*([\s\S]*)$/i);
    if (cursorMatch) {
        const cursorName = cursorMatch[1];
        const body = cursorMatch[2].trim();
        const beautifiedBody = beautifySqlClauses(body, '  ');
        return `CURSOR ${cursorName} IS\n${beautifiedBody}`;
    }
    return beautifySqlClauses(clean, '');
}
function beautifySqlClauses(sqlText, baseIndent = '') {
    if (!sqlText || !sqlText.trim())
        return '';
    // Standard Oracle SQL Keywords
    const KEYWORDS = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING',
        'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'MERGE INTO', 'USING',
        'WHEN MATCHED THEN', 'WHEN NOT MATCHED THEN', 'LEFT JOIN', 'RIGHT JOIN',
        'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'JOIN', 'ON', 'UNION ALL', 'UNION',
        'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IN', 'NOT IN', 'IS NULL',
        'IS NOT NULL', 'BETWEEN', 'EXISTS', 'NOT EXISTS', 'LIKE', 'DISTINCT',
        'SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'NVL', 'DECODE', 'TO_DATE', 'TO_CHAR',
        'TO_NUMBER', 'SYSDATE', 'DUAL', 'ROWNUM', 'OVER', 'PARTITION BY'
    ];
    let normalized = sqlText;
    KEYWORDS.forEach((kw) => {
        const reg = new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'gi');
        normalized = normalized.replace(reg, kw);
    });
    // Pre-process lines
    const rawLines = normalized.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    // Merge lone FROM with table name on next line if next line is not a keyword
    const mergedLines = [];
    for (let i = 0; i < rawLines.length; i++) {
        const l = rawLines[i];
        if (l.toUpperCase() === 'FROM' &&
            i + 1 < rawLines.length &&
            !/^(WHERE|SELECT|FROM|GROUP|ORDER|HAVING|AND|OR)\b/i.test(rawLines[i + 1])) {
            mergedLines.push(`FROM ${rawLines[i + 1]}`);
            i++;
        }
        else {
            mergedLines.push(l);
        }
    }
    const formattedLines = [];
    let currentIndentLevel = 0;
    for (let i = 0; i < mergedLines.length; i++) {
        const line = mergedLines[i];
        if (!line)
            continue;
        // Handle parenthesis closing at start of line
        if (line.startsWith(')')) {
            currentIndentLevel = Math.max(0, currentIndentLevel - 1);
        }
        const curIndent = baseIndent + '  '.repeat(currentIndentLevel);
        const subIndent = curIndent + '  ';
        if (/^SELECT\b/i.test(line)) {
            const remainder = line.replace(/^SELECT\b/i, '').trim();
            formattedLines.push(`${curIndent}SELECT`);
            if (remainder) {
                formattedLines.push(`${subIndent}${remainder}`);
            }
        }
        else if (/^FROM\b/i.test(line)) {
            const remainder = line.replace(/^FROM\b/i, '').trim();
            formattedLines.push(`${curIndent}FROM ${remainder}`);
        }
        else if (/^WHERE\b/i.test(line)) {
            const remainder = line.replace(/^WHERE\b/i, '').trim();
            if (remainder) {
                formattedLines.push(`${curIndent}WHERE ${remainder}`);
            }
            else {
                formattedLines.push(`${curIndent}WHERE`);
            }
        }
        else if (/^(GROUP BY|ORDER BY|HAVING)\b/i.test(line)) {
            formattedLines.push(`${curIndent}${line}`);
        }
        else if (/^(AND|OR)\b/i.test(line)) {
            // Check if line contains subquery starter e.g. AND ID_BANK IN (SELECT
            if (/IN\s*\(\s*SELECT\b/i.test(line)) {
                const inMatch = line.match(/^(AND|OR)\s+(.*?)\s+IN\s*\(\s*SELECT\s*(.*)$/i);
                if (inMatch) {
                    const conj = inMatch[1];
                    const col = inMatch[2];
                    const selRem = inMatch[3];
                    formattedLines.push(`${subIndent}${conj} ${col} IN (`);
                    currentIndentLevel++;
                    const innerIndent = baseIndent + '  '.repeat(currentIndentLevel);
                    formattedLines.push(`${innerIndent}SELECT`);
                    if (selRem) {
                        formattedLines.push(`${innerIndent}  ${selRem}`);
                    }
                }
                else {
                    formattedLines.push(`${subIndent}${line}`);
                }
            }
            else {
                formattedLines.push(`${subIndent}${line}`);
            }
        }
        else if (/^(LEFT|RIGHT|INNER|FULL|CROSS)?\s*JOIN\b/i.test(line)) {
            formattedLines.push(`${curIndent}${line}`);
        }
        else {
            // Expression / columns / parameters
            formattedLines.push(`${subIndent}${line}`);
        }
        // Adjust indent if line ends with '('
        if (line.endsWith('(') && !line.startsWith(')')) {
            currentIndentLevel++;
        }
        // Check if line closed with ')' at the end
        const openCount = (line.match(/\(/g) || []).length;
        const closeCount = (line.match(/\)/g) || []).length;
        if (closeCount > openCount && !line.startsWith(')')) {
            currentIndentLevel = Math.max(0, currentIndentLevel - (closeCount - openCount));
        }
    }
    return formattedLines.join('\n');
}
class QueryBeautyService {
    /**
     * Reads an Excel / CSV / TXT file and inspects the specified column containing queries
     */
    readColumnQueries(filePath, sheetName, columnName) {
        try {
            const resolvedPath = path_1.default.resolve(filePath);
            if (!fs_1.default.existsSync(resolvedPath)) {
                throw new Error(`File tidak ditemukan: ${resolvedPath}`);
            }
            const fileName = path_1.default.basename(resolvedPath);
            const isExcel = /\.(xlsx|xls)$/i.test(fileName);
            let headers = [];
            let rawData = [];
            let availableSheets = [];
            let activeSheet = sheetName || '';
            if (isExcel) {
                const wb = XLSX.readFile(resolvedPath, { dense: false, cellDates: false });
                availableSheets = wb.SheetNames || [];
                if (availableSheets.length === 0) {
                    throw new Error('File Excel tidak memiliki worksheet.');
                }
                activeSheet = activeSheet && availableSheets.includes(activeSheet) ? activeSheet : availableSheets[0];
                const ws = wb.Sheets[activeSheet];
                if (!ws) {
                    throw new Error(`Worksheet "${activeSheet}" tidak ditemukan.`);
                }
                rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
            }
            else {
                // Delimited or CSV
                const content = fs_1.default.readFileSync(resolvedPath, 'utf8');
                const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
                const sep = lines[0]?.includes('\t') ? '\t' : lines[0]?.includes(';') ? ';' : ',';
                rawData = lines.map((l) => l.split(sep).map((p) => p.trim().replace(/^["']|["']$/g, '')));
                availableSheets = ['Default'];
                activeSheet = 'Default';
            }
            if (rawData.length === 0) {
                throw new Error('File kosong (tidak ada baris data).');
            }
            // First non-empty row as header
            let headerIdx = 0;
            while (headerIdx < rawData.length && (!rawData[headerIdx] || rawData[headerIdx].length === 0)) {
                headerIdx++;
            }
            headers = (rawData[headerIdx] || []).map((h, idx) => {
                const s = String(h ?? '').trim();
                return s || `KOLOM_${idx + 1}`;
            });
            // Find target column
            let targetColIdx = -1;
            if (columnName) {
                targetColIdx = headers.findIndex((h) => h.toUpperCase() === columnName.toUpperCase() || h.toUpperCase().includes(columnName.toUpperCase()));
            }
            // If not specified or not found, auto-detect column containing SQL keywords in header
            if (targetColIdx === -1) {
                targetColIdx = headers.findIndex((h) => /SELECT|QUERY|STATEMENT|SQL|RUMUS|FORMULA/i.test(h));
            }
            // If still not found, search in first few rows for SELECT / FROM / CURSOR
            if (targetColIdx === -1) {
                for (let col = 0; col < headers.length; col++) {
                    const sampleValues = rawData.slice(headerIdx + 1, headerIdx + 15).map((r) => String(r[col] || ''));
                    if (sampleValues.some((v) => /SELECT\b|FROM\b|CURSOR\b/i.test(v))) {
                        targetColIdx = col;
                        break;
                    }
                }
            }
            // Fallback to column M (idx 12) or first column
            if (targetColIdx === -1) {
                targetColIdx = headers.length > 12 ? 12 : 0;
            }
            const activeColumnName = headers[targetColIdx] || `KOLOM_${targetColIdx + 1}`;
            const dataRows = rawData.slice(headerIdx + 1);
            const queryRows = [];
            for (let rIdx = 0; rIdx < dataRows.length; rIdx++) {
                const row = dataRows[rIdx];
                if (!row)
                    continue;
                const rawVal = String(row[targetColIdx] ?? '').trim();
                if (rawVal.length > 0) {
                    const beautified = beautifyOracleQuery(rawVal);
                    // Extract preview label (e.g. ID_KOMPONEN, NAMA_KOMPONEN, or first column)
                    const firstColVal = String(row[0] || '').trim();
                    const secondColVal = String(row[1] || '').trim();
                    const label = firstColVal && secondColVal ? `${firstColVal} - ${secondColVal}` : firstColVal || `Baris ${rIdx + 1}`;
                    queryRows.push({
                        rowIdx: rIdx + 1,
                        rawSql: rawVal,
                        beautifiedSql: beautified,
                        previewLabel: label,
                        otherValues: headers.reduce((acc, h, i) => {
                            if (i !== targetColIdx && i < 6) {
                                acc[h] = row[i];
                            }
                            return acc;
                        }, {}),
                    });
                }
            }
            return {
                filePath: resolvedPath,
                fileName,
                sheetName: activeSheet,
                availableSheets,
                headers,
                selectedColumn: activeColumnName,
                totalRows: dataRows.length,
                rowsWithQuery: queryRows.length,
                queryRows,
            };
        }
        catch (err) {
            return {
                filePath,
                fileName: path_1.default.basename(filePath),
                sheetName: sheetName || '',
                availableSheets: [],
                headers: [],
                selectedColumn: columnName || '',
                totalRows: 0,
                rowsWithQuery: 0,
                queryRows: [],
                error: err.message || String(err),
            };
        }
    }
    /**
     * Save beautified queries back to an updated Excel file
     * Updates cells in-place to preserve styles, sheet configurations, and other columns!
     */
    saveBeautifiedExcel(sourcePath, targetPath, sheetName, columnName, beautifiedMap) {
        try {
            const resolvedSource = path_1.default.resolve(sourcePath);
            const resolvedTarget = path_1.default.resolve(targetPath);
            if (!fs_1.default.existsSync(resolvedSource)) {
                throw new Error(`File sumber tidak ditemukan: ${resolvedSource}`);
            }
            const wb = XLSX.readFile(resolvedSource, { cellStyles: true });
            const activeSheet = sheetName || wb.SheetNames[0];
            const ws = wb.Sheets[activeSheet];
            if (!ws) {
                throw new Error(`Worksheet "${activeSheet}" tidak ditemukan.`);
            }
            const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
            if (rawData.length === 0) {
                throw new Error('Worksheet kosong.');
            }
            // Find header row and column
            let headerIdx = 0;
            while (headerIdx < rawData.length && (!rawData[headerIdx] || rawData[headerIdx].length === 0)) {
                headerIdx++;
            }
            const headers = (rawData[headerIdx] || []).map((h) => String(h ?? '').trim());
            const colIdx = headers.findIndex((h) => h.toUpperCase() === columnName.toUpperCase() || h.toUpperCase().includes(columnName.toUpperCase()));
            if (colIdx === -1) {
                throw new Error(`Kolom "${columnName}" tidak ditemukan dalam worksheet.`);
            }
            let updatedCount = 0;
            // Update cells directly via address encoding to preserve formatting & other columns
            for (let rIdx = headerIdx + 1; rIdx < rawData.length; rIdx++) {
                const rowNumber = rIdx - headerIdx; // 1-indexed row number matching queryRows
                if (beautifiedMap[rowNumber] !== undefined) {
                    const cellRef = XLSX.utils.encode_cell({ r: rIdx, c: colIdx });
                    const newText = beautifiedMap[rowNumber];
                    if (ws[cellRef]) {
                        ws[cellRef].v = newText;
                        ws[cellRef].t = 's';
                        delete ws[cellRef].w; // clear cached formatted text
                    }
                    else {
                        ws[cellRef] = { t: 's', v: newText };
                    }
                    updatedCount++;
                }
            }
            // Write updated workbook
            XLSX.writeFile(wb, resolvedTarget);
            return {
                success: true,
                targetPath: resolvedTarget,
                totalUpdated: updatedCount,
            };
        }
        catch (err) {
            return {
                success: false,
                targetPath,
                totalUpdated: 0,
                error: err.message || String(err),
            };
        }
    }
    /**
     * Export all beautified queries into a single cleanly formatted .sql file
     */
    exportQueriesToSql(targetPath, queryRows, title) {
        try {
            const resolvedTarget = path_1.default.resolve(targetPath);
            const headerComment = `-- ========================================================\n-- ${title || 'EXPORT QUERY BEAUTY STUDIO - ORACLE SQL'}\n-- Total Queries: ${queryRows.length}\n-- Export Time: ${new Date().toLocaleString()}\n-- ========================================================\n\n`;
            const content = queryRows
                .map((q) => {
                const sep = `-- --------------------------------------------------------\n-- BARIS ${q.rowIdx}: ${q.previewLabel || ''}\n-- --------------------------------------------------------\n`;
                let sql = q.beautifiedSql.trim();
                if (!sql.endsWith(';'))
                    sql += ';';
                return `${sep}${sql}\n`;
            })
                .join('\n');
            fs_1.default.writeFileSync(resolvedTarget, headerComment + content, 'utf8');
            return {
                success: true,
                targetPath: resolvedTarget,
            };
        }
        catch (err) {
            return {
                success: false,
                targetPath,
                error: err.message || String(err),
            };
        }
    }
}
exports.QueryBeautyService = QueryBeautyService;
exports.queryBeautyService = new QueryBeautyService();
