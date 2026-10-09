"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqlServerAdapter = void 0;
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
const truthy = (v) => /^(true|yes|1)$/i.test(String(v ?? "").trim());
/** nvarchar(50), decimal(10,2), varchar(max): the declared type as SQL Server shows it. */
function sqlServerType(r) {
    const name = String(r.type);
    const max = Number(r.max_length);
    if (/^(n?var)?char$|^(var)?binary$/i.test(name)) {
        const size = max === -1 ? "max" : /^n/i.test(name) ? String(max / 2) : String(max);
        return `${name}(${size})`;
    }
    if (/^(decimal|numeric)$/i.test(name))
        return `${name}(${r.precision},${r.scale})`;
    // "timestamp" in SQL Server is a binary row version, not a date.
    if (name === "timestamp")
        return "rowversion";
    return name;
}
class SqlServerAdapter extends sql_base_1.SqlAdapter {
    constructor(spec) {
        super();
        this.spec = spec;
        this.kind = "sqlserver";
        this.dialect = "sqlserver";
        this.pools = new Map();
        this.defaultDb = spec.database || "";
        const o = spec.options;
        if (truthy(o["integrated security"]) || truthy(o.trusted_connection) || /sspi/i.test(o["integrated security"] ?? "")) {
            throw new types_1.DbError("Windows authentication is not supported here.", "Use a SQL Server login: User Id=...;Password=...");
        }
    }
    config(database, poolSize) {
        const [server, instanceName] = String(this.spec.host ?? "localhost").split("\\");
        const o = this.spec.options;
        const local = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal)$/i.test(server);
        return {
            server,
            port: instanceName ? undefined : this.spec.port,
            user: this.spec.user || undefined,
            password: this.spec.password || undefined,
            database: database || undefined,
            connectionTimeout: types_1.LIMITS.connectTimeoutMs,
            requestTimeout: types_1.LIMITS.queryTimeoutMs,
            pool: { max: poolSize, min: 0, idleTimeoutMillis: 30000 },
            options: {
                encrypt: this.spec.ssl,
                // Local Docker images ship a self-signed certificate.
                trustServerCertificate: o.trustservercertificate !== undefined ? truthy(o.trustservercertificate) : local || !this.spec.ssl,
                instanceName: instanceName || undefined,
                appName: o["application name"] || o.app || "DevSnip Pro",
                enableArithAbort: true
            }
        };
    }
    pool(database) {
        const name = database || this.defaultDb;
        const existing = this.pools.get(name);
        if (existing)
            return existing;
        if (this.pools.size >= 8)
            throw new types_1.DbError("Too many databases open on this connection. Disconnect and reconnect to free them.");
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mssql = require("mssql");
        const pool = new mssql.ConnectionPool(this.config(name, 4));
        pool.on("error", () => undefined);
        const connecting = pool.connect().catch(error => {
            this.pools.delete(name);
            throw error;
        });
        this.pools.set(name, connecting);
        return connecting;
    }
    async request(database, sql, params = []) {
        const request = (await this.pool(database)).request();
        params.forEach((value, i) => request.input(`p${i + 1}`, value));
        return request.query(sql);
    }
    async connect() {
        const result = await this.request(undefined, "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition, DB_NAME() AS db");
        const row = result.recordset[0] ?? {};
        if (!this.defaultDb) {
            // Remember the database the login landed in, so later pools share it.
            const pool = this.pools.get("");
            this.defaultDb = String(row.db ?? "master");
            if (pool) {
                this.pools.delete("");
                this.pools.set(this.defaultDb, pool);
            }
        }
        return { version: `SQL Server ${row.version ?? ""}${row.edition ? ` (${String(row.edition).replace(/ \(64-bit\)/, "")})` : ""}`, defaultDatabase: this.defaultDb };
    }
    async close() {
        const pools = [...this.pools.values()];
        this.pools.clear();
        await Promise.allSettled(pools.map(p => p.then(pool => pool.close())));
    }
    async ping() {
        await this.request(undefined, "SELECT 1 AS ok");
    }
    async exec(database, sql, params) {
        const result = await this.request(database, sql, params);
        const rows = result.recordset ?? [];
        return { rows, columns: rows.length ? Object.keys(rows[0]) : [], affected: (result.rowsAffected ?? []).reduce((a, b) => a + b, 0) };
    }
    async listDatabases() {
        const result = await this.request(undefined, "SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY CASE WHEN database_id <= 4 THEN 1 ELSE 0 END, name");
        return result.recordset.map(r => String(r.name));
    }
    async listSchemas(database) {
        const result = await this.request(database, `SELECT s.name FROM sys.schemas s
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') AND s.name NOT LIKE 'db[_]%'
          AND (s.name = 'dbo' OR EXISTS (SELECT 1 FROM sys.objects o WHERE o.schema_id = s.schema_id AND o.type IN ('U', 'V')))
        ORDER BY CASE WHEN s.name = 'dbo' THEN 0 ELSE 1 END, s.name`);
        return result.recordset.map(r => String(r.name));
    }
    async listObjects(database, schema) {
        const result = await this.request(database, `SELECT o.name, o.type,
              (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS row_count
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @p1 AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
        ORDER BY o.name`, [schema || "dbo"]);
        return result.recordset.map(r => ({
            name: String(r.name),
            type: String(r.type).trim() === "V" ? "view" : "table",
            rows: r.row_count === null || r.row_count === undefined ? undefined : Number(r.row_count)
        }));
    }
    async introspect(target) {
        const result = await this.request(target.database, `SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
              OBJECT_DEFINITION(c.default_object_id) AS def, o.type AS otype,
              CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                                 WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS pk
         FROM sys.columns c
         JOIN sys.objects o ON o.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @p1 AND o.name = @p2 AND o.type IN ('U', 'V')
        ORDER BY c.column_id`, [target.schema || "dbo", target.object]);
        const rows = result.recordset;
        const isView = String(rows[0]?.otype ?? "").trim() === "V";
        return {
            columns: rows.map(r => {
                const dataType = sqlServerType(r);
                const category = (0, sql_builder_1.categorize)(dataType);
                return {
                    name: String(r.name),
                    dataType,
                    category,
                    nullable: !!r.is_nullable,
                    primaryKey: r.pk === 1,
                    autoIncrement: !!r.is_identity,
                    defaultValue: r.def === null || r.def === undefined ? null : String(r.def),
                    // IDENTITY and computed columns reject explicit values.
                    editable: category !== "binary" && !r.is_identity && !r.is_computed
                };
            }),
            isView,
            hasRowid: false,
            dropKeyword: isView ? "VIEW" : "TABLE"
        };
    }
    async runQuery(text, context) {
        const start = Date.now();
        const statements = this.classify(text);
        if (statements.some(s => s.verb === "use"))
            throw new types_1.DbError("Pick the database from the selector instead of USE.");
        // A dedicated connection per run: an open BEGIN TRAN or a SET never leaks into the pooled sessions.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mssql = require("mssql");
        const pool = new mssql.ConnectionPool(this.config(context.database || this.defaultDb, 1));
        pool.on("error", () => undefined);
        try {
            await pool.connect();
            const result = await pool.request().query(text);
            const sets = (result.recordsets ?? []).filter(Array.isArray);
            const affected = (result.rowsAffected ?? []).reduce((a, b) => a + b, 0);
            const set = [...sets].reverse().find(s => s.length > 0) ?? sets[sets.length - 1];
            if (set) {
                const columns = Object.keys(set.columns ?? set[0] ?? {});
                return this.queryResult(start, set, columns, affected || undefined, types_1.LIMITS.maxQueryRows);
            }
            return this.queryResult(start, [], [], affected, types_1.LIMITS.maxQueryRows, `Completed, ${affected} row${affected === 1 ? "" : "s"} affected.`);
        }
        finally {
            await pool.close().catch(() => undefined);
            if (statements.some(s => s.write))
                this.invalidate();
        }
    }
}
exports.SqlServerAdapter = SqlServerAdapter;
//# sourceMappingURL=sqlserver.js.map