import type { FieldPacket, Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { ConnectionSpec } from "../connection-string";
import { categorize, quoteIdent } from "../sql-builder";
import { DbError, DbTarget, IndexInfo, LIMITS, ObjectInfo, QueryResult, Row, RunControl, ServerInfo } from "../types";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

const SYSTEM_DATABASES = new Set(["information_schema", "performance_schema", "mysql", "sys"]);

/**
 * MySQL reports syntax errors as "... near 'rest of the text' at line N";
 * finding that text in the statement gives the exact position.
 */
export function mysqlErrorPosition(message: string, statement: string): number | undefined {
  const m = /near '([\s\S]*)' at line (\d+)/.exec(message);
  if (!m) return undefined;
  const lines = statement.split("\n");
  const line = Math.min(Math.max(1, Number(m[2])), lines.length);
  const lineStart = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  if (!m[1]) return statement.trimEnd().length;
  const at = statement.indexOf(m[1].slice(0, 60), lineStart);
  return at >= 0 ? at : lineStart;
}

/**
 * Streams one SELECT and stops after `limit` rows, so a huge result never
 * reaches memory. The caller destroys the connection afterwards, which ends
 * the rest of the query on the server.
 */
function streamRows(connection: PoolConnection, sql: string, limit: number): Promise<{ rows: Row[]; columns: string[]; truncated: boolean }> {
  const core = (connection as unknown as { connection: { query(o: object): NodeJS.EventEmitter; pause(): void } }).connection;
  return new Promise((resolve, reject) => {
    const rows: Row[] = [];
    let columns: string[] = [];
    let settled = false;
    const finish = (truncated: boolean) => { if (!settled) { settled = true; resolve({ rows, columns, truncated }); } };
    const query = core.query({ sql, timeout: LIMITS.queryTimeoutMs });
    query.on("fields", (fields: FieldPacket[]) => { if (!columns.length) columns = (fields ?? []).map(f => f.name); });
    query.on("result", (row: Row) => {
      if (settled) return;
      if (rows.length >= limit) { core.pause(); finish(true); return; }
      rows.push(row);
    });
    query.on("error", (error: Error) => { if (!settled) { settled = true; reject(error); } });
    query.on("end", () => finish(false));
  });
}

export class MysqlAdapter extends SqlAdapter {
  readonly kind: "mysql" | "mariadb";
  protected readonly dialect = "mysql" as const;
  private poolInstance?: Pool;
  private defaultDb?: string;

  constructor(private readonly spec: ConnectionSpec, private readonly readOnly = false) {
    super();
    this.kind = spec.kind === "mariadb" ? "mariadb" : "mysql";
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
    return { version: /mariadb/i.test(version) ? `MariaDB ${version.replace(/^5\.5\.5-/, "").split("-")[0]}` : `MySQL ${version}`, defaultDatabase: row.db ? String(row.db) : undefined };
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
          // MariaDB writes a missing default as the text NULL (and quotes string defaults).
          defaultValue: r.def === null || r.def === undefined || (r.def === "NULL" && r.nullable === "YES") ? null : String(r.def),
          // "DEFAULT_GENERATED" only marks a CURRENT_TIMESTAMP default; computed columns say VIRTUAL/STORED GENERATED.
          editable: category !== "binary" && !/\b(VIRTUAL|STORED) GENERATED\b/i.test(extra)
        };
      }),
      isView,
      hasRowid: false,
      dropKeyword: isView ? "VIEW" : "TABLE"
    };
  }

  override async indexes(target: DbTarget): Promise<IndexInfo[]> {
    const [rows] = await this.pool().query(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, INDEX_TYPE AS type, COLUMN_NAME AS col, EXPRESSION AS expr, SUB_PART AS sub
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`,
      [target.database ?? this.defaultDb, target.object]
    ).catch(async error => {
      // MariaDB and MySQL 5.7 have no EXPRESSION column.
      if (!/EXPRESSION/i.test(String((error as Error).message))) throw error;
      return this.pool().query(
        `SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique, INDEX_TYPE AS type, COLUMN_NAME AS col, SUB_PART AS sub
           FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME = 'PRIMARY' DESC, INDEX_NAME, SEQ_IN_INDEX`,
        [target.database ?? this.defaultDb, target.object]
      );
    });
    const byName = new Map<string, IndexInfo>();
    for (const r of rows as Row[]) {
      const name = String(r.name);
      const entry = byName.get(name) ?? { name, columns: [], unique: Number(r.non_unique) === 0, primary: name === "PRIMARY", type: String(r.type ?? "").toLowerCase() || undefined };
      entry.columns.push(r.col ? `${r.col}${r.sub ? `(${r.sub})` : ""}` : `(${r.expr ?? "expression"})`);
      byName.set(name, entry);
    }
    return [...byName.values()];
  }

  async runQuery(text: string, context: { database?: string }, control?: RunControl): Promise<QueryResult> {
    const start = Date.now();
    const statements = this.classify(text);
    const connection: PoolConnection = await this.pool().getConnection();
    const threadId = (connection as unknown as { threadId?: number }).threadId;
    // KILL QUERY runs on another connection; the console's own session then reports "interrupted".
    if (threadId) control?.onCancel(() => this.pool().query(`KILL QUERY ${Number(threadId)}`).catch(() => undefined));
    // The session may have changed (USE, SET, an open transaction): never hand it back to the pool.
    let shown: { rows: Row[]; columns: string[] } | undefined;
    let affected = 0;
    let anyAffected = false;
    let insertId: number | undefined;
    try {
      if (context.database) await connection.query(`USE ${quoteIdent(context.database, "mysql")}`);
      // Statements run one by one on the same session, so SET and temporary tables carry over.
      for (const statement of statements) {
        let result: unknown;
        let fields: unknown;
        const plainSelect = statements.length === 1 && !statement.write && ["select", "with", "table", "values"].includes(statement.verb);
        try {
          if (plainSelect) {
            const streamed = await streamRows(connection, statement.text, LIMITS.maxQueryRows);
            return { ...this.queryResult(start, streamed.rows, streamed.columns, undefined, LIMITS.maxQueryRows), truncated: streamed.truncated };
          }
          [result, fields] = await connection.query({ sql: statement.text, timeout: LIMITS.queryTimeoutMs });
        } catch (error) {
          const e = error as { message?: string; sqlMessage?: string; devsnipPosition?: number };
          const at = mysqlErrorPosition(String(e.sqlMessage ?? e.message ?? ""), statement.text);
          if (at !== undefined) e.devsnipPosition = statement.offset + at;
          throw error;
        }
        if (Array.isArray(result)) {
          // A CALL returns several result sets; show the first one that has rows.
          const sets = Array.isArray(result[0]) ? (result as unknown as Row[][]) : [result as Row[]];
          const fieldSets = Array.isArray((fields as unknown[])?.[0]) ? (fields as unknown as FieldPacket[][]) : [fields as FieldPacket[]];
          const index = Math.max(0, sets.findIndex(set => Array.isArray(set) && set.length > 0));
          shown = { rows: sets[index] ?? [], columns: (fieldSets[index] ?? []).map(f => f?.name).filter(Boolean) };
        } else {
          const header = result as ResultSetHeader;
          affected += header.affectedRows ?? 0;
          anyAffected = true;
          if (header.insertId) insertId = header.insertId;
        }
      }
    } finally {
      connection.destroy();
      if (statements.some(s => s.write)) this.invalidate();
    }
    if (shown) return this.queryResult(start, shown.rows, shown.columns, anyAffected ? affected : undefined, LIMITS.maxQueryRows);
    const verbs = [...new Set(statements.map(s => s.verb.toUpperCase()))].join(", ");
    return this.queryResult(start, [], [], affected, LIMITS.maxQueryRows, `${verbs} completed, ${affected} row${affected === 1 ? "" : "s"} affected${insertId ? `, insert id ${insertId}` : ""}.`);
  }
}
