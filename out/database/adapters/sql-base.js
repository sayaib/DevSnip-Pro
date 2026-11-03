"use strict";
/**
 * What every SQL adapter shares: table metadata caching, the data grid,
 * CRUD and DDL. Subclasses only run SQL and introspect tables.
 *
 * Row identity is always derived here from fresh metadata, never taken from
 * the webview, so a stale or tampered key strategy cannot widen a write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqlAdapter = void 0;
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const values_1 = require("../values");
const count_cache_1 = require("../count-cache");
const META_TTL_MS = 60000;
class SqlAdapter {
    constructor() {
        this.meta = new Map();
        this.counts = new count_cache_1.CountCache();
        /** The last unfiltered total seen per table, which decides whether a search is counted. */
        this.sizes = new Map();
    }
    invalidate() {
        this.meta.clear();
        this.counts.clear();
        this.sizes.clear();
    }
    classify(text) {
        const statements = (0, sql_builder_1.classifyStatements)(text);
        if (!statements.length)
            throw new types_1.DbError("Enter a query to run.");
        return statements;
    }
    async tableMeta(target) {
        if (!target || typeof target.object !== "string" || !target.object)
            throw new types_1.DbError("No table selected.");
        const key = JSON.stringify([target.database ?? "", target.schema ?? "", target.object]);
        const cached = this.meta.get(key);
        if (cached && Date.now() - cached.at < META_TTL_MS)
            return cached.meta;
        const meta = await this.introspect(target);
        if (!meta.columns.length)
            throw new types_1.DbError(`"${target.object}" was not found. It may have been renamed or dropped.`, "Refresh the explorer.");
        this.meta.set(key, { at: Date.now(), meta });
        return meta;
    }
    keys(meta) {
        const keys = (0, sql_builder_1.keyStrategyFor)(meta.columns, this.dialect, meta.isView, meta.hasRowid, !meta.noCtid);
        return keys.strategy === "none" && meta.readOnly ? { ...keys, readOnly: meta.readOnly } : keys;
    }
    async describe(target) {
        return (await this.tableMeta(target)).columns;
    }
    run(database, built) {
        return this.exec(database, built.sql, built.params);
    }
    /** Runs a COUNT(*) and remembers it for the next pages of the same query. */
    async exactCount(request, sql, key) {
        const result = await this.run(request.target.database, sql);
        const first = result.rows[0];
        const total = first ? Number(first.n ?? Object.values(first)[0]) : NaN;
        if (!Number.isFinite(total))
            return undefined;
        const value = { total };
        this.counts.set(key, value);
        return value;
    }
    /**
     * The page's total: remembered from an earlier page of the same query, the
     * statistics estimate for a large unfiltered table, or a COUNT(*). Null
     * when a search of a large table is deliberately not counted.
     */
    async total(request, meta, count) {
        const key = JSON.stringify([request.target.database ?? "", count.sql, count.params]);
        const table = JSON.stringify([request.target.database ?? "", request.target.schema ?? "", request.target.object]);
        const cached = this.counts.get(key);
        const unfiltered = !(request.filters ?? []).length && !(request.search ?? "").trim();
        const remember = (value) => { if (value && unfiltered)
            this.sizes.set(table, value.total); return value; };
        if (cached)
            return remember(cached);
        if ((request.search ?? "").trim() && (this.sizes.get(table) ?? 0) >= count_cache_1.SEARCH_COUNT_ROWS)
            return null;
        if (unfiltered && !meta.isView && this.estimateRows) {
            const estimate = await this.estimateRows(request.target).catch(() => undefined);
            if (estimate !== undefined && Number.isFinite(estimate) && estimate >= count_cache_1.LARGE_TABLE_ROWS) {
                const value = { total: Math.round(estimate), estimated: true };
                this.counts.set(key, value);
                return remember(value);
            }
        }
        return remember(await this.exactCount(request, count, key));
    }
    /** An exact COUNT(*) for the page's filters, for when the shown total is an estimate. */
    async countRows(request) {
        const meta = await this.tableMeta(request.target);
        const plan = (0, sql_builder_1.buildSelect)(request, meta.columns, this.keys(meta).strategy, this.dialect);
        const value = await this.exactCount(request, plan.count, JSON.stringify([request.target.database ?? "", plan.count.sql, plan.count.params]));
        if (!value)
            throw new types_1.DbError("The rows could not be counted.");
        return value.total;
    }
    async fetchPage(request) {
        const start = Date.now();
        const meta = await this.tableMeta(request.target);
        const { strategy, keyColumns, readOnly } = this.keys(meta);
        const plan = (0, sql_builder_1.buildSelect)(request, meta.columns, strategy, this.dialect);
        const [rows, count] = await Promise.all([
            this.run(request.target.database, plan.select),
            // A failed or slow count must not hide the rows.
            this.total(request, meta, plan.count).catch(() => undefined)
        ]);
        return {
            columns: meta.columns,
            rows: rows.rows.map(values_1.encodeRow),
            total: count ? count.total : null,
            totalEstimated: count?.estimated || undefined,
            countable: count === null || count?.estimated ? true : undefined,
            hasMore: count === null ? rows.rows.length >= Math.min(types_1.LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)) : undefined,
            keyColumns,
            keyStrategy: strategy,
            readOnly,
            canInsert: !meta.isView,
            elapsedMs: (0, values_1.since)(start)
        };
    }
    async writable(target) {
        const meta = await this.tableMeta(target);
        const { strategy, readOnly } = this.keys(meta);
        if (meta.isView)
            throw new types_1.DbError(readOnly ?? "Views are read-only here.");
        return { meta, strategy };
    }
    async insert(target, values) {
        const { meta } = await this.writable(target);
        const result = await this.run(target.database, (0, sql_builder_1.buildInsert)(target, meta.columns, values, this.dialect));
        this.counts.clear();
        return result.affected ?? 1;
    }
    async update(target, key, _strategy, values) {
        const { meta, strategy } = await this.writable(target);
        if (strategy === "none")
            throw new types_1.DbError(this.keys({ ...meta, isView: false }).readOnly ?? "Rows of this table cannot be identified.");
        const result = await this.run(target.database, (0, sql_builder_1.buildUpdate)(target, meta.columns, key, strategy, values, this.dialect));
        return result.affected ?? 0;
    }
    async remove(target, keys, _strategy) {
        const { meta, strategy } = await this.writable(target);
        if (strategy === "none")
            throw new types_1.DbError(this.keys({ ...meta, isView: false }).readOnly ?? "Rows of this table cannot be identified.");
        let affected = 0;
        // Batches keep the statement and its parameter count within every driver's limits.
        for (let i = 0; i < keys.length; i += 200) {
            const result = await this.run(target.database, (0, sql_builder_1.buildDelete)(target, meta.columns, keys.slice(i, i + 200), strategy, this.dialect));
            affected += result.affected ?? 0;
        }
        this.counts.clear();
        return affected;
    }
    async drop(target) {
        const meta = await this.tableMeta(target);
        await this.exec(target.database, `DROP ${meta.dropKeyword} ${(0, sql_builder_1.qualifiedName)(target, this.dialect)}`, []);
        this.invalidate();
    }
    async truncate(target) {
        const meta = await this.tableMeta(target);
        if (meta.isView)
            throw new types_1.DbError("A view cannot be emptied.");
        const table = (0, sql_builder_1.qualifiedName)(target, this.dialect);
        await this.exec(target.database, this.dialect === "sqlite" ? `DELETE FROM ${table}` : `TRUNCATE TABLE ${table}`, []);
        this.counts.clear();
    }
    /** Shapes a driver result for the console, capping the rows sent to the webview. */
    queryResult(start, rows, columns, affected, limit, message) {
        const cols = columns.length ? columns : rows.length ? Object.keys(rows[0]) : [];
        return {
            columns: cols,
            rows: rows.slice(0, limit).map(values_1.encodeRow),
            truncated: rows.length > limit,
            affected,
            message,
            elapsedMs: (0, values_1.since)(start)
        };
    }
}
exports.SqlAdapter = SqlAdapter;
//# sourceMappingURL=sql-base.js.map