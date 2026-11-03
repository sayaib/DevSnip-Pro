/**
 * Firestore (Native mode) through the REST API.
 *
 * Root collections are the objects; a collection path such as
 * users/alice/orders opens a subcollection from the Query tab. The grid
 * builds structured queries from the filter rules; the console takes a
 * small SQL-like form (see parseFirestoreQuery) or a raw structuredQuery.
 *
 * Documents are JSON with an `_id` column. Firestore types JSON cannot tell
 * apart use Extended JSON markers, so they survive an edit:
 * {"$date": ...} timestamps, {"$numberLong": ...} integers beyond 2^53,
 * {"$numberDouble": "2.0"} whole doubles, {"$binary": {"base64": ...}} bytes,
 * {"$ref": "projects/.../documents/..."} references and {"$geo": {latitude, longitude}}.
 */

import type { ConnectionSpec } from "../connection-string";
import { GoogleApi } from "../cloud-auth/gcp";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbTarget, FilterRule, FILTER_OPS, KeyStrategy, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, ServerInfo, StatementCheck } from "../types";
import { encodeRow, since } from "../values";
import { documentsResult, inferColumns, parseJsonDocument } from "./document-base";

type Value = Record<string, any>;
interface Document { name: string; fields?: Record<string, Value>; createTime?: string; updateTime?: string }

export function fromValue(value: Value): unknown {
  const [type, v] = Object.entries(value ?? {})[0] ?? ["nullValue", null];
  switch (type) {
    case "nullValue": return null;
    case "booleanValue": return v === true;
    case "integerValue": {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : { $numberLong: String(v) };
    }
    case "doubleValue": {
      const n = typeof v === "number" ? v : Number(v);
      // A whole double would come back as an integer: keep its type.
      return Number.isFinite(n) && !Number.isInteger(n) ? n : { $numberDouble: Number.isFinite(n) ? n.toFixed(1) : String(v) };
    }
    case "timestampValue": return { $date: String(v) };
    case "stringValue": return v;
    case "bytesValue": return { $binary: { base64: v, subType: "00" } };
    case "referenceValue": return { $ref: v };
    case "geoPointValue": return { $geo: { latitude: v?.latitude ?? 0, longitude: v?.longitude ?? 0 } };
    case "arrayValue": return (v?.values ?? []).map(fromValue);
    case "mapValue": return fromFields(v?.fields ?? {});
    default: return v;
  }
}

export function fromFields(fields: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = fromValue(v);
  return out;
}

export function toValue(value: unknown, path = "value"): Value {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) throw new DbError(`${path}: Firestore arrays cannot directly contain arrays.`);
    return { arrayValue: { values: value.map((v, i) => toValue(v, `${path}[${i}]`)) } };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const [k] = keys;
      const v = obj[k];
      if (k === "$date") {
        const text = typeof v === "string" ? v : typeof v === "number" ? new Date(v).toISOString() : String(v?.$numberLong ? new Date(Number(v.$numberLong)).toISOString() : v);
        if (Number.isNaN(Date.parse(text))) throw new DbError(`${path}: "${text}" is not a timestamp.`);
        return { timestampValue: text };
      }
      if (k === "$numberLong" || k === "$numberInt") {
        if (!/^-?\d+$/.test(String(v))) throw new DbError(`${path}: "${v}" is not an integer.`);
        return { integerValue: String(v) };
      }
      if (k === "$numberDouble") return { doubleValue: /^(NaN|-?Infinity)$/.test(String(v)) ? String(v) : Number(v) };
      if (k === "$binary") return { bytesValue: typeof v === "string" ? v : String(v?.base64 ?? "") };
      if (k === "$ref") {
        if (typeof v !== "string" || !/^projects\/[^/]+\/databases\/[^/]+\/documents\/.+/.test(v)) throw new DbError(`${path}: $ref expects a full document name (projects/…/documents/…).`);
        return { referenceValue: v };
      }
      if (k === "$geo") return { geoPointValue: { latitude: Number(v?.latitude), longitude: Number(v?.longitude) } };
    }
    const fields: Record<string, Value> = {};
    for (const [k, v] of Object.entries(obj)) fields[k] = toValue(v, `${path}.${k}`);
    return { mapValue: { fields } };
  }
  throw new DbError(`${path}: unsupported value.`);
}

function typeOf(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") {
    const k = Object.keys(value as object)[0];
    if (k === "$date") return "timestamp";
    if (k === "$numberLong" || k === "$numberDouble") return "number";
    if (k === "$binary") return "binary";
    if (k === "$ref") return "reference";
    if (k === "$geo") return "geopoint";
    return "map";
  }
  return typeof value;
}

/** A field path: plain names as is, others in backticks. */
export function fieldPath(name: string): string {
  if (typeof name !== "string" || !name || name.length > 1500) throw new DbError("Invalid field name.");
  if (name === "_id") return "__name__";
  return name.split(".").map(part => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(part) ? part : "`" + part.replace(/[\\`]/g, m => "\\" + m) + "`")).join(".");
}

/** A value typed in a filter or the console: JSON (42, true, null, "text"), 'text', or plain text. */
function literal(raw: string): unknown {
  const text = raw.trim();
  if (/^'.*'$/s.test(text)) return text.slice(1, -1).replace(/''/g, "'");
  try { return JSON.parse(text); } catch { return raw; }
}

const OPS: Record<string, string> = {
  "=": "EQUAL", "==": "EQUAL", "!=": "NOT_EQUAL", "<>": "NOT_EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL",
  in: "IN", "not in": "NOT_IN", "array_contains": "ARRAY_CONTAINS", "array-contains": "ARRAY_CONTAINS", "array_contains_any": "ARRAY_CONTAINS_ANY", "array-contains-any": "ARRAY_CONTAINS_ANY"
};

export interface FirestoreQuery {
  collection: string;
  count: boolean;
  structuredQuery: Record<string, unknown>;
}

function fieldFilter(field: string, op: string, value: unknown, refOf?: (id: string) => string): Record<string, unknown> {
  if (value === null && (op === "EQUAL" || op === "NOT_EQUAL")) return { unaryFilter: { field: { fieldPath: fieldPath(field) }, op: op === "EQUAL" ? "IS_NULL" : "IS_NOT_NULL" } };
  const isList = ["IN", "NOT_IN", "ARRAY_CONTAINS_ANY"].includes(op);
  if (isList && !Array.isArray(value)) throw new DbError(`${op} expects a list of values.`);
  const ref = (v: unknown) => ({ referenceValue: typeof v === "string" && !v.startsWith("projects/") && refOf ? refOf(v) : String(v) });
  const encoded = field === "_id" ? (Array.isArray(value) ? { arrayValue: { values: value.map(ref) } } : ref(value)) : toValue(value, field);
  return { fieldFilter: { field: { fieldPath: fieldPath(field) }, op, value: encoded } };
}

function combine(filters: Array<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (!filters.length) return undefined;
  return filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } };
}

/**
 * The console's query form:
 *   SELECT * FROM users WHERE age >= 21 AND city IN ('Oslo', 'Rome') ORDER BY age DESC LIMIT 20
 *   SELECT COUNT(*) FROM users/alice/orders WHERE status = 'open'
 *   tags ARRAY_CONTAINS 'new', email IS NOT NULL
 * or a JSON structuredQuery with a "from" collection.
 */
export function parseFirestoreQuery(text: string, refOf?: (collection: string, id: string) => string): FirestoreQuery {
  const source = text.trim().replace(/;\s*$/, "");
  if (source.startsWith("{")) {
    let json: Record<string, any>;
    try { json = JSON.parse(source); } catch (e) { throw new DbError(`The structured query is not valid JSON: ${(e as Error).message}`); }
    const q = json.structuredQuery ?? json;
    const collection = q.from?.[0]?.collectionId ?? json.collection;
    if (typeof collection !== "string" || !collection) throw new DbError("The structured query needs \"from\": [{ \"collectionId\": \"...\" }].");
    const parts = collection.split("/");
    return { collection, count: false, structuredQuery: { ...q, from: [{ collectionId: parts[parts.length - 1], allDescendants: !!q.from?.[0]?.allDescendants }] } };
  }
  const m = /^select\s+(\*|count\s*\(\s*\*\s*\))\s+from\s+([^\s]+)(.*)$/is.exec(source);
  if (!m) throw new DbError("Write SELECT * FROM collection [WHERE …] [ORDER BY …] [LIMIT n].", "Or paste a structuredQuery as JSON.");
  const collection = m[2].replace(/^\/+|\/+$/g, "").replace(/^`|`$/g, "");
  if (collection.split("/").length % 2 === 0) throw new DbError(`"${collection}" is a document path; name a collection.`, "Collection paths have an odd number of segments: users, or users/alice/orders.");
  let rest = m[3];
  const clause = (re: RegExp) => { const x = re.exec(rest); if (x) rest = rest.slice(0, x.index) + rest.slice(x.index + x[0].length); return x; };
  const offset = clause(/\s+offset\s+(\d+)\s*$/i) ?? undefined;
  const limit = clause(/\s+limit\s+(\d+)\s*$/i);
  const offsetAfter = offset ? undefined : clause(/\s+offset\s+(\d+)\s*$/i);
  const order = clause(/\s+order\s+by\s+(.+)$/is);
  const where = clause(/^\s*where\s+(.+)$/is);
  if (rest.trim()) throw new DbError(`Could not read "${rest.trim().slice(0, 60)}".`, "Clauses go in this order: WHERE, ORDER BY, LIMIT, OFFSET.");
  const filters: Array<Record<string, unknown>> = [];
  if (where) {
    for (const cond of splitAnd(where[1])) {
      const unary = /^(`[^`]+`|[\w.]+)\s+is\s+(not\s+)?null$/i.exec(cond);
      if (unary) { filters.push({ unaryFilter: { field: { fieldPath: fieldPath(unary[1].replace(/`/g, "")) }, op: unary[2] ? "IS_NOT_NULL" : "IS_NULL" } }); continue; }
      const c = /^(`[^`]+`|[\w.]+)\s*(==|=|!=|<>|<=|>=|<|>|not\s+in\b|in\b|array[_-]contains[_-]any\b|array[_-]contains\b)\s*(.+)$/is.exec(cond);
      if (!c) throw new DbError(`Could not read the condition "${cond.slice(0, 80)}".`, "Use field = value, field IN (a, b), field ARRAY_CONTAINS value or field IS NULL; join them with AND.");
      const op = OPS[c[2].toLowerCase().replace(/\s+/g, " ")];
      const rawValue = c[3].trim();
      const value = /^\(.*\)$/s.test(rawValue) ? splitList(rawValue.slice(1, -1)).map(literal) : literal(rawValue);
      filters.push(fieldFilter(c[1].replace(/`/g, ""), op, value, refOf ? id => refOf(collection, id) : undefined));
    }
  }
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection.split("/").pop() }] };
  const filter = combine(filters);
  if (filter) structuredQuery.where = filter;
  if (order) {
    structuredQuery.orderBy = splitList(order[1]).map(part => {
      const o = /^(`[^`]+`|[\w.]+)(?:\s+(asc|desc))?$/i.exec(part.trim());
      if (!o) throw new DbError(`Could not read ORDER BY "${part.slice(0, 60)}".`);
      return { field: { fieldPath: fieldPath(o[1].replace(/`/g, "")) }, direction: /desc/i.test(o[2] ?? "") ? "DESCENDING" : "ASCENDING" };
    });
  }
  if (limit) structuredQuery.limit = Math.min(Number(limit[1]), LIMITS.maxQueryRows + 1);
  const off = offset ?? offsetAfter;
  if (off) structuredQuery.offset = Number(off[1]);
  return { collection, count: /^count/i.test(m[1]), structuredQuery };
}

/** Splits on top-level AND, outside quotes and parentheses. */
function splitAnd(text: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && /^\s+and\s+$/i.test(text.slice(i, i + 5)) && /\s/.test(ch)) { out.push(text.slice(start, i).trim()); start = i + 5; i += 4; }
    else if (depth === 0 && /\sor\s/i.test(text.slice(i, i + 4)) && /\s/.test(ch)) throw new DbError("OR is not supported here; use IN, or run two queries.");
  }
  out.push(text.slice(start).trim());
  return out.filter(Boolean);
}

/** Splits a comma-separated list outside quotes and brackets. */
function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}

export class FirestoreAdapter implements DbAdapter {
  readonly kind = "firestore" as const;
  private readonly api: GoogleApi;
  private readonly samples = new Map<string, { at: number; columns: ColumnInfo[] }>();
  private database: string;

  constructor(private readonly spec: ConnectionSpec) {
    this.api = new GoogleApi(spec, `${spec.endpoint ?? "https://firestore.googleapis.com"}/v1`);
    this.database = spec.database || "(default)";
  }

  private root(database?: string): string {
    return `projects/${this.spec.project}/databases/${database || this.database}/documents`;
  }

  /** The parent document path and collection id of a collection path. */
  private parentOf(collection: string, database?: string): { parent: string; collectionId: string } {
    const parts = collection.split("/").filter(Boolean);
    if (!parts.length || parts.length % 2 === 0) throw new DbError(`"${collection}" is not a collection path.`);
    if (parts.some(p => p === "." || p === ".." || p.length > 1500)) throw new DbError("Invalid collection path.");
    return { parent: [this.root(database), ...parts.slice(0, -1).map(encodeURIComponent)].join("/"), collectionId: parts[parts.length - 1] };
  }

  async connect(): Promise<ServerInfo> {
    await this.api.call("POST", `${this.root()}:listCollectionIds`, "Connecting to Firestore", { pageSize: 1 });
    return { version: this.api.auth.emulator ? "Firestore emulator" : "Firestore", defaultDatabase: this.database };
  }

  async close(): Promise<void> {
    this.samples.clear();
  }

  async ping(): Promise<void> {
    await this.api.call("POST", `${this.root()}:listCollectionIds`, "Ping", { pageSize: 1 });
  }

  invalidate(): void {
    this.samples.clear();
  }

  async listDatabases(): Promise<string[]> {
    if (this.api.auth.emulator) return [this.database];
    try {
      const r = await this.api.call<{ databases?: Array<{ name: string; type?: string }> }>("GET", `projects/${this.spec.project}/databases`, "Listing databases");
      const names = (r.databases ?? []).filter(d => d.type !== "DATASTORE_MODE").map(d => d.name.split("/").pop()!);
      return names.includes(this.database) ? names : [this.database, ...names];
    } catch {
      return [this.database];
    }
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    const ids: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.api.call<{ collectionIds?: string[]; nextPageToken?: string }>("POST", `${this.root(database)}:listCollectionIds`, "Listing collections", { pageSize: 300, ...(token ? { pageToken: token } : {}) });
      ids.push(...(r.collectionIds ?? []));
      token = r.nextPageToken;
    } while (token && ids.length < 3000);
    return ids.sort().map(name => ({ name, type: "collection" as const }));
  }

  private async run(collection: string, database: string | undefined, structuredQuery: Record<string, unknown>): Promise<Document[]> {
    const { parent } = this.parentOf(collection, database);
    const results = await this.api.call<Array<{ document?: Document }>>("POST", `${parent}:runQuery`, "The query", { structuredQuery });
    return (Array.isArray(results) ? results : []).map(r => r.document).filter((d): d is Document => !!d);
  }

  private async count(collection: string, database: string | undefined, structuredQuery: Record<string, unknown>): Promise<number> {
    const { parent } = this.parentOf(collection, database);
    // Counting ignores paging and order.
    const query = { ...structuredQuery };
    delete query.limit;
    delete query.offset;
    delete query.orderBy;
    const results = await this.api.call<Array<{ result?: { aggregateFields?: Record<string, Value> } }>>("POST", `${parent}:runAggregationQuery`, "Counting", {
      structuredAggregationQuery: { structuredQuery: query, aggregations: [{ alias: "n", count: {} }] }
    });
    const value = (Array.isArray(results) ? results : []).find(r => r.result)?.result?.aggregateFields?.n;
    return Number(fromValue(value ?? { integerValue: "0" })) || 0;
  }

  private row(doc: Document): Row {
    return { _id: decodeURIComponent(doc.name.split("/").pop() ?? ""), ...fromFields(doc.fields ?? {}) };
  }

  async describe(target: DbTarget): Promise<ColumnInfo[]> {
    const key = `${target.database}\u0000${target.object}`;
    const cached = this.samples.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.columns;
    const docs = await this.run(target.object, target.database, { from: [{ collectionId: this.parentOf(target.object).collectionId }], limit: LIMITS.mongoSample });
    const columns = this.columnsFor(docs.map(d => this.row(d)));
    this.samples.set(key, { at: Date.now(), columns });
    return columns;
  }

  private columnsFor(rows: Row[]): ColumnInfo[] {
    const columns = inferColumns(rows.map(({ _id, ...rest }) => rest), [{ name: "_id", type: "document id" }], typeOf, t => (t === "document id" ? "string" : ["map", "array", "reference", "geopoint"].includes(t) ? "json" : t));
    for (const c of columns) c.sortable = c.category !== "json" || c.name === "_id";
    columns[0].sortable = true;
    return columns;
  }

  private filterValue(column: ColumnInfo | undefined, raw: string): unknown {
    const value = literal(raw);
    if (column?.category === "number" && typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
    if (column?.category === "date" && typeof value === "string" && !Number.isNaN(Date.parse(value))) return { $date: new Date(value).toISOString() };
    return value;
  }

  private ruleFilters(rule: FilterRule, column: ColumnInfo | undefined, database: string | undefined, collection: string): Array<Record<string, unknown>> {
    if (!FILTER_OPS.includes(rule.op)) throw new DbError(`Unknown filter operator "${rule.op}".`);
    const field = { fieldPath: fieldPath(rule.column) };
    const raw = String(rule.value ?? "");
    const value = (v: unknown) => (rule.column === "_id" ? { referenceValue: `${this.parentOf(collection, database).parent}/${encodeURIComponent(this.parentOf(collection).collectionId)}/${encodeURIComponent(String(v))}` } : toValue(v, rule.column));
    const f = (op: string, v: unknown) => ({ fieldFilter: { field, op, value: value(v) } });
    switch (rule.op) {
      case "null": return [{ unaryFilter: { field, op: "IS_NULL" } }];
      case "notnull": return [{ unaryFilter: { field, op: "IS_NOT_NULL" } }];
      case "starts": return [f("GREATER_THAN_OR_EQUAL", raw), f("LESS_THAN", `${raw}`)];
      case "contains":
      case "ends": throw new DbError("Firestore cannot search inside text.", "Use equals, starts with, or a comparison.");
      case "in": {
        const items = raw.split(",").map(s => s.trim()).filter(Boolean);
        if (!items.length) throw new DbError(`"in" on ${rule.column} needs a comma-separated list.`);
        if (items.length > 30) throw new DbError("Firestore's IN takes at most 30 values.");
        return [{ fieldFilter: { field, op: "IN", value: { arrayValue: { values: items.map(i => value(this.filterValue(column, i))) } } } }];
      }
      default: {
        const op = { eq: "EQUAL", neq: "NOT_EQUAL", gt: "GREATER_THAN", gte: "GREATER_THAN_OR_EQUAL", lt: "LESS_THAN", lte: "LESS_THAN_OR_EQUAL" }[rule.op]!;
        return [f(op, this.filterValue(column, raw))];
      }
    }
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const { target } = request;
    const known = await this.describe(target);
    if ((request.search ?? "").trim()) throw new DbError("Firestore has no text search.", "Use Filter: equals, starts with, or a comparison.");
    const pageSize = Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const filters = (request.filters ?? []).flatMap(rule => this.ruleFilters(rule, known.find(c => c.name === rule.column), target.database, target.object));
    const query: Record<string, unknown> = { from: [{ collectionId: this.parentOf(target.object).collectionId }] };
    const where = combine(filters);
    if (where) query.where = where;
    if (request.sort) query.orderBy = [{ field: { fieldPath: fieldPath(request.sort.column) }, direction: request.sort.dir === "desc" ? "DESCENDING" : "ASCENDING" }];
    const [docs, total] = await Promise.all([
      this.run(target.object, target.database, { ...query, offset: (page - 1) * pageSize, limit: pageSize }),
      this.count(target.object, target.database, query).catch(() => null)
    ]);
    const rows = docs.map(d => this.row(d));
    const columns = this.columnsFor(rows);
    for (const column of known) if (!columns.some(c => c.name === column.name)) columns.push(column);
    return { columns, rows: rows.map(encodeRow), total, hasMore: total === null ? rows.length === pageSize : undefined, keyColumns: ["_id"], keyStrategy: "_id", elapsedMs: since(start) };
  }

  private docName(target: DbTarget, id: unknown): string {
    if (typeof id !== "string" || !id || id.includes("/") || id === "." || id === ".." || /^__.*__$/.test(id)) throw new DbError("Document IDs are non-empty text without slashes.");
    const { parent, collectionId } = this.parentOf(target.object, target.database);
    return `${parent}/${encodeURIComponent(collectionId)}/${encodeURIComponent(id)}`;
  }

  private fields(doc: Record<string, unknown>): Record<string, Value> {
    const fields: Record<string, Value> = {};
    for (const [k, v] of Object.entries(doc)) if (k !== "_id") fields[k] = toValue(v, k);
    return fields;
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const doc = parseJsonDocument(values);
    const { parent, collectionId } = this.parentOf(target.object, target.database);
    const id = doc._id === undefined || doc._id === "" ? undefined : doc._id;
    if (id !== undefined) this.docName(target, id);
    await this.api.call("POST", `${parent}/${encodeURIComponent(collectionId)}${id !== undefined ? `?documentId=${encodeURIComponent(String(id))}` : ""}`, "Inserting", { fields: this.fields(doc) })
      .catch(error => { throw error instanceof DbError && /ALREADY_EXISTS|409/.test(error.message) ? new DbError("A document with this ID already exists.", "Change _id, or edit the existing document.") : error; });
    this.invalidate();
    return 1;
  }

  async update(target: DbTarget, key: Row, _strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number> {
    const doc = parseJsonDocument(values);
    if (doc._id !== undefined && doc._id !== key._id) throw new DbError("_id cannot be changed.", "Duplicate the document with the new ID, then delete the old one.");
    // Without an update mask, PATCH replaces the whole document; the precondition keeps a deleted one deleted.
    await this.api.call("PATCH", `${this.docName(target, key._id)}?currentDocument.exists=true`, "Saving", { fields: this.fields(doc) })
      .catch(error => { throw error instanceof DbError && /NOT_FOUND|404/.test(error.message) ? new DbError("The document no longer exists. Refresh and try again.") : error; });
    this.invalidate();
    return 1;
  }

  async remove(target: DbTarget, keys: Row[]): Promise<number> {
    if (!Array.isArray(keys) || !keys.length) throw new DbError("Select at least one document.");
    const names = keys.map(k => this.docName(target, k._id));
    await this.deleteNames(names, target.database);
    return names.length;
  }

  private async deleteNames(names: string[], database?: string): Promise<void> {
    for (let i = 0; i < names.length; i += 500) {
      await this.api.call("POST", `projects/${this.spec.project}/databases/${database || this.database}/documents:commit`, "Deleting", { writes: names.slice(i, i + 500).map(name => ({ delete: name })) });
    }
  }

  async drop(target: DbTarget): Promise<void> {
    // A Firestore collection exists while it has documents.
    await this.truncate(target);
  }

  async truncate(target: DbTarget): Promise<void> {
    const collectionId = this.parentOf(target.object).collectionId;
    for (;;) {
      const docs = await this.run(target.object, target.database, { from: [{ collectionId }], select: { fields: [{ fieldPath: "__name__" }] }, limit: 500 });
      if (!docs.length) break;
      await this.deleteNames(docs.map(d => d.name), target.database);
    }
    this.invalidate();
  }

  classify(text: string): StatementCheck[] {
    parseFirestoreQuery(text);
    return [{ verb: "select", write: false }];
  }

  async runQuery(text: string, context: { database?: string }): Promise<QueryResult> {
    const start = Date.now();
    const q = parseFirestoreQuery(text, (collection, id) => {
      const { parent, collectionId } = this.parentOf(collection, context.database);
      return `${parent}/${encodeURIComponent(collectionId)}/${encodeURIComponent(id)}`;
    });
    if (q.count) {
      const n = await this.count(q.collection, context.database, q.structuredQuery);
      return { columns: ["count"], rows: [{ count: n }], elapsedMs: since(start) };
    }
    const query = { ...q.structuredQuery };
    if (query.limit === undefined) query.limit = LIMITS.maxQueryRows + 1;
    const docs = await this.run(q.collection, context.database, query);
    return documentsResult(start, docs.slice(0, LIMITS.maxQueryRows).map(d => this.row(d)), docs.length > LIMITS.maxQueryRows);
  }
}
