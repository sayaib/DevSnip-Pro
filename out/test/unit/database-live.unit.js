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
 * End-to-end Database Client tests against real servers. They are skipped
 * unless a URL is given, e.g.
 *
 *   DEVSNIP_TEST_POSTGRES_URL=postgresql://u:p@localhost:5432/app \
 *   DEVSNIP_TEST_MYSQL_URL=mysql://root@127.0.0.1:3306/app \
 *   DEVSNIP_TEST_SQLSERVER_URL="Server=localhost,1433;Database=app;User Id=sa;Password=...;Encrypt=false" \
 *   DEVSNIP_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/app \
 *   DEVSNIP_TEST_REDIS_URL=redis://localhost:6379/15 \
 *   npm run test:unit
 *
 * Each run works in its own devsnip_test_* tables, collection or keys and removes them afterwards.
 */
const assert = __importStar(require("assert"));
const connection_string_1 = require("../../database/connection-string");
const store_1 = require("../../database/store");
const service_1 = require("../../database/service");
const types_1 = require("../../database/types");
const run_unit_tests_1 = require("./run-unit-tests");
class MemoryState {
    constructor() {
        this.data = new Map();
    }
    get(key, fallback) { return (this.data.has(key) ? this.data.get(key) : fallback); }
    update(key, value) { this.data.set(key, value); return Promise.resolve(); }
}
class MemorySecrets {
    constructor() {
        this.data = new Map();
    }
    get(key) { return Promise.resolve(this.data.get(key)); }
    store(key, value) { this.data.set(key, value); return Promise.resolve(); }
    delete(key) { this.data.delete(key); return Promise.resolve(); }
}
const ui = {
    asked: [],
    confirm: async (message) => { ui.asked.push(message); return true; },
    confirmByTyping: async (message) => { ui.asked.push(message); return true; },
    pickSqliteFile: async () => undefined,
    copy: async () => undefined,
    openDocument: async () => undefined,
    baseDir: () => undefined
};
async function open(url, readOnly = false) {
    const store = new store_1.ConnectionStore(new MemoryState(), new MemorySecrets());
    const service = new service_1.DatabaseService(store, ui, () => undefined);
    const { id } = await store.save({ name: "live", connectionString: url, readOnly });
    return { service, id, call: (method, params = {}) => service.handle(method, { id, ...params }) };
}
async function rejects(promise, pattern) {
    try {
        await promise;
    }
    catch (error) {
        assert.ok(error instanceof types_1.DbError, `expected DbError, got ${error}`);
        assert.match(`${error.message} ${error.hint ?? ""}`, pattern);
        return error;
    }
    throw new Error(`expected a rejection matching ${pattern}`);
}
function withPassword(url, password) {
    return url.replace(/^([a-z+]+:\/\/)([^:@/]*)(:[^@]*)?@/i, (_m, scheme, user) => `${scheme}${user || "root"}:${password}@`).replace(/(password|pwd)=[^;]*/i, `$1=${password}`);
}
const SQL_DDL = {
    postgres: t => [
        `CREATE TABLE ${t} (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, age INT, score NUMERIC(10,2), active BOOLEAN DEFAULT true, meta JSONB, born DATE, created TIMESTAMPTZ DEFAULT now(), avatar BYTEA)`,
        `CREATE TABLE ${t}_nopk (msg TEXT, level TEXT)`,
        `CREATE VIEW ${t}_v AS SELECT id, name FROM ${t}`
    ],
    mysql: t => [
        `CREATE TABLE ${t} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(100) UNIQUE, age INT, score DECIMAL(10,2), active TINYINT(1) DEFAULT 1, meta JSON, born DATE, created DATETIME DEFAULT CURRENT_TIMESTAMP, avatar BLOB)`,
        `CREATE TABLE ${t}_nopk (msg VARCHAR(50), level VARCHAR(20))`,
        `CREATE VIEW ${t}_v AS SELECT id, name FROM ${t}`
    ],
    sqlserver: t => [
        `CREATE TABLE ${t} (id INT IDENTITY(1,1) PRIMARY KEY, name NVARCHAR(100) NOT NULL, email NVARCHAR(100) UNIQUE, age INT, score DECIMAL(10,2), active BIT DEFAULT 1, meta NVARCHAR(MAX), born DATE, created DATETIME2 DEFAULT SYSUTCDATETIME(), avatar VARBINARY(MAX))`,
        `CREATE TABLE ${t}_nopk (msg NVARCHAR(50), level NVARCHAR(20))`,
        `CREATE VIEW ${t}_v AS SELECT id, name FROM ${t}`
    ]
};
for (const kind of ["postgres", "mysql", "sqlserver"]) {
    const url = process.env[`DEVSNIP_TEST_${kind.toUpperCase()}_URL`];
    (0, run_unit_tests_1.suite)(`database live: ${kind}`, () => {
        if (!url) {
            (0, run_unit_tests_1.test)(`skipped (set DEVSNIP_TEST_${kind.toUpperCase()}_URL)`, () => undefined);
            return;
        }
        (0, run_unit_tests_1.test)("connects, browses, filters and runs full CRUD", async () => {
            const spec = (0, connection_string_1.parseConnection)(url);
            const t = `devsnip_test_${Date.now().toString(36)}`;
            const { service, call } = await open(url);
            const schema = kind === "postgres" ? "public" : kind === "sqlserver" ? "dbo" : undefined;
            try {
                const view = await call("connect");
                assert.strictEqual(view.status, "connected");
                assert.match(view.version, kind === "postgres" ? /PostgreSQL/ : kind === "mysql" ? /MySQL|MariaDB/ : /SQL Server/);
                const database = spec.database || view.defaultDatabase;
                const dbs = await call("listDatabases");
                assert.ok(dbs.databases.includes(database), `${database} in ${dbs.databases}`);
                if (schema)
                    assert.ok((await call("listSchemas", { database })).includes(schema));
                for (const ddl of SQL_DDL[kind](t))
                    await call("runQuery", { database, text: ddl });
                const objects = await call("listObjects", { database, schema });
                assert.ok(objects.some(o => o.name === t && o.type === "table"));
                assert.ok(objects.some(o => o.name === `${t}_v` && o.type === "view"));
                const target = { database, schema, object: t };
                const columns = await call("describe", { target });
                const byName = Object.fromEntries(columns.map(c => [c.name, c]));
                assert.ok(byName.id.primaryKey && byName.id.autoIncrement);
                assert.strictEqual(byName.active.category, "boolean");
                assert.strictEqual(byName.score.category, "number");
                assert.strictEqual(byName.avatar.editable, false);
                assert.strictEqual(byName.created.editable, true, "a column with a CURRENT_TIMESTAMP default stays editable");
                const people = [["Ann", "ann@x.io", "31", "10.50", "true"], ["Bob", "bob@x.io", "17", "3.25", "false"], ["Cy 50%", "cy@x.io", "45", "99.99", "true"]];
                for (const [name, email, age, score, active] of people) {
                    assert.deepStrictEqual(await call("insertRow", { target, values: { id: { mode: "default" }, name: { mode: "value", value: name }, email: { mode: "value", value: email }, age: { mode: "value", value: age }, score: { mode: "value", value: score }, active: { mode: "value", value: active }, meta: { mode: "value", value: "{\"tags\":[\"a\"]}" }, born: { mode: "value", value: "1990-05-17" }, created: { mode: "default" } } }), { affected: 1 });
                }
                await rejects(call("insertRow", { target, values: { name: { mode: "value", value: "Dup" }, email: { mode: "value", value: "ann@x.io" } } }), /already exists|duplicate|UNIQUE/i);
                await rejects(call("insertRow", { target, values: { name: { mode: "value", value: "X" }, age: { mode: "value", value: "old" } } }), /expects a number/);
                const page = await call("fetchPage", { request: { target, page: 1, pageSize: 2, sort: { column: "age", dir: "desc" } } });
                assert.strictEqual(page.total, 3);
                assert.deepStrictEqual(page.rows.map(r => r.name), ["Cy 50%", "Ann"]);
                assert.strictEqual(String(page.rows[1].born).slice(0, 10), "1990-05-17", "dates round-trip without a time-zone shift");
                const page2 = await call("fetchPage", { request: { target, page: 2, pageSize: 2, sort: { column: "age", dir: "desc" } } });
                assert.deepStrictEqual(page2.rows.map(r => r.name), ["Bob"]);
                const searched = await call("fetchPage", { request: { target, page: 1, pageSize: 10, search: "50%" } });
                assert.deepStrictEqual(searched.rows.map(r => r.name), ["Cy 50%"]);
                const filtered = await call("fetchPage", { request: { target, page: 1, pageSize: 10, filters: [{ column: "age", op: "gte", value: "18" }, { column: "name", op: "starts", value: "a" }] } });
                assert.deepStrictEqual(filtered.rows.map(r => r.name), ["Ann"]);
                const inList = await call("fetchPage", { request: { target, page: 1, pageSize: 10, filters: [{ column: "email", op: "in", value: "bob@x.io, cy@x.io" }], sort: { column: "name", dir: "asc" } } });
                assert.deepStrictEqual(inList.rows.map(r => r.name), ["Bob", "Cy 50%"]);
                const ann = filtered.rows[0];
                assert.deepStrictEqual(await call("updateRow", { target, key: { id: ann.id }, values: { age: { mode: "value", value: "32" }, score: { mode: "null" }, active: { mode: "value", value: "false" } } }), { affected: 1 });
                const after = await call("fetchPage", { request: { target, page: 1, pageSize: 10, filters: [{ column: "id", op: "eq", value: String(ann.id) }] } });
                assert.strictEqual(Number(after.rows[0].age), 32);
                assert.strictEqual(after.rows[0].score, null);
                assert.ok(after.rows[0].active === false || after.rows[0].active === 0);
                assert.deepStrictEqual(await call("deleteRows", { target, keys: [{ id: ann.id }] }), { affected: 1 });
                // Tables without a primary key: Postgres edits through ctid; the others are read-only.
                const nopk = { database, schema, object: `${t}_nopk` };
                await call("runQuery", { database, text: `INSERT INTO ${t}_nopk (msg, level) VALUES ('boot', 'info'), ('boot', 'info')` });
                const logs = await call("fetchPage", { request: { target: nopk, page: 1, pageSize: 10 } });
                if (kind === "postgres") {
                    assert.strictEqual(logs.keyStrategy, "ctid");
                    await call("updateRow", { target: nopk, key: { __ctid: logs.rows[0].__ctid }, values: { level: { mode: "value", value: "debug" } } });
                    const levels = await call("runQuery", { database, text: `SELECT level FROM ${t}_nopk ORDER BY level` });
                    assert.deepStrictEqual(levels.rows.map(r => r.level), ["debug", "info"]);
                }
                else {
                    assert.match(logs.readOnly ?? "", /no primary key/);
                    await rejects(call("deleteRows", { target: nopk, keys: [{ msg: "boot" }] }), /primary key/);
                }
                const v = await call("fetchPage", { request: { target: { database, schema, object: `${t}_v` }, page: 1, pageSize: 10 } });
                assert.match(v.readOnly ?? "", /Views/);
                // Console: rows, affected counts, syntax errors, a confirmed destructive statement.
                const sel = await call("runQuery", { database, schema, text: `SELECT name FROM ${t} ORDER BY name` });
                assert.deepStrictEqual(sel.rows.map(r => r.name), ["Bob", "Cy 50%"]);
                const upd = await call("runQuery", { database, text: `UPDATE ${t} SET age = age + 1 WHERE age < 100` });
                assert.strictEqual(upd.affected, 2);
                await rejects(call("runQuery", { database, text: `SELEC * FROM ${t}` }), /syntax|near/i);
                const asked = ui.asked.length;
                await call("runQuery", { database, text: `DELETE FROM ${t} WHERE name = 'Bob'` });
                assert.strictEqual(ui.asked.length, asked + 1, "the DELETE asked first");
                await call("truncateObject", { target });
                assert.strictEqual((await call("fetchPage", { request: { target, page: 1, pageSize: 10 } })).total, 0);
                // Read-only connections block console writes.
                const ro = await open(url, true);
                await rejects(ro.call("runQuery", { database, text: `DELETE FROM ${t}` }), /read-only/);
                if (kind === "postgres") {
                    // A write hidden inside a function passes the statement check, so the server session itself is read-only.
                    await call("runQuery", { database, text: `CREATE FUNCTION ${t}_wipe() RETURNS bigint LANGUAGE sql AS $$ WITH d AS (DELETE FROM ${t} RETURNING 1) SELECT count(*) FROM d $$` });
                    await call("insertRow", { target, values: { name: { mode: "value", value: "Kept" } } });
                    await rejects(ro.call("runQuery", { database, text: `SELECT ${t}_wipe()` }), /read-only transaction/);
                    assert.strictEqual((await call("fetchPage", { request: { target, page: 1, pageSize: 10 } })).total, 1, "nothing was deleted");
                    await call("runQuery", { database, text: `DROP FUNCTION ${t}_wipe()` });
                }
                await ro.service.dispose();
                // A wrong password fails cleanly and never echoes the attempted password.
                if (spec.password || kind !== "mysql") {
                    const bad = await open(withPassword(url, "WrongPass_9z"));
                    const err = await rejects(bad.call("connect"), /./);
                    assert.ok(!`${err.message} ${err.hint}`.includes("WrongPass_9z"), err.message);
                    await bad.service.dispose();
                }
            }
            finally {
                for (const name of [`${t}_v`])
                    await call("runQuery", { database: spec.database || undefined, text: `DROP VIEW ${name}` }).catch(() => undefined);
                for (const name of [t, `${t}_nopk`])
                    await call("runQuery", { database: spec.database || undefined, text: `DROP TABLE ${name}` }).catch(() => undefined);
                await service.dispose();
            }
        });
        (0, run_unit_tests_1.test)("an unreachable port fails fast with a clear message", async () => {
            const spec = (0, connection_string_1.parseConnection)(url);
            const dead = kind === "sqlserver" ? url.replace(/(Server=[^;,]+)(,\d+)?/i, "$1,1").replace(/(sqlserver:\/\/[^:;/]+)(:\d+)?/i, "$1:1") : url.replace(`:${spec.port}`, ":1");
            const { service, call } = await open(dead);
            const started = Date.now();
            await rejects(call("connect"), /refused|reach|timed out|closed|connect/i);
            assert.ok(Date.now() - started < 20000);
            await service.dispose();
        });
    });
}
(0, run_unit_tests_1.suite)("database live: mongodb", () => {
    const url = process.env.DEVSNIP_TEST_MONGODB_URL;
    if (!url) {
        (0, run_unit_tests_1.test)("skipped (set DEVSNIP_TEST_MONGODB_URL)", () => undefined);
        return;
    }
    (0, run_unit_tests_1.test)("browses, filters and edits documents, and runs shell commands", async () => {
        const { service, call } = await open(url);
        const coll = `devsnip_test_${Date.now().toString(36)}`;
        const database = (0, connection_string_1.parseConnection)(url).database || "test";
        try {
            await call("connect");
            await call("createCollection", { database, name: coll });
            const target = { database, object: coll };
            await call("runQuery", { database, text: `db.${coll}.insertMany([{ name: "Ann", age: 31, tags: ["a"], joined: ISODate("2024-01-02T00:00:00Z") }, { name: "Bob", age: 17 }, { name: "Cy 50%", age: 45, nested: { x: 1 } }])` });
            const objects = await call("listObjects", { database });
            assert.ok(objects.some(o => o.name === coll && o.type === "collection"));
            const fields = await call("describe", { target });
            assert.strictEqual(fields[0].name, "_id");
            assert.ok(fields.some(f => f.name === "nested" && f.presence < 1));
            const page = await call("fetchPage", { request: { target, page: 1, pageSize: 2, sort: { column: "age", dir: "desc" } } });
            assert.strictEqual(page.total, 3);
            assert.deepStrictEqual(page.rows.map(r => r.name), ["Cy 50%", "Ann"]);
            assert.ok(page.rows[1]._id.$oid, "ObjectIds travel as Extended JSON");
            assert.deepStrictEqual(page.rows[1].joined.$date, "2024-01-02T00:00:00Z");
            const q = await call("fetchPage", { request: { target, page: 1, pageSize: 10, query: "{ age: { $gte: 18 } }", search: "ann" } });
            assert.deepStrictEqual(q.rows.map(r => r.name), ["Ann"]);
            const ruled = await call("fetchPage", { request: { target, page: 1, pageSize: 10, filters: [{ column: "age", op: "lt", value: "40" }], sort: { column: "name", dir: "asc" } } });
            assert.deepStrictEqual(ruled.rows.map(r => r.name), ["Ann", "Bob"]);
            await rejects(call("fetchPage", { request: { target, page: 1, pageSize: 10, query: "{ age: " } }), /Unexpected end|Expected/);
            const ann = q.rows[0];
            const edited = { ...ann, age: 32, email: "ann@x.io" };
            delete edited.tags;
            await call("updateRow", { target, key: { _id: ann._id }, values: { $document: { mode: "value", value: JSON.stringify(edited) } } });
            const byId = await call("fetchPage", { request: { target, page: 1, pageSize: 10, filters: [{ column: "_id", op: "eq", value: ann._id.$oid }] } });
            assert.strictEqual(byId.rows[0].age, 32);
            assert.ok(!("tags" in byId.rows[0]), "the document was replaced, not merged");
            await rejects(call("updateRow", { target, key: { _id: ann._id }, values: { $document: { mode: "value", value: JSON.stringify({ ...edited, _id: { $oid: "000000000000000000000000" } }) } } }), /_id cannot be changed/);
            await call("insertRow", { target, values: { $document: { mode: "value", value: `{ name: "Dee", _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), at: new Date("2024-05-05") }` } } });
            await rejects(call("insertRow", { target, values: { $document: { mode: "value", value: `{ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718") }` } } }), /already exists|duplicate/i);
            assert.deepStrictEqual(await call("deleteRows", { target, keys: [{ _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" } }, { _id: ann._id }] }), { affected: 2 });
            const agg = await call("runQuery", { database, text: `db.${coll}.aggregate([{ $group: { _id: null, avg: { $avg: "$age" } } }])` });
            assert.strictEqual(agg.rows[0].avg, 31);
            const count = await call("runQuery", { database, text: `db.getCollection("${coll}").countDocuments({})` });
            assert.match(count.message ?? "", /^2 documents/);
            const upd = await call("runQuery", { database, text: `db.${coll}.updateMany({ age: { $lt: 100 } }, { $inc: { age: 1 } })` });
            assert.match(upd.message ?? "", /Matched 2, modified 2/);
            const asked = ui.asked.length;
            await call("runQuery", { database, text: `db.${coll}.deleteMany({ name: "Bob" })` });
            assert.strictEqual(ui.asked.length, asked + 1);
            await rejects(call("runQuery", { database, text: `db.${coll}.find({}).forEach(printjson)` }), /not a value|not supported/);
            const ro = await open(url, true);
            await rejects(ro.call("runQuery", { database, text: `db.${coll}.insertOne({ a: 1 })` }), /read-only/);
            await ro.service.dispose();
            await call("truncateObject", { target });
            assert.strictEqual((await call("fetchPage", { request: { target, page: 1, pageSize: 10 } })).total, 0);
            await call("dropObject", { target });
            assert.ok(!(await call("listObjects", { database })).some(o => o.name === coll));
        }
        finally {
            await call("runQuery", { database, text: `db.${coll}.drop()` }).catch(() => undefined);
            await service.dispose();
        }
    });
});
(0, run_unit_tests_1.suite)("database live: redis", () => {
    const url = process.env.DEVSNIP_TEST_REDIS_URL;
    if (!url) {
        (0, run_unit_tests_1.test)("skipped (set DEVSNIP_TEST_REDIS_URL)", () => undefined);
        return;
    }
    (0, run_unit_tests_1.test)("browses keys and edits every value type", async () => {
        const { service, call } = await open(url);
        const p = `devsnip_test_${Date.now().toString(36)}`;
        const database = (0, connection_string_1.parseConnection)(url).database || "0";
        const target = { database, object: "keys" };
        try {
            await call("connect");
            assert.ok((await call("listDatabases")).databases.includes(database));
            const values = [
                ["string", `${p}:greeting`, "hello world"],
                ["hash", `${p}:user:1`, JSON.stringify({ name: "Ann", age: 31 })],
                ["list", `${p}:queue`, JSON.stringify(["a", "b", "c"])],
                ["set", `${p}:tags`, JSON.stringify(["x", "y"])],
                ["zset", `${p}:board`, JSON.stringify([{ member: "ann", score: 10 }, { member: "bob", score: 5 }])]
            ];
            for (const [type, key, value] of values)
                await call("insertRow", { target, values: { key: { mode: "value", value: key }, type: { mode: "value", value: type }, value: { mode: "value", value }, ...(type === "string" ? { ttl: { mode: "value", value: "300" } } : {}) } });
            await rejects(call("insertRow", { target, values: { key: { mode: "value", value: `${p}:greeting` }, type: { mode: "value", value: "string" }, value: { mode: "value", value: "x" } } }), /already exists/);
            await rejects(call("insertRow", { target, values: { key: { mode: "value", value: `${p}:bad` }, type: { mode: "value", value: "hash" }, value: { mode: "value", value: "[1]" } } }), /at least one field/);
            const page = await call("fetchPage", { request: { target, page: 1, pageSize: 50, query: `${p}:*` } });
            assert.strictEqual(page.total, 5);
            const byKey = Object.fromEntries(page.rows.map(r => [r.key, r]));
            assert.strictEqual(byKey[`${p}:greeting`].type, "string");
            assert.ok(Number(byKey[`${p}:greeting`].ttl) > 0 && Number(byKey[`${p}:greeting`].ttl) <= 300);
            assert.strictEqual(byKey[`${p}:queue`].size, 3);
            const hashes = await call("fetchPage", { request: { target, page: 1, pageSize: 50, query: `${p}:*`, keyType: "hash" } });
            assert.deepStrictEqual(hashes.rows.map(r => r.key), [`${p}:user:1`]);
            const searched = await call("fetchPage", { request: { target, page: 1, pageSize: 50, search: `${p}:tag` } });
            assert.deepStrictEqual(searched.rows.map(r => r.key), [`${p}:tags`]);
            const hash = await call("readKey", { database, key: `${p}:user:1` });
            assert.deepStrictEqual(hash.value, { name: "Ann", age: "31" });
            await call("updateRow", { target, key: { key: `${p}:user:1` }, values: { value: { mode: "value", value: JSON.stringify({ name: "Ann", age: 32 }) }, ttl: { mode: "value", value: "120" } } });
            const updated = await call("readKey", { database, key: `${p}:user:1` });
            assert.deepStrictEqual(updated.value, { name: "Ann", age: "32" });
            assert.ok(updated.ttlMs > 0);
            // Rewriting a string keeps its remaining TTL.
            await call("updateRow", { target, key: { key: `${p}:greeting` }, values: { value: { mode: "value", value: "hi" } } });
            const greeting = await call("readKey", { database, key: `${p}:greeting` });
            assert.strictEqual(greeting.value, "hi");
            assert.ok(greeting.ttlMs > 0, "TTL kept");
            await call("updateRow", { target, key: { key: `${p}:greeting` }, values: { ttl: { mode: "value", value: "-1" } } });
            assert.strictEqual((await call("readKey", { database, key: `${p}:greeting` })).ttlMs, -1);
            const board = await call("readKey", { database, key: `${p}:board` });
            assert.deepStrictEqual(board.value, [{ member: "bob", score: 5 }, { member: "ann", score: 10 }]);
            const get = await call("runQuery", { database, text: `GET ${p}:greeting` });
            assert.strictEqual(get.message, "hi");
            const multi = await call("runQuery", { database, text: `SET "${p}:spaced key" "a b c"\nGET "${p}:spaced key"` });
            assert.strictEqual(multi.rows[1].reply, "a b c");
            const hgetall = await call("runQuery", { database, text: `HGETALL ${p}:user:1` });
            assert.deepStrictEqual(hgetall.columns, ["field", "value"]);
            await rejects(call("runQuery", { database, text: "SELECT 1" }), /not available/);
            await rejects(call("runQuery", { database, text: "NOTACOMMAND x" }), /unknown command|ERR/i);
            const ro = await open(url, true);
            await rejects(ro.call("runQuery", { database, text: `SET ${p}:x 1` }), /read-only/);
            assert.ok(await ro.call("runQuery", { database, text: `TTL ${p}:board` }));
            await ro.service.dispose();
            const keys = page.rows.map(r => ({ key: r.key })).concat([{ key: `${p}:spaced key` }]);
            assert.deepStrictEqual(await call("deleteRows", { target, keys }), { affected: 6 });
        }
        finally {
            await call("runQuery", { database, text: `EVAL "for _,k in ipairs(redis.call('KEYS', ARGV[1])) do redis.call('DEL', k) end" 0 ${p}:*` }).catch(() => undefined);
            await service.dispose();
        }
    });
});
//# sourceMappingURL=database-live.unit.js.map