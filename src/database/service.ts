/**
 * The host side of the Database Client: connection sessions, and one
 * validated entry point (`handle`) for every request the webview makes.
 *
 * It has no vscode dependency - dialogs, the clipboard and editors come in
 * through `HostUi` - so it is tested end to end against real databases.
 *
 * Rules enforced here, whatever the webview sends:
 *  - connection strings never leave the host; the webview sees masked forms;
 *  - every error is redacted of credentials before it is returned;
 *  - read-only connections refuse writes, including from the query console;
 *  - deletes, drops, truncates and destructive console statements need a
 *    native confirmation (drop/empty: typing the object's name).
 */

import { connectionWarnings, friendlyError, maskConnectionString, parseConnection, secretsOf } from "./connection-string";
import { createAdapter } from "./adapters";
import { ConnectionStore } from "./store";
import { CellInput, ConnectionProfile, DB_KINDS, DbAdapter, DbError, DbTarget, FILTER_OPS, FilterRule, LIMITS, PageRequest, Row } from "./types";

export interface HostUi {
  /** Native modal; resolves true only when the user picks `action`. */
  confirm(message: string, detail: string, action: string): Promise<boolean>;
  /** Asks the user to type `expected` to confirm. */
  confirmByTyping(message: string, expected: string): Promise<boolean>;
  pickSqliteFile(): Promise<string | undefined>;
  copy(text: string): Promise<void>;
  openDocument(content: string, language: string): Promise<void>;
  /** Folder that relative SQLite paths resolve against. */
  baseDir(): string | undefined;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface ConnectionView {
  id: string;
  name: string;
  kind: ConnectionProfile["kind"];
  kindLabel: string;
  family: string;
  schemas: boolean;
  display: string;
  readOnly: boolean;
  color?: string;
  status: ConnectionStatus;
  version?: string;
  defaultDatabase?: string;
  error?: { message: string; hint?: string };
  lastConnectedAt?: number;
}

interface Session {
  status: ConnectionStatus;
  adapter?: DbAdapter;
  connecting?: Promise<DbAdapter>;
  version?: string;
  defaultDatabase?: string;
  error?: DbError;
  secrets: string[];
}

type AdapterFactory = typeof createAdapter;

const CONNECTION_LOST = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ESOCKET|Connection is closed|Connection lost|Connection terminated|connection error|ConnectionClosed|MongoNetworkError|MongoTopologyClosed|Not connected|pool is draining|Cannot use a pool after calling end|ended by the other party/i;

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbError(`${what} timed out after ${Math.round(ms / 1000)} seconds.`, "The server did not answer in time. Check the network, or narrow the query.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Input validation: the webview is untrusted input like any other.
// ---------------------------------------------------------------------------

function str(value: unknown, label: string, max = 512): string {
  if (typeof value !== "string") throw new DbError(`${label} is missing.`);
  if (value.length > max) throw new DbError(`${label} is too long.`);
  return value;
}

function optStr(value: unknown, label: string, max = 512): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : str(value, label, max);
}

function target(value: unknown): DbTarget {
  const t = (value ?? {}) as Record<string, unknown>;
  return { database: optStr(t.database, "Database"), schema: optStr(t.schema, "Schema"), object: str(t.object, "Table") };
}

function cellInputs(value: unknown): Record<string, CellInput> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DbError("No values were sent.");
  const out: Record<string, CellInput> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 1000) throw new DbError("Too many columns.");
  for (const [name, raw] of entries) {
    const input = raw as CellInput;
    if (!input || !["value", "null", "default"].includes(input.mode)) throw new DbError(`Invalid value for ${name}.`);
    if (input.value !== undefined && typeof input.value !== "string") throw new DbError(`Invalid value for ${name}.`);
    if ((input.value ?? "").length > 16 * 1024 * 1024) throw new DbError(`The value for ${name} is too large.`);
    out[name] = { mode: input.mode, value: input.value };
  }
  return out;
}

function rows(value: unknown, label: string, max: number): Row[] {
  if (!Array.isArray(value) || !value.length) throw new DbError(`No ${label} selected.`);
  if (value.length > max) throw new DbError(`Select at most ${max} ${label} at a time.`);
  return value.map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new DbError(`Invalid ${label}.`);
    return item as Row;
  });
}

function pageRequest(value: unknown): PageRequest {
  const r = (value ?? {}) as Record<string, unknown>;
  const filters = Array.isArray(r.filters) ? r.filters : [];
  if (filters.length > 20) throw new DbError("Use at most 20 filters.");
  const sort = r.sort as { column?: unknown; dir?: unknown } | undefined;
  return {
    target: target(r.target),
    page: Math.max(1, Math.floor(Number(r.page) || 1)),
    pageSize: Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(r.pageSize) || 50))),
    sort: sort && typeof sort.column === "string" && sort.column ? { column: str(sort.column, "Sort column"), dir: sort.dir === "desc" ? "desc" : "asc" } : undefined,
    filters: filters.map((f: unknown): FilterRule => {
      const rule = (f ?? {}) as Record<string, unknown>;
      if (!FILTER_OPS.includes(rule.op as never)) throw new DbError("Unknown filter operator.");
      return { column: str(rule.column, "Filter column"), op: rule.op as FilterRule["op"], value: optStr(rule.value, "Filter value", 10_000) };
    }),
    search: optStr(r.search, "Search", 1000),
    query: optStr(r.query, "Filter", 100_000),
    keyType: optStr(r.keyType, "Type", 32)
  };
}

const nounFor = (kind: string, n: number) => {
  const word = kind === "mongodb" ? "document" : kind === "redis" ? "key" : "row";
  return `${n} ${word}${n === 1 ? "" : "s"}`;
};

export class DatabaseService {
  private readonly sessions = new Map<string, Session>();
  private disposed = false;

  constructor(
    private readonly store: ConnectionStore,
    private readonly ui: HostUi,
    private readonly onChange: () => void,
    private readonly factory: AdapterFactory = createAdapter
  ) {}

  views(): ConnectionView[] {
    return this.store.list().map(profile => {
      const session = this.sessions.get(profile.id);
      const meta = DB_KINDS[profile.kind];
      return {
        id: profile.id,
        name: profile.name,
        kind: profile.kind,
        kindLabel: meta?.label ?? profile.kind,
        family: meta?.family ?? "sql",
        schemas: meta?.schemas ?? false,
        display: profile.display,
        readOnly: profile.readOnly,
        color: profile.color,
        status: session?.status ?? "disconnected",
        version: session?.version,
        defaultDatabase: session?.defaultDatabase,
        error: session?.error ? { message: session.error.message, hint: session.error.hint } : undefined,
        lastConnectedAt: profile.lastConnectedAt
      };
    });
  }

  private changed(): void {
    if (!this.disposed) this.onChange();
  }

  private session(id: string): Session {
    let session = this.sessions.get(id);
    if (!session) {
      session = { status: "disconnected", secrets: [] };
      this.sessions.set(id, session);
    }
    return session;
  }

  /** Returns a connected adapter, connecting (or reconnecting) on demand. */
  async ensureConnected(id: string, force = false): Promise<DbAdapter> {
    const profile = this.store.require(id);
    const session = this.session(id);
    if (session.status === "connected" && session.adapter && !force) return session.adapter;
    if (session.connecting) return session.connecting;
    if (force && session.adapter) await this.closeSession(id, false);

    session.status = "connecting";
    session.error = undefined;
    this.changed();
    const connecting = (async () => {
      let adapter: DbAdapter | undefined;
      try {
        const raw = await this.store.connectionString(id);
        const spec = parseConnection(raw, this.ui.baseDir());
        session.secrets = secretsOf(raw, spec);
        adapter = this.factory(spec, { readOnly: profile.readOnly });
        const info = await withTimeout(adapter.connect(), LIMITS.connectTimeoutMs + 5_000, "Connecting");
        session.adapter = adapter;
        session.status = "connected";
        session.version = info.version;
        session.defaultDatabase = info.defaultDatabase;
        void this.store.touch(id);
        return adapter;
      } catch (error) {
        await adapter?.close().catch(() => undefined);
        session.adapter = undefined;
        session.status = "error";
        session.error = friendlyError(error, session.secrets);
        throw session.error;
      } finally {
        session.connecting = undefined;
        this.changed();
      }
    })();
    session.connecting = connecting;
    return connecting;
  }

  private async closeSession(id: string, notify = true): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    const adapter = session.adapter;
    session.adapter = undefined;
    session.status = "disconnected";
    session.error = undefined;
    session.version = undefined;
    await adapter?.close().catch(() => undefined);
    if (notify) this.changed();
  }

  /** Runs one operation on a connection, mapping failures to safe messages. */
  private async op<T>(id: string, what: string, run: (adapter: DbAdapter) => Promise<T>, timeoutMs = LIMITS.queryTimeoutMs + 10_000): Promise<T> {
    const adapter = await this.ensureConnected(id);
    const session = this.session(id);
    try {
      return await withTimeout(run(adapter), timeoutMs, what);
    } catch (error) {
      const safe = friendlyError(error, session.secrets);
      const raw = `${(error as { code?: string })?.code ?? ""} ${(error as Error)?.message ?? ""} ${(error as Error)?.name ?? ""}`;
      if (CONNECTION_LOST.test(raw) && !(error instanceof DbError)) {
        // The connection is gone: drop it so the next action reconnects cleanly.
        session.adapter = undefined;
        session.status = "error";
        session.error = new DbError("The connection was lost.", "Reconnect to continue.");
        await adapter.close().catch(() => undefined);
        this.changed();
      }
      throw safe;
    }
  }

  private writable(id: string): ConnectionProfile {
    const profile = this.store.require(id);
    if (profile.readOnly) throw new DbError("This connection is read-only.", "Edit the connection and turn off Read-only to make changes.");
    return profile;
  }

  async handle(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const p = params ?? {};
    switch (method) {
      case "init":
        return { connections: this.views(), kinds: DB_KINDS, limits: { maxPageSize: LIMITS.maxPageSize, maxQueryRows: LIMITS.maxQueryRows }, filterOps: FILTER_OPS };

      case "detect": {
        const typed = str(p.connectionString, "Connection string", 4096);
        const id = optStr(p.id, "Connection");
        const raw = await this.store.resolve(id && this.store.get(id) ? id : undefined, typed);
        try {
          const spec = parseConnection(raw, this.ui.baseDir());
          const meta = DB_KINDS[spec.kind];
          return {
            ok: true,
            kind: spec.kind,
            label: meta.label,
            family: meta.family,
            summary: { host: spec.host, port: spec.port, database: spec.database, user: spec.user, ssl: spec.ssl, file: spec.filePath, hasPassword: !!spec.password },
            warnings: connectionWarnings(spec),
            masked: maskConnectionString(raw)
          };
        } catch (error) {
          const e = friendlyError(error, secretsOf(raw));
          return { ok: false, error: { message: e.message, hint: e.hint } };
        }
      }

      case "testConnection": {
        const id = optStr(p.id, "Connection");
        const raw = await this.store.resolve(id && this.store.get(id) ? id : undefined, str(p.connectionString, "Connection string", 4096));
        let spec;
        try {
          spec = parseConnection(raw, this.ui.baseDir());
        } catch (error) {
          throw friendlyError(error, secretsOf(raw));
        }
        const secrets = secretsOf(raw, spec);
        const adapter = this.factory(spec, { readOnly: true });
        const start = Date.now();
        try {
          const info = await withTimeout(adapter.connect(), LIMITS.connectTimeoutMs + 5_000, "Connecting");
          await withTimeout(adapter.ping(), LIMITS.connectTimeoutMs, "Ping");
          return { version: info.version, latencyMs: Date.now() - start, warnings: connectionWarnings(spec) };
        } catch (error) {
          throw friendlyError(error, secrets);
        } finally {
          await adapter.close().catch(() => undefined);
        }
      }

      case "saveConnection": {
        const id = optStr(p.id, "Connection");
        const old = id ? this.store.require(id) : undefined;
        const before = id ? await this.store.connectionString(id).catch(() => undefined) : undefined;
        const profile = await this.store.save({
          id,
          name: str(p.name, "Name", 200),
          connectionString: str(p.connectionString, "Connection string", 4096),
          readOnly: p.readOnly === true,
          color: optStr(p.color, "Color", 20)
        }, this.ui.baseDir());
        const after = await this.store.connectionString(profile.id);
        // New details (or a read-only switch) take effect on the next connect.
        if (old && (before !== after || old.readOnly !== profile.readOnly)) await this.closeSession(old.id, false);
        this.changed();
        return this.views().find(v => v.id === profile.id);
      }

      case "editConnection": {
        const profile = this.store.require(str(p.id, "Connection"));
        return { id: profile.id, name: profile.name, connectionString: profile.display, readOnly: profile.readOnly, color: profile.color, kind: profile.kind };
      }

      case "removeConnection": {
        const profile = this.store.require(str(p.id, "Connection"));
        const ok = await this.ui.confirm(`Remove the connection "${profile.name}"?`, "Its saved connection string is deleted from the keychain. The database itself is not touched.", "Remove");
        if (!ok) return { removed: false };
        await this.closeSession(profile.id, false);
        this.sessions.delete(profile.id);
        await this.store.remove(profile.id);
        this.changed();
        return { removed: true };
      }

      case "connect": {
        const id = str(p.id, "Connection");
        await this.ensureConnected(id, true);
        return this.views().find(v => v.id === id);
      }

      case "disconnect": {
        const id = str(p.id, "Connection");
        await this.closeSession(id);
        return this.views().find(v => v.id === id);
      }

      case "pickSqliteFile": {
        const file = await this.ui.pickSqliteFile();
        if (!file) return null;
        return { connectionString: `sqlite:///${file.replace(/\\/g, "/").replace(/^\/+/, "")}` };
      }

      case "listDatabases": {
        const id = str(p.id, "Connection");
        return this.op(id, "Listing databases", async a => ({
          databases: await a.listDatabases(),
          defaultDatabase: this.session(id).defaultDatabase,
          sizes: a.databaseSizes ? await a.databaseSizes().catch(() => undefined) : undefined
        }));
      }

      case "listSchemas":
        return this.op(str(p.id, "Connection"), "Listing schemas", a => a.listSchemas(str(p.database, "Database")));

      case "listObjects":
        return this.op(str(p.id, "Connection"), "Listing tables", a => a.listObjects(str(p.database, "Database"), optStr(p.schema, "Schema")));

      case "refresh": {
        const adapter = await this.ensureConnected(str(p.id, "Connection"));
        adapter.invalidate();
        return { ok: true };
      }

      case "describe":
        return this.op(str(p.id, "Connection"), "Reading the structure", a => a.describe(target(p.target)));

      case "fetchPage":
        return this.op(str(p.id, "Connection"), "Loading rows", a => a.fetchPage(pageRequest(p.request)));

      case "readKey": {
        const id = str(p.id, "Connection");
        return this.op(id, "Reading the key", a => {
          if (!a.readKey) throw new DbError("Only Redis keys can be read this way.");
          return a.readKey(str(p.database, "Database", 16), str(p.key, "Key", 4096));
        });
      }

      case "insertRow": {
        const id = str(p.id, "Connection");
        this.writable(id);
        const t = target(p.target);
        const values = cellInputs(p.values);
        const affected = await this.op(id, "Inserting", a => a.insert(t, values));
        return { affected };
      }

      case "updateRow": {
        const id = str(p.id, "Connection");
        this.writable(id);
        const t = target(p.target);
        const key = rows([p.key], "row", 1)[0];
        const values = cellInputs(p.values);
        const affected = await this.op(id, "Saving", a => a.update(t, key, "primary", values));
        if (affected === 0 && this.store.require(id).kind !== "mongodb") {
          throw new DbError("No row was updated. It may have been changed or deleted by someone else.", "Refresh and try again.");
        }
        return { affected };
      }

      case "deleteRows": {
        const id = str(p.id, "Connection");
        const profile = this.writable(id);
        const t = target(p.target);
        const keys = rows(p.keys, "rows", 1000);
        const ok = await this.ui.confirm(`Delete ${nounFor(profile.kind, keys.length)} from ${t.object}?`, "This cannot be undone.", "Delete");
        if (!ok) return { cancelled: true };
        const affected = await this.op(id, "Deleting", a => a.remove(t, keys, "primary"));
        return { affected };
      }

      case "dropObject":
      case "truncateObject": {
        const id = str(p.id, "Connection");
        const profile = this.writable(id);
        const t = target(p.target);
        const drop = method === "dropObject";
        const what = profile.kind === "redis" ? `every key in database ${t.database ?? "0"}` : `${t.object}`;
        const message = profile.kind === "redis"
          ? `Delete ${what}? This runs FLUSHDB and cannot be undone.`
          : drop ? `Drop ${t.object}? The ${profile.kind === "mongodb" ? "collection and all its documents" : "table and all its rows"} will be deleted permanently.`
            : `Delete every ${profile.kind === "mongodb" ? "document" : "row"} in ${t.object}? The structure is kept.`;
        const expected = profile.kind === "redis" ? `db${t.database ?? "0"}` : t.object;
        if (!(await this.ui.confirmByTyping(message, expected))) return { cancelled: true };
        await this.op(id, drop ? "Dropping" : "Emptying", a => (drop ? a.drop(t) : a.truncate(t)));
        return { ok: true };
      }

      case "createCollection": {
        const id = str(p.id, "Connection");
        this.writable(id);
        await this.op(id, "Creating the collection", a => {
          if (!a.createCollection) throw new DbError("Only MongoDB collections can be created here. Use the Query tab.");
          return a.createCollection(str(p.database, "Database"), str(p.name, "Collection name", 255));
        });
        return { ok: true };
      }

      case "runQuery": {
        const id = str(p.id, "Connection");
        const profile = this.store.require(id);
        const text = str(p.text, "Query", 200_000);
        if (!text.trim()) throw new DbError("Enter a query to run.");
        const adapter = await this.ensureConnected(id);
        let checks;
        try {
          checks = adapter.classify(text);
        } catch (error) {
          throw friendlyError(error, this.session(id).secrets);
        }
        if (profile.readOnly && checks.some(c => c.write)) {
          const verbs = [...new Set(checks.filter(c => c.write).map(c => c.verb.toUpperCase()))].join(", ");
          throw new DbError(`This connection is read-only, so ${verbs} is not allowed.`, "Edit the connection and turn off Read-only to make changes.");
        }
        const dangers = checks.filter(c => c.danger).map(c => c.danger!);
        if (dangers.length) {
          const ok = await this.ui.confirm(
            dangers.length === 1 ? "Run this destructive statement?" : `Run ${dangers.length} destructive statements?`,
            [...new Set(dangers)].join("\n") + "\n\nThis cannot be undone.",
            "Run"
          );
          if (!ok) return { cancelled: true };
        }
        const result = await this.op(id, "The query", a => a.runQuery(text, { database: optStr(p.database, "Database"), schema: optStr(p.schema, "Schema") }));
        return { ...result, writes: checks.some(c => c.write) };
      }

      case "copyText":
        await this.ui.copy(str(p.text, "Text", 50 * 1024 * 1024));
        return { ok: true };

      case "openInEditor": {
        const language = ["json", "csv", "sql", "plaintext", "javascript"].includes(String(p.language)) ? String(p.language) : "plaintext";
        await this.ui.openDocument(str(p.content, "Content", 50 * 1024 * 1024), language);
        return { ok: true };
      }

      default:
        throw new DbError(`Unknown request "${String(method).slice(0, 40)}".`);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map(id => this.closeSession(id, false)));
    this.sessions.clear();
  }
}
