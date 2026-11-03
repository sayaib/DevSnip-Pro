"use strict";
/**
 * BigQuery through the REST API, with the shared SQL grid on the GoogleSQL
 * dialect. The project is the one "database"; datasets are its schemas.
 *
 * Cost matters here: an unfiltered page of a table is read with
 * tabledata.list, which is free; filters, sorting, views and console
 * queries run as query jobs, billed by bytes scanned, and the page says how
 * much each one scanned. `maxbytesbilled` caps what a single job may cost.
 * Tables have no keys, so the grid is read-only; DML runs in the Query tab.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BigQueryAdapter = exports.decodeBigQuery = void 0;
const gcp_1 = require("../cloud-auth/gcp");
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const values_1 = require("../values");
const sql_base_1 = require("./sql-base");
const READ_ONLY = "BigQuery tables have no primary key, so rows are browsed read-only here. Use INSERT, UPDATE or DELETE in the Query tab.";
/** Microseconds since the epoch (or seconds as a float) as an ISO timestamp keeping the microseconds. */
function timestamp(value) {
    if (/^-?\d+$/.test(value) && value.length > 12) {
        const micros = BigInt(value);
        const ms = Number(micros / 1000n);
        const rest = Number(((micros % 1000n) + 1000n) % 1000n);
        return new Date(ms).toISOString().replace("Z", `${String(rest).padStart(3, "0")}Z`).replace(/\.(\d{3})000Z$/, ".$1Z").replace(/\.000Z$/, "Z");
    }
    const seconds = Number(value);
    return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : value;
}
/** A BigQuery cell ({v: ...}) as a JS value, by its schema field. */
function decodeBigQuery(value, field, repeatedDone = false) {
    if (value === null || value === undefined)
        return null;
    if (field.mode === "REPEATED" && !repeatedDone)
        return Array.isArray(value) ? value.map(item => decodeBigQuery(item?.v, field, true)) : value;
    const type = field.type.toUpperCase();
    if (type === "RECORD" || type === "STRUCT") {
        const cells = value?.f ?? [];
        const out = {};
        (field.fields ?? []).forEach((f, i) => { out[f.name] = decodeBigQuery(cells[i]?.v, f); });
        return out;
    }
    const text = String(value);
    switch (type) {
        case "INTEGER":
        case "INT64": {
            const n = Number(text);
            return Number.isSafeInteger(n) ? n : text;
        }
        case "FLOAT":
        case "FLOAT64": {
            const n = Number(text);
            return Number.isFinite(n) ? n : text;
        }
        case "BOOLEAN":
        case "BOOL":
            return text === "true";
        case "TIMESTAMP":
            return timestamp(text);
        case "BYTES":
            return Buffer.from(text, "base64");
        case "JSON":
            try {
                return JSON.parse(text);
            }
            catch {
                return text;
            }
        default:
            return text;
    }
}
exports.decodeBigQuery = decodeBigQuery;
function decodeRows(rows, fields) {
    return (rows ?? []).map(r => {
        const row = {};
        fields.forEach((f, i) => { row[f.name] = decodeBigQuery(r.f?.[i]?.v, f); });
        return row;
    });
}
function bytes(n) {
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) {
        n /= 1000;
        i++;
    }
    return `${i ? n.toFixed(n < 10 ? 2 : 1) : n} ${units[i]}`;
}
/** "Scanned 1.2 GB, billed 1.2 GB" (or "Served from cache") for a finished job. */
function costNote(r) {
    if (r.cacheHit)
        return "Served from cache (no bytes billed).";
    if (r.totalBytesProcessed === undefined)
        return undefined;
    const processed = Number(r.totalBytesProcessed);
    const billed = r.totalBytesBilled !== undefined ? Number(r.totalBytesBilled) : undefined;
    return `Scanned ${bytes(processed)}${billed !== undefined && billed !== processed ? `, billed ${bytes(billed)}` : ""}.`;
}
class BigQueryAdapter extends sql_base_1.SqlAdapter {
    constructor(spec) {
        super();
        this.spec = spec;
        this.kind = "bigquery";
        this.dialect = "googlesql";
        this.tables = new Map();
        this.project = spec.project ?? "";
        this.api = new gcp_1.GoogleApi(spec, `${spec.endpoint ?? "https://bigquery.googleapis.com"}/bigquery/v2`);
    }
    get p() {
        return `projects/${encodeURIComponent(this.project)}`;
    }
    /** Starts a query job and waits for its first page of rows. */
    async query(sql, params, options) {
        const body = {
            query: sql,
            useLegacySql: false,
            maxResults: options.maxResults,
            timeoutMs: 10000,
            formatOptions: { useInt64Timestamp: true },
            ...(this.spec.region ? { location: this.spec.region } : {}),
            ...(this.spec.options.maxbytesbilled ? { maximumBytesBilled: this.spec.options.maxbytesbilled } : {}),
            ...(options.dataset ? { defaultDataset: { projectId: this.project, datasetId: options.dataset } } : {})
        };
        if (params.length) {
            body.parameterMode = "NAMED";
            body.queryParameters = params.map((v, i) => ({ name: `p${i + 1}`, parameterType: { type: "STRING" }, parameterValue: v === null || v === undefined ? {} : { value: String(v) } }));
        }
        const abort = new AbortController();
        let result = await this.api.call("POST", `${this.p}/queries`, "The query", body, abort.signal);
        const job = result.jobReference;
        options.control?.onCancel(async () => {
            abort.abort();
            if (job)
                await this.api.call("POST", `${this.p}/jobs/${encodeURIComponent(job.jobId)}/cancel${job.location ? `?location=${encodeURIComponent(job.location)}` : ""}`, "Cancelling").catch(() => undefined);
        });
        const deadline = Date.now() + types_1.LIMITS.queryTimeoutMs;
        while (!result.jobComplete && job) {
            if (Date.now() > deadline) {
                await this.api.call("POST", `${this.p}/jobs/${encodeURIComponent(job.jobId)}/cancel${job.location ? `?location=${encodeURIComponent(job.location)}` : ""}`, "Cancelling").catch(() => undefined);
                throw new types_1.DbError(`The query timed out after ${types_1.LIMITS.queryTimeoutMs / 1000} seconds and was cancelled.`, "Narrow the query, or run it in the BigQuery console.");
            }
            result = await this.api.call("GET", `${this.p}/queries/${encodeURIComponent(job.jobId)}?maxResults=${options.maxResults}&timeoutMs=10000&formatOptions.useInt64Timestamp=true${job.location ? `&location=${encodeURIComponent(job.location)}` : ""}`, "Waiting for the query", undefined, abort.signal);
        }
        return { ...result, fields: result.schema?.fields ?? [] };
    }
    async exec(_database, sql, params) {
        const result = await this.query(sql, params, { maxResults: types_1.LIMITS.maxPageSize + 1 });
        this.lastNote = costNote(result);
        return { rows: decodeRows(result.rows, result.fields), columns: result.fields.map(f => f.name), affected: result.numDmlAffectedRows !== undefined ? Number(result.numDmlAffectedRows) : undefined };
    }
    async connect() {
        if (!this.project)
            throw new types_1.DbError("Add the Google Cloud project ID.");
        await this.api.call("GET", `${this.p}/datasets?maxResults=1`, "Connecting to BigQuery");
        return { version: this.api.auth.emulator ? "BigQuery emulator" : "BigQuery", defaultDatabase: this.project };
    }
    async close() {
        this.tables.clear();
    }
    async ping() {
        await this.api.call("GET", `${this.p}/datasets?maxResults=1`, "Ping");
    }
    invalidate() {
        super.invalidate();
        this.tables.clear();
    }
    async listDatabases() {
        return [this.project];
    }
    async listSchemas() {
        const names = [];
        let token;
        do {
            const page = await this.api.call("GET", `${this.p}/datasets?maxResults=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, "Listing datasets");
            names.push(...(page.datasets ?? []).map(d => d.datasetReference.datasetId));
            token = page.nextPageToken;
        } while (token && names.length < 5000);
        const preferred = this.spec.options.dataset;
        return names.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b)));
    }
    async listObjects(_database, schema) {
        if (!schema)
            throw new types_1.DbError("Pick a dataset.");
        const out = [];
        let token;
        do {
            const page = await this.api.call("GET", `${this.p}/datasets/${encodeURIComponent(schema)}/tables?maxResults=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, "Listing tables");
            for (const t of page.tables ?? [])
                out.push({ name: t.tableReference.tableId, type: /VIEW/.test(t.type ?? "") ? "view" : "table" });
            token = page.nextPageToken;
        } while (token && out.length < 10000);
        return out.sort((a, b) => a.name.localeCompare(b.name));
    }
    async table(target) {
        if (!target.schema)
            throw new types_1.DbError("No dataset selected.");
        const key = `${target.schema}\u0000${target.object}`;
        const cached = this.tables.get(key);
        if (cached && Date.now() - cached.at < 60000)
            return cached;
        const t = await this.api.call("GET", `${this.p}/datasets/${encodeURIComponent(target.schema)}/tables/${encodeURIComponent(target.object)}`, "Reading the table");
        const entry = { at: Date.now(), type: t.type ?? "TABLE", numRows: t.numRows !== undefined ? Number(t.numRows) : undefined, fields: t.schema?.fields ?? [] };
        this.tables.set(key, entry);
        return entry;
    }
    async introspect(target) {
        const t = await this.table(target);
        const columns = t.fields.map(f => {
            const nested = f.type === "RECORD" || f.type === "STRUCT";
            const repeated = f.mode === "REPEATED";
            const dataType = `${repeated ? "ARRAY<" : ""}${nested ? `STRUCT<${(f.fields ?? []).map(x => `${x.name} ${x.type}`).join(", ")}>` : f.type}${repeated ? ">" : ""}`;
            return {
                name: f.name,
                dataType,
                category: nested || repeated ? "json" : (0, sql_builder_1.categorize)(f.type),
                nullable: f.mode !== "REQUIRED",
                primaryKey: false,
                autoIncrement: false,
                editable: false,
                sortable: !nested && !repeated && !/^(JSON|GEOGRAPHY)$/i.test(f.type)
            };
        });
        const isView = /VIEW/.test(t.type);
        return { columns, isView, hasRowid: false, noCtid: true, readOnly: READ_ONLY, dropKeyword: t.type === "MATERIALIZED_VIEW" ? "MATERIALIZED VIEW" : isView ? "VIEW" : "TABLE" };
    }
    async fetchPage(request) {
        const start = Date.now();
        const meta = await this.tableMeta(request.target);
        const t = await this.table(request.target);
        const pageSize = Math.max(1, Math.min(types_1.LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
        const page = Math.max(1, Math.floor(Number(request.page) || 1));
        const plain = !request.sort && !(request.filters ?? []).length && !(request.search ?? "").trim() && t.type === "TABLE";
        let rows;
        let total = null;
        let note;
        if (plain) {
            // tabledata.list reads stored rows without a query job, so browsing is free.
            const data = await this.api.call("GET", `${this.p}/datasets/${encodeURIComponent(request.target.schema ?? "")}/tables/${encodeURIComponent(request.target.object)}/data?startIndex=${(page - 1) * pageSize}&maxResults=${pageSize}&formatOptions.useInt64Timestamp=true`, "Reading rows");
            rows = decodeRows(data.rows, t.fields);
            total = data.totalRows !== undefined ? Number(data.totalRows) : t.numRows ?? null;
            note = "Read with tabledata.list (no query cost).";
        }
        else {
            const plan = (0, sql_builder_1.buildSelect)(request, meta.columns, "none", this.dialect);
            const result = await this.exec(request.target.database, plan.select.sql, plan.select.params);
            rows = result.rows;
            note = this.lastNote;
        }
        return {
            columns: meta.columns,
            rows: rows.map(values_1.encodeRow),
            total,
            hasMore: total === null ? rows.length === pageSize : undefined,
            keyColumns: [],
            keyStrategy: "none",
            readOnly: READ_ONLY,
            canInsert: false,
            note,
            elapsedMs: (0, values_1.since)(start)
        };
    }
    async drop(target) {
        await this.api.call("DELETE", `${this.p}/datasets/${encodeURIComponent(target.schema ?? "")}/tables/${encodeURIComponent(target.object)}`, "Deleting the table");
        this.invalidate();
    }
    async runQuery(text, context, control) {
        const start = Date.now();
        const statements = this.classify(text);
        // BigQuery runs a multi-statement script as one job and returns the last statement's rows.
        let result;
        try {
            result = await this.query(text, [], { dataset: context.schema || this.spec.options.dataset, maxResults: types_1.LIMITS.maxQueryRows + 1, control });
        }
        finally {
            if (statements.some(s => s.write))
                this.invalidate();
        }
        const rows = decodeRows(result.rows, result.fields);
        const affected = result.numDmlAffectedRows !== undefined ? Number(result.numDmlAffectedRows) : undefined;
        const cost = costNote(result);
        const message = result.fields.length ? undefined : `${statements.map(s => s.verb.toUpperCase()).join(", ")} completed${affected !== undefined ? `, ${affected} row${affected === 1 ? "" : "s"} affected` : ""}. ${cost ?? ""}`.trim();
        const out = this.queryResult(start, rows, result.fields.map(f => f.name), affected, types_1.LIMITS.maxQueryRows, message);
        return { ...out, truncated: out.truncated || !!result.pageToken, note: result.fields.length ? cost : undefined };
    }
}
exports.BigQueryAdapter = BigQueryAdapter;
//# sourceMappingURL=bigquery.js.map