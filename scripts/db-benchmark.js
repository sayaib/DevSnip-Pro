#!/usr/bin/env node
/**
 * Benchmarks the Database Client's host side on large SQLite tables.
 *
 *   npm run compile
 *   node --expose-gc scripts/db-benchmark.js            # 100K and 1M rows
 *   node --expose-gc scripts/db-benchmark.js 10000000   # any sizes, space-separated
 *
 * Builds orders tables in the system temp folder (reused on later runs) and
 * drives the real DatabaseService: paging, deep pages, sorting, filters,
 * search, console queries, and a cheap request issued during a full scan.
 * "blocked ms" is the longest time the extension host's event loop could not
 * run anything else; it should stay near zero for every row of the table.
 * Needs Node 22.5+ (node:sqlite).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const OUT = path.join(__dirname, "..", "out");
require(path.join(OUT, "test/unit/vscode-stub")).installVscodeStub();
const { DatabaseService } = require(path.join(OUT, "database/service"));
const { ConnectionStore } = require(path.join(OUT, "database/store"));

const sizes = process.argv.slice(2).map(Number).filter(n => n > 0);
const DIR = path.join(os.tmpdir(), "devsnip-db-benchmark");

function build(rows) {
  const file = path.join(DIR, `orders_${rows}.db`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(DIR, { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  const tmp = `${file}.tmp`;
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
  db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT NOT NULL, email TEXT, amount REAL, status TEXT, created_at TEXT, notes TEXT, qty INTEGER, region TEXT, flagged INTEGER)");
  const insert = db.prepare("INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?)");
  const statuses = ["open", "paid", "shipped", "cancelled", "refunded"];
  const regions = ["eu-west", "us-east", "ap-south", "sa-east"];
  db.exec("BEGIN");
  for (let i = 1; i <= rows; i++) {
    insert.run(i, `Customer ${i % 50000}`, `user${i}@example.com`, (i * 7.31) % 10000, statuses[i % 5], new Date(1.6e12 + i * 6e4).toISOString(), `note ${i.toString(36)} lorem ipsum dolor sit amet`, i % 17, regions[i % 4], i % 101 === 0 ? 1 : 0);
    if (i % 500000 === 0) db.exec("COMMIT; BEGIN");
  }
  db.exec("COMMIT");
  db.exec("CREATE INDEX orders_status ON orders(status)");
  db.close();
  fs.renameSync(tmp, file);
  return file;
}

function memoryStore() {
  const state = new Map(), secrets = new Map();
  return new ConnectionStore(
    { get: (k, f) => (state.has(k) ? state.get(k) : f), update: (k, v) => { state.set(k, v); return Promise.resolve(); } },
    { get: k => Promise.resolve(secrets.get(k)), store: (k, v) => { secrets.set(k, v); return Promise.resolve(); }, delete: k => { secrets.delete(k); return Promise.resolve(); } }
  );
}

async function measure(name, fn) {
  global.gc?.();
  const heap = process.memoryUsage().heapUsed;
  let worst = 0, last = Date.now();
  const tick = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last); last = now; }, 5);
  const start = process.hrtime.bigint();
  let result, error;
  try { result = await fn(); } catch (e) { error = e.message; }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  await new Promise(r => setTimeout(r, 15));
  clearInterval(tick);
  const mb = n => +(n / 1048576).toFixed(1);
  return { op: name, ms: +ms.toFixed(1), "blocked ms": Math.max(0, worst - 5), "heap Δ MB": mb(process.memoryUsage().heapUsed - heap), "rss MB": mb(process.memoryUsage().rss), rows: result?.rows?.length, total: result?.total, error };
}

async function run(rows) {
  const file = build(rows);
  const ui = { confirm: async () => true, confirmByTyping: async () => true, pickSqliteFile: async () => undefined, copy: async () => undefined, openDocument: async () => undefined, baseDir: () => undefined };
  const service = new DatabaseService(memoryStore(), ui, () => undefined);
  const { id } = await service.handle("saveConnection", { name: `orders ${rows}`, connectionString: `sqlite://${file}` });
  const target = { database: "main", object: "orders" };
  const page = (p, extra = {}) => service.handle("fetchPage", { id, request: { target, page: p, pageSize: 50, ...extra } });
  const results = [
    await measure("connect", () => service.handle("connect", { id })),
    await measure("page 1 (50 rows)", () => page(1)),
    await measure("page 2 (50 rows)", () => page(2)),
    await measure("page 1 (500 rows)", () => page(1, { pageSize: 500 })),
    await measure("middle page", () => page(Math.max(1, Math.floor(rows / 100)))),
    await measure("last page", () => page(Math.max(1, Math.ceil(rows / 50)))),
    await measure("sort, unindexed column", () => page(1, { sort: { column: "amount", dir: "desc" } })),
    await measure("filter, indexed column", () => page(1, { filters: [{ column: "status", op: "eq", value: "paid" }] })),
    await measure("same filter, page 2", () => page(2, { filters: [{ column: "status", op: "eq", value: "paid" }] })),
    await measure("search all columns", () => page(1, { search: "user4242" })),
    await measure("console SELECT * (capped)", () => service.handle("runQuery", { id, text: "SELECT * FROM orders" })),
    await measure("console aggregate", () => service.handle("runQuery", { id, text: "SELECT status, count(*) AS n, avg(amount) FROM orders GROUP BY status" })),
    await measure("request during a full scan", async () => {
      const scan = page(1, { search: "no-such-text" });
      const t = Date.now();
      await service.handle("listDatabases", { id });
      const waited = Date.now() - t;
      await scan;
      return { total: `${waited} ms wait` };
    })
  ];
  await service.dispose();
  console.log(`\n${rows.toLocaleString("en-US")} rows (${(fs.statSync(file).size / 1e6).toFixed(0)} MB)`);
  console.table(results);
}

(async () => {
  for (const rows of sizes.length ? sizes : [100_000, 1_000_000]) await run(rows);
})();
