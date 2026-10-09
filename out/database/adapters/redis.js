"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisAdapter = exports.classifyRedis = exports.tokenizeCommand = exports.REDIS_TYPES = void 0;
const types_1 = require("../types");
const values_1 = require("../values");
exports.REDIS_TYPES = ["string", "hash", "list", "set", "zset", "stream", "ReJSON-RL"];
const EDITABLE_TYPES = ["string", "hash", "list", "set", "zset"];
/** Commands the console refuses: they block, subscribe, or would desynchronise the connection. */
const BLOCKED = new Set(["subscribe", "psubscribe", "ssubscribe", "unsubscribe", "punsubscribe", "monitor", "sync", "psync", "shutdown", "quit", "select", "reset", "blpop", "brpop", "brpoplpush", "blmove", "blmpop", "bzpopmin", "bzpopmax", "bzmpop", "wait", "waitaof", "multi", "exec", "discard", "watch", "unwatch", "hello", "auth", "client"]);
const DANGEROUS = {
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
function tokenizeCommand(line) {
    const out = [];
    let i = 0;
    while (i < line.length) {
        while (i < line.length && /\s/.test(line[i]))
            i++;
        if (i >= line.length)
            break;
        let token = "";
        const quote = line[i] === '"' || line[i] === "'" ? line[i++] : "";
        let closed = !quote;
        while (i < line.length) {
            const ch = line[i];
            if (!quote && /\s/.test(ch))
                break;
            if (quote && ch === quote) {
                i++;
                closed = true;
                break;
            }
            if (quote === '"' && ch === "\\" && i + 1 < line.length) {
                const next = line[i + 1];
                token += { n: "\n", t: "\t", r: "\r" }[next] ?? next;
                i += 2;
                continue;
            }
            token += ch;
            i++;
        }
        if (!closed)
            throw new types_1.DbError("Unterminated quote in the command.");
        out.push(token);
    }
    return out;
}
exports.tokenizeCommand = tokenizeCommand;
function classifyRedis(text) {
    const lines = String(text ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#") && !l.startsWith("//"));
    if (!lines.length)
        throw new types_1.DbError("Enter a command, e.g. SCAN 0 MATCH user:* COUNT 100");
    if (lines.length > 50)
        throw new types_1.DbError("Run at most 50 commands at a time.");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const commands = require("@ioredis/commands");
    return lines.map(line => {
        const args = tokenizeCommand(line);
        const verb = (args[0] ?? "").toLowerCase();
        if (!/^[a-z][a-z0-9._|-]*$/i.test(verb))
            throw new types_1.DbError(`"${args[0]}" is not a Redis command.`);
        if (BLOCKED.has(verb))
            throw new types_1.DbError(`${verb.toUpperCase()} is not available in this console.`, verb === "select" ? "Pick the database from the selector instead." : "It blocks, subscribes or changes the connection itself.");
        let danger = DANGEROUS[verb];
        const sub = (args[1] ?? "").toLowerCase();
        if (verb === "script" && sub !== "flush")
            danger = undefined;
        if (verb === "function" && !["delete", "flush"].includes(sub))
            danger = undefined;
        if (verb === "config" && !["set", "rewrite", "resetstat"].includes(sub))
            danger = undefined;
        if (verb === "cluster" && !["reset", "forget", "failover", "flushslots", "delslots"].includes(sub))
            danger = undefined;
        if (verb === "acl" && !["deluser", "setuser", "load"].includes(sub))
            danger = undefined;
        // Unknown commands (modules such as JSON.* or FT.*) are treated as writes.
        const write = !commands.exists(verb) || commands.hasFlag(verb, "write") || !!danger;
        return { verb, write, danger, args };
    });
}
exports.classifyRedis = classifyRedis;
const TTL_LIMIT = 10 * 365 * 24 * 3600;
class RedisAdapter {
    constructor(spec) {
        this.spec = spec;
        this.kind = "redis";
        this.clients = new Map();
        this.defaultDb = Number(spec.database || 0);
    }
    dbIndex(database) {
        const n = database === undefined || database === "" ? this.defaultDb : Number(database);
        if (!Number.isInteger(n) || n < 0 || n > 1023)
            throw new types_1.DbError(`"${database}" is not a Redis database number.`);
        return n;
    }
    async client(database) {
        const db = this.dbIndex(database);
        let client = this.clients.get(db);
        if (client) {
            // Most recently used last, so the oldest is evicted first.
            this.clients.delete(db);
            this.clients.set(db, client);
        }
        else {
            if (this.clients.size >= 6) {
                const [oldest, stale] = [...this.clients.entries()].find(([n]) => n !== this.defaultDb);
                this.clients.delete(oldest);
                stale.quit().catch(() => stale.disconnect());
            }
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const IORedis = require("ioredis");
            client = new IORedis({
                host: this.spec.host,
                port: this.spec.port,
                username: this.spec.user || undefined,
                password: this.spec.password || undefined,
                db,
                tls: this.spec.ssl ? { servername: this.spec.host, rejectUnauthorized: !/^(true|1|yes)$/i.test(this.spec.options.skip_verify ?? this.spec.options.insecure ?? "") } : undefined,
                lazyConnect: true,
                connectTimeout: types_1.LIMITS.connectTimeoutMs,
                commandTimeout: types_1.LIMITS.queryTimeoutMs,
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
            }
            catch (error) {
                this.clients.delete(db);
                client.disconnect();
                throw error;
            }
        }
        return client;
    }
    async connect() {
        const client = await this.client();
        const info = await client.info("server");
        const version = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? "";
        const valkey = /valkey_version:([^\r\n]+)/.exec(info)?.[1];
        return { version: valkey ? `Valkey ${valkey}` : `Redis ${version}`, defaultDatabase: String(this.defaultDb) };
    }
    async close() {
        const clients = [...this.clients.values()];
        this.clients.clear();
        await Promise.allSettled(clients.map(c => c.quit().catch(() => c.disconnect())));
    }
    async ping() {
        await (await this.client()).ping();
    }
    invalidate() {
        /* nothing cached */
    }
    async listDatabases() {
        const client = await this.client();
        let count = 0;
        try {
            const reply = (await client.call("CONFIG", "GET", "databases"));
            count = Number(reply?.[1]) || 0;
        }
        catch {
            // Managed services (Upstash, ElastiCache serverless) disable CONFIG.
        }
        const used = new Set([this.defaultDb]);
        const keyspace = await client.info("keyspace").catch(() => "");
        for (const m of keyspace.matchAll(/^db(\d+):/gm))
            used.add(Number(m[1]));
        const all = count ? Array.from({ length: Math.min(count, 64) }, (_, i) => i) : [...used].sort((a, b) => a - b);
        return all.map(String);
    }
    async databaseSizes() {
        const keyspace = await (await this.client()).info("keyspace");
        const sizes = {};
        for (const m of keyspace.matchAll(/^db(\d+):keys=(\d+)/gm))
            sizes[m[1]] = Number(m[2]);
        return sizes;
    }
    async listSchemas() {
        return [];
    }
    async listObjects(database) {
        const client = await this.client(database);
        return [{ name: "keys", type: "keys", rows: await client.dbsize() }];
    }
    async describe() {
        const col = (name, dataType, category, extra = {}) => ({ name, dataType, category, nullable: false, primaryKey: false, autoIncrement: false, editable: true, sortable: false, ...extra });
        return [
            col("key", "string", "text", { primaryKey: true, sortable: true }),
            col("type", "type", "text"),
            col("ttl", "seconds", "number", { nullable: true }),
            col("size", "length", "number"),
            col("value", "preview", "other")
        ];
    }
    async scanKeys(client, pattern, type) {
        const keys = new Set();
        let cursor = "0";
        let typeSupported = !!type;
        const started = Date.now();
        do {
            let reply;
            try {
                reply = (typeSupported
                    ? await client.call("SCAN", cursor, "MATCH", pattern, "COUNT", "1000", "TYPE", type)
                    : await client.call("SCAN", cursor, "MATCH", pattern, "COUNT", "1000"));
            }
            catch (error) {
                // SCAN ... TYPE needs Redis 6; older servers filter afterwards.
                if (typeSupported && cursor === "0") {
                    typeSupported = false;
                    continue;
                }
                throw error;
            }
            cursor = reply[0];
            for (const key of reply[1])
                keys.add(key);
            if (Date.now() - started > types_1.LIMITS.queryTimeoutMs)
                break;
        } while (cursor !== "0" && keys.size < types_1.LIMITS.maxScanKeys);
        let list = [...keys];
        if (type && !typeSupported) {
            const pipeline = client.pipeline();
            list.forEach(k => pipeline.type(k));
            const types = (await pipeline.exec()) ?? [];
            list = list.filter((_, i) => types[i]?.[1] === type);
        }
        return { keys: list.slice(0, types_1.LIMITS.maxScanKeys), capped: cursor !== "0" };
    }
    async fetchPage(request) {
        const start = Date.now();
        const client = await this.client(request.target.database);
        const search = (request.search ?? "").trim();
        const pattern = (request.query ?? "").trim() || (search ? `*${search.replace(/[*?[\]\\]/g, m => "\\" + m)}*` : "*");
        if (pattern.length > 1024)
            throw new types_1.DbError("The key pattern is too long.");
        const type = request.keyType && exports.REDIS_TYPES.includes(request.keyType) ? request.keyType : undefined;
        const { keys, capped } = await this.scanKeys(client, pattern, type);
        keys.sort();
        if (request.sort?.dir === "desc")
            keys.reverse();
        const pageSize = Math.max(1, Math.min(types_1.LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
        const page = Math.max(1, Math.floor(Number(request.page) || 1));
        const slice = keys.slice((page - 1) * pageSize, page * pageSize);
        const meta = client.pipeline();
        slice.forEach(k => meta.type(k).pttl(k));
        const metaReplies = (await meta.exec()) ?? [];
        const details = slice.map((key, i) => ({ key, type: String(metaReplies[i * 2]?.[1] ?? "none"), pttl: Number(metaReplies[i * 2 + 1]?.[1] ?? -2) }));
        const preview = client.pipeline();
        for (const d of details)
            this.queuePreview(preview, d.key, d.type);
        const previewReplies = (await preview.exec()) ?? [];
        let p = 0;
        const rows = [];
        for (const d of details) {
            const [size, value] = this.readPreview(d.type, previewReplies, p);
            p += this.previewCommands(d.type);
            if (d.type === "none")
                continue; // expired between SCAN and now
            rows.push({ key: d.key, type: d.type, ttl: d.pttl >= 0 ? Math.ceil(d.pttl / 1000) : null, size, value });
        }
        return {
            columns: await this.describe(),
            rows,
            total: keys.length,
            totalCapped: capped,
            keyColumns: ["key"],
            keyStrategy: "key",
            elapsedMs: (0, values_1.since)(start)
        };
    }
    previewCommands(type) {
        return ["string", "hash", "list", "set", "zset", "stream"].includes(type) ? 2 : 0;
    }
    queuePreview(pipeline, key, type) {
        switch (type) {
            case "string":
                pipeline.strlen(key).getrange(key, 0, 299);
                break;
            case "hash":
                pipeline.hlen(key).hscan(key, 0, "COUNT", 20);
                break;
            case "list":
                pipeline.llen(key).lrange(key, 0, 19);
                break;
            case "set":
                pipeline.scard(key).sscan(key, 0, "COUNT", 20);
                break;
            case "zset":
                pipeline.zcard(key).zrange(key, 0, 19, "WITHSCORES");
                break;
            case "stream":
                pipeline.xlen(key).xrevrange(key, "+", "-", "COUNT", 3);
                break;
        }
    }
    readPreview(type, replies, at) {
        if (!this.previewCommands(type))
            return [null, type === "none" ? null : `<${type}>`];
        const size = Number(replies[at]?.[1] ?? 0);
        const value = replies[at + 1]?.[1];
        switch (type) {
            case "string": return [size, size > 300 ? `${value}…` : value];
            case "hash": {
                const flat = (value?.[1] ?? []);
                const obj = {};
                for (let i = 0; i < flat.length; i += 2)
                    obj[flat[i]] = flat[i + 1];
                return [size, obj];
            }
            case "set": return [size, value?.[1] ?? []];
            case "zset": {
                const flat = value ?? [];
                const out = [];
                for (let i = 0; i < flat.length; i += 2)
                    out.push({ member: flat[i], score: Number(flat[i + 1]) });
                return [size, out];
            }
            case "stream": return [size, (value ?? []).map(([id, fields]) => ({ id, fields: Object.fromEntries(fields.reduce((acc, f, i) => (i % 2 ? acc[acc.length - 1].push(f) : acc.push([f]), acc), [])) }))];
            default: return [size, value];
        }
    }
    async readKey(database, key) {
        if (typeof key !== "string" || !key)
            throw new types_1.DbError("No key selected.");
        const client = await this.client(database);
        const [type, pttl] = await Promise.all([client.type(key), client.pttl(key)]);
        const cap = types_1.LIMITS.maxScanKeys;
        let value;
        let truncated = false;
        switch (type) {
            case "none": throw new types_1.DbError(`The key "${key.slice(0, 80)}" no longer exists.`, "It may have expired. Refresh the list.");
            case "string": {
                const length = await client.strlen(key);
                truncated = length > 1000000;
                value = truncated ? await client.getrange(key, 0, 999999) : await client.get(key);
                break;
            }
            case "hash": {
                truncated = (await client.hlen(key)) > cap;
                if (!truncated)
                    value = await client.hgetall(key);
                else {
                    const [, flat] = await client.hscan(key, 0, "COUNT", cap);
                    const obj = {};
                    for (let i = 0; i < flat.length; i += 2)
                        obj[flat[i]] = flat[i + 1];
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
                const out = [];
                for (let i = 0; i < flat.length; i += 2)
                    out.push({ member: flat[i], score: Number(flat[i + 1]) });
                value = out;
                break;
            }
            case "stream": {
                const entries = (await client.xrevrange(key, "+", "-", "COUNT", 100));
                value = entries.map(([id, fields]) => {
                    const obj = {};
                    for (let i = 0; i < fields.length; i += 2)
                        obj[fields[i]] = fields[i + 1];
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
    parseTtl(input) {
        if (!input || input.mode !== "value")
            return undefined;
        const text = String(input.value ?? "").trim();
        if (!text)
            return undefined;
        const n = Number(text);
        if (!Number.isInteger(n) || n < -1 || n === 0 || n > TTL_LIMIT)
            throw new types_1.DbError("TTL must be a whole number of seconds (or -1 for no expiry).");
        return n;
    }
    /** Queues the commands that write `text` as a value of `type`. */
    queueWrite(multi, key, type, text) {
        const asString = (v) => (typeof v === "string" ? v : JSON.stringify(v));
        const parse = (expect) => {
            try {
                return JSON.parse(text);
            }
            catch (error) {
                throw new types_1.DbError(`A ${type} value must be JSON (${expect}): ${error.message}`);
            }
        };
        switch (type) {
            case "string":
                multi.set(key, text);
                return;
            case "hash": {
                const obj = parse('{ "field": "value" }');
                if (!obj || typeof obj !== "object" || Array.isArray(obj) || !Object.keys(obj).length)
                    throw new types_1.DbError('A hash needs at least one field: { "field": "value" }.');
                multi.hset(key, Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, asString(v)])));
                return;
            }
            case "list":
            case "set": {
                const arr = parse('["a", "b"]');
                if (!Array.isArray(arr) || !arr.length)
                    throw new types_1.DbError(`A ${type} needs a non-empty JSON array: ["a", "b"].`);
                if (type === "list")
                    multi.rpush(key, ...arr.map(asString));
                else
                    multi.sadd(key, ...arr.map(asString));
                return;
            }
            case "zset": {
                const value = parse('[{ "member": "a", "score": 1 }]');
                const pairs = Array.isArray(value)
                    ? value.map((item) => [Number(item?.score), asString(item?.member)])
                    : value && typeof value === "object" ? Object.entries(value).map(([member, score]) => [Number(score), member]) : [];
                if (!pairs.length || pairs.some(([score, member]) => !Number.isFinite(score) || member === undefined))
                    throw new types_1.DbError('A sorted set needs members with numeric scores: [{ "member": "a", "score": 1 }].');
                multi.zadd(key, ...pairs.flatMap(([score, member]) => [score, member]));
                return;
            }
            case "ReJSON-RL":
                parse("any JSON");
                multi.call("JSON.SET", key, "$", text);
                return;
            default:
                throw new types_1.DbError(`${type} keys cannot be written here. Use the console.`);
        }
    }
    textOf(values, field) {
        const input = values?.[field];
        if (!input || input.mode !== "value")
            throw new types_1.DbError(`Enter a ${field}.`);
        return String(input.value ?? "");
    }
    async insert(target, values) {
        const client = await this.client(target.database);
        const key = this.textOf(values, "key");
        if (!key || key.length > 4096)
            throw new types_1.DbError("Enter a key name (at most 4096 characters).");
        const type = this.textOf(values, "type");
        if (![...EDITABLE_TYPES, "ReJSON-RL"].includes(type))
            throw new types_1.DbError(`Choose one of: ${EDITABLE_TYPES.join(", ")}.`);
        const ttl = this.parseTtl(values.ttl);
        await client.watch(key);
        try {
            if (await client.exists(key))
                throw new types_1.DbError(`The key "${key.slice(0, 80)}" already exists.`, "Open it to edit it instead.");
            const multi = client.multi();
            this.queueWrite(multi, key, type, this.textOf(values, "value"));
            if (ttl && ttl > 0)
                multi.expire(key, ttl);
            const result = await multi.exec();
            if (!result)
                throw new types_1.DbError("The key was created by someone else at the same time. Refresh and try again.");
            const failed = result.find(([error]) => error);
            if (failed)
                throw failed[0];
        }
        finally {
            await client.unwatch().catch(() => undefined);
        }
        return 1;
    }
    async update(target, keyRow, _strategy, values) {
        const client = await this.client(target.database);
        const key = String(keyRow?.key ?? "");
        if (!key)
            throw new types_1.DbError("No key selected.");
        await client.watch(key);
        try {
            const [type, pttl] = await Promise.all([client.type(key), client.pttl(key)]);
            if (type === "none")
                throw new types_1.DbError("The key no longer exists. It may have expired.");
            if (!EDITABLE_TYPES.includes(type) && type !== "ReJSON-RL")
                throw new types_1.DbError(`${type} keys are read-only here. Use the console.`);
            const ttl = this.parseTtl(values.ttl);
            const multi = client.multi();
            if (values.value) {
                multi.del(key);
                this.queueWrite(multi, key, type, this.textOf(values, "value"));
            }
            if (ttl === -1)
                multi.persist(key);
            else if (ttl)
                multi.expire(key, ttl);
            // Rewriting the value drops the TTL, so the remaining time is put back.
            else if (values.value && pttl > 0)
                multi.pexpire(key, pttl);
            const result = await multi.exec();
            if (!result)
                throw new types_1.DbError("The key changed while you were editing it. Refresh and try again.");
            const failed = result.find(([error]) => error);
            if (failed)
                throw failed[0];
        }
        finally {
            await client.unwatch().catch(() => undefined);
        }
        return 1;
    }
    async remove(target, keys) {
        const names = (Array.isArray(keys) ? keys : []).map(k => String(k?.key ?? "")).filter(Boolean);
        if (!names.length)
            throw new types_1.DbError("Select at least one key.");
        const client = await this.client(target.database);
        let removed = 0;
        for (let i = 0; i < names.length; i += 500) {
            const batch = names.slice(i, i + 500);
            removed += await client.unlink(...batch).catch(() => client.del(...batch));
        }
        return removed;
    }
    async drop(target) {
        await (await this.client(target.database)).flushdb();
    }
    async truncate(target) {
        await this.drop(target);
    }
    classify(text) {
        return classifyRedis(text).map(({ verb, write, danger }) => ({ verb, write, danger }));
    }
    formatReply(reply, verb) {
        const text = (v) => (Buffer.isBuffer(v) ? v.toString("utf8") : Array.isArray(v) ? v.map(text) : v);
        const value = text(reply);
        if (value === null || value === undefined)
            return { rows: [], columns: [], message: "(nil)" };
        if (!Array.isArray(value))
            return { rows: [], columns: [], message: typeof value === "string" ? value : JSON.stringify(value) };
        if (["hgetall", "config", "xinfo", "memory"].includes(verb) && value.length % 2 === 0 && value.every((v, i) => i % 2 === 1 || typeof v === "string")) {
            const rows = [];
            for (let i = 0; i < value.length; i += 2)
                rows.push({ field: value[i], value: value[i + 1] });
            return { rows, columns: ["field", "value"] };
        }
        if (verb === "scan" || verb === "sscan" || verb === "hscan" || verb === "zscan") {
            const [cursor, items] = value;
            return { rows: (items ?? []).map((item, i) => ({ "#": i + 1, value: item })), columns: ["#", "value"], message: `Next cursor: ${cursor}` };
        }
        return { rows: value.map((item, i) => ({ "#": i + 1, value: item })), columns: ["#", "value"] };
    }
    async runQuery(text, context) {
        const start = Date.now();
        const commands = classifyRedis(text);
        const client = await this.client(context.database);
        const replies = [];
        for (const command of commands) {
            const [name, ...args] = command.args;
            replies.push({ verb: command.verb, reply: await client.call(name, ...args) });
        }
        if (replies.length === 1) {
            const { rows, columns, message } = this.formatReply(replies[0].reply, replies[0].verb);
            return { columns, rows: rows.slice(0, types_1.LIMITS.maxQueryRows), truncated: rows.length > types_1.LIMITS.maxQueryRows, message, elapsedMs: (0, values_1.since)(start) };
        }
        return {
            columns: ["command", "reply"],
            rows: replies.map((r, i) => ({ command: commands[i].args.join(" ").slice(0, 200), reply: r.reply })),
            elapsedMs: (0, values_1.since)(start)
        };
    }
}
exports.RedisAdapter = RedisAdapter;
//# sourceMappingURL=redis.js.map