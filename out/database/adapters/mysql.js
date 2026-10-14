"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlAdapter = exports.mysqlErrorPosition = void 0;
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
const SYSTEM_DATABASES = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
/**
 * MySQL reports syntax errors as "... near 'rest of the text' at line N";
 * finding that text in the statement gives the exact position.
 */
function mysqlErrorPosition(message, statement) {
    const m = /near '([\s\S]*)' at line (\d+)/.exec(message);
    if (!m)
        return undefined;
    const lines = statement.split("\n");
    const line = Math.min(Math.max(1, Number(m[2])), lines.length);
    const lineStart = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    if (!m[1])
        return statement.trimEnd().length;
    const at = statement.indexOf(m[1].slice(0, 60), lineStart);
    return at >= 0 ? at : lineStart;
}
exports.mysqlErrorPosition = mysqlErrorPosition;
/**
 * Streams one SELECT and stops after `limit` rows, so a huge result never
 * reaches memory. The caller destroys the connection afterwards, which ends
 * the rest of the query on the server.
 */
function streamRows(connection, sql, limit) {
    const core = connection.connection;
    return new Promise((resolve, reject) => {
        const rows = [];
        let columns = [];
        let settled = false;
        const finish = (truncated) => { if (!settled) {
            settled = true;
            resolve({ rows, columns, truncated });
        } };
        const query = core.query({ sql, timeout: types_1.LIMITS.queryTimeoutMs });
        query.on("fields", (fields) => { if (!columns.length)
            columns = (fields ?? []).map(f => f.name); });
        query.on("result", (row) => {
            if (settled)
                return;
            if (rows.length >= limit) {
                core.pause();
                finish(true);
                return;
            }
            rows.push(row);
        });
        query.on("error", (error) => { if (!settled) {
            settled = true;
            reject(error);
        } });
        query.on("end", () => finish(false));
    });
}
class MysqlAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly = false) {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.dialect = "mysql";
        this.kind = spec.kind === "mariadb" ? "mariadb" : "mysql";
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
        return { version: /mariadb/i.test(version) ? `MariaDB ${version.replace(/^5\.5\.5-/, "").split("-")[0]}` : `MySQL ${version}`, defaultDatabase: row.db ? String(row.db) : undefined };
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
                    // MariaDB writes a missing default as the text NULL (and quotes string defaults).
                    defaultValue: r.def === null || r.def === undefined || (r.def === "NULL" && r.nullable === "YES") ? null : String(r.def),
                    // "DEFAULT_GENERATED" only marks a CURRENT_TIMESTAMP default; computed columns say VIRTUAL/STORED GENERATED.
                    editable: category !== "binary" && !/\b(VIRTUAL|STORED) GENERATED\b/i.test(extra)
                };
            }),
            isView,
            hasRowid: false,
            dropKeyword: isView ? "VIEW" : "TABLE"
        };
    }
    async indexes(target) {
        const [rows] = await this.pool().query(`SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, INDEX_TYPE AS type, COLUMN_NAME AS col, EXPRESSION AS expr, SUB_PART AS sub
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`, [target.database ?? this.defaultDb, target.object]).catch(async (error) => {
            // MariaDB and MySQL 5.7 have no EXPRESSION column.
            if (!/EXPRESSION/i.test(String(error.message)))
                throw error;
            return this.pool().query(`SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, INDEX_TYPE AS type, COLUMN_NAME AS col, SUB_PART AS sub
           FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`, [target.database ?? this.defaultDb, target.object]);
        });
        const byName = new Map();
        for (const r of rows) {
            const name = String(r.name);
            const entry = byName.get(name) ?? { name, columns: [], unique: Number(r.non_unique) === 0, primary: name === "PRIMARY", type: String(r.type ?? "").toLowerCase() || undefined };
            entry.columns.push(r.col ? `${r.col}${r.sub ? `(${r.sub})` : ""}` : `(${r.expr ?? "expression"})`);
            byName.set(name, entry);
        }
        return [...byName.values()];
    }
    async runQuery(text, context, control) {
        const start = Date.now();
        const statements = this.classify(text);
        const connection = await this.pool().getConnection();
        const threadId = connection.threadId;
        // KILL QUERY runs on another connection; the console's own session then reports "interrupted".
        if (threadId)
            control?.onCancel(() => this.pool().query(`KILL QUERY ${Number(threadId)}`).catch(() => undefined));
        // The session may have changed (USE, SET, an open transaction): never hand it back to the pool.
        let shown;
        let affected = 0;
        let anyAffected = false;
        let insertId;
        try {
            if (context.database)
                await connection.query(`USE ${(0, sql_builder_1.quoteIdent)(context.database, "mysql")}`);
            // Statements run one by one on the same session, so SET and temporary tables carry over.
            for (const statement of statements) {
                let result;
                let fields;
                const plainSelect = statements.length === 1 && !statement.write && ["select", "with", "table", "values"].includes(statement.verb);
                try {
                    if (plainSelect) {
                        const streamed = await streamRows(connection, statement.text, types_1.LIMITS.maxQueryRows);
                        return { ...this.queryResult(start, streamed.rows, streamed.columns, undefined, types_1.LIMITS.maxQueryRows), truncated: streamed.truncated };
                    }
                    [result, fields] = await connection.query({ sql: statement.text, timeout: types_1.LIMITS.queryTimeoutMs });
                }
                catch (error) {
                    const e = error;
                    const at = mysqlErrorPosition(String(e.sqlMessage ?? e.message ?? ""), statement.text);
                    if (at !== undefined)
                        e.devsnipPosition = statement.offset + at;
                    throw error;
                }
                if (Array.isArray(result)) {
                    // A CALL returns several result sets; show the first one that has rows.
                    const sets = Array.isArray(result[0]) ? result : [result];
                    const fieldSets = Array.isArray(fields?.[0]) ? fields : [fields];
                    const index = Math.max(0, sets.findIndex(set => Array.isArray(set) && set.length > 0));
                    shown = { rows: sets[index] ?? [], columns: (fieldSets[index] ?? []).map(f => f?.name).filter(Boolean) };
                }
                else {
                    const header = result;
                    affected += header.affectedRows ?? 0;
                    anyAffected = true;
                    if (header.insertId)
                        insertId = header.insertId;
                }
            }
        }
        finally {
            connection.destroy();
            if (statements.some(s => s.write))
                this.invalidate();
        }
        if (shown)
            return this.queryResult(start, shown.rows, shown.columns, anyAffected ? affected : undefined, types_1.LIMITS.maxQueryRows);
        const verbs = [...new Set(statements.map(s => s.verb.toUpperCase()))].join(", ");
        return this.queryResult(start, [], [], affected, types_1.LIMITS.maxQueryRows, `${verbs} completed, ${affected} row${affected === 1 ? "" : "s"} affected${insertId ? `, insert id ${insertId}` : ""}.`);
    }
}
exports.MysqlAdapter = MysqlAdapter;
//# sourceMappingURL=mysql.js.map