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

import type { ConnectionSpec } from "../connection-string";
import { GoogleApi } from "../cloud-auth/gcp";
import { buildSelect, categorize } from "../sql-builder";
import { ColumnInfo, DbError, DbTarget, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, RunControl, ServerInfo } from "../types";
import { encodeRow, since } from "../values";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

interface Field {
  name: string;
  type: string;
  mode?: string;
  fields?: Field[];
}

interface QueryResponse {
  jobComplete?: boolean;
  jobReference?: { jobId: string; location?: string };
  schema?: { fields?: Field[] };
  rows?: Array<{ f: Array<{ v: unknown }> }>;
  pageToken?: string;
  totalRows?: string;
  totalBytesProcessed?: string;
  totalBytesBilled?: string;
  cacheHit?: boolean;
  numDmlAffectedRows?: string;
}

const READ_ONLY = "BigQuery tables have no primary key, so rows are browsed read-only here. Use INSERT, UPDATE or DELETE in the Query tab.";

/** Microseconds since the epoch (or seconds as a float) as an ISO timestamp keeping the microseconds. */
function timestamp(value: string): string {
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
export function decodeBigQuery(value: unknown, field: Field, repeatedDone = false): unknown {
  if (value === null || value === undefined) return null;
  if (field.mode === "REPEATED" && !repeatedDone) return Array.isArray(value) ? value.map(item => decodeBigQuery((item as { v: unknown })?.v, field, true)) : value;
  const type = field.type.toUpperCase();
  if (type === "RECORD" || type === "STRUCT") {
    const cells = (value as { f?: Array<{ v: unknown }> })?.f ?? [];
    const out: Record<string, unknown> = {};
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
      try { return JSON.parse(text); } catch { return text; }
    default:
      return text;
  }
}

function decodeRows(rows: QueryResponse["rows"], fields: Field[]): Row[] {
  return (rows ?? []).map(r => {
    const row: Row = {};
    fields.forEach((f, i) => { row[f.name] = decodeBigQuery(r.f?.[i]?.v, f); });
    return row;
  });
}

function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${i ? n.toFixed(n < 10 ? 2 : 1) : n} ${units[i]}`;
}

/** "Scanned 1.2 GB, billed 1.2 GB" (or "Served from cache") for a finished job. */
function costNote(r: QueryResponse): string | undefined {
  if (r.cacheHit) return "Served from cache (no bytes billed).";
  if (r.totalBytesProcessed === undefined) return undefined;
  const processed = Number(r.totalBytesProcessed);
  const billed = r.totalBytesBilled !== undefined ? Number(r.totalBytesBilled) : undefined;
  return `Scanned ${bytes(processed)}${billed !== undefined && billed !== processed ? `, billed ${bytes(billed)}` : ""}.`;
}

export class BigQueryAdapter extends SqlAdapter {
  readonly kind = "bigquery" as const;
  protected readonly dialect = "googlesql" as const;
  private readonly api: GoogleApi;
  private readonly project: string;
  private readonly tables = new Map<string, { at: number; type: string; numRows?: number; fields: Field[] }>();
  private lastNote?: string;

  constructor(private readonly spec: ConnectionSpec) {
    super();
    this.project = spec.project ?? "";
    this.api = new GoogleApi(spec, `${spec.endpoint ?? "https://bigquery.googleapis.com"}/bigquery/v2`);
  }

  private get p(): string {
    return `projects/${encodeURIComponent(this.project)}`;
  }

  /** Starts a query job and waits for its first page of rows. */
  private async query(sql: string, params: unknown[], options: { dataset?: string; maxResults: number; control?: RunControl }): Promise<QueryResponse & { fields: Field[] }> {
    const body: Record<string, unknown> = {
      query: sql,
      useLegacySql: false,
      maxResults: options.maxResults,
      timeoutMs: 10_000,
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
    let result = await this.api.call<QueryResponse>("POST", `${this.p}/queries`, "The query", body, abort.signal);
    const job = result.jobReference;
    options.control?.onCancel(async () => {
      abort.abort();
      if (job) await this.api.call("POST", `${this.p}/jobs/${encodeURIComponent(job.jobId)}/cancel${job.location ? `?location=${encodeURIComponent(job.location)}` : ""}`, "Cancelling").catch(() => undefined);
    });
    const deadline = Date.now() + LIMITS.queryTimeoutMs;
    while (!result.jobComplete && job) {
      if (Date.now() > deadline) {
        await this.api.call("POST", `${this.p}/jobs/${encodeURIComponent(job.jobId)}/cancel${job.location ? `?location=${encodeURIComponent(job.location)}` : ""}`, "Cancelling").catch(() => undefined);
        throw new DbError(`The query timed out after ${LIMITS.queryTimeoutMs / 1000} seconds and was cancelled.`, "Narrow the query, or run it in the BigQuery console.");
      }
      result = await this.api.call<QueryResponse>("GET", `${this.p}/queries/${encodeURIComponent(job.jobId)}?maxResults=${options.maxResults}&timeoutMs=10000&formatOptions.useInt64Timestamp=true${job.location ? `&location=${encodeURIComponent(job.location)}` : ""}`, "Waiting for the query", undefined, abort.signal);
    }
    return { ...result, fields: result.schema?.fields ?? [] };
  }

  protected async exec(_database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult> {
    const result = await this.query(sql, params, { maxResults: LIMITS.maxPageSize + 1 });
    this.lastNote = costNote(result);
    return { rows: decodeRows(result.rows, result.fields), columns: result.fields.map(f => f.name), affected: result.numDmlAffectedRows !== undefined ? Number(result.numDmlAffectedRows) : undefined };
  }

  async connect(): Promise<ServerInfo> {
    if (!this.project) throw new DbError("Add the Google Cloud project ID.");
    await this.api.call("GET", `${this.p}/datasets?maxResults=1`, "Connecting to BigQuery");
    return { version: this.api.auth.emulator ? "BigQuery emulator" : "BigQuery", defaultDatabase: this.project };
  }

  async close(): Promise<void> {
    this.tables.clear();
  }

  async ping(): Promise<void> {
    await this.api.call("GET", `${this.p}/datasets?maxResults=1`, "Ping");
  }

  override invalidate(): void {
    super.invalidate();
    this.tables.clear();
  }

  async listDatabases(): Promise<string[]> {
    return [this.project];
  }

  async listSchemas(): Promise<string[]> {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.api.call<{ datasets?: Array<{ datasetReference: { datasetId: string } }>; nextPageToken?: string }>("GET", `${this.p}/datasets?maxResults=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, "Listing datasets");
      names.push(...(page.datasets ?? []).map(d => d.datasetReference.datasetId));
      token = page.nextPageToken;
    } while (token && names.length < 5000);
    const preferred = this.spec.options.dataset;
    return names.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : a.localeCompare(b)));
  }

  async listObjects(_database: string, schema?: string): Promise<ObjectInfo[]> {
    if (!schema) throw new DbError("Pick a dataset.");
    const out: ObjectInfo[] = [];
    let token: string | undefined;
    do {
      const page = await this.api.call<{ tables?: Array<{ tableReference: { tableId: string }; type?: string }>; nextPageToken?: string }>("GET", `${this.p}/datasets/${encodeURIComponent(schema)}/tables?maxResults=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, "Listing tables");
      for (const t of page.tables ?? []) out.push({ name: t.tableReference.tableId, type: /VIEW/.test(t.type ?? "") ? "view" : "table" });
      token = page.nextPageToken;
    } while (token && out.length < 10_000);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async table(target: DbTarget): Promise<{ type: string; numRows?: number; fields: Field[] }> {
    if (!target.schema) throw new DbError("No dataset selected.");
    const key = `${target.schema}\u0000${target.object}`;
    const cached = this.tables.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached;
    const t = await this.api.call<{ type?: string; numRows?: string; schema?: { fields?: Field[] } }>("GET", `${this.p}/datasets/${encodeURIComponent(target.schema)}/tables/${encodeURIComponent(target.object)}`, "Reading the table");
    const entry = { at: Date.now(), type: t.type ?? "TABLE", numRows: t.numRows !== undefined ? Number(t.numRows) : undefined, fields: t.schema?.fields ?? [] };
    this.tables.set(key, entry);
    return entry;
  }

  protected async introspect(target: DbTarget): Promise<TableMeta> {
    const t = await this.table(target);
    const columns: ColumnInfo[] = t.fields.map(f => {
      const nested = f.type === "RECORD" || f.type === "STRUCT";
      const repeated = f.mode === "REPEATED";
      const dataType = `${repeated ? "ARRAY<" : ""}${nested ? `STRUCT<${(f.fields ?? []).map(x => `${x.name} ${x.type}`).join(", ")}>` : f.type}${repeated ? ">" : ""}`;
      return {
        name: f.name,
        dataType,
        category: nested || repeated ? "json" : categorize(f.type),
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

  override async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const meta = await this.tableMeta(request.target);
    const t = await this.table(request.target);
    const pageSize = Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const plain = !request.sort && !(request.filters ?? []).length && !(request.search ?? "").trim() && t.type === "TABLE";
    let rows: Row[];
    let total: number | null = null;
    let note: string | undefined;
    if (plain) {
      // tabledata.list reads stored rows without a query job, so browsing is free.
      const data = await this.api.call<{ rows?: QueryResponse["rows"]; totalRows?: string }>("GET", `${this.p}/datasets/${encodeURIComponent(request.target.schema ?? "")}/tables/${encodeURIComponent(request.target.object)}/data?startIndex=${(page - 1) * pageSize}&maxResults=${pageSize}&formatOptions.useInt64Timestamp=true`, "Reading rows");
      rows = decodeRows(data.rows, t.fields);
      total = data.totalRows !== undefined ? Number(data.totalRows) : t.numRows ?? null;
      note = "Read with tabledata.list (no query cost).";
    } else {
      const plan = buildSelect(request, meta.columns, "none", this.dialect);
      const result = await this.exec(request.target.database, plan.select.sql, plan.select.params);
      rows = result.rows;
      note = this.lastNote;
    }
    return {
      columns: meta.columns,
      rows: rows.map(encodeRow),
      total,
      hasMore: total === null ? rows.length === pageSize : undefined,
      keyColumns: [],
      keyStrategy: "none",
      readOnly: READ_ONLY,
      canInsert: false,
      note,
      elapsedMs: since(start)
    };
  }

  override async drop(target: DbTarget): Promise<void> {
    await this.api.call("DELETE", `${this.p}/datasets/${encodeURIComponent(target.schema ?? "")}/tables/${encodeURIComponent(target.object)}`, "Deleting the table");
    this.invalidate();
  }

  async runQuery(text: string, context: { database?: string; schema?: string }, control?: RunControl): Promise<QueryResult> {
    const start = Date.now();
    const statements = this.classify(text);
    // BigQuery runs a multi-statement script as one job and returns the last statement's rows.
    let result;
    try {
      result = await this.query(text, [], { dataset: context.schema || this.spec.options.dataset, maxResults: LIMITS.maxQueryRows + 1, control });
    } finally {
      if (statements.some(s => s.write)) this.invalidate();
    }
    const rows = decodeRows(result.rows, result.fields);
    const affected = result.numDmlAffectedRows !== undefined ? Number(result.numDmlAffectedRows) : undefined;
    const cost = costNote(result);
    const message = result.fields.length ? undefined : `${statements.map(s => s.verb.toUpperCase()).join(", ")} completed${affected !== undefined ? `, ${affected} row${affected === 1 ? "" : "s"} affected` : ""}. ${cost ?? ""}`.trim();
    const out = this.queryResult(start, rows, result.fields.map(f => f.name), affected, LIMITS.maxQueryRows, message);
    return { ...out, truncated: out.truncated || !!result.pageToken, note: result.fields.length ? cost : undefined };
  }
}
