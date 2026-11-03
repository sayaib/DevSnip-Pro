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

import type { ConnectionSpec } from "../connection-string";
import { AwsCredentials, resolveAwsCredentials, signRequest } from "../cloud-auth/aws";
import { expectJson, httpRequest } from "../cloud-auth/http";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbTarget, FilterRule, FILTER_OPS, IndexInfo, KeyStrategy, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, ServerInfo, StatementCheck } from "../types";
import { encodeRow, since } from "../values";
import { documentsResult, inferColumns, parseJsonDocument, splitStatements } from "./document-base";

type AttributeValue = Record<string, unknown>;
type Item = Record<string, AttributeValue>;

interface TableDescription {
  TableName: string;
  TableStatus?: string;
  ItemCount?: number;
  KeySchema: Array<{ AttributeName: string; KeyType: "HASH" | "RANGE" }>;
  AttributeDefinitions: Array<{ AttributeName: string; AttributeType: string }>;
  GlobalSecondaryIndexes?: Array<{ IndexName: string; KeySchema: TableDescription["KeySchema"]; Projection?: { ProjectionType?: string } }>;
  LocalSecondaryIndexes?: Array<{ IndexName: string; KeySchema: TableDescription["KeySchema"]; Projection?: { ProjectionType?: string } }>;
}

const SAFE_DIGITS = 15;

const hashFirst = (a: { KeyType: string }, b: { KeyType: string }) => (a.KeyType === "HASH" ? 0 : 1) - (b.KeyType === "HASH" ? 0 : 1);

/** A DynamoDB number as JSON: a JS number when it survives the round trip, else a marker. */
function numberValue(text: string): unknown {
  const n = Number(text);
  const digits = text.replace(/[eE].*$/, "").replace(/[^0-9]/g, "").replace(/^0+/, "").length;
  return Number.isFinite(n) && (Number.isSafeInteger(n) || digits <= SAFE_DIGITS) && !/[eE]/.test(text) ? n : { $numberDecimal: text };
}

export function fromAttribute(value: AttributeValue): unknown {
  const [type, v] = Object.entries(value ?? {})[0] ?? ["NULL", true];
  switch (type) {
    case "S": return v;
    case "N": return numberValue(String(v));
    case "BOOL": return v === true;
    case "NULL": return null;
    case "B": return { $binary: { base64: v, subType: "00" } };
    case "M": return fromItem(v as Item);
    case "L": return (v as AttributeValue[]).map(fromAttribute);
    case "SS": return { $SS: v };
    case "NS": return { $NS: v };
    case "BS": return { $BS: v };
    default: return v;
  }
}

export function fromItem(item: Item): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(item ?? {})) out[k] = fromAttribute(v);
  return out;
}

const MARKERS = ["$numberDecimal", "$numberLong", "$binary", "$SS", "$NS", "$BS"];

export function toAttribute(value: unknown, path = "value"): AttributeValue {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === "string") return { S: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DbError(`${path}: DynamoDB numbers must be finite.`);
    return { N: String(value) };
  }
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map((v, i) => toAttribute(v, `${path}[${i}]`)) };
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    if (keys.length === 1 && MARKERS.includes(keys[0])) {
      const marker = keys[0];
      const inner = (value as Record<string, unknown>)[marker];
      if (marker === "$binary") {
        const base64 = typeof inner === "string" ? inner : (inner as { base64?: unknown })?.base64;
        if (typeof base64 !== "string") throw new DbError(`${path}: $binary expects { "base64": "..." }.`);
        return { B: base64 };
      }
      if (marker === "$numberDecimal" || marker === "$numberLong") {
        if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(String(inner))) throw new DbError(`${path}: "${inner}" is not a number.`);
        return { N: String(inner) };
      }
      if (!Array.isArray(inner) || !inner.length) throw new DbError(`${path}: ${marker} expects a non-empty array (DynamoDB sets cannot be empty).`);
      return { [marker.slice(1)]: inner.map(String) };
    }
    const m: Item = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) m[k] = toAttribute(v, `${path}.${k}`);
    return { M: m };
  }
  throw new DbError(`${path}: unsupported value.`);
}

export function toItem(doc: Record<string, unknown>): Item {
  const out: Item = {};
  for (const [k, v] of Object.entries(doc)) out[k] = toAttribute(v, k);
  return out;
}

/** The type of a JSON value, in DynamoDB's letters. */
function attributeType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const attr = toAttribute(value);
  return Object.keys(attr)[0];
}

export { attributeType };

const TYPE_KIND: Record<string, string> = { S: "string", N: "number", BOOL: "boolean", B: "binary", null: "null", NULL: "null" };

/** Attribute names go into PartiQL quoted; a quote inside one would end the identifier. */
function partiqlName(name: string): string {
  if (typeof name !== "string" || !name || name.length > 255 || /["\u0000]/.test(name)) throw new DbError(`"${String(name).slice(0, 60)}" cannot be used as an attribute name here.`);
  return `"${name}"`;
}

export class DynamoAdapter implements DbAdapter {
  readonly kind = "dynamodb" as const;
  private credentials?: AwsCredentials;
  private readonly tables = new Map<string, { at: number; table: TableDescription; columns?: ColumnInfo[] }>();
  /** NextToken of each page already visited, per query: cursor paging cannot jump. */
  private readonly cursors = new Map<string, Array<string | undefined>>();
  private readonly endpoint: string;
  private readonly region: string;

  constructor(private readonly spec: ConnectionSpec) {
    this.region = spec.region ?? "us-east-1";
    this.endpoint = spec.endpoint ?? `https://dynamodb.${this.region}.amazonaws.com${this.region.startsWith("cn-") ? ".cn" : ""}`;
  }

  private async call<T = Record<string, any>>(operation: string, body: Record<string, unknown>): Promise<T> {
    if (!this.credentials || (this.credentials.expiresAt && this.credentials.expiresAt - Date.now() < 60_000)) this.credentials = await resolveAwsCredentials(this.spec);
    const payload = JSON.stringify(body);
    const headers = signRequest({
      method: "POST",
      url: `${this.endpoint}/`,
      headers: { "content-type": "application/x-amz-json-1.0", "x-amz-target": `DynamoDB_20120810.${operation}` },
      body: payload,
      region: this.region,
      service: "dynamodb",
      credentials: this.credentials
    });
    delete headers.host;
    const response = await httpRequest({ method: "POST", url: `${this.endpoint}/`, headers, body: payload, insecure: /^(true|1|yes)$/i.test(this.spec.options.insecure ?? "") });
    if (response.status === 400 && /ConditionalCheckFailed/.test(response.text)) {
      throw new DbError(operation === "PutItem" && /attribute_not_exists/.test(payload) ? "An item with this key already exists." : "The item no longer exists. Refresh and try again.", undefined, "CONDITION");
    }
    return expectJson<T>(response, `DynamoDB ${operation}`);
  }

  async connect(): Promise<ServerInfo> {
    await this.call("ListTables", { Limit: 1 });
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/i.test(this.endpoint);
    return { version: local ? `DynamoDB Local (${this.endpoint.replace(/^https?:\/\//, "")})` : `Amazon DynamoDB (${this.region})`, defaultDatabase: this.region };
  }

  async close(): Promise<void> {
    this.credentials = undefined;
  }

  async ping(): Promise<void> {
    await this.call("ListTables", { Limit: 1 });
  }

  invalidate(): void {
    this.tables.clear();
    this.cursors.clear();
  }

  async listDatabases(): Promise<string[]> {
    return [this.region];
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(): Promise<ObjectInfo[]> {
    const names: string[] = [];
    let start: string | undefined;
    do {
      const page = await this.call<{ TableNames?: string[]; LastEvaluatedTableName?: string }>("ListTables", { Limit: 100, ...(start ? { ExclusiveStartTableName: start } : {}) });
      names.push(...(page.TableNames ?? []));
      start = page.LastEvaluatedTableName;
    } while (start && names.length < 2000);
    // Item counts (refreshed by DynamoDB about every six hours) for a short list only.
    const counts = new Map<string, number>();
    if (names.length <= 50) {
      for (let i = 0; i < names.length; i += 8) {
        await Promise.all(names.slice(i, i + 8).map(name => this.table(name).then(t => { if (typeof t.ItemCount === "number") counts.set(name, t.ItemCount); }).catch(() => undefined)));
      }
    }
    return names.map(name => ({ name, type: "table", rows: counts.get(name) }));
  }

  private async table(name: string): Promise<TableDescription> {
    if (!name) throw new DbError("No table selected.");
    const cached = this.tables.get(name);
    if (cached && Date.now() - cached.at < 60_000) return cached.table;
    const result = await this.call<{ Table: TableDescription }>("DescribeTable", { TableName: name });
    this.tables.set(name, { at: Date.now(), table: result.Table });
    return result.Table;
  }

  private keysOf(table: TableDescription): Array<{ name: string; type: string; role: string }> {
    const types = new Map(table.AttributeDefinitions.map(a => [a.AttributeName, a.AttributeType]));
    return [...table.KeySchema].sort(hashFirst).map(k => ({ name: k.AttributeName, type: types.get(k.AttributeName) ?? "S", role: k.KeyType === "HASH" ? "partition key" : "sort key" }));
  }

  async describe(target: DbTarget): Promise<ColumnInfo[]> {
    const table = await this.table(target.object);
    const cached = this.tables.get(target.object);
    if (cached?.columns) return cached.columns;
    const sample = await this.call<{ Items?: Item[] }>("Scan", { TableName: target.object, Limit: LIMITS.mongoSample });
    const keys = this.keysOf(table);
    const columns = inferColumns((sample.Items ?? []).map(fromItem), keys.map(k => ({ name: k.name, type: `${k.type} (${k.role})` })), attributeType, t => TYPE_KIND[t.split(" ")[0]] ?? "json");
    if (cached) cached.columns = columns;
    return columns;
  }

  /** A filter value typed in the grid, as the attribute type the column holds. */
  private filterValue(column: ColumnInfo | undefined, raw: string): AttributeValue {
    const text = raw.trim();
    if (/^".*"$/s.test(text)) return { S: text.slice(1, -1) };
    if (column?.category === "number" && /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(text)) return { N: text };
    if (column?.category === "boolean" && /^(true|false)$/i.test(text)) return { BOOL: /^true$/i.test(text) };
    if (!column && /^[-+]?\d+(\.\d+)?$/.test(text)) return { N: text };
    return { S: raw };
  }

  private where(request: PageRequest, columns: ColumnInfo[]): { clause: string; params: AttributeValue[] } {
    const parts: string[] = [];
    const params: AttributeValue[] = [];
    const base = (request.query ?? "").trim();
    if (base) {
      if (base.length > 4000 || /;/.test(base.replace(/'([^']|'')*'/g, ""))) throw new DbError("The PartiQL condition must be a single expression.");
      parts.push(`(${base})`);
    }
    if ((request.search ?? "").trim()) throw new DbError("DynamoDB has no text search.", "Use Filter (contains, begins with) or a PartiQL condition.");
    for (const rule of request.filters ?? []) parts.push(this.ruleClause(rule, columns.find(c => c.name === rule.column), params));
    return { clause: parts.length ? ` WHERE ${parts.join(" AND ")}` : "", params };
  }

  private ruleClause(rule: FilterRule, column: ColumnInfo | undefined, params: AttributeValue[]): string {
    if (!FILTER_OPS.includes(rule.op)) throw new DbError(`Unknown filter operator "${rule.op}".`);
    const name = partiqlName(rule.column);
    const value = String(rule.value ?? "");
    const add = (v: AttributeValue) => { params.push(v); return "?"; };
    switch (rule.op) {
      case "null": return `(${name} IS NULL OR ${name} IS MISSING)`;
      case "notnull": return `(${name} IS NOT NULL AND ${name} IS NOT MISSING)`;
      case "contains": return `contains(${name}, ${add({ S: value })})`;
      case "starts": return `begins_with(${name}, ${add({ S: value })})`;
      case "ends": throw new DbError("DynamoDB cannot match the end of a value.", "Use contains or begins with.");
      case "in": {
        const items = value.split(",").map(s => s.trim()).filter(Boolean);
        if (!items.length) throw new DbError(`"in" on ${rule.column} needs a comma-separated list.`);
        if (items.length > 50) throw new DbError("DynamoDB's IN takes at most 50 values.");
        return `${name} IN [${items.map(item => add(this.filterValue(column, item))).join(", ")}]`;
      }
      default: {
        const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[rule.op];
        return `${name} ${op} ${add(this.filterValue(column, value))}`;
      }
    }
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const table = await this.table(request.target.object);
    const known = await this.describe(request.target);
    if (request.sort) throw new DbError("DynamoDB scans cannot be sorted.", "Query a table by its partition key in the Query tab to get items in sort-key order.");
    const { clause, params } = this.where(request, known);
    const statement = `SELECT * FROM ${partiqlName(table.TableName)}${clause}`;
    const pageSize = Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const signature = JSON.stringify([statement, params, pageSize]);
    const tokens = this.cursors.get(signature) ?? [undefined];
    // Most recent last; every distinct filter adds one, so the oldest go once there are many.
    this.cursors.delete(signature);
    this.cursors.set(signature, tokens);
    while (this.cursors.size > 50) this.cursors.delete(this.cursors.keys().next().value as string);
    // Walk forward from the furthest page already known; a cursor cannot jump.
    let index = Math.min(page, tokens.length) - 1;
    if (page - 1 - index > 20) throw new DbError(`Page ${page} is too far ahead to scan to.`, "Go forward a few pages at a time, or add a filter.");
    let items: Item[] = [];
    let next: string | undefined;
    for (;;) {
      items = [];
      let token = tokens[index];
      // A page after the last one: the scan already ended.
      if (index > 0 && token === undefined) { next = undefined; break; }
      let calls = 0;
      do {
        const result = await this.call<{ Items?: Item[]; NextToken?: string }>("ExecuteStatement", {
          Statement: statement, Limit: pageSize - items.length, ...(params.length ? { Parameters: params } : {}), ...(token ? { NextToken: token } : {})
        });
        items.push(...(result.Items ?? []));
        token = result.NextToken;
        calls++;
      } while (token && items.length < pageSize && calls < 50);
      next = token;
      if (tokens.length <= index + 1) tokens.push(next);
      else tokens[index + 1] = next;
      if (index + 1 >= page || !next) break;
      index++;
    }
    if (index + 1 < page || (index > 0 && tokens[index] === undefined)) items = [];
    const docs = items.map(fromItem);
    const keys = this.keysOf(table).map(k => k.name);
    const columns = inferColumns(docs, this.keysOf(table).map(k => ({ name: k.name, type: `${k.type} (${k.role})` })), attributeType, t => TYPE_KIND[t.split(" ")[0]] ?? "json");
    for (const column of known) if (!columns.some(c => c.name === column.name)) columns.push(column);
    return {
      columns,
      rows: docs.map(encodeRow),
      total: null,
      hasMore: !!next && index + 1 >= page,
      keyColumns: keys,
      keyStrategy: "primary",
      note: !clause && typeof table.ItemCount === "number" ? `About ${table.ItemCount.toLocaleString("en-US")} items (DynamoDB updates this count every few hours).` : undefined,
      elapsedMs: since(start)
    };
  }

  private keyOf(table: TableDescription, row: Row): Item {
    const key: Item = {};
    for (const { name } of this.keysOf(table)) {
      if (!row || !(name in row) || row[name] === null || row[name] === undefined) throw new DbError(`The key attribute ${name} is missing.`, "Every item needs its partition key (and sort key, if the table has one).");
      key[name] = toAttribute(row[name], name);
      const type = Object.keys(key[name])[0];
      if (!["S", "N", "B"].includes(type)) throw new DbError(`The key attribute ${name} must be a string, number or binary value.`);
    }
    return key;
  }

  private keyCondition(table: TableDescription, exists: boolean): Record<string, unknown> {
    const hash = this.keysOf(table)[0].name;
    return { ConditionExpression: exists ? "attribute_exists(#k)" : "attribute_not_exists(#k)", ExpressionAttributeNames: { "#k": hash } };
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const table = await this.table(target.object);
    const doc = parseJsonDocument(values);
    this.keyOf(table, doc);
    await this.call("PutItem", { TableName: table.TableName, Item: toItem(doc), ...this.keyCondition(table, false) });
    this.cursors.clear();
    return 1;
  }

  async update(target: DbTarget, key: Row, _strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number> {
    const table = await this.table(target.object);
    const doc = parseJsonDocument(values);
    const before = JSON.stringify(this.keyOf(table, key));
    const after = JSON.stringify(this.keyOf(table, doc));
    if (before !== after) throw new DbError("Key attributes cannot be changed.", "Duplicate the item with the new key, then delete the old one.");
    await this.call("PutItem", { TableName: table.TableName, Item: toItem(doc), ...this.keyCondition(table, true) });
    return 1;
  }

  async remove(target: DbTarget, keys: Row[]): Promise<number> {
    const table = await this.table(target.object);
    if (!Array.isArray(keys) || !keys.length) throw new DbError("Select at least one item.");
    const requests = keys.map(k => ({ DeleteRequest: { Key: this.keyOf(table, k) } }));
    await this.batchWrite(table.TableName, requests);
    this.cursors.clear();
    return requests.length;
  }

  private async batchWrite(tableName: string, requests: Array<Record<string, unknown>>): Promise<void> {
    for (let i = 0; i < requests.length; i += 25) {
      let pending: Array<Record<string, unknown>> = requests.slice(i, i + 25);
      for (let attempt = 0; pending.length; attempt++) {
        if (attempt > 6) throw new DbError("DynamoDB kept throttling the delete.", "Try again, or raise the table's write capacity.");
        if (attempt) await new Promise(r => setTimeout(r, 100 * 2 ** attempt));
        const result = await this.call<{ UnprocessedItems?: Record<string, Array<Record<string, unknown>>> }>("BatchWriteItem", { RequestItems: { [tableName]: pending } });
        pending = result.UnprocessedItems?.[tableName] ?? [];
      }
    }
  }

  async indexes(target: DbTarget): Promise<IndexInfo[]> {
    const table = await this.table(target.object);
    const names = (schema: TableDescription["KeySchema"]) => [...schema].sort(hashFirst).map(k => `${k.AttributeName}${k.KeyType === "RANGE" ? " (sort)" : ""}`);
    return [
      { name: "Primary key", columns: names(table.KeySchema), unique: true, primary: true, type: "table" },
      ...(table.GlobalSecondaryIndexes ?? []).map(ix => ({ name: ix.IndexName, columns: names(ix.KeySchema), unique: false, primary: false, type: "GSI", detail: ix.Projection?.ProjectionType ? `projects ${ix.Projection.ProjectionType}` : undefined })),
      ...(table.LocalSecondaryIndexes ?? []).map(ix => ({ name: ix.IndexName, columns: names(ix.KeySchema), unique: false, primary: false, type: "LSI", detail: ix.Projection?.ProjectionType ? `projects ${ix.Projection.ProjectionType}` : undefined }))
    ];
  }

  async drop(target: DbTarget): Promise<void> {
    await this.call("DeleteTable", { TableName: target.object });
    this.invalidate();
  }

  async truncate(target: DbTarget): Promise<void> {
    const table = await this.table(target.object);
    const keys = this.keysOf(table).map(k => k.name);
    const names = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
    let start: Item | undefined;
    do {
      const page = await this.call<{ Items?: Item[]; LastEvaluatedKey?: Item }>("Scan", {
        TableName: table.TableName, ProjectionExpression: Object.keys(names).join(", "), ExpressionAttributeNames: names, Limit: 500, ...(start ? { ExclusiveStartKey: start } : {})
      });
      await this.batchWrite(table.TableName, (page.Items ?? []).map(item => ({ DeleteRequest: { Key: item } })));
      start = page.LastEvaluatedKey;
    } while (start);
    this.cursors.clear();
  }

  classify(text: string): StatementCheck[] {
    const statements = splitStatements(text);
    if (!statements.length) throw new DbError("Enter a PartiQL statement to run.");
    return statements.map(s => {
      const verb = (/^\s*(\w+)/.exec(s.text)?.[1] ?? "").toLowerCase();
      if (!["select", "insert", "update", "delete", "exists"].includes(verb)) throw new DbError(`DynamoDB PartiQL does not support ${verb.toUpperCase() || "this statement"}.`, "Use SELECT, INSERT, UPDATE or DELETE.");
      return { verb, write: verb !== "select" && verb !== "exists", danger: verb === "delete" ? "DELETE removes the matching item." : undefined };
    });
  }

  async runQuery(text: string): Promise<QueryResult> {
    const start = Date.now();
    const statements = splitStatements(text);
    this.classify(text);
    let last: QueryResult | undefined;
    let writes = 0;
    for (const statement of statements) {
      const verb = (/^\s*(\w+)/.exec(statement.text)?.[1] ?? "").toLowerCase();
      const items: Item[] = [];
      let token: string | undefined;
      try {
        do {
          const result = await this.call<{ Items?: Item[]; NextToken?: string }>("ExecuteStatement", { Statement: statement.text, ...(token ? { NextToken: token } : {}) });
          items.push(...(result.Items ?? []));
          token = result.NextToken;
        } while (token && items.length <= LIMITS.maxQueryRows);
      } catch (error) {
        // Points the editor at the statement that failed.
        throw error instanceof DbError ? error.at(statement.offset) : error;
      }
      if (verb === "select") last = documentsResult(start, items.slice(0, LIMITS.maxQueryRows).map(fromItem), items.length > LIMITS.maxQueryRows || !!token);
      else writes++;
    }
    if (writes) this.cursors.clear();
    return last && !writes ? last : last ?? { columns: [], rows: [], message: `${writes} statement${writes === 1 ? "" : "s"} completed.`, affected: undefined, elapsedMs: since(start) };
  }
}
