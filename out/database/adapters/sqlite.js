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
exports.SqliteAdapter = exports.SQLJS_MAX_FILE_BYTES = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
/**
 * sql.js copies the whole file into WebAssembly memory, which tops out
 * around 2 GB; refuse early with a clear message rather than crash.
 */
exports.SQLJS_MAX_FILE_BYTES = 512 * 1024 * 1024;
function cancelled() {
    return new types_1.DbError("The query was cancelled.", "Statements that finished before the cancel are not rolled back.", "CANCELLED");
}
/**
 * node:sqlite on a worker thread. SQLite is synchronous, so on the extension
 * host a full scan of a large table would freeze VS Code until it finished;
 * on a worker it runs alongside, a timeout stops it, and a cancel terminates
 * the thread (SQLite rolls back an unfinished write on the next open).
 */
class WorkerBackend {
    constructor(file, readOnly, timeoutMs = types_1.LIMITS.queryTimeoutMs) {
        this.file = file;
        this.readOnly = readOnly;
        this.timeoutMs = timeoutMs;
        this.name = "node:sqlite";
        this.seq = 0;
        this.pending = new Map();
    }
    start() {
        if (this.ready)
            return this.ready;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Worker: WorkerClass } = require("worker_threads");
        const worker = new WorkerClass(path.join(__dirname, "sqlite-worker.js"), { workerData: { file: this.file, readOnly: this.readOnly } });
        // An idle worker never keeps the extension host alive.
        worker.unref();
        this.worker = worker;
        this.ready = new Promise((resolve, reject) => {
            worker.on("message", (m) => {
                if (m.id === 0) {
                    resolve();
                    return;
                }
                const p = this.pending.get(m.id);
                if (!p)
                    return;
                this.pending.delete(m.id);
                clearTimeout(p.timer);
                if (m.ok)
                    p.resolve(m.result);
                else
                    p.reject(Object.assign(new Error(m.error?.message ?? "SQLite error"), { code: m.error?.code, errcode: m.error?.errcode }));
            });
            const down = (error) => {
                if (this.worker !== worker)
                    return;
                this.reset(error);
                reject(error);
            };
            worker.on("error", down);
            worker.on("exit", code => down(new types_1.DbError(`The SQLite worker stopped (exit code ${code}).`, "Reconnect and try again.")));
        });
        return this.ready;
    }
    reset(reason) {
        const worker = this.worker;
        this.worker = undefined;
        this.ready = undefined;
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(reason);
        }
        this.pending.clear();
        void worker?.terminate().catch(() => undefined);
    }
    async call(op, args) {
        await this.start();
        const worker = this.worker;
        return new Promise((resolve, reject) => {
            const id = ++this.seq;
            const timer = setTimeout(() => this.reset(new types_1.DbError(`The query took longer than ${Math.round(this.timeoutMs / 1000)} seconds and was stopped.`, "Add a filter or a LIMIT, or an index on the columns you filter and sort by.", "TIMEOUT")), this.timeoutMs);
            this.pending.set(id, { resolve: resolve, reject, timer });
            worker.postMessage({ id, op, args });
        });
    }
    all(sql, params, limit, write) { return this.call("all", [sql, params, limit, write]); }
    run(sql, params) { return this.call("run", [sql, params]); }
    script(sql) { return this.call("script", [sql]); }
    version() { return this.call("version", []); }
    interrupt() { if (this.worker)
        this.reset(cancelled()); }
    async close() {
        if (this.worker)
            await this.call("close", []).catch(() => undefined);
        this.reset(new types_1.DbError("The connection was closed."));
    }
}
/** Whether this host has node:sqlite (Node 22.5+) and worker threads. */
function hasNodeSqlite() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return typeof require("node:sqlite").DatabaseSync === "function" && fs.existsSync(path.join(__dirname, "sqlite-worker.js"));
    }
    catch {
        return false;
    }
}
const toParam = (value) => (typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);
/**
 * sql.js (WebAssembly) for hosts without node:sqlite. It works on an in-memory
 * copy, so the file is re-read whenever it changes on disk and written back
 * atomically after every write.
 */
async function sqlJsBackend(file, readOnly) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require("sql.js");
    if (fs.statSync(file).size > exports.SQLJS_MAX_FILE_BYTES) {
        throw new types_1.DbError(`This SQLite file is too large to open without node:sqlite (over ${exports.SQLJS_MAX_FILE_BYTES / 1048576} MB).`, "Update VS Code: versions with Node 22.5 or later read SQLite files of any size in place.");
    }
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
        async all(sql, params, limit, write) {
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
        async run(sql, params) {
            const database = load();
            database.run(sql, bind(params));
            const changes = database.getRowsModified();
            save();
            return changes;
        },
        async script(sql) {
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
        async version() {
            return String(load().exec("SELECT sqlite_version()")[0]?.values[0]?.[0] ?? "");
        },
        async close() {
            db?.close();
            db = undefined;
        }
    };
}
class SqliteAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly, prefer = "auto", timeoutMs = types_1.LIMITS.queryTimeoutMs) {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.prefer = prefer;
        this.timeoutMs = timeoutMs;
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
        const worker = this.prefer === "auto" && hasNodeSqlite();
        this.backend = worker ? new WorkerBackend(file, this.readOnly, this.timeoutMs) : await sqlJsBackend(file, this.readOnly);
        try {
            return { version: `SQLite ${await this.backend.version()}`, defaultDatabase: "main" };
        }
        catch (error) {
            await this.close();
            throw error;
        }
    }
    async close() {
        const backends = [this.backend, this.consoleBackend];
        this.backend = this.consoleBackend = undefined;
        await Promise.allSettled(backends.map(b => b?.close()));
    }
    console() {
        const db = this.db;
        if (!(db instanceof WorkerBackend))
            return db;
        this.consoleBackend ?? (this.consoleBackend = new WorkerBackend(this.spec.filePath, this.readOnly, this.timeoutMs));
        return this.consoleBackend;
    }
    async ping() {
        await this.db.all("SELECT 1", []);
    }
    async exec(_database, sql, params) {
        if (/^\s*(select|pragma|with)\b/i.test(sql)) {
            const { rows, columns } = await this.db.all(sql, params);
            return { rows, columns };
        }
        return { rows: [], columns: [], affected: await this.db.run(sql, params) };
    }
    async listDatabases() {
        return (await this.db.all("PRAGMA database_list", [])).rows.map(r => String(r.name)).filter(n => n !== "temp");
    }
    async listSchemas() {
        return [];
    }
    async listObjects(database) {
        const rows = (await this.db.all(`SELECT name, type FROM ${(0, sql_builder_1.quoteIdent)(database || "main", "sqlite")}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`, [])).rows;
        return rows.map(r => ({ name: String(r.name), type: r.type === "view" ? "view" : "table" }));
    }
    async introspect(target) {
        const schema = target.database || "main";
        const master = (await this.db.all(`SELECT type, sql FROM ${(0, sql_builder_1.quoteIdent)(schema, "sqlite")}.sqlite_master WHERE name = ? AND type IN ('table', 'view')`, [target.object])).rows[0];
        if (!master)
            return { columns: [], isView: false, hasRowid: false, dropKeyword: "TABLE" };
        const isView = master.type === "view";
        const info = (await this.db.all("SELECT * FROM pragma_table_xinfo(?, ?)", [target.object, schema])).rows;
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
    async indexes(target) {
        const schema = target.database || "main";
        const out = [];
        // A lone INTEGER PRIMARY KEY is the rowid itself and has no separate index.
        const pk = (await this.describe(target)).filter(c => c.primaryKey);
        const list = (await this.db.all("SELECT name, \"unique\" AS uniq, origin, partial FROM pragma_index_list(?, ?)", [target.object, schema])).rows;
        if (pk.length === 1 && pk[0].autoIncrement && !list.some(r => r.origin === "pk"))
            out.push({ name: "PRIMARY KEY", columns: [pk[0].name], unique: true, primary: true, type: "rowid" });
        for (const r of list) {
            const columns = (await this.db.all("SELECT name FROM pragma_index_info(?, ?) ORDER BY seqno", [String(r.name), schema])).rows.map(c => (c.name === null ? "(expression)" : String(c.name)));
            out.push({ name: String(r.name), columns, unique: Number(r.uniq) === 1, primary: r.origin === "pk", type: r.origin === "u" ? "unique constraint" : undefined, detail: Number(r.partial) === 1 ? "partial" : undefined });
        }
        return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
    }
    async runQuery(text, _context = {}, control) {
        const start = Date.now();
        const statements = this.classify(text);
        const db = this.console();
        control?.onCancel(() => db.interrupt?.());
        try {
            if (statements.length === 1) {
                const only = statements[0];
                const returning = only.write && /\breturning\b/i.test(only.text);
                if (!only.write || returning) {
                    const { rows, columns } = await db.all(only.text, [], types_1.LIMITS.maxQueryRows, returning);
                    return this.queryResult(start, rows, columns, returning ? rows.length : undefined, types_1.LIMITS.maxQueryRows);
                }
                const changes = await db.run(only.text, []);
                return this.queryResult(start, [], [], changes, types_1.LIMITS.maxQueryRows, `${only.verb.toUpperCase()} completed, ${changes} row${changes === 1 ? "" : "s"} affected.`);
            }
            const result = await db.script(text);
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