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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteAdapter = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
const toParam = (value) => (typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);
/** Node's built-in SQLite (Node 22.5+): works on the file directly, with SQLite's own locking. */
function nodeSqliteBackend(file, readOnly) {
    let mod;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        mod = require("node:sqlite");
    }
    catch {
        return undefined;
    }
    if (!mod?.DatabaseSync)
        return undefined;
    const db = new mod.DatabaseSync(file, readOnly ? { readOnly: true } : {});
    db.exec("PRAGMA busy_timeout = 5000");
    const prepare = (sql) => {
        const stmt = db.prepare(sql);
        // Integers beyond 2^53 stay exact; encodeValue turns them back into numbers when safe.
        stmt.setReadBigInts?.(true);
        return stmt;
    };
    return {
        name: "node:sqlite",
        all(sql, params, limit, write) {
            const stmt = prepare(sql);
            const rows = [];
            if (limit && !write && typeof stmt.iterate === "function") {
                for (const row of stmt.iterate(...params.map(toParam))) {
                    rows.push(row);
                    if (rows.length > limit)
                        break;
                }
            }
            else {
                rows.push(...stmt.all(...params.map(toParam)));
            }
            const columns = typeof stmt.columns === "function" ? stmt.columns().map((c) => c.name) : rows[0] ? Object.keys(rows[0]) : [];
            return { rows, columns };
        },
        run(sql, params) {
            return Number(prepare(sql).run(...params.map(toParam)).changes ?? 0);
        },
        script(sql) {
            const before = Number(db.prepare("SELECT total_changes() AS n").get().n);
            db.exec(sql);
            const after = Number(db.prepare("SELECT total_changes() AS n").get().n);
            return { rows: [], columns: [], changes: after - before };
        },
        version() {
            return String(db.prepare("SELECT sqlite_version() AS v").get().v);
        },
        close() {
            db.close();
        }
    };
}
/**
 * sql.js (WebAssembly) for hosts without node:sqlite. It works on an in-memory
 * copy, so the file is re-read whenever it changes on disk and written back
 * atomically after every write.
 */
async function sqlJsBackend(file, readOnly) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require("sql.js");
    const dist = path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
    const SQL = await initSqlJs({ locateFile: (name) => path.join(dist, name) });
    let stamp = "";
    let db;
    const statOf = () => { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; };
    const load = () => {
        const current = statOf();
        if (db && current === stamp)
            return db;
        db?.close();
        db = new SQL.Database(fs.readFileSync(file));
        stamp = current;
        return db;
    };
    const save = () => {
        if (readOnly || !db)
            return;
        if (statOf() !== stamp)
            throw new types_1.DbError("The database file changed on disk while this write was running. Refresh and try again.");
        const tmp = `${file}.devsnip-${process.pid}.tmp`;
        fs.writeFileSync(tmp, Buffer.from(db.export()));
        fs.renameSync(tmp, file);
        stamp = statOf();
    };
    const bind = (params) => params.map(toParam);
    return {
        name: "sql.js",
        all(sql, params, limit, write) {
            const stmt = load().prepare(sql);
            const rows = [];
            let columns;
            try {
                stmt.bind(bind(params));
                // A write with RETURNING is stepped to the end so every row is changed.
                while (stmt.step()) {
                    if (!limit || rows.length <= limit)
                        rows.push(stmt.getAsObject());
                    else if (!write)
                        break;
                }
                columns = stmt.getColumnNames();
            }
            finally {
                stmt.free();
            }
            if (write)
                save();
            return { rows, columns };
        },
        run(sql, params) {
            const database = load();
            database.run(sql, bind(params));
            const changes = database.getRowsModified();
            save();
            return changes;
        },
        script(sql) {
            const database = load();
            const before = Number(database.exec("SELECT total_changes()")[0]?.values[0]?.[0] ?? 0);
            const results = database.exec(sql);
            const after = Number(database.exec("SELECT total_changes()")[0]?.values[0]?.[0] ?? 0);
            if (after !== before || /\b(create|drop|alter|insert|update|delete|replace|vacuum)\b/i.test(sql))
                save();
            const last = results[results.length - 1];
            const rows = (last?.values ?? []).map(values => Object.fromEntries(last.columns.map((c, i) => [c, values[i]])));
            return { rows, columns: last?.columns ?? [], changes: after - before };
        },
        version() {
            return String(load().exec("SELECT sqlite_version()")[0]?.values[0]?.[0] ?? "");
        },
        close() {
            db?.close();
            db = undefined;
        }
    };
}
class SqliteAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly, prefer = "auto") {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.prefer = prefer;
        this.kind = "sqlite";
        this.dialect = "sqlite";
    }
    get db() {
        if (!this.backend)
            throw new types_1.DbError("Not connected.");
        return this.backend;
    }
    async connect() {
        const file = this.spec.filePath;
        let stat;
        try {
            stat = fs.statSync(file);
        }
        catch {
            throw new types_1.DbError(`SQLite file not found: ${path.basename(file)}`, `Looked for ${file}`);
        }
        if (!stat.isFile())
            throw new types_1.DbError(`${path.basename(file)} is not a file.`);
        const header = Buffer.alloc(16);
        const fd = fs.openSync(file, "r");
        try {
            fs.readSync(fd, header, 0, 16, 0);
        }
        finally {
            fs.closeSync(fd);
        }
        if (stat.size > 0 && header.toString("latin1") !== "SQLite format 3\u0000")
            throw new types_1.DbError(`${path.basename(file)} is not a SQLite database.`);
        this.backend = (this.prefer === "auto" ? nodeSqliteBackend(file, this.readOnly) : undefined) ?? (await sqlJsBackend(file, this.readOnly));
        return { version: `SQLite ${this.backend.version()}`, defaultDatabase: "main" };
    }
    async close() {
        this.backend?.close();
        this.backend = undefined;
    }
    async ping() {
        this.db.all("SELECT 1", []);
    }
    async exec(_database, sql, params) {
        if (/^\s*(select|pragma|with)\b/i.test(sql)) {
            const { rows, columns } = this.db.all(sql, params);
            return { rows, columns };
        }
        return { rows: [], columns: [], affected: this.db.run(sql, params) };
    }
    async listDatabases() {
        return this.db.all("PRAGMA database_list", []).rows.map(r => String(r.name)).filter(n => n !== "temp");
    }
    async listSchemas() {
        return [];
    }
    async listObjects(database) {
        const rows = this.db.all(`SELECT name, type FROM ${(0, sql_builder_1.quoteIdent)(database || "main", "sqlite")}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`, []).rows;
        return rows.map(r => ({ name: String(r.name), type: r.type === "view" ? "view" : "table" }));
    }
    async introspect(target) {
        const schema = target.database || "main";
        const master = this.db.all(`SELECT type, sql FROM ${(0, sql_builder_1.quoteIdent)(schema, "sqlite")}.sqlite_master WHERE name = ? AND type IN ('table', 'view')`, [target.object]).rows[0];
        if (!master)
            return { columns: [], isView: false, hasRowid: false, dropKeyword: "TABLE" };
        const isView = master.type === "view";
        const info = this.db.all("SELECT * FROM pragma_table_xinfo(?, ?)", [target.object, schema]).rows;
        const pkCount = info.filter(r => Number(r.pk) > 0).length;
        const columns = info.filter(r => Number(r.hidden ?? 0) !== 1).map(r => {
            const dataType = String(r.type || "ANY");
            const category = (0, sql_builder_1.categorize)(dataType);
            const pk = Number(r.pk) > 0;
            // hidden 2/3 = generated column.
            const generated = Number(r.hidden ?? 0) >= 2;
            return {
                name: String(r.name),
                dataType,
                category,
                nullable: Number(r.notnull) === 0 && !pk,
                primaryKey: pk,
                // A lone INTEGER PRIMARY KEY is the rowid, filled automatically.
                autoIncrement: pk && pkCount === 1 && /^integer$/i.test(dataType),
                defaultValue: r.dflt_value === null || r.dflt_value === undefined ? null : String(r.dflt_value),
                editable: category !== "binary" && !generated
            };
        });
        return {
            columns,
            isView,
            hasRowid: !isView && !/without\s+rowid/i.test(String(master.sql ?? "")),
            dropKeyword: isView ? "VIEW" : "TABLE"
        };
    }
    async runQuery(text) {
        const start = Date.now();
        const statements = this.classify(text);
        try {
            if (statements.length === 1) {
                const only = statements[0];
                const returning = only.write && /\breturning\b/i.test(only.text);
                if (!only.write || returning) {
                    const { rows, columns } = this.db.all(only.text, [], types_1.LIMITS.maxQueryRows, returning);
                    return this.queryResult(start, rows, columns, returning ? rows.length : undefined, types_1.LIMITS.maxQueryRows);
                }
                const changes = this.db.run(only.text, []);
                return this.queryResult(start, [], [], changes, types_1.LIMITS.maxQueryRows, `${only.verb.toUpperCase()} completed, ${changes} row${changes === 1 ? "" : "s"} affected.`);
            }
            const result = this.db.script(text);
            return this.queryResult(start, result.rows, result.columns, result.changes || undefined, types_1.LIMITS.maxQueryRows, result.rows.length ? undefined : `${statements.length} statements completed${result.changes ? `, ${result.changes} rows affected` : ""}.`);
        }
        finally {
            if (statements.some(s => s.write))
                this.invalidate();
        }
    }
    /** Which engine opened the file (for diagnostics and tests). */
    get engine() {
        return this.backend?.name;
    }
}
exports.SqliteAdapter = SqliteAdapter;
//# sourceMappingURL=sqlite.js.map