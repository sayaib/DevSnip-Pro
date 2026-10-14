/**
 * Detects, parses, validates and masks database connection strings, and
 * turns driver errors into messages that are safe to show.
 *
 * Pure (no vscode, no drivers), so it is unit tested directly. Credentials
 * leave this module only inside a ConnectionSpec handed to an adapter; what
 * goes anywhere else - the webview, the profile list, error messages - has
 * been masked or redacted here first.
 */

import * as os from "os";
import * as path from "path";
import { DB_KINDS, DbError, DbKind } from "./types";

/** Stands in for a password in the UI; saving it back keeps the stored one. */
export const PASSWORD_MASK = "********";

export interface ConnectionSpec {
  kind: DbKind;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl: boolean;
  /** Query-string or key=value options, keys lower-cased. */
  options: Record<string, string>;
  /** SQLite: absolute path of the database file. */
  filePath?: string;
  /** MongoDB/Redis: the normalized URL the driver should receive. */
  url?: string;
  /** Oracle: Easy Connect string or connect descriptor, without credentials. */
  connectString?: string;
}

const defaultPort = (kind: DbKind): number | undefined => DB_KINDS[kind]?.defaultPort;

const SCHEMES: Record<string, DbKind> = {
  postgres: "postgres", postgresql: "postgres", pg: "postgres",
  cockroachdb: "cockroachdb", cockroach: "cockroachdb", crdb: "cockroachdb",
  mysql: "mysql", mysql2: "mysql", mariadb: "mariadb",
  sqlserver: "sqlserver", mssql: "sqlserver",
  oracle: "oracle",
  sqlite: "sqlite", sqlite3: "sqlite", file: "sqlite",
  clickhouse: "clickhouse", ch: "clickhouse",
  mongodb: "mongodb", "mongodb+srv": "mongodb",
  redis: "redis", rediss: "redis", valkey: "redis", valkeys: "redis"
};

const SUPPORTED_HINT = "Supported: postgresql://, cockroachdb://, mysql://, mariadb://, sqlserver:// (or Server=...;), oracle:// (or jdbc:oracle:thin:@...), sqlite:///path/to/file.db, clickhouse://, mongodb://, mongodb+srv://, redis://, rediss://.";

const SQLITE_EXT = /\.(db|sqlite|sqlite3|db3|s3db|sl3)$/i;

/** Trims quotes, `DATABASE_URL=` prefixes and `jdbc:` so every form parses the same way. */
export function normalizeConnectionString(raw: string): string {
  let text = String(raw ?? "").trim();
  const env = /^(?:export\s+)?[A-Z_][A-Z0-9_]*\s*=\s*(.+)$/s.exec(text);
  if (env && (/^["']?[a-z0-9+]+:/i.test(env[1]) || /^["']?[~./]/.test(env[1]))) text = env[1].trim();
  if (/^(["'`]).*\1$/s.test(text)) text = text.slice(1, -1).trim();
  return text.replace(/^jdbc:/i, "");
}

/** Which database a connection string is for, without validating the rest. */
export function detectKind(raw: string): DbKind | undefined {
  const text = normalizeConnectionString(raw);
  if (!text) return undefined;
  if (/^(server|data source|address|addr|network address)\s*=/i.test(text)) return "sqlserver";
  // ADO.NET key=value strings, even when the Server part is missing.
  if (!/^[a-z][a-z0-9+]*:\/\//i.test(text) && /(^|;)\s*(initial catalog|database|user id|uid|trusted_connection|integrated security)\s*=/i.test(text)) return "sqlserver";
  const scheme = /^([a-z][a-z0-9+]*):/i.exec(text)?.[1]?.toLowerCase();
  if (scheme && SCHEMES[scheme]) return SCHEMES[scheme];
  if (SQLITE_EXT.test(text) && !/^[a-z][a-z0-9+]*:\/\//i.test(text)) return "sqlite";
  return undefined;
}

/**
 * Parses a connection string into what an adapter needs.
 * Relative SQLite paths resolve against `baseDir` (the workspace folder).
 */
export function parseConnection(raw: string, baseDir?: string): ConnectionSpec {
  const text = normalizeConnectionString(raw);
  if (!text) throw new DbError("Enter a connection string.", "For example postgresql://user:password@localhost:5432/app");
  if (text.length > 4096) throw new DbError("That connection string is too long.");
  const kind = detectKind(text);
  if (!kind) {
    const scheme = /^([a-z][a-z0-9+]*):/i.exec(text)?.[1];
    throw new DbError(
      scheme ? `${scheme}:// databases are not supported.` : "This does not look like a connection string.",
      SUPPORTED_HINT
    );
  }
  switch (kind) {
    case "sqlite": return parseSqlite(text, baseDir);
    case "sqlserver": return parseSqlServer(text);
    case "oracle": return parseOracle(text);
    case "clickhouse": return parseClickHouse(text);
    default: return parseUrl(text, kind);
  }
}

function parseSqlite(text: string, baseDir?: string): ConnectionSpec {
  let file = text.replace(/^(sqlite3?|file):(\/\/)?/i, "");
  // sqlite:///abs/path keeps its leading slash; sqlite://./rel and file:./rel are relative.
  if (/^(sqlite3?|file):\/\/\//i.test(text)) file = "/" + file.replace(/^\/+/, "");
  file = file.split("?")[0];
  try { file = decodeURIComponent(file); } catch { /* keep as typed */ }
  if (!file || file === ":memory:") throw new DbError("Point SQLite at a database file.", "In-memory databases cannot be browsed from another process. Use sqlite:///absolute/path/to/app.db");
  if (/^\/[a-z]:[\\/]/i.test(file)) file = file.slice(1); // sqlite:///C:/x.db
  if (file.startsWith("~")) file = path.join(os.homedir(), file.slice(1));
  if (!path.isAbsolute(file)) {
    if (!baseDir) throw new DbError("A relative SQLite path needs an open workspace folder.", "Use an absolute path, e.g. sqlite:///Users/me/project/dev.db");
    file = path.resolve(baseDir, file);
  }
  return { kind: "sqlite", filePath: path.normalize(file), ssl: false, options: {} };
}

/** Splits `a=1;b={x;y}};c="q"` honouring braces and quotes, which may hide `;` inside a password. */
export function splitKeyValues(text: string): Array<{ key: string; value: string; start: number; end: number }> {
  const out: Array<{ key: string; value: string; start: number; end: number }> = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === ";" || text[i] === " ")) i++;
    const eq = text.indexOf("=", i);
    if (eq < 0) break;
    const key = text.slice(i, eq).trim().toLowerCase();
    let j = eq + 1;
    while (text[j] === " ") j++;
    const start = j;
    let value = "";
    if (text[j] === "{") {
      j++;
      while (j < text.length) {
        if (text[j] === "}" && text[j + 1] === "}") { value += "}"; j += 2; continue; }
        if (text[j] === "}") { j++; break; }
        value += text[j++];
      }
    } else if (text[j] === '"' || text[j] === "'") {
      const q = text[j++];
      while (j < text.length) {
        if (text[j] === q && text[j + 1] === q) { value += q; j += 2; continue; }
        if (text[j] === q) { j++; break; }
        value += text[j++];
      }
    } else {
      const semi = text.indexOf(";", j);
      value = (semi < 0 ? text.slice(j) : text.slice(j, semi)).trim();
      j = semi < 0 ? text.length : semi;
    }
    out.push({ key, value, start, end: j });
    i = j;
  }
  return out;
}

const truthy = (v: string | undefined) => /^(true|yes|1|strict|mandatory)$/i.test(String(v ?? "").trim());

function parseSqlServer(text: string): ConnectionSpec {
  // URL form: sqlserver://user:pass@host:1433/db?encrypt=true
  if (/^(sqlserver|mssql):\/\/[^;]*@/i.test(text) && !/^(sqlserver|mssql):\/\/[^/@]*;/i.test(text)) {
    const spec = parseUrl(text, "sqlserver");
    spec.ssl = spec.options.encrypt === undefined ? true : truthy(spec.options.encrypt);
    return spec;
  }
  // JDBC/Prisma form: sqlserver://host:1433;database=db;user=sa;password={p}
  let body = text;
  const url = /^(sqlserver|mssql):\/\/([^;]*)(.*)$/is.exec(text);
  if (url) body = `server=${url[2]}${url[3]}`;
  const kv: Record<string, string> = {};
  for (const { key, value } of splitKeyValues(body)) kv[key] = value;
  const server = kv.server ?? kv["data source"] ?? kv.address ?? kv.addr ?? kv["network address"] ?? "";
  if (!server) throw new DbError("The SQL Server connection string has no Server.", "Example: Server=localhost,1433;Database=app;User Id=sa;Password=...;Encrypt=false");
  const cleaned = server.replace(/^tcp:/i, "");
  const m = /^([^,:]+?)(?:[,:](\d+))?$/.exec(cleaned);
  const host = m?.[1] ?? cleaned;
  const port = m?.[2] ? Number(m[2]) : kv.port ? Number(kv.port) : undefined;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(kv)) if (!["server", "data source", "address", "addr", "network address", "password", "pwd"].includes(k)) options[k] = v;
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

function parseUrl(text: string, kind: DbKind): ConnectionSpec {
  const m = /^([a-z][a-z0-9+]*):\/\//i.exec(text);
  if (!m) throw new DbError(`A ${kind} connection string must start with a scheme such as ${kind === "postgres" ? "postgresql" : kind}://`);
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
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  const colon = auth.indexOf(":");
  const options: Record<string, string> = {};
  for (const pair of queryPart.split("&").filter(Boolean)) {
    const i = pair.indexOf("=");
    options[dec(i < 0 ? pair : pair.slice(0, i)).toLowerCase()] = dec(i < 0 ? "" : pair.slice(i + 1));
  }
  if (!hostPart) throw new DbError("The connection string has no host.", `Example: ${scheme}://user:password@localhost${defaultPort(kind) ? `:${defaultPort(kind)}` : ""}/database`);
  const multi = hostPart.includes(",");
  const hp = /^\[([^\]]+)\](?::(\d+))?$/.exec(hostPart) ?? /^([^:]+)(?::(\d*))?$/.exec(hostPart);
  if (!multi && !hp) throw new DbError(`"${hostPart}" is not a valid host.`);
  const port = multi || !hp?.[2] ? (scheme === "mongodb+srv" ? undefined : defaultPort(kind)) : Number(hp[2]);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new DbError(`Port ${hp?.[2]} is out of range (1-65535).`);
  if (scheme === "mongodb+srv" && hp?.[2]) throw new DbError("mongodb+srv:// connection strings cannot include a port.", "Remove the :port, or use mongodb:// instead.");
  const database = dec(pathPart.replace(/^\//, ""));
  if (kind === "redis" && database && !/^\d+$/.test(database)) throw new DbError(`Redis databases are numbers, not "${database}".`, "Example: redis://localhost:6379/0");
  const ssl =
    scheme === "rediss" || scheme === "valkeys" || scheme === "mongodb+srv" ||
    /^(require|verify-ca|verify-full|prefer)$/i.test(options.sslmode ?? "") ||
    truthy(options.ssl) || truthy(options.tls) || /^(required|verify_ca|verify_identity)$/i.test(options["ssl-mode"] ?? options.sslmode ?? "");
  return {
    kind,
    host: multi ? hostPart : hp![1],
    port,
    user: dec(colon < 0 ? auth : auth.slice(0, colon)),
    password: colon < 0 ? "" : dec(auth.slice(colon + 1)),
    database,
    ssl: options.sslmode === "disable" ? false : ssl,
    options,
    url: kind === "mongodb" || kind === "redis" ? text : undefined
  };
}

/**
 * Oracle: oracle://user:password@host:1521/SERVICE (Easy Connect), with
 * ?sid=XE for SID-only databases and ?ssl=true for TCPS; or the JDBC thin
 * forms jdbc:oracle:thin:[user/password]@//host:1521/SERVICE, @host:1521:SID
 * and @(DESCRIPTION=...).
 */
function parseOracle(text: string): ConnectionSpec {
  const thin = /^oracle:thin:(.*)$/is.exec(text);
  if (!thin) {
    const spec = parseUrl(text, "oracle");
    const sid = spec.options.sid;
    if (!spec.database && !sid) throw new DbError("Add the Oracle service name.", "Example: oracle://user:password@localhost:1521/FREEPDB1 (or ?sid=XE for a SID).");
    if (spec.host?.includes(",")) throw new DbError("Use one Oracle host, or a JDBC connect descriptor for several.");
    spec.ssl = truthy(spec.options.ssl) || truthy(spec.options.tls) || /^tcps$/i.test(spec.options.protocol ?? "");
    spec.connectString = oracleConnectString(spec.host!, spec.port ?? 1521, spec.database ?? "", sid, spec.ssl);
    return spec;
  }
  const body = thin[1].trim();
  const at = body.lastIndexOf("@");
  if (at < 0) throw new DbError("A JDBC Oracle URL needs @host.", "Example: jdbc:oracle:thin:@//localhost:1521/FREEPDB1");
  const auth = body.slice(0, at);
  const target = body.slice(at + 1).trim();
  const slash = auth.indexOf("/");
  const user = slash < 0 ? auth : auth.slice(0, slash);
  const password = slash < 0 ? "" : auth.slice(slash + 1);
  const spec: ConnectionSpec = { kind: "oracle", user, password, ssl: false, options: {} };
  if (target.startsWith("(")) {
    if (!/\(\s*description\s*=/i.test(target)) throw new DbError("That Oracle connect descriptor is not valid.");
    spec.connectString = target;
    spec.ssl = /protocol\s*=\s*tcps/i.test(target);
    spec.host = /host\s*=\s*([^)\s]+)/i.exec(target)?.[1];
    spec.port = Number(/port\s*=\s*(\d+)/i.exec(target)?.[1]) || undefined;
    spec.database = /(service_name|sid)\s*=\s*([^)\s]+)/i.exec(target)?.[2];
    return spec;
  }
  const m = /^(?:(tcps?):)?(?:\/\/)?([^:/?]+)(?::(\d+))?(?:([/:])([^?]+))?(?:\?(.*))?$/i.exec(target);
  if (!m) throw new DbError(`"${target.slice(0, 80)}" is not an Oracle host.`, "Example: jdbc:oracle:thin:@//localhost:1521/FREEPDB1");
  spec.host = m[2];
  spec.port = m[3] ? Number(m[3]) : 1521;
  if (spec.port < 1 || spec.port > 65535) throw new DbError(`Port ${m[3]} is out of range (1-65535).`);
  spec.ssl = /^tcps$/i.test(m[1] ?? "");
  // host:port:NAME is a SID; host:port/NAME is a service name.
  const isSid = m[4] === ":";
  spec.database = m[5] ?? "";
  if (!spec.database) throw new DbError("Add the Oracle service name.", "Example: jdbc:oracle:thin:@//localhost:1521/FREEPDB1");
  if (isSid) spec.options.sid = spec.database;
  spec.connectString = oracleConnectString(spec.host, spec.port, isSid ? "" : spec.database, isSid ? spec.database : undefined, spec.ssl);
  return spec;
}

function oracleConnectString(host: string, port: number, service: string, sid: string | undefined, ssl: boolean): string {
  const clean = (v: string) => {
    if (!/^[A-Za-z0-9_.$#-]+$/.test(v)) throw new DbError(`"${v.slice(0, 60)}" is not a valid Oracle service name or SID.`);
    return v;
  };
  if (!/^[A-Za-z0-9_.:\[\]-]+$/.test(host)) throw new DbError(`"${host.slice(0, 80)}" is not a valid host.`);
  if (sid) return `(DESCRIPTION=(ADDRESS=(PROTOCOL=${ssl ? "TCPS" : "TCP"})(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${clean(sid)})))`;
  return `${ssl ? "tcps://" : ""}${host}:${port}/${clean(service)}`;
}

/** True when the host part of a URL names a port. */
function hasExplicitPort(text: string): boolean {
  const rest = text.replace(/^[a-z][a-z0-9+]*:\/\//i, "");
  const q = rest.indexOf("?");
  const head = q < 0 ? rest : rest.slice(0, q);
  const host = head.slice(head.lastIndexOf("@") + 1).split("/")[0];
  return /:\d+$/.test(host);
}

/** ClickHouse over HTTP: clickhouse://user:password@host:8123/db, ?secure=true for HTTPS (port 8443). */
function parseClickHouse(text: string): ConnectionSpec {
  const spec = parseUrl(text, "clickhouse");
  if (spec.host?.includes(",")) throw new DbError("Use one ClickHouse host.");
  spec.ssl = truthy(spec.options.secure) || truthy(spec.options.ssl) || truthy(spec.options.tls) || /^https$/i.test(spec.options.protocol ?? "");
  if (spec.ssl && !hasExplicitPort(text)) spec.port = 8443;
  if (spec.port === 9000 || spec.port === 9440) throw new DbError(`Port ${spec.port} is ClickHouse's native protocol; this client uses the HTTP interface.`, "Use port 8123 (or 8443 with ?secure=true).");
  if (!spec.user) spec.user = "default";
  return spec;
}

/** Advice shown after a successful parse; never blocks saving. */
export function connectionWarnings(spec: ConnectionSpec): string[] {
  const warnings: string[] = [];
  const local = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal|0\.0\.0\.0)$/i.test(spec.host ?? "");
  if (spec.kind !== "sqlite" && !spec.ssl && spec.host && !local && !spec.host.includes(",")) {
    warnings.push("TLS is off for a remote host, so credentials and data travel unencrypted.");
  }
  if (!["sqlite", "redis", "mongodb", "clickhouse"].includes(spec.kind) && !spec.user) warnings.push("No user name is set.");
  if (spec.kind === "postgres" && /:6543$|pooler|pgbouncer/i.test(`${spec.host}:${spec.port}`)) warnings.push("This looks like a transaction pooler. Browsing works, but session settings do not persist between queries.");
  return warnings;
}

/** Where the password sits in the raw text, so it can be masked or restored without re-serialising. */
function passwordSpan(raw: string): { start: number; end: number } | undefined {
  const text = raw;
  const kind = detectKind(text);
  if (!kind || kind === "sqlite") return undefined;
  const isKv = kind === "sqlserver" && (/^(server|data source|address|addr|network address)\s*=/i.test(text.trim()) || /^(jdbc:)?(sqlserver|mssql):\/\/[^/@]*;/i.test(text.trim()));
  if (isKv) {
    // In sqlserver://host;k=v the first "key" swallows the host; only the password key matters here.
    for (const kv of splitKeyValues(text)) {
      if (/(^|;)\s*(password|pwd)$/.test(kv.key) && kv.end > kv.start) return { start: kv.start, end: kv.end };
    }
    return undefined;
  }
  const thin = /^(?:jdbc:)?oracle:thin:/i.exec(text);
  if (thin) {
    // jdbc:oracle:thin:user/password@host
    const at = text.lastIndexOf("@");
    const slash = text.indexOf("/", thin[0].length);
    if (at < 0 || slash < 0 || slash > at || slash + 1 === at) return undefined;
    return { start: slash + 1, end: at };
  }
  const m = /[a-z][a-z0-9+]*:\/\//i.exec(text);
  if (!m) return undefined;
  const base = m.index + m[0].length;
  const rest = text.slice(base);
  const q = rest.indexOf("?");
  const head = q < 0 ? rest : rest.slice(0, q);
  const at = head.lastIndexOf("@");
  if (at < 0) return undefined;
  const colon = rest.slice(0, at).indexOf(":");
  if (colon < 0 || colon + 1 === at) return undefined;
  return { start: base + colon + 1, end: base + at };
}

/** The connection string with its password replaced by PASSWORD_MASK. */
export function maskConnectionString(raw: string): string {
  const text = normalizeConnectionString(raw);
  const span = passwordSpan(text);
  if (!span) return text;
  const value = text.slice(span.start, span.end);
  const braced = value.startsWith("{") && value.endsWith("}");
  return text.slice(0, span.start) + (braced ? `{${PASSWORD_MASK}}` : PASSWORD_MASK) + text.slice(span.end);
}

/**
 * When an edited string still carries the mask, puts the stored password back.
 * Anything else the user changed (host, database, options) is kept.
 */
export function restoreMaskedPassword(edited: string, stored: string | undefined): string {
  const text = normalizeConnectionString(edited);
  const span = passwordSpan(text);
  if (!span || !stored) return text;
  const value = text.slice(span.start, span.end);
  if (value !== PASSWORD_MASK && value !== `{${PASSWORD_MASK}}`) return text;
  const original = normalizeConnectionString(stored);
  const old = passwordSpan(original);
  const replacement = old ? original.slice(old.start, old.end) : "";
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

/** True when the edited string still uses the masked placeholder. */
export function hasMaskedPassword(text: string): boolean {
  const normalized = normalizeConnectionString(text);
  const span = passwordSpan(normalized);
  if (!span) return false;
  const value = normalized.slice(span.start, span.end);
  return value === PASSWORD_MASK || value === `{${PASSWORD_MASK}}`;
}

/** Every form a credential could take inside a driver message. */
export function secretsOf(raw: string, spec?: ConnectionSpec): string[] {
  const out = new Set<string>();
  const text = normalizeConnectionString(raw);
  if (text) out.add(text);
  if (raw && raw.trim()) out.add(raw.trim());
  const span = passwordSpan(text);
  if (span) out.add(text.slice(span.start, span.end).replace(/^\{|\}$/g, ""));
  const password = spec?.password;
  if (password) {
    out.add(password);
    out.add(encodeURIComponent(password));
  }
  return [...out].filter(s => s.length >= 3).sort((a, b) => b.length - a.length);
}

export function redact(text: string, secrets: string[]): string {
  let out = String(text ?? "");
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  // Belt and braces: credentials in any URL the driver echoes back.
  return out.replace(/([a-z][a-z0-9+]*:\/\/[^:/@\s]*:)[^@\s]+@/gi, "$1***@").replace(/((?:password|pwd)\s*=\s*)(\{[^}]*\}|[^;\s]+)/gi, "$1***");
}

/**
 * Where in the submitted text the server says the error is (0-based), when it says.
 * Adapters that rewrite or split the text set `devsnipPosition` on the error themselves.
 */
function errorPosition(e: Record<string, unknown>, message: string): number | undefined {
  if (typeof e.devsnipPosition === "number") return e.devsnipPosition;
  // PostgreSQL / CockroachDB: 1-based character position.
  if (e.position !== undefined && /^\d+$/.test(String(e.position))) return Number(e.position) - 1;
  // ClickHouse: "Syntax error: failed at position 8".
  const ch = /failed at position (\d+)/i.exec(message);
  if (ch) return Number(ch[1]) - 1;
  // node-oracledb: offset of a parse error, 0-based.
  if (typeof e.offset === "number" && e.offset > 0 && /^(ORA|DPY)-/.test(String(e.code ?? message))) return e.offset;
  return undefined;
}

/** Maps a driver error to a short, credential-free message and a hint. */
export function friendlyError(error: unknown, secrets: string[] = []): DbError {
  if (error instanceof DbError) {
    const copy = new DbError(redact(error.message, secrets), error.hint && redact(error.hint, secrets), error.code);
    return copy.at(error.position);
  }
  const e = (error ?? {}) as { message?: string; code?: string | number; number?: number; errno?: number; errorNum?: number; codeName?: string; name?: string; sqlMessage?: string; originalError?: { message?: string; info?: { message?: string } }; errors?: Array<{ message?: string }> };
  let message = String(e.sqlMessage ?? e.message ?? error ?? "Unknown error");
  if (!message.trim() && Array.isArray(e.errors)) message = e.errors.map(x => x?.message).filter(Boolean).join("; ");
  if (!message.trim() && e.originalError) message = String(e.originalError.info?.message ?? e.originalError.message ?? "");
  if (!message.trim()) message = String(e.code ?? "Unknown error");
  // Oracle appends a documentation link on its own line.
  message = message.replace(/\s*Help: https?:\/\/\S+\s*$/, "");
  // ClickHouse prefixes every message with "Code: N. DB::Exception: " and appends the server version.
  message = message.replace(/^Code: \d+\. DB::Exception: /, "").replace(/\s*\(version [^()]*(\([^()]*\))?[^()]*\)\s*$/, "").trim() || message;
  const code = String(e.code ?? e.codeName ?? e.number ?? "");
  const text = `${code} ${message} ${e.name ?? ""}`;
  const position = errorPosition(e as Record<string, unknown>, message);
  const say = (msg: string, hint?: string) => new DbError(redact(msg, secrets).slice(0, 800), hint, code || undefined).at(position);

  if (/ECONNREFUSED|ORA-12541|NJS-503|DPY-6005/.test(text)) return say("Connection refused.", "Check that the database server is running and listening on that host and port.");
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(text)) return say("The database host could not be found.", "Check the host name, VPN and DNS.");
  if (/EHOSTUNREACH|ENETUNREACH/.test(text)) return say("The database host is unreachable.", "Check your network, VPN or firewall rules.");
  if (/ORA-12514|ORA-12505|DPY-6001|DPY-6003/.test(text)) return say(message, "The listener does not know that service name or SID. Check the name after the port, e.g. /FREEPDB1 or /ORCLPDB1.");
  if (/ORA-01013|57014.*user request|canceling statement due to user request|Query execution was interrupted|QUERY_WAS_CANCELLED|Code: 394|operation was aborted(?! due to timeout)|^AbortError/i.test(text)) return say("The query was cancelled.");
  if (/ECONNRESET|EPIPE|socket hang up|Connection is closed|Connection lost|NJS-500|DPI-1080/i.test(text)) return say(`The connection was closed by the server. ${message}`, "Reconnect and try again. If it keeps happening, the server may require TLS or reject your IP.");
  if (/self[- ]signed|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|certificate/i.test(text)) return say(`TLS certificate problem: ${message}`, "For local servers with self-signed certificates, add sslmode=no-verify (PostgreSQL), TrustServerCertificate=true (SQL Server) or tlsAllowInvalidCertificates=true (MongoDB).");
  if (/does not support SSL|SSL is not enabled|server does not allow insecure|requires SSL|no pg_hba\.conf entry.*SSL off/i.test(text)) return say(message, "Toggle TLS: add ?sslmode=require for servers that need it, or ?sslmode=disable for local servers without it.");
  if (/^(28P01|28000)$/.test(code) || /ER_ACCESS_DENIED|ELOGIN|Login failed|password authentication failed|Authentication failed|AuthenticationFailed|WRONGPASS|NOAUTH|invalid password|Access denied|ORA-01017|ORA-28000|REQUIRED_PASSWORD/i.test(text) || e.codeName === "AuthenticationFailed" || code === "18") {
    return say("Authentication failed: the user name or password was rejected.", "Check the credentials, and for MongoDB the authSource option.");
  }
  if (/ORA-28001/.test(text)) return say("The Oracle password has expired.", "Change it with SQL*Plus or SQLcl, then update the connection.");
  if (code === "3D000" || /ER_BAD_DB_ERROR|Cannot open database|Unknown database|UNKNOWN_DATABASE|Database .* does(n't| not) exist/i.test(text)) return say(message, "Check the database name in the connection string.");
  if (/ETIMEDOUT|ETIMEOUT|timed? ?out|Timeout|Server selection timed out|MongoServerSelectionError|57014|canceling statement|ORA-03136|TIMEOUT_EXCEEDED|NJS-040|DPY-4011/i.test(text)) {
    return say(/57014|canceling statement/i.test(text) ? "The query was cancelled because it took too long." : `Timed out: ${message}`, "The server did not answer in time. Check the host, firewall and VPN, or narrow the query.");
  }
  if (code === "42601" || /ER_PARSE_ERROR|syntax error|Syntax error|Incorrect syntax|SQLITE_ERROR: near|ORA-009(00|11|17|23|33|36)|SYNTAX_ERROR/i.test(text) || e.number === 102) return say(message, "Check the query syntax.");
  if (code === "42P01" || /ER_NO_SUCH_TABLE|Invalid object name|no such table|ns not found|ORA-00942|UNKNOWN_TABLE|Table .* does(n't| not) exist/i.test(text) || e.number === 208) return say(message, "The table or collection may have been renamed or dropped. Refresh the explorer.");
  if (/ORA-00904/.test(text)) return say(message, "Check the column name. Oracle stores unquoted names in upper case, so quote mixed-case names.");
  if (/42703|ER_BAD_FIELD_ERROR|Unknown column|Invalid column name|no such column|UNKNOWN_IDENTIFIER|Missing columns/i.test(text)) return say(message, "Check the column name.");
  if (code === "23505" || /ER_DUP_ENTRY|duplicate key|UNIQUE constraint failed|Violation of (PRIMARY|UNIQUE) KEY|ORA-00001/i.test(text) || code === "11000" || e.number === 2627) return say(message, "A row with that key already exists.");
  if (code === "23503" || /ER_NO_REFERENCED_ROW|ER_ROW_IS_REFERENCED|FOREIGN KEY constraint|REFERENCE constraint|violates foreign key|ORA-0229[12]/i.test(text) || e.number === 547) return say(message, "Another table references this row, or the referenced row does not exist.");
  if (code === "23502" || /ER_BAD_NULL_ERROR|NOT NULL constraint|cannot be null|Cannot insert the value NULL|ORA-01400|ORA-01407/i.test(text)) return say(message, "A required column is empty.");
  if (code === "22P02" || /ER_TRUNCATED_WRONG_VALUE|invalid input syntax|Conversion failed|datatype mismatch|Incorrect .* value|ORA-01722|ORA-018\d\d|ORA-01861|CANNOT_PARSE/i.test(text)) return say(message, "A value does not match the column type.");
  if (/ORA-12899|value too long|Data too long|String or binary data would be truncated/i.test(text)) return say(message, "A value is longer than the column allows.");
  if (/permission denied|not authorized|Unauthorized|ER_TABLEACCESS_DENIED|ER_DBACCESS_DENIED|NOPERM|EACCES|ORA-01031|ACCESS_DENIED|Not enough privileges|READONLY|ORA-01456/i.test(text) || code === "13") return say(message, "The connected user lacks permission for this operation.");
  if (/Cannot find module/i.test(text)) return say("The database driver could not be loaded.", "Reinstall DevSnip Pro; the driver ships with the extension.");
  return say(message);
}
