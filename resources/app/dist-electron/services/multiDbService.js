"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiDbService = void 0;
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
class MultiDbService {
    /**
     * Test connection to target database
     */
    async testConnection(config) {
        const dbType = config.dbType || 'oracle';
        if (dbType === 'postgres') {
            return await this.testPostgresConnection(config);
        }
        else if (dbType === 'mysql') {
            return await this.testMySqlConnection(config);
        }
        else if (dbType === 'sqlserver') {
            return await this.testSqlServerConnection(config);
        }
        return { success: false, message: `Database type '${dbType}' tidak didukung oleh MultiDbService.` };
    }
    /**
     * Execute query on target database
     */
    async executeQuery(config, sql, maxRows = 0, targetSchema) {
        const dbType = config.dbType || 'oracle';
        if (dbType === 'postgres') {
            return await this.executePostgresQuery(config, sql, maxRows, targetSchema);
        }
        else if (dbType === 'mysql') {
            return await this.executeMySqlQuery(config, sql, maxRows, targetSchema);
        }
        else if (dbType === 'sqlserver') {
            return await this.executeSqlServerQuery(config, sql, maxRows, targetSchema);
        }
        throw new Error(`Database type '${dbType}' tidak didukung untuk eksekusi SQL.`);
    }
    /**
     * Get list of schemas / databases
     */
    async getSchemas(config) {
        const dbType = config.dbType || 'oracle';
        if (dbType === 'postgres') {
            return await this.getPostgresSchemas(config);
        }
        else if (dbType === 'mysql') {
            return await this.getMySqlDatabases(config);
        }
        else if (dbType === 'sqlserver') {
            return await this.getSqlServerDatabases(config);
        }
        return [];
    }
    /**
     * Get list of tables / views in a schema
     */
    async getSchemaObjects(config, schemaName) {
        const dbType = config.dbType || 'oracle';
        if (dbType === 'postgres') {
            return await this.getPostgresObjects(config, schemaName);
        }
        else if (dbType === 'mysql') {
            return await this.getMySqlObjects(config, schemaName);
        }
        else if (dbType === 'sqlserver') {
            return await this.getSqlServerObjects(config, schemaName);
        }
        return [];
    }
    /**
     * Get table columns map for schema
     */
    async getSchemaTableColumns(config, schemaName) {
        const dbType = config.dbType || 'oracle';
        if (dbType === 'postgres') {
            return await this.getPostgresTableColumns(config, schemaName);
        }
        else if (dbType === 'mysql') {
            return await this.getMySqlTableColumns(config, schemaName);
        }
        else if (dbType === 'sqlserver') {
            return await this.getSqlServerTableColumns(config, schemaName);
        }
        return {};
    }
    /**
     * Get live row count
     */
    async getTableLiveRowCount(config, schemaName, tableName) {
        const dbType = config.dbType || 'oracle';
        try {
            if (dbType === 'postgres') {
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
            const tediousConfig = {
                server: config.host,
                authentication: {
                    type: 'default',
                    options: {
                        userName: config.user,
                        password: config.password || '',
                    },
                },
                options: {
                    port: config.port || 1433,
                    database: database,
                    encrypt: false,
                    trustServerCertificate: true,
                    connectTimeout: 10000,
                    requestTimeout: 60000,
                },
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
}
exports.MultiDbService = MultiDbService;
