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
exports.PostgresAdapter = void 0;
const fs = __importStar(require("fs"));
const crypto_1 = require("crypto");
const sql_builder_1 = require("../sql-builder");
const types_1 = require("../types");
const sql_base_1 = require("./sql-base");
/**
 * Type ids parsed into JS values. Everything else (dates, times, intervals,
 * arrays, numerics, uuids...) stays as the server's text, so an edited value
 * round-trips exactly, with no time-zone shifts or float rounding.
 */
const PARSED_OIDS = new Set([16, 17, 21, 23, 26, 114, 700, 701, 3802]);
const DECLARE = "DECLARE devsnip_console NO SCROLL CURSOR FOR ";
/** Reads a certificate or key file named in the connection string (sslrootcert, sslcert, sslkey). */
function readPem(file, label) {
    if (!file)
        return undefined;
    try {
        return fs.readFileSync(file.replace(/^~(?=\/|\\)/, process.env.HOME ?? "~"), "utf8");
    }
    catch {
        throw new types_1.DbError(`The ${label} file could not be read: ${file}`, "Check the path in the connection string.");
    }
}
/**
 * PostgreSQL, and CockroachDB through the same wire protocol. CockroachDB is
 * recognised from its version string, so a postgresql:// URL works too.
 */
class PostgresAdapter extends sql_base_1.SqlAdapter {
    constructor(spec, readOnly = false) {
        super();
        this.spec = spec;
        this.readOnly = readOnly;
        this.dialect = "postgres";
        this.pools = new Map();
        this.defaultDb = "postgres";
        this.kind = spec.kind === "cockroachdb" ? "cockroachdb" : "postgres";
        this.cockroach = this.kind === "cockroachdb";
        this.defaultDb = spec.database || (this.cockroach ? "defaultdb" : spec.user || "postgres");
    }
    ssl() {
        const o = this.spec.options;
        const mode = (o.sslmode ?? "").toLowerCase();
        if (mode === "disable" || (!this.spec.ssl && !mode && !o.sslrootcert))
            return false;
        // Client certificates authenticate the user (common with CockroachDB and cloud databases).
        const files = { ca: readPem(o.sslrootcert, "sslrootcert"), cert: readPem(o.sslcert, "sslcert"), key: readPem(o.sslkey, "sslkey") };
        const verify = mode === "verify-ca" || mode === "verify-full" || (!!files.ca && mode !== "require" && mode !== "no-verify");
        // libpq "require"/"prefer" encrypt without verifying the certificate.
        return {
            rejectUnauthorized: verify,
            ...(files.ca ? { ca: files.ca } : {}),
            ...(files.cert ? { cert: files.cert } : {}),
            ...(files.key ? { key: files.key } : {}),
            // verify-ca checks the chain but not the host name.
            ...(mode === "verify-ca" ? { checkServerIdentity: () => undefined } : {})
        };
    }
    pool(database) {
        const name = database || this.defaultDb;
        let pool = this.pools.get(name);
        if (pool)
            return pool;
        if (this.pools.size >= 8)
            throw new types_1.DbError("Too many databases open on this connection. Disconnect and reconnect to free them.");
        // Loaded on first use, so opening VS Code never pays for the driver.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pg = require("pg");
        pool = new pg.Pool({
            host: this.spec.host,
            port: this.spec.port,
            user: this.spec.user || undefined,
            password: this.spec.password || undefined,
            database: name,
            ssl: this.ssl(),
            max: 4,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: types_1.LIMITS.connectTimeoutMs,
            statement_timeout: types_1.LIMITS.queryTimeoutMs,
            query_timeout: types_1.LIMITS.queryTimeoutMs + 5000,
            application_name: this.spec.options.application_name || "DevSnip Pro",
            // Read-only connections are read-only on the server too, so a write hidden in a function call still fails.
            options: [this.spec.options.options, this.readOnly ? "-c default_transaction_read_only=on" : ""].filter(Boolean).join(" ") || undefined,
            types: { getTypeParser: ((oid, format) => PARSED_OIDS.has(oid) ? pg.types.getTypeParser(oid, format) : (value) => value) }
        });
        // An idle client dropped by the server must not crash the extension host.
        pool.on("error", () => undefined);
        this.pools.set(name, pool);
        return pool;
    }
    async connect() {
        const result = await this.pool().query("SELECT version() AS version, current_database() AS db");
        const row = result.rows[0] ?? {};
        const raw = String(row.version ?? "");
        this.cockroach = /CockroachDB/i.test(raw);
        // The pool was keyed by the configured name; keep it under the real one.
        const db = String(row.db ?? this.defaultDb);
        const pool = this.pools.get(this.defaultDb);
        if (pool && db !== this.defaultDb) {
            this.pools.delete(this.defaultDb);
            this.pools.set(db, pool);
        }
        this.defaultDb = db;
        const version = this.cockroach
            ? raw.replace(/^CockroachDB (?:CCL |OSS )?(v[\d.]+\S*).*$/s, "CockroachDB $1")
            : raw.replace(/^PostgreSQL ([\d.]+).*$/s, "PostgreSQL $1");
        return { version, defaultDatabase: this.defaultDb };
    }
    async close() {
        const pools = [...this.pools.values()];
        this.pools.clear();
        await Promise.allSettled(pools.map(pool => pool.end()));
    }
    async ping() {
        await this.pool().query("SELECT 1");
    }
    async exec(database, sql, params) {
        const result = await this.pool(database).query({ text: sql, values: params });
        return { rows: result.rows, columns: (result.fields ?? []).map(f => f.name), affected: result.rowCount ?? undefined };
    }
    async listDatabases() {
        const result = await this.pool().query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname");
        return result.rows.map(r => String(r.datname));
    }
    async listSchemas(database) {
        const result = await this.pool(database).query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'crdb_internal') AND has_schema_privilege(oid, 'USAGE') ORDER BY nspname = 'public' DESC, nspname");
        return result.rows.map(r => String(r.nspname));
    }
    async listObjects(database, schema) {
        const result = await this.pool(database).query(`SELECT c.relname AS name, c.relkind AS kind, c.reltuples::bigint AS rows
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY c.relname`, [schema || "public"]);
        return result.rows.map(r => ({
            name: String(r.name),
            type: r.kind === "v" || r.kind === "m" ? "view" : "table",
            // CockroachDB reports 0 until statistics exist, which would read as "empty".
            rows: !this.cockroach && Number(r.rows) >= 0 ? Number(r.rows) : undefined
        }));
    }
    async introspect(target) {
        // to_jsonb(a) reads attidentity/attgenerated without failing on servers that predate them.
        const result = await this.pool(target.database).query(`SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS def,
              to_jsonb(a) ->> 'attidentity' AS identity,
              to_jsonb(a) ->> 'attgenerated' AS generated,
              c.relkind AS relkind,
              EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`, [target.schema || "public", target.object]);
        const relkind = String(result.rows[0]?.relkind ?? "r");
        // CockroachDB adds a hidden "rowid" primary key to tables without one; SELECT * leaves it out.
        let hidden = new Set();
        if (this.cockroach && result.rows.length) {
            const h = await this.pool(target.database).query("SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND is_hidden = 'YES'", [target.schema || "public", target.object]);
            hidden = new Set(h.rows.map(r => String(r.column_name)));
        }
        const hasRowid = result.rows.some(r => hidden.has(String(r.name)) && String(r.name) === "rowid" && r.pk === true);
        const columns = result.rows.filter(r => !hidden.has(String(r.name))).map(r => {
            const dataType = String(r.type);
            const category = (0, sql_builder_1.categorize)(dataType);
            const def = r.def === null ? null : String(r.def);
            const identity = String(r.identity ?? "");
            const generated = String(r.generated ?? "");
            return {
                name: String(r.name),
                dataType,
                category,
                nullable: r.nullable === true,
                primaryKey: r.pk === true,
                // CockroachDB's SERIAL defaults to unique_rowid().
                autoIncrement: identity === "a" || identity === "d" || /^(nextval|unique_rowid)\(/.test(def ?? ""),
                defaultValue: def,
                // GENERATED ALWAYS identities and generated columns reject explicit values.
                editable: category !== "binary" && generated !== "s" && identity !== "a"
            };
        });
        return {
            columns,
            isView: relkind === "v" || relkind === "m",
            hasRowid,
            dropKeyword: relkind === "v" ? "VIEW" : relkind === "m" ? "MATERIALIZED VIEW" : relkind === "f" ? "FOREIGN TABLE" : "TABLE"
        };
    }
    async indexes(target) {
        const schema = target.schema || "public";
        if (this.cockroach) {
            const r = await this.pool(target.database).query(`SELECT index_name AS name, non_unique, column_name AS col, direction FROM information_schema.statistics
          WHERE table_schema = $1 AND table_name = $2 AND storing = 'NO' AND implicit = 'NO' ORDER BY index_name, seq_in_index`, [schema, target.object]);
            const byName = new Map();
            for (const row of r.rows) {
                const name = String(row.name);
                const entry = byName.get(name) ?? { name, columns: [], unique: row.non_unique === "NO" || row.non_unique === false, primary: name.endsWith("_pkey") || name === "primary", type: "btree" };
                entry.columns.push(`${row.col}${row.direction === "DESC" ? " DESC" : ""}`);
                byName.set(name, entry);
            }
            return [...byName.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
        }
        const r = await this.pool(target.database).query(`SELECT i.relname AS name, ix.indisunique AS uniq, ix.indisprimary AS pk, am.amname AS method, pg_get_expr(ix.indpred, ix.indrelid) AS pred,
              to_json(ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k, true) FROM generate_series(1, ix.indnkeyatts) AS k ORDER BY k)) AS cols
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         LEFT JOIN pg_am am ON am.oid = i.relam
        WHERE n.nspname = $1 AND t.relname = $2
        ORDER BY ix.indisprimary DESC, i.relname`, [schema, target.object]);
        return r.rows.map(row => ({
            name: String(row.name),
            columns: row.cols ?? [],
            unique: row.uniq === true,
            primary: row.pk === true,
            type: row.method ? String(row.method) : undefined,
            detail: row.pred ? `WHERE ${row.pred}` : undefined
        }));
    }
    async runQuery(text, context, control) {
        const start = Date.now();
        const statements = this.classify(text);
        const pool = this.pool(context.database);
        const client = await pool.connect();
        // A client whose session state is unknown (an open BEGIN, a SET) is destroyed rather than reused.
        let destroy = false;
        // Cancelling asks the server to stop this session's statement: pg_cancel_backend on PostgreSQL,
        // CANCEL QUERIES by a one-off application name on CockroachDB.
        if (this.cockroach) {
            const tag = `devsnip-${(0, crypto_1.randomUUID)()}`;
            await client.query(`SET application_name = '${tag}'`);
            destroy = true;
            control?.onCancel(() => pool.query("CANCEL QUERIES IF EXISTS (SELECT query_id FROM [SHOW CLUSTER STATEMENTS] WHERE application_name = $1)", [tag]).catch(() => undefined));
        }
        else {
            const pid = client.processID;
            if (pid)
                control?.onCancel(() => pool.query("SELECT pg_cancel_backend($1)", [pid]).catch(() => undefined));
        }
        const at = (error, shift) => {
            const e = error;
            if (e && /^\d+$/.test(String(e.position ?? "")))
                e.devsnipPosition = Math.max(0, Number(e.position) - 1 - shift);
            return error;
        };
        try {
            if (context.schema)
                await client.query(`SET search_path TO ${(0, sql_builder_1.quoteIdent)(context.schema, "postgres")}, public`);
            const only = statements.length === 1 ? statements[0] : undefined;
            // A single SELECT runs through a cursor, so a huge result never reaches memory.
            if (only && !only.write && ["select", "with", "values", "table"].includes(only.verb)) {
                await client.query("BEGIN");
                try {
                    try {
                        await client.query(`${DECLARE}${only.text}`);
                    }
                    catch (error) {
                        // Positions count from the start of the DECLARE; shift them back onto the user's text.
                        throw at(error, DECLARE.length - only.offset);
                    }
                    const fetched = await client.query(`FETCH ${types_1.LIMITS.maxQueryRows + 1} FROM devsnip_console`);
                    await client.query("COMMIT");
                    return this.queryResult(start, fetched.rows, (fetched.fields ?? []).map(f => f.name), undefined, types_1.LIMITS.maxQueryRows);
                }
                catch (error) {
                    await client.query("ROLLBACK").catch(() => { destroy = true; });
                    throw error;
                }
            }
            destroy = true;
            let raw;
            try {
                raw = (await client.query(text));
            }
            catch (error) {
                throw at(error, 0);
            }
            const results = Array.isArray(raw) ? raw : [raw];
            const withRows = [...results].reverse().find(r => (r.fields ?? []).length > 0);
            const affected = results.reduce((sum, r) => sum + (r.command && r.command !== "SELECT" && typeof r.rowCount === "number" ? r.rowCount : 0), 0);
            const commands = results.map(r => r.command).filter(Boolean);
            const message = withRows ? undefined : `${commands.join(", ") || "Statement"} completed${affected ? `, ${affected} row${affected === 1 ? "" : "s"} affected` : ""}.`;
            return this.queryResult(start, (withRows?.rows ?? []), (withRows?.fields ?? []).map(f => f.name), affected || undefined, types_1.LIMITS.maxQueryRows, message);
        }
        catch (error) {
            destroy = true;
            throw error;
        }
        finally {
            if (context.schema && !destroy)
                await client.query("RESET search_path").catch(() => { destroy = true; });
            client.release(destroy);
            if (statements.some(s => s.write))
                this.invalidate();
        }
    }
}
exports.PostgresAdapter = PostgresAdapter;
//# sourceMappingURL=postgres.js.map