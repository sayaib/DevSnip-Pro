import type { ConnectionPool, IResult } from "mssql";
import { ConnectionSpec } from "../connection-string";
import { categorize } from "../sql-builder";
import { DbError, DbTarget, LIMITS, ObjectInfo, QueryResult, Row, ServerInfo } from "../types";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

const truthy = (v: string | undefined) => /^(true|yes|1)$/i.test(String(v ?? "").trim());

/** nvarchar(50), decimal(10,2), varchar(max): the declared type as SQL Server shows it. */
function sqlServerType(r: Row): string {
  const name = String(r.type);
  const max = Number(r.max_length);
  if (/^(n?var)?char$|^(var)?binary$/i.test(name)) {
    const size = max === -1 ? "max" : /^n/i.test(name) ? String(max / 2) : String(max);
    return `${name}(${size})`;
  }
  if (/^(decimal|numeric)$/i.test(name)) return `${name}(${r.precision},${r.scale})`;
  // "timestamp" in SQL Server is a binary row version, not a date.
  if (name === "timestamp") return "rowversion";
  return name;
}

export class SqlServerAdapter extends SqlAdapter {
  readonly kind = "sqlserver" as const;
  protected readonly dialect = "sqlserver" as const;
  private readonly pools = new Map<string, Promise<ConnectionPool>>();
  private defaultDb: string;

  constructor(private readonly spec: ConnectionSpec) {
    super();
    this.defaultDb = spec.database || "";
    const o = spec.options;
    if (truthy(o["integrated security"]) || truthy(o.trusted_connection) || /sspi/i.test(o["integrated security"] ?? "")) {
      throw new DbError("Windows authentication is not supported here.", "Use a SQL Server login: User Id=...;Password=...");
    }
  }

  private config(database: string, poolSize: number): import("mssql").config {
    const [server, instanceName] = String(this.spec.host ?? "localhost").split("\\");
    const o = this.spec.options;
    const local = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal)$/i.test(server);
    return {
      server,
      port: instanceName ? undefined : this.spec.port,
      user: this.spec.user || undefined,
      password: this.spec.password || undefined,
      database: database || undefined,
      connectionTimeout: LIMITS.connectTimeoutMs,
      requestTimeout: LIMITS.queryTimeoutMs,
      pool: { max: poolSize, min: 0, idleTimeoutMillis: 30_000 },
      options: {
        encrypt: this.spec.ssl,
        // Local Docker images ship a self-signed certificate.
        trustServerCertificate: o.trustservercertificate !== undefined ? truthy(o.trustservercertificate) : local || !this.spec.ssl,
        instanceName: instanceName || undefined,
        appName: o["application name"] || o.app || "DevSnip Pro",
        enableArithAbort: true
      }
    };
  }

  private pool(database?: string): Promise<ConnectionPool> {
    const name = database || this.defaultDb;
    const existing = this.pools.get(name);
    if (existing) return existing;
    if (this.pools.size >= 8) throw new DbError("Too many databases open on this connection. Disconnect and reconnect to free them.");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mssql = require("mssql") as typeof import("mssql");
    const pool = new mssql.ConnectionPool(this.config(name, 4));
    pool.on("error", () => undefined);
    const connecting = pool.connect().catch(error => {
      this.pools.delete(name);
      throw error;
    });
    this.pools.set(name, connecting);
    return connecting;
  }

  private async request(database: string | undefined, sql: string, params: unknown[] = []): Promise<IResult<Row>> {
    const request = (await this.pool(database)).request();
    params.forEach((value, i) => request.input(`p${i + 1}`, value));
    return request.query(sql);
  }

  async connect(): Promise<ServerInfo> {
    const result = await this.request(undefined, "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(64)) AS version, CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition, DB_NAME() AS db");
    const row = result.recordset[0] ?? {};
    if (!this.defaultDb) {
      // Remember the database the login landed in, so later pools share it.
      const pool = this.pools.get("");
      this.defaultDb = String(row.db ?? "master");
      if (pool) { this.pools.delete(""); this.pools.set(this.defaultDb, pool); }
    }
    return { version: `SQL Server ${row.version ?? ""}${row.edition ? ` (${String(row.edition).replace(/ \(64-bit\)/, "")})` : ""}`, defaultDatabase: this.defaultDb };
  }

  async close(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(pools.map(p => p.then(pool => pool.close())));
  }

  async ping(): Promise<void> {
    await this.request(undefined, "SELECT 1 AS ok");
  }

  protected async exec(database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult> {
    const result = await this.request(database, sql, params);
    const rows = result.recordset ?? [];
    return { rows, columns: rows.length ? Object.keys(rows[0]) : [], affected: (result.rowsAffected ?? []).reduce((a, b) => a + b, 0) };
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.request(undefined, "SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY CASE WHEN database_id <= 4 THEN 1 ELSE 0 END, name");
    return result.recordset.map(r => String(r.name));
  }

  async listSchemas(database: string): Promise<string[]> {
    const result = await this.request(database,
      `SELECT s.name FROM sys.schemas s
        WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') AND s.name NOT LIKE 'db[_]%'
          AND (s.name = 'dbo' OR EXISTS (SELECT 1 FROM sys.objects o WHERE o.schema_id = s.schema_id AND o.type IN ('U', 'V')))
        ORDER BY CASE WHEN s.name = 'dbo' THEN 0 ELSE 1 END, s.name`);
    return result.recordset.map(r => String(r.name));
  }

  async listObjects(database: string, schema?: string): Promise<ObjectInfo[]> {
    const result = await this.request(database,
      `SELECT o.name, o.type,
              (SELECT SUM(p.rows) FROM sys.partitions p WHERE p.object_id = o.object_id AND p.index_id IN (0, 1)) AS row_count
         FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @p1 AND o.type IN ('U', 'V') AND o.is_ms_shipped = 0
        ORDER BY o.name`, [schema || "dbo"]);
    return result.recordset.map(r => ({
      name: String(r.name),
      type: String(r.type).trim() === "V" ? "view" : "table",
      rows: r.row_count === null || r.row_count === undefined ? undefined : Number(r.row_count)
    }));
  }

  protected async introspect(target: DbTarget): Promise<TableMeta> {
    const result = await this.request(target.database,
      `SELECT c.name, TYPE_NAME(c.user_type_id) AS type, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
              OBJECT_DEFINITION(c.default_object_id) AS def, o.type AS otype,
              CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                                 WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id) THEN 1 ELSE 0 END AS pk
         FROM sys.columns c
         JOIN sys.objects o ON o.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @p1 AND o.name = @p2 AND o.type IN ('U', 'V')
        ORDER BY c.column_id`, [target.schema || "dbo", target.object]);
    const rows = result.recordset;
    const isView = String(rows[0]?.otype ?? "").trim() === "V";
    return {
      columns: rows.map(r => {
        const dataType = sqlServerType(r);
        const category = categorize(dataType);
        return {
          name: String(r.name),
          dataType,
          category,
          nullable: !!r.is_nullable,
          primaryKey: r.pk === 1,
          autoIncrement: !!r.is_identity,
          defaultValue: r.def === null || r.def === undefined ? null : String(r.def),
          // IDENTITY and computed columns reject explicit values.
          editable: category !== "binary" && !r.is_identity && !r.is_computed
        };
      }),
      isView,
      hasRowid: false,
      dropKeyword: isView ? "VIEW" : "TABLE"
    };
  }

  async runQuery(text: string, context: { database?: string }): Promise<QueryResult> {
    const start = Date.now();
    const statements = this.classify(text);
    if (statements.some(s => s.verb === "use")) throw new DbError("Pick the database from the selector instead of USE.");
    // A dedicated connection per run: an open BEGIN TRAN or a SET never leaks into the pooled sessions.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mssql = require("mssql") as typeof import("mssql");
    const pool = new mssql.ConnectionPool(this.config(context.database || this.defaultDb, 1));
    pool.on("error", () => undefined);
    try {
      await pool.connect();
      const result = await pool.request().query(text);
      const sets = ((result.recordsets ?? []) as unknown as Row[][]).filter(Array.isArray);
      const affected = (result.rowsAffected ?? []).reduce((a, b) => a + b, 0);
      const set = [...sets].reverse().find(s => s.length > 0) ?? sets[sets.length - 1];
      if (set) {
        const columns = Object.keys((set as unknown as { columns?: Record<string, unknown> }).columns ?? set[0] ?? {});
        return this.queryResult(start, set, columns, affected || undefined, LIMITS.maxQueryRows);
      }
      return this.queryResult(start, [], [], affected, LIMITS.maxQueryRows, `Completed, ${affected} row${affected === 1 ? "" : "s"} affected.`);
    } finally {
      await pool.close().catch(() => undefined);
      if (statements.some(s => s.write)) this.invalidate();
    }
  }
}
