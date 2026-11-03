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

import type { ConnectionSpec } from "../connection-string";
import { cosmosAuthorization } from "../cloud-auth/azure";
import { expectJson, httpRequest } from "../cloud-auth/http";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbTarget, FilterRule, FILTER_OPS, IndexInfo, KeyStrategy, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, ServerInfo, StatementCheck } from "../types";
import { encodeRow, since } from "../values";
import { documentsResult, inferColumns, parseJsonDocument } from "./document-base";

export const PK_COLUMN = "__pk";
const SYSTEM = ["_rid", "_self", "_attachments"];
const API_VERSION = "2018-12-31";

interface Container {
  id: string;
  partitionKey?: { paths?: string[]; kind?: string };
  indexingPolicy?: {
    indexingMode?: string;
    includedPaths?: Array<{ path: string }>;
    excludedPaths?: Array<{ path: string }>;
    compositeIndexes?: Array<Array<{ path: string; order?: string }>>;
    spatialIndexes?: Array<{ path: string }>;
  };
}

/** The value at a partition key path such as /tenantId or /address/zip; undefined when missing. */
export function valueAtPath(doc: Record<string, unknown>, path: string): unknown {
  let value: unknown = doc;
  for (const part of path.split("/").filter(Boolean)) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return value;
}

/** The x-ms-documentdb-partitionkey header for a document: a JSON array, {} for a missing value. */
export function partitionKeyHeader(doc: Record<string, unknown>, paths: string[]): string {
  return JSON.stringify(paths.map(p => { const v = valueAtPath(doc, p); return v === undefined ? {} : v; }));
}

const field = (name: string) => {
  if (typeof name !== "string" || !name || name.length > 255) throw new DbError("Invalid field name.");
  return `c[${JSON.stringify(name)}]`;
};

function typeOf(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

/** A filter value typed in the grid: JSON (42, true, null, "text") or plain text. */
function filterValue(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

export class CosmosAdapter implements DbAdapter {
  readonly kind = "cosmosdb" as const;
  private readonly containers = new Map<string, { at: number; container: Container; ranges?: string[]; columns?: ColumnInfo[] }>();
  private readonly insecure: boolean;

  constructor(private readonly spec: ConnectionSpec) {
    const local = /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(spec.endpoint ?? "");
    this.insecure = local || /^(true|1|yes)$/i.test(spec.options.disableservercertificatevalidation ?? spec.options.insecure ?? "");
  }

  private async request<T = Record<string, any>>(method: string, path: string, resourceType: string, resourceLink: string, what: string, options: { body?: unknown; headers?: Record<string, string>; raw?: boolean } = {}): Promise<{ json: T; headers: Record<string, string> }> {
    const date = new Date().toUTCString();
    const response = await httpRequest({
      method,
      url: `${this.spec.endpoint}/${path}`,
      headers: {
        authorization: cosmosAuthorization(method, resourceType, resourceLink, date, this.spec.password ?? ""),
        "x-ms-date": date,
        "x-ms-version": API_VERSION,
        accept: "application/json",
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      insecure: this.insecure
    });
    if (response.status === 409) throw new DbError("A document with this id already exists in that partition.", "Change the id, or edit the existing document.", "CONFLICT");
    if (response.status === 404 && method !== "GET" && resourceType === "docs") throw new DbError("The document no longer exists. Refresh and try again.");
    return { json: expectJson<T>(response, what), headers: response.headers };
  }

  private static link(...parts: string[]): { path: string; link: string } {
    return { path: parts.map(encodeURIComponent).join("/"), link: parts.join("/") };
  }

  async connect(): Promise<ServerInfo> {
    const { json } = await this.request<{ id?: string }>("GET", "", "", "", "Connecting to Cosmos DB");
    const emulator = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(this.spec.endpoint ?? "");
    return { version: emulator ? "Azure Cosmos DB Emulator (NoSQL)" : `Azure Cosmos DB for NoSQL (${json.id ?? this.spec.host})`, defaultDatabase: this.spec.database || undefined };
  }

  async close(): Promise<void> {
    this.containers.clear();
  }

  async ping(): Promise<void> {
    await this.request("GET", "", "", "", "Ping");
  }

  invalidate(): void {
    this.containers.clear();
  }

  async listDatabases(): Promise<string[]> {
    const { json } = await this.request<{ Databases?: Array<{ id: string }> }>("GET", "dbs", "dbs", "", "Listing databases");
    const names = (json.Databases ?? []).map(d => d.id).sort();
    if (this.spec.database && !names.includes(this.spec.database)) names.unshift(this.spec.database);
    return names;
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    const db = CosmosAdapter.link("dbs", database);
    const { json } = await this.request<{ DocumentCollections?: Container[] }>("GET", `${db.path}/colls`, "colls", db.link, "Listing containers");
    return (json.DocumentCollections ?? []).map(c => ({ name: c.id, type: "collection" as const })).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async container(target: DbTarget): Promise<{ container: Container; ranges: string[]; link: string; path: string }> {
    if (!target.database) throw new DbError("No database selected.");
    if (!target.object) throw new DbError("No container selected.");
    const key = `${target.database}\u0000${target.object}`;
    const c = CosmosAdapter.link("dbs", target.database, "colls", target.object);
    let cached = this.containers.get(key);
    if (!cached || Date.now() - cached.at > 60_000) {
      const [{ json: container }, { json: ranges }] = await Promise.all([
        this.request<Container>("GET", c.path, "colls", c.link, "Reading the container"),
        this.request<{ PartitionKeyRanges?: Array<{ id: string }> }>("GET", `${c.path}/pkranges`, "pkranges", c.link, "Reading partitions")
      ]);
      cached = { at: Date.now(), container, ranges: (ranges.PartitionKeyRanges ?? []).map(r => r.id) };
      this.containers.set(key, cached);
    }
    return { container: cached.container, ranges: cached.ranges?.length ? cached.ranges : ["0"], link: c.link, path: c.path };
  }

  private pkPaths(container: Container): string[] {
    return container.partitionKey?.paths ?? [];
  }

  /** Runs a query on one partition key range, following continuations up to `max` documents. */
  private async queryRange(path: string, link: string, range: string, query: string, parameters: Array<{ name: string; value: unknown }>, max: number): Promise<unknown[]> {
    const out: unknown[] = [];
    let continuation: string | undefined;
    do {
      const { json, headers } = await this.request<{ Documents?: unknown[] }>("POST", `${path}/docs`, "docs", link, "The query", {
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
  private shape(doc: Record<string, unknown>): Row {
    const row: Row = {};
    for (const [k, v] of Object.entries(doc)) if (!SYSTEM.includes(k)) row[k] = v;
    return row;
  }

  async describe(target: DbTarget): Promise<ColumnInfo[]> {
    const { container, ranges, link, path } = await this.container(target);
    const cached = this.containers.get(`${target.database}\u0000${target.object}`);
    if (cached?.columns) return cached.columns;
    const docs = (await this.queryRange(path, link, ranges[0], `SELECT TOP ${LIMITS.mongoSample} * FROM c`, [], LIMITS.mongoSample)) as Array<Record<string, unknown>>;
    const columns = this.columnsFor(docs.map(d => this.shape(d)), container);
    if (cached) cached.columns = columns;
    return columns;
  }

  private columnsFor(docs: Row[], container: Container): ColumnInfo[] {
    const pkTop = this.pkPaths(container).map(p => p.split("/").filter(Boolean)).filter(parts => parts.length === 1 && parts[0] !== "id").map(parts => parts[0]);
    const columns = inferColumns(docs, [{ name: "id", type: "string" }, ...pkTop.map(name => ({ name, type: "partition key" }))], typeOf, t => (t === "partition key" ? "string" : t === "array" || t === "object" ? "json" : t));
    for (const column of columns) {
      column.sortable = column.category !== "json";
      if (column.name === "_etag" || column.name === "_ts") column.editable = false;
    }
    return columns;
  }

  private where(request: PageRequest, columns: ColumnInfo[], params: Array<{ name: string; value: unknown }>): string {
    const add = (value: unknown) => { const name = `@p${params.length}`; params.push({ name, value }); return name; };
    const parts: string[] = [];
    const base = (request.query ?? "").trim().replace(/^where\s+/i, "");
    if (base) {
      if (base.length > 8000) throw new DbError("The condition is too long.");
      parts.push(`(${base})`);
    }
    for (const rule of request.filters ?? []) parts.push(this.ruleClause(rule, add));
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

  private ruleClause(rule: FilterRule, add: (value: unknown) => string): string {
    if (!FILTER_OPS.includes(rule.op)) throw new DbError(`Unknown filter operator "${rule.op}".`);
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
        if (!items.length) throw new DbError(`"in" on ${rule.column} needs a comma-separated list.`);
        if (items.length > 256) throw new DbError("An \"in\" filter takes at most 256 values.");
        return `${f} IN (${items.map(item => add(filterValue(item))).join(", ")})`;
      }
      default: {
        const op = { eq: "=", neq: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[rule.op];
        return `${f} ${op} ${add(filterValue(value))}`;
      }
    }
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const { container, ranges, link, path } = await this.container(request.target);
    const known = await this.describe(request.target);
    const params: Array<{ name: string; value: unknown }> = [];
    const where = this.where(request, known, params);
    const pageSize = Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const offset = (page - 1) * pageSize;
    const order = request.sort ? ` ORDER BY ${field(request.sort.column)} ${request.sort.dir === "desc" ? "DESC" : "ASC"}` : "";
    let docs: Array<Record<string, unknown>>;
    let total: number | null = null;
    const countQuery = `SELECT VALUE COUNT(1) FROM c${where}`;
    if (ranges.length === 1) {
      const [rows, count] = await Promise.all([
        this.queryRange(path, link, ranges[0], `SELECT * FROM c${where}${order} OFFSET ${offset} LIMIT ${pageSize}`, params, pageSize),
        this.queryRange(path, link, ranges[0], countQuery, params, 1).catch(() => undefined)
      ]);
      docs = rows as Array<Record<string, unknown>>;
      total = count && typeof count[0] === "number" ? count[0] : null;
    } else {
      // Several physical partitions: each returns its first offset+pageSize, merged and sorted here.
      if (offset + pageSize > 5000) throw new DbError("This page is too deep for a multi-partition container.", "Add a filter, or sort, to reach these documents.");
      const parts = await Promise.all(ranges.map(r => this.queryRange(path, link, r, `SELECT * FROM c${where}${order} OFFSET 0 LIMIT ${offset + pageSize}`, params, offset + pageSize)));
      let merged = parts.flat() as Array<Record<string, unknown>>;
      if (request.sort) {
        const column = request.sort.column;
        const dir = request.sort.dir === "desc" ? -1 : 1;
        merged = merged.sort((a, b) => dir * compareJson(a[column], b[column]));
      }
      docs = merged.slice(offset, offset + pageSize);
      const counts = await Promise.all(ranges.map(r => this.queryRange(path, link, r, countQuery, params, 1).catch(() => undefined)));
      total = counts.every(c => c && typeof c[0] === "number") ? counts.reduce((sum, c) => sum + (c![0] as number), 0) : null;
    }
    const paths = this.pkPaths(container);
    const rows = docs.map(d => ({ ...this.shape(d), [PK_COLUMN]: partitionKeyHeader(d, paths) }));
    const columns = this.columnsFor(docs.map(d => this.shape(d)), container);
    for (const column of known) if (!columns.some(c => c.name === column.name)) columns.push(column);
    return {
      columns,
      rows: rows.map(encodeRow),
      total,
      keyColumns: ["id", PK_COLUMN],
      keyStrategy: "primary",
      note: ranges.length > 1 ? `Merged from ${ranges.length} physical partitions.` : undefined,
      elapsedMs: since(start)
    };
  }

  private docLink(target: DbTarget, id: string): { path: string; link: string } {
    if (typeof id !== "string" || !id) throw new DbError("The document has no id.", "Cosmos DB documents need a string id.");
    if (/[/\\?#]/.test(id)) throw new DbError("This document's id contains / \\ ? or #, which the REST API cannot address.", "Change it from the Data Explorer in the portal.");
    return CosmosAdapter.link("dbs", target.database ?? "", "colls", target.object, "docs", id);
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const { container, link, path } = await this.container(target);
    const doc = parseJsonDocument(values);
    for (const k of [...SYSTEM, "_etag", "_ts"]) delete doc[k];
    if (typeof doc.id !== "string" || !doc.id) throw new DbError("Give the document a string \"id\".");
    this.docLink(target, doc.id);
    await this.request("POST", `${path}/docs`, "docs", link, "Inserting", { body: doc, headers: { "x-ms-documentdb-partitionkey": partitionKeyHeader(doc, this.pkPaths(container)) } });
    return 1;
  }

  async update(target: DbTarget, key: Row, _strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number> {
    const { container } = await this.container(target);
    const doc = parseJsonDocument(values);
    for (const k of [...SYSTEM, "_etag", "_ts"]) delete doc[k];
    if (doc.id !== key.id) throw new DbError("The id cannot be changed.", "Duplicate the document with the new id, then delete the old one.");
    const pk = partitionKeyHeader(doc, this.pkPaths(container));
    if (pk !== key[PK_COLUMN]) throw new DbError("The partition key value cannot be changed.", "Duplicate the document with the new value, then delete the old one.");
    const d = this.docLink(target, String(key.id));
    await this.request("PUT", d.path, "docs", d.link, "Saving", { body: doc, headers: { "x-ms-documentdb-partitionkey": pk } });
    return 1;
  }

  async remove(target: DbTarget, keys: Row[]): Promise<number> {
    if (!Array.isArray(keys) || !keys.length) throw new DbError("Select at least one document.");
    let removed = 0;
    for (let i = 0; i < keys.length; i += 8) {
      await Promise.all(keys.slice(i, i + 8).map(async key => {
        const d = this.docLink(target, String(key.id ?? ""));
        const pk = String(key[PK_COLUMN] ?? "");
        if (!pk.startsWith("[")) throw new DbError("The partition key is missing. Refresh and try again.");
        await this.request("DELETE", d.path, "docs", d.link, "Deleting", { headers: { "x-ms-documentdb-partitionkey": pk } });
        removed++;
      }));
    }
    return removed;
  }

  async indexes(target: DbTarget): Promise<IndexInfo[]> {
    const { container } = await this.container(target);
    const policy = container.indexingPolicy ?? {};
    const out: IndexInfo[] = [{ name: "Partition key", columns: this.pkPaths(container), unique: false, primary: true, type: container.partitionKey?.kind ?? "Hash" }];
    if (policy.indexingMode) out.push({ name: "Indexing mode", columns: [], unique: false, primary: false, type: policy.indexingMode });
    for (const p of policy.includedPaths ?? []) out.push({ name: "Included path", columns: [p.path], unique: false, primary: false, type: "range" });
    for (const p of policy.excludedPaths ?? []) out.push({ name: "Excluded path", columns: [p.path], unique: false, primary: false, detail: "not indexed" });
    (policy.compositeIndexes ?? []).forEach((ix, i) => out.push({ name: `Composite ${i + 1}`, columns: ix.map(p => `${p.path}${p.order === "descending" ? " DESC" : ""}`), unique: false, primary: false, type: "composite" }));
    for (const p of policy.spatialIndexes ?? []) out.push({ name: "Spatial", columns: [p.path], unique: false, primary: false, type: "spatial" });
    return out;
  }

  async drop(target: DbTarget): Promise<void> {
    const c = CosmosAdapter.link("dbs", target.database ?? "", "colls", target.object);
    await this.request("DELETE", c.path, "colls", c.link, "Deleting the container");
    this.invalidate();
  }

  async truncate(target: DbTarget): Promise<void> {
    const { container, ranges, link, path } = await this.container(target);
    const paths = this.pkPaths(container);
    for (const range of ranges) {
      for (;;) {
        const docs = (await this.queryRange(path, link, range, "SELECT * FROM c", [], 500)) as Array<Record<string, unknown>>;
        if (!docs.length) break;
        await this.remove(target, docs.map(d => ({ id: d.id, [PK_COLUMN]: partitionKeyHeader(d, paths) })));
      }
    }
  }

  classify(text: string): StatementCheck[] {
    const query = text.trim().replace(/;\s*$/, "");
    if (!query) throw new DbError("Enter a query to run.");
    if (!/^select\b/i.test(query)) throw new DbError("Cosmos DB queries start with SELECT.", "Change documents from the grid: open the container and edit, insert or delete.");
    return [{ verb: "select", write: false }];
  }

  /** The container a console query reads: the name after FROM, or the database's only container. */
  private async queryContainer(query: string, database: string): Promise<string> {
    const names = (await this.listObjects(database)).map(o => o.name);
    const from = /\bfrom\s+(?:root\s*\.\s*)?([A-Za-z_][\w-]*)/i.exec(query)?.[1];
    if (from && names.includes(from)) return from;
    if (names.length === 1) return names[0];
    throw new DbError(
      names.length ? "Name the container after FROM, e.g. SELECT * FROM users u WHERE u.active = true" : `The database ${database} has no containers.`,
      names.length ? `Containers in ${database}: ${names.slice(0, 10).join(", ")}${names.length > 10 ? "…" : ""}.` : undefined
    );
  }

  async runQuery(text: string, context: { database?: string }): Promise<QueryResult> {
    const start = Date.now();
    this.classify(text);
    const query = text.trim().replace(/;\s*$/, "");
    const database = context.database || this.spec.database || (await this.listDatabases())[0];
    if (!database) throw new DbError("Pick a database to query.");
    const target = { database, object: await this.queryContainer(query, database) };
    const { ranges, link, path } = await this.container(target);
    const parts = await Promise.all(ranges.map(r => this.queryRange(path, link, r, query, [], LIMITS.maxQueryRows + 1)));
    const docs = parts.flat();
    const rows = docs.slice(0, LIMITS.maxQueryRows).map(d => (d && typeof d === "object" && !Array.isArray(d) ? this.shape(d as Record<string, unknown>) : d)) as Row[];
    return documentsResult(start, rows, docs.length > LIMITS.maxQueryRows, ranges.length > 1 ? `Ran on ${ranges.length} physical partitions of ${target.object}; ORDER BY, TOP and aggregates apply within each partition.` : undefined);
  }
}

function compareJson(a: unknown, b: unknown): number {
  const rank = (v: unknown) => (v === undefined ? 0 : v === null ? 1 : typeof v === "boolean" ? 2 : typeof v === "number" ? 3 : typeof v === "string" ? 4 : 5);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return 0;
}
