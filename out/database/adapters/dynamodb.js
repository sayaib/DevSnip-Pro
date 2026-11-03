"use strict";
/**
 * Amazon DynamoDB through its JSON API, signed with SigV4 (no AWS SDK).
 *
 * The region is the one "database"; tables are the objects. The grid pages
 * through PartiQL SELECTs with NextToken cursors (a scan: there is no
 * server-side sort), and edits whole items with PutItem / BatchWriteItem,
 * conditioned so an insert never overwrites and a save never resurrects.
 *
 * Items are plain JSON in the UI. Values JSON cannot tell apart travel as
 * markers: {"$SS": [...]}, {"$NS": [...]}, {"$BS": [...]} for sets, and the
 * Extended JSON forms {"$binary": {"base64": ...}} for binary and
 * {"$numberDecimal": "..."} for numbers beyond double precision.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoAdapter = exports.attributeType = exports.toItem = exports.toAttribute = exports.fromItem = exports.fromAttribute = void 0;
const aws_1 = require("../cloud-auth/aws");
const http_1 = require("../cloud-auth/http");
const types_1 = require("../types");
const values_1 = require("../values");
const document_base_1 = require("./document-base");
const SAFE_DIGITS = 15;
const hashFirst = (a, b) => (a.KeyType === "HASH" ? 0 : 1) - (b.KeyType === "HASH" ? 0 : 1);
/** A DynamoDB number as JSON: a JS number when it survives the round trip, else a marker. */
function numberValue(text) {
    const n = Number(text);
    const digits = text.replace(/[eE].*$/, "").replace(/[^0-9]/g, "").replace(/^0+/, "").length;
    return Number.isFinite(n) && (Number.isSafeInteger(n) || digits <= SAFE_DIGITS) && !/[eE]/.test(text) ? n : { $numberDecimal: text };
}
function fromAttribute(value) {
    const [type, v] = Object.entries(value ?? {})[0] ?? ["NULL", true];
    switch (type) {
        case "S": return v;
        case "N": return numberValue(String(v));
        case "BOOL": return v === true;
        case "NULL": return null;
        case "B": return { $binary: { base64: v, subType: "00" } };
        case "M": return fromItem(v);
        case "L": return v.map(fromAttribute);
        case "SS": return { $SS: v };
        case "NS": return { $NS: v };
        case "BS": return { $BS: v };
        default: return v;
    }
}
exports.fromAttribute = fromAttribute;
function fromItem(item) {
    const out = {};
    for (const [k, v] of Object.entries(item ?? {}))
        out[k] = fromAttribute(v);
    return out;
}
exports.fromItem = fromItem;
const MARKERS = ["$numberDecimal", "$numberLong", "$binary", "$SS", "$NS", "$BS"];
function toAttribute(value, path = "value") {
    if (value === null || value === undefined)
        return { NULL: true };
    if (typeof value === "string")
        return { S: value };
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new types_1.DbError(`${path}: DynamoDB numbers must be finite.`);
        return { N: String(value) };
    }
    if (typeof value === "boolean")
        return { BOOL: value };
    if (Array.isArray(value))
        return { L: value.map((v, i) => toAttribute(v, `${path}[${i}]`)) };
    if (typeof value === "object") {
        const keys = Object.keys(value);
        if (keys.length === 1 && MARKERS.includes(keys[0])) {
            const marker = keys[0];
            const inner = value[marker];
            if (marker === "$binary") {
                const base64 = typeof inner === "string" ? inner : inner?.base64;
                if (typeof base64 !== "string")
                    throw new types_1.DbError(`${path}: $binary expects { "base64": "..." }.`);
                return { B: base64 };
            }
            if (marker === "$numberDecimal" || marker === "$numberLong") {
                if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(String(inner)))
                    throw new types_1.DbError(`${path}: "${inner}" is not a number.`);
                return { N: String(inner) };
            }
            if (!Array.isArray(inner) || !inner.length)
                throw new types_1.DbError(`${path}: ${marker} expects a non-empty array (DynamoDB sets cannot be empty).`);
            return { [marker.slice(1)]: inner.map(String) };
        }
        const m = {};
        for (const [k, v] of Object.entries(value))
            m[k] = toAttribute(v, `${path}.${k}`);
        return { M: m };
    }
    throw new types_1.DbError(`${path}: unsupported value.`);
}
exports.toAttribute = toAttribute;
function toItem(doc) {
    const out = {};
    for (const [k, v] of Object.entries(doc))
        out[k] = toAttribute(v, k);
    return out;
}
exports.toItem = toItem;
/** The type of a JSON value, in DynamoDB's letters. */
function attributeType(value) {
    if (value === null || value === undefined)
        return "null";
    const attr = toAttribute(value);
    return Object.keys(attr)[0];
}
exports.attributeType = attributeType;
const TYPE_KIND = { S: "string", N: "number", BOOL: "boolean", B: "binary", null: "null", NULL: "null" };
/** Attribute names go into PartiQL quoted; a quote inside one would end the identifier. */
function partiqlName(name) {
    if (typeof name !== "string" || !name || name.length > 255 || /["\u0000]/.test(name))
        throw new types_1.DbError(`"${String(name).slice(0, 60)}" cannot be used as an attribute name here.`);
    return `"${name}"`;
}
class DynamoAdapter {
    constructor(spec) {
        this.spec = spec;
        this.kind = "dynamodb";
        this.tables = new Map();
        /** NextToken of each page already visited, per query: cursor paging cannot jump. */
        this.cursors = new Map();
        this.region = spec.region ?? "us-east-1";
        this.endpoint = spec.endpoint ?? `https://dynamodb.${this.region}.amazonaws.com${this.region.startsWith("cn-") ? ".cn" : ""}`;
    }
    async call(operation, body) {
        if (!this.credentials || (this.credentials.expiresAt && this.credentials.expiresAt - Date.now() < 60000))
            this.credentials = await (0, aws_1.resolveAwsCredentials)(this.spec);
        const payload = JSON.stringify(body);
        const headers = (0, aws_1.signRequest)({
            method: "POST",
            url: `${this.endpoint}/`,
            headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": `DynamoDB_20120810.${operation}` },
            body: payload,
            region: this.region,
            service: "dynamodb",
            credentials: this.credentials
        });
        delete headers.host;
        const response = await (0, http_1.httpRequest)({ method: "POST", url: `${this.endpoint}/`, headers, body: payload, insecure: /^(true|1|yes)$/i.test(this.spec.options.insecure ?? "") });
        if (response.status === 400 && /ConditionalCheckFailed/.test(response.text)) {
            throw new types_1.DbError(operation === "PutItem" && /attribute_not_exists/.test(payload) ? "An item with this key already exists." : "The item no longer exists. Refresh and try again.", undefined, "CONDITION");
        }
        return (0, http_1.expectJson)(response, `DynamoDB ${operation}`);
    }
    async connect() {
        await this.call("ListTables", { Limit: 1 });
        const local = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/i.test(this.endpoint);
        return { version: local ? `DynamoDB Local (${this.endpoint.replace(/^https?:\/\//, "")})` : `Amazon DynamoDB (${this.region})`, defaultDatabase: this.region };
    }
    async close() {
        this.credentials = undefined;
    }
    async ping() {
        await this.call("ListTables", { Limit: 1 });
    }
    invalidate() {
        this.tables.clear();
        this.cursors.clear();
    }
    async listDatabases() {
        return [this.region];
    }
    async listSchemas() {
        return [];
    }
    async listObjects() {
        const names = [];
        let start;
        do {
            const page = await this.call("ListTables", { Limit: 100, ...(start ? { ExclusiveStartTableName: start } : {}) });
            names.push(...(page.TableNames ?? []));
            start = page.LastEvaluatedTableName;
        } while (start && names.length < 2000);
        // Item counts (refreshed by DynamoDB about every six hours) for a short list only.
        const counts = new Map();
        if (names.length <= 50) {
            for (let i = 0; i < names.length; i += 8) {
                await Promise.all(names.slice(i, i + 8).map(name => this.table(name).then(t => { if (typeof t.ItemCount === "number")
                    counts.set(name, t.ItemCount); }).catch(() => undefined)));
            }
        }
        return names.map(name => ({ name, type: "table", rows: counts.get(name) }));
    }
    async table(name) {
        if (!name)
            throw new types_1.DbError("No table selected.");
        const cached = this.tables.get(name);
        if (cached && Date.now() - cached.at < 60000)
            return cached.table;
        const result = await this.call("DescribeTable", { TableName: name });
        this.tables.set(name, { at: Date.now(), table: result.Table });
        return result.Table;
    }
    keysOf(table) {
        const types = new Map(table.AttributeDefinitions.map(a => [a.AttributeName, a.AttributeType]));
        return [...table.KeySchema].sort(hashFirst).map(k => ({ name: k.AttributeName, type: types.get(k.AttributeName) ?? "S", role: k.KeyType === "HASH" ? "partition key" : "sort key" }));
    }
    async describe(target) {
        const table = await this.table(target.object);
        const cached = this.tables.get(target.object);
        if (cached?.columns)
            return cached.columns;
        const sample = await this.call("Scan", { TableName: target.object, Limit: types_1.LIMITS.mongoSample });
        const keys = this.keysOf(table);
        const columns = (0, document_base_1.inferColumns)((sample.Items ?? []).map(fromItem), keys.map(k => ({ name: k.name, type: `${k.type} (${k.role})` })), attributeType, t => TYPE_KIND[t.split(" ")[0]] ?? "json");
        if (cached)
            cached.columns = columns;
        return columns;
    }
    /** A filter value typed in the grid, as the attribute type the column holds. */
    filterValue(column, raw) {
        const text = raw.trim();
        if (/^".*"$/s.test(text))
            return { S: text.slice(1, -1) };
        if (column?.category === "number" && /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(text))
            return { N: text };
        if (column?.category === "boolean" && /^(true|false)$/i.test(text))
            return { BOOL: /^true$/i.test(text) };
        if (!column && /^[-+]?\d+(\.\d+)?$/.test(text))
            return { N: text };
        return { S: raw };
    }
    where(request, columns) {
        const parts = [];
        const params = [];
        const base = (request.query ?? "").trim();
        if (base) {
            if (base.length > 4000 || /;/.test(base.replace(/'([^']|'')*'/g, "")))
                throw new types_1.DbError("The PartiQL condition must be a single expression.");
            parts.push(`(${base})`);
        }
        if ((request.search ?? "").trim())
            throw new types_1.DbError("DynamoDB has no text search.", "Use Filter (contains, begins with) or a PartiQL condition.");
        for (const rule of request.filters ?? [])
            parts.push(this.ruleClause(rule, columns.find(c => c.name === rule.column), params));
        return { clause: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params };
    }
    ruleClause(rule, column, params) {
        if (!types_1.FILTER_OPS.includes(rule.op))
            throw new types_1.DbError(`Unknown filter operator "${rule.op}".`);
        const name = partiqlName(rule.column);
        const value = String(rule.value ?? "");
        const add = (v) => { params.push(v); return "?"; };
        switch (rule.op) {
            case "null": return `(${name} IS NULL OR ${name} IS MISSING)`;
            case "notnull": return `(${name} IS NOT NULL AND ${name} IS NOT MISSING)`;
            case "contains": return `contains(${name}, ${add({ S: value })})`;
            case "starts": return `begins_with(${name}, ${add({ S: value })})`;
            case "ends": throw new types_1.DbError("DynamoDB cannot match the end of a value.", "Use contains or begins with.");
            case "in": {
                const items = value.split(",").map(s => s.trim()).filter(Boolean);
                if (!items.length)
                    throw new types_1.DbError(`"in" on ${rule.column} needs a comma-separated list.`);
                if (items.length > 50)
                    throw new types_1.DbError("DynamoDB's IN takes at most 50 values.");
                return `${name} IN [${items.map(item => add(this.filterValue(column, item))).join(", ")}]`;
            }
            default: {
                const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[rule.op];
                return `${name} ${op} ${add(this.filterValue(column, value))}`;
            }
        }
    }
    async fetchPage(request) {
        const start = Date.now();
        const table = await this.table(request.target.object);
        const known = await this.describe(request.target);
        if (request.sort)
            throw new types_1.DbError("DynamoDB scans cannot be sorted.", "Query a table by its partition key in the Query tab to get items in sort-key order.");
        const { clause, params } = this.where(request, known);
        const statement = `SELECT * FROM ${partiqlName(table.TableName)}${clause}`;
        const pageSize = Math.max(1, Math.min(types_1.LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
        const page = Math.max(1, Math.floor(Number(request.page) || 1));
        const signature = JSON.stringify([statement, params, pageSize]);
        const tokens = this.cursors.get(signature) ?? [undefined];
        // Most recent last; every distinct filter adds one, so the oldest go once there are many.
        this.cursors.delete(signature);
        this.cursors.set(signature, tokens);
        while (this.cursors.size > 50)
            this.cursors.delete(this.cursors.keys().next().value);
        // Walk forward from the furthest page already known; a cursor cannot jump.
        let index = Math.min(page, tokens.length) - 1;
        if (page - 1 - index > 20)
            throw new types_1.DbError(`Page ${page} is too far ahead to scan to.`, "Go forward a few pages at a time, or add a filter.");
        let items = [];
        let next;
        for (;;) {
            items = [];
            let token = tokens[index];
            // A page after the last one: the scan already ended.
            if (index > 0 && token === undefined) {
                next = undefined;
                break;
            }
            let calls = 0;
            do {
                const result = await this.call("ExecuteStatement", {
                    Statement: statement, Limit: pageSize - items.length, ...(params.length ? { Parameters: params } : {}), ...(token ? { NextToken: token } : {})
                });
                items.push(...(result.Items ?? []));
                token = result.NextToken;
                calls++;
            } while (token && items.length < pageSize && calls < 50);
            next = token;
            if (tokens.length <= index + 1)
                tokens.push(next);
            else
                tokens[index + 1] = next;
            if (index + 1 >= page || !next)
                break;
            index++;
        }
        if (index + 1 < page || (index > 0 && tokens[index] === undefined))
            items = [];
        const docs = items.map(fromItem);
        const keys = this.keysOf(table).map(k => k.name);
        const columns = (0, document_base_1.inferColumns)(docs, this.keysOf(table).map(k => ({ name: k.name, type: `${k.type} (${k.role})` })), attributeType, t => TYPE_KIND[t.split(" ")[0]] ?? "json");
        for (const column of known)
            if (!columns.some(c => c.name === column.name))
                columns.push(column);
        return {
            columns,
            rows: docs.map(values_1.encodeRow),
            total: null,
            hasMore: !!next && index + 1 >= page,
            keyColumns: keys,
            keyStrategy: "primary",
            note: !clause && typeof table.ItemCount === "number" ? `About ${table.ItemCount.toLocaleString("en-US")} items (DynamoDB updates this count every few hours).` : undefined,
            elapsedMs: (0, values_1.since)(start)
        };
    }
    keyOf(table, row) {
        const key = {};
        for (const { name } of this.keysOf(table)) {
            if (!row || !(name in row) || row[name] === null || row[name] === undefined)
                throw new types_1.DbError(`The key attribute ${name} is missing.`, "Every item needs its partition key (and sort key, if the table has one).");
            key[name] = toAttribute(row[name], name);
            const type = Object.keys(key[name])[0];
            if (!["S", "N", "B"].includes(type))
                throw new types_1.DbError(`The key attribute ${name} must be a string, number or binary value.`);
        }
        return key;
    }
    keyCondition(table, exists) {
        const hash = this.keysOf(table)[0].name;
        return { ConditionExpression: exists ? "attribute_exists(#k)" : "attribute_not_exists(#k)", ExpressionAttributeNames: { "#k": hash } };
    }
    async insert(target, values) {
        const table = await this.table(target.object);
        const doc = (0, document_base_1.parseJsonDocument)(values);
        this.keyOf(table, doc);
        await this.call("PutItem", { TableName: table.TableName, Item: toItem(doc), ...this.keyCondition(table, false) });
        this.cursors.clear();
        return 1;
    }
    async update(target, key, _strategy, values) {
        const table = await this.table(target.object);
        const doc = (0, document_base_1.parseJsonDocument)(values);
        const before = JSON.stringify(this.keyOf(table, key));
        const after = JSON.stringify(this.keyOf(table, doc));
        if (before !== after)
            throw new types_1.DbError("Key attributes cannot be changed.", "Duplicate the item with the new key, then delete the old one.");
        await this.call("PutItem", { TableName: table.TableName, Item: toItem(doc), ...this.keyCondition(table, true) });
        return 1;
    }
    async remove(target, keys) {
        const table = await this.table(target.object);
        if (!Array.isArray(keys) || !keys.length)
            throw new types_1.DbError("Select at least one item.");
        const requests = keys.map(k => ({ DeleteRequest: { Key: this.keyOf(table, k) } }));
        await this.batchWrite(table.TableName, requests);
        this.cursors.clear();
        return requests.length;
    }
    async batchWrite(tableName, requests) {
        for (let i = 0; i < requests.length; i += 25) {
            let pending = requests.slice(i, i + 25);
            for (let attempt = 0; pending.length; attempt++) {
                if (attempt > 6)
                    throw new types_1.DbError("DynamoDB kept throttling the delete.", "Try again, or raise the table's write capacity.");
                if (attempt)
                    await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
                const result = await this.call("BatchWriteItem", { RequestItems: { [tableName]: pending } });
                pending = result.UnprocessedItems?.[tableName] ?? [];
            }
        }
    }
    async indexes(target) {
        const table = await this.table(target.object);
        const names = (schema) => [...schema].sort(hashFirst).map(k => `${k.AttributeName}${k.KeyType === "RANGE" ? " (sort)" : ""}`);
        return [
            { name: "Primary key", columns: names(table.KeySchema), unique: true, primary: true, type: "table" },
            ...(table.GlobalSecondaryIndexes ?? []).map(ix => ({ name: ix.IndexName, columns: names(ix.KeySchema), unique: false, primary: false, type: "GSI", detail: ix.Projection?.ProjectionType ? `projects ${ix.Projection.ProjectionType}` : undefined })),
            ...(table.LocalSecondaryIndexes ?? []).map(ix => ({ name: ix.IndexName, columns: names(ix.KeySchema), unique: false, primary: false, type: "LSI", detail: ix.Projection?.ProjectionType ? `projects ${ix.Projection.ProjectionType}` : undefined }))
        ];
    }
    async drop(target) {
        await this.call("DeleteTable", { TableName: target.object });
        this.invalidate();
    }
    async truncate(target) {
        const table = await this.table(target.object);
        const keys = this.keysOf(table).map(k => k.name);
        const names = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
        let start;
        do {
            const page = await this.call("Scan", {
                TableName: table.TableName, ProjectionExpression: Object.keys(names).join(", "), ExpressionAttributeNames: names, Limit: 500, ...(start ? { ExclusiveStartKey: start } : {})
            });
            await this.batchWrite(table.TableName, (page.Items ?? []).map(item => ({ DeleteRequest: { Key: item } })));
            start = page.LastEvaluatedKey;
        } while (start);
        this.cursors.clear();
    }
    classify(text) {
        const statements = (0, document_base_1.splitStatements)(text);
        if (!statements.length)
            throw new types_1.DbError("Enter a PartiQL statement to run.");
        return statements.map(s => {
            const verb = (/^\s*(\w+)/.exec(s.text)?.[1] ?? "").toLowerCase();
            if (!["select", "insert", "update", "delete", "exists"].includes(verb))
                throw new types_1.DbError(`DynamoDB PartiQL does not support ${verb.toUpperCase() || "this statement"}.`, "Use SELECT, INSERT, UPDATE or DELETE.");
            return { verb, write: verb !== "select" && verb !== "exists", danger: verb === "delete" ? "DELETE removes the matching item." : undefined };
        });
    }
    async runQuery(text) {
        const start = Date.now();
        const statements = (0, document_base_1.splitStatements)(text);
        this.classify(text);
        let last;
        let writes = 0;
        for (const statement of statements) {
            const verb = (/^\s*(\w+)/.exec(statement.text)?.[1] ?? "").toLowerCase();
            const items = [];
            let token;
            try {
                do {
                    const result = await this.call("ExecuteStatement", { Statement: statement.text, ...(token ? { NextToken: token } : {}) });
                    items.push(...(result.Items ?? []));
                    token = result.NextToken;
                } while (token && items.length <= types_1.LIMITS.maxQueryRows);
            }
            catch (error) {
                // Points the editor at the statement that failed.
                throw error instanceof types_1.DbError ? error.at(statement.offset) : error;
            }
            if (verb === "select")
                last = (0, document_base_1.documentsResult)(start, items.slice(0, types_1.LIMITS.maxQueryRows).map(fromItem), items.length > types_1.LIMITS.maxQueryRows || !!token);
            else
                writes++;
        }
        if (writes)
            this.cursors.clear();
        return last && !writes ? last : last ?? { columns: [], rows: [], message: `${writes} statement${writes === 1 ? "" : "s"} completed.`, affected: undefined, elapsedMs: (0, values_1.since)(start) };
    }
}
exports.DynamoAdapter = DynamoAdapter;
//# sourceMappingURL=dynamodb.js.map