import type { Pool, PoolClient, PoolConfig, QueryResult as PgResult } from "pg";
import { ConnectionSpec } from "../connection-string";
import { categorize, quoteIdent } from "../sql-builder";
import { DbError, DbTarget, LIMITS, ObjectInfo, QueryResult, Row, ServerInfo } from "../types";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

/**
 * Type ids parsed into JS values. Everything else (dates, times, intervals,
 * arrays, numerics, uuids...) stays as the server's text, so an edited value
 * round-trips exactly, with no time-zone shifts or float rounding.
 */
const PARSED_OIDS = new Set([16, 17, 21, 23, 26, 114, 700, 701, 3802]);

export class PostgresAdapter extends SqlAdapter {
  readonly kind = "postgres" as const;
  protected readonly dialect = "postgres" as const;
  private readonly pools = new Map<string, Pool>();
  private defaultDb = "postgres";

  constructor(private readonly spec: ConnectionSpec, private readonly readOnly = false) {
    super();
    this.defaultDb = spec.database || spec.user || "postgres";
  }

  private ssl(): PoolConfig["ssl"] {
    const mode = (this.spec.options.sslmode ?? "").toLowerCase();
    if (mode === "disable" || (!this.spec.ssl && !mode)) return false;
    if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };
    // libpq "require"/"prefer" encrypt without verifying the certificate.
    return { rejectUnauthorized: false };
  }

  private pool(database?: string): Pool {
    const name = database || this.defaultDb;
    let pool = this.pools.get(name);
    if (pool) return pool;
    if (this.pools.size >= 8) throw new DbError("Too many databases open on this connection. Disconnect and reconnect to free them.");
    // Loaded on first use, so opening VS Code never pays for the driver.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require("pg") as typeof import("pg");
    pool = new pg.Pool({
      host: this.spec.host,
      port: this.spec.port,
      user: this.spec.user || undefined,
      password: this.spec.password || undefined,
      database: name,
      ssl: this.ssl(),
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: LIMITS.connectTimeoutMs,
      statement_timeout: LIMITS.queryTimeoutMs,
      query_timeout: LIMITS.queryTimeoutMs + 5_000,
      application_name: this.spec.options.application_name || "DevSnip Pro",
      // Read-only connections are read-only on the server too, so a write hidden in a function call still fails.
      options: [this.spec.options.options, this.readOnly ? "-c default_transaction_read_only=on" : ""].filter(Boolean).join(" ") || undefined,
      types: { getTypeParser: ((oid: number, format?: string) => PARSED_OIDS.has(oid) ? pg.types.getTypeParser(oid, format as "text") : (value: string) => value) as typeof pg.types.getTypeParser }
    });
    // An idle client dropped by the server must not crash the extension host.
    pool.on("error", () => undefined);
    this.pools.set(name, pool);
    return pool;
  }

  async connect(): Promise<ServerInfo> {
    const result = await this.pool().query("SELECT version() AS version, current_database() AS db");
    const row = result.rows[0] ?? {};
    this.defaultDb = String(row.db ?? this.defaultDb);
    const version = String(row.version ?? "").replace(/^PostgreSQL ([\d.]+).*$/s, "PostgreSQL $1");
    return { version, defaultDatabase: this.defaultDb };
  }

  async close(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(pools.map(pool => pool.end()));
  }

  async ping(): Promise<void> {
    await this.pool().query("SELECT 1");
  }

  protected async exec(database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult> {
    const result = await this.pool(database).query({ text: sql, values: params });
    return { rows: result.rows, columns: (result.fields ?? []).map(f => f.name), affected: result.rowCount ?? undefined };
  }

  async listDatabases(): Promise<string[]> {
    const result = await this.pool().query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname");
    return result.rows.map(r => String(r.datname));
  }

  async listSchemas(database: string): Promise<string[]> {
    const result = await this.pool(database).query(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' AND has_schema_privilege(oid, 'USAGE') ORDER BY nspname = 'public' DESC, nspname"
    );
    return result.rows.map(r => String(r.nspname));
  }

  async listObjects(database: string, schema?: string): Promise<ObjectInfo[]> {
    const result = await this.pool(database).query(
      `SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY c.relname`,
      [schema || "public"]
    );
    return result.rows.map(r => ({
      name: String(r.name),
      type: r.kind === "v" || r.kind === "m" ? "view" : "table",
      rows: Number(r.rows) >= 0 ? Number(r.rows) : undefined
    }));
  }

  protected async introspect(target: DbTarget): Promise<TableMeta> {
    // to_jsonb(a) reads attidentity/attgenerated without failing on servers that predate them.
    const result = await this.pool(target.database).query(
      `SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS def,
              to_jsonb(a) ->> 'attidentity' AS identity,
              to_jsonb(a) ->> 'attgenerated' AS generated,
              c.relkind AS relkind,
              EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [target.schema || "public", target.object]
    );
    const relkind = String(result.rows[0]?.relkind ?? "r");
    const columns = result.rows.map(r => {
      const dataType = String(r.type);
      const category = categorize(dataType);
      const def = r.def === null ? null : String(r.def);
      const identity = String(r.identity ?? "");
      const generated = String(r.generated ?? "");
      return {
        name: String(r.name),
        dataType,
        category,
        nullable: r.nullable === true,
        primaryKey: r.pk === true,
        autoIncrement: identity === "a" || identity === "d" || /^nextval\(/.test(def ?? ""),
        defaultValue: def,
        // GENERATED ALWAYS identities and generated columns reject explicit values.
        editable: category !== "binary" && generated !== "s" && identity !== "a"
      };
    });
    return {
      columns,
      isView: relkind === "v" || relkind === "m",
      hasRowid: false,
      dropKeyword: relkind === "v" ? "VIEW" : relkind === "m" ? "MATERIALIZED VIEW" : relkind === "f" ? "FOREIGN TABLE" : "TABLE"
    };
  }

  async runQuery(text: string, context: { database?: string; schema?: string }): Promise<QueryResult> {
    const start = Date.now();
    const statements = this.classify(text);
    const client: PoolClient = await this.pool(context.database).connect();
    // A client whose session state is unknown (an open BEGIN, a SET) is destroyed rather than reused.
    let destroy = false;
    try {
      if (context.schema) await client.query(`SET search_path TO ${quoteIdent(context.schema, "postgres")}, public`);
      const only = statements.length === 1 ? statements[0] : undefined;
      // A single SELECT runs through a cursor, so a huge result never reaches memory.
      if (only && !only.write && ["select", "with", "values", "table"].includes(only.verb)) {
        await client.query("BEGIN");
        try {
          await client.query(`DECLARE devsnip_console NO SCROLL CURSOR FOR ${only.text}`);
          const fetched = await client.query(`FETCH ${LIMITS.maxQueryRows + 1} FROM devsnip_console`);
          await client.query("COMMIT");
          return this.queryResult(start, fetched.rows, (fetched.fields ?? []).map(f => f.name), undefined, LIMITS.maxQueryRows);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => { destroy = true; });
          throw error;
        }
      }
      destroy = true;
      const raw = (await client.query(text)) as PgResult | PgResult[];
      const results = Array.isArray(raw) ? raw : [raw];
      const withRows = [...results].reverse().find(r => (r.fields ?? []).length > 0);
      const affected = results.reduce((sum, r) => sum + (r.command && r.command !== "SELECT" && typeof r.rowCount === "number" ? r.rowCount : 0), 0);
      const commands = results.map(r => r.command).filter(Boolean);
      const message = withRows ? undefined : `${commands.join(", ") || "Statement"} completed${affected ? `, ${affected} row${affected === 1 ? "" : "s"} affected` : ""}.`;
      return this.queryResult(start, (withRows?.rows ?? []) as Row[], (withRows?.fields ?? []).map(f => f.name), affected || undefined, LIMITS.maxQueryRows, message);
    } catch (error) {
      destroy = true;
      throw error;
    } finally {
      if (context.schema && !destroy) await client.query("RESET search_path").catch(() => { destroy = true; });
      client.release(destroy);
      if (statements.some(s => s.write)) this.invalidate();
    }
  }
}
