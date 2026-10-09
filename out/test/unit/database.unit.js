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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vm = __importStar(require("vm"));
const connection_string_1 = require("../../database/connection-string");
const sql_builder_1 = require("../../database/sql-builder");
const mongo_shell_1 = require("../../database/mongo-shell");
const redis_1 = require("../../database/adapters/redis");
const sqlite_1 = require("../../database/adapters/sqlite");
const store_1 = require("../../database/store");
const service_1 = require("../../database/service");
const page_1 = require("../../database/page");
const values_1 = require("../../database/values");
const types_1 = require("../../database/types");
const layout_1 = require("../../toolkits/layout");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const col = (name, dataType, extra = {}) => ({
    name, dataType, category: (0, sql_builder_1.categorize)(dataType), nullable: true, primaryKey: false, autoIncrement: false, editable: true, ...extra
});
const USERS = [col("id", "integer", { primaryKey: true, autoIncrement: true, nullable: false }), col("name", "text"), col("age", "integer"), col("meta", "jsonb"), col("active", "boolean"), col("avatar", "bytea", { editable: false })];
class MemoryState {
    constructor() {
        this.data = new Map();
    }
    get(key, fallback) { return (this.data.has(key) ? this.data.get(key) : fallback); }
    update(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); return Promise.resolve(); }
}
class MemorySecrets {
    constructor() {
        this.data = new Map();
    }
    get(key) { return Promise.resolve(this.data.get(key)); }
    store(key, value) { this.data.set(key, value); return Promise.resolve(); }
    delete(key) { this.data.delete(key); return Promise.resolve(); }
}
function fakeUi(answers = {}) {
    const asked = [];
    return {
        asked,
        confirm: async (message) => { asked.push(message); return answers.confirm ?? false; },
        confirmByTyping: async (message) => { asked.push(message); return answers.typed ?? false; },
        pickSqliteFile: async () => undefined,
        copy: async () => undefined,
        openDocument: async () => undefined,
        baseDir: () => os.tmpdir()
    };
}
/** An adapter that records calls, for testing the service's rules without a database. */
function fakeAdapter(overrides = {}) {
    const calls = [];
    const result = { columns: [], rows: [], elapsedMs: 1 };
    return {
        kind: "postgres",
        calls,
        connect: async () => ({ version: "PostgreSQL 16" }),
        close: async () => undefined,
        ping: async () => undefined,
        listDatabases: async () => ["app"],
        listSchemas: async () => ["public"],
        listObjects: async () => [{ name: "users", type: "table" }],
        describe: async () => USERS,
        fetchPage: async () => ({ columns: USERS, rows: [], total: 0, keyColumns: ["id"], keyStrategy: "primary", elapsedMs: 1 }),
        insert: async () => { calls.push("insert"); return 1; },
        update: async () => { calls.push("update"); return 1; },
        remove: async (_t, keys) => { calls.push("remove"); return keys.length; },
        runQuery: async (text) => { calls.push(`run:${text}`); return result; },
        drop: async () => { calls.push("drop"); },
        truncate: async () => { calls.push("truncate"); },
        classify: text => (0, sql_builder_1.classifyStatements)(text),
        invalidate: () => undefined,
        ...overrides
    };
}
async function serviceWith(adapter, ui, readOnly = false) {
    const state = new MemoryState();
    const secrets = new MemorySecrets();
    const store = new store_1.ConnectionStore(state, secrets);
    const service = new service_1.DatabaseService(store, ui, () => undefined, () => adapter);
    const profile = await store.save({ name: "Test", connectionString: "postgresql://admin:Hunter2!pw@db.example.com:5432/app?sslmode=require", readOnly });
    return { service, store, state, secrets, id: profile.id };
}
async function rejects(promise, pattern) {
    try {
        await promise;
    }
    catch (error) {
        assert.ok(error instanceof types_1.DbError, `expected a DbError, got ${error}`);
        assert.match(error.message, pattern);
        return error;
    }
    throw new Error(`expected rejection matching ${pattern}`);
}
(0, run_unit_tests_1.suite)("database: connection strings", () => {
    (0, run_unit_tests_1.test)("detects every supported database from its connection string", () => {
        const cases = [
            ["postgres://u:p@h/db", "postgres"], ["postgresql://h", "postgres"], ["jdbc:postgresql://h:5432/db", "postgres"],
            ["DATABASE_URL=\"postgresql://u:p@h/db\"", "postgres"],
            ["mysql://root@localhost/app", "mysql"], ["mariadb://h/db", "mysql"],
            ["Server=localhost,1433;Database=app;User Id=sa;Password=x", "sqlserver"], ["sqlserver://h:1433;database=a", "sqlserver"], ["mssql://u:p@h/db", "sqlserver"],
            ["sqlite:///tmp/x.db", "sqlite"], ["file:./dev.db", "sqlite"], ["/Users/me/app.sqlite3", "sqlite"],
            ["mongodb://h:27017/app", "mongodb"], ["mongodb+srv://u:p@cluster0.x.mongodb.net/app", "mongodb"],
            ["redis://localhost:6379/0", "redis"], ["rediss://:pw@h:6380", "redis"]
        ];
        for (const [input, kind] of cases)
            assert.strictEqual((0, connection_string_1.detectKind)(input), kind, input);
        assert.strictEqual((0, connection_string_1.detectKind)("cassandra://h"), undefined);
        assert.strictEqual((0, connection_string_1.detectKind)("hello world"), undefined);
    });
    (0, run_unit_tests_1.test)("parses URL credentials, ports, TLS and percent-encoded passwords", () => {
        const pg = (0, connection_string_1.parseConnection)("postgresql://dev:s3cr3t%3Ap%40ss@db.internal:6543/app?sslmode=require&application_name=x");
        assert.deepStrictEqual([pg.kind, pg.host, pg.port, pg.user, pg.password, pg.database, pg.ssl], ["postgres", "db.internal", 6543, "dev", "s3cr3t:p@ss", "app", true]);
        assert.strictEqual(pg.options.application_name, "x");
        const raw = (0, connection_string_1.parseConnection)("mysql://root:p@ss@word@localhost/shop");
        assert.strictEqual(raw.password, "p@ss@word", "an unencoded @ in the password still parses");
        assert.strictEqual(raw.port, 3306);
        assert.strictEqual((0, connection_string_1.parseConnection)("redis://localhost").port, 6379);
        assert.strictEqual((0, connection_string_1.parseConnection)("rediss://h").ssl, true);
        assert.strictEqual((0, connection_string_1.parseConnection)("postgresql://h/db?sslmode=disable").ssl, false);
        const mongo = (0, connection_string_1.parseConnection)("mongodb://a:1,b:2,c:3/app?replicaSet=rs0");
        assert.strictEqual(mongo.host, "a:1,b:2,c:3");
        assert.strictEqual(mongo.url, "mongodb://a:1,b:2,c:3/app?replicaSet=rs0");
    });
    (0, run_unit_tests_1.test)("parses SQL Server ADO, JDBC and URL forms", () => {
        const ado = (0, connection_string_1.parseConnection)("Server=tcp:sql.example.com,1444;Initial Catalog=sales;User ID=app;Password={a;b}}c};Encrypt=True;TrustServerCertificate=false");
        assert.deepStrictEqual([ado.host, ado.port, ado.database, ado.user, ado.password, ado.ssl], ["sql.example.com", 1444, "sales", "app", "a;b}c", true]);
        const jdbc = (0, connection_string_1.parseConnection)("jdbc:sqlserver://localhost:1433;databaseName=app;user=sa;password=Pass123;encrypt=false");
        assert.deepStrictEqual([jdbc.host, jdbc.port, jdbc.database, jdbc.user, jdbc.password, jdbc.ssl], ["localhost", 1433, "app", "sa", "Pass123", false]);
        const url = (0, connection_string_1.parseConnection)("mssql://sa:pw@localhost:1433/app");
        assert.deepStrictEqual([url.kind, url.host, url.database, url.password], ["sqlserver", "localhost", "app", "pw"]);
        const instance = (0, connection_string_1.parseConnection)("Server=.\\SQLEXPRESS;Database=x;User Id=a;Password=b");
        assert.strictEqual(instance.host, ".\\SQLEXPRESS");
    });
    (0, run_unit_tests_1.test)("resolves SQLite paths and rejects in-memory databases", () => {
        assert.strictEqual((0, connection_string_1.parseConnection)("sqlite:///var/data/app.db").filePath, path.normalize("/var/data/app.db"));
        assert.strictEqual((0, connection_string_1.parseConnection)("file:./dev.db", "/work/proj").filePath, path.resolve("/work/proj", "dev.db"));
        assert.strictEqual((0, connection_string_1.parseConnection)("sqlite:~/x.db").filePath, path.join(os.homedir(), "x.db"));
        assert.throws(() => (0, connection_string_1.parseConnection)("sqlite::memory:"), /file/);
        assert.throws(() => (0, connection_string_1.parseConnection)("file:./dev.db"), /workspace/);
    });
    (0, run_unit_tests_1.test)("rejects malformed and unsupported strings with helpful messages", () => {
        assert.throws(() => (0, connection_string_1.parseConnection)(""), /Enter a connection string/);
        assert.throws(() => (0, connection_string_1.parseConnection)("cassandra://h"), /cassandra:\/\/ databases are not supported/);
        assert.throws(() => (0, connection_string_1.parseConnection)("postgresql://h:99999/db"), /out of range/);
        assert.throws(() => (0, connection_string_1.parseConnection)("mongodb+srv://c.example.net:27017/db"), /cannot include a port/);
        assert.throws(() => (0, connection_string_1.parseConnection)("redis://h/users"), /numbers/);
        assert.throws(() => (0, connection_string_1.parseConnection)("Database=x;User Id=a"), /Server/);
    });
    (0, run_unit_tests_1.test)("masks the password and restores it when the mask is saved back", () => {
        const original = "postgresql://dev:s3cr3t%3Ap%40ss@db:5432/app";
        const masked = (0, connection_string_1.maskConnectionString)(original);
        assert.strictEqual(masked, `postgresql://dev:${connection_string_1.PASSWORD_MASK}@db:5432/app`);
        assert.ok((0, connection_string_1.hasMaskedPassword)(masked));
        assert.strictEqual((0, connection_string_1.restoreMaskedPassword)(masked, original), original);
        // The user changed the database but kept the password.
        assert.strictEqual((0, connection_string_1.restoreMaskedPassword)(masked.replace("/app", "/other"), original), "postgresql://dev:s3cr3t%3Ap%40ss@db:5432/other");
        // A newly typed password wins.
        assert.strictEqual((0, connection_string_1.restoreMaskedPassword)("postgresql://dev:new@db/app", original), "postgresql://dev:new@db/app");
        const ado = "Server=h;Database=d;User Id=u;Password={x;y}};Encrypt=false";
        const maskedAdo = (0, connection_string_1.maskConnectionString)(ado);
        assert.ok(!maskedAdo.includes("x;y"), maskedAdo);
        assert.strictEqual((0, connection_string_1.restoreMaskedPassword)(maskedAdo, ado), ado);
        assert.strictEqual((0, connection_string_1.maskConnectionString)("mongodb://h:27017/app"), "mongodb://h:27017/app");
        assert.strictEqual((0, connection_string_1.maskConnectionString)("redis://:topsecret@h:6379/0"), `redis://:${connection_string_1.PASSWORD_MASK}@h:6379/0`);
    });
    (0, run_unit_tests_1.test)("redacts credentials from driver errors and maps common failures", () => {
        const raw = "postgresql://admin:Hunter2!pw@db.example.com/app";
        const secrets = (0, connection_string_1.secretsOf)(raw, (0, connection_string_1.parseConnection)(raw));
        const leaked = (0, connection_string_1.friendlyError)(new Error(`connect failed for ${raw} with password Hunter2!pw`), secrets);
        assert.ok(!leaked.message.includes("Hunter2!pw"), leaked.message);
        assert.ok(!(0, connection_string_1.redact)("mysql://root:abc123@h/db", []).includes("abc123"));
        assert.ok(!(0, connection_string_1.redact)("Password=abc123;User=x", []).includes("abc123"));
        assert.match((0, connection_string_1.friendlyError)(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })).message, /refused/);
        assert.match((0, connection_string_1.friendlyError)(Object.assign(new Error("password authentication failed for user \"x\""), { code: "28P01" })).message, /Authentication failed/);
        assert.match((0, connection_string_1.friendlyError)(Object.assign(new Error("relation \"nope\" does not exist"), { code: "42P01" })).hint ?? "", /Refresh/);
        assert.match((0, connection_string_1.friendlyError)(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" })).hint ?? "", /already exists/);
    });
});
(0, run_unit_tests_1.suite)("database: SQL builder", () => {
    (0, run_unit_tests_1.test)("quotes identifiers so names can never break out of the statement", () => {
        assert.strictEqual((0, sql_builder_1.quoteIdent)('a"; DROP TABLE x; --', "postgres"), '"a""; DROP TABLE x; --"');
        assert.strictEqual((0, sql_builder_1.quoteIdent)("a`b", "mysql"), "`a``b`");
        assert.strictEqual((0, sql_builder_1.quoteIdent)("a]b", "sqlserver"), "[a]]b]");
        assert.throws(() => (0, sql_builder_1.quoteIdent)("", "postgres"));
    });
    (0, run_unit_tests_1.test)("builds a parameterised page query with search, filters, sort and paging per dialect", () => {
        const req = { target: { database: "app", schema: "public", object: "users" }, page: 3, pageSize: 25, sort: { column: "name", dir: "desc" }, filters: [{ column: "age", op: "gte", value: "21" }, { column: "name", op: "contains", value: "50%_" }], search: "ann" };
        const pg = (0, sql_builder_1.buildSelect)(req, USERS, "primary", "postgres");
        assert.match(pg.select.sql, /^SELECT "public"\."users"\.\* FROM "public"\."users" WHERE "age" >= \$1 AND CAST\("name" AS TEXT\) ILIKE \$2 ESCAPE '!' AND \(/);
        assert.match(pg.select.sql, /ORDER BY "name" DESC LIMIT 25 OFFSET 50$/);
        assert.strictEqual(pg.select.params[0], 21, "numbers are coerced for numeric columns");
        assert.strictEqual(pg.select.params[1], "%50!%!_%", "LIKE wildcards in user text are escaped");
        assert.ok(!pg.select.sql.includes("avatar"), "binary columns are not searched");
        assert.deepStrictEqual(pg.count.params, pg.select.params);
        const ms = (0, sql_builder_1.buildSelect)({ ...req, sort: undefined }, USERS, "primary", "sqlserver");
        assert.match(ms.select.sql, /ORDER BY \[id\] OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY$/);
        assert.match(ms.select.sql, /@p1/);
        const noPk = (0, sql_builder_1.buildSelect)({ ...req, sort: undefined, filters: [], search: "" }, USERS.map(c => ({ ...c, primaryKey: false })), "none", "sqlserver");
        assert.match(noPk.select.sql, /ORDER BY \(SELECT NULL\)/);
        const my = (0, sql_builder_1.buildSelect)(req, USERS, "primary", "mysql");
        assert.match(my.select.sql, /FROM `app`\.`users`/);
        assert.match(my.select.sql, /CAST\(`name` AS CHAR\) LIKE \?/);
        const lite = (0, sql_builder_1.buildSelect)({ ...req, target: { database: "main", object: "users" }, filters: [], search: "" }, USERS, "rowid", "sqlite");
        assert.match(lite.select.sql, /SELECT "users"\.\*, rowid AS "__rowid" FROM "users"/);
        const ctid = (0, sql_builder_1.buildSelect)({ ...req, filters: [], search: "" }, USERS, "ctid", "postgres");
        assert.match(ctid.select.sql, /ctid::text AS "__ctid"/);
    });
    (0, run_unit_tests_1.test)("refuses unknown columns and operators instead of quoting them into SQL", () => {
        const base = { target: { object: "users" }, page: 1, pageSize: 10 };
        assert.throws(() => (0, sql_builder_1.buildSelect)({ ...base, sort: { column: "password", dir: "asc" } }, USERS, "primary", "postgres"), /does not exist/);
        assert.throws(() => (0, sql_builder_1.buildSelect)({ ...base, filters: [{ column: "x", op: "eq", value: "1" }] }, USERS, "primary", "postgres"), /does not exist/);
        assert.throws(() => (0, sql_builder_1.buildSelect)({ ...base, filters: [{ column: "age", op: "drop", value: "1" }] }, USERS, "primary", "postgres"), /operator/);
        assert.throws(() => (0, sql_builder_1.buildSelect)({ ...base, filters: [{ column: "age", op: "eq", value: "abc" }] }, USERS, "primary", "postgres"), /expects a number/);
    });
    (0, run_unit_tests_1.test)("builds INSERT, UPDATE and DELETE with bound values and key-only WHERE clauses", () => {
        const t = { schema: "public", object: "users" };
        const ins = (0, sql_builder_1.buildInsert)(t, USERS, { id: { mode: "default" }, name: { mode: "value", value: "O'Brien" }, age: { mode: "null" }, meta: { mode: "value", value: "{\"a\":1}" }, active: { mode: "value", value: "yes" } }, "postgres");
        assert.strictEqual(ins.sql, 'INSERT INTO "public"."users" ("name", "age", "meta", "active") VALUES ($1, $2, $3, $4)');
        assert.deepStrictEqual(ins.params, ["O'Brien", null, "{\"a\":1}", true]);
        assert.strictEqual((0, sql_builder_1.buildInsert)(t, USERS, { id: { mode: "default" } }, "mysql").sql, "INSERT INTO `users` () VALUES ()");
        const up = (0, sql_builder_1.buildUpdate)(t, USERS, { id: 7 }, "primary", { name: { mode: "value", value: "x" }, active: { mode: "value", value: "0" } }, "mysql");
        assert.strictEqual(up.sql, "UPDATE `users` SET `name` = ?, `active` = ? WHERE `id` = ?");
        assert.deepStrictEqual(up.params, ["x", 0, 7]);
        const del = (0, sql_builder_1.buildDelete)(t, USERS, [{ id: 1 }, { id: 2 }], "primary", "sqlserver");
        assert.strictEqual(del.sql, "DELETE FROM [public].[users] WHERE ([id] = @p1) OR ([id] = @p2)");
        assert.strictEqual((0, sql_builder_1.buildDelete)(t, USERS, [{ __rowid: 5 }], "rowid", "sqlite").sql, 'DELETE FROM "users" WHERE (rowid = ?)');
        assert.throws(() => (0, sql_builder_1.buildDelete)(t, USERS, [{ __ctid: "1; DROP" }], "ctid", "postgres"), /row id/);
        assert.throws(() => (0, sql_builder_1.buildDelete)(t, USERS, [{ name: "x" }], "primary", "postgres"), /key column id is missing/);
        assert.throws(() => (0, sql_builder_1.buildUpdate)(t, USERS, { id: 1 }, "primary", { avatar: { mode: "value", value: "x" } }, "postgres"), /read-only/);
        assert.throws(() => (0, sql_builder_1.buildUpdate)(t, USERS, { id: 1 }, "primary", { id: { mode: "default" } }, "sqlite"), /SQLite cannot reset/);
        assert.throws(() => (0, sql_builder_1.coerceInput)({ mode: "value", value: "{bad" }, USERS[3], "postgres"), /valid JSON/);
        assert.throws(() => (0, sql_builder_1.coerceInput)({ mode: "null" }, USERS[0], "postgres"), /cannot be NULL/);
        assert.strictEqual((0, sql_builder_1.coerceInput)({ mode: "value", value: "9007199254740993" }, USERS[2], "postgres"), "9007199254740993", "big integers stay exact");
    });
    (0, run_unit_tests_1.test)("decides how rows are identified, and makes unsafe tables read-only", () => {
        assert.deepStrictEqual((0, sql_builder_1.keyStrategyFor)(USERS, "mysql", false, false).keyColumns, ["id"]);
        const noPk = USERS.map(c => ({ ...c, primaryKey: false }));
        assert.strictEqual((0, sql_builder_1.keyStrategyFor)(noPk, "sqlite", false, true).strategy, "rowid");
        assert.strictEqual((0, sql_builder_1.keyStrategyFor)(noPk, "sqlite", false, false).strategy, "none");
        assert.strictEqual((0, sql_builder_1.keyStrategyFor)(noPk, "postgres", false, false).strategy, "ctid");
        assert.match((0, sql_builder_1.keyStrategyFor)(noPk, "mysql", false, false).readOnly ?? "", /no primary key/);
        assert.match((0, sql_builder_1.keyStrategyFor)(USERS, "postgres", true, false).readOnly ?? "", /Views/);
    });
    (0, run_unit_tests_1.test)("maps column types to editor categories", () => {
        const cases = [["integer", "number"], ["bigint", "number"], ["numeric(10,2)", "number"], ["interval", "date"], ["timestamp with time zone", "date"], ["tinyint(1)", "boolean"], ["bit", "boolean"], ["jsonb", "json"], ["varbinary(max)", "binary"], ["character varying(255)", "text"], ["uuid", "text"], ["point", "other"]];
        for (const [type, category] of cases)
            assert.strictEqual((0, sql_builder_1.categorize)(type), category, type);
    });
    (0, run_unit_tests_1.test)("classifies console statements and flags destructive ones", () => {
        const s = (0, sql_builder_1.classifyStatements)("SELECT 1; -- drop table x\nDELETE FROM a WHERE id = 1; UPDATE b SET x = 1; DROP TABLE IF EXISTS c; TRUNCATE d; ALTER TABLE e DROP COLUMN f; INSERT INTO g VALUES (';')");
        assert.deepStrictEqual(s.map(x => [x.verb, x.write, !!x.danger]), [["select", false, false], ["delete", true, true], ["update", true, true], ["drop", true, true], ["truncate", true, true], ["alter", true, true], ["insert", true, false]]);
        assert.match(s[1].danger, /matching rows/);
        assert.match(s[2].danger, /every row/);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("WITH x AS (SELECT 1) SELECT * FROM x")[0].write, false);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone")[0].write, true);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("EXPLAIN ANALYZE DELETE FROM t")[0].write, true);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("EXPLAIN SELECT 1")[0].write, false);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("PRAGMA table_info(users)")[0].write, true, "PRAGMA with arguments may write");
        assert.strictEqual((0, sql_builder_1.classifyStatements)("PRAGMA user_version")[0].write, false);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("SELECT * INTO backup FROM t")[0].write, true);
        assert.strictEqual((0, sql_builder_1.classifyStatements)("CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql").length, 1, "dollar quotes hide semicolons");
        assert.strictEqual((0, sql_builder_1.classifyStatements)("select 'it''s; fine'").length, 1);
    });
});
(0, run_unit_tests_1.suite)("database: mongosh parser", () => {
    (0, run_unit_tests_1.test)("parses shell literals into Extended JSON without evaluating anything", () => {
        const value = (0, mongo_shell_1.parseShellValue)(`{ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), at: ISODate("2024-01-02T03:04:05Z"), n: NumberLong("9007199254740993"), name: /^ann/i, 'quoted key': [1, 2.5, -3, true, null], nested: { $gt: 21 }, }`);
        assert.deepStrictEqual(value, {
            _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" },
            at: { $date: "2024-01-02T03:04:05.000Z" },
            n: { $numberLong: "9007199254740993" },
            name: { $regularExpression: { pattern: "^ann", options: "i" } },
            "quoted key": [1, 2.5, -3, true, null],
            nested: { $gt: 21 }
        });
        assert.throws(() => (0, mongo_shell_1.parseShellValue)("{ a: process.exit() }"), /not a value/);
        assert.throws(() => (0, mongo_shell_1.parseShellValue)("{ a: require('fs') }"), /not supported/);
        assert.throws(() => (0, mongo_shell_1.parseShellValue)("{ a: ObjectId('xyz') }"), /24 hex/);
    });
    (0, run_unit_tests_1.test)("parses commands, chains and collection forms", () => {
        const find = (0, mongo_shell_1.parseShellCommand)(`db.users.find({ age: { $gte: 21 } }, { name: 1 }).sort({ name: -1 }).limit(5)`);
        assert.deepStrictEqual(find, { kind: "collection", collection: "users", method: "find", args: [{ age: { $gte: 21 } }, { name: 1 }], chain: [{ method: "sort", args: [{ name: -1 }] }, { method: "limit", args: [5] }] });
        assert.strictEqual((0, mongo_shell_1.parseShellCommand)(`db.getCollection("my-logs").countDocuments({})`).collection, "my-logs");
        assert.strictEqual((0, mongo_shell_1.parseShellCommand)(`db["a.b"].findOne()`).collection, "a.b");
        assert.deepStrictEqual((0, mongo_shell_1.parseShellCommand)("show collections"), { kind: "show", what: "collections" });
        assert.deepStrictEqual((0, mongo_shell_1.parseShellCommand)("db.dropDatabase();"), { kind: "db", method: "dropDatabase", args: [] });
        assert.throws(() => (0, mongo_shell_1.parseShellCommand)("db.a.find({}); db.b.drop()"), /one command at a time/);
        assert.throws(() => (0, mongo_shell_1.parseShellCommand)("users.find()"), /start with db/);
    });
    (0, run_unit_tests_1.test)("flags writes and destructive commands", () => {
        const c = (text) => (0, mongo_shell_1.classifyShellCommand)((0, mongo_shell_1.parseShellCommand)(text));
        assert.deepStrictEqual(c("db.u.find({})"), { write: false, verb: "find" });
        assert.match(c("db.u.deleteMany({})").danger, /every document/);
        assert.match(c("db.u.deleteOne({ _id: 1 })").danger, /deletes a document/);
        assert.match(c("db.u.updateMany({}, { $set: { a: 1 } })").danger, /every document/);
        assert.strictEqual(c("db.u.updateOne({ a: 1 }, { $set: { a: 2 } })").danger, undefined);
        assert.match(c("db.u.drop()").danger, /deletes the collection/);
        assert.match(c("db.dropDatabase()").danger, /whole database/);
        assert.strictEqual(c("db.u.aggregate([{ $match: {} }])").write, false);
        assert.strictEqual(c("db.u.aggregate([{ $out: 'x' }])").write, true);
        assert.throws(() => c("db.u.mapReduce()"), /not supported/);
        assert.throws(() => c("db.u.find({}).forEach()"), /not supported/);
    });
});
(0, run_unit_tests_1.suite)("database: Redis console", () => {
    (0, run_unit_tests_1.test)("tokenizes quoted arguments", () => {
        assert.deepStrictEqual((0, redis_1.tokenizeCommand)(`SET greeting "hello \\"world\\"" EX 10`), ["SET", "greeting", 'hello "world"', "EX", "10"]);
        assert.deepStrictEqual((0, redis_1.tokenizeCommand)(`HSET h 'a b' ''`), ["HSET", "h", "a b", ""]);
        assert.throws(() => (0, redis_1.tokenizeCommand)(`GET "open`), /Unterminated/);
    });
    (0, run_unit_tests_1.test)("blocks connection-changing commands and flags writes and destructive ones", () => {
        const c = (text) => (0, redis_1.classifyRedis)(text).map(x => [x.verb, x.write, !!x.danger]);
        assert.deepStrictEqual(c("GET a\nSCAN 0 MATCH * COUNT 10\nCONFIG GET maxmemory"), [["get", false, false], ["scan", false, false], ["config", false, false]]);
        assert.deepStrictEqual(c("SET a 1\nDEL a\nFLUSHDB\nCONFIG SET maxmemory 1"), [["set", true, false], ["del", true, true], ["flushdb", true, true], ["config", true, true]]);
        assert.deepStrictEqual(c("JSON.SET k $ 1"), [["json.set", true, false]], "unknown module commands count as writes");
        assert.throws(() => (0, redis_1.classifyRedis)("SELECT 2"), /not available/);
        assert.throws(() => (0, redis_1.classifyRedis)("SUBSCRIBE news"), /not available/);
        assert.throws(() => (0, redis_1.classifyRedis)("# just a comment"), /Enter a command/);
    });
});
(0, run_unit_tests_1.suite)("database: values", () => {
    (0, run_unit_tests_1.test)("encodes driver values into JSON the webview can show", () => {
        assert.strictEqual((0, values_1.encodeValue)(BigInt("9007199254740993")), "9007199254740993");
        assert.strictEqual((0, values_1.encodeValue)(BigInt(42)), 42);
        assert.strictEqual((0, values_1.encodeValue)(new Date("2024-01-02T03:04:05Z")), "2024-01-02T03:04:05.000Z");
        assert.deepStrictEqual((0, values_1.encodeValue)(Buffer.from("hi")), { __dbv: "binary", size: 2, hex: "6869" });
        assert.strictEqual((0, values_1.encodeValue)("x".repeat(30000)).__dbv, "truncated");
        assert.strictEqual((0, values_1.encodeValue)(Number.NaN), "NaN");
    });
});
(0, run_unit_tests_1.suite)("database: connection store", () => {
    (0, run_unit_tests_1.test)("keeps connection strings in secret storage and only a masked form in settings", async () => {
        const state = new MemoryState();
        const secrets = new MemorySecrets();
        const store = new store_1.ConnectionStore(state, secrets);
        const raw = "postgresql://dev:TopSecret99@db.example.com:5432/app";
        const profile = await store.save({ name: "Prod", connectionString: raw, readOnly: true });
        assert.strictEqual(profile.kind, "postgres");
        assert.ok(profile.readOnly);
        assert.ok(!JSON.stringify([...state.data.values()]).includes("TopSecret99"), "the password never reaches globalState");
        assert.strictEqual(await store.connectionString(profile.id), raw);
        // Saving the masked display back keeps the stored password.
        await store.save({ id: profile.id, name: "Prod 2", connectionString: profile.display.replace("/app", "/other") });
        assert.strictEqual(await store.connectionString(profile.id), "postgresql://dev:TopSecret99@db.example.com:5432/other");
        assert.strictEqual(store.list()[0].name, "Prod 2");
        await assert.rejects(store.save({ name: "", connectionString: raw }), /name/);
        await assert.rejects(store.save({ name: "x", connectionString: "nope://" }), /not supported|does not look/);
        await store.remove(profile.id);
        assert.strictEqual(store.list().length, 0);
        assert.strictEqual(secrets.data.size, 0, "removing a connection deletes its secret");
    });
});
(0, run_unit_tests_1.suite)("database: service rules", () => {
    (0, run_unit_tests_1.test)("never returns the password and redacts it from failures", async () => {
        const adapter = fakeAdapter({ connect: async () => { throw new Error("FATAL: password Hunter2!pw rejected for postgresql://admin:Hunter2!pw@db.example.com/app"); } });
        const { service, id } = await serviceWith(adapter, fakeUi());
        const edit = await service.handle("editConnection", { id });
        assert.ok(!edit.connectionString.includes("Hunter2!pw"));
        const detected = await service.handle("detect", { connectionString: edit.connectionString, id });
        assert.ok(!JSON.stringify(detected).includes("Hunter2!pw"));
        assert.strictEqual(detected.summary.hasPassword, true, "the masked password resolves to the stored one");
        const error = await rejects(service.handle("connect", { id }), /.*/);
        assert.ok(!`${error.message} ${error.hint}`.includes("Hunter2!pw"), error.message);
        const view = service.views()[0];
        assert.strictEqual(view.status, "error");
        assert.ok(!JSON.stringify(view).includes("Hunter2!pw"));
    });
    (0, run_unit_tests_1.test)("read-only connections refuse every write, including console statements", async () => {
        const adapter = fakeAdapter();
        const { service, id } = await serviceWith(adapter, fakeUi({ confirm: true, typed: true }), true);
        const target = { database: "app", schema: "public", object: "users" };
        await rejects(service.handle("insertRow", { id, target, values: { name: { mode: "value", value: "x" } } }), /read-only/);
        await rejects(service.handle("updateRow", { id, target, key: { id: 1 }, values: { name: { mode: "value", value: "x" } } }), /read-only/);
        await rejects(service.handle("deleteRows", { id, target, keys: [{ id: 1 }] }), /read-only/);
        await rejects(service.handle("dropObject", { id, target }), /read-only/);
        await rejects(service.handle("runQuery", { id, text: "SELECT 1; UPDATE users SET a = 1 WHERE id = 2" }), /read-only, so UPDATE/);
        await service.handle("runQuery", { id, text: "SELECT * FROM users" });
        assert.deepStrictEqual(adapter.calls, ["run:SELECT * FROM users"]);
    });
    (0, run_unit_tests_1.test)("destructive actions only run after confirmation", async () => {
        const adapter = fakeAdapter();
        const ui = fakeUi({ confirm: false, typed: false });
        const { service, id } = await serviceWith(adapter, ui);
        const target = { database: "app", schema: "public", object: "users" };
        assert.deepStrictEqual(await service.handle("deleteRows", { id, target, keys: [{ id: 1 }, { id: 2 }] }), { cancelled: true });
        assert.deepStrictEqual(await service.handle("dropObject", { id, target }), { cancelled: true });
        assert.deepStrictEqual(await service.handle("truncateObject", { id, target }), { cancelled: true });
        assert.deepStrictEqual(await service.handle("runQuery", { id, text: "DELETE FROM users" }), { cancelled: true });
        assert.deepStrictEqual(adapter.calls, [], "nothing ran");
        assert.match(ui.asked[0], /Delete 2 rows from users/);
        assert.match(ui.asked[1], /Drop users/);
        // Non-destructive writes run without a prompt.
        await service.handle("runQuery", { id, text: "INSERT INTO users (name) VALUES ('a')" });
        assert.strictEqual(ui.asked.length, 4);
        const yes = fakeUi({ confirm: true, typed: true });
        const ok = await serviceWith(fakeAdapter(), yes);
        const okAdapter = fakeAdapter();
        const confirmed = new service_1.DatabaseService(ok.store, yes, () => undefined, () => okAdapter);
        assert.deepStrictEqual(await confirmed.handle("deleteRows", { id: ok.id, target, keys: [{ id: 1 }] }), { affected: 1 });
        assert.deepStrictEqual(await confirmed.handle("dropObject", { id: ok.id, target }), { ok: true });
        assert.deepStrictEqual(okAdapter.calls, ["remove", "drop"]);
    });
    (0, run_unit_tests_1.test)("validates requests from the webview", async () => {
        const { service, id } = await serviceWith(fakeAdapter(), fakeUi());
        await rejects(service.handle("fetchPage", { id, request: { target: {} } }), /Table is missing/);
        await rejects(service.handle("fetchPage", { id, request: { target: { object: "users" }, filters: [{ column: "a", op: "evil" }] } }), /Unknown filter operator/);
        await rejects(service.handle("insertRow", { id, target: { object: "users" }, values: { name: { mode: "sql", value: "1" } } }), /Invalid value/);
        await rejects(service.handle("deleteRows", { id, target: { object: "users" }, keys: [] }), /No rows selected/);
        await rejects(service.handle("listObjects", { id: "missing", database: "x" }), /no longer exists/);
        await rejects(service.handle("nope", {}), /Unknown request/);
        await rejects(service.handle("runQuery", { id, text: "   " }), /Enter a query/);
    });
    (0, run_unit_tests_1.test)("a lost connection is dropped so the next action reconnects", async () => {
        let connects = 0;
        const adapter = fakeAdapter({
            connect: async () => { connects++; return { version: "x" }; },
            listDatabases: async () => { throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }); }
        });
        const { service, id } = await serviceWith(adapter, fakeUi());
        await rejects(service.handle("listDatabases", { id }), /closed by the server/);
        assert.strictEqual(service.views()[0].status, "error");
        await rejects(service.handle("listDatabases", { id }), /closed/);
        assert.strictEqual(connects, 2, "the second call reconnected");
    });
});
/** Creates a small SQLite database file with sql.js, so the fixture works on every Node version. */
async function sqliteFixture() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const initSqlJs = require("sql.js");
    const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve("sql.js/dist/sql-wasm.js")), f) });
    const db = new SQL.Database();
    db.run(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, age INTEGER, meta JSON, created TEXT DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE logs (msg TEXT, level TEXT);
          CREATE VIEW adults AS SELECT * FROM users WHERE age >= 18;
          INSERT INTO users (name, email, age, meta) VALUES ('Ann', 'ann@x.io', 31, '{"vip":true}'), ('Bob', 'bob@x.io', 17, NULL), ('Cy 50%', 'cy@x.io', 45, NULL);
          INSERT INTO logs VALUES ('boot', 'info'), ('boot', 'info'), ('oops', 'error');`);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-db-")), "app.db");
    fs.writeFileSync(file, Buffer.from(db.export()));
    db.close();
    return file;
}
for (const engine of ["auto", "sql.js"]) {
    (0, run_unit_tests_1.suite)(`database: SQLite end to end (${engine})`, () => {
        (0, run_unit_tests_1.test)("browses, filters, inserts, updates, deletes and drops through the service", async () => {
            const file = await sqliteFixture();
            const state = new MemoryState();
            const store = new store_1.ConnectionStore(state, new MemorySecrets());
            const ui = fakeUi({ confirm: true, typed: true });
            let adapter;
            const service = new service_1.DatabaseService(store, ui, () => undefined, (spec, o) => (adapter = new sqlite_1.SqliteAdapter(spec, o.readOnly, engine)));
            const { id } = await store.save({ name: "Local", connectionString: `sqlite://${file}` });
            try {
                assert.ok(await service.handle("connect", { id }));
                assert.strictEqual(adapter.engine, engine === "sql.js" ? "sql.js" : adapter.engine);
                assert.deepStrictEqual((await service.handle("listDatabases", { id })).databases, ["main"]);
                const objects = await service.handle("listObjects", { id, database: "main" });
                assert.deepStrictEqual(objects.map(o => `${o.name}:${o.type}`), ["adults:view", "logs:table", "users:table"]);
                const target = { database: "main", object: "users" };
                const page = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 2, sort: { column: "age", dir: "desc" } } });
                assert.strictEqual(page.total, 3);
                assert.deepStrictEqual(page.rows.map(r => r.name), ["Cy 50%", "Ann"]);
                assert.strictEqual(page.keyStrategy, "primary");
                assert.ok(page.columns.find(c => c.name === "id").autoIncrement);
                const search = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 10, search: "50%" } });
                assert.deepStrictEqual(search.rows.map(r => r.name), ["Cy 50%"], "a % in the search is literal");
                const filtered = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 10, filters: [{ column: "age", op: "lt", value: "40" }, { column: "meta", op: "notnull" }] } });
                assert.deepStrictEqual(filtered.rows.map(r => r.name), ["Ann"]);
                await service.handle("insertRow", { id, target, values: { id: { mode: "default" }, name: { mode: "value", value: "Dee" }, email: { mode: "value", value: "dee@x.io" }, age: { mode: "value", value: "28" }, meta: { mode: "value", value: "{\"k\":[1,2]}" }, created: { mode: "default" } } });
                await rejects(service.handle("insertRow", { id, target, values: { name: { mode: "value", value: "Dup" }, email: { mode: "value", value: "dee@x.io" } } }), /UNIQUE/);
                await rejects(service.handle("insertRow", { id, target, values: { name: { mode: "null" } } }), /cannot be NULL/);
                const afterInsert = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 10, filters: [{ column: "name", op: "eq", value: "Dee" }] } });
                const dee = afterInsert.rows[0];
                assert.strictEqual(dee.age, 28);
                assert.ok(dee.created, "the DEFAULT was applied");
                assert.deepStrictEqual(await service.handle("updateRow", { id, target, key: { id: dee.id }, values: { age: { mode: "value", value: "29" }, meta: { mode: "null" } } }), { affected: 1 });
                await rejects(service.handle("updateRow", { id, target, key: { id: 999 }, values: { age: { mode: "value", value: "1" } } }), /No row was updated/);
                assert.deepStrictEqual(await service.handle("deleteRows", { id, target, keys: [{ id: dee.id }, { id: 2 }] }), { affected: 2 });
                assert.match(ui.asked[ui.asked.length - 1], /Delete 2 rows from users/);
                // A table without a primary key is edited through its rowid.
                const logs = await service.handle("fetchPage", { id, request: { target: { database: "main", object: "logs" }, page: 1, pageSize: 10 } });
                assert.strictEqual(logs.keyStrategy, "rowid");
                const firstBoot = logs.rows[0];
                await service.handle("updateRow", { id, target: { database: "main", object: "logs" }, key: { __rowid: firstBoot.__rowid }, values: { level: { mode: "value", value: "debug" } } });
                const levels = await service.handle("runQuery", { id, text: "SELECT level, COUNT(*) AS n FROM logs GROUP BY level ORDER BY level" });
                assert.deepStrictEqual(levels.rows, [{ level: "debug", n: 1 }, { level: "error", n: 1 }, { level: "info", n: 1 }], "only the identified duplicate changed");
                // Views are read-only.
                const view = await service.handle("fetchPage", { id, request: { target: { database: "main", object: "adults" }, page: 1, pageSize: 10 } });
                assert.match(view.readOnly ?? "", /Views/);
                await rejects(service.handle("insertRow", { id, target: { database: "main", object: "adults" }, values: { name: { mode: "value", value: "x" } } }), /read-only/);
                // The console: reads, a multi-statement script, a bad query and a confirmed destructive one.
                const q = await service.handle("runQuery", { id, text: "SELECT name FROM users ORDER BY id" });
                assert.deepStrictEqual(q.rows.map(r => r.name), ["Ann", "Cy 50%"]);
                const script = await service.handle("runQuery", { id, text: "CREATE TABLE t2 (x INTEGER PRIMARY KEY); INSERT INTO t2 VALUES (1); INSERT INTO t2 VALUES (2)" });
                assert.ok(script.writes);
                await rejects(service.handle("runQuery", { id, text: "SELEC nope" }), /syntax/);
                await rejects(service.handle("fetchPage", { id, request: { target: { database: "main", object: "missing" }, page: 1, pageSize: 10 } }), /not found/);
                await service.handle("truncateObject", { id, target: { database: "main", object: "t2" } });
                assert.deepStrictEqual((await service.handle("runQuery", { id, text: "SELECT COUNT(*) AS n FROM t2" })).rows, [{ n: 0 }]);
                await service.handle("dropObject", { id, target: { database: "main", object: "t2" } });
                assert.ok(!(await service.handle("listObjects", { id, database: "main" })).some(o => o.name === "t2"));
            }
            finally {
                await service.dispose();
            }
            // Every change reached the file on disk.
            const reopened = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${file}`), true, "sql.js");
            await reopened.connect();
            const rows = await reopened.runQuery("SELECT name FROM users ORDER BY id");
            assert.deepStrictEqual(rows.rows.map(r => r.name), ["Ann", "Cy 50%"]);
            await reopened.close();
        });
    });
}
(0, run_unit_tests_1.suite)("database: page and wiring", () => {
    (0, run_unit_tests_1.test)("renders a CSP-locked shell whose script parses", () => {
        const html = (0, page_1.renderDatabasePage)({ cspSource: "vscode-resource:", scriptUri: "vscode-resource:/media/db-client.js", codiconsUri: "vscode-resource:/codicon.css", platform: "darwin" });
        const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
        assert.ok(nonce, "scripts need a nonce");
        assert.ok(html.includes(`<script nonce="${nonce}" src=`));
        assert.ok(!/ on[a-z]+="/i.test(html), "no inline event handlers");
        const source = fs.readFileSync(path.join(ROOT, "media", "db-client.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: "db-client.js" }));
        assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function/.test(source), "the UI never builds markup from strings");
    });
    (0, run_unit_tests_1.test)("the Database Client opens from the Database section and the command palette", () => {
        const database = layout_1.NAV.find(s => s.id === "database");
        assert.strictEqual(database.entries[0].command, "databaseClient");
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        assert.ok(manifest.contributes.commands.some((c) => c.command === "sayaib.hue-console.databaseClient"));
        for (const dep of ["pg", "mysql2", "mssql", "mongodb", "ioredis", "sql.js"])
            assert.ok(manifest.dependencies[dep], `${dep} ships with the extension`);
    });
});
//# sourceMappingURL=database.unit.js.map