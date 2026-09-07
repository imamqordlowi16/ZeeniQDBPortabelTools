"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OracleService = void 0;
const oracledb_1 = __importDefault(require("oracledb"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const archiver_1 = __importDefault(require("archiver"));
const unzipper_1 = __importDefault(require("unzipper"));
// Ensure thin mode is explicitly initialized & LOBs auto-converted
try {
    oracledb_1.default.initOracleClient = () => { }; // Thin mode is default in oracledb v6+
    oracledb_1.default.fetchAsString = [oracledb_1.default.CLOB];
    oracledb_1.default.fetchAsBuffer = [oracledb_1.default.BLOB];
    oracledb_1.default.autoCommit = false;
}
catch (e) {
    // Already configured
}
class OracleService {
    activeJobs = new Map();
    getConnectString(config) {
        if (config.connectionType === 'tns' && config.tnsString) {
            return config.tnsString;
        }
        if (config.connectionType === 'sid' && config.sid) {
            return `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${config.host})(PORT=${config.port}))(CONNECT_DATA=(SID=${config.sid})))`;
        }
        const service = config.serviceName || 'orcl';
        return `${config.host}:${config.port}/${service}`;
    }
    async createConnection(config, maxRetries = 3) {
        const connectString = this.getConnectString(config);
        const connAttrs = {
            user: config.user,
            password: config.password || '',
            connectString: connectString,
        };
        if (config.privilege === 'SYSDBA') {
            connAttrs.privilege = oracledb_1.default.SYSDBA;
        }
        else if (config.privilege === 'SYSOPER') {
            connAttrs.privilege = oracledb_1.default.SYSOPER;
        }
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await oracledb_1.default.getConnection(connAttrs);
            }
            catch (err) {
                lastError = err;
                const msg = String(err?.message || err);
                const isTransient = msg.includes('NJS-521') ||
                    msg.includes('NJS-500') ||
                    msg.includes('end-of-file') ||
                    msg.includes('ECONNRESET') ||
                    msg.includes('socket hang up') ||
                    msg.includes('ETIMEDOUT');
                if (isTransient && attempt < maxRetries) {
                    console.warn(`[OracleService] Connection attempt ${attempt}/${maxRetries} to ${connectString} hit transient socket state (${msg}). Retrying in 1200ms...`);
                    await new Promise((resolve) => setTimeout(resolve, 1200));
                    continue;
                }
                if (msg.includes('NJS-530')) {
                    const friendlyErr = new Error(`Host '${config.host}' tidak dapat dijangkau di jaringan Anda (NJS-530). Pastikan nama host/IP benar, VPN (Sangfor) aktif, atau gunakan IP langsung (misal: 10.161.10.135).`);
                    friendlyErr.code = 'NJS-530';
                    throw friendlyErr;
                }
                throw err;
            }
        }
        throw lastError;
    }
    async testConnection(config) {
        const startTime = Date.now();
        let conn = null;
        try {
            conn = await this.createConnection(config);
            const res = await conn.execute(`SELECT banner FROM v$version WHERE ROWNUM = 1`);
            const latencyMs = Date.now() - startTime;
            const banner = res.rows && res.rows.length > 0 ? String(res.rows[0][0]) : 'Oracle Database Connected';
            return {
                success: true,
                version: banner,
                banner: banner,
                latencyMs,
            };
        }
        catch (err) {
            const latencyMs = Date.now() - startTime;
            return {
                success: false,
                latencyMs,
                error: err?.message || String(err),
            };
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch (e) {
                    // ignore
                }
            }
        }
    }
    async getSchemas(config) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            const currentUser = config.user.toUpperCase();
            const list = [];
            // Primary query: discover schemas from all_objects
            try {
                const sql = `
          SELECT 
            o.owner AS schema_name,
            COUNT(CASE WHEN o.object_type = 'TABLE' THEN 1 END) AS table_count,
            COUNT(CASE WHEN o.object_type = 'VIEW' THEN 1 END) AS view_count,
            COUNT(CASE WHEN o.object_type = 'SEQUENCE' THEN 1 END) AS sequence_count,
            COUNT(CASE WHEN o.object_type = 'TRIGGER' THEN 1 END) AS trigger_count,
            COUNT(CASE WHEN o.object_type IN ('PROCEDURE', 'FUNCTION', 'PACKAGE') THEN 1 END) AS proc_count
          FROM all_objects o
          WHERE o.owner NOT IN (
            'ANONYMOUS', 'APEX_PUBLIC_USER', 'APPQOSSYS', 'AUDSYS', 'CTXSYS', 
            'DBSFWUSER', 'DBSNMP', 'DIP', 'DVF', 'DVSYS', 'GGSYS', 'GSMADMIN_INTERNAL', 
            'GSMCATUSER', 'GSMUSER', 'LBACSYS', 'MDDATA', 'MDSYS', 'OJVMSYS', 
            'OLAPSYS', 'ORACLE_OCM', 'ORDDATA', 'ORDPLUGINS', 'ORDSYS', 'OUTLN', 
            'REMOTE_SCHEDULER_AGENT', 'SI_INFORMTN_SCHEMA', 'SPATIAL_CSW_ADMIN_USR', 
            'SYS$UMF', 'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC', 
            'WMSYS', 'XDB', 'XS$NULL'
          )
          AND o.object_type IN ('TABLE', 'VIEW', 'SEQUENCE', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE')
          GROUP BY o.owner
          ORDER BY CASE WHEN o.owner = :currUser THEN 0 ELSE 1 END, o.owner ASC
        `;
                const result = await conn.execute(sql, { currUser: currentUser });
                if (result.rows) {
                    for (const r of result.rows) {
                        list.push({
                            name: r[0],
                            tablesCount: Number(r[1]) || 0,
                            viewsCount: Number(r[2]) || 0,
                            sequencesCount: Number(r[3]) || 0,
                            triggersCount: Number(r[4]) || 0,
                            proceduresCount: Number(r[5]) || 0,
                        });
                    }
                }
            }
            catch (err) {
                console.warn('Could not query all_objects grouped:', err);
            }
            // If current user is not in list, check user_tables
            if (!list.some((s) => s.name === currentUser)) {
                let userTableCount = 0;
                try {
                    const userRes = await conn.execute(`SELECT COUNT(*) FROM user_tables`);
                    if (userRes.rows && userRes.rows.length > 0) {
                        userTableCount = Number(userRes.rows[0][0]) || 0;
                    }
                }
                catch (e) { }
                list.unshift({
                    name: currentUser,
                    tablesCount: userTableCount,
                    viewsCount: 0,
                    sequencesCount: 0,
                    triggersCount: 0,
                    proceduresCount: 0,
                });
            }
            return list;
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
    async getSchemaObjects(config, schemaName) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            const owner = schemaName.toUpperCase();
            const objects = [];
            const sql = `
        SELECT 
          o.object_name,
          o.object_type,
          o.owner,
          t.num_rows,
          o.last_ddl_time
        FROM all_objects o
        LEFT JOIN all_tables t ON o.owner = t.owner AND o.object_name = t.table_name
        WHERE UPPER(o.owner) = :owner
          AND o.object_type IN ('TABLE', 'VIEW', 'SEQUENCE', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE')
          AND o.object_name NOT LIKE 'BIN$%'
        ORDER BY o.object_type ASC, o.object_name ASC
      `;
            try {
                const result = await conn.execute(sql, { owner });
                if (result.rows) {
                    for (const r of result.rows) {
                        const type = r[1];
                        const rowCount = r[3] !== null && r[3] !== undefined ? Number(r[3]) : undefined;
                        objects.push({
                            name: r[0],
                            type: type,
                            owner: r[2],
                            rowCount: rowCount,
                            lastDdlTime: r[4] ? new Date(r[4]).toISOString() : undefined,
                        });
                    }
                }
            }
            catch (err) {
                console.warn('all_objects query failed, trying user_tables fallback:', err);
            }
            // Fallback: If empty and owner is current user, query user_tables directly
            if (objects.length === 0 && owner === config.user.toUpperCase()) {
                try {
                    const userTables = await conn.execute(`SELECT table_name, num_rows FROM user_tables ORDER BY table_name ASC`);
                    if (userTables.rows) {
                        for (const r of userTables.rows) {
                            objects.push({
                                name: r[0],
                                type: 'TABLE',
                                owner: owner,
                                rowCount: r[1] !== null ? Number(r[1]) : undefined,
                            });
                        }
                    }
                }
                catch (e) { }
            }
            return objects;
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
    /**
     * Mengambil metadata seluruh tabel dan kolom dalam satu schema untuk validasi katalog
     */
    async getSchemaTableColumns(config, schemaName) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            const owner = schemaName.toUpperCase();
            const tableColsMap = {};
            const sql = `
        SELECT UPPER(table_name) AS table_name, UPPER(column_name) AS column_name
        FROM all_tab_columns
        WHERE UPPER(owner) = :owner
        ORDER BY table_name ASC, column_id ASC
      `;
            try {
                const result = await conn.execute(sql, { owner });
                if (result.rows) {
                    for (const r of result.rows) {
                        const tbl = String(r[0]);
                        const col = String(r[1]);
                        if (!tableColsMap[tbl]) {
                            tableColsMap[tbl] = [];
                        }
                        tableColsMap[tbl].push(col);
                    }
                }
            }
            catch (err) {
                console.warn('all_tab_columns query failed, trying user_tab_cols fallback:', err);
            }
            // Fallback user_tab_cols if current user
            if (Object.keys(tableColsMap).length === 0 && owner === config.user.toUpperCase()) {
                try {
                    const res = await conn.execute(`SELECT UPPER(table_name) AS table_name, UPPER(column_name) AS column_name
             FROM user_tab_cols
             ORDER BY table_name ASC, column_id ASC`);
                    if (res.rows) {
                        for (const r of res.rows) {
                            const tbl = String(r[0]);
                            const col = String(r[1]);
                            if (!tableColsMap[tbl]) {
                                tableColsMap[tbl] = [];
                            }
                            tableColsMap[tbl].push(col);
                        }
                    }
                }
                catch (e) { }
            }
            return tableColsMap;
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
    async getObjectDDL(config, schemaName, objectType, objectName) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            await conn.execute(`
        BEGIN
          DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', true);
          DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'PRETTY', true);
          DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', false);
          DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', false);
          DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'TABLESPACE', false);
        END;
      `);
            const result = await conn.execute(`SELECT DBMS_METADATA.GET_DDL(:objType, :objName, :objOwner) FROM dual`, [objectType.toUpperCase(), objectName.toUpperCase(), schemaName.toUpperCase()]);
            if (result.rows && result.rows.length > 0) {
                const lob = result.rows[0][0];
                let ddlText = '';
                if (typeof lob === 'string')
                    ddlText = lob;
                else if (lob && typeof lob.getData === 'function') {
                    ddlText = await lob.getData();
                }
                if (ddlText && !ddlText.trim().startsWith('--')) {
                    // Strip hardcoded tablespace references so creation doesn't fail on target database
                    ddlText = ddlText.replace(/TABLESPACE\s+"?[A-Za-z0-9_$#]+"Quote?/gi, '');
                    ddlText = ddlText.replace(/TABLESPACE\s+[A-Za-z0-9_$#]+/gi, '');
                    ddlText = ddlText.replace(/USING\s+INDEX\s+TABLESPACE\s+"?[A-Za-z0-9_$#]+"Quote?/gi, '');
                    ddlText = ddlText.replace(/USING\s+INDEX\s+TABLESPACE\s+[A-Za-z0-9_$#]+/gi, '');
                    return ddlText;
                }
            }
        }
        catch (err) {
            console.warn(`[getObjectDDL] DBMS_METADATA failed for ${objectType} ${schemaName}.${objectName}:`, err.message);
        }
        finally {
            if (conn) {
                try {
                    await conn.close();
                }
                catch (e) { }
            }
        }
        // Fallback: If DBMS_METADATA failed and object is a TABLE, construct clean DDL from column metadata
        if (objectType.toUpperCase() === 'TABLE') {
            try {
                return await this.generateTableDDLFromMetadata(config, schemaName, objectName);
            }
            catch (e) {
                return `-- Error retrieving DDL for ${objectType} ${schemaName}.${objectName}: ${e.message}`;
            }
        }
        return `-- No DDL found for ${objectType} ${schemaName}.${objectName}`;
    }
    /**
     * Fallback DDL generator for tables directly from column metadata
     */
    async generateTableDDLFromMetadata(config, schemaName, tableName) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            const colsRes = await conn.execute(`SELECT column_name, data_type, data_length, data_precision, data_scale, nullable, data_default
         FROM all_tab_columns
         WHERE UPPER(owner) = :owner AND UPPER(table_name) = :tbl
         ORDER BY column_id ASC`, { owner: schemaName.toUpperCase(), tbl: tableName.toUpperCase() });
            if (!colsRes.rows || colsRes.rows.length === 0) {
                return `-- Table ${schemaName}.${tableName} columns not found`;
            }
            const colDefs = [];
            for (const r of colsRes.rows) {
                const colName = String(r[0]);
                const dataType = String(r[1]);
                const dataLength = r[2] ? Number(r[2]) : undefined;
                const dataPrecision = r[3] ? Number(r[3]) : undefined;
                const dataScale = r[4] !== null && r[4] !== undefined ? Number(r[4]) : undefined;
                const nullable = r[5] === 'Y';
                const dataDefault = r[6] ? String(r[6]).trim() : '';
                let typeStr = dataType;
                if (['VARCHAR2', 'NVARCHAR2', 'CHAR', 'RAW'].includes(dataType) && dataLength) {
                    typeStr += `(${dataLength} BYTE)`;
                }
                else if (dataType === 'NUMBER') {
                    if (dataPrecision && dataScale !== undefined) {
                        typeStr += `(${dataPrecision},${dataScale})`;
                    }
                    else if (dataPrecision) {
                        typeStr += `(${dataPrecision})`;
                    }
                }
                let defStr = `  "${colName}" ${typeStr}`;
                if (dataDefault) {
                    defStr += ` DEFAULT ${dataDefault}`;
                }
                if (!nullable) {
                    defStr += ` NOT NULL`;
                }
                colDefs.push(defStr);
            }
            return `CREATE TABLE "${schemaName.toUpperCase()}"."${tableName.toUpperCase()}" (\n${colDefs.join(',\n')}\n);`;
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
    cancelJob(jobId) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.cancel = true;
        }
    }
    async getTableLiveRowCount(config, schemaName, tableName) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            // 1. Try parallel query for high speed on partitioned/large tables
            try {
                const res = await conn.execute(`SELECT /*+ PARALLEL(4) */ COUNT(*) FROM "${schemaName.toUpperCase()}"."${tableName.toUpperCase()}"`);
                if (res.rows && res.rows.length > 0) {
                    return Number(res.rows[0][0]) || 0;
                }
            }
            catch (e1) {
                const res2 = await conn.execute(`SELECT COUNT(*) FROM "${schemaName.toUpperCase()}"."${tableName.toUpperCase()}"`);
                if (res2.rows && res2.rows.length > 0) {
                    return Number(res2.rows[0][0]) || 0;
                }
            }
            return 0;
        }
        catch (err) {
            return 0;
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
    /**
     * Drop Oracle Table with PURGE and optional CASCADE CONSTRAINTS
     */
    async dropTable(config, schemaName, tableName, purge = true, cascade = false) {
        const cleanSchema = schemaName.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        const cleanTable = tableName.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (!cleanTable) {
            throw new Error('Nama tabel tidak boleh kosong.');
        }
        const fullTableName = `"${cleanSchema}"."${cleanTable}"`;
        let conn = null;
        try {
            conn = await this.createConnection(config);
            let sql = `DROP TABLE ${fullTableName}`;
            if (cascade) {
                sql += ` CASCADE CONSTRAINTS`;
            }
            if (purge) {
                sql += ` PURGE`;
            }
            await conn.execute(sql);
            return {
                success: true,
                message: `Tabel ${fullTableName} berhasil dihapus dari database${purge ? ' (PURGE)' : ''}.`,
            };
        }
        catch (err) {
            const errMsg = String(err?.message || err);
            if (!cascade && (errMsg.includes('ORA-02449') || errMsg.includes('foreign key'))) {
                throw new Error(`Gagal menghapus ${fullTableName}: Terdapat Foreign Key dari tabel lain yang merujuk ke tabel ini (ORA-02449). Silakan centang opsi "Hapus Relasi (CASCADE CONSTRAINTS)".`);
            }
            throw new Error(`Gagal menghapus tabel ${fullTableName}: ${errMsg}`);
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
    // ==================== SCHEMA COMPARE ENGINE ====================
    async compareSchemas(sourceConfig, sourceSchema, targetConfig, targetSchema) {
        let sourceConn = null;
        let targetConn = null;
        try {
            // Connect to both source (PRD) and target (DEV) in parallel
            [sourceConn, targetConn] = await Promise.all([
                this.createConnection(sourceConfig),
                this.createConnection(targetConfig),
            ]);
            const srcOwner = sourceSchema.toUpperCase();
            const tgtOwner = targetSchema.toUpperCase();
            // Fetch Objects & Table Columns from both sides with partition & subpartition row aggregations
            const objectsSql = `
        SELECT 
          o.object_name,
          o.object_type,
          GREATEST(
            NVL(t.num_rows, 0),
            NVL(p.partition_total_rows, 0),
            NVL(sp.subpart_total_rows, 0)
          ) AS num_rows
        FROM all_objects o
        LEFT JOIN all_tables t ON o.owner = t.owner AND o.object_name = t.table_name
        LEFT JOIN (
          SELECT table_owner, table_name, SUM(NVL(num_rows, 0)) AS partition_total_rows
          FROM all_tab_partitions
          WHERE UPPER(table_owner) = :owner
          GROUP BY table_owner, table_name
        ) p ON o.owner = p.table_owner AND o.object_name = p.table_name
        LEFT JOIN (
          SELECT table_owner, table_name, SUM(NVL(num_rows, 0)) AS subpart_total_rows
          FROM all_tab_subpartitions
          WHERE UPPER(table_owner) = :owner
          GROUP BY table_owner, table_name
        ) sp ON o.owner = sp.table_owner AND o.object_name = sp.table_name
        WHERE UPPER(o.owner) = :owner
          AND o.object_type IN ('TABLE', 'VIEW', 'SEQUENCE', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE')
          AND o.object_name NOT LIKE 'BIN$%'
        ORDER BY o.object_type ASC, o.object_name ASC
      `;
            const columnsSql = `
        SELECT 
          table_name,
          column_name,
          data_type,
          data_length,
          data_precision,
          data_scale,
          nullable,
          column_id
        FROM all_tab_columns
        WHERE UPPER(owner) = :owner
        ORDER BY table_name ASC, column_id ASC
      `;
            const [srcObjectsRes, tgtObjectsRes, srcColsRes, tgtColsRes] = await Promise.all([
                sourceConn.execute(objectsSql, { owner: srcOwner }),
                targetConn.execute(objectsSql, { owner: tgtOwner }),
                sourceConn.execute(columnsSql, { owner: srcOwner }),
                targetConn.execute(columnsSql, { owner: tgtOwner }),
            ]);
            // Map columns by table name
            const srcColsMap = new Map();
            if (srcColsRes.rows) {
                for (const r of srcColsRes.rows) {
                    const tableName = String(r[0]);
                    if (!srcColsMap.has(tableName))
                        srcColsMap.set(tableName, []);
                    srcColsMap.get(tableName).push({
                        name: String(r[1]),
                        dataType: String(r[2]),
                        dataLength: r[3] ? Number(r[3]) : undefined,
                        dataPrecision: r[4] ? Number(r[4]) : undefined,
                        dataScale: r[5] ? Number(r[5]) : undefined,
                        nullable: r[6] === 'Y',
                        columnId: Number(r[7]) || 0,
                    });
                }
            }
            const tgtColsMap = new Map();
            if (tgtColsRes.rows) {
                for (const r of tgtColsRes.rows) {
                    const tableName = String(r[0]);
                    if (!tgtColsMap.has(tableName))
                        tgtColsMap.set(tableName, []);
                    tgtColsMap.get(tableName).push({
                        name: String(r[1]),
                        dataType: String(r[2]),
                        dataLength: r[3] ? Number(r[3]) : undefined,
                        dataPrecision: r[4] ? Number(r[4]) : undefined,
                        dataScale: r[5] ? Number(r[5]) : undefined,
                        nullable: r[6] === 'Y',
                        columnId: Number(r[7]) || 0,
                    });
                }
            }
            // Map objects
            const srcObjectsMap = new Map();
            if (srcObjectsRes.rows) {
                for (const r of srcObjectsRes.rows) {
                    srcObjectsMap.set(`${r[1]}:${r[0]}`, {
                        type: r[1],
                        rowCount: r[2] !== null && r[2] !== undefined ? Number(r[2]) : undefined,
                    });
                }
            }
            const tgtObjectsMap = new Map();
            if (tgtObjectsRes.rows) {
                for (const r of tgtObjectsRes.rows) {
                    tgtObjectsMap.set(`${r[1]}:${r[0]}`, {
                        type: r[1],
                        rowCount: r[2] !== null && r[2] !== undefined ? Number(r[2]) : undefined,
                    });
                }
            }
            // Query Real Live Row Counts for all tables on both Source (PRD) and Target (DEV)
            // Fast Live Row Counts: Query Target DEV in parallel (DEV is local VM, takes < 0.2s)
            const tgtLiveCounts = new Map();
            const allTableNames = new Set();
            for (const [key, obj] of srcObjectsMap.entries()) {
                if (obj.type === 'TABLE')
                    allTableNames.add(key.split(':')[1]);
            }
            for (const [key, obj] of tgtObjectsMap.entries()) {
                if (obj.type === 'TABLE')
                    allTableNames.add(key.split(':')[1]);
            }
            const tgtTableList = Array.from(allTableNames).filter((t) => tgtColsMap.has(t));
            const BATCH_COUNT = 50;
            // Query Target (DEV) live row counts in fast parallel batches (< 0.2s)
            for (let i = 0; i < tgtTableList.length; i += BATCH_COUNT) {
                const batch = tgtTableList.slice(i, i + BATCH_COUNT);
                await Promise.all(batch.map(async (tbl) => {
                    try {
                        const res = await targetConn.execute(`SELECT COUNT(*) FROM "${tgtOwner}"."${tbl}"`);
                        if (res.rows && res.rows.length > 0) {
                            tgtLiveCounts.set(tbl, Number(res.rows[0][0]) || 0);
                        }
                    }
                    catch (e) {
                        tgtLiveCounts.set(tbl, 0);
                    }
                }));
            }
            // Merge all object keys
            const allObjectKeys = new Set([...srcObjectsMap.keys(), ...tgtObjectsMap.keys()]);
            const diffItems = [];
            let newInSourceCount = 0;
            let differentCount = 0;
            let missingInSourceCount = 0;
            let identicalCount = 0;
            for (const key of allObjectKeys) {
                const [objType, objName] = key.split(':');
                const srcObj = srcObjectsMap.get(key);
                const tgtObj = tgtObjectsMap.get(key);
                const columnDiffs = [];
                let missingColumnsCount = 0;
                let diffStatus = 'IDENTICAL';
                if (srcObj && !tgtObj) {
                    // Object exists in Source (PRD) and is missing in Target (DEV) -> NEW_IN_SOURCE
                    diffStatus = 'NEW_IN_SOURCE';
                    newInSourceCount++;
                    const srcCols = srcColsMap.get(objName) || [];
                    for (const col of srcCols) {
                        columnDiffs.push({
                            name: col.name,
                            status: 'MISSING_IN_TARGET',
                            sourceColumn: col,
                        });
                    }
                    missingColumnsCount = srcCols.length;
                }
                else if (!srcObj && tgtObj) {
                    // Object exists in Target (DEV) and is missing in Source (PRD) -> MISSING_IN_SOURCE
                    diffStatus = 'MISSING_IN_SOURCE';
                    missingInSourceCount++;
                    const tgtCols = tgtColsMap.get(objName) || [];
                    for (const col of tgtCols) {
                        columnDiffs.push({
                            name: col.name,
                            status: 'MISSING_IN_SOURCE',
                            targetColumn: col,
                        });
                    }
                }
                else if (srcObj && tgtObj) {
                    // Object exists in both: compare table columns if type is TABLE
                    if (objType === 'TABLE') {
                        const srcCols = srcColsMap.get(objName) || [];
                        const tgtCols = tgtColsMap.get(objName) || [];
                        const srcColMapByName = new Map(srcCols.map((c) => [c.name, c]));
                        const tgtColMapByName = new Map(tgtCols.map((c) => [c.name, c]));
                        const allColNames = new Set([...srcColMapByName.keys(), ...tgtColMapByName.keys()]);
                        let hasColDiff = false;
                        for (const colName of allColNames) {
                            const sc = srcColMapByName.get(colName);
                            const tc = tgtColMapByName.get(colName);
                            if (sc && !tc) {
                                // Column exists in PRD but missing in DEV
                                columnDiffs.push({ name: colName, status: 'MISSING_IN_TARGET', sourceColumn: sc });
                                hasColDiff = true;
                                missingColumnsCount++;
                            }
                            else if (!sc && tc) {
                                // Column exists in DEV but missing in PRD
                                columnDiffs.push({ name: colName, status: 'MISSING_IN_SOURCE', targetColumn: tc });
                                hasColDiff = true;
                            }
                            else if (sc && tc) {
                                const isModified = sc.dataType !== tc.dataType ||
                                    sc.dataLength !== tc.dataLength ||
                                    sc.dataPrecision !== tc.dataPrecision ||
                                    sc.dataScale !== tc.dataScale ||
                                    sc.nullable !== tc.nullable;
                                if (isModified) {
                                    columnDiffs.push({ name: colName, status: 'MODIFIED', sourceColumn: sc, targetColumn: tc });
                                    hasColDiff = true;
                                }
                                else {
                                    columnDiffs.push({ name: colName, status: 'MATCH', sourceColumn: sc, targetColumn: tc });
                                }
                            }
                        }
                        if (hasColDiff) {
                            diffStatus = 'DIFFERENT';
                            differentCount++;
                        }
                        else {
                            diffStatus = 'IDENTICAL';
                            identicalCount++;
                        }
                    }
                    else {
                        // For other objects (View, Trigger, Procedure), identical unless DDL differs
                        diffStatus = 'IDENTICAL';
                        identicalCount++;
                    }
                }
                const liveTgtCount = objType === 'TABLE' ? tgtLiveCounts.get(objName) : undefined;
                diffItems.push({
                    id: `${objType}-${objName}`,
                    name: objName,
                    type: objType,
                    status: diffStatus,
                    sourceOwner: srcOwner,
                    targetOwner: tgtOwner,
                    sourceRowCount: srcObj?.rowCount,
                    targetRowCount: liveTgtCount !== undefined ? liveTgtCount : tgtObj?.rowCount,
                    columnDiffs,
                    missingColumnsCount,
                });
            }
            // Sort items: NEW_IN_SOURCE first, then DIFFERENT, then MISSING_IN_SOURCE, then IDENTICAL
            const statusOrder = {
                NEW_IN_SOURCE: 0,
                DIFFERENT: 1,
                MISSING_IN_SOURCE: 2,
                IDENTICAL: 3,
            };
            diffItems.sort((a, b) => {
                if (statusOrder[a.status] !== statusOrder[b.status]) {
                    return statusOrder[a.status] - statusOrder[b.status];
                }
                return a.name.localeCompare(b.name);
            });
            return {
                sourceConnectionName: sourceConfig.name,
                sourceSchema: srcOwner,
                targetConnectionName: targetConfig.name,
                targetSchema: tgtOwner,
                timestamp: new Date().toISOString(),
                totalObjects: diffItems.length,
                newInSourceCount,
                differentCount,
                missingInSourceCount,
                identicalCount,
                items: diffItems,
            };
        }
        finally {
            if (sourceConn) {
                try {
                    await sourceConn.close();
                }
                catch (e) { }
            }
            if (targetConn) {
                try {
                    await targetConn.close();
                }
                catch (e) { }
            }
        }
    }
    // ==================== MIGRATION SQL GENERATOR ====================
    async generateMigrationSql(sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData) {
        let sourceConn = null;
        try {
            sourceConn = await this.createConnection(sourceConfig);
            const sqlParts = [];
            sqlParts.push(`-- ====================================================================`);
            sqlParts.push(`-- ZeenIQ Oracle Schema Migration Script`);
            sqlParts.push(`-- Source (PRD): ${sourceConfig.name} [Schema: ${sourceSchema}]`);
            sqlParts.push(`-- Target (DEV): ${targetConfig.name} [Schema: ${targetSchema}]`);
            sqlParts.push(`-- Generated: ${new Date().toISOString()}`);
            sqlParts.push(`-- Selected Objects: ${selectedItems.length}`);
            sqlParts.push(`-- ====================================================================\n`);
            sqlParts.push(`SET DEFINE OFF;\n`);
            for (const item of selectedItems) {
                sqlParts.push(`-- --------------------------------------------------------------------`);
                sqlParts.push(`-- OBJECT: ${item.type} ${item.name} (${item.status})`);
                sqlParts.push(`-- --------------------------------------------------------------------`);
                if (item.status === 'NEW_IN_SOURCE') {
                    // Extract full DDL from source and rewrite schema name to targetSchema
                    let ddl = await this.getObjectDDL(sourceConfig, sourceSchema, item.type, item.name);
                    // Remap source schema identifier to target schema identifier
                    ddl = ddl.replace(new RegExp(`"${sourceSchema.toUpperCase()}"\\.`, 'g'), `"${targetSchema.toUpperCase()}".`);
                    ddl = ddl.replace(new RegExp(`\\b${sourceSchema.toUpperCase()}\\.`, 'g'), `${targetSchema.toUpperCase()}.`);
                    sqlParts.push(ddl.trim() + '\n');
                }
                else if (item.status === 'DIFFERENT' && item.type === 'TABLE') {
                    // Generate ALTER TABLE statements for missing columns in target (DEV)
                    const missingColsInTarget = item.columnDiffs.filter((c) => c.status === 'MISSING_IN_TARGET');
                    for (const colDiff of missingColsInTarget) {
                        const col = colDiff.sourceColumn;
                        if (col) {
                            let typeStr = col.dataType;
                            if (['VARCHAR2', 'NVARCHAR2', 'CHAR', 'RAW'].includes(col.dataType) && col.dataLength) {
                                typeStr += `(${col.dataLength} BYTE)`;
                            }
                            else if (col.dataType === 'NUMBER') {
                                if (col.dataPrecision && col.dataScale !== undefined) {
                                    typeStr += `(${col.dataPrecision},${col.dataScale})`;
                                }
                                else if (col.dataPrecision) {
                                    typeStr += `(${col.dataPrecision})`;
                                }
                            }
                            const nullStr = col.nullable ? '' : ' NOT NULL';
                            sqlParts.push(`ALTER TABLE "${targetSchema.toUpperCase()}"."${item.name}" ADD ("${col.name}" ${typeStr}${nullStr});`);
                        }
                    }
                    sqlParts.push('');
                }
                // If includeData is requested and object is a TABLE, extract data rows (for NEW, DIFFERENT, or IDENTICAL tables)
                if (includeData && item.type === 'TABLE') {
                    try {
                        const querySql = `SELECT * FROM "${sourceSchema.toUpperCase()}"."${item.name}"`;
                        const queryRes = await sourceConn.execute(querySql, [], {
                            resultSet: true,
                            outFormat: oracledb_1.default.OUT_FORMAT_OBJECT,
                        });
                        const rs = queryRes.resultSet;
                        if (rs) {
                            const meta = queryRes.metaData || [];
                            const colNames = meta.map((m) => `"${m.name}"`).join(', ');
                            let rowCount = 0;
                            sqlParts.push(`-- Data rows for ${targetSchema}.${item.name}`);
                            while (true) {
                                const rows = await rs.getRows(100);
                                if (!rows || rows.length === 0)
                                    break;
                                for (const row of rows) {
                                    rowCount++;
                                    const valParts = [];
                                    for (const m of meta) {
                                        const val = row[m.name];
                                        if (val === null || val === undefined) {
                                            valParts.push('NULL');
                                        }
                                        else if (typeof val === 'number') {
                                            valParts.push(String(val));
                                        }
                                        else if (val instanceof Date) {
                                            const isoStr = val.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                                            valParts.push(`TO_DATE('${isoStr}', 'YYYY-MM-DD HH24:MI:SS')`);
                                        }
                                        else if (typeof val === 'string') {
                                            valParts.push(`'${val.replace(/'/g, "''")}'`);
                                        }
                                        else {
                                            valParts.push(`'${String(val).replace(/'/g, "''")}'`);
                                        }
                                    }
                                    sqlParts.push(`INSERT INTO "${targetSchema.toUpperCase()}"."${item.name}" (${colNames}) VALUES (${valParts.join(', ')});`);
                                }
                            }
                            sqlParts.push(`COMMIT;\n`);
                            await rs.close();
                        }
                    }
                    catch (e) {
                        sqlParts.push(`-- Notice: Could not extract data rows for ${item.name}: ${e.message}\n`);
                    }
                }
            }
            sqlParts.push(`-- ====================================================================`);
            sqlParts.push(`-- END OF ZEENIQ MIGRATION SCRIPT`);
            sqlParts.push(`-- ====================================================================`);
            return sqlParts.join('\n');
        }
        finally {
            if (sourceConn) {
                try {
                    await sourceConn.close();
                }
                catch (e) { }
            }
        }
    }
    // ==================== DIRECT SCHEMA SYNC EXECUTOR ====================
    async executeSync(sourceConfig, sourceSchema, targetConfig, targetSchema, options, selectedItems, onLog, onProgress) {
        const jobState = { cancel: false };
        this.activeJobs.set(options.jobId, jobState);
        const startTime = Date.now();
        let targetConn = null;
        const isCancelled = () => jobState.cancel;
        const emitLog = (type, message) => {
            onLog({
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                timestamp: new Date().toLocaleTimeString(),
                type,
                message,
            });
        };
        try {
            emitLog('info', `Initializing Schema Synchronization job: ${options.jobId}`);
            emitLog('info', `Source (PRD): ${sourceConfig.name} [Schema: ${sourceSchema}]`);
            emitLog('info', `Target (DEV): ${targetConfig.name} [Schema: ${targetSchema}]`);
            emitLog('info', `Selected Objects for Sync: ${selectedItems.length}`);
            // Generate Migration Script (DDL structure)
            emitLog('info', `Generating migration statements & DDL for ${selectedItems.length} objects...`);
            const migrationSql = await this.generateMigrationSql(sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, false // structure first
            );
            // Connect to Target (DEV)
            emitLog('info', `Connecting to Target Database ${targetConfig.host}:${targetConfig.port}...`);
            targetConn = await this.createConnection(targetConfig);
            emitLog('success', `Connected to Target as ${targetConfig.user}`);
            // Split DDL statements
            const statements = this.splitSqlStatements(migrationSql, {
                jobId: options.jobId,
                connectionId: targetConfig.id,
                mode: 'sql_script',
                backupFilePath: '',
            });
            const totalStmts = statements.length;
            emitLog('info', `Executing ${totalStmts} structure DDL statements against ${targetSchema}...`);
            let executed = 0;
            let errorCount = 0;
            for (const stmt of statements) {
                if (isCancelled())
                    throw new Error('Sync cancelled by user');
                const trimmed = stmt.trim();
                if (!trimmed || trimmed.startsWith('--'))
                    continue;
                let execSql = trimmed;
                const isPlSql = /^(DECLARE|BEGIN|CREATE\s+OR\s+REPLACE\s+(TRIGGER|PROCEDURE|FUNCTION|PACKAGE))/i.test(execSql);
                if (!isPlSql && execSql.endsWith(';')) {
                    execSql = execSql.substring(0, execSql.length - 1).trim();
                }
                try {
                    await targetConn.execute(execSql);
                    executed++;
                    emitLog('info', `[DDL SUCCESS] ${execSql.substring(0, 80)}...`);
                    onProgress({
                        jobId: options.jobId,
                        status: 'running',
                        percentage: Math.min(80, Math.round((executed / Math.max(1, totalStmts)) * 80)),
                        currentStep: `Executed ${executed}/${totalStmts} structure statements`,
                        processedObjects: executed,
                        totalObjects: totalStmts,
                        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                    });
                }
                catch (err) {
                    errorCount++;
                    const snippet = trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
                    emitLog('warning', `Notice on [${snippet}]: ${err.message}`);
                    // Intelligent DDL Recovery: Strip schema prefix & tablespace if privileges / missing tablespace error
                    if (err.message.includes('ORA-01918') ||
                        err.message.includes('ORA-01031') ||
                        err.message.includes('ORA-00959') ||
                        err.message.includes('ORA-00942')) {
                        try {
                            let fallbackSql = execSql.replace(new RegExp(`"${targetSchema.toUpperCase()}"\\.`, 'g'), '');
                            fallbackSql = fallbackSql.replace(new RegExp(`\\b${targetSchema.toUpperCase()}\\.`, 'g'), '');
                            fallbackSql = fallbackSql.replace(/TABLESPACE\s+"?[A-Za-z0-9_$#]+"Quote?/gi, '');
                            fallbackSql = fallbackSql.replace(/TABLESPACE\s+[A-Za-z0-9_$#]+/gi, '');
                            await targetConn.execute(fallbackSql);
                            executed++;
                            emitLog('success', `[RECOVERED] DDL executed in target default schema/tablespace without prefix!`);
                        }
                        catch (err2) {
                            emitLog('error', `Fallback DDL failed: ${err2.message}`);
                        }
                    }
                }
            }
            await targetConn.commit();
            // ==================== DATA ROWS SYNCHRONIZATION ====================
            if (options.includeData) {
                let sourceConn = null;
                try {
                    emitLog('info', `Include Data Rows is enabled. Connecting to PRD to stream table data...`);
                    sourceConn = await this.createConnection(sourceConfig);
                    for (const item of selectedItems) {
                        if (item.type === 'TABLE') {
                            let rs = null;
                            try {
                                emitLog('info', `[DATA STREAM] Preparing table data stream for ${item.name}...`);
                                // Verify if table exists in target DB, if not, auto-create structure first
                                try {
                                    await targetConn.execute(`SELECT 1 FROM "${targetSchema.toUpperCase()}"."${item.name}" WHERE ROWNUM = 1`);
                                }
                                catch (tblCheckErr) {
                                    if (tblCheckErr.message.includes('ORA-00942')) {
                                        emitLog('info', `Table ${item.name} not found in target ${targetSchema}. Auto-generating table structure...`);
                                        const tableDdl = await this.getObjectDDL(sourceConfig, sourceSchema, 'TABLE', item.name);
                                        let cleanDdl = tableDdl.replace(new RegExp(`"${sourceSchema.toUpperCase()}"\\.`, 'g'), `"${targetSchema.toUpperCase()}".`);
                                        cleanDdl = cleanDdl.replace(new RegExp(`\\b${sourceSchema.toUpperCase()}\\.`, 'g'), `${targetSchema.toUpperCase()}.`);
                                        cleanDdl = cleanDdl.replace(/TABLESPACE\s+"?[A-Za-z0-9_$#]+"Quote?/gi, '');
                                        cleanDdl = cleanDdl.replace(/TABLESPACE\s+[A-Za-z0-9_$#]+/gi, '');
                                        if (cleanDdl.endsWith(';'))
                                            cleanDdl = cleanDdl.slice(0, -1).trim();
                                        try {
                                            await targetConn.execute(cleanDdl);
                                            await targetConn.commit();
                                            emitLog('success', `[DDL CREATED] Table ${item.name} created successfully in ${targetSchema}`);
                                        }
                                        catch (createErr) {
                                            // Try without schema prefix
                                            let localDdl = cleanDdl.replace(new RegExp(`"${targetSchema.toUpperCase()}"\\.`, 'g'), '');
                                            await targetConn.execute(localDdl);
                                            await targetConn.commit();
                                            emitLog('success', `[DDL CREATED] Table ${item.name} created locally in default schema`);
                                        }
                                    }
                                }
                                // Detect exact live row count & best schema path in source
                                let querySql = `SELECT * FROM "${sourceSchema.toUpperCase()}"."${item.name}"`;
                                let sourceLiveRows = 0;
                                try {
                                    const countRes = await sourceConn.execute(`SELECT COUNT(*) FROM "${sourceSchema.toUpperCase()}"."${item.name}"`);
                                    if (countRes.rows && countRes.rows.length > 0) {
                                        sourceLiveRows = Number(countRes.rows[0][0]) || 0;
                                    }
                                }
                                catch (eCnt) {
                                    // Fallback without schema prefix
                                    try {
                                        const countRes2 = await sourceConn.execute(`SELECT COUNT(*) FROM "${item.name}"`);
                                        if (countRes2.rows && countRes2.rows.length > 0) {
                                            sourceLiveRows = Number(countRes2.rows[0][0]) || 0;
                                            querySql = `SELECT * FROM "${item.name}"`;
                                        }
                                    }
                                    catch (eCnt2) { }
                                }
                                // Auto-Discovery: If 0 rows in selected schema, scan all user schemas in PRD for the real data
                                if (sourceLiveRows === 0) {
                                    try {
                                        const allOwners = await sourceConn.execute(`SELECT owner FROM all_tables WHERE UPPER(table_name) = :tbl AND owner NOT IN ('SYS', 'SYSTEM', 'MDSYS', 'CTXSYS', 'XDB', 'WMSYS', 'AUDSYS', 'OUTLN', 'DBSNMP', 'APPQOSSYS')`, { tbl: item.name.toUpperCase() });
                                        if (allOwners.rows) {
                                            for (const row of allOwners.rows) {
                                                const candidateOwner = String(row[0]);
                                                if (candidateOwner.toUpperCase() === sourceSchema.toUpperCase())
                                                    continue;
                                                try {
                                                    const candidateCnt = await sourceConn.execute(`SELECT COUNT(*) FROM "${candidateOwner.toUpperCase()}"."${item.name}"`);
                                                    if (candidateCnt.rows && Number(candidateCnt.rows[0][0]) > 0) {
                                                        sourceLiveRows = Number(candidateCnt.rows[0][0]);
                                                        querySql = `SELECT * FROM "${candidateOwner.toUpperCase()}"."${item.name}"`;
                                                        emitLog('info', `🎯 Auto-Detected Data: Found ${sourceLiveRows.toLocaleString()} rows in PRD schema "${candidateOwner}". Streaming from "${candidateOwner}"."${item.name}" to DEV...`);
                                                        break;
                                                    }
                                                }
                                                catch (eCand) { }
                                            }
                                        }
                                    }
                                    catch (findErr) { }
                                }
                                if (sourceLiveRows === 0) {
                                    emitLog('info', `Table ${item.name}: Table is currently empty (0 rows) in all PRD schemas. Structure verified in DEV.`);
                                    continue;
                                }
                                // Non-Destructive High-Speed Stream & Upsert (with optional Max Rows limit)
                                const rowLimit = options.maxRowsPerTable && options.maxRowsPerTable > 0 ? options.maxRowsPerTable : undefined;
                                const targetTotalRows = rowLimit ? Math.min(sourceLiveRows, rowLimit) : sourceLiveRows;
                                emitLog('info', `[TURBO STREAM] Streaming ${targetTotalRows.toLocaleString()} rows ${rowLimit ? `(User Limit: ${rowLimit.toLocaleString()} rows) ` : ''}for ${item.name}...`);
                                const tableStartTime = Date.now();
                                // Fetch rows from source using high-speed streaming ResultSet with large buffer
                                const BATCH_SIZE = 25000;
                                const srcRes = await sourceConn.execute(querySql, [], {
                                    resultSet: true,
                                    fetchArraySize: BATCH_SIZE,
                                    outFormat: oracledb_1.default.OUT_FORMAT_ARRAY,
                                });
                                rs = srcRes.resultSet || null;
                                const meta = srcRes.metaData || [];
                                if (rs) {
                                    const colNames = meta.map((m) => `"${m.name}"`).join(', ');
                                    const placeholders = meta.map((_, idx) => `:${idx + 1}`).join(', ');
                                    const insertSql = `INSERT INTO "${targetSchema.toUpperCase()}"."${item.name}" (${colNames}) VALUES (${placeholders})`;
                                    const fallbackInsertSql = `INSERT INTO "${item.name}" (${colNames}) VALUES (${placeholders})`;
                                    let totalProcessed = 0;
                                    let totalInserted = 0;
                                    let totalPreserved = 0;
                                    let uncommittedRows = 0;
                                    while (true) {
                                        if (isCancelled()) {
                                            emitLog('warning', `[JOB CANCELLED] Synchronization stopped by user at ${totalProcessed.toLocaleString()} rows.`);
                                            await targetConn.commit();
                                            if (rs) {
                                                try {
                                                    await rs.close();
                                                }
                                                catch (e) { }
                                                rs = null;
                                            }
                                            onProgress({
                                                jobId: options.jobId,
                                                status: 'cancelled',
                                                percentage: Math.round((totalProcessed / Math.max(1, targetTotalRows)) * 100),
                                                currentStep: `Sync Stopped by User (${totalProcessed.toLocaleString()} rows saved).`,
                                                processedObjects: totalProcessed,
                                                elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                                            });
                                            return { success: false, error: 'Synchronization stopped by user.' };
                                        }
                                        // Respect row limit if specified
                                        let fetchChunk = BATCH_SIZE;
                                        if (rowLimit) {
                                            const remaining = rowLimit - totalProcessed;
                                            if (remaining <= 0)
                                                break;
                                            fetchChunk = Math.min(BATCH_SIZE, remaining);
                                        }
                                        const rows = (await rs.getRows(fetchChunk));
                                        if (!rows || rows.length === 0)
                                            break;
                                        let batchErrorsCount = 0;
                                        try {
                                            const res = await targetConn.executeMany(insertSql, rows, {
                                                autoCommit: false,
                                                batchErrors: true, // Non-destructive: safely skips duplicates without throwing error
                                            });
                                            if (res.batchErrors) {
                                                batchErrorsCount = res.batchErrors.length;
                                            }
                                        }
                                        catch (insertErr) {
                                            try {
                                                const fallbackRes = await targetConn.executeMany(fallbackInsertSql, rows, {
                                                    autoCommit: false,
                                                    batchErrors: true,
                                                });
                                                if (fallbackRes.batchErrors) {
                                                    batchErrorsCount = fallbackRes.batchErrors.length;
                                                }
                                            }
                                            catch (insertErr2) {
                                                emitLog('error', `Insert batch error on ${item.name}: ${insertErr2.message}`);
                                                throw insertErr2;
                                            }
                                        }
                                        const insertedInBatch = rows.length - batchErrorsCount;
                                        totalInserted += insertedInBatch;
                                        totalPreserved += batchErrorsCount;
                                        totalProcessed += rows.length;
                                        uncommittedRows += rows.length;
                                        // Commit every 25,000 rows to minimize roundtrips while keeping memory optimal
                                        if (uncommittedRows >= 25000) {
                                            await targetConn.commit();
                                            uncommittedRows = 0;
                                        }
                                        const elapsedTableSec = Math.max(1, Math.floor((Date.now() - tableStartTime) / 1000));
                                        const rowsPerSec = Math.round(totalProcessed / elapsedTableSec);
                                        onProgress({
                                            jobId: options.jobId,
                                            status: 'running',
                                            percentage: 90,
                                            currentStep: `Syncing ${item.name}: ${totalProcessed.toLocaleString()}/${targetTotalRows.toLocaleString()} rows (${rowsPerSec.toLocaleString()} rows/s)...`,
                                            processedObjects: totalProcessed,
                                            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                                        });
                                    }
                                    await targetConn.commit(); // Final commit
                                    await rs.close();
                                    rs = null;
                                    const totalDurationSec = Math.max(1, Math.floor((Date.now() - tableStartTime) / 1000));
                                    const avgSpeed = Math.round(totalProcessed / totalDurationSec);
                                    emitLog('success', `Table ${item.name}: Done in ${totalDurationSec}s (${avgSpeed.toLocaleString()} rows/s). ${totalInserted.toLocaleString()} new row(s) inserted, ${totalPreserved.toLocaleString()} existing row(s) preserved.${rowLimit && totalProcessed >= rowLimit ? ` (Max Limit: ${rowLimit.toLocaleString()} reached)` : ''}`);
                                }
                            }
                            catch (e) {
                                if (rs) {
                                    try {
                                        await rs.close();
                                    }
                                    catch (e2) { }
                                }
                                emitLog('error', `Table ${item.name} Data Copy Notice: ${e.message}`);
                            }
                        }
                    }
                }
                catch (e) {
                    emitLog('error', `Data sync connection notice: ${e.message}`);
                }
                finally {
                    if (sourceConn) {
                        try {
                            await sourceConn.close();
                        }
                        catch (e) { }
                    }
                }
            }
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            if (executed > 0) {
                emitLog('success', `Synchronization completed! Successfully synced ${selectedItems.length} object(s) (${executed} statement(s) executed) in ${elapsed}s.`);
            }
            else {
                emitLog('warning', `Synchronization completed, but 0 structure DDL statements were executed against target database.`);
            }
            onProgress({
                jobId: options.jobId,
                status: 'completed',
                percentage: 100,
                currentStep: 'Sync Completed Successfully',
                processedObjects: executed,
                totalObjects: totalStmts,
                elapsedSeconds: elapsed,
            });
            return { success: true };
        }
        catch (err) {
            const isUserCancel = isCancelled();
            const errorMsg = isUserCancel ? 'Sync cancelled by user' : (err.message || String(err));
            emitLog(isUserCancel ? 'warning' : 'error', errorMsg);
            onProgress({
                jobId: options.jobId,
                status: isUserCancel ? 'cancelled' : 'failed',
                percentage: 0,
                currentStep: isUserCancel ? 'Cancelled' : 'Failed',
                elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                error: errorMsg,
            });
            return { success: false, error: errorMsg };
        }
        finally {
            this.activeJobs.delete(options.jobId);
            if (targetConn) {
                try {
                    await targetConn.close();
                }
                catch (e) { }
            }
        }
    }
    // ==================== SQL BACKUP & RESTORE ====================
    async runSqlBackup(config, options, onLog, onProgress) {
        const jobState = { cancel: false };
        this.activeJobs.set(options.jobId, jobState);
        const startTime = Date.now();
        let conn = null;
        const isCancelled = () => jobState.cancel;
        const emitLog = (type, message) => {
            onLog({
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                timestamp: new Date().toLocaleTimeString(),
                type,
                message,
            });
        };
        try {
            emitLog('info', `Starting Direct SQL/DDL backup for job: ${options.jobId}`);
            emitLog('info', `Target Database: ${config.name} (${config.host}:${config.port})`);
            conn = await this.createConnection(config);
            emitLog('success', `Connected to Oracle as ${config.user}`);
            if (!fs_1.default.existsSync(options.outputDir)) {
                fs_1.default.mkdirSync(options.outputDir, { recursive: true });
            }
            const sqlFileName = `${options.outputFileName}.sql`;
            const sqlFilePath = path_1.default.join(options.outputDir, sqlFileName);
            const writeStream = fs_1.default.createWriteStream(sqlFilePath, { encoding: 'utf-8' });
            // Header comment
            writeStream.write(`-- ====================================================================\n`);
            writeStream.write(`-- ZeenIQ Oracle Database Backup Script\n`);
            writeStream.write(`-- Source: ${config.name} (${config.host}:${config.port})\n`);
            writeStream.write(`-- User: ${config.user}\n`);
            writeStream.write(`-- Scope: ${options.scope.toUpperCase()}\n`);
            writeStream.write(`-- Generated: ${new Date().toISOString()}\n`);
            writeStream.write(`-- ====================================================================\n\n`);
            writeStream.write(`SET DEFINE OFF;\n\n`);
            // Determine schemas
            let targetSchemas = options.targetSchemas || [];
            if (options.scope === 'full' || targetSchemas.length === 0) {
                const schemasList = await this.getSchemas(config);
                targetSchemas = schemasList.map((s) => s.name);
            }
            emitLog('info', `Discovered ${targetSchemas.length} target schema(s) for export...`);
            // Collect all objects
            let allObjects = [];
            for (const schema of targetSchemas) {
                if (isCancelled())
                    throw new Error('Backup cancelled by user');
                const objs = await this.getSchemaObjects(config, schema);
                if (options.scope === 'tables' && options.targetTables && options.targetTables.length > 0) {
                    const tableFilter = new Set(options.targetTables.map((t) => `${t.schema.toUpperCase()}.${t.table.toUpperCase()}`));
                    const filtered = objs.filter((o) => tableFilter.has(`${schema.toUpperCase()}.${o.name.toUpperCase()}`));
                    allObjects.push(...filtered.map((obj) => ({ schema, obj })));
                }
                else {
                    allObjects.push(...objs.map((obj) => ({ schema, obj })));
                }
            }
            const totalObjects = allObjects.length;
            emitLog('info', `Total objects to export: ${totalObjects}`);
            let processedCount = 0;
            let totalRowsExported = 0;
            for (const item of allObjects) {
                if (isCancelled())
                    throw new Error('Backup cancelled by user');
                const { schema, obj } = item;
                emitLog('stdout', `[${processedCount + 1}/${totalObjects}] Exporting ${obj.type}: ${schema}.${obj.name}`);
                // DDL Export
                if (options.includeDdl !== false) {
                    try {
                        const ddl = await this.getObjectDDL(config, schema, obj.type, obj.name);
                        writeStream.write(`-- Structure for ${obj.type} ${schema}.${obj.name}\n`);
                        writeStream.write(ddl.trim() + '\n\n');
                    }
                    catch (e) {
                        emitLog('warning', `Could not extract DDL for ${schema}.${obj.name}: ${e.message}`);
                    }
                }
                // Data Export (if TABLE and includeData is true)
                if (options.includeData !== false && obj.type === 'TABLE') {
                    try {
                        let selectSql = `SELECT * FROM "${schema}"."${obj.name}"`;
                        if (options.rowFilterClause && options.rowFilterClause.trim()) {
                            selectSql += ` WHERE ${options.rowFilterClause.trim()}`;
                        }
                        const queryRes = await conn.execute(selectSql, [], {
                            resultSet: true,
                            outFormat: oracledb_1.default.OUT_FORMAT_OBJECT,
                        });
                        const rs = queryRes.resultSet;
                        if (rs) {
                            const meta = queryRes.metaData || [];
                            const colNames = meta.map((m) => `"${m.name}"`).join(', ');
                            let tableRows = 0;
                            writeStream.write(`-- Data for ${schema}.${obj.name}\n`);
                            while (true) {
                                if (isCancelled()) {
                                    await rs.close();
                                    throw new Error('Backup cancelled by user');
                                }
                                const rows = await rs.getRows(200);
                                if (!rows || rows.length === 0)
                                    break;
                                for (const row of rows) {
                                    tableRows++;
                                    totalRowsExported++;
                                    const valParts = [];
                                    for (const m of meta) {
                                        const val = row[m.name];
                                        if (val === null || val === undefined) {
                                            valParts.push('NULL');
                                        }
                                        else if (typeof val === 'number') {
                                            valParts.push(String(val));
                                        }
                                        else if (val instanceof Date) {
                                            const isoStr = val.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
                                            valParts.push(`TO_DATE('${isoStr}', 'YYYY-MM-DD HH24:MI:SS')`);
                                        }
                                        else if (typeof val === 'string') {
                                            valParts.push(`'${val.replace(/'/g, "''")}'`);
                                        }
                                        else if (Buffer.isBuffer(val)) {
                                            valParts.push(`HEXTORAW('${val.toString('hex')}')`);
                                        }
                                        else {
                                            valParts.push(`'${String(val).replace(/'/g, "''")}'`);
                                        }
                                    }
                                    writeStream.write(`INSERT INTO "${schema}"."${obj.name}" (${colNames}) VALUES (${valParts.join(', ')});\n`);
                                }
                            }
                            writeStream.write(`COMMIT;\n\n`);
                            await rs.close();
                            emitLog('info', `Exported ${tableRows.toLocaleString()} rows for ${schema}.${obj.name}`);
                        }
                    }
                    catch (e) {
                        emitLog('warning', `Could not extract data for ${schema}.${obj.name}: ${e.message}`);
                    }
                }
                processedCount++;
                onProgress({
                    jobId: options.jobId,
                    status: 'running',
                    percentage: Math.round((processedCount / Math.max(1, totalObjects)) * 100),
                    currentStep: `Exported ${obj.name} (${processedCount}/${totalObjects})`,
                    processedObjects: processedCount,
                    totalObjects: totalObjects,
                    processedRows: totalRowsExported,
                    elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                });
            }
            writeStream.write(`-- ====================================================================\n`);
            writeStream.write(`-- End of Backup\n`);
            writeStream.write(`-- ====================================================================\n`);
            writeStream.end();
            await new Promise((resolve) => writeStream.on('finish', () => resolve(true)));
            let finalFilePath = sqlFilePath;
            // Compress to ZIP if requested
            if (options.compressZip) {
                emitLog('info', `Compressing backup into ZIP archive...`);
                const zipFileName = `${options.outputFileName}.zip`;
                const zipFilePath = path_1.default.join(options.outputDir, zipFileName);
                await this.compressFileToZip(sqlFilePath, sqlFileName, zipFilePath);
                // Delete uncompressed .sql
                try {
                    fs_1.default.unlinkSync(sqlFilePath);
                }
                catch (e) { }
                finalFilePath = zipFilePath;
            }
            const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
            const fileSizeMb = (fs_1.default.statSync(finalFilePath).size / (1024 * 1024)).toFixed(2);
            emitLog('success', `Backup completed successfully in ${totalElapsed}s! File: ${path_1.default.basename(finalFilePath)} (${fileSizeMb} MB)`);
            onProgress({
                jobId: options.jobId,
                status: 'completed',
                percentage: 100,
                currentStep: 'Backup Completed Successfully',
                processedObjects: processedCount,
                totalObjects: totalObjects,
                processedRows: totalRowsExported,
                elapsedSeconds: totalElapsed,
                outputFilePath: finalFilePath,
                fileSizeBytes: fs_1.default.statSync(finalFilePath).size,
            });
            return { success: true, filePath: finalFilePath };
        }
        catch (err) {
            const isUserCancel = isCancelled();
            const errorMsg = isUserCancel ? 'Backup cancelled by user' : (err.message || String(err));
            emitLog(isUserCancel ? 'warning' : 'error', errorMsg);
            onProgress({
                jobId: options.jobId,
                status: isUserCancel ? 'cancelled' : 'failed',
                percentage: 0,
                currentStep: isUserCancel ? 'Cancelled' : 'Failed',
                elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                error: errorMsg,
            });
            return { success: false, error: errorMsg };
        }
        finally {
            this.activeJobs.delete(options.jobId);
            if (conn) {
                try {
                    await conn.close();
                }
                catch (e) { }
            }
        }
    }
    async runSqlRestore(config, options, onLog, onProgress) {
        const jobState = { cancel: false };
        this.activeJobs.set(options.jobId, jobState);
        const startTime = Date.now();
        let conn = null;
        const isCancelled = () => jobState.cancel;
        const emitLog = (type, message) => {
            onLog({
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
                timestamp: new Date().toLocaleTimeString(),
                type,
                message,
            });
        };
        try {
            emitLog('info', `Starting Direct SQL restore for job: ${options.jobId}`);
            emitLog('info', `Target Database: ${config.name} (${config.host}:${config.port})`);
            emitLog('info', `Source File: ${options.backupFilePath}`);
            if (!fs_1.default.existsSync(options.backupFilePath)) {
                throw new Error(`Backup file not found: ${options.backupFilePath}`);
            }
            conn = await this.createConnection(config);
            emitLog('success', `Connected to Oracle as ${config.user}`);
            let sqlContent = '';
            if (options.backupFilePath.endsWith('.zip')) {
                emitLog('info', `Extracting ZIP archive in memory...`);
                sqlContent = await this.extractZipInMemory(options.backupFilePath);
            }
            else {
                sqlContent = fs_1.default.readFileSync(options.backupFilePath, 'utf-8');
            }
            // Remap schemas if requested
            if (options.remapSchemaFrom && options.remapSchemaTo) {
                const fromUpper = options.remapSchemaFrom.toUpperCase();
                const toUpper = options.remapSchemaTo.toUpperCase();
                emitLog('info', `Applying Schema Remapping: ${fromUpper} -> ${toUpper}`);
                sqlContent = sqlContent.replace(new RegExp(`"${fromUpper}"\\.`, 'g'), `"${toUpper}".`);
                sqlContent = sqlContent.replace(new RegExp(`\\b${fromUpper}\\.`, 'g'), `${toUpper}.`);
            }
            // Remap tablespaces if requested
            if (options.remapTablespaceFrom && options.remapTablespaceTo) {
                emitLog('info', `Applying Tablespace Remapping: ${options.remapTablespaceFrom} -> ${options.remapTablespaceTo}`);
                sqlContent = sqlContent.replace(new RegExp(`TABLESPACE\\s+"?${options.remapTablespaceFrom}"?`, 'gi'), `TABLESPACE "${options.remapTablespaceTo}"`);
            }
            // Split into statements
            const statements = this.splitSqlStatements(sqlContent, options);
            const totalStmts = statements.length;
            emitLog('info', `Parsed ${totalStmts} SQL statement(s) to execute...`);
            let executed = 0;
            let errorCount = 0;
            for (const stmt of statements) {
                if (isCancelled())
                    throw new Error('Restore cancelled by user');
                const trimmed = stmt.trim();
                if (!trimmed || trimmed.startsWith('--'))
                    continue;
                try {
                    let execSql = trimmed;
                    const isPlSql = /^(DECLARE|BEGIN|CREATE\s+OR\s+REPLACE\s+(TRIGGER|PROCEDURE|FUNCTION|PACKAGE))/i.test(execSql);
                    if (!isPlSql && execSql.endsWith(';')) {
                        execSql = execSql.substring(0, execSql.length - 1).trim();
                    }
                    await conn.execute(execSql);
                    executed++;
                    if (executed % 25 === 0 || executed === totalStmts) {
                        onProgress({
                            jobId: options.jobId,
                            status: 'running',
                            percentage: Math.round((executed / Math.max(1, totalStmts)) * 100),
                            currentStep: `Executed ${executed}/${totalStmts} statements`,
                            processedObjects: executed,
                            totalObjects: totalStmts,
                            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                        });
                    }
                }
                catch (err) {
                    errorCount++;
                    const snippet = trimmed.length > 80 ? trimmed.substring(0, 80) + '...' : trimmed;
                    if (options.ignoreErrors) {
                        emitLog('warning', `Skipped error on [${snippet}]: ${err.message}`);
                    }
                    else {
                        emitLog('error', `Error on [${snippet}]: ${err.message}`);
                        throw err;
                    }
                }
            }
            await conn.commit();
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            emitLog('success', `Restore completed! Successfully executed ${executed} statements with ${errorCount} warning(s) in ${elapsed}s.`);
            onProgress({
                jobId: options.jobId,
                status: 'completed',
                percentage: 100,
                currentStep: 'Restore Completed Successfully',
                processedObjects: executed,
                totalObjects: totalStmts,
                elapsedSeconds: elapsed,
            });
            return { success: true };
        }
        catch (err) {
            const isUserCancel = isCancelled();
            const errorMsg = isUserCancel ? 'Restore cancelled by user' : (err.message || String(err));
            emitLog(isUserCancel ? 'warning' : 'error', errorMsg);
            onProgress({
                jobId: options.jobId,
                status: isUserCancel ? 'cancelled' : 'failed',
                percentage: 0,
                currentStep: isUserCancel ? 'Cancelled' : 'Failed',
                elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                error: errorMsg,
            });
            return { success: false, error: errorMsg };
        }
        finally {
            this.activeJobs.delete(options.jobId);
            if (conn) {
                try {
                    await conn.close();
                }
                catch (e) { }
            }
        }
    }
    // ==================== HELPER METHODS ====================
    splitSqlStatements(content, options) {
        const rawStmts = content.split(/;\s*[\r\n]+/);
        const result = [];
        let buffer = '';
        let inBlock = false;
        for (const piece of rawStmts) {
            const trimmed = piece.trim();
            if (!trimmed)
                continue;
            if (/^(CREATE\s+OR\s+REPLACE\s+(TRIGGER|PROCEDURE|FUNCTION|PACKAGE)|DECLARE|BEGIN)/i.test(trimmed)) {
                inBlock = true;
            }
            if (inBlock) {
                buffer += piece + ';\n';
                if (/END\s*;/i.test(trimmed) || /END\s+[a-zA-Z0-9_]+\s*;/i.test(trimmed) || trimmed.endsWith('/')) {
                    result.push(buffer);
                    buffer = '';
                    inBlock = false;
                }
            }
            else {
                // Table exists action filter
                if (options.tableExistsAction === 'SKIP' && /^\s*CREATE\s+TABLE/i.test(trimmed)) {
                    result.push(trimmed);
                }
                else {
                    result.push(trimmed);
                }
            }
        }
        if (buffer.trim()) {
            result.push(buffer);
        }
        return result;
    }
    async compressFileToZip(sourceFilePath, internalName, destZipPath) {
        return new Promise((resolve, reject) => {
            const output = fs_1.default.createWriteStream(destZipPath);
            const archive = (0, archiver_1.default)('zip', { zlib: { level: 9 } });
            output.on('close', () => resolve());
            archive.on('error', (err) => reject(err));
            archive.pipe(output);
            archive.file(sourceFilePath, { name: internalName });
            archive.finalize();
        });
    }
    async extractZipInMemory(zipPath) {
        const directory = await unzipper_1.default.Open.file(zipPath);
        const sqlFile = directory.files.find((f) => f.path.endsWith('.sql'));
        if (!sqlFile)
            throw new Error('No .sql file found inside ZIP archive');
        const buffer = await sqlFile.buffer();
        return buffer.toString('utf-8');
    }
    // ==================== QUERY & DATA WORKBENCH ====================
    parseQueryStatements(text) {
        const stmts = [];
        let current = '';
        let inString = false;
        let inLineComment = false;
        let inBlockComment = false;
        let isPlsql = false;
        let plsqlDepth = 0;
        const lines = text.split(/\r?\n/);
        for (let lIdx = 0; lIdx < lines.length; lIdx++) {
            const line = lines[lIdx];
            const trimmedLine = line.trim();
            // Check if line is just a slash '/' (SQL*Plus execution delimiter) outside comments/strings
            if (!inString && !inBlockComment && trimmedLine === '/') {
                if (current.trim()) {
                    stmts.push(current.trim());
                }
                current = '';
                isPlsql = false;
                plsqlDepth = 0;
                continue;
            }
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const next = line[i + 1];
                if (!inString && !inLineComment && !inBlockComment) {
                    if (char === "'" && (i === 0 || line[i - 1] !== '\\')) {
                        inString = true;
                        current += char;
                    }
                    else if (char === '-' && next === '-') {
                        inLineComment = true;
                        current += char;
                    }
                    else if (char === '/' && next === '*') {
                        inBlockComment = true;
                        current += char;
                    }
                    else if (char === ';') {
                        if (isPlsql) {
                            current += char;
                            // Check if this semicolon closes an END block
                            const stripped = current.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
                            if (/\bEND(?!\s+(?:IF|LOOP))\b(?:\s+[A-Za-z0-9_$]+)?\s*;\s*$/i.test(stripped)) {
                                if (plsqlDepth > 1) {
                                    plsqlDepth--;
                                }
                                else {
                                    stmts.push(current.trim());
                                    current = '';
                                    isPlsql = false;
                                    plsqlDepth = 0;
                                }
                            }
                        }
                        else {
                            if (current.trim()) {
                                stmts.push(current.trim());
                            }
                            current = '';
                            isPlsql = false;
                            plsqlDepth = 0;
                        }
                    }
                    else {
                        current += char;
                        // Check if current statement enters a PL/SQL construct or nested block
                        if (!isPlsql) {
                            const stripped = current.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
                            if (/^(DECLARE|BEGIN|CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE))\b/i.test(stripped)) {
                                isPlsql = true;
                                plsqlDepth = /^(BEGIN)\b/i.test(stripped) ? 1 : 0;
                            }
                        }
                        else {
                            const stripped = current.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
                            if (/\bBEGIN\b$/i.test(stripped) && !inString) {
                                plsqlDepth++;
                            }
                        }
                    }
                }
                else if (inString) {
                    current += char;
                    if (char === "'") {
                        if (next === "'") {
                            // Escaped quote '' in SQL
                            current += next;
                            i++;
                        }
                        else if (i === 0 || line[i - 1] !== '\\') {
                            inString = false;
                        }
                    }
                }
                else if (inLineComment) {
                    current += char;
                }
                else if (inBlockComment) {
                    current += char;
                    if (char === '*' && next === '/') {
                        current += next;
                        i++;
                        inBlockComment = false;
                    }
                }
            }
            inLineComment = false;
            current += '\n';
            // If in PL/SQL and encountered terminating END; at the end of line
            if (isPlsql) {
                const stripped = current.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
                if (/\bEND(?!\s+(?:IF|LOOP))\b(?:\s+[A-Za-z0-9_$]+)?\s*;\s*$/i.test(stripped) && plsqlDepth <= 1) {
                    stmts.push(current.trim());
                    current = '';
                    isPlsql = false;
                    plsqlDepth = 0;
                }
            }
        }
        if (current.trim()) {
            stmts.push(current.trim());
        }
        return stmts;
    }
    extractStatementTitle(stmt) {
        // 1. Check for comment like "-- FORM: <title>" or "-- Form: <title>"
        const formMatch = stmt.match(/--\s*(?:FORM|Form|form)\s*:\s*([^\r\n]+)/i);
        if (formMatch && formMatch[1].trim()) {
            let title = formMatch[1].trim();
            title = title.replace(/\s*-\s*poslaporanposisikeuangan.*$/i, '');
            return title.slice(0, 50);
        }
        // 2. Check for other comment title line (excluding separator lines)
        const lines = stmt.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('--')) {
                const comment = trimmed.replace(/^--+\s*/, '').trim();
                if (comment &&
                    !comment.startsWith('=') &&
                    !comment.startsWith('-') &&
                    !comment.startsWith('🔍') &&
                    !comment.toLowerCase().startsWith('kolom sesuai') &&
                    !comment.toLowerCase().startsWith('schema validation') &&
                    !comment.toLowerCase().startsWith('total indikator')) {
                    return comment.slice(0, 45);
                }
            }
            else if (trimmed) {
                break;
            }
        }
        // 3. Extract table name from FROM clause: FROM [SCHEMA.]TABLE_NAME
        const fromMatch = stmt.match(/\bFROM\s+([A-Za-z0-9_$."]+)/i);
        if (fromMatch && fromMatch[1]) {
            const parts = fromMatch[1].replace(/["']/g, '').split('.');
            return parts[parts.length - 1];
        }
        // 4. Extract first column alias or DML command
        const dmlMatch = stmt.match(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\s+([A-Za-z0-9_$."]+)/i);
        if (dmlMatch) {
            const cleanTarget = dmlMatch[2].replace(/["']/g, '').split('.').pop();
            return `${dmlMatch[1].toUpperCase()} ${cleanTarget}`;
        }
        // 5. Check for SELECT ... AS <alias>
        const asMatch = stmt.match(/\bAS\s+([A-Za-z0-9_]+)/i);
        if (asMatch && asMatch[1]) {
            return asMatch[1];
        }
        return 'Query';
    }
    async executeQuery(config, sql, maxRows = 1000, targetSchema) {
        const startTime = Date.now();
        let conn = null;
        try {
            conn = await this.createConnection(config);
            // Set session NLS date and timestamp formats to 24-hour clock so date/time functions work seamlessly
            try {
                await conn.execute(`ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'`);
                await conn.execute(`ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF'`);
            }
            catch (nlsErr) { }
            // Determine effective schema and apply ALTER SESSION if needed
            let effectiveSchema = (targetSchema || '').trim().toUpperCase();
            let rawSql = sql;
            // Check for inline ALTER SESSION statement in SQL text and extract it
            const alterMatch = rawSql.match(/ALTER\s+SESSION\s+SET\s+CURRENT_SCHEMA\s*=\s*["']?([A-Za-z0-9_]+)["']?\s*;?/i);
            if (alterMatch) {
                effectiveSchema = alterMatch[1].toUpperCase();
                // Remove ALTER SESSION line from sql text so it doesn't break statement execution
                rawSql = rawSql.replace(/ALTER\s+SESSION\s+SET\s+CURRENT_SCHEMA\s*=\s*["']?[A-Za-z0-9_]+["']?\s*;?\s*/gi, '');
            }
            if (effectiveSchema && effectiveSchema !== (config.user || '').toUpperCase()) {
                try {
                    await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = "${effectiveSchema}"`);
                }
                catch (schemaErr) {
                    console.warn(`[OracleService] Could not switch session schema to ${effectiveSchema}:`, schemaErr?.message);
                }
            }
            // Split statements by semicolon while respecting string literals, comments, and PL/SQL blocks
            const stmts = this.parseQueryStatements(rawSql);
            if (stmts.length === 0) {
                return {
                    success: true,
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    executionTimeMs: Date.now() - startTime,
                };
            }
            const statementResults = [];
            let totalAffectedRows = 0;
            for (const stmt of stmts) {
                let cleanStmt = stmt.trim();
                if (!cleanStmt)
                    continue;
                // Strip leading comments to inspect statement type
                const strippedForDetection = cleanStmt
                    .replace(/--[^\r\n]*/g, '')
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .trim();
                if (!strippedForDetection)
                    continue; // skip pure comment blocks
                // Convert SQL*Plus EXEC / EXECUTE shorthand to PL/SQL block: EXEC my_proc(1); -> BEGIN my_proc(1); END;
                if (/^EXEC(?:UTE)?\s+/i.test(strippedForDetection)) {
                    const callBody = strippedForDetection.replace(/^EXEC(?:UTE)?\s+/i, '').replace(/;+\s*$/, '').trim();
                    cleanStmt = `BEGIN ${callBody}; END;`;
                }
                // Detect if this statement is a PL/SQL construct
                const isPlsql = /^(DECLARE|BEGIN|CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE))\b/i.test(cleanStmt.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim());
                if (isPlsql) {
                    // Oracle PL/SQL blocks require a trailing semicolon
                    cleanStmt = cleanStmt.replace(/\/+\s*$/, '').trim();
                    if (!cleanStmt.endsWith(';'))
                        cleanStmt += ';';
                }
                else {
                    // Regular SQL (SELECT, INSERT, UPDATE, DDL) must NOT have trailing semicolon or slash in node-oracledb
                    cleanStmt = cleanStmt.replace(/;+\s*$/, '').replace(/\/+\s*$/, '').trim();
                }
                const stmtStart = Date.now();
                const title = this.extractStatementTitle(cleanStmt);
                const strippedClean = cleanStmt
                    .replace(/--[^\r\n]*/g, '')
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .trim();
                // Support SELECT, WITH, or queries starting with parentheses e.g. (SELECT ...)
                const isSelect = !isPlsql &&
                    (/^(SELECT|WITH)\s+/i.test(strippedClean) ||
                        (/^\(/i.test(strippedClean) && /\bSELECT\b/i.test(strippedClean)));
                try {
                    if (isSelect) {
                        const result = await conn.execute(cleanStmt, [], {
                            maxRows: maxRows,
                            outFormat: oracledb_1.default.OUT_FORMAT_ARRAY,
                        });
                        const columnMeta = (result.metaData || []).map((m) => {
                            let typeStr = m.dbTypeName || '';
                            if (!typeStr && m.dbType) {
                                typeStr = String(m.dbType);
                            }
                            if (typeStr === 'VARCHAR2' || typeStr === 'CHAR') {
                                if (m.byteSize)
                                    typeStr += `(${m.byteSize})`;
                            }
                            else if (typeStr === 'NUMBER') {
                                if (m.precision) {
                                    typeStr += m.scale ? `(${m.precision},${m.scale})` : `(${m.precision})`;
                                }
                            }
                            return {
                                name: m.name,
                                dataType: typeStr || 'VARCHAR2',
                                nullable: m.nullable,
                                precision: m.precision,
                                scale: m.scale,
                                byteSize: m.byteSize,
                            };
                        });
                        const columns = (result.metaData || []).map((m) => m.name);
                        const rows = (result.rows || []).map((row) => row.map((val, colIdx) => {
                            if (val === null || val === undefined)
                                return null;
                            if (val instanceof Date)
                                return val.toISOString();
                            if (Buffer.isBuffer(val)) {
                                const meta = columnMeta[colIdx];
                                const isRawType = meta?.dataType?.toUpperCase().includes('RAW');
                                if (isRawType || val.length === 16) {
                                    return val.toString('hex').toUpperCase();
                                }
                                return `[BLOB ${val.length} bytes]`;
                            }
                            return String(val);
                        }));
                        statementResults.push({
                            sql: cleanStmt,
                            title,
                            success: true,
                            columns,
                            columnMeta,
                            rows,
                            rowCount: rows.length,
                            executionTimeMs: Date.now() - stmtStart,
                        });
                    }
                    else {
                        const result = await conn.execute(cleanStmt, [], { autoCommit: true });
                        const affected = result.rowsAffected ?? 0;
                        totalAffectedRows += affected;
                        statementResults.push({
                            sql: cleanStmt,
                            title,
                            success: true,
                            columns: [],
                            rows: [],
                            rowCount: 0,
                            affectedRows: affected,
                            executionTimeMs: Date.now() - stmtStart,
                        });
                    }
                }
                catch (stmtErr) {
                    statementResults.push({
                        sql: cleanStmt,
                        title,
                        success: false,
                        columns: [],
                        rows: [],
                        rowCount: 0,
                        executionTimeMs: Date.now() - stmtStart,
                        error: stmtErr?.message || String(stmtErr),
                    });
                }
            }
            if (statementResults.length === 0) {
                return {
                    success: true,
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    executionTimeMs: Date.now() - startTime,
                };
            }
            // Default primary view to the first successful query with rows, or first statement
            const primary = statementResults.find((s) => s.success && s.rows && s.rows.length > 0) || statementResults[0];
            const hasAnySuccess = statementResults.some((s) => s.success);
            return {
                success: hasAnySuccess,
                columns: primary.columns,
                columnMeta: primary.columnMeta,
                rows: primary.rows,
                rowCount: primary.rowCount,
                affectedRows: totalAffectedRows,
                executionTimeMs: Date.now() - startTime,
                error: hasAnySuccess ? undefined : statementResults.find((s) => s.error)?.error,
                statementResults,
            };
        }
        catch (err) {
            return {
                success: false,
                columns: [],
                rows: [],
                rowCount: 0,
                executionTimeMs: Date.now() - startTime,
                error: err?.message || String(err),
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
    async importDataBatch(config, options) {
        let conn = null;
        try {
            conn = await this.createConnection(config);
            const schema = options.schema || config.schema || config.user;
            const targetTable = schema ? `"${schema.toUpperCase()}"."${options.table.toUpperCase()}"` : `"${options.table.toUpperCase()}"`;
            if (options.mode === 'truncate') {
                try {
                    await conn.execute(`TRUNCATE TABLE ${targetTable}`);
                }
                catch (e) {
                    await conn.execute(`DELETE FROM ${targetTable}`);
                    await conn.commit();
                }
            }
            if (!options.rows || options.rows.length === 0) {
                return { success: true, insertedCount: 0 };
            }
            const colList = options.columns.map((c) => `"${c.toUpperCase()}"`).join(', ');
            const bindList = options.columns.map((_, i) => `:${i + 1}`).join(', ');
            const insertSql = `INSERT INTO ${targetTable} (${colList}) VALUES (${bindList})`;
            const batchSize = options.batchSize || 100;
            let inserted = 0;
            for (let i = 0; i < options.rows.length; i += batchSize) {
                const chunk = options.rows.slice(i, i + batchSize);
                const formattedChunk = chunk.map((r) => r.map((val) => {
                    if (val === undefined || val === null || val === '')
                        return null;
                    return val;
                }));
                await conn.executeMany(insertSql, formattedChunk, { autoCommit: false });
                inserted += chunk.length;
            }
            await conn.commit();
            return { success: true, insertedCount: inserted };
        }
        catch (err) {
            if (conn) {
                try {
                    await conn.rollback();
                }
                catch (e) { }
            }
            return { success: false, insertedCount: 0, error: err?.message || String(err) };
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
}
exports.OracleService = OracleService;
