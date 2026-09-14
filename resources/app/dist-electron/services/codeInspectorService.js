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
        '.vscode',
        'node_modules',
        'dist',
        'packages',
        'temp',
        'tmp',
        'testresults',
        'coverage',
        'aspnet_client',
        'assets',
        'vendor',
        'bower_components',
        'lib',
        'libs',
        'bundle',
        'bundles',
        'fonts',
        'images',
        'img',
        'static',
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
     * Helper to extract referenced tables, procedures, and functions from SQL string
     */
    extractSqlEntities(sql) {
        const tables = new Set();
        const procedures = new Set();
        const functions = new Set();
        if (!sql || typeof sql !== 'string')
            return { tables: [], procedures: [], functions: [] };
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
        const standardFunctions = new Set([
            // Aggregates & Analytics
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ROW_NUMBER', 'DENSE_RANK', 'RANK',
            'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'OVER', 'PARTITION',
            'CAST', 'CONVERT', 'TRY_CAST', 'TRY_CONVERT',
            // Null handling
            'NVL', 'NVL2', 'ISNULL', 'COALESCE', 'NULLIF', 'IFNULL',
            // Strings
            'SUBSTR', 'SUBSTRING', 'LEFT', 'RIGHT', 'TRIM', 'LTRIM', 'RTRIM',
            'UPPER', 'LOWER', 'INITCAP', 'REPLACE', 'TRANSLATE', 'INSTR', 'LENGTH',
            'LEN', 'CHARINDEX', 'PATINDEX', 'CONCAT', 'CONCAT_WS', 'STRING_AGG', 'FORMAT',
            'LISTAGG', 'WM_CONCAT', 'DECODE',
            // Dates
            'YEAR', 'MONTH', 'DAY', 'TO_DATE', 'TO_CHAR', 'TO_NUMBER', 'SYSDATE',
            'SYSTIMESTAMP', 'GETDATE', 'GETUTCDATE', 'SYSDATETIME', 'DATEDIFF', 'DATEADD',
            'DATEPART', 'DATENAME', 'ADD_MONTHS', 'LAST_DAY', 'MONTHS_BETWEEN',
            // Math
            'ROUND', 'TRUNC', 'FLOOR', 'CEIL', 'MOD', 'ABS', 'POWER', 'GREATEST', 'LEAST',
            // System / Other
            'SYS_GUID', 'NEWID', 'SCOPE_IDENTITY', 'IDENT_CURRENT', 'IIF', 'CHOOSE',
            'TABLE', 'EXISTS',
        ]);
        // 1. Explicit EXEC / EXECUTE / CALL -> Stored Procedures
        const execRegex = /\b(?:EXEC|EXECUTE|CALL)\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)/gi;
        let match;
        while ((match = execRegex.exec(sql)) !== null) {
            let p = match[1]?.trim();
            if (p) {
                p = p.replace(/[`"\[\]]/g, '');
                const upper = p.toUpperCase();
                if (!standardFunctions.has(upper) && !tables.has(upper) && upper.length > 2) {
                    procedures.add(p);
                }
            }
        }
        // 2. Oracle TABLE(function_name(...)) table-valued functions
        const tableFuncRegex = /\bTABLE\s*\(\s*([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)\s*\(/gi;
        while ((match = tableFuncRegex.exec(sql)) !== null) {
            let f = match[1]?.trim();
            if (f) {
                f = f.replace(/[`"\[\]]/g, '');
                const upper = f.toUpperCase();
                if (!standardFunctions.has(upper) && !tables.has(upper) && upper.length > 2) {
                    functions.add(f);
                }
            }
        }
        // 3. Standalone functions with naming conventions (DSSK_, GET_, FN_, UDF_, FUNC_, SF_, IS_, CALC_, etc.)
        const namedFuncRegex = /\b((?:DSSK_|FN_|UDF_|FUNC_|SF_|GET_|IS_|CALC_|HITUNG_|CEK_|GENERATE_|SHOW_)[a-zA-Z0-9_]+)\s*\(/gi;
        while ((match = namedFuncRegex.exec(sql)) !== null) {
            let f = match[1]?.trim();
            if (f) {
                f = f.replace(/[`"\[\]]/g, '');
                const upper = f.toUpperCase();
                if (!standardFunctions.has(upper) && !tables.has(upper) && upper.length > 2) {
                    functions.add(f);
                }
            }
        }
        // 4. Qualified schema/package functions (e.g. dbo.fn_GetSomething, schema.package.func)
        const qualifiedRegex = /\b([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)\s*\(/g;
        while ((match = qualifiedRegex.exec(sql)) !== null) {
            let qName = match[1]?.trim();
            if (qName) {
                qName = qName.replace(/[`"\[\]]/g, '');
                const upper = qName.toUpperCase();
                const parts = qName.split('.');
                if (parts[0].length <= 1 || parts.some((part) => standardFunctions.has(part.toUpperCase()))) {
                    continue;
                }
                if (!standardFunctions.has(upper) && !tables.has(upper) && upper.length > 2) {
                    const lastPartUpper = parts[parts.length - 1].toUpperCase();
                    if (lastPartUpper.startsWith('SP_') ||
                        lastPartUpper.startsWith('PR_') ||
                        lastPartUpper.startsWith('USP_') ||
                        lastPartUpper.startsWith('PROC_')) {
                        procedures.add(qName);
                    }
                    else {
                        functions.add(qName);
                    }
                }
            }
        }
        return {
            tables: Array.from(tables),
            procedures: Array.from(procedures),
            functions: Array.from(functions),
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
     * Helper to format PascalCase or camelCase into spaced title
     */
    formatReadableName(str) {
        if (!str)
            return '';
        const clean = str
            .replace(/\.(aspx|ascx|ashx|asax|cs|vb|sql|ts|js)$/gi, '')
            .replace(/^(btn|bnt|txt|ddl|lbl|chk|grid|tbl|form)_?/i, '');
        return clean
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/_/g, ' ')
            .trim();
    }
    /**
     * Infer menu breadcrumb and layer type from relative file path
     */
    inferMenuBreadcrumb(relFile) {
        const rawParts = relFile.split(/[/\\]+/).filter(Boolean);
        let layerType = 'OTHER';
        if (rawParts.some((p) => p.toLowerCase() === 'pages' || p.toLowerCase() === 'masterpages')) {
            layerType = 'UI_PAGE';
        }
        else if (rawParts.some((p) => p.toLowerCase() === 'businesslogic')) {
            layerType = 'BUSINESS_LOGIC';
        }
        else if (rawParts.some((p) => p.toLowerCase() === 'service' || p.toLowerCase() === 'services')) {
            layerType = 'SERVICE';
        }
        else if (rawParts.some((p) => p.toLowerCase() === 'reporting' || p.toLowerCase() === 'laporan' || p.toLowerCase() === 'report')) {
            layerType = 'REPORT';
        }
        // Filter out generic structural folder names
        const ignoredFolders = new Set([
            'pages', 'masterpages', 'businesslogic', 'service', 'services',
            'reporting', 'runtime', 'sys', 'static', 'bin', 'obj', 'properties',
            'app_code', 'app_data', 'scripts', 'content', 'views', 'controllers'
        ]);
        const formattedParts = [];
        for (let i = 0; i < rawParts.length; i++) {
            const p = rawParts[i];
            const pLower = p.toLowerCase();
            if (ignoredFolders.has(pLower))
                continue;
            let cleanName = p;
            if (i === rawParts.length - 1) {
                // Strip code file extensions (.aspx.cs, .aspx, .cs, .vb, etc.)
                cleanName = cleanName.replace(/\.(aspx|ascx|asmx|ashx)?\.(cs|vb)$/i, '').replace(/\.(aspx|ascx|asmx|ashx|cs|vb)$/i, '');
            }
            const formatted = this.formatReadableName(cleanName);
            if (formatted) {
                formattedParts.push(formatted);
            }
        }
        // Deduplicate consecutive identical segments (e.g. ['siska', 'Siska'] -> ['Siska'])
        const deduplicated = [];
        for (const part of formattedParts) {
            if (deduplicated.length === 0 || deduplicated[deduplicated.length - 1].toLowerCase() !== part.toLowerCase()) {
                deduplicated.push(part);
            }
        }
        const menuBreadcrumb = deduplicated.join(' > ') || this.formatReadableName(path_1.default.basename(relFile));
        return { menuBreadcrumb, layerType };
    }
    /**
     * Find enclosing C# / VB class and method
     */
    findEnclosingContext(content, charIndex) {
        const before = content.substring(0, charIndex);
        // Class
        const classMatches = [...before.matchAll(/class\s+([a-zA-Z0-9_]+)/g)];
        const enclosingClass = classMatches.length > 0 ? classMatches[classMatches.length - 1][1] : undefined;
        // Method
        const methodRegex = /^\s*(?:\[[^\]]+\]\s*)*(?:public|private|protected|internal|static|async|override|virtual)\s+[^=\n;]+?\b([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:where[^{]+)?\{?/gm;
        const methodMatches = [...before.matchAll(methodRegex)];
        const enclosingMethod = methodMatches.length > 0 ? methodMatches[methodMatches.length - 1][1] : undefined;
        return { enclosingClass, enclosingMethod };
    }
    /**
     * Infer business process flow & stage
     */
    inferProcessFlow(methodName, queryType, sql, menuBreadcrumb) {
        const mLower = (methodName || '').toLowerCase();
        const sqlLower = sql.toLowerCase();
        const methodDisplay = methodName ? `${methodName}()` : '';
        if (mLower.includes('approve') ||
            mLower.includes('reject') ||
            mLower.includes('otorisasi') ||
            mLower.includes('verifikasi') ||
            mLower.includes('notif') ||
            sqlLower.includes('show_notif_approval') ||
            sqlLower.includes('status_approval')) {
            return {
                processStage: 'APPROVAL',
                processStageLabel: '✅ Approval & Otorisasi',
                processFlowSummary: `Dijalankan pada alur verifikasi / approval data oleh pengguna pada menu ${menuBreadcrumb}${methodDisplay ? ` via fungsi ${methodDisplay}` : ''}.`,
            };
        }
        if (mLower.includes('download') ||
            mLower.includes('export') ||
            mLower.includes('cetak') ||
            mLower.includes('print') ||
            mLower.includes('report') ||
            mLower.includes('pdf') ||
            mLower.includes('excel')) {
            return {
                processStage: 'EXPORT_REPORT',
                processStageLabel: '📊 Export & Cetak Laporan',
                processFlowSummary: `Dijalankan saat pengguna mengunduh / mencetak laporan${methodDisplay ? ` (${methodDisplay})` : ''} dari menu ${menuBreadcrumb}.`,
            };
        }
        if (mLower.includes('combo') ||
            mLower.includes('dropdown') ||
            mLower.includes('init') ||
            mLower.includes('load') ||
            mLower.includes('lookup') ||
            mLower.includes('kalender') ||
            mLower.includes('default')) {
            return {
                processStage: 'INITIALIZATION',
                processStageLabel: '⚙️ Inisialisasi & Form Load',
                processFlowSummary: `Dijalankan saat halaman pertama kali dimuat${methodDisplay ? ` (${methodDisplay})` : ''} untuk mengisi pilihan dropdown menu ${menuBreadcrumb}.`,
            };
        }
        if (queryType === 'INSERT' ||
            mLower.includes('save') ||
            mLower.includes('insert') ||
            mLower.includes('tambah') ||
            mLower.includes('simpan') ||
            mLower.includes('create')) {
            return {
                processStage: 'INSERT_DATA',
                processStageLabel: '💾 Tambah / Simpan Data Baru',
                processFlowSummary: `Dijalankan saat pengguna menekan tombol Simpan / Submit${methodDisplay ? ` via ${methodDisplay}` : ''} untuk menambahkan data baru ke database pada menu ${menuBreadcrumb}.`,
            };
        }
        if (queryType === 'UPDATE' ||
            mLower.includes('update') ||
            mLower.includes('ubah') ||
            mLower.includes('edit') ||
            mLower.includes('modify')) {
            return {
                processStage: 'UPDATE_DATA',
                processStageLabel: '✏️ Update / Ubah Data',
                processFlowSummary: `Dijalankan saat pengguna memperbarui data melalui formulir edit${methodDisplay ? ` via ${methodDisplay}` : ''} pada menu ${menuBreadcrumb}.`,
            };
        }
        if (queryType === 'DELETE' ||
            mLower.includes('delete') ||
            mLower.includes('hapus') ||
            mLower.includes('remove') ||
            mLower.includes('batal')) {
            return {
                processStage: 'DELETE_DATA',
                processStageLabel: '🗑️ Hapus Data',
                processFlowSummary: `Dijalankan saat pengguna menghapus atau membatalkan data${methodDisplay ? ` via ${methodDisplay}` : ''} dari menu ${menuBreadcrumb}.`,
            };
        }
        if (mLower.includes('lastdate') || mLower.includes('getdate') || mLower.includes('cutoff')) {
            return {
                processStage: 'SEARCH_READ',
                processStageLabel: '📅 Ambil Tanggal Posisi Data',
                processFlowSummary: `Dijalankan melalui fungsi ${methodDisplay || 'GetDate'} untuk mengambil tanggal posisi/cut-off terakhir data pada menu ${menuBreadcrumb}.`,
            };
        }
        if (mLower.includes('count')) {
            return {
                processStage: 'SEARCH_READ',
                processStageLabel: '🔢 Hitung Total Record / Paging',
                processFlowSummary: `Dijalankan melalui fungsi ${methodDisplay || 'Count'} untuk menghitung total jumlah data (pagination/ringkasan) pada menu ${menuBreadcrumb}.`,
            };
        }
        if (mLower.includes('grid') || mLower.includes('rekap') || mLower.includes('struktur') || mLower.includes('posisi') || mLower.includes('modal') || mLower.includes('analis')) {
            return {
                processStage: 'SEARCH_READ',
                processStageLabel: '📥 Pencarian & Tampil Grid',
                processFlowSummary: `Dijalankan melalui fungsi ${methodDisplay || 'LoadGrid'} saat memuat tampilan data grid / rekapitulasi pada menu ${menuBreadcrumb}.`,
            };
        }
        if (queryType === 'SELECT') {
            return {
                processStage: 'SEARCH_READ',
                processStageLabel: '📥 Pencarian & Tampil Grid',
                processFlowSummary: `Dijalankan saat pengguna membuka menu ${menuBreadcrumb}${methodDisplay ? ` via ${methodDisplay}` : ''} atau menekan tombol Cari untuk menampilkan data ke tabel/grid.`,
            };
        }
        return {
            processStage: 'PROCESS',
            processStageLabel: '🔄 Proses Bisnis',
            processFlowSummary: `Dijalankan pada fungsi logic ${methodDisplay || 'eksekusi'} terkait modul ${menuBreadcrumb}.`,
        };
    }
    /**
     * Smart resolver for dynamic SQL string.Format arguments, e.g.
     * string.Format(@"SELECT * FROM TABLE({0}({1}, {2}, {3}))", arg0, ...)
     * or "SELECT * FROM TABLE({0}(...))"
     */
    resolveDynamicSql(rawSql, content, matchIndex, fullMatchLength, enclosingMethod) {
        let sql = rawSql;
        const dynamicFunctions = [];
        // Check if SQL contains dynamic placeholders like {0}
        if (!sql.includes('{0}')) {
            return { sql, dynamicFunctions };
        }
        // Look at code immediately following the string literal (within 600 characters)
        const afterCode = content.substring(matchIndex + fullMatchLength, Math.min(content.length, matchIndex + fullMatchLength + 600));
        // Check if followed by comma and first argument in string.Format or method call:
        // e.g. , "DSSK_KELOMPOK_BANK" or , functionName or , Constant.DSSK_...
        const argMatch = /^\s*,\s*([^,\r\n;]+?)(?:,|\)|;|\r|\n)/.exec(afterCode);
        let resolvedName = '';
        if (argMatch) {
            const rawArg = argMatch[1].trim();
            // Case 1: String literal, e.g. "DSSK_KELOMPOK_BANK" or @"DSSK_..."
            if (/^@?["'][^"']+["']$/.test(rawArg)) {
                resolvedName = rawArg.replace(/^@?["']|["']$/g, '').trim();
            }
            else {
                // Case 2: Identifier / variable / property, e.g. arg0, functionName, Constant.DSSK_FUNC
                const varName = rawArg.split('.').pop()?.trim() || '';
                // If variable name itself is in UPPER_SNAKE_CASE (e.g. DSSK_KELOMPOK_BANK_BYDATEUSER)
                if (/^[A-Z0-9_]{3,}$/.test(varName)) {
                    resolvedName = varName;
                }
                else if (varName) {
                    // Look backward in the method/content for: varName = "..." or varName = @"..."
                    const beforeCode = content.substring(Math.max(0, matchIndex - 2500), matchIndex);
                    const assignRegex = new RegExp(`\\b${varName}\\s*=\\s*@?["']([^"']+)["']`, 'i');
                    const assignMatch = assignRegex.exec(beforeCode);
                    if (assignMatch) {
                        resolvedName = assignMatch[1].trim();
                    }
                    else {
                        // Also search forward within current method (up to 1500 chars)
                        const forwardAssignMatch = assignRegex.exec(afterCode);
                        if (forwardAssignMatch) {
                            resolvedName = forwardAssignMatch[1].trim();
                        }
                        else {
                            // Search class-wide constants
                            const constRegex = new RegExp(`\\b(?:const\\s+string|readonly\\s+string|string)\\s+${varName}\\s*=\\s*@?["']([^"']+)["']`, 'i');
                            const constMatch = constRegex.exec(content);
                            if (constMatch) {
                                resolvedName = constMatch[1].trim();
                            }
                        }
                    }
                }
            }
        }
        // Case 3: If still not resolved, check if enclosing method has any function-like string literal
        // (e.g. "DSSK_...", "FN_...") defined nearby within 2000 chars before the SQL
        if (!resolvedName && enclosingMethod) {
            const nearbyCode = content.substring(Math.max(0, matchIndex - 1500), Math.min(content.length, matchIndex + fullMatchLength + 300));
            const fnLiteralMatch = /@?["']\b((?:DSSK_|FN_|SF_|FUNC_|UDF_|GET_|SHOW_|HITUNG_|CEK_)[A-Za-z0-9_]+)\b["']/i.exec(nearbyCode);
            if (fnLiteralMatch) {
                resolvedName = fnLiteralMatch[1].trim();
            }
        }
        if (resolvedName) {
            // Replace {0} with the resolved function name in SQL
            sql = sql.replace(/\{0\}/g, resolvedName);
            dynamicFunctions.push(resolvedName);
        }
        else {
            // If unable to resolve exact name, make the SQL and function explicit instead of cryptic {0}
            if (sql.includes('TABLE({0}')) {
                const fallbackLabel = enclosingMethod ? `Dynamic Function (${enclosingMethod}())` : 'Dynamic Oracle Table Function';
                dynamicFunctions.push(fallbackLabel);
            }
        }
        return { sql, dynamicFunctions };
    }
    /**
     * Scan single source file for embedded SQL and stored procedures
     */
    scanSourceFile(filePath, relFile) {
        const queries = [];
        try {
            const content = fs_1.default.readFileSync(filePath, 'utf8');
            if (content.length > 2 * 1024 * 1024)
                return []; // Skip files > 2MB
            // Fast check: Quickly skip files without any SQL keywords or SP calls
            const upperQuick = content.toUpperCase();
            const hasPossibleSql = upperQuick.includes('SELECT') ||
                upperQuick.includes('INSERT') ||
                upperQuick.includes('UPDATE') ||
                upperQuick.includes('DELETE') ||
                upperQuick.includes('MERGE') ||
                upperQuick.includes('EXEC') ||
                upperQuick.includes('COMMANDTEXT') ||
                upperQuick.includes('STOREDPROCEDURE');
            if (!hasPossibleSql)
                return [];
            let cachedLines = null;
            const getLines = () => {
                if (!cachedLines)
                    cachedLines = content.split(/\r?\n/);
                return cachedLines;
            };
            const { menuBreadcrumb, layerType } = this.inferMenuBreadcrumb(relFile);
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
                    const { enclosingClass, enclosingMethod } = this.findEnclosingContext(content, match.index);
                    // Smart resolver for dynamic SQL string.Format arguments (e.g. TABLE({0}(...)))
                    const { sql: resolvedSql, dynamicFunctions } = this.resolveDynamicSql(sql, content, match.index, fullMatch.length, enclosingMethod);
                    sql = resolvedSql;
                    const entities = this.extractSqlEntities(sql);
                    for (const df of dynamicFunctions) {
                        if (!entities.functions.includes(df)) {
                            entities.functions.push(df);
                        }
                    }
                    let qType = 'SELECT';
                    if (keyword.startsWith('INSERT'))
                        qType = 'INSERT';
                    else if (keyword.startsWith('UPDATE'))
                        qType = 'UPDATE';
                    else if (keyword.startsWith('DELETE'))
                        qType = 'DELETE';
                    else if (keyword.startsWith('MERGE'))
                        qType = 'MERGE';
                    const { processStage, processStageLabel, processFlowSummary } = this.inferProcessFlow(enclosingMethod, qType, sql, menuBreadcrumb);
                    const targetIdentifier = entities.tables[0] || entities.procedures[0] || entities.functions[0] || path_1.default.basename(relFile);
                    queries.push({
                        id: `sql-${Buffer.from(relFile + lineNum + counter++).toString('hex').substring(0, 10)}`,
                        name: `${qType} (${targetIdentifier})`,
                        type: qType,
                        sql,
                        sourceFile: filePath,
                        relativeSourceFile: relFile,
                        lineNumber: lineNum,
                        codeContextSnippet: this.getSnippet(getLines(), lineNum),
                        referencedTables: entities.tables,
                        referencedProcedures: entities.procedures,
                        referencedFunctions: entities.functions,
                        menuBreadcrumb,
                        layerType,
                        enclosingClass,
                        enclosingMethod,
                        processStage,
                        processStageLabel,
                        processFlowSummary,
                    });
                }
            }
            // Regex 2: Standard single/multiline string: "SELECT ... FROM ... "
            const standardSqlRegex = /"(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+([^"\r\n]+)"/gi;
            while ((match = standardSqlRegex.exec(content)) !== null) {
                const keyword = match[1].toUpperCase();
                let sql = (match[1] + ' ' + match[2]).trim();
                if (sql.length > 20 && !sql.toLowerCase().includes('select * from dual')) {
                    const lineNum = this.getLineNumber(content, match.index);
                    // Avoid duplicate if already matched by verbatim
                    if (!queries.some((q) => q.relativeSourceFile === relFile && Math.abs(q.lineNumber - lineNum) <= 1)) {
                        const { enclosingClass, enclosingMethod } = this.findEnclosingContext(content, match.index);
                        // Smart resolver for dynamic SQL
                        const { sql: resolvedSql, dynamicFunctions } = this.resolveDynamicSql(sql, content, match.index, match[0].length, enclosingMethod);
                        sql = resolvedSql;
                        const entities = this.extractSqlEntities(sql);
                        for (const df of dynamicFunctions) {
                            if (!entities.functions.includes(df)) {
                                entities.functions.push(df);
                            }
                        }
                        let qType = 'SELECT';
                        if (keyword.startsWith('INSERT'))
                            qType = 'INSERT';
                        else if (keyword.startsWith('UPDATE'))
                            qType = 'UPDATE';
                        else if (keyword.startsWith('DELETE'))
                            qType = 'DELETE';
                        else if (keyword.startsWith('MERGE'))
                            qType = 'MERGE';
                        const { processStage, processStageLabel, processFlowSummary } = this.inferProcessFlow(enclosingMethod, qType, sql, menuBreadcrumb);
                        const targetIdentifier = entities.tables[0] || entities.procedures[0] || entities.functions[0] || path_1.default.basename(relFile);
                        queries.push({
                            id: `sql-${Buffer.from(relFile + lineNum + counter++).toString('hex').substring(0, 10)}`,
                            name: `${qType} (${targetIdentifier})`,
                            type: qType,
                            sql,
                            sourceFile: filePath,
                            relativeSourceFile: relFile,
                            lineNumber: lineNum,
                            codeContextSnippet: this.getSnippet(getLines(), lineNum),
                            referencedTables: entities.tables,
                            referencedProcedures: entities.procedures,
                            referencedFunctions: entities.functions,
                            menuBreadcrumb,
                            layerType,
                            enclosingClass,
                            enclosingMethod,
                            processStage,
                            processStageLabel,
                            processFlowSummary,
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
                    const { enclosingClass, enclosingMethod } = this.findEnclosingContext(content, match.index);
                    const { processStage, processStageLabel, processFlowSummary } = this.inferProcessFlow(enclosingMethod, 'PROCEDURE', `EXEC ${procName}`, menuBreadcrumb);
                    queries.push({
                        id: `sp-${Buffer.from(relFile + lineNum + counter++).toString('hex').substring(0, 10)}`,
                        name: `PROCEDURE (${procName})`,
                        type: 'PROCEDURE',
                        sql: `EXEC ${procName}`,
                        sourceFile: filePath,
                        relativeSourceFile: relFile,
                        lineNumber: lineNum,
                        codeContextSnippet: this.getSnippet(getLines(), lineNum),
                        referencedTables: [],
                        referencedProcedures: [procName],
                        referencedFunctions: [],
                        menuBreadcrumb,
                        layerType,
                        enclosingClass,
                        enclosingMethod,
                        processStage,
                        processStageLabel,
                        processFlowSummary,
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
                    // Skip minified libraries, map files, and designer auto-generated files
                    if (baseName.includes('.min.') ||
                        baseName.endsWith('.designer.cs') ||
                        baseName.endsWith('.designer.vb') ||
                        baseName.endsWith('.map')) {
                        continue;
                    }
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
        // Aggregate Stored Procedures & Database Functions
        const procMap = new Map();
        for (const q of queries) {
            // Procedures
            for (const p of q.referencedProcedures) {
                if (!procMap.has(p)) {
                    let pType = 'PROCEDURE';
                    if (p.includes('.')) {
                        pType = 'PACKAGE_MEMBER';
                    }
                    procMap.set(p, {
                        name: p,
                        type: pType,
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
            // Functions
            for (const f of (q.referencedFunctions || [])) {
                if (!procMap.has(f)) {
                    let fType = 'FUNCTION';
                    if (f.includes('.')) {
                        fType = 'PACKAGE_MEMBER';
                    }
                    else if (f.toUpperCase().includes('TABLE(')) {
                        fType = 'TABLE_FUNCTION';
                    }
                    procMap.set(f, {
                        name: f,
                        type: fType,
                        calledCount: 0,
                        occurrences: [],
                    });
                }
                const item = procMap.get(f);
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
