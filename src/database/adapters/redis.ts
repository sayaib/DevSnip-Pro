import type Redis from "ioredis";
import type { ChainableCommander } from "ioredis";
import { ConnectionSpec } from "../connection-string";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbTarget, KeyValue, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, ServerInfo, StatementCheck } from "../types";
import { since } from "../values";

export const REDIS_TYPES = ["string", "hash", "list", "set", "zset", "stream", "ReJSON-RL"];
const EDITABLE_TYPES = ["string", "hash", "list", "set", "zset"];

/** Commands the console refuses: they block, subscribe, or would desynchronise the connection. */
const BLOCKED = new Set(["subscribe", "psubscribe", "ssubscribe", "unsubscribe", "punsubscribe", "monitor", "sync", "psync", "shutdown", "quit", "select", "reset", "blpop", "brpop", "brpoplpush", "blmove", "blmpop", "bzpopmin", "bzpopmax", "bzmpop", "wait", "waitaof", "multi", "exec", "discard", "watch", "unwatch", "hello", "auth", "client"]);

const DANGEROUS: Record<string, string> = {
  flushall: "FLUSHALL deletes every key in every database on this server.",
  flushdb: "FLUSHDB deletes every key in this database.",
  del: "DEL deletes keys.",
  unlink: "UNLINK deletes keys.",
  swapdb: "SWAPDB exchanges the contents of two databases.",
  rename: "RENAME overwrites the destination key if it exists.",
  restore: "RESTORE can overwrite a key.",
  debug: "DEBUG can crash or block the server.",
  script: "SCRIPT FLUSH removes cached scripts.",
  function: "FUNCTION DELETE/FLUSH removes server functions.",
  config: "CONFIG changes server configuration.",
  acl: "ACL changes users and permissions.",
  replicaof: "REPLICAOF turns this server into a replica and discards its data.",
  slaveof: "SLAVEOF turns this server into a replica and discards its data.",
  failover: "FAILOVER switches the primary.",
  cluster: "CLUSTER commands change the cluster topology."
};

/** Splits a command line into arguments, honouring "double" and 'single' quotes. */
export function tokenizeCommand(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    let token = "";
    const quote = line[i] === '"' || line[i] === "'" ? line[i++] : "";
    let closed = !quote;
    while (i < line.length) {
      const ch = line[i];
      if (!quote && /\s/.test(ch)) break;
      if (quote && ch === quote) { i++; closed = true; break; }
      if (quote === '"' && ch === "\\" && i + 1 < line.length) {
        const next = line[i + 1];
        token += ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[next] ?? next;
        i += 2;
        continue;
      }
      token += ch;
      i++;
    }
    if (!closed) throw new DbError("Unterminated quote in the command.");
    out.push(token);
  }
  return out;
}

export function classifyRedis(text: string): Array<StatementCheck & { args: string[] }> {
  const lines = String(text ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#") && !l.startsWith("//"));
  if (!lines.length) throw new DbError("Enter a command, e.g. SCAN 0 MATCH user:* COUNT 100");
  if (lines.length > 50) throw new DbError("Run at most 50 commands at a time.");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const commands = require("@ioredis/commands") as { exists(name: string): boolean; hasFlag(name: string, flag: string): boolean };
  return lines.map(line => {
    const args = tokenizeCommand(line);
    const verb = (args[0] ?? "").toLowerCase();
    if (!/^[a-z][a-z0-9._|-]*$/i.test(verb)) throw new DbError(`"${args[0]}" is not a Redis command.`);
    if (BLOCKED.has(verb)) throw new DbError(`${verb.toUpperCase()} is not available in this console.`, verb === "select" ? "Pick the database from the selector instead." : "It blocks, subscribes or changes the connection itself.");
    let danger: string | undefined = DANGEROUS[verb];
    const sub = (args[1] ?? "").toLowerCase();
    if (verb === "script" && sub !== "flush") danger = undefined;
    if (verb === "function" && !["delete", "flush"].includes(sub)) danger = undefined;
    if (verb === "config" && !["set", "rewrite", "resetstat"].includes(sub)) danger = undefined;
    if (verb === "cluster" && !["reset", "forget", "failover", "flushslots", "delslots"].includes(sub)) danger = undefined;
    if (verb === "acl" && !["deluser", "setuser", "load"].includes(sub)) danger = undefined;
    // Unknown commands (modules such as JSON.* or FT.*) are treated as writes.
    const write = !commands.exists(verb) || commands.hasFlag(verb, "write") || !!danger;
    return { verb, write, danger, args };
  });
}

const TTL_LIMIT = 10 * 365 * 24 * 3600;

export class RedisAdapter implements DbAdapter {
  readonly kind = "redis" as const;
  private readonly clients = new Map<number, Redis>();
  private readonly defaultDb: number;

  constructor(private readonly spec: ConnectionSpec) {
    this.defaultDb = Number(spec.database || 0);
  }

  private dbIndex(database?: string): number {
    const n = database === undefined || database === "" ? this.defaultDb : Number(database);
    if (!Number.isInteger(n) || n < 0 || n > 1023) throw new DbError(`"${database}" is not a Redis database number.`);
    return n;
  }

  private async client(database?: string): Promise<Redis> {
    const db = this.dbIndex(database);
    let client = this.clients.get(db);
    if (client) {
      // Most recently used last, so the oldest is evicted first.
      this.clients.delete(db);
      this.clients.set(db, client);
    } else {
      if (this.clients.size >= 6) {
        const [oldest, stale] = [...this.clients.entries()].find(([n]) => n !== this.defaultDb)!;
        this.clients.delete(oldest);
        stale.quit().catch(() => stale.disconnect());
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require("ioredis") as typeof import("ioredis").default;
      client = new IORedis({
        host: this.spec.host,
        port: this.spec.port,
        username: this.spec.user || undefined,
        password: this.spec.password || undefined,
        db,
        tls: this.spec.ssl ? { servername: this.spec.host, rejectUnauthorized: !/^(true|1|yes)$/i.test(this.spec.options.skip_verify ?? this.spec.options.insecure ?? "") } : undefined,
        lazyConnect: true,
        connectTimeout: LIMITS.connectTimeoutMs,
        commandTimeout: LIMITS.queryTimeoutMs,
        maxRetriesPerRequest: 1,
        retryStrategy: times => (times > 3 ? null : Math.min(times * 300, 1500)),
        connectionName: "devsnip-pro"
      });
      client.on("error", () => undefined);
      this.clients.set(db, client);
    }
    if (client.status === "wait" || client.status === "end") {
      try {
        await client.connect();
      } catch (error) {
        this.clients.delete(db);
        client.disconnect();
        throw error;
      }
    }
    return client;
  }

  async connect(): Promise<ServerInfo> {
    const client = await this.client();
    const info = await client.info("server");
    const version = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? "";
    const valkey = /valkey_version:([^\r\n]+)/.exec(info)?.[1];
    return { version: valkey ? `Valkey ${valkey}` : `Redis ${version}`, defaultDatabase: String(this.defaultDb) };
  }

  async close(): Promise<void> {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map(c => c.quit().catch(() => c.disconnect())));
  }

  async ping(): Promise<void> {
    await (await this.client()).ping();
  }

  invalidate(): void {
    /* nothing cached */
  }

  async listDatabases(): Promise<string[]> {
    const client = await this.client();
    let count = 0;
    try {
      const reply = (await client.call("CONFIG", "GET", "databases")) as string[];
      count = Number(reply?.[1]) || 0;
    } catch {
      // Managed services (Upstash, ElastiCache serverless) disable CONFIG.
    }
    const used = new Set<number>([this.defaultDb]);
    const keyspace = await client.info("keyspace").catch(() => "");
    for (const m of keyspace.matchAll(/^db(\d+):/gm)) used.add(Number(m[1]));
    const all = count ? Array.from({ length: Math.min(count, 64) }, (_, i) => i) : [...used].sort((a, b) => a - b);
    return all.map(String);
  }

  async databaseSizes(): Promise<Record<string, number>> {
    const keyspace = await (await this.client()).info("keyspace");
    const sizes: Record<string, number> = {};
    for (const m of keyspace.matchAll(/^db(\d+):keys=(\d+)/gm)) sizes[m[1]] = Number(m[2]);
    return sizes;
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    const client = await this.client(database);
    return [{ name: "keys", type: "keys", rows: await client.dbsize() }];
  }

  async describe(): Promise<ColumnInfo[]> {
    const col = (name: string, dataType: string, category: ColumnInfo["category"], extra: Partial<ColumnInfo> = {}): ColumnInfo =>
      ({ name, dataType, category, nullable: false, primaryKey: false, autoIncrement: false, editable: true, sortable: false, ...extra });
    return [
      col("key", "string", "text", { primaryKey: true, sortable: true }),
      col("type", "type", "text"),
      col("ttl", "seconds", "number", { nullable: true }),
      col("size", "length", "number"),
      col("value", "preview", "other")
    ];
  }

  private async scanKeys(client: Redis, pattern: string, type?: string): Promise<{ keys: string[]; capped: boolean }> {
    const keys = new Set<string>();
    let cursor = "0";
    let typeSupported = !!type;
    const started = Date.now();
    do {
      let reply: [string, string[]];
      try {
        reply = (typeSupported
          ? await client.call("SCAN", cursor, "MATCH", pattern, "COUNT", "1000", "TYPE", type!)
          : await client.call("SCAN", cursor, "MATCH", pattern, "COUNT", "1000")) as [string, string[]];
      } catch (error) {
        // SCAN ... TYPE needs Redis 6; older servers filter afterwards.
        if (typeSupported && cursor === "0") { typeSupported = false; continue; }
        throw error;
      }
      cursor = reply[0];
      for (const key of reply[1]) keys.add(key);
      if (Date.now() - started > LIMITS.queryTimeoutMs) break;
    } while (cursor !== "0" && keys.size < LIMITS.maxScanKeys);
    let list = [...keys];
    if (type && !typeSupported) {
      const pipeline = client.pipeline();
      list.forEach(k => pipeline.type(k));
      const types = (await pipeline.exec()) ?? [];
      list = list.filter((_, i) => types[i]?.[1] === type);
    }
    return { keys: list.slice(0, LIMITS.maxScanKeys), capped: cursor !== "0" };
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const client = await this.client(request.target.database);
    const search = (request.search ?? "").trim();
    const pattern = (request.query ?? "").trim() || (search ? `*${search.replace(/[*?[\]\\]/g, m => "\\" + m)}*` : "*");
    if (pattern.length > 1024) throw new DbError("The key pattern is too long.");
    const type = request.keyType && REDIS_TYPES.includes(request.keyType) ? request.keyType : undefined;
    const { keys, capped } = await this.scanKeys(client, pattern, type);
    keys.sort();
    if (request.sort?.dir === "desc") keys.reverse();
    const pageSize = Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const slice = keys.slice((page - 1) * pageSize, page * pageSize);

    const meta = client.pipeline();
    slice.forEach(k => meta.type(k).pttl(k));
    const metaReplies = (await meta.exec()) ?? [];
    const details = slice.map((key, i) => ({ key, type: String(metaReplies[i * 2]?.[1] ?? "none"), pttl: Number(metaReplies[i * 2 + 1]?.[1] ?? -2) }));

    const preview = client.pipeline();
    for (const d of details) this.queuePreview(preview, d.key, d.type);
    const previewReplies = (await preview.exec()) ?? [];
    let p = 0;
    const rows: Row[] = [];
    for (const d of details) {
      const [size, value] = this.readPreview(d.type, previewReplies, p);
      p += this.previewCommands(d.type);
      if (d.type === "none") continue; // expired between SCAN and now
      rows.push({ key: d.key, type: d.type, ttl: d.pttl >= 0 ? Math.ceil(d.pttl / 1000) : null, size, value });
    }
    return {
      columns: await this.describe(),
      rows,
      total: keys.length,
      totalCapped: capped,
      keyColumns: ["key"],
      keyStrategy: "key",
      elapsedMs: since(start)
    };
  }

  private previewCommands(type: string): number {
    return ["string", "hash", "list", "set", "zset", "stream"].includes(type) ? 2 : 0;
  }

  private queuePreview(pipeline: ChainableCommander, key: string, type: string): void {
    switch (type) {
      case "string": pipeline.strlen(key).getrange(key, 0, 299); break;
      case "hash": pipeline.hlen(key).hscan(key, 0, "COUNT", 20); break;
      case "list": pipeline.llen(key).lrange(key, 0, 19); break;
      case "set": pipeline.scard(key).sscan(key, 0, "COUNT", 20); break;
      case "zset": pipeline.zcard(key).zrange(key, 0, 19, "WITHSCORES"); break;
      case "stream": pipeline.xlen(key).xrevrange(key, "+", "-", "COUNT", 3); break;
    }
  }

  private readPreview(type: string, replies: Array<[Error | null, unknown]>, at: number): [number | null, unknown] {
    if (!this.previewCommands(type)) return [null, type === "none" ? null : `<${type}>`];
    const size = Number(replies[at]?.[1] ?? 0);
    const value = replies[at + 1]?.[1];
    switch (type) {
      case "string": return [size, size > 300 ? `${value}…` : value];
      case "hash": {
        const flat = ((value as [string, string[]])?.[1] ?? []);
        const obj: Record<string, string> = {};
        for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
        return [size, obj];
      }
      case "set": return [size, (value as [string, string[]])?.[1] ?? []];
      case "zset": {
        const flat = (value as string[]) ?? [];
        const out: Array<{ member: string; score: number }> = [];
        for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
        return [size, out];
      }
      case "stream": return [size, ((value as Array<[string, string[]]>) ?? []).map(([id, fields]) => ({ id, fields: Object.fromEntries(fields.reduce<string[][]>((acc, f, i) => (i % 2 ? acc[acc.length - 1].push(f) : acc.push([f]), acc), [])) }))];
      default: return [size, value];
    }
  }

  async readKey(database: string, key: string): Promise<KeyValue> {
    if (typeof key !== "string" || !key) throw new DbError("No key selected.");
    const client = await this.client(database);
    const [type, pttl] = await Promise.all([client.type(key), client.pttl(key)]);
    const cap = LIMITS.maxScanKeys;
    let value: unknown;
    let truncated = false;
    switch (type) {
      case "none": throw new DbError(`The key "${key.slice(0, 80)}" no longer exists.`, "It may have expired. Refresh the list.");
      case "string": {
        const length = await client.strlen(key);
        truncated = length > 1_000_000;
        value = truncated ? await client.getrange(key, 0, 999_999) : await client.get(key);
        break;
      }
      case "hash": {
        truncated = (await client.hlen(key)) > cap;
        if (!truncated) value = await client.hgetall(key);
        else {
          const [, flat] = await client.hscan(key, 0, "COUNT", cap);
          const obj: Record<string, string> = {};
          for (let i = 0; i < flat.length; i += 2) obj[flat[i]] = flat[i + 1];
          value = obj;
        }
        break;
      }
      case "list":
        truncated = (await client.llen(key)) > cap;
        value = await client.lrange(key, 0, cap - 1);
        break;
      case "set":
        truncated = (await client.scard(key)) > cap;
        value = truncated ? (await client.sscan(key, 0, "COUNT", cap))[1] : await client.smembers(key);
        break;
      case "zset": {
        truncated = (await client.zcard(key)) > cap;
        const flat = await client.zrange(key, 0, cap - 1, "WITHSCORES");
        const out: Array<{ member: string; score: number }> = [];
        for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
        value = out;
        break;
      }
      case "stream": {
        const entries = (await client.xrevrange(key, "+", "-", "COUNT", 100)) as Array<[string, string[]]>;
        value = entries.map(([id, fields]) => {
          const obj: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
          return { id, fields: obj };
        });
        truncated = (await client.xlen(key)) > 100;
        break;
      }
      case "ReJSON-RL":
        value = await client.call("JSON.GET", key).catch(() => null);
        break;
      default:
        value = null;
    }
    return { key, type, ttlMs: pttl, value, truncated };
  }

  private parseTtl(input: CellInput | undefined): number | undefined {
    if (!input || input.mode !== "value") return undefined;
    const text = String(input.value ?? "").trim();
    if (!text) return undefined;
    const n = Number(text);
    if (!Number.isInteger(n) || n < -1 || n === 0 || n > TTL_LIMIT) throw new DbError("TTL must be a whole number of seconds (or -1 for no expiry).");
    return n;
  }

  /** Queues the commands that write `text` as a value of `type`. */
  private queueWrite(multi: ChainableCommander, key: string, type: string, text: string): void {
    const asString = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
    const parse = (expect: string): unknown => {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new DbError(`A ${type} value must be JSON (${expect}): ${(error as Error).message}`);
      }
    };
    switch (type) {
      case "string":
        multi.set(key, text);
        return;
      case "hash": {
        const obj = parse('{ "field": "value" }');
        if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Object.keys(obj).length) throw new DbError('A hash needs at least one field: { "field": "value" }.');
        multi.hset(key, Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, asString(v)])));
        return;
      }
      case "list":
      case "set": {
        const arr = parse('["a", "b"]');
        if (!Array.isArray(arr) || !arr.length) throw new DbError(`A ${type} needs a non-empty JSON array: ["a", "b"].`);
        if (type === "list") multi.rpush(key, ...arr.map(asString));
        else multi.sadd(key, ...arr.map(asString));
        return;
      }
      case "zset": {
        const value = parse('[{ "member": "a", "score": 1 }]');
        const pairs: Array<[number, string]> = Array.isArray(value)
          ? value.map((item: { member?: unknown; score?: unknown }) => [Number(item?.score), asString(item?.member)])
          : value && typeof value === "object" ? Object.entries(value as Record<string, unknown>).map(([member, score]) => [Number(score), member]) : [];
        if (!pairs.length || pairs.some(([score, member]) => !Number.isFinite(score) || member === undefined)) throw new DbError('A sorted set needs members with numeric scores: [{ "member": "a", "score": 1 }].');
        multi.zadd(key, ...pairs.flatMap(([score, member]) => [score, member]));
        return;
      }
      case "ReJSON-RL":
        parse("any JSON");
        multi.call("JSON.SET", key, "$", text);
        return;
      default:
        throw new DbError(`${type} keys cannot be written here. Use the console.`);
    }
  }

  private textOf(values: Record<string, CellInput>, field: string): string {
    const input = values?.[field];
    if (!input || input.mode !== "value") throw new DbError(`Enter a ${field}.`);
    return String(input.value ?? "");
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const client = await this.client(target.database);
    const key = this.textOf(values, "key");
    if (!key || key.length > 4096) throw new DbError("Enter a key name (at most 4096 characters).");
    const type = this.textOf(values, "type");
    if (![...EDITABLE_TYPES, "ReJSON-RL"].includes(type)) throw new DbError(`Choose one of: ${EDITABLE_TYPES.join(", ")}.`);
    const ttl = this.parseTtl(values.ttl);
    await client.watch(key);
    try {
      if (await client.exists(key)) throw new DbError(`The key "${key.slice(0, 80)}" already exists.`, "Open it to edit it instead.");
      const multi = client.multi();
      this.queueWrite(multi, key, type, this.textOf(values, "value"));
      if (ttl && ttl > 0) multi.expire(key, ttl);
      const result = await multi.exec();
      if (!result) throw new DbError("The key was created by someone else at the same time. Refresh and try again.");
      const failed = result.find(([error]) => error);
      if (failed) throw failed[0];
    } finally {
      await client.unwatch().catch(() => undefined);
    }
    return 1;
  }

  async update(target: DbTarget, keyRow: Row, _strategy: unknown, values: Record<string, CellInput>): Promise<number> {
    const client = await this.client(target.database);
    const key = String(keyRow?.key ?? "");
    if (!key) throw new DbError("No key selected.");
    await client.watch(key);
    try {
      const [type, pttl] = await Promise.all([client.type(key), client.pttl(key)]);
      if (type === "none") throw new DbError("The key no longer exists. It may have expired.");
      if (!EDITABLE_TYPES.includes(type) && type !== "ReJSON-RL") throw new DbError(`${type} keys are read-only here. Use the console.`);
      const ttl = this.parseTtl(values.ttl);
      const multi = client.multi();
      if (values.value) {
        multi.del(key);
        this.queueWrite(multi, key, type, this.textOf(values, "value"));
      }
      if (ttl === -1) multi.persist(key);
      else if (ttl) multi.expire(key, ttl);
      // Rewriting the value drops the TTL, so the remaining time is put back.
      else if (values.value && pttl > 0) multi.pexpire(key, pttl);
      const result = await multi.exec();
      if (!result) throw new DbError("The key changed while you were editing it. Refresh and try again.");
      const failed = result.find(([error]) => error);
      if (failed) throw failed[0];
    } finally {
      await client.unwatch().catch(() => undefined);
    }
    return 1;
  }

  async remove(target: DbTarget, keys: Row[]): Promise<number> {
    const names = (Array.isArray(keys) ? keys : []).map(k => String(k?.key ?? "")).filter(Boolean);
    if (!names.length) throw new DbError("Select at least one key.");
    const client = await this.client(target.database);
    let removed = 0;
    for (let i = 0; i < names.length; i += 500) {
      const batch = names.slice(i, i + 500);
      removed += await client.unlink(...batch).catch(() => client.del(...batch));
    }
    return removed;
  }

  async drop(target: DbTarget): Promise<void> {
    await (await this.client(target.database)).flushdb();
  }

  async truncate(target: DbTarget): Promise<void> {
    await this.drop(target);
  }

  classify(text: string): StatementCheck[] {
    return classifyRedis(text).map(({ verb, write, danger }) => ({ verb, write, danger }));
  }

  private formatReply(reply: unknown, verb: string): { rows: Row[]; columns: string[]; message?: string } {
    const text = (v: unknown): unknown => (Buffer.isBuffer(v) ? v.toString("utf8") : Array.isArray(v) ? v.map(text) : v);
    const value = text(reply);
    if (value === null || value === undefined) return { rows: [], columns: [], message: "(nil)" };
    if (!Array.isArray(value)) return { rows: [], columns: [], message: typeof value === "string" ? value : JSON.stringify(value) };
    if (["hgetall", "config", "xinfo", "memory"].includes(verb) && value.length % 2 === 0 && value.every((v, i) => i % 2 === 1 || typeof v === "string")) {
      const rows: Row[] = [];
      for (let i = 0; i < value.length; i += 2) rows.push({ field: value[i], value: value[i + 1] });
      return { rows, columns: ["field", "value"] };
    }
    if (verb === "scan" || verb === "sscan" || verb === "hscan" || verb === "zscan") {
      const [cursor, items] = value as [string, unknown[]];
      return { rows: (items ?? []).map((item, i) => ({ "#": i + 1, value: item })), columns: ["#", "value"], message: `Next cursor: ${cursor}` };
    }
    return { rows: value.map((item, i) => ({ "#": i + 1, value: item })), columns: ["#", "value"] };
  }

  async runQuery(text: string, context: { database?: string }): Promise<QueryResult> {
    const start = Date.now();
    const commands = classifyRedis(text);
    const client = await this.client(context.database);
    const replies: Array<{ verb: string; reply: unknown }> = [];
    for (const command of commands) {
      const [name, ...args] = command.args;
      replies.push({ verb: command.verb, reply: await client.call(name, ...args) });
    }
    if (replies.length === 1) {
      const { rows, columns, message } = this.formatReply(replies[0].reply, replies[0].verb);
      return { columns, rows: rows.slice(0, LIMITS.maxQueryRows), truncated: rows.length > LIMITS.maxQueryRows, message, elapsedMs: since(start) };
    }
    return {
      columns: ["command", "reply"],
      rows: replies.map((r, i) => ({ command: commands[i].args.join(" ").slice(0, 200), reply: r.reply })),
      elapsedMs: since(start)
    };
  }
}
