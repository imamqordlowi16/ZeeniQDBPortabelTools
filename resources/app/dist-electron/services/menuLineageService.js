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
exports.menuLineageService = exports.MenuLineageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readline_1 = __importDefault(require("readline"));
const XLSX = __importStar(require("xlsx"));
class MenuLineageService {
    procIndex = new Map();
    businessLogicCache = new Map();
    makroIndex = new Map();
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
        this.makroIndex.clear();
        // 1. Index ALL_Proc if provided
        if (procPath && fs_1.default.existsSync(procPath)) {
            this.sendProgress(win, 'Meng-index repositori SQL di ALL_Proc...');
            await this.indexSqlRepository(procPath, win);
            this.sendProgress(win, 'Mengecek fallback Makro_Komponen Excel...');
            await this.indexMakroExcel(procPath, win);
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
    async indexMakroExcel(procPath, win) {
        try {
            const findExcelFile = (dir) => {
                try {
                    const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                    for (const e of entries) {
                        const full = path_1.default.join(dir, e.name);
                        if (e.isDirectory()) {
                            const nested = findExcelFile(full);
                            if (nested)
                                return nested;
                        }
                        else if (e.isFile()) {
                            const lower = e.name.toLowerCase();
                            if (lower.endsWith('.xlsx') && (lower.includes('makro') || lower.includes('komponen'))) {
                                return full;
                            }
                        }
                    }
                }
                catch { }
                return null;
            };
            const excelPath = findExcelFile(procPath);
            if (!excelPath)
                return;
            const fileName = path_1.default.basename(excelPath);
            this.sendProgress(win, `Membaca fallback query dari Excel: ${fileName}...`);
            const workbook = XLSX.readFile(excelPath, { cellDates: false, cellText: true });
            const sheetName = workbook.SheetNames.find((s) => s.toLowerCase().includes('makro')) || workbook.SheetNames[0];
            if (!sheetName)
                return;
            const sheet = workbook.Sheets[sheetName];
            const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            let loadedCount = 0;
            for (let i = 0; i < rawRows.length; i++) {
                const r = rawRows[i];
                const idLaporan = String(r['ID_LAPORAN'] || r['id_laporan'] || '').trim();
                const selectStatement = String(r['SELECT_STATEMENT'] || r['select_statement'] || '').trim();
                if (!idLaporan || !selectStatement)
                    continue;
                const idKomponen = String(r['ID_KOMPONEN'] || r['id_komponen'] || '').trim();
                const namaKomponen = String(r['NAMA_KOMPONEN1'] || r['NAMA_KOMPONEN2'] || r['NAMA_KOMPONEN3'] || '').trim();
                const meta = {
                    idLaporan,
                    idKomponen,
                    namaKomponen,
                    selectStatement,
                    excelRowNumber: i + 2,
                    fileName,
                    filePath: excelPath,
                };
                const registerKey = (k) => {
                    if (!k)
                        return;
                    const clean = this.cleanProcKey(k);
                    if (!this.makroIndex.has(clean)) {
                        this.makroIndex.set(clean, []);
                    }
                    this.makroIndex.get(clean).push(meta);
                    const dashVariant = clean.replace(/_/g, '-');
                    if (dashVariant !== clean) {
                        if (!this.makroIndex.has(dashVariant))
                            this.makroIndex.set(dashVariant, []);
                        this.makroIndex.get(dashVariant).push(meta);
                    }
                    const underVariant = clean.replace(/-/g, '_');
                    if (underVariant !== clean) {
                        if (!this.makroIndex.has(underVariant))
                            this.makroIndex.set(underVariant, []);
                        this.makroIndex.get(underVariant).push(meta);
                    }
                };
                registerKey(idLaporan);
                if (namaKomponen)
                    registerKey(namaKomponen);
                loadedCount++;
            }
            this.sendProgress(win, `Sukses meng-index ${loadedCount} query komponen dari ${fileName}`);
        }
        catch (e) {
            console.warn('[MenuLineage] Failed to index Makro Excel:', e.message);
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
        // Extract Tabs, Grids, Charts, and Filters
        const tabs = this.extractTabs(uiContent);
        const filterControls = this.extractControls(uiContent, ['TextBox', 'DropDownList', 'RadComboBox', 'RadDatePicker', 'RadTextBox', 'CheckBox']);
        const gridControls = this.extractControls(uiContent, ['RadGrid', 'GridView', 'DataGrid', 'ASPxGridView']);
        const chartControls = this.extractChartControls(uiContent);
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
        const hasGrids = gridControls.length > 0;
        const hasCharts = chartControls.length > 0;
        const defaultGrid = hasGrids ? gridControls[0] : hasCharts ? chartControls[0] : 'dgvMain';
        const defaultTab = tabs.length > 0
            ? tabs[0]
            : subMenu && subMenu !== pageName
                ? `Form ${subMenu}`
                : 'Form Utama';
        if (detectedCalls.length === 0) {
            // Fallback ke Makro_Komponen Excel jika idLaporan atau pageName cocok
            const cleanPage = this.cleanProcKey(pageName);
            const cleanLaporan = this.cleanProcKey(idLaporan);
            const makroList = this.makroIndex.get(cleanLaporan) ||
                this.makroIndex.get(cleanLaporan.replace(/-/g, '_')) ||
                this.makroIndex.get(cleanPage) ||
                this.makroIndex.get(cleanPage.replace(/_/g, '-'));
            if (makroList && makroList.length > 0) {
                for (let mIdx = 0; mIdx < makroList.length; mIdx++) {
                    const m = makroList[mIdx];
                    const tabLabel = tabs.length > 0
                        ? tabs[0]
                        : m.namaKomponen
                            ? `Komponen: ${m.namaKomponen}`
                            : subMenu && subMenu !== pageName
                                ? `Form ${subMenu}`
                                : 'Tabel Makro';
                    results.push({
                        id: `LN_${pageName}_MK_${m.idKomponen}_${mIdx}`,
                        idLaporan: m.idLaporan || idLaporan,
                        idKomponen: m.namaKomponen ? `${m.idKomponen} - ${m.namaKomponen}` : m.idKomponen || defaultGrid,
                        namaMenu,
                        subMenu,
                        formTab: `${pageName} [Tab: ${tabLabel}]`,
                        queryDidalamGrid: m.selectStatement,
                        targetFormName: pageName,
                        tabName: tabLabel,
                        filterControls,
                        gridControls,
                        chartControls,
                        executedProcName: m.namaKomponen ? `[Makro] ${m.namaKomponen}` : `[Makro] ${m.idLaporan}`,
                        sqlSourceFile: m.fileName,
                        sqlLineNumber: m.excelRowNumber,
                        isSqlFound: true,
                    });
                }
            }
            else {
                const tabLabel = tabs.length > 0
                    ? tabs.join(', ')
                    : subMenu && subMenu !== pageName
                        ? `Form ${subMenu}`
                        : 'Form Utama';
                results.push({
                    id: `LN_${pageName}_0`,
                    idLaporan,
                    idKomponen: defaultGrid,
                    namaMenu,
                    subMenu,
                    formTab: `${pageName} [Tab: ${tabLabel}]`,
                    queryDidalamGrid: `-- Tidak ada pemanggilan query langsung pada ${pageName}.aspx`,
                    targetFormName: pageName,
                    tabName: tabLabel,
                    filterControls,
                    gridControls,
                    chartControls,
                    executedProcName: '',
                    isSqlFound: false,
                });
            }
        }
        else {
            let idx = 0;
            for (const call of detectedCalls) {
                idx++;
                const currentTab = call.associatedTab ||
                    (tabs.length >= idx
                        ? tabs[idx - 1]
                        : tabs.length > 0
                            ? tabs[0]
                            : subMenu && subMenu !== pageName
                                ? `Form ${subMenu}`
                                : 'Form Utama');
                const isChartTab = /grafik|chart|diagram/i.test(currentTab);
                let currentComponent = defaultGrid;
                if (isChartTab && hasCharts) {
                    const chartIdx = Math.min(idx - 1, chartControls.length - 1);
                    currentComponent = chartControls[Math.max(0, chartIdx)];
                }
                else if (gridControls.length >= idx) {
                    currentComponent = gridControls[idx - 1];
                }
                else if (hasCharts && idx - gridControls.length > 0 && idx - gridControls.length <= chartControls.length) {
                    currentComponent = chartControls[idx - gridControls.length - 1];
                }
                else {
                    currentComponent = defaultGrid;
                }
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
                    // Fallback: cari ke Makro_Komponen (1)_beautified.xlsx
                    const makroList = this.makroIndex.get(cleanKey) ||
                        this.makroIndex.get(cleanKey.replace(/-/g, '_')) ||
                        this.makroIndex.get(cleanKey.replace(/_/g, '-')) ||
                        (call.idLaporan
                            ? this.makroIndex.get(this.cleanProcKey(call.idLaporan)) ||
                                this.makroIndex.get(this.cleanProcKey(call.idLaporan).replace(/-/g, '_'))
                            : undefined) ||
                        (idLaporan
                            ? this.makroIndex.get(this.cleanProcKey(idLaporan)) ||
                                this.makroIndex.get(this.cleanProcKey(idLaporan).replace(/-/g, '_'))
                            : undefined);
                    if (makroList && makroList.length > 0) {
                        isSqlFound = true;
                        const first = makroList[0];
                        sqlSourceFile = first.fileName;
                        sqlLineNumber = first.excelRowNumber;
                        if (makroList.length === 1) {
                            queryContent = first.selectStatement;
                        }
                        else {
                            queryContent =
                                `-- [Sumber: ${first.fileName} | Total Komponen: ${makroList.length}]\n` +
                                    makroList
                                        .map((m) => `-- [Komponen ${m.idKomponen} - ${m.namaKomponen || '-'}]\n${m.selectStatement}`)
                                        .join('\n\n');
                        }
                    }
                    else {
                        queryContent = `-- [SQL File Not Found in ALL_Proc & Makro Excel]\n-- Object: ${call.procName}\n-- Tidak ditemukan berkas fisik pada repositori ALL_Proc (ALL_Proc.sql, ALL_Package.sql, ALL_Func.sql) maupun Makro_Komponen Excel.`;
                    }
                }
                results.push({
                    id: `LN_${pageName}_${call.procName.replace(/[^a-zA-Z0-9_]/g, '_')}_${idx}`,
                    idLaporan: call.idLaporan || idLaporan,
                    idKomponen: currentComponent,
                    namaMenu,
                    subMenu,
                    formTab: `${pageName} [Tab: ${currentTab}]`,
                    queryDidalamGrid: queryContent,
                    targetFormName: pageName,
                    tabName: currentTab,
                    filterControls,
                    gridControls,
                    chartControls,
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
        const addTab = (raw) => {
            if (!raw)
                return;
            let clean = raw.replace(/^["'>\s]+/, '').replace(/["'<\s]+$/, '').trim();
            if (clean &&
                clean.length > 1 &&
                !clean.startsWith('__') &&
                !clean.includes('<%') &&
                !clean.includes('ClientID') &&
                !tabs.some((t) => t.toLowerCase() === clean.toLowerCase())) {
                tabs.push(clean);
            }
        };
        // 1. clicktab('NAME')
        const clickRegex = /clicktab\(['"]([^'"]+)['"]\)/gi;
        let m;
        while ((m = clickRegex.exec(content)) !== null) {
            addTab(m[1]);
        }
        // 2. RadTab / RadPageView
        const radRegex = /<(?:telerik:)?(?:RadTab|RadPageView)[^>]*(?:Text|HeaderText|ID)=['"]([^'"]+)['"]/gi;
        while ((m = radRegex.exec(content)) !== null) {
            addTab(m[1]);
        }
        // 3. TabPanel (AjaxToolkit / asp:TabPanel)
        const tpRegex = /<(?:asp:|ajaxToolkit:)?TabPanel[^>]*(?:HeaderText|ID)=['"]([^'"]+)['"]/gi;
        while ((m = tpRegex.exec(content)) !== null) {
            addTab(m[1]);
        }
        // 4. DevExpress TabPage / ASPxPageControl
        const dxRegex = /<(?:dx:)?TabPage[^>]*(?:Text|Name)=['"]([^'"]+)['"]/gi;
        while ((m = dxRegex.exec(content)) !== null) {
            addTab(m[1]);
        }
        // 5. Nav tabs links <a ...>Title</a> inside nav-tabs
        const navTabsBlock = /<ul[^>]*class=['"][^'"]*nav-tabs[^'"]*['"][^>]*>([\s\S]*?)<\/ul>/gi;
        while ((m = navTabsBlock.exec(content)) !== null) {
            const aRegex = /<a[^>]*>([^<]+)<\/a>/gi;
            let am;
            while ((am = aRegex.exec(m[1])) !== null) {
                addTab(am[1]);
            }
        }
        // 6. Bootstrap tab-pane id (e.g. lipaneGrafik -> Grafik, lipaneTabel -> Tabel)
        const paneRegex = /<div[^>]*class=['"][^'"]*tab-pane[^'"]*['"][^>]*id=['"]([^'"]+)['"]/gi;
        while ((m = paneRegex.exec(content)) !== null) {
            const cleanId = m[1].replace(/^lipane/i, '').replace(/^pane/i, '').replace(/^tab/i, '').trim();
            addTab(cleanId);
        }
        // 7. asp:View
        const viewRegex = /<asp:View[^>]*ID=['"]([^'"]+)['"]/gi;
        while ((m = viewRegex.exec(content)) !== null) {
            const cleanView = m[1].replace(/^vw/i, '').replace(/^view/i, '').trim();
            addTab(cleanView);
        }
        return tabs;
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
    extractChartControls(content) {
        const controls = [];
        if (!content)
            return controls;
        // 1. Chart tags from ASP.NET, Telerik, DevExpress, AjaxToolkit
        const chartTagNames = [
            'Chart',
            'RadHtmlChart',
            'RadChart',
            'WebChartControl',
            'RadColumnChart',
            'RadPieChart',
            'RadBarChart',
            'RadLineChart',
            'RadAreaChart',
            'RadDonutChart',
            'BarChart',
            'PieChart',
            'LineChart',
        ];
        const tagsPattern = chartTagNames.join('|');
        const regex = new RegExp(`<(?:asp:|telerik:|dx:|ajaxToolkit:)?(?:${tagsPattern})[^>]*ID=["']([^"']+)["']`, 'gi');
        let m;
        while ((m = regex.exec(content)) !== null) {
            const id = m[1].trim();
            if (!id.startsWith('__')) {
                controls.push(id);
            }
        }
        // 2. Highcharts, ChartJS, ApexCharts container divs or canvas (e.g. id="chartContainer", id="chtSales", id="divGrafik")
        const divChartRegex = /<(?:div|canvas|asp:Panel)[^>]*id=["']([^"']*(?:chart|grafik|diagram)[^"']*)["']/gi;
        while ((m = divChartRegex.exec(content)) !== null) {
            const id = m[1].trim();
            if (!id.startsWith('__') && !controls.includes(id)) {
                controls.push(id);
            }
        }
        return Array.from(new Set(controls));
    }
}
exports.MenuLineageService = MenuLineageService;
exports.menuLineageService = new MenuLineageService();
