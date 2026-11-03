/**
 * What every SQL adapter shares: table metadata caching, the data grid,
 * CRUD and DDL. Subclasses only run SQL and introspect tables.
 *
 * Row identity is always derived here from fresh metadata, never taken from
 * the webview, so a stale or tampered key strategy cannot widen a write.
 */

import { BuiltSql, buildDelete, buildInsert, buildSelect, buildUpdate, classifyStatements, keyStrategyFor, qualifiedName, SqlDialect, StatementInfo } from "../sql-builder";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbKind, DbTarget, IndexInfo, KeyStrategy, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, RunControl, ServerInfo } from "../types";
import { encodeRow, since } from "../values";
import { CachedCount, CountCache, LARGE_TABLE_ROWS, SEARCH_COUNT_ROWS } from "../count-cache";

export interface ExecResult {
  rows: Row[];
  columns: string[];
  affected?: number;
}

export interface TableMeta {
  columns: ColumnInfo[];
  isView: boolean;
  /** A stable hidden row id identifies rows without a key: SQLite rowid, Oracle ROWID, CockroachDB rowid. */
  hasRowid: boolean;
  /** Keyword for DROP: TABLE, VIEW, MATERIALIZED VIEW or FOREIGN TABLE. */
  dropKeyword: string;
  /** Rows have no ctid to fall back on (Redshift). */
  noCtid?: boolean;
  /** Why rows of this table cannot be changed here, overriding the generic reason. */
  readOnly?: string;
}

const META_TTL_MS = 60_000;

export abstract class SqlAdapter implements DbAdapter {
  abstract readonly kind: DbKind;
  protected abstract readonly dialect: SqlDialect;
  private readonly meta = new Map<string, { at: number; meta: TableMeta }>();
  private readonly counts = new CountCache();
  /** The last unfiltered total seen per table, which decides whether a search is counted. */
  private readonly sizes = new Map<string, number>();

  abstract connect(): Promise<ServerInfo>;
  abstract close(): Promise<void>;
  abstract ping(): Promise<void>;
  abstract listDatabases(): Promise<string[]>;
  abstract listSchemas(database: string): Promise<string[]>;
  abstract listObjects(database: string, schema?: string): Promise<ObjectInfo[]>;
  abstract runQuery(text: string, context: { database?: string; schema?: string }, control?: RunControl): Promise<QueryResult>;
  indexes?(target: DbTarget): Promise<IndexInfo[]>;
  protected abstract exec(database: string | undefined, sql: string, params: unknown[]): Promise<ExecResult>;
  /** Returns no columns when the object does not exist. */
  protected abstract introspect(target: DbTarget): Promise<TableMeta>;
  /** The table's row count from statistics (a catalog read, no scan); undefined when unknown. */
  protected estimateRows?(target: DbTarget): Promise<number | undefined>;

  invalidate(): void {
    this.meta.clear();
    this.counts.clear();
    this.sizes.clear();
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

  protected keys(meta: TableMeta): ReturnType<typeof keyStrategyFor> {
    const keys = keyStrategyFor(meta.columns, this.dialect, meta.isView, meta.hasRowid, !meta.noCtid);
    return keys.strategy === "none" && meta.readOnly ? { ...keys, readOnly: meta.readOnly } : keys;
  }

  async describe(target: DbTarget): Promise<ColumnInfo[]> {
    return (await this.tableMeta(target)).columns;
  }

  protected run(database: string | undefined, built: BuiltSql): Promise<ExecResult> {
    return this.exec(database, built.sql, built.params);
  }

  /** Runs a COUNT(*) and remembers it for the next pages of the same query. */
  private async exactCount(request: PageRequest, sql: BuiltSql, key: string): Promise<CachedCount | undefined> {
    const result = await this.run(request.target.database, sql);
    const first = result.rows[0];
    const total = first ? Number(first.n ?? Object.values(first)[0]) : NaN;
    if (!Number.isFinite(total)) return undefined;
    const value = { total };
    this.counts.set(key, value);
    return value;
  }

  /**
   * The page's total: remembered from an earlier page of the same query, the
   * statistics estimate for a large unfiltered table, or a COUNT(*). Null
   * when a search of a large table is deliberately not counted.
   */
  private async total(request: PageRequest, meta: TableMeta, count: BuiltSql): Promise<CachedCount | null | undefined> {
    const key = JSON.stringify([request.target.database ?? "", count.sql, count.params]);
    const table = JSON.stringify([request.target.database ?? "", request.target.schema ?? "", request.target.object]);
    const cached = this.counts.get(key);
    const unfiltered = !(request.filters ?? []).length && !(request.search ?? "").trim();
    const remember = (value: CachedCount | undefined) => { if (value && unfiltered) this.sizes.set(table, value.total); return value; };
    if (cached) return remember(cached);
    if ((request.search ?? "").trim() && (this.sizes.get(table) ?? 0) >= SEARCH_COUNT_ROWS) return null;
    if (unfiltered && !meta.isView && this.estimateRows) {
      const estimate = await this.estimateRows(request.target).catch(() => undefined);
      if (estimate !== undefined && Number.isFinite(estimate) && estimate >= LARGE_TABLE_ROWS) {
        const value = { total: Math.round(estimate), estimated: true };
        this.counts.set(key, value);
        return remember(value);
      }
    }
    return remember(await this.exactCount(request, count, key));
  }

  /** An exact COUNT(*) for the page's filters, for when the shown total is an estimate. */
  async countRows(request: PageRequest): Promise<number> {
    const meta = await this.tableMeta(request.target);
    const plan = buildSelect(request, meta.columns, this.keys(meta).strategy, this.dialect);
    const value = await this.exactCount(request, plan.count, JSON.stringify([request.target.database ?? "", plan.count.sql, plan.count.params]));
    if (!value) throw new DbError("The rows could not be counted.");
    return value.total;
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const meta = await this.tableMeta(request.target);
    const { strategy, keyColumns, readOnly } = this.keys(meta);
    const plan = buildSelect(request, meta.columns, strategy, this.dialect);
    const [rows, count] = await Promise.all([
      this.run(request.target.database, plan.select),
      // A failed or slow count must not hide the rows.
      this.total(request, meta, plan.count).catch(() => undefined)
    ]);
    return {
      columns: meta.columns,
      rows: rows.rows.map(encodeRow),
      total: count ? count.total : null,
      totalEstimated: count?.estimated || undefined,
      countable: count === null || count?.estimated ? true : undefined,
      hasMore: count === null ? rows.rows.length >= Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)) : undefined,
      keyColumns,
      keyStrategy: strategy,
      readOnly,
      canInsert: !meta.isView,
      elapsedMs: since(start)
    };
  }

  private async writable(target: DbTarget): Promise<{ meta: TableMeta; strategy: KeyStrategy }> {
    const meta = await this.tableMeta(target);
    const { strategy, readOnly } = this.keys(meta);
    if (meta.isView) throw new DbError(readOnly ?? "Views are read-only here.");
    return { meta, strategy };
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const { meta } = await this.writable(target);
    const result = await this.run(target.database, buildInsert(target, meta.columns, values, this.dialect));
    this.counts.clear();
    return result.affected ?? 1;
  }

  async update(target: DbTarget, key: Row, _strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number> {
    const { meta, strategy } = await this.writable(target);
    if (strategy === "none") throw new DbError(this.keys({ ...meta, isView: false }).readOnly ?? "Rows of this table cannot be identified.");
    const result = await this.run(target.database, buildUpdate(target, meta.columns, key, strategy, values, this.dialect));
    return result.affected ?? 0;
  }

  async remove(target: DbTarget, keys: Row[], _strategy: KeyStrategy): Promise<number> {
    const { meta, strategy } = await this.writable(target);
    if (strategy === "none") throw new DbError(this.keys({ ...meta, isView: false }).readOnly ?? "Rows of this table cannot be identified.");
    let affected = 0;
    // Batches keep the statement and its parameter count within every driver's limits.
    for (let i = 0; i < keys.length; i += 200) {
      const result = await this.run(target.database, buildDelete(target, meta.columns, keys.slice(i, i + 200), strategy, this.dialect));
      affected += result.affected ?? 0;
    }
    this.counts.clear();
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
    this.counts.clear();
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
