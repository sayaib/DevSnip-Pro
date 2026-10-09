"use strict";
/**
 * Detects, parses, validates and masks database connection strings, and
 * turns driver errors into messages that are safe to show.
 *
 * Pure (no vscode, no drivers), so it is unit tested directly. Credentials
 * leave this module only inside a ConnectionSpec handed to an adapter; what
 * goes anywhere else - the webview, the profile list, error messages - has
 * been masked or redacted here first.
 */
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
exports.friendlyError = exports.redact = exports.secretsOf = exports.hasMaskedPassword = exports.restoreMaskedPassword = exports.maskConnectionString = exports.connectionWarnings = exports.splitKeyValues = exports.parseConnection = exports.detectKind = exports.normalizeConnectionString = exports.PASSWORD_MASK = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const types_1 = require("./types");
/** Stands in for a password in the UI; saving it back keeps the stored one. */
exports.PASSWORD_MASK = "********";
const DEFAULT_PORTS = { postgres: 5432, mysql: 3306, sqlserver: 1433, mongodb: 27017, redis: 6379 };
const SCHEMES = {
    postgres: "postgres", postgresql: "postgres", pg: "postgres",
    mysql: "mysql", mariadb: "mysql", mysql2: "mysql",
    sqlserver: "sqlserver", mssql: "sqlserver",
    sqlite: "sqlite", sqlite3: "sqlite", file: "sqlite",
    mongodb: "mongodb", "mongodb+srv": "mongodb",
    redis: "redis", rediss: "redis"
};
const SQLITE_EXT = /\.(db|sqlite|sqlite3|db3|s3db|sl3)$/i;
/** Trims quotes, `DATABASE_URL=` prefixes and `jdbc:` so every form parses the same way. */
function normalizeConnectionString(raw) {
    let text = String(raw ?? "").trim();
    const env = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(.+)$/s.exec(text);
    if (env && (/^["']?[a-z0-9+]+:/i.test(env[1]) || /^["']?[~./]/.test(env[1])))
        text = env[1].trim();
    if (/^(["'`]).*\1$/s.test(text))
        text = text.slice(1, -1).trim();
    return text.replace(/^jdbc:/i, "");
}
exports.normalizeConnectionString = normalizeConnectionString;
/** Which database a connection string is for, without validating the rest. */
function detectKind(raw) {
    const text = normalizeConnectionString(raw);
    if (!text)
        return undefined;
    if (/^(server|data source|address|addr|network address)\s*=/i.test(text))
        return "sqlserver";
    // ADO.NET key=value strings, even when the Server part is missing.
    if (!/^[a-z][a-z0-9+]*:\/\//i.test(text) && /(^|;)\s*(initial catalog|database|user id|uid|trusted_connection|integrated security)\s*=/i.test(text))
        return "sqlserver";
    const scheme = /^([a-z][a-z0-9+]*):/i.exec(text)?.[1]?.toLowerCase();
    if (scheme && SCHEMES[scheme])
        return SCHEMES[scheme];
    if (SQLITE_EXT.test(text) && !/^[a-z][a-z0-9+]*:\/\//i.test(text))
        return "sqlite";
    return undefined;
}
exports.detectKind = detectKind;
/**
 * Parses a connection string into what an adapter needs.
 * Relative SQLite paths resolve against `baseDir` (the workspace folder).
 */
function parseConnection(raw, baseDir) {
    const text = normalizeConnectionString(raw);
    if (!text)
        throw new types_1.DbError("Enter a connection string.", "For example postgresql://user:password@localhost:5432/app");
    if (text.length > 4096)
        throw new types_1.DbError("That connection string is too long.");
    const kind = detectKind(text);
    if (!kind) {
        const scheme = /^([a-z][a-z0-9+]*):/i.exec(text)?.[1];
        throw new types_1.DbError(scheme ? `${scheme}:// databases are not supported.` : "This does not look like a connection string.", "Supported: postgresql://, mysql://, mariadb://, sqlserver:// (or Server=...;), sqlite:///path/to/file.db, mongodb://, mongodb+srv://, redis://, rediss://.");
    }
    switch (kind) {
        case "sqlite": return parseSqlite(text, baseDir);
        case "sqlserver": return parseSqlServer(text);
        default: return parseUrl(text, kind);
    }
}
exports.parseConnection = parseConnection;
function parseSqlite(text, baseDir) {
    let file = text.replace(/^(sqlite3?|file):(\/\/)?/i, "");
    // sqlite:///abs/path keeps its leading slash; sqlite://./rel and file:./rel are relative.
    if (/^(sqlite3?|file):\/\/\//i.test(text))
        file = "/" + file.replace(/^\/+/, "");
    file = file.split("?")[0];
    try {
        file = decodeURIComponent(file);
    }
    catch { /* keep as typed */ }
    if (!file || file === ":memory:")
        throw new types_1.DbError("Point SQLite at a database file.", "In-memory databases cannot be browsed from another process. Use sqlite:///absolute/path/to/app.db");
    if (/^\/[a-z]:[\\/]/i.test(file))
        file = file.slice(1); // sqlite:///C:/x.db
    if (file.startsWith("~"))
        file = path.join(os.homedir(), file.slice(1));
    if (!path.isAbsolute(file)) {
        if (!baseDir)
            throw new types_1.DbError("A relative SQLite path needs an open workspace folder.", "Use an absolute path, e.g. sqlite:///Users/me/project/dev.db");
        file = path.resolve(baseDir, file);
    }
    return { kind: "sqlite", filePath: path.normalize(file), ssl: false, options: {} };
}
/** Splits `a=1;b={x;y}};c="q"` honouring braces and quotes, which may hide `;` inside a password. */
function splitKeyValues(text) {
    const out = [];
    let i = 0;
    while (i < text.length) {
        while (i < text.length && (text[i] === ";" || text[i] === " "))
            i++;
        const eq = text.indexOf("=", i);
        if (eq < 0)
            break;
        const key = text.slice(i, eq).trim().toLowerCase();
        let j = eq + 1;
        while (text[j] === " ")
            j++;
        const start = j;
        let value = "";
        if (text[j] === "{") {
            j++;
            while (j < text.length) {
                if (text[j] === "}" && text[j + 1] === "}") {
                    value += "}";
                    j += 2;
                    continue;
                }
                if (text[j] === "}") {
                    j++;
                    break;
                }
                value += text[j++];
            }
        }
        else if (text[j] === '"' || text[j] === "'") {
            const q = text[j++];
            while (j < text.length) {
                if (text[j] === q && text[j + 1] === q) {
                    value += q;
                    j += 2;
                    continue;
                }
                if (text[j] === q) {
                    j++;
                    break;
                }
                value += text[j++];
            }
        }
        else {
            const semi = text.indexOf(";", j);
            value = (semi < 0 ? text.slice(j) : text.slice(j, semi)).trim();
            j = semi < 0 ? text.length : semi;
        }
        out.push({ key, value, start, end: j });
        i = j;
    }
    return out;
}
exports.splitKeyValues = splitKeyValues;
const truthy = (v) => /^(true|yes|1|strict|mandatory)$/i.test(String(v ?? "").trim());
function parseSqlServer(text) {
    // URL form: sqlserver://user:pass@host:1433/db?encrypt=true
    if (/^(sqlserver|mssql):\/\/[^;]*@/i.test(text) && !/^(sqlserver|mssql):\/\/[^/@]*;/i.test(text)) {
        const spec = parseUrl(text, "sqlserver");
        spec.ssl = spec.options.encrypt === undefined ? true : truthy(spec.options.encrypt);
        return spec;
    }
    // JDBC/Prisma form: sqlserver://host:1433;database=db;user=sa;password={p}
    let body = text;
    const url = /^(sqlserver|mssql):\/\/([^;]*)(.*)$/is.exec(text);
    if (url)
        body = `server=${url[2]}${url[3]}`;
    const kv = {};
    for (const { key, value } of splitKeyValues(body))
        kv[key] = value;
    const server = kv.server ?? kv["data source"] ?? kv.address ?? kv.addr ?? kv["network address"] ?? "";
    if (!server)
        throw new types_1.DbError("The SQL Server connection string has no Server.", "Example: Server=localhost,1433;Database=app;User Id=sa;Password=...;Encrypt=false");
    const cleaned = server.replace(/^tcp:/i, "");
    const m = /^([^,:]+?)(?:[,:](\d+))?$/.exec(cleaned);
    const host = m?.[1] ?? cleaned;
    const port = m?.[2] ? Number(m[2]) : kv.port ? Number(kv.port) : undefined;
    const options = {};
    for (const [k, v] of Object.entries(kv))
        if (!["server", "data source", "address", "addr", "network address", "password", "pwd"].includes(k))
            options[k] = v;
    return {
        kind: "sqlserver",
        host: host === "." || /^\(local\)$/i.test(host) ? "localhost" : host,
        port: port ?? (host.includes("\\") ? undefined : 1433),
        user: kv["user id"] ?? kv.uid ?? kv.user ?? kv.username ?? "",
        password: kv.password ?? kv.pwd ?? "",
        database: kv.database ?? kv["initial catalog"] ?? kv.databasename ?? "",
        // Azure needs encryption; local Docker images usually have a self-signed cert.
        ssl: kv.encrypt === undefined ? !/^(localhost|127\.0\.0\.1|\.)$/i.test(host) : truthy(kv.encrypt),
        options
    };
}
function parseUrl(text, kind) {
    const m = /^([a-z][a-z0-9+]*):\/\//i.exec(text);
    if (!m)
        throw new types_1.DbError(`A ${kind} connection string must start with a scheme such as ${kind === "postgres" ? "postgresql" : kind}://`);
    const scheme = m[1].toLowerCase();
    const rest = text.slice(m[0].length);
    // The last "@" before the query ends the credentials, even when an unencoded password contains "@".
    const q = rest.indexOf("?");
    const head = q < 0 ? rest : rest.slice(0, q);
    const at = head.lastIndexOf("@");
    const auth = at >= 0 ? rest.slice(0, at) : "";
    const after = at >= 0 ? rest.slice(at + 1) : rest;
    const slash = after.search(/[/?]/);
    const hostPart = slash < 0 ? after : after.slice(0, slash);
    const pathQuery = slash < 0 ? "" : after.slice(slash);
    const qi = pathQuery.indexOf("?");
    const pathPart = qi < 0 ? pathQuery : pathQuery.slice(0, qi);
    const queryPart = qi < 0 ? "" : pathQuery.slice(qi + 1);
    const dec = (s) => { try {
        return decodeURIComponent(s);
    }
    catch {
        return s;
    } };
    const colon = auth.indexOf(":");
    const options = {};
    for (const pair of queryPart.split("&").filter(Boolean)) {
        const i = pair.indexOf("=");
        options[dec(i < 0 ? pair : pair.slice(0, i)).toLowerCase()] = dec(i < 0 ? "" : pair.slice(i + 1));
    }
    if (!hostPart)
        throw new types_1.DbError("The connection string has no host.", `Example: ${scheme}://user:password@localhost${DEFAULT_PORTS[kind] ? `:${DEFAULT_PORTS[kind]}` : ""}/database`);
    const multi = hostPart.includes(",");
    const hp = /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPart) ?? /^([^:]+)(?::(\d*))?$/.exec(hostPart);
    if (!multi && !hp)
        throw new types_1.DbError(`"${hostPart}" is not a valid host.`);
    const port = multi || !hp?.[2] ? (scheme === "mongodb+srv" ? undefined : DEFAULT_PORTS[kind]) : Number(hp[2]);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
        throw new types_1.DbError(`Port ${hp?.[2]} is out of range (1-65535).`);
    if (scheme === "mongodb+srv" && hp?.[2])
        throw new types_1.DbError("mongodb+srv:// connection strings cannot include a port.", "Remove the :port, or use mongodb:// instead.");
    const database = dec(pathPart.replace(/^\//, ""));
    if (kind === "redis" && database && !/^\d+$/.test(database))
        throw new types_1.DbError(`Redis databases are numbers, not "${database}".`, "Example: redis://localhost:6379/0");
    const ssl = scheme === "rediss" || scheme === "mongodb+srv" ||
        /^(require|verify-ca|verify-full|prefer)$/i.test(options.sslmode ?? "") ||
        truthy(options.ssl) || truthy(options.tls) || /^(required|verify_ca|verify_identity)$/i.test(options["ssl-mode"] ?? options.sslmode ?? "");
    return {
        kind,
        host: multi ? hostPart : hp[1],
        port,
        user: dec(colon < 0 ? auth : auth.slice(0, colon)),
        password: colon < 0 ? "" : dec(auth.slice(colon + 1)),
        database,
        ssl: options.sslmode === "disable" ? false : ssl,
        options,
        url: kind === "mongodb" || kind === "redis" ? text : undefined
    };
}
/** Advice shown after a successful parse; never blocks saving. */
function connectionWarnings(spec) {
    const warnings = [];
    const local = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal|0\.0\.0\.0)$/i.test(spec.host ?? "");
    if (spec.kind !== "sqlite" && !spec.ssl && spec.host && !local && !spec.host.includes(",")) {
        warnings.push("TLS is off for a remote host, so credentials and data travel unencrypted.");
    }
    if (spec.kind !== "sqlite" && spec.kind !== "redis" && spec.kind !== "mongodb" && !spec.user)
        warnings.push("No user name is set.");
    if (spec.kind === "postgres" && /:6543$|pooler|pgbouncer/i.test(`${spec.host}:${spec.port}`))
        warnings.push("This looks like a transaction pooler. Browsing works, but session settings do not persist between queries.");
    return warnings;
}
exports.connectionWarnings = connectionWarnings;
/** Where the password sits in the raw text, so it can be masked or restored without re-serialising. */
function passwordSpan(raw) {
    const text = raw;
    const kind = detectKind(text);
    if (!kind || kind === "sqlite")
        return undefined;
    const isKv = kind === "sqlserver" && (/^(server|data source|address|addr|network address)\s*=/i.test(text.trim()) || /^(jdbc:)?(sqlserver|mssql):\/\/[^/@]*;/i.test(text.trim()));
    if (isKv) {
        // In sqlserver://host;k=v the first "key" swallows the host; only the password key matters here.
        for (const kv of splitKeyValues(text)) {
            if (/(^|;)\s*(password|pwd)$/.test(kv.key) && kv.end > kv.start)
                return { start: kv.start, end: kv.end };
        }
        return undefined;
    }
    const m = /[a-z][a-z0-9+]*:\/\//i.exec(text);
    if (!m)
        return undefined;
    const base = m.index + m[0].length;
    const rest = text.slice(base);
    const q = rest.indexOf("?");
    const head = q < 0 ? rest : rest.slice(0, q);
    const at = head.lastIndexOf("@");
    if (at < 0)
        return undefined;
    const colon = rest.slice(0, at).indexOf(":");
    if (colon < 0 || colon + 1 === at)
        return undefined;
    return { start: base + colon + 1, end: base + at };
}
/** The connection string with its password replaced by PASSWORD_MASK. */
function maskConnectionString(raw) {
    const text = normalizeConnectionString(raw);
    const span = passwordSpan(text);
    if (!span)
        return text;
    const value = text.slice(span.start, span.end);
    const braced = value.startsWith("{") && value.endsWith("}");
    return text.slice(0, span.start) + (braced ? `{${exports.PASSWORD_MASK}}` : exports.PASSWORD_MASK) + text.slice(span.end);
}
exports.maskConnectionString = maskConnectionString;
/**
 * When an edited string still carries the mask, puts the stored password back.
 * Anything else the user changed (host, database, options) is kept.
 */
function restoreMaskedPassword(edited, stored) {
    const text = normalizeConnectionString(edited);
    const span = passwordSpan(text);
    if (!span || !stored)
        return text;
    const value = text.slice(span.start, span.end);
    if (value !== exports.PASSWORD_MASK && value !== `{${exports.PASSWORD_MASK}}`)
        return text;
    const original = normalizeConnectionString(stored);
    const old = passwordSpan(original);
    const replacement = old ? original.slice(old.start, old.end) : "";
    return text.slice(0, span.start) + replacement + text.slice(span.end);
}
exports.restoreMaskedPassword = restoreMaskedPassword;
/** True when the edited string still uses the masked placeholder. */
function hasMaskedPassword(text) {
    const normalized = normalizeConnectionString(text);
    const span = passwordSpan(normalized);
    if (!span)
        return false;
    const value = normalized.slice(span.start, span.end);
    return value === exports.PASSWORD_MASK || value === `{${exports.PASSWORD_MASK}}`;
}
exports.hasMaskedPassword = hasMaskedPassword;
/** Every form a credential could take inside a driver message. */
function secretsOf(raw, spec) {
    const out = new Set();
    const text = normalizeConnectionString(raw);
    if (text)
        out.add(text);
    if (raw && raw.trim())
        out.add(raw.trim());
    const span = passwordSpan(text);
    if (span)
        out.add(text.slice(span.start, span.end).replace(/^\{|\}$/g, ""));
    const password = spec?.password;
    if (password) {
        out.add(password);
        out.add(encodeURIComponent(password));
    }
    return [...out].filter(s => s.length >= 3).sort((a, b) => b.length - a.length);
}
exports.secretsOf = secretsOf;
function redact(text, secrets) {
    let out = String(text ?? "");
    for (const secret of secrets) {
        if (secret)
            out = out.split(secret).join("***");
    }
    // Belt and braces: credentials in any URL the driver echoes back.
    return out.replace(/([a-z][a-z0-9+]*:\/\/[^:/@\s]*:)[^@\s]+@/gi, "$1***@").replace(/((?:password|pwd)\s*=\s*)(\{[^}]*\}|[^;\s]+)/gi, "$1***");
}
exports.redact = redact;
/** Maps a driver error to a short, credential-free message and a hint. */
function friendlyError(error, secrets = []) {
    if (error instanceof types_1.DbError)
        return new types_1.DbError(redact(error.message, secrets), error.hint && redact(error.hint, secrets), error.code);
    const e = (error ?? {});
    let message = String(e.sqlMessage ?? e.message ?? error ?? "Unknown error");
    if (!message.trim() && Array.isArray(e.errors))
        message = e.errors.map(x => x?.message).filter(Boolean).join("; ");
    if (!message.trim() && e.originalError)
        message = String(e.originalError.info?.message ?? e.originalError.message ?? "");
    if (!message.trim())
        message = String(e.code ?? "Unknown error");
    const code = String(e.code ?? e.codeName ?? e.number ?? "");
    const text = `${code} ${message} ${e.name ?? ""}`;
    const say = (msg, hint) => new types_1.DbError(redact(msg, secrets).slice(0, 800), hint, code || undefined);
    if (/ECONNREFUSED/.test(text))
        return say("Connection refused.", "Check that the database server is running and listening on that host and port.");
    if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(text))
        return say("The database host could not be found.", "Check the host name, VPN and DNS.");
    if (/EHOSTUNREACH|ENETUNREACH/.test(text))
        return say("The database host is unreachable.", "Check your network, VPN or firewall rules.");
    if (/ECONNRESET|EPIPE|socket hang up|Connection is closed|Connection lost/i.test(text))
        return say(`The connection was closed by the server. ${message}`, "Reconnect and try again. If it keeps happening, the server may require TLS or reject your IP.");
    if (/self[- ]signed|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|certificate/i.test(text))
        return say(`TLS certificate problem: ${message}`, "For local servers with self-signed certificates, add sslmode=no-verify (Postgres), TrustServerCertificate=true (SQL Server) or tlsAllowInvalidCertificates=true (MongoDB).");
    if (/does not support SSL|SSL is not enabled|server does not allow insecure|requires SSL|no pg_hba\.conf entry.*SSL off/i.test(text))
        return say(message, "Toggle TLS: add ?sslmode=require for servers that need it, or ?sslmode=disable for local servers without it.");
    if (/^(28P01|28000)$/.test(code) || /ER_ACCESS_DENIED|ELOGIN|Login failed|password authentication failed|Authentication failed|AuthenticationFailed|WRONGPASS|NOAUTH|invalid password|Access denied/i.test(text) || e.codeName === "AuthenticationFailed" || code === "18") {
        return say("Authentication failed: the user name or password was rejected.", "Check the credentials, and for MongoDB the authSource option.");
    }
    if (code === "3D000" || /ER_BAD_DB_ERROR|Cannot open database|Unknown database/i.test(text))
        return say(message, "Check the database name in the connection string.");
    if (/ETIMEDOUT|ETIMEOUT|timed? ?out|Timeout|Server selection timed out|MongoServerSelectionError|57014|canceling statement/i.test(text)) {
        return say(/57014|canceling statement/i.test(text) ? "The query was cancelled because it took too long." : `Timed out: ${message}`, "The server did not answer in time. Check the host, firewall and VPN, or narrow the query.");
    }
    if (code === "42601" || /ER_PARSE_ERROR|syntax error|Incorrect syntax|SQLITE_ERROR: near/i.test(text) || e.number === 102)
        return say(message, "Check the query syntax.");
    if (code === "42P01" || /ER_NO_SUCH_TABLE|Invalid object name|no such table|ns not found/i.test(text) || e.number === 208)
        return say(message, "The table or collection may have been renamed or dropped. Refresh the explorer.");
    if (code === "23505" || /ER_DUP_ENTRY|duplicate key|UNIQUE constraint failed|Violation of (PRIMARY|UNIQUE) KEY/i.test(text) || code === "11000" || e.number === 2627)
        return say(message, "A row with that key already exists.");
    if (code === "23503" || /ER_NO_REFERENCED_ROW|ER_ROW_IS_REFERENCED|FOREIGN KEY constraint|REFERENCE constraint|violates foreign key/i.test(text) || e.number === 547)
        return say(message, "Another table references this row, or the referenced row does not exist.");
    if (code === "23502" || /ER_BAD_NULL_ERROR|NOT NULL constraint|cannot be null|Cannot insert the value NULL/i.test(text))
        return say(message, "A required column is empty.");
    if (code === "22P02" || /ER_TRUNCATED_WRONG_VALUE|invalid input syntax|Conversion failed|datatype mismatch|Incorrect .* value/i.test(text))
        return say(message, "A value does not match the column type.");
    if (/permission denied|not authorized|Unauthorized|ER_TABLEACCESS_DENIED|ER_DBACCESS_DENIED|NOPERM|EACCES/i.test(text) || code === "13")
        return say(message, "The connected user lacks permission for this operation.");
    if (/Cannot find module/i.test(text))
        return say("The database driver could not be loaded.", "Reinstall DevSnip Pro; the driver ships with the extension.");
    return say(message);
}
exports.friendlyError = friendlyError;
//# sourceMappingURL=connection-string.js.map