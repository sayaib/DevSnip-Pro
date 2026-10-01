import * as fs from "fs";
import * as path from "path";
import { ConnectionSpec } from "../connection-string";
import { categorize, quoteIdent } from "../sql-builder";
import { DbError, DbTarget, LIMITS, ObjectInfo, QueryResult, Row, ServerInfo } from "../types";
import { ExecResult, SqlAdapter, TableMeta } from "./sql-base";

/** The few calls the adapter needs, implemented by node:sqlite or sql.js. */
interface SqliteBackend {
  readonly name: string;
  /** `write` marks a statement that changes data (INSERT ... RETURNING), so sql.js saves the file. */
  all(sql: string, params: unknown[], limit?: number, write?: boolean): { rows: Row[]; columns: string[] };
  run(sql: string, params: unknown[]): number;
  /** Runs a multi-statement script; returns the last result set, if any. */
  script(sql: string): { rows: Row[]; columns: string[]; changes: number };
  version(): string;
  close(): void;
}

const toParam = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);

/** Node's built-in SQLite (Node 22.5+): works on the file directly, with SQLite's own locking. */
function nodeSqliteBackend(file: string, readOnly: boolean): SqliteBackend | undefined {
  let mod: { DatabaseSync: new (file: string, options?: Record<string, unknown>) => any } | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("node:sqlite");
  } catch {
    return undefined;
  }
  if (!mod?.DatabaseSync) return undefined;
  const db = new mod.DatabaseSync(file, readOnly ? { readOnly: true } : {});
  db.exec("PRAGMA busy_timeout = 5000");
  const prepare = (sql: string) => {
    const stmt = db.prepare(sql);
    // Integers beyond 2^53 stay exact; encodeValue turns them back into numbers when safe.
    stmt.setReadBigInts?.(true);
    return stmt;
  };
  return {
    name: "node:sqlite",
    all(sql, params, limit, write) {
      const stmt = prepare(sql);
      const rows: Row[] = [];
      if (limit && !write && typeof stmt.iterate === "function") {
        for (const row of stmt.iterate(...params.map(toParam))) {
          rows.push(row);
          if (rows.length > limit) break;
        }
      } else {
        rows.push(...stmt.all(...params.map(toParam)));
      }
      const columns = typeof stmt.columns === "function" ? stmt.columns().map((c: { name: string }) => c.name) : rows[0] ? Object.keys(rows[0]) : [];
      return { rows, columns };
    },
    run(sql, params) {
      return Number(prepare(sql).run(...params.map(toParam)).changes ?? 0);
    },
    script(sql) {
      const before = Number(db.prepare("SELECT total_changes() AS n").get().n);
      db.exec(sql);
      const after = Number(db.prepare("SELECT total_changes() AS n").get().n);
      return { rows: [], columns: [], changes: after - before };
    },
    version() {
      return String(db.prepare("SELECT sqlite_version() AS v").get().v);
    },
    close() {
      db.close();
    }
  };
}

/**
 * sql.js (WebAssembly) for hosts without node:sqlite. It works on an in-memory
 * copy, so the file is re-read whenever it changes on disk and written back
 * atomically after every write.
 */
async function sqlJsBackend(file: string, readOnly: boolean): Promise<SqliteBackend> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require("sql.js") as typeof import("sql.js");
  const dist = path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
  const SQL = await initSqlJs({ locateFile: (name: string) => path.join(dist, name) });
  type Database = InstanceType<typeof SQL.Database>;
  let stamp = "";
  let db: Database | undefined;
  const statOf = () => { const s = fs.statSync(file); return `${s.mtimeMs}:${s.size}`; };
  const load = () => {
    const current = statOf();
    if (db && current === stamp) return db;
    db?.close();
    db = new SQL.Database(fs.readFileSync(file));
    stamp = current;
    return db;
  };
  const save = () => {
    if (readOnly || !db) return;
    if (statOf() !== stamp) throw new DbError("The database file changed on disk while this write was running. Refresh and try again.");
    const tmp = `${file}.devsnip-${process.pid}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(db.export()));
    fs.renameSync(tmp, file);
    stamp = statOf();
  };
  const bind = (params: unknown[]) => params.map(toParam) as Array<string | number | null | Uint8Array>;
  return {
    name: "sql.js",
    all(sql, params, limit, write) {
      const stmt = load().prepare(sql);
      const rows: Row[] = [];
      let columns: string[];
      try {
        stmt.bind(bind(params));
        // A write with RETURNING is stepped to the end so every row is changed.
        while (stmt.step()) {
          if (!limit || rows.length <= limit) rows.push(stmt.getAsObject() as Row);
          else if (!write) break;
        }
        columns = stmt.getColumnNames();
      } finally {
        stmt.free();
      }
      if (write) save();
      return { rows, columns };
    },
    run(sql, params) {
      const database = load();
      database.run(sql, bind(params));
      const changes = database.getRowsModified();
      save();
      return changes;
    },
    script(sql) {
      const database = load();
      const before = Number(database.exec("SELECT total_changes()")[0]?.values[0]?.[0] ?? 0);
      const results = database.exec(sql);
      const after = Number(database.exec("SELECT total_changes()")[0]?.values[0]?.[0] ?? 0);
      if (after !== before || /\b(create|drop|alter|insert|update|delete|replace|vacuum)\b/i.test(sql)) save();
      const last = results[results.length - 1];
      const rows = (last?.values ?? []).map(values => Object.fromEntries(last!.columns.map((c, i) => [c, values[i]])));
      return { rows, columns: last?.columns ?? [], changes: after - before };
    },
    version() {
      return String(load().exec("SELECT sqlite_version()")[0]?.values[0]?.[0] ?? "");
    },
    close() {
      db?.close();
      db = undefined;
    }
  };
}

export class SqliteAdapter extends SqlAdapter {
  readonly kind = "sqlite" as const;
  protected readonly dialect = "sqlite" as const;
  private backend?: SqliteBackend;

  constructor(private readonly spec: ConnectionSpec, private readonly readOnly: boolean, private readonly prefer: "auto" | "sql.js" = "auto") {
    super();
  }

  private get db(): SqliteBackend {
    if (!this.backend) throw new DbError("Not connected.");
    return this.backend;
  }

  async connect(): Promise<ServerInfo> {
    const file = this.spec.filePath!;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new DbError(`SQLite file not found: ${path.basename(file)}`, `Looked for ${file}`);
    }
    if (!stat.isFile()) throw new DbError(`${path.basename(file)} is not a file.`);
    const header = Buffer.alloc(16);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (stat.size > 0 && header.toString("latin1") !== "SQLite format 3\u0000") throw new DbError(`${path.basename(file)} is not a SQLite database.`);
    this.backend = (this.prefer === "auto" ? nodeSqliteBackend(file, this.readOnly) : undefined) ?? (await sqlJsBackend(file, this.readOnly));
    return { version: `SQLite ${this.backend.version()}`, defaultDatabase: "main" };
  }

  async close(): Promise<void> {
    this.backend?.close();
    this.backend = undefined;
  }

  async ping(): Promise<void> {
    this.db.all("SELECT 1", []);
  }

  protected async exec(_database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult> {
    if (/^\s*(select|pragma|with)\b/i.test(sql)) {
      const { rows, columns } = this.db.all(sql, params);
      return { rows, columns };
    }
    return { rows: [], columns: [], affected: this.db.run(sql, params) };
  }

  async listDatabases(): Promise<string[]> {
    return this.db.all("PRAGMA database_list", []).rows.map(r => String(r.name)).filter(n => n !== "temp");
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    const rows = this.db.all(`SELECT name, type FROM ${quoteIdent(database || "main", "sqlite")}.sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`, []).rows;
    return rows.map(r => ({ name: String(r.name), type: r.type === "view" ? "view" : "table" }));
  }

  protected async introspect(target: DbTarget): Promise<TableMeta> {
    const schema = target.database || "main";
    const master = this.db.all(`SELECT type, sql FROM ${quoteIdent(schema, "sqlite")}.sqlite_master WHERE name = ? AND type IN ('table', 'view')`, [target.object]).rows[0];
    if (!master) return { columns: [], isView: false, hasRowid: false, dropKeyword: "TABLE" };
    const isView = master.type === "view";
    const info = this.db.all("SELECT * FROM pragma_table_xinfo(?, ?)", [target.object, schema]).rows;
    const pkCount = info.filter(r => Number(r.pk) > 0).length;
    const columns = info.filter(r => Number(r.hidden ?? 0) !== 1).map(r => {
      const dataType = String(r.type || "ANY");
      const category = categorize(dataType);
      const pk = Number(r.pk) > 0;
      // hidden 2/3 = generated column.
      const generated = Number(r.hidden ?? 0) >= 2;
      return {
        name: String(r.name),
        dataType,
        category,
        nullable: Number(r.notnull) === 0 && !pk,
        primaryKey: pk,
        // A lone INTEGER PRIMARY KEY is the rowid, filled automatically.
        autoIncrement: pk && pkCount === 1 && /^integer$/i.test(dataType),
        defaultValue: r.dflt_value === null || r.dflt_value === undefined ? null : String(r.dflt_value),
        editable: category !== "binary" && !generated
      };
    });
    return {
      columns,
      isView,
      hasRowid: !isView && !/without\s+rowid/i.test(String(master.sql ?? "")),
      dropKeyword: isView ? "VIEW" : "TABLE"
    };
  }

  async runQuery(text: string): Promise<QueryResult> {
    const start = Date.now();
    const statements = this.classify(text);
    try {
      if (statements.length === 1) {
        const only = statements[0];
        const returning = only.write && /\breturning\b/i.test(only.text);
        if (!only.write || returning) {
          const { rows, columns } = this.db.all(only.text, [], LIMITS.maxQueryRows, returning);
          return this.queryResult(start, rows, columns, returning ? rows.length : undefined, LIMITS.maxQueryRows);
        }
        const changes = this.db.run(only.text, []);
        return this.queryResult(start, [], [], changes, LIMITS.maxQueryRows, `${only.verb.toUpperCase()} completed, ${changes} row${changes === 1 ? "" : "s"} affected.`);
      }
      const result = this.db.script(text);
      return this.queryResult(start, result.rows, result.columns, result.changes || undefined, LIMITS.maxQueryRows, result.rows.length ? undefined : `${statements.length} statements completed${result.changes ? `, ${result.changes} rows affected` : ""}.`);
    } finally {
      if (statements.some(s => s.write)) this.invalidate();
    }
  }

  /** Which engine opened the file (for diagnostics and tests). */
  get engine(): string | undefined {
    return this.backend?.name;
  }
}
