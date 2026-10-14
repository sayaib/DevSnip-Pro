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
 * Database Client: the engines added after the first release (MariaDB,
 * CockroachDB, Oracle, ClickHouse), query cancellation, error positions,
 * index listing and the capability list. Pure logic only; the same paths run
 * against real servers in database-live.unit.ts.
 */
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const connection_string_1 = require("../../database/connection-string");
const sql_builder_1 = require("../../database/sql-builder");
const oracle_1 = require("../../database/adapters/oracle");
const mysql_1 = require("../../database/adapters/mysql");
const adapters_1 = require("../../database/adapters");
const sqlite_1 = require("../../database/adapters/sqlite");
const store_1 = require("../../database/store");
const service_1 = require("../../database/service");
const types_1 = require("../../database/types");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const col = (name, dataType, extra = {}) => ({
    name, dataType, category: (0, sql_builder_1.categorize)(dataType), nullable: true, primaryKey: false, autoIncrement: false, editable: true, ...extra
});
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
function memoryStore() {
    const state = new MemoryState();
    return { store: new store_1.ConnectionStore(state, new MemorySecrets()), state };
}
const ui = {
    confirm: async () => true,
    confirmByTyping: async () => true,
    pickSqliteFile: async () => undefined,
    copy: async () => undefined,
    openDocument: async () => undefined,
    baseDir: () => undefined
};
async function rejects(promise, pattern) {
    try {
        await promise;
    }
    catch (error) {
        assert.ok(error instanceof types_1.DbError, `expected a DbError, got ${error}`);
        assert.match(`${error.message} ${error.hint ?? ""}`, pattern);
        return error;
    }
    throw new Error(`expected rejection matching ${pattern}`);
}
(0, run_unit_tests_1.suite)("database engines: connection strings", () => {
    (0, run_unit_tests_1.test)("parses Oracle Easy Connect, SID, TCPS, JDBC thin and connect descriptors", () => {
        const easy = (0, connection_string_1.parseConnection)("oracle://scott:t%40ger@db.corp:1522/ORCLPDB1");
        assert.deepStrictEqual([easy.kind, easy.host, easy.port, easy.user, easy.password, easy.database, easy.connectString, easy.ssl], ["oracle", "db.corp", 1522, "scott", "t@ger", "ORCLPDB1", "db.corp:1522/ORCLPDB1", false]);
        assert.strictEqual((0, connection_string_1.parseConnection)("oracle://u:p@h/FREEPDB1").port, 1521);
        assert.strictEqual((0, connection_string_1.parseConnection)("oracle://u:p@h:2484/svc?ssl=true").connectString, "tcps://h:2484/svc");
        assert.match((0, connection_string_1.parseConnection)("oracle://u:p@h:1521/?sid=XE").connectString, /\(CONNECT_DATA=\(SID=XE\)\)/);
        const thin = (0, connection_string_1.parseConnection)("jdbc:oracle:thin:hr/secret@//db.corp:1521/ORCLPDB1");
        assert.deepStrictEqual([thin.user, thin.password, thin.connectString], ["hr", "secret", "db.corp:1521/ORCLPDB1"]);
        const sid = (0, connection_string_1.parseConnection)("jdbc:oracle:thin:@legacy:1521:ORCL");
        assert.strictEqual(sid.options.sid, "ORCL");
        assert.match(sid.connectString, /\(SID=ORCL\)/);
        assert.strictEqual((0, connection_string_1.parseConnection)("jdbc:oracle:thin:@tcps://h:2484/svc").connectString, "tcps://h:2484/svc");
        const descriptor = (0, connection_string_1.parseConnection)("jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))");
        assert.deepStrictEqual([descriptor.host, descriptor.port, descriptor.database], ["h", 1521, "svc"]);
        assert.throws(() => (0, connection_string_1.parseConnection)("oracle://u:p@h:1521"), /service name/);
        assert.throws(() => (0, connection_string_1.parseConnection)("oracle://u:p@h/bad name"), /not a valid Oracle service name/);
        assert.throws(() => (0, connection_string_1.parseConnection)("jdbc:oracle:thin:@//h:1521/svc)(HOST=evil"), /not a valid|not an Oracle host/);
    });
    (0, run_unit_tests_1.test)("parses MariaDB, CockroachDB and ClickHouse URLs with their defaults", () => {
        const maria = (0, connection_string_1.parseConnection)("mariadb://root:pw@127.0.0.1/app");
        assert.deepStrictEqual([maria.kind, maria.port], ["mariadb", 3306]);
        const crdb = (0, connection_string_1.parseConnection)("cockroachdb://root@localhost/defaultdb?sslmode=verify-full&sslrootcert=/certs/ca.crt");
        assert.deepStrictEqual([crdb.kind, crdb.port, crdb.ssl, crdb.options.sslrootcert], ["cockroachdb", 26257, true, "/certs/ca.crt"]);
        const ch = (0, connection_string_1.parseConnection)("clickhouse://analyst:pw@ch.local/events");
        assert.deepStrictEqual([ch.kind, ch.port, ch.ssl, ch.database], ["clickhouse", 8123, false, "events"]);
        assert.deepStrictEqual([(0, connection_string_1.parseConnection)("clickhouse://ch.cloud/db?secure=true").port, (0, connection_string_1.parseConnection)("clickhouse://ch.cloud/db?secure=true").ssl], [8443, true]);
        assert.strictEqual((0, connection_string_1.parseConnection)("clickhouse://ch.cloud:9443/db?secure=true").port, 9443, "an explicit port wins");
        assert.strictEqual((0, connection_string_1.parseConnection)("clickhouse://h/db").user, "default");
        assert.throws(() => (0, connection_string_1.parseConnection)("clickhouse://h:9000/db"), /native protocol/);
        assert.strictEqual((0, connection_string_1.parseConnection)("valkeys://:pw@cache:6380/1").ssl, true);
    });
    (0, run_unit_tests_1.test)("masks and restores passwords in the new forms", () => {
        for (const raw of ["oracle://scott:Tiger_9x@h:1521/svc", "jdbc:oracle:thin:scott/Tiger_9x@//h:1521/svc", "clickhouse://u:Tiger_9x@h:8123/db", "cockroachdb://u:Tiger_9x@h/db"]) {
            const masked = (0, connection_string_1.maskConnectionString)(raw);
            assert.ok(!masked.includes("Tiger_9x"), masked);
            assert.ok(masked.includes(connection_string_1.PASSWORD_MASK), masked);
            assert.ok((0, connection_string_1.hasMaskedPassword)(masked));
            assert.strictEqual((0, connection_string_1.restoreMaskedPassword)(masked, raw).replace(/^jdbc:/, ""), raw.replace(/^jdbc:/, ""));
            assert.ok((0, connection_string_1.secretsOf)(raw, (0, connection_string_1.parseConnection)(raw)).includes("Tiger_9x"));
        }
    });
    (0, run_unit_tests_1.test)("every kind has a label, a parseable example, features and an adapter", () => {
        for (const kind of Object.keys(types_1.DB_KINDS)) {
            const meta = types_1.DB_KINDS[kind];
            assert.ok(meta.label && meta.driver, kind);
            assert.strictEqual(typeof meta.features.editRows, "boolean");
            if (kind === "sqlite")
                continue;
            const spec = (0, connection_string_1.parseConnection)(meta.example);
            assert.strictEqual(spec.kind, kind, meta.example);
            assert.strictEqual((0, adapters_1.createAdapter)(spec, { readOnly: false }).kind, kind);
        }
        assert.strictEqual((0, connection_string_1.detectKind)(types_1.DB_KINDS.sqlite.example), "sqlite");
    });
});
(0, run_unit_tests_1.suite)("database engines: SQL dialects", () => {
    const users = [col("ID", "NUMBER", { primaryKey: true, autoIncrement: true, nullable: false }), col("NAME", "VARCHAR2(100)"), col("BIO", "CLOB"), col("AGE", "NUMBER(3)"), col("META", "JSON")];
    (0, run_unit_tests_1.test)("Oracle: bind variables, OFFSET/FETCH, case-insensitive search and LOB-safe casts", () => {
        const plan = (0, sql_builder_1.buildSelect)({ target: { schema: "HR", object: "USERS" }, page: 3, pageSize: 10, search: "50%", filters: [{ column: "AGE", op: "gte", value: "18" }, { column: "NAME", op: "starts", value: "a" }] }, users, "primary", "oracle");
        assert.strictEqual(plan.select.sql, `SELECT t__.* FROM "HR"."USERS" t__ WHERE "AGE" >= :1 AND UPPER(TO_CHAR("NAME")) LIKE UPPER(:2) ESCAPE '!' AND (UPPER(TO_CHAR("ID")) LIKE UPPER(:3) ESCAPE '!' OR UPPER(TO_CHAR("NAME")) LIKE UPPER(:4) ESCAPE '!' OR UPPER(DBMS_LOB.SUBSTR("BIO", 4000, 1)) LIKE UPPER(:5) ESCAPE '!' OR UPPER(TO_CHAR("AGE")) LIKE UPPER(:6) ESCAPE '!') ORDER BY "ID" OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY`);
        assert.deepStrictEqual(plan.select.params, [18, "a%", "%50!%%", "%50!%%", "%50!%%", "%50!%%"]);
        assert.strictEqual(plan.count.sql.startsWith(`SELECT COUNT(*) AS "n" FROM "HR"."USERS" t__ WHERE`), true);
        // JSON columns are left out of the search: TO_CHAR cannot read them.
        assert.ok(!plan.select.sql.includes('"META"'));
    });
    (0, run_unit_tests_1.test)("Oracle: ROWID identifies rows of tables without a key, and inserts work without values", () => {
        const logs = [col("MSG", "VARCHAR2(50)"), col("LVL", "VARCHAR2(10)")];
        const keys = (0, sql_builder_1.keyStrategyFor)(logs, "oracle", false, true);
        assert.deepStrictEqual(keys, { strategy: "rowid", keyColumns: ["__rowid"] });
        const plan = (0, sql_builder_1.buildSelect)({ target: { schema: "APP", object: "LOGS" }, page: 1, pageSize: 5 }, logs, "rowid", "oracle");
        assert.strictEqual(plan.select.sql, `SELECT t__.*, ROWIDTOCHAR(t__.ROWID) AS "__rowid" FROM "APP"."LOGS" t__ ORDER BY t__.ROWID OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`);
        const upd = (0, sql_builder_1.buildUpdate)({ schema: "APP", object: "LOGS" }, logs, { __rowid: "AAAR5GAAYAAAAANAAA" }, "rowid", { LVL: { mode: "value", value: "debug" } }, "oracle");
        assert.strictEqual(upd.sql, `UPDATE "APP"."LOGS" SET "LVL" = :1 WHERE ROWID = CHARTOROWID(:2)`);
        assert.throws(() => (0, sql_builder_1.buildDelete)({ object: "LOGS" }, logs, [{ __rowid: "x' OR 1=1 --" }], "rowid", "oracle"), /row id is missing/);
        assert.strictEqual((0, sql_builder_1.buildInsert)({ schema: "APP", object: "LOGS" }, logs, {}, "oracle").sql, `INSERT INTO "APP"."LOGS" ("MSG") VALUES (DEFAULT)`);
    });
    (0, run_unit_tests_1.test)("ClickHouse: typed parameters cast to the column type, ILIKE with backslash escapes, no row edits", () => {
        const cols = [col("id", "UInt64", { primaryKey: true }), col("kind", "LowCardinality(String)"), col("amount", "Nullable(Decimal(10, 2))"), col("tags", "Array(String)")];
        const plan = (0, sql_builder_1.buildSelect)({ target: { database: "app", object: "events" }, page: 2, pageSize: 25, search: "50%_", filters: [{ column: "id", op: "in", value: "1, 2" }, { column: "amount", op: "gt", value: "9.5" }] }, cols, "none", "clickhouse");
        assert.strictEqual(plan.select.sql, "SELECT * FROM `app`.`events` WHERE `id` IN (CAST({p1:String}, 'UInt64'), CAST({p2:String}, 'UInt64')) AND `amount` > CAST({p3:String}, 'Nullable(Decimal(10, 2))') AND (toString(`id`) ILIKE {p4:String} OR toString(`kind`) ILIKE {p5:String} OR toString(`amount`) ILIKE {p6:String} OR toString(`tags`) ILIKE {p7:String}) LIMIT 25 OFFSET 25");
        assert.deepStrictEqual(plan.select.params.slice(0, 4), ["1", "2", "9.5", "%50\\%\\_%"]);
        assert.strictEqual((0, sql_builder_1.quoteIdent)("we`ird\\name", "clickhouse"), "`we\\`ird\\\\name`");
        const keys = (0, sql_builder_1.keyStrategyFor)(cols, "clickhouse", false, false);
        assert.strictEqual(keys.strategy, "none");
        assert.match(keys.readOnly, /no unique key/);
    });
    (0, run_unit_tests_1.test)("CockroachDB: the hidden rowid of a table without a key is selected and matched as text", () => {
        const logs = [col("msg", "text")];
        assert.deepStrictEqual((0, sql_builder_1.keyStrategyFor)(logs, "postgres", false, true), { strategy: "rowid", keyColumns: ["__rowid"] });
        assert.deepStrictEqual((0, sql_builder_1.keyStrategyFor)(logs, "postgres", false, false).strategy, "ctid", "plain PostgreSQL still uses ctid");
        const plan = (0, sql_builder_1.buildSelect)({ target: { schema: "public", object: "logs" }, page: 1, pageSize: 5 }, logs, "rowid", "postgres");
        assert.ok(plan.select.sql.startsWith(`SELECT "public"."logs".*, "public"."logs".rowid::STRING AS "__rowid"`), plan.select.sql);
        const del = (0, sql_builder_1.buildDelete)({ schema: "public", object: "logs" }, logs, [{ __rowid: "1007563283546619905" }], "rowid", "postgres");
        assert.deepStrictEqual(del, { sql: `DELETE FROM "public"."logs" WHERE (rowid = $1::INT8)`, params: ["1007563283546619905"] });
    });
    (0, run_unit_tests_1.test)("maps the new engines' column types to editor categories", () => {
        const expect = [
            ["VARCHAR2(100)", "text"], ["NVARCHAR2(10)", "text"], ["NUMBER(10,2)", "number"], ["BINARY_DOUBLE", "number"], ["RAW(16)", "binary"], ["LONG RAW", "binary"],
            ["CLOB", "text"], ["BLOB", "binary"], ["TIMESTAMP(6) WITH TIME ZONE", "date"], ["INTERVAL DAY(2) TO SECOND(6)", "date"],
            ["UInt64", "number"], ["Nullable(Int32)", "number"], ["LowCardinality(Nullable(String))", "text"], ["FixedString(16)", "text"], ["DateTime64(3)", "date"],
            ["Array(String)", "json"], ["Map(String, UInt8)", "json"], ["Bool", "boolean"], ["Decimal(10, 2)", "number"], ["Float64", "number"]
        ];
        for (const [type, category] of expect)
            assert.strictEqual((0, sql_builder_1.categorize)(type), category, type);
    });
    (0, run_unit_tests_1.test)("statements know where they start, and ALTER ... DELETE is destructive", () => {
        const text = "  SELECT 1;\n\nALTER TABLE events DELETE WHERE ts < now() - INTERVAL 1 DAY";
        const statements = (0, sql_builder_1.classifyStatements)(text);
        assert.deepStrictEqual(statements.map(s => s.offset), [2, text.indexOf("ALTER")]);
        assert.match(statements[1].danger, /ALTER \.\.\. DELETE/);
    });
});
(0, run_unit_tests_1.suite)("database engines: Oracle scripts", () => {
    (0, run_unit_tests_1.test)("splits SQL on ';' and keeps a PL/SQL block whole, with offsets", () => {
        const text = "SELECT 1 FROM dual;\nUPDATE t SET a = 1 WHERE b = 2;\nBEGIN\n  DELETE FROM t;\n  COMMIT;\nEND;";
        const parts = (0, oracle_1.splitOracleScript)(text);
        assert.deepStrictEqual(parts.map(p => [p.verb, p.plsql, p.text.endsWith(";")]), [["select", false, false], ["update", false, false], ["begin", true, true]]);
        assert.deepStrictEqual(parts.map(p => p.offset), [0, text.indexOf("UPDATE"), text.indexOf("BEGIN")]);
        assert.match(parts[2].danger, /DELETE/);
        assert.ok(parts[2].write);
    });
    (0, run_unit_tests_1.test)("a line holding only '/' ends a block, as in SQL*Plus", () => {
        const text = "CREATE OR REPLACE PROCEDURE p AS\nBEGIN\n  NULL;\nEND;\n/\n-- then\nSELECT 'a;b' AS x FROM dual;\n/";
        const parts = (0, oracle_1.splitOracleScript)(text);
        assert.deepStrictEqual(parts.map(p => [p.verb, p.plsql]), [["create", true], ["select", false]]);
        assert.ok(parts[0].text.endsWith("END;"));
        // A leading comment stays with its statement (the server ignores it); the quoted ';' does not split.
        assert.ok(parts[1].text.endsWith("\nSELECT 'a;b' AS x FROM dual"), parts[1].text);
    });
});
(0, run_unit_tests_1.suite)("database engines: errors", () => {
    (0, run_unit_tests_1.test)("Oracle and ClickHouse errors map to clear messages without the noise", () => {
        const ora = (0, connection_string_1.friendlyError)(Object.assign(new Error("ORA-01017: invalid credential or not authorized; logon denied\nHelp: https://docs.oracle.com/error-help/db/ora-01017/"), { code: "ORA-01017" }));
        assert.match(ora.message, /Authentication failed/);
        const listener = (0, connection_string_1.friendlyError)(Object.assign(new Error("ORA-12514: Cannot connect to database. Service FOO is not registered with the listener\nHelp: https://docs.oracle.com/x"), { code: "ORA-12514" }));
        assert.ok(!/Help:/.test(listener.message));
        assert.match(listener.hint, /service name or SID/);
        const ch = (0, connection_string_1.friendlyError)(Object.assign(new Error("Code: 60. DB::Exception: Unknown table expression identifier 'nope'. (UNKNOWN_TABLE) (version 24.8.14.39 (official build))"), { code: "CH60" }));
        assert.strictEqual(ch.message, "Unknown table expression identifier 'nope'. (UNKNOWN_TABLE)");
        assert.match(ch.hint, /renamed or dropped/);
        assert.match((0, connection_string_1.friendlyError)(Object.assign(new Error("ORA-00904: \"NME\": invalid identifier"), { code: "ORA-00904" })).hint, /upper case/);
        assert.match((0, connection_string_1.friendlyError)(new Error("Unknown column 'nme' in 'field list'")).hint ?? "", /^Check the column name\.$/);
    });
    (0, run_unit_tests_1.test)("a user's cancel reads as a cancel, a statement timeout as a timeout", () => {
        assert.strictEqual((0, connection_string_1.friendlyError)(Object.assign(new Error("canceling statement due to user request"), { code: "57014" })).message, "The query was cancelled.");
        assert.match((0, connection_string_1.friendlyError)(Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })).message, /took too long/);
        assert.strictEqual((0, connection_string_1.friendlyError)(Object.assign(new Error("ORA-01013: User requested cancel of current operation."), { code: "ORA-01013" })).message, "The query was cancelled.");
        assert.match((0, connection_string_1.friendlyError)(new Error("The operation was aborted due to timeout")).message, /Timed out/);
    });
    (0, run_unit_tests_1.test)("errors carry the position the server reported, 0-based", () => {
        assert.strictEqual((0, connection_string_1.friendlyError)(Object.assign(new Error("syntax error at or near \"FORM\""), { code: "42601", position: "10" })).position, 9);
        assert.strictEqual((0, connection_string_1.friendlyError)(new Error("Code: 62. DB::Exception: Syntax error: failed at position 8 ('FORM')")).position, 7);
        assert.strictEqual((0, connection_string_1.friendlyError)(Object.assign(new Error("ORA-00904: \"X\": invalid identifier"), { code: "ORA-00904", offset: 7 })).position, 7);
        assert.strictEqual((0, connection_string_1.friendlyError)(Object.assign(new Error("x"), { devsnipPosition: 42, position: "3" })).position, 42, "an adapter's own mapping wins");
        assert.strictEqual((0, connection_string_1.friendlyError)(new types_1.DbError("kept").at(5)).position, 5);
        const sql = "SELECT 1;\nSELECT *\nFORM t";
        assert.strictEqual((0, mysql_1.mysqlErrorPosition)("You have an error in your SQL syntax; check the manual ... near 'FORM t' at line 2", "SELECT *\nFORM t"), "SELECT *\n".length);
        assert.strictEqual(sql.slice(10 + "SELECT *\n".length), "FORM t");
        assert.strictEqual((0, mysql_1.mysqlErrorPosition)("near '' at line 1", "SELECT 1 FROM"), "SELECT 1 FROM".length);
        assert.strictEqual((0, mysql_1.mysqlErrorPosition)("Unknown column 'x'", "SELECT x"), undefined);
    });
});
/** An adapter whose console query waits until it is cancelled. */
function slowAdapter(stopped) {
    return {
        kind: "postgres",
        connect: async () => ({ version: "PostgreSQL 16" }),
        close: async () => undefined,
        ping: async () => undefined,
        listDatabases: async () => ["app"],
        listSchemas: async () => ["public"],
        listObjects: async () => [],
        describe: async () => [],
        fetchPage: async () => ({ columns: [], rows: [], total: 0, keyColumns: [], keyStrategy: "none", elapsedMs: 1 }),
        insert: async () => 1,
        update: async () => 1,
        remove: async () => 1,
        runQuery: (_text, _ctx, control) => new Promise((resolve, reject) => {
            control?.onCancel(() => { stopped.push("server"); reject(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })); });
        }),
        drop: async () => undefined,
        truncate: async () => undefined,
        classify: text => (0, sql_builder_1.classifyStatements)(text),
        invalidate: () => undefined,
        indexes: async () => [{ name: "users_pkey", columns: ["id"], unique: true, primary: true }]
    };
}
(0, run_unit_tests_1.suite)("database engines: service", () => {
    async function setup(adapter, onChange = () => undefined) {
        const { store } = memoryStore();
        const service = new service_1.DatabaseService(store, ui, onChange, () => adapter);
        const { id } = await store.save({ name: "PG", connectionString: "postgresql://u:pw@h/app" });
        return { service, store, id };
    }
    (0, run_unit_tests_1.test)("cancelQuery stops the run on the server and answers at once, leaving the connection up", async () => {
        const stopped = [];
        const { service, id } = await setup(slowAdapter(stopped));
        const running = service.handle("runQuery", { id, text: "SELECT pg_sleep(60)", runId: "r1" }).then(() => undefined, (e) => e);
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.deepStrictEqual(await service.handle("cancelQuery", { runId: "r1" }), { cancelled: true });
        const error = await running;
        assert.ok(error instanceof types_1.DbError && error.code === "CANCELLED", String(error));
        assert.deepStrictEqual(stopped, ["server"]);
        assert.strictEqual(service.views()[0].status, "connected", "a cancelled run is not a lost connection");
        assert.deepStrictEqual(await service.handle("cancelQuery", { runId: "r1" }), { cancelled: false }, "finished runs are forgotten");
        await service.dispose();
    });
    (0, run_unit_tests_1.test)("RunControl runs hooks once, and late hooks run straight away", async () => {
        const control = new types_1.RunControl();
        const seen = [];
        control.onCancel(() => { seen.push("a"); });
        const raced = control.race(new Promise(() => undefined)).catch((e) => e.code);
        await control.cancel();
        await control.cancel();
        control.onCancel(() => { seen.push("late"); });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepStrictEqual(seen, ["a", "late"]);
        assert.strictEqual(await raced, "CANCELLED");
    });
    (0, run_unit_tests_1.test)("indexes, formatting and detection for the form view", async () => {
        const { service, id } = await setup(slowAdapter([]));
        assert.deepStrictEqual(await service.handle("indexes", { id, target: { object: "users" } }), [{ name: "users_pkey", columns: ["id"], unique: true, primary: true }]);
        const formatted = await service.handle("formatQuery", { id, text: "select id,name from users where id=1" });
        assert.match(formatted.text, /^SELECT\n/);
        await rejects(service.handle("formatQuery", { id, text: "select 'unterminated" }), /Could not format/);
        const detected = await service.handle("detect", { connectionString: "postgresql://u:pw@h/app?sslmode=require&sslpassword=hush&application_name=me" });
        assert.deepStrictEqual(detected.options, { sslmode: "require", application_name: "me" }, "options that could hold a secret stay on the host");
        await service.dispose();
    });
    (0, run_unit_tests_1.test)("Oracle PL/SQL is not reformatted, and only SQL connections format", async () => {
        const { store } = memoryStore();
        const service = new service_1.DatabaseService(store, ui, () => undefined, () => slowAdapter([]));
        const ora = await store.save({ name: "Ora", connectionString: "oracle://u:p@h:1521/svc" });
        const mongo = await store.save({ name: "Mongo", connectionString: "mongodb://h/app" });
        await rejects(service.handle("formatQuery", { id: ora.id, text: "BEGIN NULL; END;" }), /PL\/SQL/);
        await rejects(service.handle("formatQuery", { id: mongo.id, text: "db.x.find()" }), /available for SQL/);
        await service.dispose();
    });
    (0, run_unit_tests_1.test)("a failing status push never fails the operation", async () => {
        const { service, id } = await setup(slowAdapter([]), () => { throw new Error("panel closed"); });
        assert.ok(await service.handle("connect", { id }));
        await service.dispose();
    });
    (0, run_unit_tests_1.test)("a connection saved as MySQL from a mariadb:// string becomes MariaDB on connect", async () => {
        const { store, state: memory } = memoryStore();
        const service = new service_1.DatabaseService(store, ui, () => undefined, () => slowAdapter([]));
        const saved = await store.save({ name: "Old", connectionString: "mariadb://u:p@h/app" });
        // What older versions stored for this string.
        await memory.update("devsnip.database.connections", store.list().map(p => ({ ...p, kind: "mysql" })));
        assert.strictEqual(service.views()[0].kind, "mysql");
        await service.handle("connect", { id: saved.id });
        assert.strictEqual(service.views()[0].kind, "mariadb");
        assert.strictEqual(service.views()[0].kindLabel, "MariaDB");
        await service.dispose();
    });
});
(0, run_unit_tests_1.suite)("database engines: SQLite indexes", () => {
    (0, run_unit_tests_1.test)("lists the rowid key, unique constraints and plain indexes", async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const initSqlJs = require("sql.js");
        const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve("sql.js/dist/sql-wasm.js")), f) });
        const db = new SQL.Database();
        db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT); CREATE INDEX users_name ON users (name);");
        const file = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "devsnip-ix-")), "ix.db");
        fs.writeFileSync(file, Buffer.from(db.export()));
        db.close();
        const adapter = new sqlite_1.SqliteAdapter((0, connection_string_1.parseConnection)(`sqlite://${file}`), true, "sql.js");
        await adapter.connect();
        const indexes = await adapter.indexes({ database: "main", object: "users" });
        await adapter.close();
        assert.deepStrictEqual(indexes.map(ix => [ix.name, ix.columns.join(","), ix.unique, ix.primary]), [
            ["PRIMARY KEY", "id", true, true],
            ["sqlite_autoindex_users_1", "email", true, false],
            ["users_name", "name", false, false]
        ]);
    });
});
(0, run_unit_tests_1.suite)("database engines: UI and packaging", () => {
    (0, run_unit_tests_1.test)("the webview knows every kind, and the Oracle driver ships without its native binaries", () => {
        const source = fs.readFileSync(path.join(ROOT, "media", "db-client.js"), "utf8");
        for (const kind of Object.keys(types_1.DB_KINDS)) {
            assert.ok(new RegExp(`KIND_ABBR = \\{[^}]*\\b${kind}:`).test(source), `abbreviation for ${kind}`);
            assert.ok(new RegExp(`KIND_COLOR = \\{[^}]*\\b${kind}:`).test(source), `colour for ${kind}`);
        }
        // Tree icons are prefixed: a bare "view" class would pick up the tab panel's absolute layout.
        assert.match(source, /"obj-icon obj-" \+ o\.type/);
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        assert.ok(manifest.dependencies.oracledb, "oracledb ships with the extension");
        const ignore = fs.readFileSync(path.join(ROOT, ".vscodeignore"), "utf8");
        assert.match(ignore, /^node_modules\/oracledb\/build\/\*\*$/m, "Thin mode needs no native binaries");
    });
    (0, run_unit_tests_1.test)("Thin mode loads without the native binaries", () => {
        // A child process where loading any native module fails: oracledb must still load, in Thin mode.
        const script = `process.dlopen = () => { throw new Error("native module loaded"); };
      const oracledb = require(${JSON.stringify(path.join(ROOT, "node_modules", "oracledb"))});
      if (!oracledb.thin) throw new Error("not in Thin mode");
      process.stdout.write("thin");`;
        assert.strictEqual((0, child_process_1.execFileSync)(process.execPath, ["-e", script], { encoding: "utf8" }), "thin");
    });
});
//# sourceMappingURL=database-engines.unit.js.map