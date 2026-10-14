"use strict";
/**
 * Builds the SQL behind the data grid and the row editor, for every SQL
 * dialect the Database Client speaks.
 *
 * Every value is a bound parameter. Identifiers are always quoted, and only
 * names that came back from introspection (validated by the caller against
 * `describe`) ever reach these functions, so user text never becomes SQL.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyStatements = exports.buildDelete = exports.buildUpdate = exports.buildInsert = exports.buildSelect = exports.keyStrategyFor = exports.CLICKHOUSE_READ_ONLY = exports.requireColumn = exports.escapeLike = exports.coerceInput = exports.categorize = exports.placeholder = exports.qualifiedName = exports.quoteIdent = exports.CTID_COLUMN = exports.ROWID_COLUMN = void 0;
const sql_1 = require("../toolkits/engines/sql");
const types_1 = require("./types");
/** Hidden columns that identify rows of tables without a primary key. */
exports.ROWID_COLUMN = "__rowid";
exports.CTID_COLUMN = "__ctid";
function quoteIdent(name, d) {
    if (typeof name !== "string" || !name || name.length > 256 || name.includes("\u0000"))
        throw new types_1.DbError("Invalid identifier.");
    if (d === "mysql")
        return "`" + name.replace(/`/g, "``") + "`";
    if (d === "sqlserver")
        return "[" + name.replace(/]/g, "]]") + "]";
    // ClickHouse escapes inside quoted identifiers with a backslash.
    if (d === "clickhouse")
        return "`" + name.replace(/[\\`]/g, m => "\\" + m) + "`";
    return '"' + name.replace(/"/g, '""') + '"';
}
exports.quoteIdent = quoteIdent;
function qualifiedName(target, d) {
    const table = quoteIdent(target.object, d);
    if (d === "postgres" || d === "sqlserver" || d === "oracle")
        return target.schema ? `${quoteIdent(target.schema, d)}.${table}` : table;
    if (d === "mysql" || d === "clickhouse")
        return target.database ? `${quoteIdent(target.database, d)}.${table}` : table;
    // SQLite: "main" is implicit; attached databases are addressed by name.
    return target.database && target.database !== "main" ? `${quoteIdent(target.database, d)}.${table}` : table;
}
exports.qualifiedName = qualifiedName;
function placeholder(n, d) {
    if (d === "postgres")
        return `$${n}`;
    if (d === "sqlserver")
        return `@p${n}`;
    if (d === "oracle")
        return `:${n}`;
    // ClickHouse binds typed parameters by name; values travel as text and are CAST by the caller.
    if (d === "clickhouse")
        return `{p${n}:String}`;
    return "?";
}
exports.placeholder = placeholder;
/** Maps a server type name to the editor's value category. */
function categorize(dataType) {
    let t = String(dataType ?? "").toLowerCase().trim();
    // ClickHouse wrappers: Nullable(T), LowCardinality(T).
    while (/^(nullable|lowcardinality)\((.*)\)$/.test(t))
        t = t.replace(/^(nullable|lowcardinality)\((.*)\)$/, "$2");
    if (/^(bool|boolean|bit)$/.test(t) || /^tinyint\(1\)/.test(t))
        return "boolean";
    if (/json|hstore|^(array|map|tuple|nested|object)\(/.test(t))
        return "json";
    // Oracle BINARY_FLOAT/BINARY_DOUBLE are numbers, not bytes.
    if (/^binary_(float|double)$/.test(t))
        return "number";
    if (/bytea|blob|binary|image|rowversion|^(long )?raw\b|^bfile$/.test(t))
        return "binary";
    if (/date|time|year|interval/.test(t))
        return "date";
    if (/^(small|big|tiny|medium)?int(eger|\d)?\b|^u?int(8|16|32|64|128|256)$|^(small|big)?serial|numeric|decimal|real|double|float|money|^number/.test(t))
        return "number";
    if (/char|text|clob|uuid|uniqueidentifier|enum|^set\b|citext|name|xml|inet|cidr|macaddr|^(fixed)?string\b/.test(t))
        return "text";
    return "other";
}
exports.categorize = categorize;
const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
/** Turns what the user typed into a bound parameter value, checking it against the column type. */
function coerceInput(input, column, d) {
    if (input.mode === "null") {
        if (!column.nullable)
            throw new types_1.DbError(`${column.name} cannot be NULL.`);
        return null;
    }
    const raw = String(input.value ?? "");
    switch (column.category) {
        case "number": {
            const text = raw.trim();
            if (!NUMERIC.test(text))
                throw new types_1.DbError(`${column.name} expects a number, not "${raw.slice(0, 40)}".`);
            const n = Number(text);
            // Large integers and exact decimals travel as text so no digits are lost.
            return Number.isSafeInteger(n) && String(n) === text ? n : text;
        }
        case "boolean": {
            const text = raw.trim().toLowerCase();
            const value = ["true", "t", "1", "yes", "y", "on"].includes(text) ? true : ["false", "f", "0", "no", "n", "off"].includes(text) ? false : undefined;
            if (value === undefined)
                throw new types_1.DbError(`${column.name} expects true or false.`);
            if (d === "clickhouse")
                return value ? "true" : "false";
            return d === "mysql" || d === "sqlite" ? (value ? 1 : 0) : value;
        }
        case "json": {
            try {
                JSON.parse(raw);
            }
            catch (error) {
                throw new types_1.DbError(`${column.name} must be valid JSON: ${error.message}`);
            }
            return raw;
        }
        case "binary":
            throw new types_1.DbError(`${column.name} is binary and cannot be edited here. Use the Query tab.`);
        default:
            return raw;
    }
}
exports.coerceInput = coerceInput;
class Params {
    constructor(d) {
        this.d = d;
        this.values = [];
    }
    add(value) {
        this.values.push(this.d === "clickhouse" && value !== null && value !== undefined ? String(value) : value);
        return placeholder(this.values.length, this.d);
    }
    /** A value compared with a column: ClickHouse parameters are text, so they are cast to the column's type. */
    typed(value, column) {
        const ref = this.add(value);
        return this.d === "clickhouse" ? `CAST(${ref}, '${column.dataType.replace(/[\\']/g, m => "\\" + m)}')` : ref;
    }
}
/** Oracle LOBs and LONGs cannot be cast to text in a WHERE clause beyond 4000 characters. */
const ORACLE_LOB = /^(n?clob|long)$/i;
function textCast(column, d) {
    const q = quoteIdent(column.name, d);
    if (d === "postgres")
        return `CAST(${q} AS TEXT)`;
    if (d === "mysql")
        return `CAST(${q} AS CHAR)`;
    if (d === "sqlserver")
        return `CAST(${q} AS NVARCHAR(MAX))`;
    if (d === "oracle")
        return ORACLE_LOB.test(column.dataType) ? `DBMS_LOB.SUBSTR(${q}, 4000, 1)` : `TO_CHAR(${q})`;
    if (d === "clickhouse")
        return `toString(${q})`;
    return `CAST(${q} AS TEXT)`;
}
/** A case-insensitive LIKE in every dialect. */
function likeClause(column, pattern, params, d) {
    const p = params.add(pattern);
    if (d === "postgres" || d === "clickhouse")
        return `${textCast(column, d)} ILIKE ${p}${d === "clickhouse" ? "" : LIKE_ESCAPE}`;
    if (d === "oracle")
        return `UPPER(${textCast(column, d)}) LIKE UPPER(${p})${LIKE_ESCAPE}`;
    return `${textCast(column, d)} LIKE ${p}${LIKE_ESCAPE}`;
}
/**
 * Escapes LIKE wildcards so a search for "50%" matches the text "50%".
 * "!" is the escape character because a backslash is itself an escape in
 * MySQL string literals (and not in the others), so no literal works everywhere.
 */
function escapeLike(text, d) {
    // ClickHouse has no ESCAPE clause: a backslash escapes wildcards there.
    if (d === "clickhouse")
        return text.replace(/[\\%_]/g, m => "\\" + m);
    return text.replace(d === "sqlserver" ? /[!%_[]/g : /[!%_]/g, m => "!" + m);
}
exports.escapeLike = escapeLike;
const LIKE_ESCAPE = " ESCAPE '!'";
function searchable(column, d) {
    if (column.category === "binary")
        return false;
    if (d === "sqlserver" && /^(image|geography|geometry|hierarchyid|sql_variant|timestamp|rowversion)/i.test(column.dataType))
        return false;
    // Oracle: TO_CHAR fails on JSON, XMLTYPE and object types.
    if (d === "oracle" && !["text", "number", "date"].includes(column.category))
        return false;
    return true;
}
function filterValue(column, raw, d) {
    if (column.category === "number" || column.category === "boolean")
        return coerceInput({ mode: "value", value: raw }, column, d);
    return raw;
}
function filterClause(rule, column, params, d) {
    if (!types_1.FILTER_OPS.includes(rule.op))
        throw new types_1.DbError(`Unknown filter operator "${rule.op}".`);
    const q = quoteIdent(column.name, d);
    const value = String(rule.value ?? "");
    switch (rule.op) {
        case "null": return `${q} IS NULL`;
        case "notnull": return `${q} IS NOT NULL`;
        case "contains": return likeClause(column, `%${escapeLike(value, d)}%`, params, d);
        case "starts": return likeClause(column, `${escapeLike(value, d)}%`, params, d);
        case "ends": return likeClause(column, `%${escapeLike(value, d)}`, params, d);
        case "in": {
            const items = value.split(",").map(s => s.trim()).filter(Boolean);
            if (!items.length)
                throw new types_1.DbError(`"in" on ${column.name} needs a comma-separated list.`);
            if (items.length > 500)
                throw new types_1.DbError("An \"in\" filter takes at most 500 values.");
            return `${q} IN (${items.map(item => params.typed(filterValue(column, item, d), column)).join(", ")})`;
        }
        default: {
            const op = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[rule.op];
            return `${q} ${op} ${params.typed(filterValue(column, value, d), column)}`;
        }
    }
}
/** Looks a column up by name, so only introspected names are ever quoted into SQL. */
function requireColumn(columns, name) {
    const column = columns.find(c => c.name === name);
    if (!column)
        throw new types_1.DbError(`Column "${String(name).slice(0, 80)}" does not exist. Refresh the table.`);
    return column;
}
exports.requireColumn = requireColumn;
function whereFor(request, columns, params, d) {
    const parts = [];
    for (const rule of request.filters ?? [])
        parts.push(filterClause(rule, requireColumn(columns, rule.column), params, d));
    const search = (request.search ?? "").trim();
    if (search) {
        const targets = columns.filter(c => searchable(c, d));
        if (targets.length) {
            const pattern = `%${escapeLike(search, d)}%`;
            // SQL Server and MySQL need one parameter per use; Postgres could reuse $n but this keeps it uniform.
            parts.push(`(${targets.map(c => likeClause(c, pattern, params, d)).join(" OR ")})`);
        }
    }
    return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}
exports.CLICKHOUSE_READ_ONLY = "ClickHouse rows have no unique key, so they cannot be edited or deleted here. Insert works; use ALTER TABLE ... UPDATE or DELETE in the Query tab to change rows.";
/**
 * How rows are identified for updates and deletes. `hasRowid` means the table
 * has a stable hidden row id: SQLite's rowid, Oracle's ROWID, or the hidden
 * rowid column CockroachDB adds to tables without a primary key.
 */
function keyStrategyFor(columns, d, isView, hasRowid) {
    if (isView)
        return { strategy: "none", keyColumns: [], readOnly: "Views are read-only here. Change the underlying tables, or use the Query tab." };
    if (d === "clickhouse")
        return { strategy: "none", keyColumns: [], readOnly: exports.CLICKHOUSE_READ_ONLY };
    const pk = columns.filter(c => c.primaryKey).map(c => c.name);
    if (pk.length)
        return { strategy: "primary", keyColumns: pk };
    if ((d === "sqlite" || d === "oracle" || d === "postgres") && hasRowid)
        return { strategy: "rowid", keyColumns: [exports.ROWID_COLUMN] };
    if (d === "postgres")
        return { strategy: "ctid", keyColumns: [exports.CTID_COLUMN] };
    return { strategy: "none", keyColumns: [], readOnly: "This table has no primary key, so rows cannot be identified safely for editing or deleting. Inserting works; add a primary key, or use the Query tab." };
}
exports.keyStrategyFor = keyStrategyFor;
/** Alias that lets Oracle select ROWID next to "t.*". */
const ORACLE_ALIAS = "t__";
function buildSelect(request, columns, strategy, d) {
    const table = qualifiedName(request.target, d);
    const params = new Params(d);
    const where = whereFor(request, columns, params, d);
    const countParams = [...params.values];
    const pageSize = Math.max(1, Math.min(500, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const offset = (page - 1) * pageSize;
    let extra = "";
    if (strategy === "rowid") {
        if (d === "oracle")
            extra = `, ROWIDTOCHAR(${ORACLE_ALIAS}.ROWID) AS ${quoteIdent(exports.ROWID_COLUMN, d)}`;
        // CockroachDB's rowid is an INT8 beyond 2^53, so it travels as text.
        else if (d === "postgres")
            extra = `, ${table}.rowid::STRING AS ${quoteIdent(exports.ROWID_COLUMN, d)}`;
        else
            extra = `, rowid AS ${quoteIdent(exports.ROWID_COLUMN, d)}`;
    }
    if (strategy === "ctid")
        extra = `, ctid::text AS ${quoteIdent(exports.CTID_COLUMN, d)}`;
    // "t.*" rather than "*" so the extra column can follow it in every dialect.
    const projection = d === "oracle" ? `${ORACLE_ALIAS}.*${extra}` : d === "sqlite" || d === "postgres" ? `${table}.*${extra}` : "*";
    const from = d === "oracle" ? `${table} ${ORACLE_ALIAS}` : table;
    let order = "";
    if (request.sort) {
        const column = requireColumn(columns, request.sort.column);
        order = ` ORDER BY ${quoteIdent(column.name, d)} ${request.sort.dir === "desc" ? "DESC" : "ASC"}`;
    }
    else {
        const pk = columns.filter(c => c.primaryKey);
        if (pk.length && d !== "clickhouse")
            order = ` ORDER BY ${pk.map(c => quoteIdent(c.name, d)).join(", ")}`;
        else if (d === "sqlserver")
            order = " ORDER BY (SELECT NULL)";
        // Pages of a table without a key stay stable when ordered by the row id.
        else if (d === "oracle" && strategy === "rowid")
            order = ` ORDER BY ${ORACLE_ALIAS}.ROWID`;
    }
    const limit = d === "sqlserver" || d === "oracle"
        ? ` OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`
        : ` LIMIT ${pageSize} OFFSET ${offset}`;
    return {
        select: { sql: `SELECT ${projection} FROM ${from}${where}${order}${limit}`, params: params.values },
        count: { sql: `SELECT COUNT(*) AS ${quoteIdent("n", d)} FROM ${from}${where}`, params: countParams }
    };
}
exports.buildSelect = buildSelect;
function keyClause(key, strategy, columns, params, d) {
    if (!key || typeof key !== "object")
        throw new types_1.DbError("The row to change was not identified.");
    if (strategy === "rowid") {
        const raw = String(key[exports.ROWID_COLUMN] ?? "");
        if (d === "oracle") {
            if (!/^[A-Za-z0-9+/]{18}$/.test(raw))
                throw new types_1.DbError("The row id is missing. Refresh and try again.");
            return `ROWID = CHARTOROWID(${params.add(raw)})`;
        }
        if (d === "postgres") {
            if (!/^\d{1,20}$/.test(raw))
                throw new types_1.DbError("The row id is missing. Refresh and try again.");
            return `rowid = ${params.add(raw)}::INT8`;
        }
        const id = Number(raw);
        if (!raw || !Number.isSafeInteger(id))
            throw new types_1.DbError("The row id is missing. Refresh and try again.");
        return `rowid = ${params.add(id)}`;
    }
    if (strategy === "ctid") {
        const ctid = String(key[exports.CTID_COLUMN] ?? "");
        if (!/^\(\d+,\d+\)$/.test(ctid))
            throw new types_1.DbError("The row id is missing. Refresh and try again.");
        return `ctid = ${params.add(ctid)}::tid`;
    }
    if (strategy !== "primary")
        throw new types_1.DbError("Rows of this table cannot be changed here.");
    const pk = columns.filter(c => c.primaryKey);
    if (!pk.length)
        throw new types_1.DbError("This table has no primary key.");
    return pk.map(c => {
        if (!(c.name in key))
            throw new types_1.DbError(`The key column ${c.name} is missing. Refresh and try again.`);
        const value = key[c.name];
        if (value === null || value === undefined)
            return `${quoteIdent(c.name, d)} IS NULL`;
        return `${quoteIdent(c.name, d)} = ${params.add(typeof value === "object" ? JSON.stringify(value) : value)}`;
    }).join(" AND ");
}
function editableValues(values, columns) {
    if (!values || typeof values !== "object")
        throw new types_1.DbError("No values were sent.");
    return Object.entries(values).map(([name, input]) => {
        const column = requireColumn(columns, name);
        if (!input || !["value", "null", "default"].includes(input.mode))
            throw new types_1.DbError(`Invalid value for ${name}.`);
        if (!column.editable && input.mode !== "default")
            throw new types_1.DbError(`${name} is read-only.`);
        return [column, input];
    });
}
function buildInsert(target, columns, values, d) {
    const table = qualifiedName(target, d);
    const params = new Params(d);
    const set = editableValues(values, columns).filter(([, input]) => input.mode !== "default");
    if (!set.length) {
        if (d === "mysql")
            return { sql: `INSERT INTO ${table} () VALUES ()`, params: [] };
        // Oracle has no DEFAULT VALUES; one column set to DEFAULT does the same.
        if (d === "oracle")
            return { sql: `INSERT INTO ${table} (${quoteIdent(columns[0].name, d)}) VALUES (DEFAULT)`, params: [] };
        return { sql: `INSERT INTO ${table} DEFAULT VALUES`, params: [] };
    }
    const names = set.map(([c]) => quoteIdent(c.name, d)).join(", ");
    const placeholders = set.map(([c, input]) => params.add(coerceInput(input, c, d))).join(", ");
    return { sql: `INSERT INTO ${table} (${names}) VALUES (${placeholders})`, params: params.values };
}
exports.buildInsert = buildInsert;
function buildUpdate(target, columns, key, strategy, values, d) {
    const table = qualifiedName(target, d);
    const params = new Params(d);
    const set = editableValues(values, columns);
    if (!set.length)
        throw new types_1.DbError("Nothing changed.");
    const assignments = set.map(([c, input]) => {
        if (input.mode === "default") {
            if (d === "sqlite")
                throw new types_1.DbError("SQLite cannot reset a column to its default in an UPDATE.");
            return `${quoteIdent(c.name, d)} = DEFAULT`;
        }
        return `${quoteIdent(c.name, d)} = ${params.add(coerceInput(input, c, d))}`;
    }).join(", ");
    const where = keyClause(key, strategy, columns, params, d);
    return { sql: `UPDATE ${table} SET ${assignments} WHERE ${where}`, params: params.values };
}
exports.buildUpdate = buildUpdate;
function buildDelete(target, columns, keys, strategy, d) {
    if (!Array.isArray(keys) || !keys.length)
        throw new types_1.DbError("Select at least one row to delete.");
    if (keys.length > 1000)
        throw new types_1.DbError("Delete at most 1000 rows at a time.");
    const table = qualifiedName(target, d);
    const params = new Params(d);
    const where = keys.map(key => `(${keyClause(key, strategy, columns, params, d)})`).join(" OR ");
    return { sql: `DELETE FROM ${table} WHERE ${where}`, params: params.values };
}
exports.buildDelete = buildDelete;
const READ_VERBS = new Set(["select", "show", "describe", "desc", "explain", "values", "table", "pragma", "with", "help"]);
const WRITE_WORDS = new Set(["insert", "update", "delete", "merge", "upsert", "replace", "create", "alter", "drop", "truncate", "grant", "revoke", "rename", "copy", "vacuum", "reindex", "cluster", "lock", "call", "exec", "execute", "do", "attach", "detach", "load", "set", "use", "begin", "commit", "rollback", "savepoint", "release", "start", "kill", "shutdown", "refresh", "comment", "analyze", "optimize", "repair", "flush", "reset", "discard", "notify", "listen", "prepare", "deallocate", "handler", "import", "install", "uninstall"]);
/** Splits a script into statements and decides which ones write or destroy data. */
function classifyStatements(text) {
    let tokens;
    try {
        tokens = (0, sql_1.tokenize)(text);
    }
    catch {
        // Unterminated quote: let the server report the syntax error, but treat it as a write.
        return [{ text: text.trim(), offset: text.length - text.trimStart().length, verb: "unknown", write: true }];
    }
    const statements = [[]];
    let depth = 0;
    for (const token of tokens) {
        if (token.type === "punct" && token.value === "(")
            depth++;
        if (token.type === "punct" && token.value === ")")
            depth = Math.max(0, depth - 1);
        if (token.type === "punct" && token.value === ";" && depth === 0) {
            statements.push([]);
            continue;
        }
        statements[statements.length - 1].push(token);
    }
    const out = [];
    for (const statement of statements) {
        const words = statement.filter(t => t.type === "word").map(t => t.value.toLowerCase());
        if (!words.length)
            continue;
        const body = statement.map(t => t.value).join("").trim();
        const offset = statement.find(t => t.type !== "space")?.offset ?? 0;
        const verb = words[0];
        const has = (w) => words.includes(w);
        const writesInside = words.some(w => ["insert", "update", "delete", "merge", "drop", "truncate", "alter", "create"].includes(w));
        let write;
        if (verb === "with")
            write = writesInside;
        else if (verb === "explain")
            write = has("analyze") && writesInside;
        else if (verb === "pragma")
            write = statement.some(t => t.type === "operator" && t.value === "=") || /\(/.test(body);
        // SELECT ... INTO creates a table (Postgres, SQL Server) or writes a file (MySQL).
        else if (verb === "select")
            write = has("into");
        else
            write = !READ_VERBS.has(verb) || WRITE_WORDS.has(verb);
        let danger;
        const target = () => words.slice(1, 4).filter(w => !["table", "if", "exists", "database", "schema", "view", "index", "from", "only"].includes(w))[0] ?? "";
        if (verb === "drop")
            danger = `DROP ${words[1]?.toUpperCase() ?? ""} ${target()}`.trim() + " permanently removes it and its data.";
        else if (verb === "truncate")
            danger = `TRUNCATE ${target()}`.trim() + " deletes every row.";
        else if (verb === "alter" && has("drop"))
            danger = "ALTER ... DROP removes a column or constraint, and the data in it.";
        else if (verb === "alter" && has("delete"))
            danger = "ALTER ... DELETE removes the matching rows.";
        else if (verb === "delete" || (verb === "with" && has("delete")))
            danger = has("where") ? "DELETE removes the matching rows." : "DELETE without WHERE removes every row in the table.";
        else if ((verb === "update" || (verb === "with" && has("update"))) && !has("where"))
            danger = "UPDATE without WHERE changes every row in the table.";
        out.push({ text: body, offset, verb, write, danger });
    }
    return out;
}
exports.classifyStatements = classifyStatements;
//# sourceMappingURL=sql-builder.js.map