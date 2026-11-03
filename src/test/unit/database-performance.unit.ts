/**
 * Database Client at scale: row counting (cached, estimated, skipped for
 * searches of large tables), SQLite on a worker thread (the extension host
 * stays responsive, long queries time out and can be cancelled), bounded
 * results, and the guards that keep large files and results in check.
 *
 * The SQLite stress tests build a 300,000-row table in a temporary file.
 * scripts/db-benchmark.js runs the same paths at 100K, 1M and 10M rows.
 */
import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CountCache, LARGE_TABLE_ROWS, SEARCH_COUNT_ROWS } from "../../database/count-cache";
import { friendlyError, parseConnection } from "../../database/connection-string";
import { ExecResult, SqlAdapter, TableMeta } from "../../database/adapters/sql-base";
import { SqliteAdapter, SQLJS_MAX_FILE_BYTES } from "../../database/adapters/sqlite";
import { MAX_REPLY_ELEMENTS, replySize } from "../../database/adapters/redis";
import { categorize } from "../../database/sql-builder";
import { ColumnInfo, DbError, DbTarget, LIMITS, ObjectInfo, QueryResult, RunControl, ServerInfo } from "../../database/types";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "..", "..", "..");

const col = (name: string, dataType: string, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name, dataType, category: categorize(dataType), nullable: true, primaryKey: false, autoIncrement: false, editable: true, ...extra
});

/** A SQL adapter that answers from memory and records every statement it is asked to run. */
class RecordingAdapter extends SqlAdapter {
  readonly kind = "postgres" as const;
  protected readonly dialect = "postgres" as const;
  readonly statements: string[] = [];
  estimate?: number;
  rowCount = 2_500_000;
  isView = false;

  async connect(): Promise<ServerInfo> { return { version: "test" }; }
  async close(): Promise<void> { /* nothing to close */ }
  async ping(): Promise<void> { /* always up */ }
  async listDatabases(): Promise<string[]> { return ["db"]; }
  async listSchemas(): Promise<string[]> { return ["public"]; }
  async listObjects(): Promise<ObjectInfo[]> { return [{ name: "t", type: "table" }]; }
  async runQuery(): Promise<QueryResult> { return { columns: [], rows: [], elapsedMs: 0 }; }

  protected override async estimateRows(): Promise<number | undefined> {
    this.statements.push("ESTIMATE");
    return this.estimate;
  }

  protected async exec(_database: string | undefined, sql: string): Promise<ExecResult> {
    this.statements.push(sql);
    if (/^SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ n: this.rowCount }], columns: ["n"] };
    if (/^INSERT/.test(sql)) return { rows: [], columns: [], affected: 1 };
    const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? 50);
    return { rows: Array.from({ length: limit }, (_, i) => ({ id: i, name: `n${i}` })), columns: ["id", "name"] };
  }

  protected async introspect(): Promise<TableMeta> {
    return { columns: [col("id", "integer", { primaryKey: true, nullable: false }), col("name", "text")], isView: this.isView, hasRowid: false, dropKeyword: "TABLE" };
  }

  countQueries(): number {
    return this.statements.filter(s => s.startsWith("SELECT COUNT")).length;
  }
}

const target: DbTarget = { database: "db", schema: "public", object: "t" };

async function makeOrders(rows: number): Promise<string | undefined> {
  let sqlite: { DatabaseSync: new (file: string) => { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown }; close(): void } };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqlite = require("node:sqlite");
  } catch {
    return undefined;
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-perf-")), "orders.db");
  const db = new sqlite.DatabaseSync(file);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, email TEXT, amount REAL, status TEXT, notes TEXT)");
  const insert = db.prepare("INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let i = 1; i <= rows; i++) insert.run(i, `Customer ${i % 5000}`, `user${i}@example.com`, (i * 7.31) % 10000, ["open", "paid", "shipped"][i % 3], `note ${i.toString(36)} lorem ipsum`);
  db.exec("COMMIT");
  db.close();
  return file;
}

/** The longest stretch, in ms, the event loop could not run a timer while `work` ran. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = Date.now();
  let worst = 0;
  const timer = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; }, 5);
  try {
    await work();
  } finally {
    clearInterval(timer);
  }
  return Math.max(worst, Date.now() - last);
}

suite("database performance: row counts", () => {
  test("the count cache expires entries and stays bounded", async () => {
    const cache = new CountCache(40, 3);
    for (const k of ["a", "b", "c", "d"]) cache.set(k, { total: 1 });
    assert.strictEqual(cache.size, 3);
    assert.strictEqual(cache.get("a"), undefined, "the oldest entry went first");
    assert.deepStrictEqual(cache.get("d"), { total: 1 });
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(cache.get("d"), undefined, "entries expire");
    cache.set("e", { total: 2 });
    cache.clear();
    assert.strictEqual(cache.size, 0);
  });

  test("pages of the same query are counted once, and writes recount", async () => {
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

  test("a large unfiltered table shows the statistics estimate and counts exactly on request", async () => {
    const a = new RecordingAdapter();
    a.estimate = 12_345_678;
    const page = await a.fetchPage({ target, page: 1, pageSize: 50 });
    assert.deepStrictEqual([page.total, page.totalEstimated, page.countable], [12_345_678, true, true]);
    assert.strictEqual(a.countQueries(), 0, "no COUNT(*) on a table with millions of rows");
    assert.strictEqual(await a.countRows({ target, page: 1, pageSize: 50 }), 2_500_000);
    assert.strictEqual(a.countQueries(), 1);
    const after = await a.fetchPage({ target, page: 2, pageSize: 50 });
    assert.deepStrictEqual([after.total, after.totalEstimated], [2_500_000, undefined], "the exact count replaces the estimate");
  });

  test("small tables, views and filters are counted exactly", async () => {
    const small = new RecordingAdapter();
    small.estimate = LARGE_TABLE_ROWS - 1;
    small.rowCount = 999;
    assert.strictEqual((await small.fetchPage({ target, page: 1, pageSize: 50 })).total, 999);
    const view = new RecordingAdapter();
    view.estimate = 50_000_000;
    view.isView = true;
    const v = await view.fetchPage({ target, page: 1, pageSize: 50 });
    assert.strictEqual(v.totalEstimated, undefined);
    assert.ok(!view.statements.includes("ESTIMATE"), "views have no statistics to read");
    const filtered = new RecordingAdapter();
    filtered.estimate = 50_000_000;
    await filtered.fetchPage({ target, page: 1, pageSize: 50, filters: [{ column: "id", op: "gt", value: "5" }] });
    assert.strictEqual(filtered.countQueries(), 1);
  });

  test("a text search of a large table pages on without counting the whole table twice", async () => {
    const a = new RecordingAdapter();
    a.rowCount = SEARCH_COUNT_ROWS * 3;
    await a.fetchPage({ target, page: 1, pageSize: 50 });
    const search = await a.fetchPage({ target, page: 1, pageSize: 50, search: "alice" });
    assert.deepStrictEqual([search.total, search.hasMore, search.countable], [null, true, true]);
    assert.strictEqual(a.countQueries(), 1, "only the unfiltered count ran");
    assert.strictEqual(await a.countRows({ target, page: 1, pageSize: 50, search: "alice" }), SEARCH_COUNT_ROWS * 3);
    // A small table's search is still counted.
    const small = new RecordingAdapter();
    small.rowCount = 500;
    await small.fetchPage({ target, page: 1, pageSize: 50 });
    assert.strictEqual((await small.fetchPage({ target, page: 1, pageSize: 50, search: "x" })).total, 500);
  });
});

suite("database performance: SQLite at scale", () => {
  let file: string | undefined;
  const ready = (async () => { file = await makeOrders(300_000); })();

  test("a full scan of 300,000 rows runs off the extension host thread", async () => {
    await ready;
    if (!file) return;
    const adapter = new SqliteAdapter(parseConnection(`sqlite://${file}`), true);
    await adapter.connect();
    try {
      assert.strictEqual(adapter.engine, "node:sqlite");
      const stall = await longestStall(() => adapter.fetchPage({ target: { database: "main", object: "orders" }, page: 1, pageSize: 50, search: "no-such-text" }));
      // In-process, this scan held the event loop for its whole run (~300 ms here, ~12 s at 10M rows).
      assert.ok(stall < 100, `the event loop stalled for ${stall} ms`);
      const last = await adapter.fetchPage({ target: { database: "main", object: "orders" }, page: 6000, pageSize: 50 });
      assert.deepStrictEqual([last.total, last.rows.length, last.rows[49].id], [300_000, 50, 300_000]);
    } finally {
      await adapter.close();
    }
  });

  test("console results stay capped however large the table", async () => {
    await ready;
    if (!file) return;
    const adapter = new SqliteAdapter(parseConnection(`sqlite://${file}`), true);
    await adapter.connect();
    try {
      global.gc?.();
      const before = process.memoryUsage().heapUsed;
      const result = await adapter.runQuery("SELECT * FROM orders");
      assert.strictEqual(result.rows.length, LIMITS.maxQueryRows);
      assert.strictEqual(result.truncated, true);
      assert.ok(process.memoryUsage().heapUsed - before < 64 * 1024 * 1024, "the console never holds the whole table");
    } finally {
      await adapter.close();
    }
  });

  test("a running SQLite query can be cancelled, and the connection keeps working", async () => {
    await ready;
    if (!file) return;
    const adapter = new SqliteAdapter(parseConnection(`sqlite://${file}`), true);
    await adapter.connect();
    try {
      const control = new RunControl();
      const started = Date.now();
      const running = adapter.runQuery("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000000000) SELECT count(*) FROM n", {}, control);
      const outcome = running.then(() => "finished", (e: DbError) => e.code);
      setTimeout(() => void control.cancel(), 150);
      assert.strictEqual(await outcome, "CANCELLED");
      assert.ok(Date.now() - started < 3000, "the cancel stops the query at once");
      // The console's worker restarts; the grid's was never touched.
      assert.strictEqual((await adapter.runQuery("SELECT 42 AS x")).rows[0].x, 42);
      assert.strictEqual((await adapter.fetchPage({ target: { database: "main", object: "orders" }, page: 1, pageSize: 5 })).rows.length, 5);
    } finally {
      await adapter.close();
    }
  });

  test("a SQLite query that runs past the time limit is stopped", async () => {
    await ready;
    if (!file) return;
    const adapter = new SqliteAdapter(parseConnection(`sqlite://${file}`), true, "auto", 300);
    await adapter.connect();
    try {
      const error = await adapter.runQuery("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 2000000000) SELECT count(*) FROM n").catch((e: DbError) => e);
      assert.ok(error instanceof DbError && error.code === "TIMEOUT", String(error));
      assert.match(error.message, /longer than 0 seconds|longer than \d+ seconds/);
      assert.strictEqual((await adapter.runQuery("SELECT 1 AS one")).rows[0].one, 1);
    } finally {
      await adapter.close();
    }
  });

  test("sql.js refuses files it would have to copy whole into memory beyond its limit", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-big-"));
    const big = path.join(dir, "big.db");
    // A sparse file: SQLite's header, then a hole up to just past the limit.
    fs.writeFileSync(big, Buffer.from("SQLite format 3\u0000"));
    fs.truncateSync(big, SQLJS_MAX_FILE_BYTES + 1);
    const adapter = new SqliteAdapter(parseConnection(`sqlite://${big}`), true, "sql.js");
    await assert.rejects(adapter.connect(), /too large to open without node:sqlite/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

suite("database performance: limits and messages", () => {
  test("server-side time limits read as timeouts, not cancels", () => {
    const mysql = friendlyError(Object.assign(new Error("Query execution was interrupted, maximum statement execution time exceeded"), { code: "ER_QUERY_TIMEOUT" }));
    assert.match(mysql.message, /30-second limit/);
    const mariadb = friendlyError(new Error("Query execution was interrupted (max_statement_time exceeded)"));
    assert.match(mariadb.message, /30-second limit/);
    assert.match(friendlyError(new Error("Query execution was interrupted")).message, /cancelled/);
  });

  test("Redis console commands that read whole collections are sized first", async () => {
    const sizes: Record<string, number> = { DBSIZE: 9_000_000, HLEN: 5_000_000, SCARD: 12, LLEN: 1_000_000, ZCARD: 40_000, XLEN: 3 };
    const asked: string[] = [];
    const client = { call: async (...args: string[]) => { asked.push(args.join(" ")); return sizes[args[0]]; } };
    assert.strictEqual(await replySize(client, ["KEYS", "*"]), 9_000_000);
    assert.strictEqual(await replySize(client, ["HGETALL", "big"]), 5_000_000);
    assert.strictEqual(await replySize(client, ["SMEMBERS", "small"]), 12);
    assert.strictEqual(await replySize(client, ["LRANGE", "q", "0", "-1"]), 1_000_000);
    assert.strictEqual(await replySize(client, ["LRANGE", "q", "0", "99"]), 100);
    assert.strictEqual(await replySize(client, ["LRANGE", "q", "-10", "-1"]), 10);
    assert.strictEqual(await replySize(client, ["ZRANGE", "z", "0", "-1"]), 40_000);
    assert.strictEqual(await replySize(client, ["ZRANGEBYSCORE", "z", "0", "10", "LIMIT", "0", "5"]), undefined);
    assert.strictEqual(await replySize(client, ["XRANGE", "s", "-", "+"]), 3);
    assert.strictEqual(await replySize(client, ["GET", "k"]), undefined);
    assert.ok(!asked.includes("KEYS *"), "only size commands run");
    assert.ok(MAX_REPLY_ELEMENTS < 9_000_000 && MAX_REPLY_ELEMENTS >= 1000);
  });

  test("the webview renders large results through the row virtualizer", () => {
    const source = fs.readFileSync(path.join(ROOT, "media", "db-client.js"), "utf8");
    assert.strictEqual((source.match(/virtualRows\(wrap, table, body,/g) ?? []).length, 2, "the grid and the console results are virtualized");
    assert.match(source, /var VIRTUAL_MIN = \d+;/);
    // Select-all must not rebuild the grid (it used to, for every page of 500 rows).
    assert.ok(!/all\.addEventListener\("change", function \(\) \{[^}]*renderGrid\(t\)/.test(source));
  });
});
