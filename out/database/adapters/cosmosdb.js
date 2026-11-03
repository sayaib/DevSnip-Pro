"use strict";
/**
 * Azure Cosmos DB for NoSQL through its REST API, signed with the account
 * key (no Azure SDK).
 *
 * Queries are sent to each physical partition (partition key range) on its
 * own, which lets the gateway run ORDER BY, OFFSET/LIMIT and aggregates that
 * it refuses across partitions; results from several ranges are merged here.
 * Most containers have one range, where the result is exact.
 *
 * Rows carry a hidden `__pk` column (the partition key value as JSON) so an
 * edit or delete addresses the right partition.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CosmosAdapter = exports.partitionKeyHeader = exports.valueAtPath = exports.PK_COLUMN = void 0;
const azure_1 = require("../cloud-auth/azure");
const http_1 = require("../cloud-auth/http");
const types_1 = require("../types");
const values_1 = require("../values");
const document_base_1 = require("./document-base");
exports.PK_COLUMN = "__pk";
const SYSTEM = ["_rid", "_self", "_attachments"];
const API_VERSION = "2018-12-31";
/** The value at a partition key path such as /tenantId or /address/zip; undefined when missing. */
function valueAtPath(doc, path) {
    let value = doc;
    for (const part of path.split("/").filter(Boolean)) {
        if (!value || typeof value !== "object")
            return undefined;
        value = value[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return value;
}
exports.valueAtPath = valueAtPath;
/** The x-ms-documentdb-partitionkey header for a document: a JSON array, {} for a missing value. */
function partitionKeyHeader(doc, paths) {
    return JSON.stringify(paths.map(p => { const v = valueAtPath(doc, p); return v === undefined ? {} : v; }));
}
exports.partitionKeyHeader = partitionKeyHeader;
const field = (name) => {
    if (typeof name !== "string" || !name || name.length > 255)
        throw new types_1.DbError("Invalid field name.");
    return `c[${JSON.stringify(name)}]`;
};
function typeOf(value) {
    if (value === null || value === undefined)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value === "object" ? "object" : typeof value;
}
/** A filter value typed in the grid: JSON (42, true, null, "text") or plain text. */
function filterValue(raw) {
    const text = raw.trim();
    try {
        return JSON.parse(text);
    }
    catch {
        return raw;
    }
}
class CosmosAdapter {
    constructor(spec) {
        this.spec = spec;
        this.kind = "cosmosdb";
        this.containers = new Map();
        const local = /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(spec.endpoint ?? "");
        this.insecure = local || /^(true|1|yes)$/i.test(spec.options.disableservercertificatevalidation ?? spec.options.insecure ?? "");
    }
    async request(method, path, resourceType, resourceLink, what, options = {}) {
        const date = new Date().toUTCString();
        const response = await (0, http_1.httpRequest)({
            method,
            url: `${this.spec.endpoint}/${path}`,
            headers: {
                authorization: (0, azure_1.cosmosAuthorization)(method, resourceType, resourceLink, date, this.spec.password ?? ""),
                "x-ms-date": date,
                "x-ms-version": API_VERSION,
                accept: "application/json",
                ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
                ...options.headers
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            insecure: this.insecure
        });
        if (response.status === 409)
            throw new types_1.DbError("A document with this id already exists in that partition.", "Change the id, or edit the existing document.", "CONFLICT");
        if (response.status === 404 && method !== "GET" && resourceType === "docs")
            throw new types_1.DbError("The document no longer exists. Refresh and try again.");
        return { json: (0, http_1.expectJson)(response, what), headers: response.headers };
    }
    static link(...parts) {
        return { path: parts.map(encodeURIComponent).join("/"), link: parts.join("/") };
    }
    async connect() {
        const { json } = await this.request("GET", "", "", "", "Connecting to Cosmos DB");
        const emulator = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(this.spec.endpoint ?? "");
        return { version: emulator ? "Azure Cosmos DB Emulator (NoSQL)" : `Azure Cosmos DB for NoSQL (${json.id ?? this.spec.host})`, defaultDatabase: this.spec.database || undefined };
    }
    async close() {
        this.containers.clear();
    }
    async ping() {
        await this.request("GET", "", "", "", "Ping");
    }
    invalidate() {
        this.containers.clear();
    }
    async listDatabases() {
        const { json } = await this.request("GET", "dbs", "dbs", "", "Listing databases");
        const names = (json.Databases ?? []).map(d => d.id).sort();
        if (this.spec.database && !names.includes(this.spec.database))
            names.unshift(this.spec.database);
        return names;
    }
    async listSchemas() {
        return [];
    }
    async listObjects(database) {
        const db = CosmosAdapter.link("dbs", database);
        const { json } = await this.request("GET", `${db.path}/colls`, "colls", db.link, "Listing containers");
        return (json.DocumentCollections ?? []).map(c => ({ name: c.id, type: "collection" })).sort((a, b) => a.name.localeCompare(b.name));
    }
    async container(target) {
        if (!target.database)
            throw new types_1.DbError("No database selected.");
        if (!target.object)
            throw new types_1.DbError("No container selected.");
        const key = `${target.database}\u0000${target.object}`;
        const c = CosmosAdapter.link("dbs", target.database, "colls", target.object);
        let cached = this.containers.get(key);
        if (!cached || Date.now() - cached.at > 60000) {
            const [{ json: container }, { json: ranges }] = await Promise.all([
                this.request("GET", c.path, "colls", c.link, "Reading the container"),
                this.request("GET", `${c.path}/pkranges`, "pkranges", c.link, "Reading partitions")
            ]);
            cached = { at: Date.now(), container, ranges: (ranges.PartitionKeyRanges ?? []).map(r => r.id) };
            this.containers.set(key, cached);
        }
        return { container: cached.container, ranges: cached.ranges?.length ? cached.ranges : ["0"], link: c.link, path: c.path };
    }
    pkPaths(container) {
        return container.partitionKey?.paths ?? [];
    }
    /** Runs a query on one partition key range, following continuations up to `max` documents. */
    async queryRange(path, link, range, query, parameters, max) {
        const out = [];
        let continuation;
        do {
            const { json, headers } = await this.request("POST", `${path}/docs`, "docs", link, "The query", {
                body: { query, parameters },
                headers: {
                    "content-type": "application/query+json",
                    "x-ms-documentdb-isquery": "True",
                    "x-ms-documentdb-query-enablecrosspartition": "True",
                    "x-ms-documentdb-partitionkeyrangeid": range,
                    "x-ms-max-item-count": String(Math.min(1000, Math.max(1, max - out.length))),
                    ...(continuation ? { "x-ms-continuation": continuation } : {})
                }
            });
            out.push(...(json.Documents ?? []));
            continuation = headers["x-ms-continuation"] || undefined;
        } while (continuation && out.length < max);
        return out;
    }
    /** Drops the system properties nobody edits (_rid, _self, _attachments); _etag and _ts stay visible. */
    shape(doc) {
        const row = {};
        for (const [k, v] of Object.entries(doc))
            if (!SYSTEM.includes(k))
                row[k] = v;
        return row;
    }
    async describe(target) {
        const { container, ranges, link, path } = await this.container(target);
        const cached = this.containers.get(`${target.database}\u0000${target.object}`);
        if (cached?.columns)
            return cached.columns;
        const docs = (await this.queryRange(path, link, ranges[0], `SELECT TOP ${types_1.LIMITS.mongoSample} * FROM c`, [], types_1.LIMITS.mongoSample));
        const columns = this.columnsFor(docs.map(d => this.shape(d)), container);
        if (cached)
            cached.columns = columns;
        return columns;
    }
    columnsFor(docs, container) {
        const pkTop = this.pkPaths(container).map(p => p.split("/").filter(Boolean)).filter(parts => parts.length === 1 && parts[0] !== "id").map(parts => parts[0]);
        const columns = (0, document_base_1.inferColumns)(docs, [{ name: "id", type: "string" }, ...pkTop.map(name => ({ name, type: "partition key" }))], typeOf, t => (t === "partition key" ? "string" : t === "array" || t === "object" ? "json" : t));
        for (const column of columns) {
            column.sortable = column.category !== "json";
            if (column.name === "_etag" || column.name === "_ts")
                column.editable = false;
        }
        return columns;
    }
    where(request, columns, params) {
        const add = (value) => { const name = `@p${params.length}`; params.push({ name, value }); return name; };
        const parts = [];
        const base = (request.query ?? "").trim().replace(/^where\s+/i, "");
        if (base) {
            if (base.length > 8000)
                throw new types_1.DbError("The condition is too long.");
            parts.push(`(${base})`);
        }
        for (const rule of request.filters ?? [])
            parts.push(this.ruleClause(rule, add));
        const search = (request.search ?? "").trim();
        if (search) {
            const fields = columns.filter(c => c.category === "text").slice(0, 25);
            if (fields.length) {
                const p = add(search);
                parts.push(`(${fields.map(c => `CONTAINS(${field(c.name)}, ${p}, true)`).join(" OR ")})`);
            }
        }
        return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
    }
    ruleClause(rule, add) {
        if (!types_1.FILTER_OPS.includes(rule.op))
            throw new types_1.DbError(`Unknown filter operator "${rule.op}".`);
        const f = field(rule.column);
        const value = String(rule.value ?? "");
        switch (rule.op) {
            case "null": return `(NOT IS_DEFINED(${f}) OR IS_NULL(${f}))`;
            case "notnull": return `(IS_DEFINED(${f}) AND NOT IS_NULL(${f}))`;
            case "contains": return `CONTAINS(${f}, ${add(value)}, true)`;
            case "starts": return `STARTSWITH(${f}, ${add(value)}, true)`;
            case "ends": return `ENDSWITH(${f}, ${add(value)}, true)`;
            case "in": {
                const items = value.split(",").map(s => s.trim()).filter(Boolean);
                if (!items.length)
                    throw new types_1.DbError(`"in" on ${rule.column} needs a comma-separated list.`);
                if (items.length > 256)
                    throw new types_1.DbError("An \"in\" filter takes at most 256 values.");
                return `${f} IN (${items.map(item => add(filterValue(item))).join(", ")})`;
            }
            default: {
                const op = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[rule.op];
                return `${f} ${op} ${add(filterValue(value))}`;
            }
        }
    }
    async fetchPage(request) {
        const start = Date.now();
        const { container, ranges, link, path } = await this.container(request.target);
        const known = await this.describe(request.target);
        const params = [];
        const where = this.where(request, known, params);
        const pageSize = Math.max(1, Math.min(types_1.LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
        const page = Math.max(1, Math.floor(Number(request.page) || 1));
        const offset = (page - 1) * pageSize;
        const order = request.sort ? ` ORDER BY ${field(request.sort.column)} ${request.sort.dir === "desc" ? "DESC" : "ASC"}` : "";
        let docs;
        let total = null;
        const countQuery = `SELECT VALUE COUNT(1) FROM c${where}`;
        if (ranges.length === 1) {
            const [rows, count] = await Promise.all([
                this.queryRange(path, link, ranges[0], `SELECT * FROM c${where}${order} OFFSET ${offset} LIMIT ${pageSize}`, params, pageSize),
                this.queryRange(path, link, ranges[0], countQuery, params, 1).catch(() => undefined)
            ]);
            docs = rows;
            total = count && typeof count[0] === "number" ? count[0] : null;
        }
        else {
            // Several physical partitions: each returns its first offset+pageSize, merged and sorted here.
            if (offset + pageSize > 5000)
                throw new types_1.DbError("This page is too deep for a multi-partition container.", "Add a filter, or sort, to reach these documents.");
            const parts = await Promise.all(ranges.map(r => this.queryRange(path, link, r, `SELECT * FROM c${where}${order} OFFSET 0 LIMIT ${offset + pageSize}`, params, offset + pageSize)));
            let merged = parts.flat();
            if (request.sort) {
                const column = request.sort.column;
                const dir = request.sort.dir === "desc" ? -1 : 1;
                merged = merged.sort((a, b) => dir * compareJson(a[column], b[column]));
            }
            docs = merged.slice(offset, offset + pageSize);
            const counts = await Promise.all(ranges.map(r => this.queryRange(path, link, r, countQuery, params, 1).catch(() => undefined)));
            total = counts.every(c => c && typeof c[0] === "number") ? counts.reduce((sum, c) => sum + c[0], 0) : null;
        }
        const paths = this.pkPaths(container);
        const rows = docs.map(d => ({ ...this.shape(d), [exports.PK_COLUMN]: partitionKeyHeader(d, paths) }));
        const columns = this.columnsFor(docs.map(d => this.shape(d)), container);
        for (const column of known)
            if (!columns.some(c => c.name === column.name))
                columns.push(column);
        return {
            columns,
            rows: rows.map(values_1.encodeRow),
            total,
            keyColumns: ["id", exports.PK_COLUMN],
            keyStrategy: "primary",
            note: ranges.length > 1 ? `Merged from ${ranges.length} physical partitions.` : undefined,
            elapsedMs: (0, values_1.since)(start)
        };
    }
    docLink(target, id) {
        if (typeof id !== "string" || !id)
            throw new types_1.DbError("The document has no id.", "Cosmos DB documents need a string id.");
        if (/[/\\?#]/.test(id))
            throw new types_1.DbError("This document's id contains / \\ ? or #, which the REST API cannot address.", "Change it from the Data Explorer in the portal.");
        return CosmosAdapter.link("dbs", target.database ?? "", "colls", target.object, "docs", id);
    }
    async insert(target, values) {
        const { container, link, path } = await this.container(target);
        const doc = (0, document_base_1.parseJsonDocument)(values);
        for (const k of [...SYSTEM, "_etag", "_ts"])
            delete doc[k];
        if (typeof doc.id !== "string" || !doc.id)
            throw new types_1.DbError("Give the document a string \"id\".");
        this.docLink(target, doc.id);
        await this.request("POST", `${path}/docs`, "docs", link, "Inserting", { body: doc, headers: { "x-ms-documentdb-partitionkey": partitionKeyHeader(doc, this.pkPaths(container)) } });
        return 1;
    }
    async update(target, key, _strategy, values) {
        const { container } = await this.container(target);
        const doc = (0, document_base_1.parseJsonDocument)(values);
        for (const k of [...SYSTEM, "_etag", "_ts"])
            delete doc[k];
        if (doc.id !== key.id)
            throw new types_1.DbError("The id cannot be changed.", "Duplicate the document with the new id, then delete the old one.");
        const pk = partitionKeyHeader(doc, this.pkPaths(container));
        if (pk !== key[exports.PK_COLUMN])
            throw new types_1.DbError("The partition key value cannot be changed.", "Duplicate the document with the new value, then delete the old one.");
        const d = this.docLink(target, String(key.id));
        await this.request("PUT", d.path, "docs", d.link, "Saving", { body: doc, headers: { "x-ms-documentdb-partitionkey": pk } });
        return 1;
    }
    async remove(target, keys) {
        if (!Array.isArray(keys) || !keys.length)
            throw new types_1.DbError("Select at least one document.");
        let removed = 0;
        for (let i = 0; i < keys.length; i += 8) {
            await Promise.all(keys.slice(i, i + 8).map(async (key) => {
                const d = this.docLink(target, String(key.id ?? ""));
                const pk = String(key[exports.PK_COLUMN] ?? "");
                if (!pk.startsWith("["))
                    throw new types_1.DbError("The partition key is missing. Refresh and try again.");
                await this.request("DELETE", d.path, "docs", d.link, "Deleting", { headers: { "x-ms-documentdb-partitionkey": pk } });
                removed++;
            }));
        }
        return removed;
    }
    async indexes(target) {
        const { container } = await this.container(target);
        const policy = container.indexingPolicy ?? {};
        const out = [{ name: "Partition key", columns: this.pkPaths(container), unique: false, primary: true, type: container.partitionKey?.kind ?? "Hash" }];
        if (policy.indexingMode)
            out.push({ name: "Indexing mode", columns: [], unique: false, primary: false, type: policy.indexingMode });
        for (const p of policy.includedPaths ?? [])
            out.push({ name: "Included path", columns: [p.path], unique: false, primary: false, type: "range" });
        for (const p of policy.excludedPaths ?? [])
            out.push({ name: "Excluded path", columns: [p.path], unique: false, primary: false, detail: "not indexed" });
        (policy.compositeIndexes ?? []).forEach((ix, i) => out.push({ name: `Composite ${i + 1}`, columns: ix.map(p => `${p.path}${p.order === "descending" ? " DESC" : ""}`), unique: false, primary: false, type: "composite" }));
        for (const p of policy.spatialIndexes ?? [])
            out.push({ name: "Spatial", columns: [p.path], unique: false, primary: false, type: "spatial" });
        return out;
    }
    async drop(target) {
        const c = CosmosAdapter.link("dbs", target.database ?? "", "colls", target.object);
        await this.request("DELETE", c.path, "colls", c.link, "Deleting the container");
        this.invalidate();
    }
    async truncate(target) {
        const { container, ranges, link, path } = await this.container(target);
        const paths = this.pkPaths(container);
        for (const range of ranges) {
            for (;;) {
                const docs = (await this.queryRange(path, link, range, "SELECT * FROM c", [], 500));
                if (!docs.length)
                    break;
                await this.remove(target, docs.map(d => ({ id: d.id, [exports.PK_COLUMN]: partitionKeyHeader(d, paths) })));
            }
        }
    }
    classify(text) {
        const query = text.trim().replace(/;\s*$/, "");
        if (!query)
            throw new types_1.DbError("Enter a query to run.");
        if (!/^select\b/i.test(query))
            throw new types_1.DbError("Cosmos DB queries start with SELECT.", "Change documents from the grid: open the container and edit, insert or delete.");
        return [{ verb: "select", write: false }];
    }
    /** The container a console query reads: the name after FROM, or the database's only container. */
    async queryContainer(query, database) {
        const names = (await this.listObjects(database)).map(o => o.name);
        const from = /\bfrom\s+(?:root\s*\.\s*)?([A-Za-z_][\w-]*)/i.exec(query)?.[1];
        if (from && names.includes(from))
            return from;
        if (names.length === 1)
            return names[0];
        throw new types_1.DbError(names.length ? "Name the container after FROM, e.g. SELECT * FROM users u WHERE u.active = true" : `The database ${database} has no containers.`, names.length ? `Containers in ${database}: ${names.slice(0, 10).join(", ")}${names.length > 10 ? "…" : ""}.` : undefined);
    }
    async runQuery(text, context) {
        const start = Date.now();
        this.classify(text);
        const query = text.trim().replace(/;\s*$/, "");
        const database = context.database || this.spec.database || (await this.listDatabases())[0];
        if (!database)
            throw new types_1.DbError("Pick a database to query.");
        const target = { database, object: await this.queryContainer(query, database) };
        const { ranges, link, path } = await this.container(target);
        const parts = await Promise.all(ranges.map(r => this.queryRange(path, link, r, query, [], types_1.LIMITS.maxQueryRows + 1)));
        const docs = parts.flat();
        const rows = docs.slice(0, types_1.LIMITS.maxQueryRows).map(d => (d && typeof d === "object" && !Array.isArray(d) ? this.shape(d) : d));
        return (0, document_base_1.documentsResult)(start, rows, docs.length > types_1.LIMITS.maxQueryRows, ranges.length > 1 ? `Ran on ${ranges.length} physical partitions of ${target.object}; ORDER BY, TOP and aggregates apply within each partition.` : undefined);
    }
}
exports.CosmosAdapter = CosmosAdapter;
function compareJson(a, b) {
    const rank = (v) => (v === undefined ? 0 : v === null ? 1 : typeof v === "boolean" ? 2 : typeof v === "number" ? 3 : typeof v === "string" ? 4 : 5);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb)
        return ra - rb;
    if (typeof a === "number" && typeof b === "number")
        return a - b;
    if (typeof a === "string" && typeof b === "string")
        return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === "boolean" && typeof b === "boolean")
        return Number(a) - Number(b);
    return 0;
}
//# sourceMappingURL=cosmosdb.js.map