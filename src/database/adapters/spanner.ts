/**
 * Cloud Spanner (GoogleSQL databases) through the REST API, with the shared
 * SQL grid on the GoogleSQL dialect.
 *
 * Reads run in single-use read-only transactions; DML runs in a read-write
 * transaction committed right away; DDL (CREATE, ALTER, DROP) goes through
 * the database's updateDdl operation, which is awaited. Every parameter is
 * sent as a STRING and cast to the column's type in SQL, so values keep
 * their exact text (INT64, NUMERIC, TIMESTAMP).
 */

import type { ConnectionSpec } from "../connection-string";
import { GoogleApi } from "../cloud-auth/gcp";
import { categorize } from "../sql-builder";
import { DbError, DbTarget, IndexInfo, LIMITS, ObjectInfo, QueryResult, Row, ServerInfo } from "../types";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

interface SpannerType {
  code: string;
  arrayElementType?: SpannerType;
  structType?: { fields: Array<{ name: string; type: SpannerType }> };
}

interface ResultSet {
  metadata?: { rowType?: { fields?: Array<{ name: string; type: SpannerType }> }; transaction?: { id?: string } };
  rows?: unknown[][];
  stats?: { rowCountExact?: string };
}

const DDL = new Set(["create", "alter", "drop", "rename", "grant", "revoke", "analyze"]);

/** A Spanner JSON value as a JS value, by its column type. */
export function decodeSpanner(value: unknown, type: SpannerType | undefined): unknown {
  if (value === null || value === undefined) return null;
  switch (type?.code) {
    case "INT64": {
      const n = Number(value);
      return Number.isSafeInteger(n) ? n : String(value);
    }
    case "FLOAT64":
    case "FLOAT32":
      return typeof value === "number" ? value : String(value);
    case "BOOL":
      return value === true;
    case "BYTES":
      return Buffer.from(String(value), "base64");
    case "JSON":
      try { return JSON.parse(String(value)); } catch { return value; }
    case "ARRAY":
      return Array.isArray(value) ? value.map(v => decodeSpanner(v, type.arrayElementType)) : value;
    case "STRUCT": {
      const fields = type.structType?.fields ?? [];
      if (!Array.isArray(value)) return value;
      const out: Record<string, unknown> = {};
      fields.forEach((f, i) => { out[f.name || `_${i}`] = decodeSpanner(value[i], f.type); });
      return out;
    }
    default:
      return value;
  }
}

export class SpannerAdapter extends SqlAdapter {
  readonly kind = "spanner" as const;
  protected readonly dialect = "googlesql" as const;
  private readonly api: GoogleApi;
  private readonly sessions = new Map<string, Promise<string>>();
  private readonly dialects = new Map<string, string>();
  private defaultDb: string;
  private readonly instancePath: string;

  constructor(private readonly spec: ConnectionSpec) {
    super();
    this.api = new GoogleApi(spec, `${spec.endpoint ?? "https://spanner.googleapis.com"}/v1`);
    this.instancePath = `projects/${spec.project}/instances/${spec.instance}`;
    this.defaultDb = spec.database ?? "";
  }

  private dbPath(database?: string): string {
    const name = database || this.defaultDb;
    if (!name) throw new DbError("No Spanner database selected.", "Add the database ID to the connection.");
    return `${this.instancePath}/databases/${name}`;
  }

  private session(database?: string): Promise<string> {
    const path = this.dbPath(database);
    let session = this.sessions.get(path);
    if (!session) {
      session = this.api.call<{ name: string }>("POST", `${path}/sessions`, "Opening a Spanner session", { session: { labels: { client: "devsnip-pro" } } }).then(s => s.name);
      // A failed attempt must not be cached.
      session.catch(() => this.sessions.delete(path));
      this.sessions.set(path, session);
    }
    return session;
  }

  /** Runs one statement; a session the server forgot (idle for an hour) is replaced once. */
  private async execute(database: string | undefined, body: Record<string, unknown>, retry = true): Promise<ResultSet> {
    const session = await this.session(database);
    try {
      const result = await this.api.call<ResultSet>("POST", `${session}:executeSql`, "The query", body);
      if (body.transaction && result.metadata?.transaction?.id) {
        await this.api.call("POST", `${session}:commit`, "Committing", { transactionId: result.metadata.transaction.id });
      }
      return result;
    } catch (error) {
      if (retry && error instanceof DbError && /Session not found/i.test(error.message)) {
        this.sessions.delete(this.dbPath(database));
        return this.execute(database, body, false);
      }
      throw error;
    }
  }

  private static request(sql: string, params: unknown[], dml: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = { sql };
    if (params.length) {
      body.params = Object.fromEntries(params.map((v, i) => [`p${i + 1}`, v === null || v === undefined ? null : String(v)]));
      body.paramTypes = Object.fromEntries(params.map((_, i) => [`p${i + 1}`, { code: "STRING" }]));
    }
    if (dml) {
      body.transaction = { begin: { readWrite: {} } };
      body.seqno = "1";
    }
    return body;
  }

  private static rows(result: ResultSet): { rows: Row[]; columns: string[] } {
    const fields = result.metadata?.rowType?.fields ?? [];
    const columns = fields.map((f, i) => f.name || `column_${i + 1}`);
    const rows = (result.rows ?? []).map(values => {
      const row: Row = {};
      fields.forEach((f, i) => { row[columns[i]] = decodeSpanner(values[i], f.type); });
      return row;
    });
    return { rows, columns };
  }

  protected async exec(database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult> {
    const dml = /^\s*(insert|update|delete)\b/i.test(sql);
    const result = await this.execute(database, SpannerAdapter.request(sql, params, dml));
    const { rows, columns } = SpannerAdapter.rows(result);
    return { rows, columns, affected: result.stats?.rowCountExact !== undefined ? Number(result.stats.rowCountExact) : undefined };
  }

  /** Applies DDL statements and waits for the long-running operation. */
  private async ddl(database: string | undefined, statements: string[]): Promise<void> {
    let operation = await this.api.call<{ name?: string; done?: boolean; error?: { message?: string } }>("PATCH", `${this.dbPath(database)}/ddl`, "Changing the schema", { statements });
    const deadline = Date.now() + LIMITS.queryTimeoutMs;
    while (!operation.done && operation.name && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500));
      operation = await this.api.call("GET", operation.name, "Waiting for the schema change");
    }
    if (operation.error) throw new DbError(`The schema change failed: ${operation.error.message ?? "unknown error"}`);
    if (!operation.done) throw new DbError("The schema change is still running.", "Spanner applies it in the background; refresh in a while.");
    this.invalidate();
  }

  async connect(): Promise<ServerInfo> {
    if (!this.defaultDb) {
      const names = await this.listDatabases();
      if (!names.length) throw new DbError(`The instance ${this.spec.instance} has no databases.`);
      this.defaultDb = names[0];
    }
    await this.exec(this.defaultDb, "SELECT 1", []);
    const emulator = this.api.auth.emulator;
    return { version: emulator ? "Cloud Spanner emulator" : "Cloud Spanner", defaultDatabase: this.defaultDb };
  }

  async close(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map(async s => this.api.call("DELETE", await s, "Closing the session")));
  }

  async ping(): Promise<void> {
    await this.exec(this.defaultDb, "SELECT 1", []);
  }

  async listDatabases(): Promise<string[]> {
    try {
      const names: string[] = [];
      let token: string | undefined;
      do {
        const page = await this.api.call<{ databases?: Array<{ name: string; databaseDialect?: string }>; nextPageToken?: string }>("GET", `${this.instancePath}/databases?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, "Listing databases");
        for (const db of page.databases ?? []) {
          const name = db.name.split("/").pop()!;
          names.push(name);
          if (db.databaseDialect) this.dialects.set(name, db.databaseDialect);
        }
        token = page.nextPageToken;
      } while (token && names.length < 1000);
      return names.sort();
    } catch (error) {
      // Users with access to one database may not list the instance.
      if (this.defaultDb) return [this.defaultDb];
      throw error;
    }
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  private requireGoogleSql(database: string | undefined): void {
    if (this.dialects.get(database || this.defaultDb) === "POSTGRESQL") {
      throw new DbError("This is a PostgreSQL-dialect database: browsing supports GoogleSQL databases.", "Use the Query tab; it runs PostgreSQL-dialect SQL as is.");
    }
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    this.requireGoogleSql(database);
    const r = await this.exec(database, "SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '' ORDER BY TABLE_NAME", []);
    return r.rows.map(row => ({ name: String(row.name), type: String(row.type) === "VIEW" ? "view" : "table" }));
  }

  protected async introspect(target: DbTarget): Promise<TableMeta> {
    this.requireGoogleSql(target.database);
    const [columns, keys, kind] = await Promise.all([
      this.exec(target.database, "SELECT COLUMN_NAME AS name, SPANNER_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def, IS_GENERATED AS generated FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = '' AND TABLE_NAME = @p1 ORDER BY ORDINAL_POSITION", [target.object]),
      this.exec(target.database, "SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.INDEX_COLUMNS WHERE TABLE_SCHEMA = '' AND TABLE_NAME = @p1 AND INDEX_TYPE = 'PRIMARY_KEY'", [target.object]),
      this.exec(target.database, "SELECT TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '' AND TABLE_NAME = @p1", [target.object])
    ]);
    const pk = new Set(keys.rows.map(r => String(r.name)));
    const isView = String(kind.rows[0]?.type ?? "") === "VIEW";
    return {
      columns: columns.rows.map(r => {
        const dataType = String(r.type);
        const composite = /^(ARRAY|STRUCT|PROTO)/i.test(dataType);
        const category = composite ? "json" : categorize(dataType);
        const def = r.def === null || r.def === undefined ? null : String(r.def);
        return {
          name: String(r.name),
          dataType,
          category,
          nullable: r.nullable === "YES",
          primaryKey: pk.has(String(r.name)),
          autoIncrement: /GET_NEXT_SEQUENCE_VALUE/i.test(def ?? ""),
          defaultValue: def,
          editable: !composite && category !== "binary" && r.generated !== "ALWAYS",
          sortable: !composite && !/^JSON/i.test(dataType)
        };
      }),
      isView,
      hasRowid: false,
      dropKeyword: isView ? "VIEW" : "TABLE"
    };
  }

  override async indexes(target: DbTarget): Promise<IndexInfo[]> {
    const [indexes, columns] = await Promise.all([
      this.exec(target.database, "SELECT INDEX_NAME AS name, INDEX_TYPE AS type, IS_UNIQUE AS uniq, IS_NULL_FILTERED AS nf FROM INFORMATION_SCHEMA.INDEXES WHERE TABLE_SCHEMA = '' AND TABLE_NAME = @p1", [target.object]),
      this.exec(target.database, "SELECT INDEX_NAME AS name, COLUMN_NAME AS col, COLUMN_ORDERING AS dir FROM INFORMATION_SCHEMA.INDEX_COLUMNS WHERE TABLE_SCHEMA = '' AND TABLE_NAME = @p1 AND ORDINAL_POSITION IS NOT NULL ORDER BY INDEX_NAME, ORDINAL_POSITION", [target.object])
    ]);
    return indexes.rows.map(ix => ({
      name: String(ix.name),
      columns: columns.rows.filter(c => c.name === ix.name).map(c => `${c.col}${c.dir === "DESC" ? " DESC" : ""}`),
      unique: ix.uniq === true || ix.type === "PRIMARY_KEY",
      primary: ix.type === "PRIMARY_KEY",
      type: ix.type === "PRIMARY_KEY" ? "primary key" : "index",
      detail: ix.nf === true ? "NULL_FILTERED" : undefined
    })).sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  }

  override async drop(target: DbTarget): Promise<void> {
    const meta = await this.tableMeta(target);
    await this.ddl(target.database, [`DROP ${meta.dropKeyword} \`${target.object.replace(/[\\`]/g, m => "\\" + m)}\``]);
  }

  override async truncate(target: DbTarget): Promise<void> {
    const meta = await this.tableMeta(target);
    if (meta.isView) throw new DbError("A view cannot be emptied.");
    // Spanner DML needs a WHERE clause; there is no TRUNCATE.
    await this.exec(target.database, `DELETE FROM \`${target.object.replace(/[\\`]/g, m => "\\" + m)}\` WHERE true`, []);
  }

  async runQuery(text: string, context: { database?: string }): Promise<QueryResult> {
    const start = Date.now();
    const statements = this.classify(text);
    let last: { rows: Row[]; columns: string[] } | undefined;
    let affected = 0;
    const done: string[] = [];
    let pendingDdl: string[] = [];
    const flushDdl = async () => {
      if (!pendingDdl.length) return;
      await this.ddl(context.database, pendingDdl);
      done.push(`${pendingDdl.length} schema change${pendingDdl.length === 1 ? "" : "s"}`);
      pendingDdl = [];
    };
    try {
      for (const statement of statements) {
        try {
          if (DDL.has(statement.verb)) { pendingDdl.push(statement.text); continue; }
          await flushDdl();
          const result = await this.exec(context.database, statement.text, []);
          if (statement.write) {
            affected += result.affected ?? 0;
            done.push(statement.verb.toUpperCase());
          } else last = { rows: result.rows, columns: result.columns };
        } catch (error) {
          throw error instanceof DbError ? error.at(statement.offset) : error;
        }
      }
      await flushDdl();
    } finally {
      if (statements.some(s => s.write)) this.invalidate();
    }
    const message = last ? undefined : `${done.join(", ") || "Statement"} completed${affected ? `, ${affected} row${affected === 1 ? "" : "s"} affected` : ""}.`;
    return this.queryResult(start, last?.rows ?? [], last?.columns ?? [], affected || undefined, LIMITS.maxQueryRows, message);
  }
}
