import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vm from "vm";
import { detectKind, friendlyError, hasMaskedPassword, maskConnectionString, parseConnection, PASSWORD_MASK, redact, restoreMaskedPassword, secretsOf } from "../../database/connection-string";
import { buildDelete, buildInsert, buildSelect, buildUpdate, categorize, classifyStatements, coerceInput, keyStrategyFor, quoteIdent } from "../../database/sql-builder";
import { classifyShellCommand, parseShellCommand, parseShellValue } from "../../database/mongo-shell";
import { classifyRedis, tokenizeCommand } from "../../database/adapters/redis";
import { SqliteAdapter } from "../../database/adapters/sqlite";
import { ConnectionStore } from "../../database/store";
import { DatabaseService, HostUi } from "../../database/service";
import { renderDatabasePage } from "../../database/page";
import { encodeValue } from "../../database/values";
import { ColumnInfo, DbAdapter, DbError, QueryResult } from "../../database/types";
import { NAV } from "../../toolkits/layout";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "..", "..", "..");

const col = (name: string, dataType: string, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name, dataType, category: categorize(dataType), nullable: true, primaryKey: false, autoIncrement: false, editable: true, ...extra
});
const USERS = [col("id", "integer", { primaryKey: true, autoIncrement: true, nullable: false }), col("name", "text"), col("age", "integer"), col("meta", "jsonb"), col("active", "boolean"), col("avatar", "bytea", { editable: false })];

class MemoryState {
  data = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.data.has(key) ? this.data.get(key) : fallback) as T; }
  update(key: string, value: unknown): Thenable<void> { this.data.set(key, JSON.parse(JSON.stringify(value))); return Promise.resolve(); }
}
class MemorySecrets {
  data = new Map<string, string>();
  get(key: string): Thenable<string | undefined> { return Promise.resolve(this.data.get(key)); }
  store(key: string, value: string): Thenable<void> { this.data.set(key, value); return Promise.resolve(); }
  delete(key: string): Thenable<void> { this.data.delete(key); return Promise.resolve(); }
}

function fakeUi(answers: { confirm?: boolean; typed?: boolean } = {}): HostUi & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    confirm: async message => { asked.push(message); return answers.confirm ?? false; },
    confirmByTyping: async message => { asked.push(message); return answers.typed ?? false; },
    pickSqliteFile: async () => undefined,
    copy: async () => undefined,
    openDocument: async () => undefined,
    baseDir: () => os.tmpdir()
  };
}

/** An adapter that records calls, for testing the service's rules without a database. */
function fakeAdapter(overrides: Partial<DbAdapter> = {}): DbAdapter & { calls: string[] } {
  const calls: string[] = [];
  const result: QueryResult = { columns: [], rows: [], elapsedMs: 1 };
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
    runQuery: async text => { calls.push(`run:${text}`); return result; },
    drop: async () => { calls.push("drop"); },
    truncate: async () => { calls.push("truncate"); },
    classify: text => classifyStatements(text),
    invalidate: () => undefined,
    ...overrides
  };
}

async function serviceWith(adapter: DbAdapter, ui: HostUi, readOnly = false) {
  const state = new MemoryState();
  const secrets = new MemorySecrets();
  const store = new ConnectionStore(state, secrets);
  const service = new DatabaseService(store, ui, () => undefined, () => adapter);
  const profile = await store.save({ name: "Test", connectionString: "postgresql://admin:Hunter2!pw@db.example.com:5432/app?sslmode=require", readOnly });
  return { service, store, state, secrets, id: profile.id };
}

async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<DbError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DbError, `expected a DbError, got ${error}`);
    assert.match((error as DbError).message, pattern);
    return error as DbError;
  }
  throw new Error(`expected rejection matching ${pattern}`);
}

suite("database: connection strings", () => {
  test("detects every supported database from its connection string", () => {
    const cases: Array<[string, string]> = [
      ["postgres://u:p@h/db", "postgres"], ["postgresql://h", "postgres"], ["jdbc:postgresql://h:5432/db", "postgres"],
      ["DATABASE_URL=\"postgresql://u:p@h/db\"", "postgres"],
      ["mysql://root@localhost/app", "mysql"], ["mariadb://h/db", "mysql"],
      ["Server=localhost,1433;Database=app;User Id=sa;Password=x", "sqlserver"], ["sqlserver://h:1433;database=a", "sqlserver"], ["mssql://u:p@h/db", "sqlserver"],
      ["sqlite:///tmp/x.db", "sqlite"], ["file:./dev.db", "sqlite"], ["/Users/me/app.sqlite3", "sqlite"],
      ["mongodb://h:27017/app", "mongodb"], ["mongodb+srv://u:p@cluster0.x.mongodb.net/app", "mongodb"],
      ["redis://localhost:6379/0", "redis"], ["rediss://:pw@h:6380", "redis"]
    ];
    for (const [input, kind] of cases) assert.strictEqual(detectKind(input), kind, input);
    assert.strictEqual(detectKind("cassandra://h"), undefined);
    assert.strictEqual(detectKind("hello world"), undefined);
  });

  test("parses URL credentials, ports, TLS and percent-encoded passwords", () => {
    const pg = parseConnection("postgresql://dev:s3cr3t%3Ap%40ss@db.internal:6543/app?sslmode=require&application_name=x");
    assert.deepStrictEqual([pg.kind, pg.host, pg.port, pg.user, pg.password, pg.database, pg.ssl], ["postgres", "db.internal", 6543, "dev", "s3cr3t:p@ss", "app", true]);
    assert.strictEqual(pg.options.application_name, "x");
    const raw = parseConnection("mysql://root:p@ss@word@localhost/shop");
    assert.strictEqual(raw.password, "p@ss@word", "an unencoded @ in the password still parses");
    assert.strictEqual(raw.port, 3306);
    assert.strictEqual(parseConnection("redis://localhost").port, 6379);
    assert.strictEqual(parseConnection("rediss://h").ssl, true);
    assert.strictEqual(parseConnection("postgresql://h/db?sslmode=disable").ssl, false);
    const mongo = parseConnection("mongodb://a:1,b:2,c:3/app?replicaSet=rs0");
    assert.strictEqual(mongo.host, "a:1,b:2,c:3");
    assert.strictEqual(mongo.url, "mongodb://a:1,b:2,c:3/app?replicaSet=rs0");
  });

  test("parses SQL Server ADO, JDBC and URL forms", () => {
    const ado = parseConnection("Server=tcp:sql.example.com,1444;Initial Catalog=sales;User ID=app;Password={a;b}}c};Encrypt=True;TrustServerCertificate=false");
    assert.deepStrictEqual([ado.host, ado.port, ado.database, ado.user, ado.password, ado.ssl], ["sql.example.com", 1444, "sales", "app", "a;b}c", true]);
    const jdbc = parseConnection("jdbc:sqlserver://localhost:1433;databaseName=app;user=sa;password=Pass123;encrypt=false");
    assert.deepStrictEqual([jdbc.host, jdbc.port, jdbc.database, jdbc.user, jdbc.password, jdbc.ssl], ["localhost", 1433, "app", "sa", "Pass123", false]);
    const url = parseConnection("mssql://sa:pw@localhost:1433/app");
    assert.deepStrictEqual([url.kind, url.host, url.database, url.password], ["sqlserver", "localhost", "app", "pw"]);
    const instance = parseConnection("Server=.\\SQLEXPRESS;Database=x;User Id=a;Password=b");
    assert.strictEqual(instance.host, ".\\SQLEXPRESS");
  });

  test("resolves SQLite paths and rejects in-memory databases", () => {
    assert.strictEqual(parseConnection("sqlite:///var/data/app.db").filePath, path.normalize("/var/data/app.db"));
    assert.strictEqual(parseConnection("file:./dev.db", "/work/proj").filePath, path.resolve("/work/proj", "dev.db"));
    assert.strictEqual(parseConnection("sqlite:~/x.db").filePath, path.join(os.homedir(), "x.db"));
    assert.throws(() => parseConnection("sqlite::memory:"), /file/);
    assert.throws(() => parseConnection("file:./dev.db"), /workspace/);
  });

  test("rejects malformed and unsupported strings with helpful messages", () => {
    assert.throws(() => parseConnection(""), /Enter a connection string/);
    assert.throws(() => parseConnection("cassandra://h"), /cassandra:\/\/ databases are not supported/);
    assert.throws(() => parseConnection("postgresql://h:99999/db"), /out of range/);
    assert.throws(() => parseConnection("mongodb+srv://c.example.net:27017/db"), /cannot include a port/);
    assert.throws(() => parseConnection("redis://h/users"), /numbers/);
    assert.throws(() => parseConnection("Database=x;User Id=a"), /Server/);
  });

  test("masks the password and restores it when the mask is saved back", () => {
    const original = "postgresql://dev:s3cr3t%3Ap%40ss@db:5432/app";
    const masked = maskConnectionString(original);
    assert.strictEqual(masked, `postgresql://dev:${PASSWORD_MASK}@db:5432/app`);
    assert.ok(hasMaskedPassword(masked));
    assert.strictEqual(restoreMaskedPassword(masked, original), original);
    // The user changed the database but kept the password.
    assert.strictEqual(restoreMaskedPassword(masked.replace("/app", "/other"), original), "postgresql://dev:s3cr3t%3Ap%40ss@db:5432/other");
    // A newly typed password wins.
    assert.strictEqual(restoreMaskedPassword("postgresql://dev:new@db/app", original), "postgresql://dev:new@db/app");
    const ado = "Server=h;Database=d;User Id=u;Password={x;y}};Encrypt=false";
    const maskedAdo = maskConnectionString(ado);
    assert.ok(!maskedAdo.includes("x;y"), maskedAdo);
    assert.strictEqual(restoreMaskedPassword(maskedAdo, ado), ado);
    assert.strictEqual(maskConnectionString("mongodb://h:27017/app"), "mongodb://h:27017/app");
    assert.strictEqual(maskConnectionString("redis://:topsecret@h:6379/0"), `redis://:${PASSWORD_MASK}@h:6379/0`);
  });

  test("redacts credentials from driver errors and maps common failures", () => {
    const raw = "postgresql://admin:Hunter2!pw@db.example.com/app";
    const secrets = secretsOf(raw, parseConnection(raw));
    const leaked = friendlyError(new Error(`connect failed for ${raw} with password Hunter2!pw`), secrets);
    assert.ok(!leaked.message.includes("Hunter2!pw"), leaked.message);
    assert.ok(!redact("mysql://root:abc123@h/db", []).includes("abc123"));
    assert.ok(!redact("Password=abc123;User=x", []).includes("abc123"));
    assert.match(friendlyError(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" })).message, /refused/);
    assert.match(friendlyError(Object.assign(new Error("password authentication failed for user \"x\""), { code: "28P01" })).message, /Authentication failed/);
    assert.match(friendlyError(Object.assign(new Error("relation \"nope\" does not exist"), { code: "42P01" })).hint ?? "", /Refresh/);
    assert.match(friendlyError(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" })).hint ?? "", /already exists/);
  });
});

suite("database: SQL builder", () => {
  test("quotes identifiers so names can never break out of the statement", () => {
    assert.strictEqual(quoteIdent('a"; DROP TABLE x; --', "postgres"), '"a""; DROP TABLE x; --"');
    assert.strictEqual(quoteIdent("a`b", "mysql"), "`a``b`");
    assert.strictEqual(quoteIdent("a]b", "sqlserver"), "[a]]b]");
    assert.throws(() => quoteIdent("", "postgres"));
  });

  test("builds a parameterised page query with search, filters, sort and paging per dialect", () => {
    const req = { target: { database: "app", schema: "public", object: "users" }, page: 3, pageSize: 25, sort: { column: "name", dir: "desc" as const }, filters: [{ column: "age", op: "gte" as const, value: "21" }, { column: "name", op: "contains" as const, value: "50%_" }], search: "ann" };
    const pg = buildSelect(req, USERS, "primary", "postgres");
    assert.match(pg.select.sql, /^SELECT "public"\."users"\.\* FROM "public"\."users" WHERE "age" >= \$1 AND CAST\("name" AS TEXT\) ILIKE \$2 ESCAPE '!' AND \(/);
    assert.match(pg.select.sql, /ORDER BY "name" DESC LIMIT 25 OFFSET 50$/);
    assert.strictEqual(pg.select.params[0], 21, "numbers are coerced for numeric columns");
    assert.strictEqual(pg.select.params[1], "%50!%!_%", "LIKE wildcards in user text are escaped");
    assert.ok(!pg.select.sql.includes("avatar"), "binary columns are not searched");
    assert.deepStrictEqual(pg.count.params, pg.select.params);
    const ms = buildSelect({ ...req, sort: undefined }, USERS, "primary", "sqlserver");
    assert.match(ms.select.sql, /ORDER BY \[id\] OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY$/);
    assert.match(ms.select.sql, /@p1/);
    const noPk = buildSelect({ ...req, sort: undefined, filters: [], search: "" }, USERS.map(c => ({ ...c, primaryKey: false })), "none", "sqlserver");
    assert.match(noPk.select.sql, /ORDER BY \(SELECT NULL\)/);
    const my = buildSelect(req, USERS, "primary", "mysql");
    assert.match(my.select.sql, /FROM `app`\.`users`/);
    assert.match(my.select.sql, /CAST\(`name` AS CHAR\) LIKE \?/);
    const lite = buildSelect({ ...req, target: { database: "main", object: "users" }, filters: [], search: "" }, USERS, "rowid", "sqlite");
    assert.match(lite.select.sql, /SELECT "users"\.\*, rowid AS "__rowid" FROM "users"/);
    const ctid = buildSelect({ ...req, filters: [], search: "" }, USERS, "ctid", "postgres");
    assert.match(ctid.select.sql, /ctid::text AS "__ctid"/);
  });

  test("refuses unknown columns and operators instead of quoting them into SQL", () => {
    const base = { target: { object: "users" }, page: 1, pageSize: 10 };
    assert.throws(() => buildSelect({ ...base, sort: { column: "password", dir: "asc" } }, USERS, "primary", "postgres"), /does not exist/);
    assert.throws(() => buildSelect({ ...base, filters: [{ column: "x", op: "eq", value: "1" }] }, USERS, "primary", "postgres"), /does not exist/);
    assert.throws(() => buildSelect({ ...base, filters: [{ column: "age", op: "drop" as never, value: "1" }] }, USERS, "primary", "postgres"), /operator/);
    assert.throws(() => buildSelect({ ...base, filters: [{ column: "age", op: "eq", value: "abc" }] }, USERS, "primary", "postgres"), /expects a number/);
  });

  test("builds INSERT, UPDATE and DELETE with bound values and key-only WHERE clauses", () => {
    const t = { schema: "public", object: "users" };
    const ins = buildInsert(t, USERS, { id: { mode: "default" }, name: { mode: "value", value: "O'Brien" }, age: { mode: "null" }, meta: { mode: "value", value: "{\"a\":1}" }, active: { mode: "value", value: "yes" } }, "postgres");
    assert.strictEqual(ins.sql, 'INSERT INTO "public"."users" ("name", "age", "meta", "active") VALUES ($1, $2, $3, $4)');
    assert.deepStrictEqual(ins.params, ["O'Brien", null, "{\"a\":1}", true]);
    assert.strictEqual(buildInsert(t, USERS, { id: { mode: "default" } }, "mysql").sql, "INSERT INTO `users` () VALUES ()");
    const up = buildUpdate(t, USERS, { id: 7 }, "primary", { name: { mode: "value", value: "x" }, active: { mode: "value", value: "0" } }, "mysql");
    assert.strictEqual(up.sql, "UPDATE `users` SET `name` = ?, `active` = ? WHERE `id` = ?");
    assert.deepStrictEqual(up.params, ["x", 0, 7]);
    const del = buildDelete(t, USERS, [{ id: 1 }, { id: 2 }], "primary", "sqlserver");
    assert.strictEqual(del.sql, "DELETE FROM [public].[users] WHERE ([id] = @p1) OR ([id] = @p2)");
    assert.strictEqual(buildDelete(t, USERS, [{ __rowid: 5 }], "rowid", "sqlite").sql, 'DELETE FROM "users" WHERE (rowid = ?)');
    assert.throws(() => buildDelete(t, USERS, [{ __ctid: "1; DROP" }], "ctid", "postgres"), /row id/);
    assert.throws(() => buildDelete(t, USERS, [{ name: "x" }], "primary", "postgres"), /key column id is missing/);
    assert.throws(() => buildUpdate(t, USERS, { id: 1 }, "primary", { avatar: { mode: "value", value: "x" } }, "postgres"), /read-only/);
    assert.throws(() => buildUpdate(t, USERS, { id: 1 }, "primary", { id: { mode: "default" } }, "sqlite"), /SQLite cannot reset/);
    assert.throws(() => coerceInput({ mode: "value", value: "{bad" }, USERS[3], "postgres"), /valid JSON/);
    assert.throws(() => coerceInput({ mode: "null" }, USERS[0], "postgres"), /cannot be NULL/);
    assert.strictEqual(coerceInput({ mode: "value", value: "9007199254740993" }, USERS[2], "postgres"), "9007199254740993", "big integers stay exact");
  });

  test("decides how rows are identified, and makes unsafe tables read-only", () => {
    assert.deepStrictEqual(keyStrategyFor(USERS, "mysql", false, false).keyColumns, ["id"]);
    const noPk = USERS.map(c => ({ ...c, primaryKey: false }));
    assert.strictEqual(keyStrategyFor(noPk, "sqlite", false, true).strategy, "rowid");
    assert.strictEqual(keyStrategyFor(noPk, "sqlite", false, false).strategy, "none");
    assert.strictEqual(keyStrategyFor(noPk, "postgres", false, false).strategy, "ctid");
    assert.match(keyStrategyFor(noPk, "mysql", false, false).readOnly ?? "", /no primary key/);
    assert.match(keyStrategyFor(USERS, "postgres", true, false).readOnly ?? "", /Views/);
  });

  test("maps column types to editor categories", () => {
    const cases: Array<[string, string]> = [["integer", "number"], ["bigint", "number"], ["numeric(10,2)", "number"], ["interval", "date"], ["timestamp with time zone", "date"], ["tinyint(1)", "boolean"], ["bit", "boolean"], ["jsonb", "json"], ["varbinary(max)", "binary"], ["character varying(255)", "text"], ["uuid", "text"], ["point", "other"]];
    for (const [type, category] of cases) assert.strictEqual(categorize(type), category, type);
  });

  test("classifies console statements and flags destructive ones", () => {
    const s = classifyStatements("SELECT 1; -- drop table x\nDELETE FROM a WHERE id = 1; UPDATE b SET x = 1; DROP TABLE IF EXISTS c; TRUNCATE d; ALTER TABLE e DROP COLUMN f; INSERT INTO g VALUES (';')");
    assert.deepStrictEqual(s.map(x => [x.verb, x.write, !!x.danger]), [["select", false, false], ["delete", true, true], ["update", true, true], ["drop", true, true], ["truncate", true, true], ["alter", true, true], ["insert", true, false]]);
    assert.match(s[1].danger!, /matching rows/);
    assert.match(s[2].danger!, /every row/);
    assert.strictEqual(classifyStatements("WITH x AS (SELECT 1) SELECT * FROM x")[0].write, false);
    assert.strictEqual(classifyStatements("WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone")[0].write, true);
    assert.strictEqual(classifyStatements("EXPLAIN ANALYZE DELETE FROM t")[0].write, true);
    assert.strictEqual(classifyStatements("EXPLAIN SELECT 1")[0].write, false);
    assert.strictEqual(classifyStatements("PRAGMA table_info(users)")[0].write, true, "PRAGMA with arguments may write");
    assert.strictEqual(classifyStatements("PRAGMA user_version")[0].write, false);
    assert.strictEqual(classifyStatements("SELECT * INTO backup FROM t")[0].write, true);
    assert.strictEqual(classifyStatements("CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql").length, 1, "dollar quotes hide semicolons");
    assert.strictEqual(classifyStatements("select 'it''s; fine'").length, 1);
  });
});

suite("database: mongosh parser", () => {
  test("parses shell literals into Extended JSON without evaluating anything", () => {
    const value = parseShellValue(`{ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), at: ISODate("2024-01-02T03:04:05Z"), n: NumberLong("9007199254740993"), name: /^ann/i, 'quoted key': [1, 2.5, -3, true, null], nested: { $gt: 21 }, }`);
    assert.deepStrictEqual(value, {
      _id: { $oid: "64b7f0c2a1b2c3d4e5f60718" },
      at: { $date: "2024-01-02T03:04:05.000Z" },
      n: { $numberLong: "9007199254740993" },
      name: { $regularExpression: { pattern: "^ann", options: "i" } },
      "quoted key": [1, 2.5, -3, true, null],
      nested: { $gt: 21 }
    });
    assert.throws(() => parseShellValue("{ a: process.exit() }"), /not a value/);
    assert.throws(() => parseShellValue("{ a: require('fs') }"), /not supported/);
    assert.throws(() => parseShellValue("{ a: ObjectId('xyz') }"), /24 hex/);
  });

  test("parses commands, chains and collection forms", () => {
    const find = parseShellCommand(`db.users.find({ age: { $gte: 21 } }, { name: 1 }).sort({ name: -1 }).limit(5)`);
    assert.deepStrictEqual(find, { kind: "collection", collection: "users", method: "find", args: [{ age: { $gte: 21 } }, { name: 1 }], chain: [{ method: "sort", args: [{ name: -1 }] }, { method: "limit", args: [5] }] });
    assert.strictEqual((parseShellCommand(`db.getCollection("my-logs").countDocuments({})`) as { collection: string }).collection, "my-logs");
    assert.strictEqual((parseShellCommand(`db["a.b"].findOne()`) as { collection: string }).collection, "a.b");
    assert.deepStrictEqual(parseShellCommand("show collections"), { kind: "show", what: "collections" });
    assert.deepStrictEqual(parseShellCommand("db.dropDatabase();"), { kind: "db", method: "dropDatabase", args: [] });
    assert.throws(() => parseShellCommand("db.a.find({}); db.b.drop()"), /one command at a time/);
    assert.throws(() => parseShellCommand("users.find()"), /start with db/);
  });

  test("flags writes and destructive commands", () => {
    const c = (text: string) => classifyShellCommand(parseShellCommand(text));
    assert.deepStrictEqual(c("db.u.find({})"), { write: false, verb: "find" });
    assert.match(c("db.u.deleteMany({})").danger!, /every document/);
    assert.match(c("db.u.deleteOne({ _id: 1 })").danger!, /deletes a document/);
    assert.match(c("db.u.updateMany({}, { $set: { a: 1 } })").danger!, /every document/);
    assert.strictEqual(c("db.u.updateOne({ a: 1 }, { $set: { a: 2 } })").danger, undefined);
    assert.match(c("db.u.drop()").danger!, /deletes the collection/);
    assert.match(c("db.dropDatabase()").danger!, /whole database/);
    assert.strictEqual(c("db.u.aggregate([{ $match: {} }])").write, false);
    assert.strictEqual(c("db.u.aggregate([{ $out: 'x' }])").write, true);
    assert.throws(() => c("db.u.mapReduce()"), /not supported/);
    assert.throws(() => c("db.u.find({}).forEach()"), /not supported/);
  });
});

suite("database: Redis console", () => {
  test("tokenizes quoted arguments", () => {
    assert.deepStrictEqual(tokenizeCommand(`SET greeting "hello \\"world\\"" EX 10`), ["SET", "greeting", 'hello "world"', "EX", "10"]);
    assert.deepStrictEqual(tokenizeCommand(`HSET h 'a b' ''`), ["HSET", "h", "a b", ""]);
    assert.throws(() => tokenizeCommand(`GET "open`), /Unterminated/);
  });

  test("blocks connection-changing commands and flags writes and destructive ones", () => {
    const c = (text: string) => classifyRedis(text).map(x => [x.verb, x.write, !!x.danger]);
    assert.deepStrictEqual(c("GET a\nSCAN 0 MATCH * COUNT 10\nCONFIG GET maxmemory"), [["get", false, false], ["scan", false, false], ["config", false, false]]);
    assert.deepStrictEqual(c("SET a 1\nDEL a\nFLUSHDB\nCONFIG SET maxmemory 1"), [["set", true, false], ["del", true, true], ["flushdb", true, true], ["config", true, true]]);
    assert.deepStrictEqual(c("JSON.SET k $ 1"), [["json.set", true, false]], "unknown module commands count as writes");
    assert.throws(() => classifyRedis("SELECT 2"), /not available/);
    assert.throws(() => classifyRedis("SUBSCRIBE news"), /not available/);
    assert.throws(() => classifyRedis("# just a comment"), /Enter a command/);
  });
});

suite("database: values", () => {
  test("encodes driver values into JSON the webview can show", () => {
    assert.strictEqual(encodeValue(BigInt("9007199254740993")), "9007199254740993");
    assert.strictEqual(encodeValue(BigInt(42)), 42);
    assert.strictEqual(encodeValue(new Date("2024-01-02T03:04:05Z")), "2024-01-02T03:04:05.000Z");
    assert.deepStrictEqual(encodeValue(Buffer.from("hi")), { __dbv: "binary", size: 2, hex: "6869" });
    assert.strictEqual((encodeValue("x".repeat(30_000)) as { __dbv: string }).__dbv, "truncated");
    assert.strictEqual(encodeValue(Number.NaN), "NaN");
  });
});

suite("database: connection store", () => {
  test("keeps connection strings in secret storage and only a masked form in settings", async () => {
    const state = new MemoryState();
    const secrets = new MemorySecrets();
    const store = new ConnectionStore(state, secrets);
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

suite("database: service rules", () => {
  test("never returns the password and redacts it from failures", async () => {
    const adapter = fakeAdapter({ connect: async () => { throw new Error("FATAL: password Hunter2!pw rejected for postgresql://admin:Hunter2!pw@db.example.com/app"); } });
    const { service, id } = await serviceWith(adapter, fakeUi());
    const edit = await service.handle("editConnection", { id }) as { connectionString: string };
    assert.ok(!edit.connectionString.includes("Hunter2!pw"));
    const detected = await service.handle("detect", { connectionString: edit.connectionString, id }) as { summary: Record<string, unknown>; masked: string };
    assert.ok(!JSON.stringify(detected).includes("Hunter2!pw"));
    assert.strictEqual(detected.summary.hasPassword, true, "the masked password resolves to the stored one");
    const error = await rejects(service.handle("connect", { id }), /.*/);
    assert.ok(!`${error.message} ${error.hint}`.includes("Hunter2!pw"), error.message);
    const view = service.views()[0];
    assert.strictEqual(view.status, "error");
    assert.ok(!JSON.stringify(view).includes("Hunter2!pw"));
  });

  test("read-only connections refuse every write, including console statements", async () => {
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

  test("destructive actions only run after confirmation", async () => {
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
    const confirmed = new DatabaseService(ok.store, yes, () => undefined, () => okAdapter);
    assert.deepStrictEqual(await confirmed.handle("deleteRows", { id: ok.id, target, keys: [{ id: 1 }] }), { affected: 1 });
    assert.deepStrictEqual(await confirmed.handle("dropObject", { id: ok.id, target }), { ok: true });
    assert.deepStrictEqual(okAdapter.calls, ["remove", "drop"]);
  });

  test("validates requests from the webview", async () => {
    const { service, id } = await serviceWith(fakeAdapter(), fakeUi());
    await rejects(service.handle("fetchPage", { id, request: { target: {} } }), /Table is missing/);
    await rejects(service.handle("fetchPage", { id, request: { target: { object: "users" }, filters: [{ column: "a", op: "evil" }] } }), /Unknown filter operator/);
    await rejects(service.handle("insertRow", { id, target: { object: "users" }, values: { name: { mode: "sql", value: "1" } } }), /Invalid value/);
    await rejects(service.handle("deleteRows", { id, target: { object: "users" }, keys: [] }), /No rows selected/);
    await rejects(service.handle("listObjects", { id: "missing", database: "x" }), /no longer exists/);
    await rejects(service.handle("nope", {}), /Unknown request/);
    await rejects(service.handle("runQuery", { id, text: "   " }), /Enter a query/);
  });

  test("a lost connection is dropped so the next action reconnects", async () => {
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
async function sqliteFixture(): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs({ locateFile: (f: string) => path.join(path.dirname(require.resolve("sql.js/dist/sql-wasm.js")), f) });
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

for (const engine of ["auto", "sql.js"] as const) {
  suite(`database: SQLite end to end (${engine})`, () => {
    test("browses, filters, inserts, updates, deletes and drops through the service", async () => {
      const file = await sqliteFixture();
      const state = new MemoryState();
      const store = new ConnectionStore(state, new MemorySecrets());
      const ui = fakeUi({ confirm: true, typed: true });
      let adapter: SqliteAdapter | undefined;
      const service = new DatabaseService(store, ui, () => undefined, (spec, o) => (adapter = new SqliteAdapter(spec, o.readOnly, engine)));
      const { id } = await store.save({ name: "Local", connectionString: `sqlite://${file}` });
      try {
        assert.ok(await service.handle("connect", { id }));
        assert.strictEqual(adapter!.engine, engine === "sql.js" ? "sql.js" : adapter!.engine);
        assert.deepStrictEqual((await service.handle("listDatabases", { id }) as { databases: string[] }).databases, ["main"]);
        const objects = await service.handle("listObjects", { id, database: "main" }) as Array<{ name: string; type: string }>;
        assert.deepStrictEqual(objects.map(o => `${o.name}:${o.type}`), ["adults:view", "logs:table", "users:table"]);

        const target = { database: "main", object: "users" };
        const page = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 2, sort: { column: "age", dir: "desc" } } }) as { rows: Array<Record<string, unknown>>; total: number; keyStrategy: string; columns: ColumnInfo[] };
        assert.strictEqual(page.total, 3);
        assert.deepStrictEqual(page.rows.map(r => r.name), ["Cy 50%", "Ann"]);
        assert.strictEqual(page.keyStrategy, "primary");
        assert.ok(page.columns.find(c => c.name === "id")!.autoIncrement);
        const search = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 10, search: "50%" } }) as { rows: Array<Record<string, unknown>> };
        assert.deepStrictEqual(search.rows.map(r => r.name), ["Cy 50%"], "a % in the search is literal");
        const filtered = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 10, filters: [{ column: "age", op: "lt", value: "40" }, { column: "meta", op: "notnull" }] } }) as { rows: Array<Record<string, unknown>> };
        assert.deepStrictEqual(filtered.rows.map(r => r.name), ["Ann"]);

        await service.handle("insertRow", { id, target, values: { id: { mode: "default" }, name: { mode: "value", value: "Dee" }, email: { mode: "value", value: "dee@x.io" }, age: { mode: "value", value: "28" }, meta: { mode: "value", value: "{\"k\":[1,2]}" }, created: { mode: "default" } } });
        await rejects(service.handle("insertRow", { id, target, values: { name: { mode: "value", value: "Dup" }, email: { mode: "value", value: "dee@x.io" } } }), /UNIQUE/);
        await rejects(service.handle("insertRow", { id, target, values: { name: { mode: "null" } } }), /cannot be NULL/);
        const afterInsert = await service.handle("fetchPage", { id, request: { target, page: 1, pageSize: 10, filters: [{ column: "name", op: "eq", value: "Dee" }] } }) as { rows: Array<Record<string, unknown>> };
        const dee = afterInsert.rows[0];
        assert.strictEqual(dee.age, 28);
        assert.ok(dee.created, "the DEFAULT was applied");

        assert.deepStrictEqual(await service.handle("updateRow", { id, target, key: { id: dee.id }, values: { age: { mode: "value", value: "29" }, meta: { mode: "null" } } }), { affected: 1 });
        await rejects(service.handle("updateRow", { id, target, key: { id: 999 }, values: { age: { mode: "value", value: "1" } } }), /No row was updated/);
        assert.deepStrictEqual(await service.handle("deleteRows", { id, target, keys: [{ id: dee.id }, { id: 2 }] }), { affected: 2 });
        assert.match(ui.asked[ui.asked.length - 1], /Delete 2 rows from users/);

        // A table without a primary key is edited through its rowid.
        const logs = await service.handle("fetchPage", { id, request: { target: { database: "main", object: "logs" }, page: 1, pageSize: 10 } }) as { rows: Array<Record<string, unknown>>; keyStrategy: string };
        assert.strictEqual(logs.keyStrategy, "rowid");
        const firstBoot = logs.rows[0];
        await service.handle("updateRow", { id, target: { database: "main", object: "logs" }, key: { __rowid: firstBoot.__rowid }, values: { level: { mode: "value", value: "debug" } } });
        const levels = await service.handle("runQuery", { id, text: "SELECT level, COUNT(*) AS n FROM logs GROUP BY level ORDER BY level" }) as QueryResult;
        assert.deepStrictEqual(levels.rows, [{ level: "debug", n: 1 }, { level: "error", n: 1 }, { level: "info", n: 1 }], "only the identified duplicate changed");

        // Views are read-only.
        const view = await service.handle("fetchPage", { id, request: { target: { database: "main", object: "adults" }, page: 1, pageSize: 10 } }) as { readOnly?: string };
        assert.match(view.readOnly ?? "", /Views/);
        await rejects(service.handle("insertRow", { id, target: { database: "main", object: "adults" }, values: { name: { mode: "value", value: "x" } } }), /read-only/);

        // The console: reads, a multi-statement script, a bad query and a confirmed destructive one.
        const q = await service.handle("runQuery", { id, text: "SELECT name FROM users ORDER BY id" }) as QueryResult;
        assert.deepStrictEqual(q.rows.map(r => r.name), ["Ann", "Cy 50%"]);
        const script = await service.handle("runQuery", { id, text: "CREATE TABLE t2 (x INTEGER PRIMARY KEY); INSERT INTO t2 VALUES (1); INSERT INTO t2 VALUES (2)" }) as QueryResult & { writes: boolean };
        assert.ok(script.writes);
        await rejects(service.handle("runQuery", { id, text: "SELEC nope" }), /syntax/);
        await rejects(service.handle("fetchPage", { id, request: { target: { database: "main", object: "missing" }, page: 1, pageSize: 10 } }), /not found/);
        await service.handle("truncateObject", { id, target: { database: "main", object: "t2" } });
        assert.deepStrictEqual((await service.handle("runQuery", { id, text: "SELECT COUNT(*) AS n FROM t2" }) as QueryResult).rows, [{ n: 0 }]);
        await service.handle("dropObject", { id, target: { database: "main", object: "t2" } });
        assert.ok(!(await service.handle("listObjects", { id, database: "main" }) as Array<{ name: string }>).some(o => o.name === "t2"));
      } finally {
        await service.dispose();
      }

      // Every change reached the file on disk.
      const reopened = new SqliteAdapter(parseConnection(`sqlite://${file}`), true, "sql.js");
      await reopened.connect();
      const rows = await reopened.runQuery("SELECT name FROM users ORDER BY id");
      assert.deepStrictEqual(rows.rows.map(r => r.name), ["Ann", "Cy 50%"]);
      await reopened.close();
    });
  });
}

suite("database: page and wiring", () => {
  test("renders a CSP-locked shell whose script parses", () => {
    const html = renderDatabasePage({ cspSource: "vscode-resource:", scriptUri: "vscode-resource:/media/db-client.js", codiconsUri: "vscode-resource:/codicon.css", platform: "darwin" });
    const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
    assert.ok(nonce, "scripts need a nonce");
    assert.ok(html.includes(`<script nonce="${nonce}" src=`));
    assert.ok(!/ on[a-z]+="/i.test(html), "no inline event handlers");
    const source = fs.readFileSync(path.join(ROOT, "media", "db-client.js"), "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: "db-client.js" }));
    assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|new Function/.test(source), "the UI never builds markup from strings");
  });

  test("the Database Client opens from the Database section and the command palette", () => {
    const database = NAV.find(s => s.id === "database")!;
    assert.strictEqual(database.entries[0].command, "databaseClient");
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === "sayaib.hue-console.databaseClient"));
    for (const dep of ["pg", "mysql2", "mssql", "mongodb", "ioredis", "sql.js"]) assert.ok(manifest.dependencies[dep], `${dep} ships with the extension`);
  });
});
