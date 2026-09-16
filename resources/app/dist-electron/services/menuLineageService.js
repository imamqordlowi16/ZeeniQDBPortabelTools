"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.menuLineageService = exports.MenuLineageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readline_1 = __importDefault(require("readline"));
class MenuLineageService {
    procIndex = new Map();
    businessLogicCache = new Map();
    sendProgress(win, message, current, total) {
        if (!win || win.isDestroyed())
            return;
        win.webContents.send('menu-lineage:progress', { message, current, total });
    }
    /**
     * Scans both ALL_Proc (for SQL procedures) and siska (for UI pages & C# DAL)
     */
    async scanMenuLineage(siskaPath, procPath, win = null) {
        const startTime = Date.now();
        this.procIndex.clear();
        this.businessLogicCache.clear();
        // 1. Index ALL_Proc if provided
        if (procPath && fs_1.default.existsSync(procPath)) {
            this.sendProgress(win, 'Meng-index repositori SQL di ALL_Proc...');
            await this.indexSqlRepository(procPath, win);
        }
        // 2. Pre-index BusinessLogic classes in siska
        if (fs_1.default.existsSync(siskaPath)) {
            this.sendProgress(win, 'Menganalisis BusinessLogic & Data Access Layer siska...');
            await this.indexBusinessLogic(siskaPath);
        }
        // 3. Scan UI Pages in siska
        this.sendProgress(win, 'Mengumpulkan halaman UI (*.aspx, *.ascx)...');
        const uiFiles = this.collectUiFiles(siskaPath);
        const totalFiles = uiFiles.length;
        const allRows = [];
        let matchedSqlCount = 0;
        for (let i = 0; i < totalFiles; i++) {
            const filePath = uiFiles[i];
            if (i % 20 === 0 || i === totalFiles - 1) {
                this.sendProgress(win, `Memparsing halaman UI (${i + 1}/${totalFiles}): ${path_1.default.basename(filePath)}`, i + 1, totalFiles);
            }
            try {
                const rows = await this.parseSingleUiPage(filePath, siskaPath);
                for (const row of rows) {
                    if (row.isSqlFound)
                        matchedSqlCount++;
                    allRows.push(row);
                }
            }
            catch (err) {
                console.error(`[MenuLineageService] Error parsing ${filePath}:`, err.message);
            }
        }
        const durationMs = Date.now() - startTime;
        this.sendProgress(win, `Selesai! Ditemukan ${allRows.length} pemetaan (${matchedSqlCount} cocok dengan ALL_Proc).`, totalFiles, totalFiles);
        return {
            rows: allRows,
            stats: {
                totalRows: allRows.length,
                matchedSqlCount,
                scannedPages: totalFiles,
                durationMs,
            },
        };
    }
    cleanProcKey(name) {
        if (!name)
            return '';
        let clean = name.trim().replace(/['"`;()\[\]]/g, '');
        if (clean.toUpperCase().startsWith('SSS.')) {
            clean = clean.substring(4);
        }
        else if (clean.toUpperCase().startsWith('DBO.')) {
            clean = clean.substring(4);
        }
        return clean.toUpperCase();
    }
    registerProcMeta(key, meta) {
        if (!key)
            return;
        const clean = this.cleanProcKey(key);
        this.procIndex.set(clean, meta);
        // Register hyphen <-> underscore variants (e.g. DSSK-100-00173 <-> DSSK_100_00173)
        if (clean.includes('-')) {
            this.procIndex.set(clean.replace(/-/g, '_'), meta);
        }
        else if (clean.includes('_')) {
            this.procIndex.set(clean.replace(/_/g, '-'), meta);
        }
    }
    async indexSqlRepository(procPath, win) {
        const files = [];
        const findSqlFiles = (dir) => {
            try {
                const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    const full = path_1.default.join(dir, e.name);
                    if (e.isDirectory())
                        findSqlFiles(full);
                    else if (e.isFile() && e.name.toLowerCase().endsWith('.sql'))
                        files.push(full);
                }
            }
            catch { }
        };
        findSqlFiles(procPath);
        for (let fIdx = 0; fIdx < files.length; fIdx++) {
            const sqlFile = files[fIdx];
            const fileName = path_1.default.basename(sqlFile);
            const baseName = path_1.default.parse(sqlFile).name;
            this.sendProgress(win, `Indexing SQL (${fIdx + 1}/${files.length}): ${fileName}...`);
            // If standalone file
            if (!baseName.toUpperCase().startsWith('ALL_')) {
                this.registerProcMeta(baseName, {
                    procName: baseName,
                    filePath: sqlFile,
                    fileName,
                    startLine: 1,
                    endLine: -1,
                });
            }
            // Stream parse line-by-line
            await new Promise((resolve) => {
                const rl = readline_1.default.createInterface({
                    input: fs_1.default.createReadStream(sqlFile, { encoding: 'utf8', highWaterMark: 65536 }),
                    crlfDelay: Infinity,
                });
                const createRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(PROCEDURE|FUNCTION|PACKAGE\s+BODY|PACKAGE)\s+(?:["']?[\w$]+["']?\.)?["']?([\w$]+)["']?/i;
                const subprogramRegex = /^\s*(PROCEDURE|FUNCTION)\s+["']?([\w$]+)["']?\s*(?:\(|$)/i;
                let lineNum = 0;
                let currentTop = null;
                let currentPkgName = '';
                let isInsidePkgBody = false;
                rl.on('line', (line) => {
                    lineNum++;
                    if (line.length > 6 && line.toUpperCase().includes('CREATE')) {
                        const m = createRegex.exec(line);
                        if (m) {
                            if (currentTop)
                                currentTop.endLine = lineNum - 1;
                            const typeRaw = m[1].toUpperCase().trim();
                            const name = m[2].trim();
                            const objType = typeRaw.includes('FUNC') ? 'FUNCTION' : typeRaw.includes('BODY') ? 'PACKAGE_BODY' : typeRaw.includes('PACK') ? 'PACKAGE' : 'PROCEDURE';
                            if (objType === 'PACKAGE_BODY' || objType === 'PACKAGE') {
                                currentPkgName = name;
                                isInsidePkgBody = objType === 'PACKAGE_BODY';
                            }
                            else {
                                currentPkgName = '';
                                isInsidePkgBody = false;
                            }
                            currentTop = {
                                procName: name,
                                packageName: currentPkgName,
                                filePath: sqlFile,
                                fileName,
                                startLine: lineNum,
                                endLine: lineNum,
                            };
                            this.registerProcMeta(name, currentTop);
                            return;
                        }
                    }
                    if (isInsidePkgBody && currentPkgName && line.length > 8) {
                        const sm = subprogramRegex.exec(line);
                        if (sm) {
                            const subName = sm[2].trim();
                            const subMeta = {
                                procName: subName,
                                packageName: currentPkgName,
                                filePath: sqlFile,
                                fileName,
                                startLine: lineNum,
                                endLine: lineNum + 80,
                            };
                            this.registerProcMeta(`${currentPkgName}.${subName}`, subMeta);
                            this.registerProcMeta(subName, subMeta);
                        }
                    }
                });
                rl.on('close', () => {
                    if (currentTop)
                        currentTop.endLine = lineNum;
                    resolve();
                });
            });
        }
    }
    async getSqlContent(meta) {
        if (meta.sqlContent)
            return meta.sqlContent;
        if (!fs_1.default.existsSync(meta.filePath))
            return '';
        try {
            if (meta.endLine <= 0) {
                meta.sqlContent = await fs_1.default.promises.readFile(meta.filePath, 'utf8');
                return meta.sqlContent;
            }
            return await new Promise((resolve) => {
                const rl = readline_1.default.createInterface({
                    input: fs_1.default.createReadStream(meta.filePath, { encoding: 'utf8', highWaterMark: 32768 }),
                    crlfDelay: Infinity,
                });
                let cur = 0;
                const lines = [];
                const maxLines = Math.min(meta.endLine >= meta.startLine ? meta.endLine - meta.startLine + 1 : 200, 1000);
                rl.on('line', (l) => {
                    cur++;
                    if (cur >= meta.startLine) {
                        lines.push(l);
                        if (lines.length >= maxLines) {
                            rl.close();
                        }
                    }
                });
                rl.on('close', () => {
                    meta.sqlContent = lines.join('\n');
                    resolve(meta.sqlContent);
                });
            });
        }
        catch (e) {
            return `-- Error loading SQL: ${e.message}`;
        }
    }
    async indexBusinessLogic(siskaPath) {
        const blPath = path_1.default.join(siskaPath, 'BusinessLogic');
        if (!fs_1.default.existsSync(blPath))
            return;
        const csFiles = [];
        const findCs = (dir) => {
            try {
                const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    const full = path_1.default.join(dir, e.name);
                    if (e.isDirectory())
                        findCs(full);
                    else if (e.isFile() && e.name.toLowerCase().endsWith('.cs'))
                        csFiles.push(full);
                }
            }
            catch { }
        };
        findCs(blPath);
        for (const file of csFiles) {
            try {
                const className = path_1.default.parse(file).name;
                const content = await fs_1.default.promises.readFile(file, 'utf8');
                const calls = this.extractDatabaseCalls(content);
                if (calls.length > 0) {
                    this.businessLogicCache.set(className, calls);
                }
            }
            catch { }
        }
    }
    collectUiFiles(root) {
        const results = [];
        if (!fs_1.default.existsSync(root))
            return results;
        const scanDir = (dir) => {
            try {
                const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    const full = path_1.default.join(dir, e.name);
                    const lower = e.name.toLowerCase();
                    if (e.isDirectory()) {
                        if (!['bin', 'obj', 'temp', '.git', 'aspnet_client'].includes(lower)) {
                            scanDir(full);
                        }
                    }
                    else if (e.isFile()) {
                        if (lower.endsWith('.aspx') || lower.endsWith('.ascx')) {
                            results.push(full);
                        }
                    }
                }
            }
            catch { }
        };
        scanDir(root);
        return results;
    }
    extractDatabaseCalls(content) {
        const list = [];
        if (!content)
            return list;
        // Pattern: CallStoredProcedure("PROC_NAME") / CallStoredFunction("FUNC_NAME")
        const spRegex = /(?:CallStoredProcedure|CallStoredFunction)\s*\(\s*["']([^"']+)["']/gi;
        let m;
        while ((m = spRegex.exec(content)) !== null) {
            const name = m[1].trim();
            if (name) {
                list.push({
                    procName: name,
                    queryType: 'STORED_PROCEDURE',
                    eventHandler: 'DatabaseCall',
                });
            }
        }
        // Pattern: TABLE(DSSK_...) or TABLE(FUNCTION_NAME)
        const tableRegex = /TABLE\s*\(\s*([A-Za-z0-9_]+)\s*\(/gi;
        while ((m = tableRegex.exec(content)) !== null) {
            const fn = m[1].trim();
            if (fn && !list.some((x) => x.procName.toUpperCase() === fn.toUpperCase())) {
                list.push({
                    procName: fn,
                    queryType: 'TABLE_FUNCTION',
                    eventHandler: 'TableFunction',
                });
            }
        }
        // Pattern: DSSK-100-xxxxx / DSSK_100_xxxxx
        const dsskRegex = /["'](DSSK[-_][A-Za-z0-9_-]+)["']/gi;
        while ((m = dsskRegex.exec(content)) !== null) {
            const d = m[1].trim();
            if (d.length >= 8 && !list.some((x) => x.procName.toUpperCase() === d.toUpperCase())) {
                list.push({
                    procName: d,
                    queryType: 'TABLE_FUNCTION',
                    eventHandler: 'ConstantReport',
                    idLaporan: d,
                });
            }
        }
        return list;
    }
    async parseSingleUiPage(uiPath, rootPath) {
        const results = [];
        const relativePath = path_1.default.relative(rootPath, uiPath);
        const pageName = path_1.default.parse(uiPath).name;
        // Determine module & sub_menu
        const parts = relativePath.split(path_1.default.sep);
        let namaMenu = 'General';
        let subMenu = pageName;
        if (parts.length > 2 && parts[0].toLowerCase() === 'pages') {
            namaMenu = parts[1];
            if (parts[1].toLowerCase() === 'siska' && parts.length > 3) {
                namaMenu = 'Siska';
                subMenu = parts[2];
            }
            else {
                subMenu = parts[parts.length - 2] || pageName;
            }
        }
        else if (parts.length > 1) {
            namaMenu = parts[0];
            subMenu = parts[1];
        }
        let uiContent = '';
        try {
            uiContent = await fs_1.default.promises.readFile(uiPath, 'utf8');
        }
        catch { }
        // Extract Page Title
        const titleMatch = /<%@\s*Page[^>]*Title=["']([^"']+)["']/i.exec(uiContent);
        if (titleMatch && titleMatch[1].trim()) {
            subMenu = titleMatch[1].trim();
        }
        // Extract Tabs, Grids, and Filters
        const tabs = this.extractTabs(uiContent);
        const filterControls = this.extractControls(uiContent, ['TextBox', 'DropDownList', 'RadComboBox', 'RadDatePicker', 'RadTextBox', 'CheckBox']);
        const gridControls = this.extractControls(uiContent, ['RadGrid', 'GridView', 'DataGrid', 'ASPxGridView']);
        // Code-behind
        const codeBehindPath = uiPath + '.cs';
        let codeBehindContent = '';
        if (fs_1.default.existsSync(codeBehindPath)) {
            try {
                codeBehindContent = await fs_1.default.promises.readFile(codeBehindPath, 'utf8');
            }
            catch { }
        }
        // Extract IdForm / ID_Laporan from code-behind or ASPX
        let idLaporan = '';
        const idFormMatch = /IdForm\s*=\s*["']([^"']+)["']/i.exec(codeBehindContent);
        if (idFormMatch) {
            idLaporan = idFormMatch[1].trim();
        }
        else {
            const dsskMatch = /["'](DSSK[-_][A-Za-z0-9_-]+)["']/i.exec(codeBehindContent);
            if (dsskMatch)
                idLaporan = dsskMatch[1].trim();
        }
        if (!idLaporan) {
            idLaporan = `DSSK-${pageName.toUpperCase()}`;
        }
        // Extract database calls
        const detectedCalls = this.extractDatabaseCalls(codeBehindContent);
        // Cross-reference with BusinessLogic cache
        for (const [blClass, blCalls] of this.businessLogicCache.entries()) {
            if (codeBehindContent.includes(blClass)) {
                for (const call of blCalls) {
                    if (!detectedCalls.some((x) => x.procName.toUpperCase() === call.procName.toUpperCase())) {
                        detectedCalls.push(call);
                    }
                }
            }
        }
        const defaultGrid = gridControls.length > 0 ? gridControls[0] : 'dgvMain';
        const defaultTab = tabs.length > 0 ? tabs[0] : 'Main';
        if (detectedCalls.length === 0) {
            results.push({
                id: `LN_${pageName}_0`,
                idLaporan,
                idKomponen: defaultGrid,
                namaMenu,
                subMenu,
                formTab: `${pageName} [${defaultTab}]`,
                queryDidalamGrid: `-- Tidak ada pemanggilan query langsung pada ${pageName}.aspx`,
                targetFormName: pageName,
                tabName: defaultTab,
                filterControls,
                gridControls,
                executedProcName: '',
                isSqlFound: false,
            });
        }
        else {
            let idx = 0;
            for (const call of detectedCalls) {
                idx++;
                const currentTab = tabs.length >= idx ? tabs[idx - 1] : defaultTab;
                const currentGrid = gridControls.length >= idx ? gridControls[idx - 1] : defaultGrid;
                let queryContent = '';
                let sqlSourceFile;
                let sqlLineNumber;
                let isSqlFound = false;
                const cleanKey = this.cleanProcKey(call.procName);
                const meta = this.procIndex.get(cleanKey) ||
                    this.procIndex.get(cleanKey.replace(/-/g, '_')) ||
                    this.procIndex.get(cleanKey.replace(/_/g, '-'));
                if (meta) {
                    isSqlFound = true;
                    sqlSourceFile = meta.fileName;
                    sqlLineNumber = meta.startLine;
                    queryContent = await this.getSqlContent(meta);
                }
                else {
                    queryContent = `-- [SQL File Not Found in ALL_Proc]\n-- Object: ${call.procName}\n-- Tidak ditemukan berkas fisik pada repositori ALL_Proc.`;
                }
                results.push({
                    id: `LN_${pageName}_${call.procName.replace(/[^a-zA-Z0-9_]/g, '_')}_${idx}`,
                    idLaporan: call.idLaporan || idLaporan,
                    idKomponen: currentGrid,
                    namaMenu,
                    subMenu,
                    formTab: `${pageName} [${currentTab}]`,
                    queryDidalamGrid: queryContent,
                    targetFormName: pageName,
                    tabName: currentTab,
                    filterControls,
                    gridControls,
                    executedProcName: call.procName,
                    sqlSourceFile,
                    sqlLineNumber,
                    isSqlFound,
                });
            }
        }
        return results;
    }
    extractTabs(content) {
        const tabs = [];
        if (!content)
            return tabs;
        const radTabRegex = /<(?:telerik:RadTab|telerik:RadPageView)[^>]*(?:Text|HeaderText|ID)=["']([^"']+)["']/gi;
        let m;
        while ((m = radTabRegex.exec(content)) !== null) {
            const val = m[1].trim();
            if (!val.startsWith('__'))
                tabs.push(val);
        }
        const aspTabRegex = /<(?:asp:TabPanel|ajaxToolkit:TabPanel)[^>]*HeaderText=["']([^"']+)["']/gi;
        while ((m = aspTabRegex.exec(content)) !== null) {
            tabs.push(m[1].trim());
        }
        return Array.from(new Set(tabs));
    }
    extractControls(content, tagNames) {
        const controls = [];
        if (!content)
            return controls;
        const tagsPattern = tagNames.join('|');
        const regex = new RegExp(`<(?:asp:|telerik:|dx:)?(?:${tagsPattern})[^>]*ID=["']([^"']+)["']`, 'gi');
        let m;
        while ((m = regex.exec(content)) !== null) {
            const id = m[1].trim();
            if (!id.startsWith('__') && !id.startsWith('btn') && !id.includes('ScriptManager')) {
                controls.push(id);
            }
        }
        return Array.from(new Set(controls));
    }
}
exports.MenuLineageService = MenuLineageService;
exports.menuLineageService = new MenuLineageService();
