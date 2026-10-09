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
const META_TTL_MS = 60000;
class SqlAdapter {
    constructor() {
        this.meta = new Map();
    }
    invalidate() {
        this.meta.clear();
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
    async describe(target) {
        return (await this.tableMeta(target)).columns;
    }
    run(database, built) {
        return this.exec(database, built.sql, built.params);
    }
    async fetchPage(request) {
        const start = Date.now();
        const meta = await this.tableMeta(request.target);
        const { strategy, keyColumns, readOnly } = (0, sql_builder_1.keyStrategyFor)(meta.columns, this.dialect, meta.isView, meta.hasRowid);
        const plan = (0, sql_builder_1.buildSelect)(request, meta.columns, strategy, this.dialect);
        const [rows, count] = await Promise.all([
            this.run(request.target.database, plan.select),
            // A failed or slow count must not hide the rows.
            this.run(request.target.database, plan.count).catch(() => undefined)
        ]);
        const first = count?.rows[0];
        const total = first ? Number(first.n ?? Object.values(first)[0]) : null;
        return {
            columns: meta.columns,
            rows: rows.rows.map(values_1.encodeRow),
            total: total === null || Number.isNaN(total) ? null : total,
            keyColumns,
            keyStrategy: strategy,
            readOnly,
            elapsedMs: (0, values_1.since)(start)
        };
    }
    async writable(target) {
        const meta = await this.tableMeta(target);
        const { strategy, readOnly } = (0, sql_builder_1.keyStrategyFor)(meta.columns, this.dialect, meta.isView, meta.hasRowid);
        if (meta.isView)
            throw new types_1.DbError(readOnly ?? "Views are read-only here.");
        return { meta, strategy };
    }
    async insert(target, values) {
        const { meta } = await this.writable(target);
        const result = await this.run(target.database, (0, sql_builder_1.buildInsert)(target, meta.columns, values, this.dialect));
        return result.affected ?? 1;
    }
    async update(target, key, _strategy, values) {
        const { meta, strategy } = await this.writable(target);
        if (strategy === "none")
            throw new types_1.DbError((0, sql_builder_1.keyStrategyFor)(meta.columns, this.dialect, false, meta.hasRowid).readOnly ?? "Rows of this table cannot be identified.");
        const result = await this.run(target.database, (0, sql_builder_1.buildUpdate)(target, meta.columns, key, strategy, values, this.dialect));
        return result.affected ?? 0;
    }
    async remove(target, keys, _strategy) {
        const { meta, strategy } = await this.writable(target);
        if (strategy === "none")
            throw new types_1.DbError((0, sql_builder_1.keyStrategyFor)(meta.columns, this.dialect, false, meta.hasRowid).readOnly ?? "Rows of this table cannot be identified.");
        let affected = 0;
        // Batches keep the statement and its parameter count within every driver's limits.
        for (let i = 0; i < keys.length; i += 200) {
            const result = await this.run(target.database, (0, sql_builder_1.buildDelete)(target, meta.columns, keys.slice(i, i + 200), strategy, this.dialect));
            affected += result.affected ?? 0;
        }
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