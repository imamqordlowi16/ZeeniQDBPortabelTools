"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiDbService = void 0;
const sshTunnelService_1 = require("./sshTunnelService");
function getPgClientClass() {
    try {
        return require('pg').Client;
    }
    catch (err) {
        throw new Error("Modul driver PostgreSQL ('pg') belum terpasang di runtime aplikasi.");
    }
}
function getMysqlModule() {
    try {
        return require('mysql2/promise');
    }
    catch (err) {
        throw new Error("Modul driver MySQL ('mysql2') belum terpasang di runtime aplikasi.");
    }
}
function getTediousModule() {
    try {
        return require('tedious');
    }
    catch (err) {
        throw new Error("Modul driver SQL Server ('tedious') belum terpasang di runtime aplikasi.");
    }
}
function getSqliteModule() {
    try {
        return require('node:sqlite');
    }
    catch (err) {
        throw new Error("Modul native SQLite ('node:sqlite') tidak tersedia di runtime ini.");
    }
}
class MultiDbService {
    /**
     * Menghasilkan konfigurasi efektif. Jika SSH Tunnel aktif, membuka local forwarder.
     */
    async resolveEffectiveConfig(config) {
        if (config.sshTunnel && config.sshTunnel.enabled) {
            const tunnel = await sshTunnelService_1.sshTunnelService.createTunnel(config);
            const effectiveConfig = {
                ...config,
                host: '127.0.0.1',
                port: tunnel.localPort,
            };
            return { effectiveConfig, closeTunnel: tunnel.close };
        }
        return { effectiveConfig: config };
    }
    /**
     * Test connection to target database
     */
    async testConnection(config) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        try {
            const dbType = effectiveConfig.dbType || 'oracle';
            if (dbType === 'postgres') {
                return await this.testPostgresConnection(effectiveConfig);
            }
            else if (dbType === 'mysql') {
                return await this.testMySqlConnection(effectiveConfig);
            }
            else if (dbType === 'sqlserver') {
                return await this.testSqlServerConnection(effectiveConfig);
            }
            else if (dbType === 'sqlite') {
                return await this.testSqliteConnection(effectiveConfig);
            }
            return { success: false, message: `Database type '${dbType}' tidak didukung oleh MultiDbService.` };
        }
        finally {
            if (closeTunnel) {
                await closeTunnel().catch(() => { });
            }
        }
    }
    /**
     * Execute query on target database
     */
    async executeQuery(config, sql, maxRows = 0, targetSchema) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        try {
            const dbType = effectiveConfig.dbType || 'oracle';
            if (dbType === 'postgres') {
                return await this.executePostgresQuery(effectiveConfig, sql, maxRows, targetSchema);
            }
            else if (dbType === 'mysql') {
                return await this.executeMySqlQuery(effectiveConfig, sql, maxRows, targetSchema);
            }
            else if (dbType === 'sqlserver') {
                return await this.executeSqlServerQuery(effectiveConfig, sql, maxRows, targetSchema);
            }
            else if (dbType === 'sqlite') {
                return await this.executeSqliteQuery(effectiveConfig, sql, maxRows);
            }
            throw new Error(`Database type '${dbType}' tidak didukung untuk eksekusi SQL.`);
        }
        finally {
            if (closeTunnel) {
                await closeTunnel().catch(() => { });
            }
        }
    }
    /**
     * Get list of schemas / databases
     */
    async getSchemas(config) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        try {
            const dbType = effectiveConfig.dbType || 'oracle';
            if (dbType === 'postgres') {
                return await this.getPostgresSchemas(effectiveConfig);
            }
            else if (dbType === 'mysql') {
                return await this.getMySqlDatabases(effectiveConfig);
            }
            else if (dbType === 'sqlserver') {
                return await this.getSqlServerDatabases(effectiveConfig);
            }
            else if (dbType === 'sqlite') {
                return await this.getSqliteSchemas(effectiveConfig);
            }
            return [];
        }
        finally {
            if (closeTunnel) {
                await closeTunnel().catch(() => { });
            }
        }
    }
    /**
     * Get list of tables / views in a schema
     */
    async getSchemaObjects(config, schemaName) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        try {
            const dbType = effectiveConfig.dbType || 'oracle';
            if (dbType === 'postgres') {
                return await this.getPostgresObjects(effectiveConfig, schemaName);
            }
            else if (dbType === 'mysql') {
                return await this.getMySqlObjects(effectiveConfig, schemaName);
            }
            else if (dbType === 'sqlserver') {
                return await this.getSqlServerObjects(effectiveConfig, schemaName);
            }
            else if (dbType === 'sqlite') {
                return await this.getSqliteObjects(effectiveConfig, schemaName);
            }
            return [];
        }
        finally {
            if (closeTunnel) {
                await closeTunnel().catch(() => { });
            }
        }
    }
    /**
     * Get table columns map for schema
     */
    async getSchemaTableColumns(config, schemaName) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        try {
            const dbType = effectiveConfig.dbType || 'oracle';
            if (dbType === 'postgres') {
                return await this.getPostgresTableColumns(effectiveConfig, schemaName);
            }
            else if (dbType === 'mysql') {
                return await this.getMySqlTableColumns(effectiveConfig, schemaName);
            }
            else if (dbType === 'sqlserver') {
                return await this.getSqlServerTableColumns(effectiveConfig, schemaName);
            }
            else if (dbType === 'sqlite') {
                return await this.getSqliteTableColumns(effectiveConfig, schemaName);
            }
            return {};
        }
        finally {
            if (closeTunnel) {
                await closeTunnel().catch(() => { });
            }
        }
    }
    /**
     * Get live row count
     */
    async getTableLiveRowCount(config, schemaName, tableName) {
        const dbType = config.dbType || 'oracle';
        try {
            if (dbType === 'sqlite') {
                return await this.getSqliteTableRowCount(config, tableName);
            }
            else if (dbType === 'postgres') {
                const client = this.getPgClient(config, schemaName);
                await client.connect();
                try {
                    const res = await client.query(`SELECT count(1) as total FROM "${schemaName}"."${tableName}";`);
                    return Number(res.rows[0]?.total) || 0;
                }
                finally {
                    await client.end().catch(() => { });
                }
            }
            else if (dbType === 'mysql') {
                const conn = await this.getMySqlConnection(config, schemaName);
                try {
                    const [rows] = await conn.query(`SELECT count(1) as total FROM \`${schemaName}\`.\`${tableName}\`;`);
                    return Number(rows[0]?.total) || 0;
                }
                finally {
                    await conn.end().catch(() => { });
                }
            }
            else if (dbType === 'sqlserver') {
                const query = `SELECT count(1) as total FROM [${tableName}];`;
                const res = await this.executeSqlServerQuery(config, query, 1, schemaName);
                return Number(res.rows?.[0]?.[0]) || 0;
            }
        }
        catch (e) {
            return 0;
        }
        return 0;
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // POSTGRESQL IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════════
    getPgClient(config, targetSchema) {
        const PgClientClass = getPgClientClass();
        const database = config.databaseName || config.serviceName || 'postgres';
        const client = new PgClientClass({
            host: config.host,
            port: config.port || 5432,
            database: database,
            user: config.user,
            password: config.password || '',
            statement_timeout: 60000,
        });
        return client;
    }
    async testPostgresConnection(config) {
        const client = this.getPgClient(config);
        try {
            await client.connect();
            const res = await client.query('SELECT version();');
            const version = res.rows[0]?.version || 'PostgreSQL';
            return {
                success: true,
                message: `Koneksi ke PostgreSQL berhasil!\nHost: ${config.host}:${config.port || 5432}\nDatabase: ${config.databaseName || 'postgres'}\n\n${version}`,
                version,
            };
        }
        catch (err) {
            return {
                success: false,
                message: `Gagal koneksi ke PostgreSQL: ${err?.message || err}`,
            };
        }
        finally {
            try {
                await client.end();
            }
            catch (e) { }
        }
    }
    async executePostgresQuery(config, sql, maxRows = 0, targetSchema) {
        const startTime = Date.now();
        const client = this.getPgClient(config, targetSchema);
        try {
            await client.connect();
            if (targetSchema) {
                await client.query(`SET search_path TO "${targetSchema}", public;`);
            }
            const res = await client.query(sql);
            // Extract column metadata
            const columns = [];
            const columnMeta = [];
            if (res.fields) {
                for (const f of res.fields) {
                    columns.push(f.name);
                    columnMeta.push({
                        name: f.name,
                        dataType: String(f.dataTypeID),
                        nullable: true,
                    });
                }
            }
            // Convert rows to 2D array any[][]
            const rows = [];
            const totalAvailable = res.rows.length;
            const limitedRows = maxRows && maxRows > 0 ? res.rows.slice(0, maxRows) : res.rows;
            for (const rowObj of limitedRows) {
                const rowArr = [];
                for (const colName of columns) {
                    rowArr.push(rowObj[colName] ?? null);
                }
                rows.push(rowArr);
            }
            return {
                success: true,
                columns,
                columnMeta,
                rows,
                rowCount: totalAvailable,
                executionTimeMs: Date.now() - startTime,
                statementResults: [
                    {
                        title: 'PostgreSQL Query',
                        sql: sql,
                        columns,
                        columnMeta,
                        rows,
                        rowCount: totalAvailable,
                        executionTimeMs: Date.now() - startTime,
                        success: true,
                    },
                ],
            };
        }
        catch (err) {
            throw new Error(`[PostgreSQL Error] ${err?.message || err}`);
        }
        finally {
            try {
                await client.end();
            }
            catch (e) { }
        }
    }
    async getPostgresSchemas(config) {
        const client = this.getPgClient(config);
        try {
            await client.connect();
            const query = `
        SELECT 
          s.schema_name AS name,
          COALESCE(t.cnt, 0)::int AS "tablesCount",
          COALESCE(v.cnt, 0)::int AS "viewsCount"
        FROM information_schema.schemata s
        LEFT JOIN (
          SELECT table_schema, count(*) as cnt 
          FROM information_schema.tables 
          WHERE table_type = 'BASE TABLE' 
          GROUP BY table_schema
        ) t ON s.schema_name = t.table_schema
        LEFT JOIN (
          SELECT table_schema, count(*) as cnt 
          FROM information_schema.tables 
          WHERE table_type = 'VIEW' 
          GROUP BY table_schema
        ) v ON s.schema_name = v.table_schema
        WHERE s.schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        ORDER BY s.schema_name;
      `;
            const res = await client.query(query);
            return res.rows.map((r) => ({
                name: r.name,
                tablesCount: Number(r.tablesCount || 0),
                viewsCount: Number(r.viewsCount || 0),
                sequencesCount: 0,
                triggersCount: 0,
                proceduresCount: 0,
            }));
        }
        catch (err) {
            return [];
        }
        finally {
            try {
                await client.end();
            }
            catch (e) { }
        }
    }
    async getPostgresObjects(config, schemaName) {
        const client = this.getPgClient(config);
        try {
            await client.connect();
            const query = `
        SELECT 
          table_name AS name,
          CASE WHEN table_type = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS type,
          table_schema AS owner
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name;
      `;
            const res = await client.query(query, [schemaName]);
            return res.rows.map((r) => ({
                name: r.name,
                type: r.type,
                owner: r.owner,
            }));
        }
        catch (err) {
            return [];
        }
        finally {
            try {
                await client.end();
            }
            catch (e) { }
        }
    }
    async getPostgresTableColumns(config, schemaName) {
        const client = this.getPgClient(config, schemaName);
        try {
            await client.connect();
            const res = await client.query(`SELECT table_name, column_name 
         FROM information_schema.columns 
         WHERE table_schema = $1 
         ORDER BY table_name, ordinal_position;`, [schemaName || 'public']);
            const map = {};
            for (const r of res.rows) {
                const tbl = String(r.table_name).toUpperCase();
                const col = String(r.column_name).toUpperCase();
                if (!map[tbl])
                    map[tbl] = [];
                map[tbl].push(col);
            }
            return map;
        }
        catch {
            return {};
        }
        finally {
            await client.end().catch(() => { });
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // MYSQL / MARIADB IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════════════════
    async getMySqlConnection(config, targetDb) {
        const mysqlModule = getMysqlModule();
        const database = targetDb || config.databaseName || config.serviceName || undefined;
        return await mysqlModule.createConnection({
            host: config.host,
            port: config.port || 3306,
            database: database,
            user: config.user,
            password: config.password || '',
            connectTimeout: 10000,
            dateStrings: true,
            multipleStatements: true,
        });
    }
    async testMySqlConnection(config) {
        let conn = null;
        try {
            conn = await this.getMySqlConnection(config);
            const [rows] = await conn.query('SELECT version() AS ver;');
            const version = rows[0]?.ver ? `MySQL / MariaDB ${rows[0].ver}` : 'MySQL Database';
            return {
                success: true,
                message: `Koneksi ke MySQL berhasil!\nHost: ${config.host}:${config.port || 3306}\n${version}`,
                version,
            };
        }
        catch (err) {
            return {
                success: false,
                message: `Gagal koneksi ke MySQL: ${err?.message || err}`,
            };
        }
        finally {
            if (conn) {
                try {
                    await conn.end();
                }
                catch (e) { }
            }
        }
    }
    async executeMySqlQuery(config, sql, maxRows = 0, targetSchema) {
        const startTime = Date.now();
        let conn = null;
        try {
            conn = await this.getMySqlConnection(config, targetSchema);
            if (targetSchema) {
                await conn.query(`USE \`${targetSchema}\`;`);
            }
            const [resRows, fields] = await conn.query(sql);
            const columns = [];
            const columnMeta = [];
            if (fields && Array.isArray(fields)) {
                for (const f of fields) {
                    columns.push(f.name);
                    columnMeta.push({
                        name: f.name,
                        dataType: String(f.type),
                        nullable: true,
                    });
                }
            }
            const rows = [];
            const totalAvailable = Array.isArray(resRows) ? resRows.length : 0;
            const limitedRows = Array.isArray(resRows)
                ? (maxRows && maxRows > 0 ? resRows.slice(0, maxRows) : resRows)
                : [];
            for (const rowObj of limitedRows) {
                const rowArr = [];
                if (columns.length > 0) {
                    for (const colName of columns) {
                        rowArr.push(rowObj[colName] ?? null);
                    }
                }
                else if (typeof rowObj === 'object' && rowObj !== null) {
                    // If fields were empty (e.g. raw object keys)
                    const keys = Object.keys(rowObj);
                    for (const k of keys) {
                        if (!columns.includes(k))
                            columns.push(k);
                        rowArr.push(rowObj[k] ?? null);
                    }
                }
                rows.push(rowArr);
            }
            return {
                success: true,
                columns,
                columnMeta,
                rows,
                rowCount: totalAvailable,
                executionTimeMs: Date.now() - startTime,
                statementResults: [
                    {
                        title: 'MySQL Query',
                        sql: sql,
                        columns,
                        columnMeta,
                        rows,
                        rowCount: totalAvailable,
                        executionTimeMs: Date.now() - startTime,
                        success: true,
                    },
                ],
            };
        }
        catch (err) {
            throw new Error(`[MySQL Error] ${err?.message || err}`);
        }
        finally {
            if (conn) {
                try {
                    await conn.end();
                }
                catch (e) { }
            }
        }
    }
    async getMySqlDatabases(config) {
        let conn = null;
        try {
            conn = await this.getMySqlConnection(config);
            const query = `
        SELECT 
          s.schema_name AS name,
          COALESCE(t.cnt, 0) AS tablesCount,
          COALESCE(v.cnt, 0) AS viewsCount
        FROM information_schema.schemata s
        LEFT JOIN (
          SELECT table_schema, count(*) as cnt 
          FROM information_schema.tables 
          WHERE table_type = 'BASE TABLE' 
          GROUP BY table_schema
        ) t ON s.schema_name = t.table_schema
        LEFT JOIN (
          SELECT table_schema, count(*) as cnt 
          FROM information_schema.tables 
          WHERE table_type = 'VIEW' 
          GROUP BY table_schema
        ) v ON s.schema_name = v.table_schema
        WHERE s.schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
        ORDER BY s.schema_name;
      `;
            const [rows] = await conn.query(query);
            return rows.map((r) => ({
                name: r.name,
                tablesCount: Number(r.tablesCount || 0),
                viewsCount: Number(r.viewsCount || 0),
                sequencesCount: 0,
                triggersCount: 0,
                proceduresCount: 0,
            }));
        }
        catch (err) {
            return [];
        }
        finally {
            if (conn) {
                try {
                    await conn.end();
                }
                catch (e) { }
            }
        }
    }
    async getMySqlObjects(config, dbName) {
        let conn = null;
        try {
            conn = await this.getMySqlConnection(config, dbName);
            const query = `
        SELECT 
          table_name AS name,
          CASE WHEN table_type = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS type,
          table_schema AS owner
        FROM information_schema.tables
        WHERE table_schema = ?
        ORDER BY table_name;
      `;
            const [rows] = await conn.query(query, [dbName]);
            return rows.map((r) => ({
                name: r.name,
                type: r.type,
                owner: r.owner,
            }));
        }
        catch (err) {
            return [];
        }
        finally {
            if (conn) {
                try {
                    await conn.end();
                }
                catch (e) { }
            }
        }
    }
    async getMySqlTableColumns(config, dbName) {
        let conn = null;
        try {
            conn = await this.getMySqlConnection(config, dbName);
            const query = `
        SELECT TABLE_NAME, COLUMN_NAME 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `;
            const [rows] = await conn.query(query, [dbName || config.databaseName]);
            const map = {};
            for (const r of rows) {
                const tbl = String(r.TABLE_NAME || r.table_name).toUpperCase();
                const col = String(r.COLUMN_NAME || r.column_name).toUpperCase();
                if (!map[tbl])
                    map[tbl] = [];
                map[tbl].push(col);
            }
            return map;
        }
        catch {
            return {};
        }
        finally {
            if (conn) {
                try {
                    await conn.end();
                }
                catch (e) { }
            }
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // MICROSOFT SQL SERVER IMPLEMENTATION (via Tedious)
    // ═══════════════════════════════════════════════════════════════════════════
    createTediousConnection(config, targetDb) {
        return new Promise((resolve, reject) => {
            let tedious;
            try {
                tedious = getTediousModule();
            }
            catch (err) {
                return reject(err);
            }
            const database = targetDb || config.databaseName || config.serviceName || 'master';
            let serverHost = config.host?.trim() || 'localhost';
            let instanceName = undefined;
            if (serverHost.includes('\\')) {
                const parts = serverHost.split('\\');
                serverHost = parts[0].trim();
                instanceName = parts[1].trim();
            }
            else if (serverHost.includes('/')) {
                const parts = serverHost.split('/');
                serverHost = parts[0].trim();
                instanceName = parts[1].trim();
            }
            const optionsObj = {
                database: database,
                encrypt: false,
                trustServerCertificate: true,
                connectTimeout: 10000,
                requestTimeout: 60000,
            };
            if (instanceName) {
                optionsObj.instanceName = instanceName;
            }
            else {
                optionsObj.port = Number(config.port) || 1433;
            }
            const tediousConfig = {
                server: serverHost,
                authentication: {
                    type: 'default',
                    options: {
                        userName: config.user,
                        password: config.password || '',
                    },
                },
                options: optionsObj,
            };
            const conn = new tedious.Connection(tediousConfig);
            conn.on('connect', (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(conn);
                }
            });
            conn.on('error', () => {
                // Suppress unhandled error events
            });
            conn.connect();
        });
    }
    async testSqlServerConnection(config) {
        let conn = null;
        try {
            conn = await this.createTediousConnection(config);
            return new Promise((resolve) => {
                const tedious = getTediousModule();
                const req = new tedious.Request('SELECT @@VERSION AS ver;', (err) => {
                    if (err) {
                        resolve({ success: false, message: `Gagal query SQL Server: ${err.message}` });
                    }
                });
                let version = 'Microsoft SQL Server';
                req.on('row', (columns) => {
                    const col = columns.find((c) => c.metadata.colName === 'ver');
                    if (col && col.value) {
                        version = String(col.value);
                    }
                });
                req.on('requestCompleted', () => {
                    resolve({
                        success: true,
                        message: `Koneksi ke Microsoft SQL Server berhasil!\nHost: ${config.host}:${config.port || 1433}\n\n${version.split('\n')[0]}`,
                        version,
                    });
                });
                conn.execSql(req);
            });
        }
        catch (err) {
            return {
                success: false,
                message: `Gagal koneksi ke Microsoft SQL Server: ${err?.message || err}`,
            };
        }
        finally {
            if (conn) {
                try {
                    conn.close();
                }
                catch (e) { }
            }
        }
    }
    async executeSqlServerQuery(config, sql, maxRows = 0, targetSchema) {
        const startTime = Date.now();
        let conn = null;
        try {
            conn = await this.createTediousConnection(config, targetSchema);
            return new Promise((resolve, reject) => {
                const tedious = getTediousModule();
                const columns = [];
                const columnMeta = [];
                const rows = [];
                let totalRows = 0;
                const req = new tedious.Request(sql, (err) => {
                    if (err) {
                        reject(new Error(`[SQL Server Error] ${err.message}`));
                    }
                });
                req.on('columnMetadata', (metaCols) => {
                    const colsArray = Array.isArray(metaCols) ? metaCols : Object.values(metaCols || {});
                    for (const c of colsArray) {
                        if (c?.colName) {
                            columns.push(c.colName);
                            columnMeta.push({
                                name: c.colName,
                                dataType: c.type?.name || 'VARCHAR',
                                nullable: Boolean(c.flags && (c.flags & 0x01)),
                            });
                        }
                    }
                });
                req.on('row', (cols) => {
                    totalRows++;
                    if (!maxRows || maxRows <= 0 || rows.length < maxRows) {
                        const rowArr = cols.map((c) => (c.value !== undefined && c.value !== null ? c.value : null));
                        rows.push(rowArr);
                    }
                });
                req.on('requestCompleted', () => {
                    resolve({
                        success: true,
                        columns,
                        columnMeta,
                        rows,
                        rowCount: totalRows,
                        executionTimeMs: Date.now() - startTime,
                        statementResults: [
                            {
                                title: 'SQL Server Query',
                                sql: sql,
                                columns,
                                columnMeta,
                                rows,
                                rowCount: totalRows,
                                executionTimeMs: Date.now() - startTime,
                                success: true,
                            },
                        ],
                    });
                });
                conn.execSql(req);
            });
        }
        catch (err) {
            throw new Error(`[SQL Server Error] ${err?.message || err}`);
        }
        finally {
            if (conn) {
                try {
                    conn.close();
                }
                catch (e) { }
            }
        }
    }
    async getSqlServerDatabases(config) {
        let conn = null;
        try {
            conn = await this.createTediousConnection(config);
            return new Promise((resolve) => {
                const tedious = getTediousModule();
                const query = `
          SELECT name 
          FROM sys.databases 
          WHERE name NOT IN ('master', 'tempdb', 'model', 'msdb')
          ORDER BY name;
        `;
                const list = [];
                const req = new tedious.Request(query, (err) => {
                    if (err)
                        resolve([]);
                });
                req.on('row', (columns) => {
                    const col = columns.find((c) => c.metadata.colName === 'name');
                    if (col && col.value) {
                        list.push({
                            name: String(col.value),
                            tablesCount: 0,
                            viewsCount: 0,
                            sequencesCount: 0,
                            triggersCount: 0,
                            proceduresCount: 0,
                        });
                    }
                });
                req.on('requestCompleted', () => resolve(list));
                conn.execSql(req);
            });
        }
        catch (e) {
            return [];
        }
        finally {
            if (conn) {
                try {
                    conn.close();
                }
                catch (e) { }
            }
        }
    }
    async getSqlServerObjects(config, dbName) {
        let conn = null;
        try {
            conn = await this.createTediousConnection(config, dbName);
            return new Promise((resolve) => {
                const tedious = getTediousModule();
                const query = `
          SELECT 
            TABLE_NAME AS name, 
            TABLE_SCHEMA AS owner, 
            CASE WHEN TABLE_TYPE = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS type
          FROM INFORMATION_SCHEMA.TABLES
          ORDER BY TABLE_NAME;
        `;
                const list = [];
                const req = new tedious.Request(query, (err) => {
                    if (err)
                        resolve([]);
                });
                req.on('row', (columns) => {
                    const nameCol = columns.find((c) => c.metadata.colName === 'name');
                    const ownerCol = columns.find((c) => c.metadata.colName === 'owner');
                    const typeCol = columns.find((c) => c.metadata.colName === 'type');
                    if (nameCol && nameCol.value) {
                        list.push({
                            name: String(nameCol.value),
                            owner: ownerCol && ownerCol.value ? String(ownerCol.value) : 'dbo',
                            type: typeCol && typeCol.value === 'VIEW' ? 'VIEW' : 'TABLE',
                        });
                    }
                });
                req.on('requestCompleted', () => resolve(list));
                conn.execSql(req);
            });
        }
        catch (e) {
            return [];
        }
        finally {
            if (conn) {
                try {
                    conn.close();
                }
                catch (e) { }
            }
        }
    }
    async getSqlServerTableColumns(config, dbName) {
        let conn = null;
        try {
            conn = await this.createTediousConnection(config, dbName);
            return new Promise((resolve) => {
                const tedious = getTediousModule();
                const query = `
          SELECT TABLE_NAME, COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          ORDER BY TABLE_NAME, ORDINAL_POSITION;
        `;
                const map = {};
                const req = new tedious.Request(query, (err) => {
                    if (err)
                        resolve({});
                });
                req.on('row', (columns) => {
                    const tCol = columns.find((c) => c.metadata.colName === 'TABLE_NAME');
                    const cCol = columns.find((c) => c.metadata.colName === 'COLUMN_NAME');
                    if (tCol?.value && cCol?.value) {
                        const tbl = String(tCol.value).toUpperCase();
                        const col = String(cCol.value).toUpperCase();
                        if (!map[tbl])
                            map[tbl] = [];
                        map[tbl].push(col);
                    }
                });
                req.on('requestCompleted', () => resolve(map));
                conn.execSql(req);
            });
        }
        catch {
            return {};
        }
        finally {
            if (conn) {
                try {
                    conn.close();
                }
                catch (e) { }
            }
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // SQLITE IMPLEMENTATION (Native node:sqlite)
    // ═══════════════════════════════════════════════════════════════════════════
    getSqliteDbPath(config) {
        return (config.host || config.databaseName || '').trim();
    }
    getSqliteDb(config) {
        const { DatabaseSync } = getSqliteModule();
        const dbPath = this.getSqliteDbPath(config);
        if (!dbPath) {
            throw new Error('Path file database SQLite belum ditentukan.');
        }
        const fs = require('fs');
        if (dbPath !== ':memory:' && !fs.existsSync(dbPath)) {
            throw new Error(`File database SQLite tidak ditemukan: ${dbPath}`);
        }
        return new DatabaseSync(dbPath);
    }
    async testSqliteConnection(config) {
        try {
            const db = this.getSqliteDb(config);
            const row = db.prepare('SELECT sqlite_version() AS version').get();
            const version = `SQLite v${row?.version || '3.x'}`;
            db.close();
            return {
                success: true,
                message: `Koneksi ke database SQLite berhasil!\nFile: ${this.getSqliteDbPath(config)}\n${version}`,
                version,
            };
        }
        catch (err) {
            return {
                success: false,
                message: `Gagal membuka database SQLite: ${err?.message || err}`,
            };
        }
    }
    async executeSqliteQuery(config, sql, maxRows = 0) {
        const startTime = Date.now();
        const db = this.getSqliteDb(config);
        try {
            const cleanSql = sql.trim();
            const isSelect = /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(cleanSql);
            if (isSelect) {
                const stmt = db.prepare(cleanSql);
                const allRows = stmt.all();
                const totalAvailable = allRows.length;
                const limitedRows = maxRows && maxRows > 0 ? allRows.slice(0, maxRows) : allRows;
                const columns = limitedRows.length > 0 ? Object.keys(limitedRows[0]) : [];
                const columnMeta = columns.map((col) => ({
                    name: col,
                    dataType: 'TEXT',
                    nullable: true,
                }));
                const rows = limitedRows.map((rowObj) => columns.map((colName) => rowObj[colName] ?? null));
                return {
                    success: true,
                    columns,
                    columnMeta,
                    rows,
                    rowCount: totalAvailable,
                    executionTimeMs: Date.now() - startTime,
                    statementResults: [
                        {
                            sql: cleanSql,
                            success: true,
                            columns,
                            columnMeta,
                            rows,
                            rowCount: totalAvailable,
                            executionTimeMs: Date.now() - startTime,
                        },
                    ],
                };
            }
            else {
                db.exec(cleanSql);
                return {
                    success: true,
                    columns: [],
                    columnMeta: [],
                    rows: [],
                    rowCount: 0,
                    executionTimeMs: Date.now() - startTime,
                    statementResults: [
                        {
                            title: 'SQLite Statement',
                            sql,
                            columns: [],
                            columnMeta: [],
                            rows: [],
                            rowCount: 0,
                            executionTimeMs: Date.now() - startTime,
                            success: true,
                        },
                    ],
                };
            }
        }
        finally {
            try {
                db.close();
            }
            catch (_) { }
        }
    }
    async getSqliteSchemas(config) {
        try {
            const db = this.getSqliteDb(config);
            const tables = db.prepare("SELECT count(1) AS cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
            const views = db.prepare("SELECT count(1) AS cnt FROM sqlite_master WHERE type='view'").all();
            db.close();
            return [
                {
                    name: 'main',
                    tablesCount: tables[0]?.cnt || 0,
                    viewsCount: views[0]?.cnt || 0,
                    sequencesCount: 0,
                    triggersCount: 0,
                    proceduresCount: 0,
                },
            ];
        }
        catch {
            return [{ name: 'main', tablesCount: 0, viewsCount: 0, sequencesCount: 0, triggersCount: 0, proceduresCount: 0 }];
        }
    }
    async getSqliteObjects(config, _schemaName) {
        try {
            const db = this.getSqliteDb(config);
            const rows = db
                .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
                .all();
            db.close();
            return rows.map((r) => ({
                name: r.name,
                type: r.type === 'view' ? 'VIEW' : 'TABLE',
                owner: 'main',
            }));
        }
        catch {
            return [];
        }
    }
    async getSqliteTableColumns(config, _schemaName) {
        try {
            const db = this.getSqliteDb(config);
            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
                .all();
            const map = {};
            for (const t of tables) {
                const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
                map[t.name.toUpperCase()] = cols.map((c) => String(c.name).toUpperCase());
            }
            db.close();
            return map;
        }
        catch {
            return {};
        }
    }
    async getSqliteTableRowCount(config, tableName) {
        try {
            const db = this.getSqliteDb(config);
            const row = db.prepare(`SELECT count(1) AS total FROM "${tableName}"`).get();
            db.close();
            return Number(row?.total) || 0;
        }
        catch {
            return 0;
        }
    }
    /**
     * Mengambil metadata detail seluruh kolom tabel pada schema untuk keperluan schema compare.
     */
    async getDetailedColumns(config, schemaName, oracleService) {
        const dbType = config.dbType || 'oracle';
        if (dbType === 'sqlite') {
            return await this.getSqliteDetailedColumns(config);
        }
        if (dbType === 'postgres') {
            return await this.getPostgresDetailedColumns(config, schemaName);
        }
        if (dbType === 'mysql') {
            return await this.getMysqlDetailedColumns(config, schemaName);
        }
        if (dbType === 'sqlserver') {
            return await this.getSqlServerDetailedColumns(config, schemaName);
        }
        // Default: Oracle
        if (oracleService && typeof oracleService.getDetailedColumns === 'function') {
            return await oracleService.getDetailedColumns(config, schemaName);
        }
        // Fallback: Query all_tab_columns via executeQuery
        const colsSql = `
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
      WHERE UPPER(owner) = UPPER('${schemaName.replace(/'/g, "''")}')
      ORDER BY table_name ASC, column_id ASC
    `;
        const res = await this.executeQuery(config, colsSql, 0);
        const map = new Map();
        for (const r of res.rows) {
            const tbl = String(r[0]).toUpperCase();
            if (!map.has(tbl))
                map.set(tbl, []);
            map.get(tbl).push({
                name: String(r[1]).toUpperCase(),
                dataType: String(r[2] || 'VARCHAR2').toUpperCase(),
                dataLength: r[3] ? Number(r[3]) : undefined,
                dataPrecision: r[4] ? Number(r[4]) : undefined,
                dataScale: r[5] ? Number(r[5]) : undefined,
                nullable: String(r[6]).toUpperCase() === 'Y',
                columnId: Number(r[7]) || 1,
            });
        }
        return map;
    }
    async getPostgresDetailedColumns(config, schemaName) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        const client = this.getPgClient(effectiveConfig);
        try {
            await client.connect();
            const sql = `
        SELECT 
          table_name,
          column_name,
          data_type,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          is_nullable,
          ordinal_position
        FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position
      `;
            const res = await client.query(sql, [schemaName || 'public']);
            const map = new Map();
            for (const r of res.rows) {
                const tbl = String(r.table_name).toUpperCase();
                if (!map.has(tbl))
                    map.set(tbl, []);
                map.get(tbl).push({
                    name: String(r.column_name).toUpperCase(),
                    dataType: String(r.data_type).toUpperCase(),
                    dataLength: r.character_maximum_length ? Number(r.character_maximum_length) : undefined,
                    dataPrecision: r.numeric_precision ? Number(r.numeric_precision) : undefined,
                    dataScale: r.numeric_scale ? Number(r.numeric_scale) : undefined,
                    nullable: String(r.is_nullable).toUpperCase() === 'YES',
                    columnId: Number(r.ordinal_position) || 1,
                });
            }
            return map;
        }
        finally {
            await client.end().catch(() => { });
            if (closeTunnel)
                await closeTunnel();
        }
    }
    async getMysqlDetailedColumns(config, schemaName) {
        const { effectiveConfig, closeTunnel } = await this.resolveEffectiveConfig(config);
        const conn = await this.getMySqlConnection(effectiveConfig);
        try {
            const dbName = schemaName || effectiveConfig.databaseName || 'mysql';
            const [rows] = await conn.query(`SELECT 
           table_name,
           column_name,
           data_type,
           character_maximum_length,
           numeric_precision,
           numeric_scale,
           is_nullable,
           ordinal_position
         FROM information_schema.columns
         WHERE table_schema = ?
         ORDER BY table_name, ordinal_position`, [dbName]);
            const map = new Map();
            for (const r of rows) {
                const tbl = String(r.TABLE_NAME || r.table_name).toUpperCase();
                if (!map.has(tbl))
                    map.set(tbl, []);
                map.get(tbl).push({
                    name: String(r.COLUMN_NAME || r.column_name).toUpperCase(),
                    dataType: String(r.DATA_TYPE || r.data_type).toUpperCase(),
                    dataLength: r.CHARACTER_MAXIMUM_LENGTH || r.character_maximum_length ? Number(r.CHARACTER_MAXIMUM_LENGTH || r.character_maximum_length) : undefined,
                    dataPrecision: r.NUMERIC_PRECISION || r.numeric_precision ? Number(r.NUMERIC_PRECISION || r.numeric_precision) : undefined,
                    dataScale: r.NUMERIC_SCALE || r.numeric_scale ? Number(r.NUMERIC_SCALE || r.numeric_scale) : undefined,
                    nullable: String(r.IS_NULLABLE || r.is_nullable).toUpperCase() === 'YES',
                    columnId: Number(r.ORDINAL_POSITION || r.ordinal_position) || 1,
                });
            }
            return map;
        }
        finally {
            await conn.end().catch(() => { });
            if (closeTunnel)
                await closeTunnel();
        }
    }
    async getSqlServerDetailedColumns(config, schemaName) {
        const sql = `
      SELECT 
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        IS_NULLABLE,
        ORDINAL_POSITION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${(schemaName || 'dbo').replace(/'/g, "''")}'
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `;
        const res = await this.executeSqlServerQuery(config, sql, 0);
        const map = new Map();
        for (const r of res.rows) {
            const tbl = String(r[0]).toUpperCase();
            if (!map.has(tbl))
                map.set(tbl, []);
            map.get(tbl).push({
                name: String(r[1]).toUpperCase(),
                dataType: String(r[2] || 'VARCHAR').toUpperCase(),
                dataLength: r[3] ? Number(r[3]) : undefined,
                dataPrecision: r[4] ? Number(r[4]) : undefined,
                dataScale: r[5] ? Number(r[5]) : undefined,
                nullable: String(r[6]).toUpperCase() === 'YES',
                columnId: Number(r[7]) || 1,
            });
        }
        return map;
    }
    async getSqliteDetailedColumns(config) {
        const db = this.getSqliteDb(config);
        try {
            const tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'")
                .all();
            const map = new Map();
            for (const t of tables) {
                const tbl = String(t.name).toUpperCase();
                const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
                map.set(tbl, cols.map((c) => ({
                    name: String(c.name).toUpperCase(),
                    dataType: String(c.type || 'TEXT').toUpperCase(),
                    nullable: Number(c.notnull) === 0,
                    columnId: Number(c.cid) || 0,
                })));
            }
            return map;
        }
        finally {
            try {
                db.close();
            }
            catch (_) { }
        }
    }
    /**
     * Universal Schema Compare: Membandingkan 2 database dan schema secara cross-engine.
     */
    async compareSchemas(sourceConfig, sourceSchema, targetConfig, targetSchema, oracleService) {
        const srcType = sourceConfig.dbType || 'oracle';
        const tgtType = targetConfig.dbType || 'oracle';
        // Jika kedua database adalah Oracle, gunakan engine OracleService bawaan
        if (srcType === 'oracle' && tgtType === 'oracle' && oracleService && typeof oracleService.compareSchemas === 'function') {
            return await oracleService.compareSchemas(sourceConfig, sourceSchema, targetConfig, targetSchema);
        }
        // Ekstraksi Objek dan Kolom dari kedua belah pihak secara paralel
        const [srcObjects, tgtObjects, srcColsMap, tgtColsMap] = await Promise.all([
            this.getSchemaObjects(sourceConfig, sourceSchema),
            this.getSchemaObjects(targetConfig, targetSchema),
            this.getDetailedColumns(sourceConfig, sourceSchema, oracleService),
            this.getDetailedColumns(targetConfig, targetSchema, oracleService),
        ]);
        const srcObjMap = new Map(srcObjects.map((o) => [o.name.toUpperCase(), o]));
        const tgtObjMap = new Map(tgtObjects.map((o) => [o.name.toUpperCase(), o]));
        const allObjectNames = Array.from(new Set([...srcObjMap.keys(), ...tgtObjMap.keys()])).sort();
        const diffItems = [];
        let newInSourceCount = 0;
        let differentCount = 0;
        let missingInSourceCount = 0;
        let identicalCount = 0;
        for (const objName of allObjectNames) {
            const srcObj = srcObjMap.get(objName);
            const tgtObj = tgtObjMap.get(objName);
            const objType = srcObj?.type || tgtObj?.type || 'TABLE';
            let diffStatus = 'IDENTICAL';
            const columnDiffs = [];
            let missingColumnsCount = 0;
            if (srcObj && !tgtObj) {
                diffStatus = 'NEW_IN_SOURCE';
                newInSourceCount++;
                const srcCols = srcColsMap.get(objName) || [];
                for (const col of srcCols) {
                    columnDiffs.push({
                        name: col.name,
                        status: 'MISSING_IN_TARGET',
                        sourceColumn: col,
                    });
                    missingColumnsCount++;
                }
            }
            else if (!srcObj && tgtObj) {
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
                if (objType === 'TABLE') {
                    const srcCols = srcColsMap.get(objName) || [];
                    const tgtCols = tgtColsMap.get(objName) || [];
                    const srcColMap = new Map(srcCols.map((c) => [c.name.toUpperCase(), c]));
                    const tgtColMap = new Map(tgtCols.map((c) => [c.name.toUpperCase(), c]));
                    const allCols = Array.from(new Set([...srcColMap.keys(), ...tgtColMap.keys()])).sort();
                    let hasColDiff = false;
                    for (const colName of allCols) {
                        const sc = srcColMap.get(colName);
                        const tc = tgtColMap.get(colName);
                        if (sc && !tc) {
                            columnDiffs.push({ name: colName, status: 'MISSING_IN_TARGET', sourceColumn: sc });
                            hasColDiff = true;
                            missingColumnsCount++;
                        }
                        else if (!sc && tc) {
                            columnDiffs.push({ name: colName, status: 'MISSING_IN_SOURCE', targetColumn: tc });
                            hasColDiff = true;
                        }
                        else if (sc && tc) {
                            const typeMatch = sc.dataType === tc.dataType || sc.dataType.includes(tc.dataType) || tc.dataType.includes(sc.dataType);
                            const isModified = !typeMatch || sc.nullable !== tc.nullable;
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
                    diffStatus = 'IDENTICAL';
                    identicalCount++;
                }
            }
            diffItems.push({
                id: `${objType}-${objName}`,
                name: objName,
                type: objType,
                status: diffStatus,
                sourceOwner: sourceSchema,
                targetOwner: targetSchema,
                sourceRowCount: srcObj?.rowCount,
                targetRowCount: tgtObj?.rowCount,
                columnDiffs,
                missingColumnsCount,
            });
        }
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
            sourceSchema,
            targetConnectionName: targetConfig.name,
            targetSchema,
            timestamp: new Date().toISOString(),
            totalObjects: diffItems.length,
            newInSourceCount,
            differentCount,
            missingInSourceCount,
            identicalCount,
            items: diffItems,
        };
    }
    /**
     * Universal Migration SQL Generator: Menghasilkan DDL/DML sinkronisasi yang disesuaikan dengan engine target.
     */
    async generateMigrationSql(sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData, oracleService) {
        const tgtType = targetConfig.dbType || 'oracle';
        if (tgtType === 'oracle' && oracleService && typeof oracleService.generateMigrationSql === 'function') {
            return await oracleService.generateMigrationSql(sourceConfig, sourceSchema, targetConfig, targetSchema, selectedItems, includeData);
        }
        const sqlParts = [];
        sqlParts.push(`-- ====================================================================`);
        sqlParts.push(`-- ZeenIQ Multi-Database Schema Migration Script`);
        sqlParts.push(`-- Source: ${sourceConfig.name} (${(sourceConfig.dbType || 'oracle').toUpperCase()}) [Schema: ${sourceSchema}]`);
        sqlParts.push(`-- Target: ${targetConfig.name} (${tgtType.toUpperCase()}) [Schema: ${targetSchema}]`);
        sqlParts.push(`-- Dihasilkan pada: ${new Date().toLocaleString()}`);
        sqlParts.push(`-- Total Objek Terpilih: ${selectedItems.length}`);
        sqlParts.push(`-- ====================================================================\n`);
        const quoteId = (name) => {
            if (tgtType === 'mysql')
                return `\`${name}\``;
            if (tgtType === 'sqlserver')
                return `[${name}]`;
            return `"${name}"`;
        };
        const normalizeType = (dt, len, prec, scale) => {
            const upper = dt.toUpperCase();
            if (upper.includes('VARCHAR') || upper.includes('CHAR')) {
                return len && len > 0 && len < 4000 ? `VARCHAR(${len})` : tgtType === 'postgres' ? 'TEXT' : 'VARCHAR(255)';
            }
            if (upper.includes('INT') || upper.includes('NUMBER')) {
                if (scale && scale > 0)
                    return `DECIMAL(${prec || 15}, ${scale})`;
                if (prec && prec > 9)
                    return 'BIGINT';
                return 'INTEGER';
            }
            if (upper.includes('TEXT') || upper.includes('CLOB'))
                return tgtType === 'oracle' ? 'CLOB' : 'TEXT';
            if (upper.includes('DATE') || upper.includes('TIME'))
                return 'TIMESTAMP';
            if (upper.includes('BOOL'))
                return tgtType === 'oracle' ? 'NUMBER(1)' : 'BOOLEAN';
            return upper;
        };
        for (const item of selectedItems) {
            if (item.status === 'NEW_IN_SOURCE' && item.type === 'TABLE') {
                sqlParts.push(`-- [+] Buat Tabel Baru: ${item.name}`);
                const colDefs = [];
                for (const cd of item.columnDiffs) {
                    const col = cd.sourceColumn;
                    if (!col)
                        continue;
                    const typeStr = normalizeType(col.dataType, col.dataLength, col.dataPrecision, col.dataScale);
                    const nullStr = col.nullable ? '' : ' NOT NULL';
                    colDefs.push(`  ${quoteId(col.name)} ${typeStr}${nullStr}`);
                }
                if (colDefs.length > 0) {
                    sqlParts.push(`CREATE TABLE ${quoteId(item.name)} (\n${colDefs.join(',\n')}\n);`);
                }
                else {
                    sqlParts.push(`CREATE TABLE ${quoteId(item.name)} (\n  id INTEGER PRIMARY KEY\n);`);
                }
                sqlParts.push('');
            }
            else if (item.status === 'DIFFERENT' && item.type === 'TABLE') {
                const missingCols = item.columnDiffs.filter((cd) => cd.status === 'MISSING_IN_TARGET');
                const modifiedCols = item.columnDiffs.filter((cd) => cd.status === 'MODIFIED');
                if (missingCols.length > 0 || modifiedCols.length > 0) {
                    sqlParts.push(`-- [*] Sinkronisasi Kolom Tabel: ${item.name}`);
                    // Tambahkan kolom yang belum ada di target
                    for (const mc of missingCols) {
                        const col = mc.sourceColumn;
                        if (!col)
                            continue;
                        const typeStr = normalizeType(col.dataType, col.dataLength, col.dataPrecision, col.dataScale);
                        const nullStr = col.nullable ? '' : ' NOT NULL DEFAULT \'\'';
                        sqlParts.push(`ALTER TABLE ${quoteId(item.name)} ADD COLUMN ${quoteId(col.name)} ${typeStr}${nullStr};`);
                    }
                    // Modifikasi kolom yang tipe datanya berbeda
                    for (const mod of modifiedCols) {
                        const col = mod.sourceColumn;
                        if (!col)
                            continue;
                        const typeStr = normalizeType(col.dataType, col.dataLength, col.dataPrecision, col.dataScale);
                        if (tgtType === 'postgres') {
                            sqlParts.push(`ALTER TABLE ${quoteId(item.name)} ALTER COLUMN ${quoteId(col.name)} TYPE ${typeStr};`);
                        }
                        else if (tgtType === 'mysql') {
                            sqlParts.push(`ALTER TABLE ${quoteId(item.name)} MODIFY COLUMN ${quoteId(col.name)} ${typeStr};`);
                        }
                        else if (tgtType === 'sqlserver') {
                            sqlParts.push(`ALTER TABLE ${quoteId(item.name)} ALTER COLUMN ${quoteId(col.name)} ${typeStr};`);
                        }
                        else {
                            sqlParts.push(`-- Catatan: SQLite tidak mendukung ALTER COLUMN langsung untuk ${col.name}`);
                        }
                    }
                    sqlParts.push('');
                }
            }
        }
        if (sqlParts.length <= 6) {
            sqlParts.push('-- Tidak ada perbedaan DDL yang perlu disinkronkan untuk item terpilih.');
        }
        return sqlParts.join('\n');
    }
}
exports.MultiDbService = MultiDbService;
