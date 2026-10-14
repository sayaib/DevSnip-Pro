"use strict";
/**
 * Oracle Database through node-oracledb in Thin mode: pure JavaScript, so
 * no Oracle Client libraries are needed. Oracle 12.1 or later.
 *
 * The "database" is the service the connection names; schemas are the users
 * that own tables. Values are fetched so that an edit round-trips exactly:
 * NUMBERs as their exact text, dates as wall-clock text in the session's
 * NLS formats, LOBs as strings and buffers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OracleAdapter = exports.splitOracleScript = void 0;
const sql_builder_1 = require("../sql-builder");
const sql_1 = require("../../toolkits/engines/sql");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
/** Session formats that match how values are shown, so typed text binds back to DATE and TIMESTAMP columns. */
const NLS = "ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS' NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF' NLS_TIMESTAMP_TZ_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF TZH:TZM' NLS_NUMERIC_CHARACTERS = '.,'";
const pad = (n, w = 2) => String(n).padStart(w, "0");
/** Thin mode builds a JS Date from the stored wall-clock time, so local getters give it back exactly. */
function wallClock(d, withMs) {
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
}
function utcStamp(d) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)} +00:00`;
}
/** Exact NUMBER text, as a JS number only when that loses nothing. */
function numberValue(text) {
    if (text === null || text === undefined)
        return null;
    const n = Number(text);
    return Number.isFinite(n) && String(n) === text ? n : text;
}
const PLSQL_START = /^\s*(begin|declare|create\s+(or\s+replace\s+)?((non)?editionable\s+)?(procedure|function|package|trigger|type|library|java))\b/i;
/**
 * Splits a script the way SQL*Plus does: a line holding only "/" ends a
 * block; otherwise ";" ends a SQL statement, and a PL/SQL block (BEGIN,
 * DECLARE, CREATE PROCEDURE...) runs to the end of the text.
 */
function splitOracleScript(text) {
    const out = [];
    const chunks = [];
    const slash = /^[ \t]*\/[ \t]*$/gm;
    let last = 0;
    for (const m of text.matchAll(slash)) {
        chunks.push({ text: text.slice(last, m.index), offset: last });
        last = (m.index ?? 0) + m[0].length;
    }
    chunks.push({ text: text.slice(last), offset: last });
    for (const chunk of chunks) {
        let rest = chunk.text;
        let base = chunk.offset;
        while (rest.trim()) {
            // Leading comments are not part of the statement's verb.
            const firstCode = stripLeadingComments(rest);
            if (PLSQL_START.test(firstCode)) {
                const start = rest.length - firstCode.length;
                const body = rest.slice(start).trimEnd();
                const words = safeWords(body);
                const destructive = words.filter(w => ["delete", "drop", "truncate"].includes(w));
                out.push({
                    text: body,
                    offset: base + start,
                    verb: words[0] ?? "begin",
                    write: true,
                    plsql: true,
                    danger: destructive.length ? `This PL/SQL block runs ${[...new Set(destructive)].map(w => w.toUpperCase()).join(", ")}.` : undefined
                });
                break;
            }
            // One SQL statement: up to the first ";" outside quotes and parentheses.
            const end = statementEnd(rest);
            const piece = rest.slice(0, end);
            for (const s of (0, sql_builder_1.classifyStatements)(piece))
                out.push({ ...s, offset: base + s.offset, plsql: false });
            if (end >= rest.length)
                break;
            base += end + 1;
            rest = rest.slice(end + 1);
        }
    }
    return out;
}
exports.splitOracleScript = splitOracleScript;
function stripLeadingComments(text) {
    let t = text.trimStart();
    for (;;) {
        if (t.startsWith("--")) {
            const nl = t.indexOf("\n");
            t = nl < 0 ? "" : t.slice(nl + 1).trimStart();
            continue;
        }
        if (t.startsWith("/*")) {
            const close = t.indexOf("*/");
            t = close < 0 ? "" : t.slice(close + 2).trimStart();
            continue;
        }
        return t;
    }
}
function safeWords(text) {
    try {
        return (0, sql_1.tokenize)(text).filter(t => t.type === "word").map(t => t.value.toLowerCase());
    }
    catch {
        return text.toLowerCase().match(/[a-z_]+/g) ?? [];
    }
}
function statementEnd(text) {
    let tokens;
    try {
        tokens = (0, sql_1.tokenize)(text);
    }
    catch {
        return text.length;
    }
    let depth = 0;
    for (const token of tokens) {
        if (token.type !== "punct")
            continue;
        if (token.value === "(")
            depth++;
        else if (token.value === ")")
            depth = Math.max(0, depth - 1);
        else if (token.value === ";" && depth === 0)
            return token.offset;
    }
    return text.length;
}
/** VARCHAR2(100), NUMBER(10,2), RAW(16): the declared type. Unquoted aliases come back in upper case. */
function oracleType(r) {
    const type = String(r.TYPE);
    const prec = r.PREC === null || r.PREC === undefined ? undefined : Number(r.PREC);
    const scale = r.SCALE === null || r.SCALE === undefined ? undefined : Number(r.SCALE);
    if (type === "NUMBER") {
        if (prec === undefined)
            return scale === 0 ? "INTEGER" : "NUMBER";
        return scale ? `NUMBER(${prec},${scale})` : `NUMBER(${prec})`;
    }
    if (/^(N?VARCHAR2|N?CHAR)$/.test(type))
        return `${type}(${Number(r.CLEN) || Number(r.LEN)})`;
    if (type === "RAW")
        return `RAW(${r.LEN})`;
    if (type === "FLOAT")
        return prec ? `FLOAT(${prec})` : "FLOAT";
    return type;
}
class OracleAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly = false) {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.kind = "oracle";
        this.dialect = "oracle";
        this.service = "";
        this.currentSchema = "";
        if (!spec.connectString)
            throw new types_1.DbError("The Oracle connection string has no host or service name.");
    }
    get oracledb() {
        // Loaded on first use; Thin mode is the default, so no native client is touched.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        if (!this.driver)
            this.driver = require("oracledb");
        return this.driver;
    }
    pool() {
        if (!this.poolPromise) {
            const seconds = Math.ceil(types_1.LIMITS.connectTimeoutMs / 1000);
            this.poolPromise = this.oracledb.createPool({
                user: this.spec.user || undefined,
                password: this.spec.password || undefined,
                connectString: this.spec.connectString,
                poolMin: 0,
                poolMax: 4,
                poolIncrement: 1,
                poolTimeout: 60,
                queueTimeout: types_1.LIMITS.connectTimeoutMs + 5000,
                connectTimeout: seconds,
                transportConnectTimeout: seconds,
                // Every new session gets the formats values are shown in.
                sessionCallback: (connection, _tag, done) => {
                    connection.execute(NLS).then(() => done(), error => done(error));
                }
            }).catch(error => {
                this.poolPromise = undefined;
                throw error;
            });
        }
        return this.poolPromise;
    }
    async withConnection(run, drop = false) {
        const connection = await (await this.pool()).getConnection();
        connection.callTimeout = types_1.LIMITS.queryTimeoutMs;
        try {
            return await run(connection);
        }
        finally {
            // close(undefined) is rejected by the driver (NJS-005), which would leak the session.
            await (drop ? connection.close({ drop: true }) : connection.close()).catch(() => undefined);
        }
    }
    options(maxRows = 0) {
        const o = this.oracledb;
        const lobs = [o.DB_TYPE_CLOB, o.DB_TYPE_NCLOB];
        const stamps = [o.DB_TYPE_TIMESTAMP, o.DB_TYPE_TIMESTAMP_LTZ];
        return {
            outFormat: o.OUT_FORMAT_OBJECT,
            maxRows,
            fetchTypeHandler: (meta) => {
                if (lobs.includes(meta.dbType))
                    return { type: o.STRING };
                if (meta.dbType === o.DB_TYPE_BLOB)
                    return { type: o.BUFFER };
                if (meta.dbType === o.DB_TYPE_NUMBER)
                    return { type: o.STRING, converter: numberValue };
                if (meta.dbType === o.DB_TYPE_DATE)
                    return { converter: (d) => (d ? wallClock(d, false) : d) };
                if (stamps.includes(meta.dbType))
                    return { converter: (d) => (d ? wallClock(d, true) : d) };
                if (meta.dbType === o.DB_TYPE_TIMESTAMP_TZ)
                    return { converter: (d) => (d ? utcStamp(d) : d) };
                if (meta.dbType === o.DB_TYPE_INTERVAL_DS) {
                    return { converter: (v) => v ? `${v.days < 0 || v.hours < 0 ? "-" : "+"}${Math.abs(v.days)} ${pad(Math.abs(v.hours))}:${pad(Math.abs(v.minutes))}:${pad(Math.abs(v.seconds))}${v.fseconds ? "." + String(Math.abs(v.fseconds)).padStart(9, "0").replace(/0+$/, "") : ""}` : v };
                }
                if (meta.dbType === o.DB_TYPE_INTERVAL_YM)
                    return { converter: (v) => (v ? `${v.years < 0 || v.months < 0 ? "-" : "+"}${Math.abs(v.years)}-${Math.abs(v.months)}` : v) };
                return undefined;
            }
        };
    }
    async connect() {
        return this.withConnection(async (c) => {
            const r = await c.execute("SELECT SYS_CONTEXT('USERENV', 'CON_NAME') AS con, SYS_CONTEXT('USERENV', 'SERVICE_NAME') AS svc, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS sch FROM DUAL", [], { outFormat: this.oracledb.OUT_FORMAT_OBJECT });
            const row = r.rows?.[0] ?? {};
            this.service = String(row.CON ?? row.SVC ?? this.spec.database ?? "ORACLE");
            this.currentSchema = String(row.SCH ?? (this.spec.user ?? "").toUpperCase());
            return { version: `Oracle ${c.oracleServerVersionString ?? ""}`.trim(), defaultDatabase: this.service };
        });
    }
    async close() {
        const pool = this.poolPromise;
        this.poolPromise = undefined;
        await pool?.then(p => p.close(0)).catch(() => undefined);
    }
    async ping() {
        await this.withConnection(c => c.execute("SELECT 1 FROM DUAL"));
    }
    async exec(_database, sql, params) {
        return this.withConnection(async (c) => {
            const r = await c.execute(sql, params, { ...this.options(), autoCommit: true });
            return { rows: r.rows ?? [], columns: (r.metaData ?? []).map(m => m.name), affected: r.rowsAffected };
        });
    }
    async rows(sql, params = []) {
        return (await this.exec(undefined, sql, params)).rows;
    }
    async listDatabases() {
        return [this.service || this.spec.database || "ORACLE"];
    }
    /** Users that own tables or views, the connected schema first. Oracle's own schemas are hidden. */
    async listSchemas() {
        const rows = await this.rows(`SELECT u.username AS name FROM all_users u
        WHERE u.oracle_maintained = 'N'
          AND EXISTS (SELECT 1 FROM all_objects o WHERE o.owner = u.username AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW'))
        ORDER BY u.username`);
        const names = rows.map(r => String(r.NAME));
        const mine = this.currentSchema;
        return mine ? [mine, ...names.filter(n => n !== mine)] : names;
    }
    async listObjects(_database, schema) {
        const owner = schema || this.currentSchema;
        const rows = await this.rows(`SELECT t.table_name AS name, CASE WHEN m.mview_name IS NOT NULL THEN 'view' ELSE 'table' END AS kind, t.num_rows AS row_count
         FROM all_tables t LEFT JOIN all_mviews m ON m.owner = t.owner AND m.mview_name = t.table_name
        WHERE t.owner = :1 AND t.nested = 'NO' AND t.secondary = 'N' AND NVL(t.dropped, 'NO') = 'NO'
          AND NVL(t.iot_type, 'IOT') = 'IOT' AND t.table_name NOT LIKE 'BIN$%'
       UNION ALL
       SELECT v.view_name, 'view', NULL FROM all_views v WHERE v.owner = :2
       ORDER BY 1`, [owner, owner]);
        return rows.map(r => ({ name: String(r.NAME), type: r.KIND === "view" ? "view" : "table", rows: r.ROW_COUNT === null || r.ROW_COUNT === undefined ? undefined : Number(r.ROW_COUNT) }));
    }
    async introspect(target) {
        const owner = target.schema || this.currentSchema;
        const [columns, objects] = await Promise.all([
            this.rows(`SELECT c.column_name AS name, c.data_type AS type, c.data_length AS len, c.char_length AS clen, c.data_precision AS prec, c.data_scale AS scale,
                c.nullable AS nullable, c.data_default AS def, c.virtual_column AS virt, c.identity_column AS ident, i.generation_type AS gen,
                (SELECT COUNT(*) FROM all_constraints k JOIN all_cons_columns kc ON kc.owner = k.owner AND kc.constraint_name = k.constraint_name
                  WHERE k.owner = c.owner AND k.table_name = c.table_name AND k.constraint_type = 'P' AND kc.column_name = c.column_name) AS pk
           FROM all_tab_cols c
           LEFT JOIN all_tab_identity_cols i ON i.owner = c.owner AND i.table_name = c.table_name AND i.column_name = c.column_name
          WHERE c.owner = :1 AND c.table_name = :2 AND c.hidden_column = 'NO'
          ORDER BY c.column_id`, [owner, target.object]),
            this.rows(`SELECT o.object_type AS type FROM all_objects o WHERE o.owner = :1 AND o.object_name = :2 AND o.object_type IN ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
          ORDER BY CASE o.object_type WHEN 'MATERIALIZED VIEW' THEN 0 ELSE 1 END`, [owner, target.object])
        ]);
        const objectType = String(objects[0]?.TYPE ?? "TABLE");
        const isView = objectType !== "TABLE";
        return {
            columns: columns.map(r => {
                const dataType = oracleType(r);
                const category = (0, sql_builder_1.categorize)(dataType);
                const ident = r.IDENT === "YES";
                const def = r.DEF === null || r.DEF === undefined ? null : String(r.DEF).trim();
                return {
                    name: String(r.NAME),
                    dataType,
                    category,
                    nullable: r.NULLABLE === "Y",
                    primaryKey: Number(r.PK) > 0,
                    autoIncrement: ident,
                    // Identity columns show their sequence as the default; that is noise in the editor.
                    defaultValue: ident ? null : def,
                    // GENERATED ALWAYS identities and virtual columns reject explicit values.
                    editable: category !== "binary" && r.VIRT !== "YES" && !(ident && r.GEN === "ALWAYS")
                };
            }),
            isView,
            hasRowid: !isView,
            dropKeyword: objectType
        };
    }
    async indexes(target) {
        const owner = target.schema || this.currentSchema;
        const rows = await this.rows(`SELECT i.index_name AS name, i.uniqueness AS uniq, i.index_type AS itype, c.column_name AS col, c.column_position AS pos,
              (SELECT COUNT(*) FROM all_constraints k WHERE k.owner = i.table_owner AND k.table_name = i.table_name AND k.constraint_type = 'P' AND k.index_name = i.index_name) AS pk
         FROM all_indexes i JOIN all_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
        WHERE i.table_owner = :1 AND i.table_name = :2
        ORDER BY i.index_name, c.column_position`, [owner, target.object]);
        const byName = new Map();
        for (const r of rows) {
            const name = String(r.NAME);
            const entry = byName.get(name) ?? { name, columns: [], unique: r.UNIQ === "UNIQUE", primary: Number(r.PK) > 0, type: String(r.ITYPE ?? "").toLowerCase() || undefined };
            entry.columns.push(String(r.COL));
            byName.set(name, entry);
        }
        return [...byName.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
    }
    classify(text) {
        const statements = splitOracleScript(text);
        if (!statements.length)
            throw new types_1.DbError("Enter a query to run.");
        return statements;
    }
    async runQuery(text, context, control) {
        const start = Date.now();
        const statements = splitOracleScript(text);
        if (!statements.length)
            throw new types_1.DbError("Enter a query to run.");
        // A dedicated session that is dropped afterwards, so CURRENT_SCHEMA, transactions and DBMS_OUTPUT never leak.
        return this.withConnection(async (c) => {
            control?.onCancel(() => c.break());
            if (context.schema)
                await c.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${(0, sql_builder_1.quoteIdent)(context.schema, "oracle")}`);
            if (this.readOnly)
                await c.execute("SET TRANSACTION READ ONLY");
            const plsql = statements.some(s => s.plsql);
            if (plsql)
                await c.execute("BEGIN DBMS_OUTPUT.ENABLE(NULL); END;");
            let shown;
            let affected = 0;
            let anyAffected = false;
            const done = [];
            try {
                for (const statement of statements) {
                    let r;
                    try {
                        r = await c.execute(statement.text, [], { ...this.options(types_1.LIMITS.maxQueryRows + 1), autoCommit: !this.readOnly });
                    }
                    catch (error) {
                        const e = error;
                        if (typeof e.offset === "number")
                            e.devsnipPosition = statement.offset + e.offset;
                        throw error;
                    }
                    if (r.metaData)
                        shown = { rows: r.rows ?? [], columns: r.metaData.map(m => m.name) };
                    else if (typeof r.rowsAffected === "number") {
                        affected += r.rowsAffected;
                        anyAffected = true;
                    }
                    done.push(statement.verb.toUpperCase());
                }
            }
            finally {
                if (this.readOnly)
                    await c.rollback().catch(() => undefined);
                if (statements.some(s => s.write))
                    this.invalidate();
            }
            const output = plsql ? await this.dbmsOutput(c) : "";
            if (shown)
                return this.queryResult(start, shown.rows, shown.columns, anyAffected ? affected : undefined, types_1.LIMITS.maxQueryRows, output || undefined);
            const summary = `${[...new Set(done)].join(", ") || "Statement"} completed${anyAffected ? `, ${affected} row${affected === 1 ? "" : "s"} affected` : ""}.`;
            return this.queryResult(start, [], [], anyAffected ? affected : undefined, types_1.LIMITS.maxQueryRows, output ? `${summary}\n\n${output}` : summary);
        }, true);
    }
    /** Lines a PL/SQL block printed with DBMS_OUTPUT.PUT_LINE. */
    async dbmsOutput(c) {
        const lines = [];
        for (let i = 0; i < 2000; i++) {
            const r = await c.execute("BEGIN DBMS_OUTPUT.GET_LINE(:line, :status); END;", {
                line: { dir: this.oracledb.BIND_OUT, type: this.oracledb.STRING, maxSize: 32767 },
                status: { dir: this.oracledb.BIND_OUT, type: this.oracledb.NUMBER }
            }).catch(() => undefined);
            if (!r || Number(r.outBinds?.status) !== 0)
                break;
            lines.push(String(r.outBinds?.line ?? ""));
        }
        return lines.join("\n");
    }
}
exports.OracleAdapter = OracleAdapter;
//# sourceMappingURL=oracle.js.map