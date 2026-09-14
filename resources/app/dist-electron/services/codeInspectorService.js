"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeInspectorService = exports.CodeInspectorService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class CodeInspectorService {
    ignoredDirectories = new Set([
        'bin',
        'obj',
        '.git',
        '.vs',
        'node_modules',
        'dist',
        'packages',
        'temp',
        'tmp',
        'testresults',
        'coverage',
        'aspnet_client',
        'assets',
    ]);
    sourceCodeExtensions = new Set([
        '.cs',
        '.vb',
        '.aspx',
        '.ascx',
        '.ashx',
        '.asax',
        '.sql',
        '.ts',
        '.js',
    ]);
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
                if (t && !['SELECT', 'WHERE', 'SET', 'DUAL', 'ON', 'AS', 'TABLE', 'VIEW', 'DATABASE', 'VALUES', '(', ')'].includes(t.toUpperCase())) {
                    t = t.replace(/[`"\[\]]/g, '');
                    if (t.length > 2 && !/^\d+$/.test(t)) {
                        tables.add(t.toUpperCase());
                    }
                }
            }
        }
        // Stored Procedures and Function calls
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
                    if (!standardFunctions.has(upper) && !tables.has(upper)) {
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
     * Parse connection string into structured fields
     */
    parseConnectionString(rawConn, sourceFile, relFile, name, sourceType) {
        if (!rawConn || rawConn.trim().length === 0)
            return null;
        const lower = rawConn.toLowerCase();
        let dbType = 'other';
        let host;
        let port;
        let database;
        let serviceName;
        let sid;
        let user;
        let password;
        let provider;
        // Detect provider / dbType
        if (lower.includes('oracle') || lower.includes('data source=//') || lower.includes('(description=')) {
            dbType = 'oracle';
        }
        else if (lower.includes('initial catalog') || lower.includes('sql server') || lower.includes('sqloledb')) {
            dbType = 'sqlserver';
        }
        else if (lower.includes('postgres') || lower.includes('npgsql')) {
            dbType = 'postgres';
        }
        else if (lower.includes('mysql')) {
            dbType = 'mysql';
        }
        // Key-value pairs parser (semicolon delimited)
        const pairs = rawConn.split(';');
        for (const pair of pairs) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1)
                continue;
            const k = pair.substring(0, eqIdx).trim().toLowerCase();
            const v = pair.substring(eqIdx + 1).trim();
            if (['user id', 'uid', 'user', 'username'].includes(k)) {
                user = v;
            }
            else if (['password', 'pwd'].includes(k)) {
                password = v;
            }
            else if (['initial catalog', 'database', 'db'].includes(k)) {
                database = v;
            }
            else if (['provider'].includes(k)) {
                provider = v;
            }
            else if (['data source', 'server', 'datasource', 'host'].includes(k)) {
                // Could be //10.161.10.134:1521/sss or host,port or host\instance or (DESCRIPTION=...)
                if (v.startsWith('//')) {
                    dbType = 'oracle';
                    const trimmed = v.substring(2);
                    const slashIdx = trimmed.indexOf('/');
                    if (slashIdx !== -1) {
                        serviceName = trimmed.substring(slashIdx + 1);
                        const hostPort = trimmed.substring(0, slashIdx);
                        const colonIdx = hostPort.indexOf(':');
                        if (colonIdx !== -1) {
                            host = hostPort.substring(0, colonIdx);
                            port = parseInt(hostPort.substring(colonIdx + 1), 10) || 1521;
                        }
                        else {
                            host = hostPort;
                            port = 1521;
                        }
                    }
                    else {
                        host = trimmed;
                        port = 1521;
                    }
                }
                else if (v.toUpperCase().includes('(DESCRIPTION=')) {
                    dbType = 'oracle';
                    const hostMatch = v.match(/HOST\s*=\s*([^\s\)]+)/i);
                    const portMatch = v.match(/PORT\s*=\s*([^\s\)]+)/i);
                    const serviceMatch = v.match(/SERVICE_NAME\s*=\s*([^\s\)]+)/i);
                    const sidMatch = v.match(/SID\s*=\s*([^\s\)]+)/i);
                    if (hostMatch)
                        host = hostMatch[1];
                    if (portMatch)
                        port = parseInt(portMatch[1], 10);
                    if (serviceMatch)
                        serviceName = serviceMatch[1];
                    if (sidMatch)
                        sid = sidMatch[1];
                }
                else {
                    // Normal host:port or host,port
                    const hostParts = v.split(/[,:]/);
                    host = hostParts[0]?.trim();
                    if (hostParts[1]) {
                        port = parseInt(hostParts[1].trim(), 10) || undefined;
                    }
                }
            }
        }
        // Default ports if dbType is recognized
        if (!port) {
            if (dbType === 'oracle')
                port = 1521;
            else if (dbType === 'sqlserver')
                port = 1433;
            else if (dbType === 'postgres')
                port = 5432;
            else if (dbType === 'mysql')
                port = 3306;
        }
        return {
            id: `conn-${Buffer.from(relFile + name).toString('hex').substring(0, 12)}`,
            name: name || (serviceName ? `Oracle (${serviceName})` : host ? `${host}` : 'Database Connection'),
            sourceFile,
            relativeSourceFile: relFile,
            sourceType,
            rawConnectionString: rawConn,
            dbType,
            host,
            port,
            database: database || serviceName || sid,
            serviceName,
            sid,
            user,
            password,
            provider,
        };
    }
    /**
     * Parse XML config files like Web.config, App.config
     */
    parseConfigFile(filePath, relFile) {
        const results = [];
        try {
            const content = fs_1.default.readFileSync(filePath, 'utf8');
            // 1. Standard <connectionStrings> block:
            // <add name="..." connectionString="..." providerName="..." />
            const connStrRegex = /<add\b[^>]*?\bname="([^"]+)"[^>]*?\bconnectionString="([^"]+)"[^>]*?(?:\bproviderName="([^"]+)")?[^>]*>/gi;
            let match;
            while ((match = connStrRegex.exec(content)) !== null) {
                const name = match[1];
                const rawConn = match[2];
                const parsed = this.parseConnectionString(rawConn, filePath, relFile, name, 'web.config');
                if (parsed)
                    results.push(parsed);
            }
            // Also match reverse attribute order (connectionString before name)
            const connStrReverseRegex = /<add\b[^>]*?\bconnectionString="([^"]+)"[^>]*?\bname="([^"]+)"[^>]*?(?:\bproviderName="([^"]+)")?[^>]*>/gi;
            while ((match = connStrReverseRegex.exec(content)) !== null) {
                const rawConn = match[1];
                const name = match[2];
                if (!results.some((r) => r.name === name)) {
                    const parsed = this.parseConnectionString(rawConn, filePath, relFile, name, 'web.config');
                    if (parsed)
                        results.push(parsed);
                }
            }
            // 2. Custom Application Settings <setting name="...ConnectionString..." serializeAs="String"><value>...</value></setting>
            const appSettingValRegex = /<setting\b[^>]*?\bname="([^"]*Connection[^"]*|ConnectionString)"[^>]*>[\s\S]*?<value>([\s\S]*?)<\/value>/gi;
            while ((match = appSettingValRegex.exec(content)) !== null) {
                const name = match[1];
                const rawConn = match[2].trim();
                if (rawConn.length > 5) {
                    const parsed = this.parseConnectionString(rawConn, filePath, relFile, name, 'web.config');
                    if (parsed && !results.some((r) => r.rawConnectionString === rawConn)) {
                        results.push(parsed);
                    }
                }
            }
            // 3. Standard <appSettings><add key="...Conn..." value="..." /></appSettings>
            const keyValRegex = /<add\b[^>]*?\bkey="([^"]*Conn[^"]*|[^"]*Database[^"]*)"[^>]*?\bvalue="([^"]+)"/gi;
            while ((match = keyValRegex.exec(content)) !== null) {
                const name = match[1];
                const rawConn = match[2].trim();
                if (rawConn.length > 5 && rawConn.includes(';')) {
                    const parsed = this.parseConnectionString(rawConn, filePath, relFile, name, 'web.config');
                    if (parsed && !results.some((r) => r.rawConnectionString === rawConn)) {
                        results.push(parsed);
                    }
                }
            }
        }
        catch (e) {
            console.warn(`Could not parse config file ${filePath}:`, e.message);
        }
        return results;
    }
    /**
     * Parse JSON config files (e.g. appsettings.json)
     */
    parseJsonConfigFile(filePath, relFile) {
        const results = [];
        try {
            const content = fs_1.default.readFileSync(filePath, 'utf8');
            const json = JSON.parse(content);
            if (json.ConnectionStrings && typeof json.ConnectionStrings === 'object') {
                for (const [key, val] of Object.entries(json.ConnectionStrings)) {
                    if (typeof val === 'string') {
                        const parsed = this.parseConnectionString(val, filePath, relFile, key, 'appsettings.json');
                        if (parsed)
                            results.push(parsed);
                    }
                }
            }
        }
        catch {
            // Ignored if invalid json
        }
        return results;
    }
    /**
     * Helper to calculate line number from char index
     */
    getLineNumber(content, index) {
        let line = 1;
        for (let i = 0; i < index && i < content.length; i++) {
            if (content[i] === '\n')
                line++;
        }
        return line;
    }
    /**
     * Helper to extract a 5-line context snippet
     */
    getSnippet(lines, lineNum) {
        const start = Math.max(0, lineNum - 3);
        const end = Math.min(lines.length, lineNum + 2);
        return lines.slice(start, end).join('\n');
    }
    /**
     * Scan single source file for embedded SQL and stored procedures
     */
    scanSourceFile(filePath, relFile) {
        const queries = [];
        try {
            const content = fs_1.default.readFileSync(filePath, 'utf8');
            if (content.length > 3 * 1024 * 1024)
                return []; // Skip files > 3MB
            const lines = content.split(/\r?\n/);
            // Regex 1: C# Multiline verbatim strings @"SELECT ... " or @"INSERT ... "
            const verbatimSqlRegex = /@"(?:\s*)(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\b([\s\S]*?)"/gi;
            let match;
            let counter = 1;
            while ((match = verbatimSqlRegex.exec(content)) !== null) {
                const fullMatch = match[0];
                const keyword = match[1].toUpperCase();
                let sql = fullMatch.substring(2, fullMatch.length - 1); // remove @" and "
                sql = sql.replace(/""/g, '"').trim();
                if (sql.length > 15) {
                    const lineNum = this.getLineNumber(content, match.index);
                    const entities = this.extractSqlEntities(sql);
                    let qType = 'SELECT';
                    if (keyword.startsWith('INSERT'))
                        qType = 'INSERT';
                    else if (keyword.startsWith('UPDATE'))
                        qType = 'UPDATE';
                    else if (keyword.startsWith('DELETE'))
                        qType = 'DELETE';
                    else if (keyword.startsWith('MERGE'))
                        qType = 'MERGE';
                    queries.push({
                        id: `sql-${Buffer.from(relFile + lineNum + counter++).toString('hex').substring(0, 10)}`,
                        name: `${qType} (${entities.tables[0] || path_1.default.basename(relFile)})`,
                        type: qType,
                        sql,
                        sourceFile: filePath,
                        relativeSourceFile: relFile,
                        lineNumber: lineNum,
                        codeContextSnippet: this.getSnippet(lines, lineNum),
                        referencedTables: entities.tables,
                        referencedProcedures: entities.procedures,
                    });
                }
            }
            // Regex 2: Standard single/multiline string: "SELECT ... FROM ... "
            const standardSqlRegex = /"(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+([^"\r\n]+)"/gi;
            while ((match = standardSqlRegex.exec(content)) !== null) {
                const keyword = match[1].toUpperCase();
                const sql = (match[1] + ' ' + match[2]).trim();
                if (sql.length > 20 && !sql.toLowerCase().includes('select * from dual')) {
                    const lineNum = this.getLineNumber(content, match.index);
                    // Avoid duplicate if already matched by verbatim
                    if (!queries.some((q) => q.relativeSourceFile === relFile && Math.abs(q.lineNumber - lineNum) <= 1)) {
                        const entities = this.extractSqlEntities(sql);
                        let qType = 'SELECT';
                        if (keyword.startsWith('INSERT'))
                            qType = 'INSERT';
                        else if (keyword.startsWith('UPDATE'))
                            qType = 'UPDATE';
                        else if (keyword.startsWith('DELETE'))
                            qType = 'DELETE';
                        else if (keyword.startsWith('MERGE'))
                            qType = 'MERGE';
                        queries.push({
                            id: `sql-${Buffer.from(relFile + lineNum + counter++).toString('hex').substring(0, 10)}`,
                            name: `${qType} (${entities.tables[0] || path_1.default.basename(relFile)})`,
                            type: qType,
                            sql,
                            sourceFile: filePath,
                            relativeSourceFile: relFile,
                            lineNumber: lineNum,
                            codeContextSnippet: this.getSnippet(lines, lineNum),
                            referencedTables: entities.tables,
                            referencedProcedures: entities.procedures,
                        });
                    }
                }
            }
            // Regex 3: Stored procedure calls in C# / VB:
            // CommandType.StoredProcedure ... CommandText = "..."
            const spCommandRegex = /CommandText\s*=\s*["@]?([a-zA-Z0-9_\.]+)[";\s]/gi;
            while ((match = spCommandRegex.exec(content)) !== null) {
                const procName = match[1].replace(/["']/g, '').trim();
                // Check if CommandType.StoredProcedure exists nearby (within 300 chars)
                const nearby = content.substring(Math.max(0, match.index - 200), Math.min(content.length, match.index + 200));
                if (nearby.includes('StoredProcedure') && procName.length > 2) {
                    const lineNum = this.getLineNumber(content, match.index);
                    queries.push({
                        id: `sp-${Buffer.from(relFile + lineNum + counter++).toString('hex').substring(0, 10)}`,
                        name: `PROCEDURE (${procName})`,
                        type: 'PROCEDURE',
                        sql: `EXEC ${procName}`,
                        sourceFile: filePath,
                        relativeSourceFile: relFile,
                        lineNumber: lineNum,
                        codeContextSnippet: this.getSnippet(lines, lineNum),
                        referencedTables: [],
                        referencedProcedures: [procName],
                    });
                }
            }
        }
        catch (e) {
            console.warn(`Could not scan source file ${filePath}:`, e.message);
        }
        return queries;
    }
    /**
     * Main scan function for a folder / codebase
     */
    scanFolder(folderPath) {
        const startTime = Date.now();
        if (!fs_1.default.existsSync(folderPath)) {
            throw new Error(`Folder tidak ditemukan: ${folderPath}`);
        }
        const solutions = [];
        const projects = [];
        const connections = [];
        const queries = [];
        let totalFilesScanned = 0;
        const walk = (currentDir) => {
            const items = fs_1.default.readdirSync(currentDir, { withFileTypes: true });
            for (const item of items) {
                const full = path_1.default.join(currentDir, item.name);
                const rel = path_1.default.relative(folderPath, full);
                if (item.isDirectory()) {
                    const dirLower = item.name.toLowerCase();
                    if (this.ignoredDirectories.has(dirLower) || dirLower.startsWith('.')) {
                        continue;
                    }
                    walk(full);
                }
                else {
                    totalFilesScanned++;
                    const ext = path_1.default.extname(item.name).toLowerCase();
                    const baseName = item.name.toLowerCase();
                    // Detect Visual Studio Solutions & Project Files
                    if (ext === '.sln') {
                        solutions.push(item.name);
                    }
                    else if (ext === '.csproj' || ext === '.vbproj') {
                        projects.push(item.name);
                    }
                    // Parse Connection Strings from Config Files
                    if (baseName.endsWith('.config')) {
                        const conns = this.parseConfigFile(full, rel);
                        connections.push(...conns);
                    }
                    else if (baseName.startsWith('appsettings') && ext === '.json') {
                        const conns = this.parseJsonConfigFile(full, rel);
                        connections.push(...conns);
                    }
                    // Parse Embedded SQL & Stored Procedures from Source Code
                    if (this.sourceCodeExtensions.has(ext)) {
                        const fileQueries = this.scanSourceFile(full, rel);
                        queries.push(...fileQueries);
                    }
                }
            }
        };
        walk(folderPath);
        // Aggregate Tables
        const tableMap = new Map();
        for (const q of queries) {
            for (const t of q.referencedTables) {
                const upper = t.toUpperCase();
                if (!tableMap.has(upper)) {
                    tableMap.set(upper, {
                        name: upper,
                        referencedCount: 0,
                        operations: [],
                        occurrences: [],
                    });
                }
                const item = tableMap.get(upper);
                item.referencedCount++;
                if (['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(q.type) && !item.operations.includes(q.type)) {
                    item.operations.push(q.type);
                }
                item.occurrences.push({
                    file: q.sourceFile,
                    relativeFile: q.relativeSourceFile,
                    lineNumber: q.lineNumber,
                    operation: q.type,
                    snippet: q.codeContextSnippet,
                });
            }
        }
        // Aggregate Stored Procedures
        const procMap = new Map();
        for (const q of queries) {
            for (const p of q.referencedProcedures) {
                if (!procMap.has(p)) {
                    procMap.set(p, {
                        name: p,
                        calledCount: 0,
                        occurrences: [],
                    });
                }
                const item = procMap.get(p);
                item.calledCount++;
                item.occurrences.push({
                    file: q.sourceFile,
                    relativeFile: q.relativeSourceFile,
                    lineNumber: q.lineNumber,
                    snippet: q.codeContextSnippet,
                });
            }
        }
        const tables = Array.from(tableMap.values()).sort((a, b) => b.referencedCount - a.referencedCount);
        const procedures = Array.from(procMap.values()).sort((a, b) => b.calledCount - a.calledCount);
        const stats = {
            totalFilesScanned,
            totalConnectionsFound: connections.length,
            totalQueriesFound: queries.length,
            totalTablesFound: tables.length,
            totalProceduresFound: procedures.length,
            durationMs: Date.now() - startTime,
        };
        return {
            folderPath,
            solutions,
            projects,
            stats,
            connections,
            queries,
            tables,
            procedures,
        };
    }
}
exports.CodeInspectorService = CodeInspectorService;
exports.codeInspectorService = new CodeInspectorService();
