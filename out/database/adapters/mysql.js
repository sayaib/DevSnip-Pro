"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlAdapter = void 0;
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
const SYSTEM_DATABASES = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
class MysqlAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly = false) {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.kind = "mysql";
        this.dialect = "mysql";
        this.defaultDb = spec.database || undefined;
    }
    ssl() {
        const o = this.spec.options;
        if (o.ssl && o.ssl.trim().startsWith("{")) {
            try {
                return JSON.parse(o.ssl);
            }
            catch {
                throw new types_1.DbError("The ssl option is not valid JSON.");
            }
        }
        if (!this.spec.ssl)
            return undefined;
        const mode = (o["ssl-mode"] ?? o.sslmode ?? "").toUpperCase();
        // REQUIRED encrypts without verifying (as the mysql CLI does); VERIFY_* also checks the certificate.
        return { rejectUnauthorized: /^VERIFY/.test(mode) || (!mode && o.sslaccept !== "accept_invalid_certs") };
    }
    pool() {
        if (this.poolInstance)
            return this.poolInstance;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mysql = require("mysql2/promise");
        this.poolInstance = mysql.createPool({
            host: this.spec.host,
            port: this.spec.port,
            user: this.spec.user || undefined,
            password: this.spec.password || undefined,
            database: this.defaultDb,
            ssl: this.ssl(),
            connectTimeout: types_1.LIMITS.connectTimeoutMs,
            connectionLimit: 4,
            // Dates and big numbers stay as the server's text, so edits round-trip exactly.
            dateStrings: true,
            supportBigNumbers: true,
            bigNumberStrings: true,
            multipleStatements: false,
            charset: "utf8mb4"
        });
        if (this.readOnly) {
            // Read-only connections are read-only on the server too, so a write hidden in a procedure call still fails.
            this.poolInstance.on("connection", connection => { connection.query("SET SESSION TRANSACTION READ ONLY"); });
        }
        return this.poolInstance;
    }
    async connect() {
        const [rows] = await this.pool().query("SELECT VERSION() AS version, DATABASE() AS db");
        const row = rows[0] ?? {};
        const version = String(row.version ?? "");
        return { version: /mariadb/i.test(version) ? `MariaDB ${version.split("-")[0]}` : `MySQL ${version}`, defaultDatabase: row.db ? String(row.db) : undefined };
    }
    async close() {
        const pool = this.poolInstance;
        this.poolInstance = undefined;
        await pool?.end().catch(() => undefined);
    }
    async ping() {
        await this.pool().query("SELECT 1");
    }
    async exec(_database, sql, params) {
        // Targets are always qualified with their database, so no USE is needed.
        const [result, fields] = await this.pool().query({ sql, values: params, timeout: types_1.LIMITS.queryTimeoutMs });
        if (Array.isArray(result))
            return { rows: result, columns: (fields ?? []).map(f => f.name) };
        return { rows: [], columns: [], affected: result.affectedRows };
    }
    async listDatabases() {
        const [rows] = await this.pool().query("SHOW DATABASES");
        const names = rows.map(r => String(Object.values(r)[0]));
        return [...names.filter(n => !SYSTEM_DATABASES.has(n.toLowerCase())).sort(), ...names.filter(n => SYSTEM_DATABASES.has(n.toLowerCase())).sort()];
    }
    async listSchemas() {
        return [];
    }
    async listObjects(database) {
        const [rows] = await this.pool().query("SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS row_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [database]);
        return rows.map(r => ({
            name: String(r.name),
            type: /VIEW/i.test(String(r.type)) ? "view" : "table",
            rows: r.row_count === null || r.row_count === undefined ? undefined : Number(r.row_count)
        }));
    }
    async introspect(target) {
        if (!target.database)
            throw new types_1.DbError("Choose a database first.");
        const [columns] = await this.pool().query(`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS ckey, COLUMN_DEFAULT AS def, EXTRA AS extra
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [target.database, target.object]);
        const [tables] = await this.pool().query("SELECT TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [target.database, target.object]);
        const isView = /VIEW/i.test(String(tables[0]?.type ?? ""));
        return {
            columns: columns.map(r => {
                const dataType = String(r.type);
                const extra = String(r.extra ?? "");
                const category = (0, sql_builder_1.categorize)(dataType);
                return {
                    name: String(r.name),
                    dataType,
                    category,
                    nullable: r.nullable === "YES",
                    primaryKey: r.ckey === "PRI",
                    autoIncrement: /auto_increment/i.test(extra),
                    defaultValue: r.def === null || r.def === undefined ? null : String(r.def),
                    // "DEFAULT_GENERATED" only marks a CURRENT_TIMESTAMP default; computed columns say VIRTUAL/STORED GENERATED.
                    editable: category !== "binary" && !/\b(VIRTUAL|STORED) GENERATED\b/i.test(extra)
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
        if (statements.length > 1)
            throw new types_1.DbError("MySQL runs one statement at a time here.", "Run the statements one by one.");
        const connection = await this.pool().getConnection();
        // The session may have changed (USE, SET, an open transaction): never hand it back to the pool.
        try {
            if (context.database)
                await connection.query(`USE ${(0, sql_builder_1.quoteIdent)(context.database, "mysql")}`);
            const [result, fields] = await connection.query({ sql: text, timeout: types_1.LIMITS.queryTimeoutMs });
            if (Array.isArray(result)) {
                // A CALL returns several result sets; show the first one that has rows.
                const sets = Array.isArray(result[0]) ? result : [result];
                const fieldSets = Array.isArray(fields?.[0]) ? fields : [fields];
                const index = Math.max(0, sets.findIndex(set => Array.isArray(set) && set.length > 0));
                return this.queryResult(start, sets[index] ?? [], (fieldSets[index] ?? []).map(f => f?.name).filter(Boolean), undefined, types_1.LIMITS.maxQueryRows);
            }
            const header = result;
            return this.queryResult(start, [], [], header.affectedRows, types_1.LIMITS.maxQueryRows, `${statements[0].verb.toUpperCase()} completed, ${header.affectedRows} row${header.affectedRows === 1 ? "" : "s"} affected${header.insertId ? `, insert id ${header.insertId}` : ""}.`);
        }
        finally {
            connection.destroy();
            if (statements.some(s => s.write))
                this.invalidate();
        }
    }
}
exports.MysqlAdapter = MysqlAdapter;
//# sourceMappingURL=mysql.js.map