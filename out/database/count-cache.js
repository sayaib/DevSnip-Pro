"use strict";
/**
 * Remembers row counts per query, so paging through a filtered table counts
 * it once rather than on every page. COUNT(*) is the expensive half of a
 * page on large tables: a full scan on PostgreSQL and InnoDB.
 *
 * Bounded (oldest entries go first) and short-lived; adapters clear it after
 * every write.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CountCache = exports.SEARCH_COUNT_ROWS = exports.LARGE_TABLE_ROWS = void 0;
/** Unfiltered tables at least this large show the statistics estimate instead of being counted. */
exports.LARGE_TABLE_ROWS = 1000000;
/**
 * A text search on a table at least this large is not counted: the search
 * cannot use an index, so counting would scan the whole table a second
 * time. The grid pages on, and the user can still ask for the count.
 */
exports.SEARCH_COUNT_ROWS = 100000;
class CountCache {
    constructor(ttlMs = 30000, max = 100) {
        this.ttlMs = ttlMs;
        this.max = max;
        this.entries = new Map();
    }
    get(key) {
        const entry = this.entries.get(key);
        if (!entry)
            return undefined;
        if (Date.now() - entry.at > this.ttlMs) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }
    set(key, value) {
        this.entries.delete(key);
        this.entries.set(key, { at: Date.now(), value });
        while (this.entries.size > this.max)
            this.entries.delete(this.entries.keys().next().value);
    }
    clear() {
        this.entries.clear();
    }
    get size() {
        return this.entries.size;
    }
}
exports.CountCache = CountCache;
//# sourceMappingURL=count-cache.js.map