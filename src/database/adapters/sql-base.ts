/**
 * What every SQL adapter shares: table metadata caching, the data grid,
 * CRUD and DDL. Subclasses only run SQL and introspect tables.
 *
 * Row identity is always derived here from fresh metadata, never taken from
 * the webview, so a stale or tampered key strategy cannot widen a write.
 */

import { BuiltSql, buildDelete, buildInsert, buildSelect, buildUpdate, classifyStatements, keyStrategyFor, qualifiedName, SqlDialect, StatementInfo } from "../sql-builder";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbKind, DbTarget, KeyStrategy, ObjectInfo, PageRequest, PageResult, QueryResult, Row, ServerInfo } from "../types";
import { encodeRow, since } from "../values";

export interface ExecResult {
  rows: Row[];
  columns: string[];
  affected?: number;
}

export interface TableMeta {
  columns: ColumnInfo[];
  isView: boolean;
  /** SQLite: false for WITHOUT ROWID tables. */
  hasRowid: boolean;
  /** Keyword for DROP: TABLE, VIEW, MATERIALIZED VIEW or FOREIGN TABLE. */
  dropKeyword: string;
}

const META_TTL_MS = 60_000;

export abstract class SqlAdapter implements DbAdapter {
  abstract readonly kind: DbKind;
  protected abstract readonly dialect: SqlDialect;
  private readonly meta = new Map<string, { at: number; meta: TableMeta }>();

  abstract connect(): Promise<ServerInfo>;
  abstract close(): Promise<void>;
  abstract ping(): Promise<void>;
  abstract listDatabases(): Promise<string[]>;
  abstract listSchemas(database: string): Promise<string[]>;
  abstract listObjects(database: string, schema?: string): Promise<ObjectInfo[]>;
  abstract runQuery(text: string, context: { database?: string; schema?: string }): Promise<QueryResult>;
  protected abstract exec(database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult>;
  /** Returns no columns when the object does not exist. */
  protected abstract introspect(target: DbTarget): Promise<TableMeta>;

  invalidate(): void {
    this.meta.clear();
  }

  classify(text: string): StatementInfo[] {
    const statements = classifyStatements(text);
    if (!statements.length) throw new DbError("Enter a query to run.");
    return statements;
  }

  protected async tableMeta(target: DbTarget): Promise<TableMeta> {
    if (!target || typeof target.object !== "string" || !target.object) throw new DbError("No table selected.");
    const key = JSON.stringify([target.database ?? "", target.schema ?? "", target.object]);
    const cached = this.meta.get(key);
    if (cached && Date.now() - cached.at < META_TTL_MS) return cached.meta;
    const meta = await this.introspect(target);
    if (!meta.columns.length) throw new DbError(`"${target.object}" was not found. It may have been renamed or dropped.`, "Refresh the explorer.");
    this.meta.set(key, { at: Date.now(), meta });
    return meta;
  }

  async describe(target: DbTarget): Promise<ColumnInfo[]> {
    return (await this.tableMeta(target)).columns;
  }

  protected run(database: string | undefined, built: BuiltSql): Promise<ExecResult> {
    return this.exec(database, built.sql, built.params);
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const meta = await this.tableMeta(request.target);
    const { strategy, keyColumns, readOnly } = keyStrategyFor(meta.columns, this.dialect, meta.isView, meta.hasRowid);
    const plan = buildSelect(request, meta.columns, strategy, this.dialect);
    const [rows, count] = await Promise.all([
      this.run(request.target.database, plan.select),
      // A failed or slow count must not hide the rows.
      this.run(request.target.database, plan.count).catch(() => undefined)
    ]);
    const first = count?.rows[0];
    const total = first ? Number(first.n ?? Object.values(first)[0]) : null;
    return {
      columns: meta.columns,
      rows: rows.rows.map(encodeRow),
      total: total === null || Number.isNaN(total) ? null : total,
      keyColumns,
      keyStrategy: strategy,
      readOnly,
      elapsedMs: since(start)
    };
  }

  private async writable(target: DbTarget): Promise<{ meta: TableMeta; strategy: KeyStrategy }> {
    const meta = await this.tableMeta(target);
    const { strategy, readOnly } = keyStrategyFor(meta.columns, this.dialect, meta.isView, meta.hasRowid);
    if (meta.isView) throw new DbError(readOnly ?? "Views are read-only here.");
    return { meta, strategy };
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const { meta } = await this.writable(target);
    const result = await this.run(target.database, buildInsert(target, meta.columns, values, this.dialect));
    return result.affected ?? 1;
  }

  async update(target: DbTarget, key: Row, _strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number> {
    const { meta, strategy } = await this.writable(target);
    if (strategy === "none") throw new DbError(keyStrategyFor(meta.columns, this.dialect, false, meta.hasRowid).readOnly ?? "Rows of this table cannot be identified.");
    const result = await this.run(target.database, buildUpdate(target, meta.columns, key, strategy, values, this.dialect));
    return result.affected ?? 0;
  }

  async remove(target: DbTarget, keys: Row[], _strategy: KeyStrategy): Promise<number> {
    const { meta, strategy } = await this.writable(target);
    if (strategy === "none") throw new DbError(keyStrategyFor(meta.columns, this.dialect, false, meta.hasRowid).readOnly ?? "Rows of this table cannot be identified.");
    let affected = 0;
    // Batches keep the statement and its parameter count within every driver's limits.
    for (let i = 0; i < keys.length; i += 200) {
      const result = await this.run(target.database, buildDelete(target, meta.columns, keys.slice(i, i + 200), strategy, this.dialect));
      affected += result.affected ?? 0;
    }
    return affected;
  }

  async drop(target: DbTarget): Promise<void> {
    const meta = await this.tableMeta(target);
    await this.exec(target.database, `DROP ${meta.dropKeyword} ${qualifiedName(target, this.dialect)}`, []);
    this.invalidate();
  }

  async truncate(target: DbTarget): Promise<void> {
    const meta = await this.tableMeta(target);
    if (meta.isView) throw new DbError("A view cannot be emptied.");
    const table = qualifiedName(target, this.dialect);
    await this.exec(target.database, this.dialect === "sqlite" ? `DELETE FROM ${table}` : `TRUNCATE TABLE ${table}`, []);
  }

  /** Shapes a driver result for the console, capping the rows sent to the webview. */
  protected queryResult(start: number, rows: Row[], columns: string[], affected: number | undefined, limit: number, message?: string): QueryResult {
    const cols = columns.length ? columns : rows.length ? Object.keys(rows[0]) : [];
    return {
      columns: cols,
      rows: rows.slice(0, limit).map(encodeRow),
      truncated: rows.length > limit,
      affected,
      message,
      elapsedMs: since(start)
    };
  }
}
