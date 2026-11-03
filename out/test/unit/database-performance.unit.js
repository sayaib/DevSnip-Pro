"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Database Client at scale: row counting (cached, estimated, skipped for
 * searches of large tables), SQLite on a worker thread (the extension host
 * stays responsive, long queries time out and can be cancelled), bounded
 * results, and the guards that keep large files and results in check.
 *
 * The SQLite stress tests build a 300,000-row table in a temporary file.
 * scripts/db-benchmark.js runs the same paths at 100K, 1M and 10M rows.
 */
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const count_cache_1 = require("../../database/count-cache");
const connection_string_1 = require("../../database/connection-string");
const sql_base_1 = require("../../database/adapters/sql-base");
const sqlite_1 = require("../../database/adapters/sqlite");
const redis_1 = require("../../database/adapters/redis");
const sql_builder_1 = require("../../database/sql-builder");
const types_1 = require("../../database/types");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const col = (name, dataType, extra = {}) => ({
    name, dataType, category: (0, sql_builder_1.categorize)(dataType), nullable: true, primaryKey: false, autoIncrement: false, editable: true, ...extra
});
/** A SQL adapter that answers from memory and records every statement it is asked to run. */
class RecordingAdapter extends sql_base_1.SqlAdapter {
    constructor() {
        super(...arguments);
        this.kind = "postgres";
        this.dialect = "postgres";
        this.statements = [];
        this.rowCount = 2500000;
        this.isView = false;
    }
    async connect() { return { version: "test" }; }
    async close() { }
    async ping() { }
    async listDatabases() { return ["db"]; }
    async listSchemas() { return ["public"]; }
    async listObjects() { return [{ name: "t", type: "table" }]; }
    async runQuery() { return { columns: [], rows: [], elapsedMs: 0 }; }
    async estimateRows() {
        this.statements.push("ESTIMATE");
        return this.estimate;
    }
    async exec(_database, sql) {
        this.statements.push(sql);
        if (/^SELECT COUNT\(\*\)/.test(sql))
            return { rows: [{ n: this.rowCount }], columns: ["n"] };
        if (/^INSERT/.test(sql))
            return { rows: [], columns: [], affected: 1 };
        const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? 50);
        return { rows: Array.from({ length: limit }, (_, i) => ({ id: i, name: `n${i}` })), columns: ["id", "name"] };
    }
    async introspect() {
        return { columns: [col("id", "integer", { primaryKey: true, nullable: false }), col("name", "text")], isView: this.isView, hasRowid: false, dropKeyword: "TABLE" };
    }
    countQueries() {
        return this.statements.filter(s => s.startsWith("SELECT COUNT")).length;
    }
}
const target = { database: "db", schema: "public", object: "t" };
async function makeOrders(rows) {
    let sqlite;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        sqlite = require("node:sqlite");
    }
    catch {
        return undefined;
    }
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-perf-")), "orders.db");
    const db = new sqlite.DatabaseSync(file);
    db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, email TEXT, amount REAL, status TEXT, notes TEXT)");
    const insert = db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)");
    db.exec("BEGIN");
    for (let i = 1; i <= rows; i++)
        insert.run(i, `Customer ${i % 5000}`, `user${i}@example.com`, (i * 7.31) % 10000, ["open", "paid", "shipped"][i % 3], `note ${i.toString(36)} lorem ipsum`);
    db.exec("COMMIT");
    db.close();
    return file;
}
/** The longest stretch, in ms, the event loop could not run a timer while `work` ran. */
async function longestStall(work) {
    let last = Date.now();
    let worst = 0;
    const timer = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; }, 5);
    try {
        await work();
    }
    finally {
        clearInterval(timer);
    }
    return Math.max(worst, Date.now() - last);
}
(0, run_unit_tests_1.suite)("database performance: row counts", () => {
    (0, run_unit_tests_1.test)("the count cache expires entries and stays bounded", async () => {
        const cache = new count_cache_1.CountCache(40, 3);
        for (const k of ["a", "b", "c", "d"])
            cache.set(k, { total: 1 });
        assert.strictEqual(cache.size, 3);
        assert.strictEqual(cache.get("a"), undefined, "the oldest entry went first");
        assert.deepStrictEqual(cache.get("d"), { total: 1 });
        await new Promise(r => setTimeout(r, 60));
        assert.strictEqual(cache.get("d"), undefined, "entries expire");
        cache.set("e", { total: 2 });
        cache.clear();
        assert.strictEqual(cache.size, 0);
    });
    (0, run_unit_tests_1.test)("pages of the same query are counted once, and writes recount", async () => {
        const a = new RecordingAdapter();
        a.rowCount = 800;
        const p1 = await a.fetchPage({ target, page: 1, pageSize: 50 });
        await a.fetchPage({ target, page: 2, pageSize: 50 });
        await a.fetchPage({ target, page: 9, pageSize: 50 });
        assert.strictEqual(p1.total, 800);
        assert.strictEqual(a.countQueries(), 1, "paging reuses the count");
        await a.fetchPage({ target, page: 1, pageSize: 50, filters: [{ column: "name", op: "eq", value: "x" }] });
        await a.fetchPage({ target, page: 2, pageSize: 50, filters: [{ column: "name", op: "eq", value: "x" }] });
        assert.strictEqual(a.countQueries(), 2, "a new filter is counted once");
        await a.insert(target, { name: { mode: "value", value: "new" } });
        await a.fetchPage({ target, page: 1, pageSize: 50 });
        assert.strictEqual(a.countQueries(), 3, "an insert makes the next page count again");
        a.invalidate();
        await a.fetchPage({ target, page: 1, pageSize: 50 });
        assert.strictEqual(a.countQueries(), 4, "a refresh counts again");
    });
    (0, run_unit_tests_1.test)("a large unfiltered table shows the statistics estimate and counts exactly on request", async () => {
        const a = new RecordingAdapter();
        a.estimate = 12345678;
        const page = await a.fetchPage({ target, page: 1, pageSize: 50 });
        assert.deepStrictEqual([page.total, page.totalEstimated, page.countable], [12345678, true, true]);
        assert.strictEqual(a.countQueries(), 0, "no COUNT(*) on a table with millions of rows");
        assert.strictEqual(await a.countRows({ target, page: 1, pageSize: 50 }), 2500000);
        assert.strictEqual(a.countQueries(), 1);
        const after = await a.fetchPage({ target, page: 2, pageSize: 50 });
        assert.deepStrictEqual([after.total, after.totalEstimated], [2500000, undefined], "the exact count replaces the estimate");
    });
    (0, run_unit_tests_1.test)("small tables, views and filters are counted exactly", async () => {
        const small = new RecordingAdapter();
        small.estimate = count_cache_1.LARGE_TABLE_ROWS - 1;
        small.rowCount = 999;
        assert.strictEqual((await small.fetchPage({ target, page: 1, pageSize: 50 })).total, 999);
        const view = new RecordingAdapter();
        view.estimate = 50000000;
        view.isView = true;
        const v = await view.fetchPage({ target, page: 1, pageSize: 50 });
        assert.strictEqual(v.totalEstimated, undefined);
        assert.ok(!view.statements.includes("ESTIMATE"), "views have no statistics to read");
        const filtered = new RecordingAdapter();
        filtered.estimate = 50000000;
        await filtered.fetchPage({ target, page: 1, pageSize: 50, filters: [{ column: "id", op: "gt", value: "5" }] });
        assert.strictEqual(filtered.countQueries(), 1);
    });
    (0, run_unit_tests_1.test)("a text search of a large table pages on without counting the whole table twice", async () => {
        const a = new RecordingAdapter();
        a.rowCount = count_cache_1.SEARCH_COUNT_ROWS * 3;
        await a.fetchPage({ target, page: 1, pageSize: 50 });
        const search = await a.fetchPage({ target, page: 1, pageSize: 50, search: "alice" });
        assert.deepStrictEqual([search.total, search.hasMore, search.countable], [null, true, true]);
        assert.strictEqual(a.countQueries(), 1, "only the unfiltered count ran");
        assert.strictEqual(await a.countRows({ target, page: 1, pageSize: 50, search: "alice" }), count_cache_1.SEARCH_COUNT_ROWS * 3);
        // A small table's search is still counted.
        const small = new RecordingAdapter();
        small.rowCount = 500;
        await small.fetchPage({ target, page: 1, pageSize: 50 });
        assert.strictEqual((await small.fetchPage({ target, page: 1, pageSize: 50, search: "x" })).total, 500);
    });
});
(0, run_unit_tests_1.suite)("database performance: SQLite at scale", () => {
    let file;
    const ready = (async () => { file = await makeOrders(300000); })();
    (0, run_unit_tests_1.test)("a full scan of 300,000 rows runs off the extension host thread", async () => {
        await ready;
        if (!file)
            return;
        const adapter = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${file}`), true);
        await adapter.connect();
        try {
            assert.strictEqual(adapter.engine, "node:sqlite");
            const stall = await longestStall(() => adapter.fetchPage({ target: { database: "main", object: "orders" }, page: 1, pageSize: 50, search: "no-such-text" }));
            // In-process, this scan held the event loop for its whole run (~300 ms here, ~12 s at 10M rows).
            assert.ok(stall < 100, `the event loop stalled for ${stall} ms`);
            const last = await adapter.fetchPage({ target: { database: "main", object: "orders" }, page: 6000, pageSize: 50 });
            assert.deepStrictEqual([last.total, last.rows.length, last.rows[49].id], [300000, 50, 300000]);
        }
        finally {
            await adapter.close();
        }
    });
    (0, run_unit_tests_1.test)("console results stay capped however large the table", async () => {
        await ready;
        if (!file)
            return;
        const adapter = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${file}`), true);
        await adapter.connect();
        try {
            global.gc?.();
            const before = process.memoryUsage().heapUsed;
            const result = await adapter.runQuery("SELECT * FROM orders");
            assert.strictEqual(result.rows.length, types_1.LIMITS.maxQueryRows);
            assert.strictEqual(result.truncated, true);
            assert.ok(process.memoryUsage().heapUsed - before < 64 * 1024 * 1024, "the console never holds the whole table");
        }
        finally {
            await adapter.close();
        }
    });
    (0, run_unit_tests_1.test)("a running SQLite query can be cancelled, and the connection keeps working", async () => {
        await ready;
        if (!file)
            return;
        const adapter = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${file}`), true);
        await adapter.connect();
        try {
            const control = new types_1.RunControl();
            const started = Date.now();
            const running = adapter.runQuery("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000000000) SELECT count(*) FROM n", {}, control);
            const outcome = running.then(() => "finished", (e) => e.code);
            setTimeout(() => void control.cancel(), 150);
            assert.strictEqual(await outcome, "CANCELLED");
            assert.ok(Date.now() - started < 3000, "the cancel stops the query at once");
            // The console's worker restarts; the grid's was never touched.
            assert.strictEqual((await adapter.runQuery("SELECT 42 AS x")).rows[0].x, 42);
            assert.strictEqual((await adapter.fetchPage({ target: { database: "main", object: "orders" }, page: 1, pageSize: 5 })).rows.length, 5);
        }
        finally {
            await adapter.close();
        }
    });
    (0, run_unit_tests_1.test)("a SQLite query that runs past the time limit is stopped", async () => {
        await ready;
        if (!file)
            return;
        const adapter = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${file}`), true, "auto", 300);
        await adapter.connect();
        try {
            const error = await adapter.runQuery("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000000000) SELECT count(*) FROM n").catch((e) => e);
            assert.ok(error instanceof types_1.DbError && error.code === "TIMEOUT", String(error));
            assert.match(error.message, /longer than 0 seconds|longer than \d+ seconds/);
            assert.strictEqual((await adapter.runQuery("SELECT 1 AS one")).rows[0].one, 1);
        }
        finally {
            await adapter.close();
        }
    });
    (0, run_unit_tests_1.test)("sql.js refuses files it would have to copy whole into memory beyond its limit", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-big-"));
        const big = path.join(dir, "big.db");
        // A sparse file: SQLite's header, then a hole up to just past the limit.
        fs.writeFileSync(big, Buffer.from("SQLite format 3\u0000"));
        fs.truncateSync(big, sqlite_1.SQLJS_MAX_FILE_BYTES + 1);
        const adapter = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${big}`), true, "sql.js");
        await assert.rejects(adapter.connect(), /too large to open without node:sqlite/);
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
(0, run_unit_tests_1.suite)("database performance: limits and messages", () => {
    (0, run_unit_tests_1.test)("server-side time limits read as timeouts, not cancels", () => {
        const mysql = (0, connection_string_1.friendlyError)(Object.assign(new Error("Query execution was interrupted, maximum statement execution time exceeded"), { code: "ER_QUERY_TIMEOUT" }));
        assert.match(mysql.message, /30-second limit/);
        const mariadb = (0, connection_string_1.friendlyError)(new Error("Query execution was interrupted (max_statement_time exceeded)"));
        assert.match(mariadb.message, /30-second limit/);
        assert.match((0, connection_string_1.friendlyError)(new Error("Query execution was interrupted")).message, /cancelled/);
    });
    (0, run_unit_tests_1.test)("Redis console commands that read whole collections are sized first", async () => {
        const sizes = { DBSIZE: 9000000, HLEN: 5000000, SCARD: 12, LLEN: 1000000, ZCARD: 40000, XLEN: 3 };
        const asked = [];
        const client = { call: async (...args) => { asked.push(args.join(" ")); return sizes[args[0]]; } };
        assert.strictEqual(await (0, redis_1.replySize)(client, ["KEYS", "*"]), 9000000);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["HGETALL", "big"]), 5000000);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["SMEMBERS", "small"]), 12);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["LRANGE", "q", "0", "-1"]), 1000000);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["LRANGE", "q", "0", "99"]), 100);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["LRANGE", "q", "-10", "-1"]), 10);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["ZRANGE", "z", "0", "-1"]), 40000);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["ZRANGEBYSCORE", "z", "0", "10", "LIMIT", "0", "5"]), undefined);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["XRANGE", "s", "-", "+"]), 3);
        assert.strictEqual(await (0, redis_1.replySize)(client, ["GET", "k"]), undefined);
        assert.ok(!asked.includes("KEYS *"), "only size commands run");
        assert.ok(redis_1.MAX_REPLY_ELEMENTS < 9000000 && redis_1.MAX_REPLY_ELEMENTS >= 1000);
    });
    (0, run_unit_tests_1.test)("the webview renders large results through the row virtualizer", () => {
        const source = fs.readFileSync(path.join(ROOT, "media", "db-client.js"), "utf8");
        assert.strictEqual((source.match(/virtualRows\(wrap, table, body,/g) ?? []).length, 2, "the grid and the console results are virtualized");
        assert.match(source, /var VIRTUAL_MIN = \d+;/);
        // Select-all must not rebuild the grid (it used to, for every page of 500 rows).
        assert.ok(!/all\.addEventListener\("change", function \(\) \{[^}]*renderGrid\(t\)/.test(source));
    });
});
//# sourceMappingURL=database-performance.unit.js.map