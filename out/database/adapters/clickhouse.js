"use strict";
/**
 * ClickHouse over its HTTP interface, with Node's built-in fetch, so no
 * driver ships for it. Credentials travel in headers, never in the URL.
 *
 * ClickHouse rows have no unique key, so the grid can insert but not edit or
 * delete rows (keyStrategyFor says why); the query tab runs anything,
 * including ALTER TABLE ... UPDATE/DELETE mutations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClickHouseAdapter = void 0;
const crypto_1 = require("crypto");
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
const SYSTEM_DATABASES = new Set(["system", "information_schema", "INFORMATION_SCHEMA"]);
const VIEW_ENGINES = /^(View|MaterializedView|LiveView|WindowView)$/;
/** Parameter values use ClickHouse's escaped text format: a backslash starts an escape. */
function escapeParam(value) {
    if (value === null || value === undefined)
        return "\\N";
    return String(value).replace(/[\\\t\n\r]/g, m => ({ "\\": "\\\\", "\t": "\\t", "\n": "\\n", "\r": "\\r" })[m]);
}
class ClickHouseAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly = false) {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.kind = "clickhouse";
        this.dialect = "clickhouse";
        this.connected = false;
        const host = spec.host?.includes(":") && !spec.host.startsWith("[") ? `[${spec.host}]` : spec.host;
        this.base = `${spec.ssl ? "https" : "http"}://${host}:${spec.port ?? (spec.ssl ? 8443 : 8123)}/`;
        this.defaultDb = spec.database || "default";
    }
    headers() {
        const h = { "X-ClickHouse-User": this.spec.user || "default", "Content-Type": "text/plain; charset=utf-8" };
        if (this.spec.password)
            h["X-ClickHouse-Key"] = this.spec.password;
        return h;
    }
    url(database, params) {
        const url = new URL(this.base);
        url.searchParams.set("database", database || this.defaultDb);
        url.searchParams.set("max_execution_time", String(Math.ceil(types_1.LIMITS.queryTimeoutMs / 1000)));
        // Read-only connections are read-only on the server too (2 still lets this client pass settings).
        if (this.readOnly)
            url.searchParams.set("readonly", "2");
        for (const [k, v] of Object.entries(params))
            url.searchParams.set(k, v);
        return url;
    }
    /** One HTTP request. A ClickHouse error becomes a thrown Error carrying its code and message. */
    async send(sql, opts = {}) {
        const params = {};
        if (opts.format)
            params.default_format = opts.format;
        if (opts.queryId)
            params.query_id = opts.queryId;
        (opts.params ?? []).forEach((value, i) => { params[`param_p${i + 1}`] = escapeParam(value); });
        const timeout = AbortSignal.timeout(opts.timeoutMs ?? types_1.LIMITS.queryTimeoutMs + 5000);
        const signal = opts.signal ? anySignal([opts.signal, timeout]) : timeout;
        const response = await fetch(this.url(opts.database, params), { method: "POST", headers: this.headers(), body: sql, signal });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw chError(response.status, response.headers.get("x-clickhouse-exception-code"), text);
        }
        return response;
    }
    async request(sql, opts = {}) {
        const response = await this.send(sql, opts);
        const text = await response.text();
        let summary = {};
        try {
            summary = JSON.parse(response.headers.get("x-clickhouse-summary") ?? "{}");
        }
        catch { /* optional */ }
        return { status: response.status, text, summary };
    }
    async json(sql, database, params = []) {
        const r = await this.request(sql, { database, params, format: "JSON" });
        if (!r.text.trim())
            return { rows: [], columns: [], types: [] };
        const body = JSON.parse(r.text);
        // Errors after the first block arrive inside a 200 response.
        if (body.exception)
            throw chError(200, null, body.exception);
        return { rows: body.data ?? [], columns: (body.meta ?? []).map(m => m.name), types: (body.meta ?? []).map(m => m.type) };
    }
    async connect() {
        const r = await this.json("SELECT version() AS v, currentDatabase() AS db");
        this.connected = true;
        return { version: `ClickHouse ${r.rows[0]?.v ?? ""}`.trim(), defaultDatabase: String(r.rows[0]?.db ?? this.defaultDb) };
    }
    async close() {
        this.connected = false;
    }
    async ping() {
        await this.json("SELECT 1");
    }
    async exec(database, sql, params) {
        if (!this.connected)
            throw new types_1.DbError("Not connected.");
        if (/^\s*(select|with|show|describe|exists)\b/i.test(sql)) {
            const r = await this.json(sql, database, params);
            return { rows: r.rows, columns: r.columns };
        }
        const r = await this.request(sql, { database, params });
        return { rows: [], columns: [], affected: Number(r.summary.written_rows ?? 0) };
    }
    async listDatabases() {
        const names = (await this.json("SELECT name FROM system.databases ORDER BY name")).rows.map(r => String(r.name));
        return [...names.filter(n => !SYSTEM_DATABASES.has(n)), ...names.filter(n => SYSTEM_DATABASES.has(n))];
    }
    async listSchemas() {
        return [];
    }
    async listObjects(database) {
        const r = await this.json("SELECT name, engine, total_rows FROM system.tables WHERE database = {p1:String} AND NOT is_temporary AND name NOT LIKE '.inner%' ORDER BY name", undefined, [database || this.defaultDb]);
        return r.rows.map(row => ({
            name: String(row.name),
            type: VIEW_ENGINES.test(String(row.engine)) ? "view" : "table",
            rows: row.total_rows === null || row.total_rows === undefined ? undefined : Number(row.total_rows)
        }));
    }
    async introspect(target) {
        const database = target.database || this.defaultDb;
        const [columns, table] = await Promise.all([
            this.json("SELECT name, type, default_kind, default_expression, is_in_primary_key FROM system.columns WHERE database = {p1:String} AND table = {p2:String} ORDER BY position", undefined, [database, target.object]),
            this.json("SELECT engine FROM system.tables WHERE database = {p1:String} AND name = {p2:String}", undefined, [database, target.object])
        ]);
        const engine = String(table.rows[0]?.engine ?? "");
        const isView = VIEW_ENGINES.test(engine);
        return {
            columns: columns.rows.map(r => {
                const dataType = String(r.type);
                const kind = String(r.default_kind ?? "");
                return {
                    name: String(r.name),
                    dataType,
                    category: (0, sql_builder_1.categorize)(dataType),
                    nullable: /^(LowCardinality\()?Nullable\(/.test(dataType),
                    primaryKey: Number(r.is_in_primary_key) === 1,
                    autoIncrement: false,
                    defaultValue: r.default_expression ? String(r.default_expression) : null,
                    // MATERIALIZED and ALIAS columns are computed; they cannot be inserted.
                    editable: kind !== "MATERIALIZED" && kind !== "ALIAS",
                    sortable: !/^(Array|Map|Tuple|Object|JSON|Nested)/.test(dataType.replace(/^Nullable\(/, ""))
                };
            }),
            isView,
            hasRowid: false,
            dropKeyword: isView ? "VIEW" : engine === "Dictionary" ? "DICTIONARY" : "TABLE"
        };
    }
    async indexes(target) {
        const database = target.database || this.defaultDb;
        const [table, skipping] = await Promise.all([
            this.json("SELECT primary_key, sorting_key, partition_key FROM system.tables WHERE database = {p1:String} AND name = {p2:String}", undefined, [database, target.object]),
            this.json("SELECT name, type, expr, granularity FROM system.data_skipping_indices WHERE database = {p1:String} AND table = {p2:String} ORDER BY name", undefined, [database, target.object])
        ]);
        const t = table.rows[0] ?? {};
        const split = (v) => String(v ?? "").split(",").map(s => s.trim()).filter(Boolean);
        const out = [];
        if (split(t.primary_key).length)
            out.push({ name: "PRIMARY KEY", columns: split(t.primary_key), unique: false, primary: true, type: "sparse" });
        if (split(t.sorting_key).length && String(t.sorting_key) !== String(t.primary_key))
            out.push({ name: "ORDER BY", columns: split(t.sorting_key), unique: false, primary: false, type: "sorting key" });
        if (split(t.partition_key).length)
            out.push({ name: "PARTITION BY", columns: [String(t.partition_key)], unique: false, primary: false, type: "partition key" });
        for (const r of skipping.rows)
            out.push({ name: String(r.name), columns: [String(r.expr)], unique: false, primary: false, type: String(r.type), detail: `granularity ${r.granularity}` });
        return out;
    }
    /** Inserts one row as JSONEachRow, so every value keeps its type without building literals. */
    async insert(target, values) {
        const meta = await this.tableMeta(target);
        if (meta.isView)
            throw new types_1.DbError("Views are read-only here.");
        const row = {};
        for (const [name, input] of Object.entries(values ?? {})) {
            const column = (0, sql_builder_1.requireColumn)(meta.columns, name);
            if (input.mode === "default")
                continue;
            if (!column.editable)
                throw new types_1.DbError(`${name} is computed and cannot be set.`);
            if (input.mode === "null") {
                if (!column.nullable)
                    throw new types_1.DbError(`${column.name} cannot be NULL.`);
                row[name] = null;
            }
            else if (column.category === "json") {
                try {
                    row[name] = JSON.parse(String(input.value ?? ""));
                }
                catch (error) {
                    throw new types_1.DbError(`${name} must be valid JSON: ${error.message}`);
                }
            }
            else if (column.category === "boolean") {
                row[name] = (0, sql_builder_1.coerceInput)(input, column, "clickhouse") === "true";
            }
            else {
                row[name] = (0, sql_builder_1.coerceInput)(input, column, "clickhouse");
            }
        }
        const r = await this.request(`INSERT INTO ${(0, sql_builder_1.qualifiedName)({ ...target, database: target.database || this.defaultDb }, "clickhouse")} FORMAT JSONEachRow\n${JSON.stringify(row)}`, { database: target.database });
        return Number(r.summary.written_rows ?? 1) || 1;
    }
    async runQuery(text, context, control) {
        const start = Date.now();
        const statements = this.classify(text);
        let shown;
        let message;
        let affected = 0;
        try {
            for (const statement of statements) {
                const queryId = `devsnip-${(0, crypto_1.randomUUID)()}`;
                const abort = new AbortController();
                control?.onCancel(async () => {
                    abort.abort();
                    await this.request("KILL QUERY WHERE query_id = {p1:String}", { params: [queryId] }).catch(() => undefined);
                });
                let response;
                try {
                    response = await this.send(statement.text, { database: context.database, format: "JSONCompactEachRowWithNamesAndTypes", queryId, signal: abort.signal });
                }
                catch (error) {
                    const e = error;
                    if (typeof e.chPosition === "number")
                        e.devsnipPosition = statement.offset + e.chPosition;
                    throw error;
                }
                const read = await readCompactRows(response, types_1.LIMITS.maxQueryRows, () => abort.abort());
                let summary = {};
                try {
                    summary = JSON.parse(response.headers.get("x-clickhouse-summary") ?? "{}");
                }
                catch { /* optional */ }
                if (read.columns.length) {
                    shown = read;
                    message = undefined;
                }
                else if (read.raw.trim())
                    message = read.raw.trim().slice(0, 20000);
                affected += Number(summary.written_rows ?? 0);
            }
        }
        finally {
            if (statements.some(s => s.write))
                this.invalidate();
        }
        if (shown)
            return { ...this.queryResult(start, shown.rows, shown.columns, undefined, types_1.LIMITS.maxQueryRows), truncated: shown.truncated };
        return this.queryResult(start, [], [], affected || undefined, types_1.LIMITS.maxQueryRows, message ?? `${[...new Set(statements.map(s => s.verb.toUpperCase()))].join(", ")} completed${affected ? `, ${affected} row${affected === 1 ? "" : "s"} written` : ""}.`);
    }
}
exports.ClickHouseAdapter = ClickHouseAdapter;
function anySignal(signals) {
    const controller = new AbortController();
    for (const s of signals) {
        if (s.aborted) {
            controller.abort(s.reason);
            break;
        }
        s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
    }
    return controller.signal;
}
/** Turns a ClickHouse error body into an Error the shared mapper understands. */
function chError(status, code, body) {
    let message = body.trim();
    // The exception arrives as {"exception": ...} (JSON), as ["Code: ..."] (compact formats) or as plain text.
    for (const line of [body, ...body.split("\n")].reverse()) {
        try {
            const parsed = JSON.parse(line);
            const text = Array.isArray(parsed) ? parsed.find(v => typeof v === "string" && /DB::Exception/.test(v)) : parsed?.exception;
            if (typeof text === "string") {
                message = text;
                break;
            }
        }
        catch { /* not JSON */ }
    }
    const plain = /Code: \d+\. DB::Exception: [\s\S]*/.exec(message);
    if (plain)
        message = plain[0];
    // Syntax errors list every token the parser expected; the first sentence says what matters.
    message = message.replace(/\. Expected one of: [\s\S]*$/, ".").trim();
    const error = new Error(message || `ClickHouse answered HTTP ${status}.`);
    if (code)
        error.code = /^\d+$/.test(code) ? `CH${code}` : code;
    const position = /failed at position (\d+)/i.exec(message);
    if (position)
        error.chPosition = Number(position[1]) - 1;
    return error;
}
/**
 * Reads JSONCompactEachRowWithNamesAndTypes line by line, stopping after
 * `limit` rows so a huge result never reaches memory.
 */
async function readCompactRows(response, limit, stop) {
    const reader = response.body?.getReader();
    if (!reader)
        return { rows: [], columns: [], truncated: false, raw: "" };
    const decoder = new TextDecoder();
    let buffer = "";
    let columns = [];
    let line = 0;
    const rows = [];
    let raw = "";
    let truncated = false;
    const take = (text) => {
        if (!text.trim())
            return;
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            // A mid-stream error, or a FORMAT the user chose: keep it as text.
            if (/^Code: \d+\. DB::Exception/.test(text.trim()))
                throw chError(200, null, text);
            raw += text + "\n";
            return;
        }
        if (parsed && !Array.isArray(parsed) && typeof parsed === "object" && "exception" in parsed)
            throw chError(200, null, String(parsed.exception));
        if (!Array.isArray(parsed)) {
            raw += text + "\n";
            return;
        }
        line++;
        if (line === 1) {
            columns = parsed.map(String);
            return;
        }
        if (line === 2)
            return; // types
        if (rows.length >= limit) {
            truncated = true;
            return;
        }
        const row = {};
        columns.forEach((c, i) => { row[c] = parsed instanceof Array ? parsed[i] : undefined; });
        rows.push(row);
    };
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf("\n")) >= 0) {
                take(buffer.slice(0, nl));
                buffer = buffer.slice(nl + 1);
                if (truncated)
                    break;
            }
            if (truncated) {
                stop();
                await reader.cancel().catch(() => undefined);
                break;
            }
            if (raw.length > 1000000) {
                stop();
                await reader.cancel().catch(() => undefined);
                break;
            }
        }
        if (!truncated)
            take(buffer + decoder.decode());
    }
    finally {
        reader.releaseLock?.();
    }
    return { rows, columns, truncated, raw };
}
//# sourceMappingURL=clickhouse.js.map