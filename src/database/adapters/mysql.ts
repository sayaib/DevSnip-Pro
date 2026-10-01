import type { FieldPacket, Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { ConnectionSpec } from "../connection-string";
import { categorize, quoteIdent } from "../sql-builder";
import { DbError, DbTarget, LIMITS, ObjectInfo, QueryResult, Row, ServerInfo } from "../types";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

const SYSTEM_DATABASES = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

export class MysqlAdapter extends SqlAdapter {
  readonly kind = "mysql" as const;
  protected readonly dialect = "mysql" as const;
  private poolInstance?: Pool;
  private defaultDb?: string;

  constructor(private readonly spec: ConnectionSpec, private readonly readOnly = false) {
    super();
    this.defaultDb = spec.database || undefined;
  }

  private ssl(): object | undefined {
    const o = this.spec.options;
    if (o.ssl && o.ssl.trim().startsWith("{")) {
      try { return JSON.parse(o.ssl); } catch { throw new DbError("The ssl option is not valid JSON."); }
    }
    if (!this.spec.ssl) return undefined;
    const mode = (o["ssl-mode"] ?? o.sslmode ?? "").toUpperCase();
    // REQUIRED encrypts without verifying (as the mysql CLI does); VERIFY_* also checks the certificate.
    return { rejectUnauthorized: /^VERIFY/.test(mode) || (!mode && o.sslaccept !== "accept_invalid_certs") };
  }

  private pool(): Pool {
    if (this.poolInstance) return this.poolInstance;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mysql = require("mysql2/promise") as typeof import("mysql2/promise");
    this.poolInstance = mysql.createPool({
      host: this.spec.host,
      port: this.spec.port,
      user: this.spec.user || undefined,
      password: this.spec.password || undefined,
      database: this.defaultDb,
      ssl: this.ssl() as never,
      connectTimeout: LIMITS.connectTimeoutMs,
      connectionLimit: 4,
      // Dates and big numbers stay as the server's text, so edits round-trip exactly.
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
      charset: "utf8mb4"
    });
    if (this.readOnly) {
      // Read-only connections are read-only on the server too, so a write hidden in a procedure call still fails.
      this.poolInstance.on("connection", connection => { (connection as unknown as { query(sql: string): unknown }).query("SET SESSION TRANSACTION READ ONLY"); });
    }
    return this.poolInstance;
  }

  async connect(): Promise<ServerInfo> {
    const [rows] = await this.pool().query("SELECT VERSION() AS version, DATABASE() AS db");
    const row = (rows as Row[])[0] ?? {};
    const version = String(row.version ?? "");
    return { version: /mariadb/i.test(version) ? `MariaDB ${version.split("-")[0]}` : `MySQL ${version}`, defaultDatabase: row.db ? String(row.db) : undefined };
  }

  async close(): Promise<void> {
    const pool = this.poolInstance;
    this.poolInstance = undefined;
    await pool?.end().catch(() => undefined);
  }

  async ping(): Promise<void> {
    await this.pool().query("SELECT 1");
  }

  protected async exec(_database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult> {
    // Targets are always qualified with their database, so no USE is needed.
    const [result, fields] = await this.pool().query({ sql, values: params, timeout: LIMITS.queryTimeoutMs });
    if (Array.isArray(result)) return { rows: result as Row[], columns: (fields ?? []).map(f => f.name) };
    return { rows: [], columns: [], affected: (result as ResultSetHeader).affectedRows };
  }

  async listDatabases(): Promise<string[]> {
    const [rows] = await this.pool().query("SHOW DATABASES");
    const names = (rows as Row[]).map(r => String(Object.values(r)[0]));
    return [...names.filter(n => !SYSTEM_DATABASES.has(n.toLowerCase())).sort(), ...names.filter(n => SYSTEM_DATABASES.has(n.toLowerCase())).sort()];
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    const [rows] = await this.pool().query(
      "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS row_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
      [database]
    );
    return (rows as Row[]).map(r => ({
      name: String(r.name),
      type: /VIEW/i.test(String(r.type)) ? "view" : "table",
      rows: r.row_count === null || r.row_count === undefined ? undefined : Number(r.row_count)
    }));
  }

  protected async introspect(target: DbTarget): Promise<TableMeta> {
    if (!target.database) throw new DbError("Choose a database first.");
    const [columns] = await this.pool().query(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_KEY AS ckey, COLUMN_DEFAULT AS def, EXTRA AS extra
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [target.database, target.object]
    );
    const [tables] = await this.pool().query("SELECT TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [target.database, target.object]);
    const isView = /VIEW/i.test(String((tables as Row[])[0]?.type ?? ""));
    return {
      columns: (columns as Row[]).map(r => {
        const dataType = String(r.type);
        const extra = String(r.extra ?? "");
        const category = categorize(dataType);
        return {
          name: String(r.name),
          dataType,
          category,
          nullable: r.nullable === "YES",
          primaryKey: r.ckey === "PRI",
          autoIncrement: /auto_increment/i.test(extra),
          defaultValue: r.def === null || r.def === undefined ? null : String(r.def),
          // "DEFAULT_GENERATED" only marks a CURRENT_TIMESTAMP default; computed columns say VIRTUAL/STORED GENERATED.
          editable: category !== "binary" && !/\b(VIRTUAL|STORED) GENERATED\b/i.test(extra)
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
    if (statements.length > 1) throw new DbError("MySQL runs one statement at a time here.", "Run the statements one by one.");
    const connection: PoolConnection = await this.pool().getConnection();
    // The session may have changed (USE, SET, an open transaction): never hand it back to the pool.
    try {
      if (context.database) await connection.query(`USE ${quoteIdent(context.database, "mysql")}`);
      const [result, fields] = await connection.query({ sql: text, timeout: LIMITS.queryTimeoutMs });
      if (Array.isArray(result)) {
        // A CALL returns several result sets; show the first one that has rows.
        const sets = Array.isArray(result[0]) ? (result as unknown as Row[][]) : [result as Row[]];
        const fieldSets = Array.isArray((fields as unknown[])?.[0]) ? (fields as unknown as FieldPacket[][]) : [fields as FieldPacket[]];
        const index = Math.max(0, sets.findIndex(set => Array.isArray(set) && set.length > 0));
        return this.queryResult(start, sets[index] ?? [], (fieldSets[index] ?? []).map(f => f?.name).filter(Boolean), undefined, LIMITS.maxQueryRows);
      }
      const header = result as ResultSetHeader;
      return this.queryResult(start, [], [], header.affectedRows, LIMITS.maxQueryRows, `${statements[0].verb.toUpperCase()} completed, ${header.affectedRows} row${header.affectedRows === 1 ? "" : "s"} affected${header.insertId ? `, insert id ${header.insertId}` : ""}.`);
    } finally {
      connection.destroy();
      if (statements.some(s => s.write)) this.invalidate();
    }
  }
}
