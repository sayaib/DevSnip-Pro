import type { Collection, Document, FindCursor, MongoClient, AggregationCursor } from "mongodb";
import { ConnectionSpec } from "../connection-string";
import { classifyShellCommand, parseShellCommand, parseShellObject, parseShellValue } from "../mongo-shell";
import { CellInput, ColumnInfo, DbAdapter, DbError, DbTarget, FilterRule, FILTER_OPS, KeyStrategy, LIMITS, ObjectInfo, PageRequest, PageResult, QueryResult, Row, ServerInfo, StatementCheck, ValueCategory } from "../types";
import { since } from "../values";

type Ejson = { serialize(value: unknown, options?: { relaxed?: boolean }): any; deserialize(value: unknown, options?: { relaxed?: boolean }): any; stringify(value: unknown, options?: { relaxed?: boolean }): string };

/** The editor sends a whole document under this key. */
export const DOCUMENT_FIELD = "$document";

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function bsonType(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  const type = (value as { _bsontype?: string })?._bsontype;
  if (type) return type === "ObjectID" ? "objectId" : type.charAt(0).toLowerCase() + type.slice(1);
  if (typeof value === "object") return "object";
  return typeof value;
}

function categoryOf(types: string[]): ValueCategory {
  const real = types.filter(t => t !== "null");
  if (!real.length) return "other";
  if (real.every(t => ["number", "int32", "double", "long", "decimal128"].includes(t))) return "number";
  if (real.every(t => t === "boolean")) return "boolean";
  if (real.every(t => t === "date")) return "date";
  if (real.every(t => t === "binary")) return "binary";
  if (real.every(t => t === "string" || t === "objectId")) return "text";
  return "json";
}

export class MongoAdapter implements DbAdapter {
  readonly kind = "mongodb" as const;
  private client?: MongoClient;
  private ejson!: Ejson;
  private defaultDb = "test";
  private readonly samples = new Map<string, { at: number; columns: ColumnInfo[] }>();

  constructor(private readonly spec: ConnectionSpec) {
    this.defaultDb = spec.database || "test";
  }

  private get mongo(): MongoClient {
    if (!this.client) throw new DbError("Not connected.");
    return this.client;
  }

  private collection(target: DbTarget): Collection<Document> {
    if (!target?.object) throw new DbError("No collection selected.");
    return this.mongo.db(target.database || this.defaultDb).collection(target.object);
  }

  private toEjson(doc: unknown): Row {
    return this.ejson.serialize(doc, { relaxed: true }) as Row;
  }

  private fromEjson<T = unknown>(value: unknown): T {
    return this.ejson.deserialize(value, { relaxed: true }) as T;
  }

  async connect(): Promise<ServerInfo> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const driver = require("mongodb") as typeof import("mongodb");
    this.ejson = driver.BSON.EJSON as unknown as Ejson;
    this.client = new driver.MongoClient(this.spec.url!, {
      serverSelectionTimeoutMS: LIMITS.connectTimeoutMs,
      connectTimeoutMS: LIMITS.connectTimeoutMs,
      socketTimeoutMS: LIMITS.queryTimeoutMs + 10_000,
      maxPoolSize: 4,
      appName: "DevSnip Pro"
    });
    await this.client.connect();
    const info = await this.client.db("admin").command({ buildInfo: 1 }).catch(() => ({} as Document));
    const dbName = (this.client as unknown as { options?: { dbName?: string } }).options?.dbName;
    if (!this.spec.database && dbName) this.defaultDb = dbName;
    return { version: `MongoDB ${info.version ?? ""}`.trim(), defaultDatabase: this.defaultDb };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => undefined);
  }

  async ping(): Promise<void> {
    await this.mongo.db("admin").command({ ping: 1 });
  }

  invalidate(): void {
    this.samples.clear();
  }

  async listDatabases(): Promise<string[]> {
    let names: string[] = [];
    try {
      const result = await this.mongo.db("admin").admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
      names = result.databases.map(d => d.name);
    } catch {
      // Users without listDatabases rights can still browse the database they connected to.
    }
    if (!names.includes(this.defaultDb)) names.unshift(this.defaultDb);
    const system = new Set(["admin", "local", "config"]);
    return [...names.filter(n => !system.has(n)).sort(), ...names.filter(n => system.has(n)).sort()];
  }

  async listSchemas(): Promise<string[]> {
    return [];
  }

  async listObjects(database: string): Promise<ObjectInfo[]> {
    const db = this.mongo.db(database || this.defaultDb);
    const collections = await db.listCollections({}, { nameOnly: false, authorizedCollections: true }).toArray();
    const visible = collections.filter(c => !c.name.startsWith("system.")).sort((a, b) => a.name.localeCompare(b.name));
    const counts = visible.length <= 50
      ? await Promise.all(visible.map(c => c.type === "view" ? Promise.resolve(undefined) : db.collection(c.name).estimatedDocumentCount({ maxTimeMS: 3000 }).catch(() => undefined)))
      : [];
    return visible.map((c, i) => ({ name: c.name, type: c.type === "view" ? "view" : "collection", rows: counts[i] }));
  }

  /** Infers the fields of a collection from a random sample. */
  async describe(target: DbTarget): Promise<ColumnInfo[]> {
    const key = `${target.database}\u0000${target.object}`;
    const cached = this.samples.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.columns;
    const docs = await this.collection(target).aggregate([{ $sample: { size: LIMITS.mongoSample } }], { maxTimeMS: LIMITS.queryTimeoutMs }).toArray();
    const columns = this.columnsFor(docs);
    this.samples.set(key, { at: Date.now(), columns });
    return columns;
  }

  private columnsFor(docs: Document[], known: ColumnInfo[] = []): ColumnInfo[] {
    const stats = new Map<string, { count: number; types: Set<string> }>();
    for (const doc of docs) {
      for (const [field, value] of Object.entries(doc)) {
        const entry = stats.get(field) ?? { count: 0, types: new Set<string>() };
        entry.count++;
        entry.types.add(bsonType(value));
        stats.set(field, entry);
      }
    }
    const columns: ColumnInfo[] = [...stats.entries()].map(([name, s]) => {
      const types = [...s.types];
      return {
        name,
        dataType: types.join(" | "),
        category: categoryOf(types),
        nullable: s.count < docs.length || types.includes("null"),
        primaryKey: name === "_id",
        autoIncrement: false,
        editable: name !== "_id",
        presence: docs.length ? s.count / docs.length : 0
      };
    });
    for (const column of known) if (!stats.has(column.name)) columns.push(column);
    if (!columns.some(c => c.name === "_id") && docs.length) columns.unshift({ name: "_id", dataType: "objectId", category: "text", nullable: false, primaryKey: true, autoIncrement: true, editable: false });
    // _id first, then the most common fields; ties keep the order fields appear in documents (the sort is stable).
    return columns.sort((a, b) => (a.name === "_id" ? -1 : b.name === "_id" ? 1 : (b.presence ?? 0) - (a.presence ?? 0)));
  }

  /** A filter value typed in the grid: JSON or shell literals (42, true, ObjectId("...")), else plain text. */
  private filterValue(field: string, raw: string): unknown {
    const text = raw.trim();
    if (field === "_id" && /^[0-9a-f]{24}$/i.test(text)) return this.fromEjson({ $oid: text.toLowerCase() });
    try {
      return this.fromEjson(parseShellValue(text));
    } catch {
      return raw;
    }
  }

  private ruleFilter(rule: FilterRule): Document {
    if (!FILTER_OPS.includes(rule.op)) throw new DbError(`Unknown filter operator "${rule.op}".`);
    if (typeof rule.column !== "string" || !rule.column || rule.column.startsWith("$")) throw new DbError("Invalid field name.");
    const value = String(rule.value ?? "");
    const field = rule.column;
    switch (rule.op) {
      case "null": return { [field]: null };
      case "notnull": return { [field]: { $ne: null } };
      case "contains": return { [field]: { $regex: escapeRegex(value), $options: "i" } };
      case "starts": return { [field]: { $regex: `^${escapeRegex(value)}`, $options: "i" } };
      case "ends": return { [field]: { $regex: `${escapeRegex(value)}$`, $options: "i" } };
      case "in": return { [field]: { $in: value.split(",").map(v => v.trim()).filter(Boolean).map(v => this.filterValue(field, v)) } };
      case "eq": return { [field]: this.filterValue(field, value) };
      default: return { [field]: { [`$${rule.op === "neq" ? "ne" : rule.op}`]: this.filterValue(field, value) } };
    }
  }

  async fetchPage(request: PageRequest): Promise<PageResult> {
    const start = Date.now();
    const collection = this.collection(request.target);
    const known = await this.describe(request.target);
    const parts: Document[] = [];
    const base = this.fromEjson<Document>(parseShellObject(request.query ?? "", "The filter"));
    if (Object.keys(base).length) parts.push(base);
    for (const rule of request.filters ?? []) parts.push(this.ruleFilter(rule));
    const search = (request.search ?? "").trim();
    if (search) {
      const fields = known.filter(c => c.category === "text" && c.name !== "_id").slice(0, 25).map(c => c.name);
      const or: Document[] = fields.map(f => ({ [f]: { $regex: escapeRegex(search), $options: "i" } }));
      if (/^[0-9a-f]{24}$/i.test(search)) or.push({ _id: this.fromEjson({ $oid: search.toLowerCase() }) });
      if (or.length) parts.push({ $or: or });
    }
    const filter: Document = parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };
    const pageSize = Math.max(1, Math.min(LIMITS.maxPageSize, Math.floor(Number(request.pageSize) || 50)));
    const page = Math.max(1, Math.floor(Number(request.page) || 1));
    const sort: Record<string, 1 | -1> = request.sort ? { [request.sort.column]: request.sort.dir === "desc" ? -1 : 1 } : { _id: 1 };
    if (request.sort && (typeof request.sort.column !== "string" || request.sort.column.startsWith("$"))) throw new DbError("Invalid sort field.");
    const [docs, total] = await Promise.all([
      collection.find(filter, { maxTimeMS: LIMITS.queryTimeoutMs }).sort(sort).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      (Object.keys(filter).length ? collection.countDocuments(filter, { maxTimeMS: LIMITS.queryTimeoutMs }) : collection.estimatedDocumentCount({ maxTimeMS: LIMITS.queryTimeoutMs })).catch(() => null)
    ]);
    return {
      columns: this.columnsFor(docs, known),
      rows: docs.map(doc => this.toEjson(doc)),
      total,
      keyColumns: ["_id"],
      keyStrategy: "_id",
      elapsedMs: since(start)
    };
  }

  private parseDocument(values: Record<string, CellInput>): Document {
    const input = values?.[DOCUMENT_FIELD];
    if (!input || input.mode !== "value") throw new DbError("No document was sent.");
    const doc = this.fromEjson<Document>(parseShellObject(String(input.value ?? ""), "A document"));
    if (Object.keys(doc).some(k => k.startsWith("$"))) throw new DbError("Top-level field names cannot start with $.");
    return doc;
  }

  private idOf(key: Row): unknown {
    if (!key || !("_id" in key)) throw new DbError("The document has no _id, so it cannot be changed here.");
    return this.fromEjson<{ _id: unknown }>({ _id: key._id })._id;
  }

  async insert(target: DbTarget, values: Record<string, CellInput>): Promise<number> {
    const result = await this.collection(target).insertOne(this.parseDocument(values));
    this.invalidate();
    return result.acknowledged ? 1 : 0;
  }

  async update(target: DbTarget, key: Row, _strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number> {
    const id = this.idOf(key);
    const doc = this.parseDocument(values);
    if ("_id" in doc) {
      if (this.ejson.stringify({ v: doc._id }) !== this.ejson.stringify({ v: id })) throw new DbError("_id cannot be changed. Duplicate the document instead, then delete the old one.");
      delete doc._id;
    }
    const result = await this.collection(target).replaceOne({ _id: id } as Document, doc);
    if (!result.matchedCount) throw new DbError("The document no longer exists. Refresh and try again.");
    this.invalidate();
    return result.modifiedCount;
  }

  async remove(target: DbTarget, keys: Row[]): Promise<number> {
    if (!Array.isArray(keys) || !keys.length) throw new DbError("Select at least one document.");
    const ids = keys.map(k => this.idOf(k));
    const result = await this.collection(target).deleteMany({ _id: { $in: ids } } as Document);
    return result.deletedCount;
  }

  async drop(target: DbTarget): Promise<void> {
    await this.collection(target).drop();
    this.invalidate();
  }

  async truncate(target: DbTarget): Promise<void> {
    await this.collection(target).deleteMany({});
  }

  async createCollection(database: string, name: string): Promise<void> {
    const clean = String(name ?? "").trim();
    if (!clean || clean.length > 120 || /[$\u0000]/.test(clean) || clean.startsWith("system.") || clean.startsWith(".") || clean.endsWith(".")) {
      throw new DbError("Collection names cannot be empty, contain $ or start with system.");
    }
    await this.mongo.db(database || this.defaultDb).createCollection(clean);
  }

  classify(text: string): StatementCheck[] {
    return [classifyShellCommand(parseShellCommand(text))];
  }

  private documentsResult(start: number, docs: Document[], truncated: boolean, message?: string): QueryResult {
    const rows = docs.map(d => (d && typeof d === "object" && !Array.isArray(d) ? this.toEjson(d) : { value: this.toEjson({ v: d }).v }));
    const columns: string[] = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    return { columns, rows, truncated, message, elapsedMs: since(start) };
  }

  private messageResult(start: number, value: unknown): QueryResult {
    const text = typeof value === "string" ? value : JSON.stringify(this.toEjson({ v: value }).v, null, 2);
    return { columns: [], rows: [], message: text, elapsedMs: since(start) };
  }

  private async drain(cursor: FindCursor<Document> | AggregationCursor<Document>): Promise<{ docs: Document[]; truncated: boolean }> {
    const docs: Document[] = [];
    let truncated = false;
    try {
      for await (const doc of cursor) {
        if (docs.length >= LIMITS.maxQueryRows) { truncated = true; break; }
        docs.push(doc);
      }
    } finally {
      await cursor.close().catch(() => undefined);
    }
    return { docs, truncated };
  }

  async runQuery(text: string, context: { database?: string }): Promise<QueryResult> {
    const start = Date.now();
    const command = parseShellCommand(text);
    const check = classifyShellCommand(command);
    const db = this.mongo.db(context.database || this.defaultDb);
    const maxTimeMS = LIMITS.queryTimeoutMs;
    try {
      if (command.kind === "show") {
        if (command.what === "dbs") return this.documentsResult(start, (await this.listDatabases()).map(name => ({ name })), false);
        return this.documentsResult(start, (await db.listCollections({}, { nameOnly: false }).toArray()).map(c => ({ name: c.name, type: c.type })), false);
      }
      const args = command.args.map(a => this.fromEjson(a)) as any[];
      if (command.kind === "db") {
        switch (command.method) {
          case "getCollectionNames": return this.documentsResult(start, (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => ({ name: c.name })), false);
          case "listCollections": return this.documentsResult(start, await db.listCollections(args[0] ?? {}).toArray(), false);
          case "stats": return this.documentsResult(start, [await db.stats()], false);
          case "runCommand": {
            if (!args[0] || typeof args[0] !== "object") throw new DbError("runCommand() expects a command document.");
            return this.documentsResult(start, [await db.command(args[0], { maxTimeMS } as never)], false);
          }
          case "createCollection": await this.createCollection(db.databaseName, String(args[0] ?? "")); return this.messageResult(start, `Created collection ${args[0]}.`);
          case "dropDatabase": await db.dropDatabase(); return this.messageResult(start, `Dropped database ${db.databaseName}.`);
          case "version": return this.messageResult(start, String((await this.mongo.db("admin").command({ buildInfo: 1 })).version ?? ""));
          case "getName": return this.messageResult(start, db.databaseName);
        }
        throw new DbError(`db.${command.method}() is not supported here.`);
      }

      const coll = db.collection(command.collection);
      const chain = new Map(command.chain.map(link => [link.method, link.args.map(a => this.fromEjson(a)) as any[]]));
      switch (command.method) {
        case "find": {
          if (chain.has("count")) return this.messageResult(start, `${await coll.countDocuments(args[0] ?? {}, { maxTimeMS })} documents`);
          const cursor = coll.find(args[0] ?? {}, { projection: args[1] ?? chain.get("project")?.[0] ?? chain.get("projection")?.[0], maxTimeMS });
          if (chain.has("sort")) cursor.sort(chain.get("sort")![0]);
          if (chain.has("skip")) cursor.skip(Number(chain.get("skip")![0]) || 0);
          if (chain.has("hint")) cursor.hint(chain.get("hint")![0]);
          if (chain.has("collation")) cursor.collation(chain.get("collation")![0]);
          const limit = chain.has("limit") ? Math.abs(Number(chain.get("limit")![0]) || 0) : 0;
          cursor.limit(limit && limit <= LIMITS.maxQueryRows ? limit : LIMITS.maxQueryRows + 1);
          const { docs, truncated } = await this.drain(cursor);
          return this.documentsResult(start, docs, truncated || (!limit && docs.length > LIMITS.maxQueryRows));
        }
        case "findOne": {
          const doc = await coll.findOne(args[0] ?? {}, { projection: args[1], maxTimeMS });
          return doc ? this.documentsResult(start, [doc], false) : this.messageResult(start, "No document matched.");
        }
        case "aggregate": {
          if (!Array.isArray(args[0])) throw new DbError("aggregate() expects a pipeline array.");
          const { docs, truncated } = await this.drain(coll.aggregate(args[0], { maxTimeMS, allowDiskUse: chain.has("allowDiskUse") || args[1]?.allowDiskUse }));
          return this.documentsResult(start, docs, truncated, docs.length ? undefined : check.write ? "Pipeline completed." : "No documents.");
        }
        case "countDocuments":
        case "count":
          return this.messageResult(start, `${await coll.countDocuments(args[0] ?? {}, { maxTimeMS })} documents`);
        case "estimatedDocumentCount":
          return this.messageResult(start, `About ${await coll.estimatedDocumentCount({ maxTimeMS })} documents`);
        case "distinct": {
          if (typeof args[0] !== "string") throw new DbError("distinct() expects a field name.");
          const values = await coll.distinct(args[0], args[1] ?? {}, { maxTimeMS });
          return this.documentsResult(start, values.slice(0, LIMITS.maxQueryRows).map(value => ({ value })), values.length > LIMITS.maxQueryRows);
        }
        case "getIndexes":
        case "indexes":
        case "listIndexes":
          return this.documentsResult(start, await coll.indexes(), false);
        case "stats":
          return this.documentsResult(start, [await db.command({ collStats: command.collection })], false);
        case "insertOne": {
          if (!args[0] || typeof args[0] !== "object") throw new DbError("insertOne() expects a document.");
          const r = await coll.insertOne(args[0]);
          return { ...this.messageResult(start, `Inserted 1 document with _id ${this.ejson.stringify({ _id: r.insertedId }, { relaxed: true })}.`), affected: 1 };
        }
        case "insertMany": {
          if (!Array.isArray(args[0])) throw new DbError("insertMany() expects an array of documents.");
          const r = await coll.insertMany(args[0]);
          return { ...this.messageResult(start, `Inserted ${r.insertedCount} documents.`), affected: r.insertedCount };
        }
        case "updateOne":
        case "updateMany":
        case "replaceOne": {
          if (!args[0] || !args[1]) throw new DbError(`${command.method}() expects a filter and ${command.method === "replaceOne" ? "a replacement document" : "an update"}.`);
          const r = command.method === "replaceOne" ? await coll.replaceOne(args[0], args[1], args[2]) : await (coll[command.method] as Function).call(coll, args[0], args[1], args[2]);
          return { ...this.messageResult(start, `Matched ${r.matchedCount}, modified ${r.modifiedCount}${r.upsertedCount ? `, upserted ${r.upsertedCount}` : ""}.`), affected: r.modifiedCount + (r.upsertedCount ?? 0) };
        }
        case "deleteOne":
        case "deleteMany": {
          if (!args[0] || typeof args[0] !== "object") throw new DbError(`${command.method}() needs a filter. Pass {} explicitly to match every document.`);
          const r = await coll[command.method](args[0]);
          return { ...this.messageResult(start, `Deleted ${r.deletedCount} document${r.deletedCount === 1 ? "" : "s"}.`), affected: r.deletedCount };
        }
        case "findOneAndUpdate":
        case "findOneAndReplace":
        case "findOneAndDelete": {
          const r = command.method === "findOneAndDelete"
            ? await coll.findOneAndDelete(args[0] ?? {}, args[1] ?? {})
            : await (coll[command.method] as Function).call(coll, args[0] ?? {}, args[1], args[2] ?? {});
          const doc = r && typeof r === "object" && "value" in r && "ok" in r ? (r as { value: Document | null }).value : (r as Document | null);
          return doc ? this.documentsResult(start, [doc], false) : this.messageResult(start, "No document matched.");
        }
        case "bulkWrite": {
          if (!Array.isArray(args[0])) throw new DbError("bulkWrite() expects an array of operations.");
          const r = await coll.bulkWrite(args[0], args[1]);
          return this.messageResult(start, `Inserted ${r.insertedCount}, matched ${r.matchedCount}, modified ${r.modifiedCount}, deleted ${r.deletedCount}, upserted ${r.upsertedCount}.`);
        }
        case "createIndex":
          return this.messageResult(start, `Created index ${await coll.createIndex(args[0], args[1])}.`);
        case "dropIndex":
          await coll.dropIndex(args[0]);
          return this.messageResult(start, `Dropped index ${typeof args[0] === "string" ? args[0] : JSON.stringify(args[0])}.`);
        case "dropIndexes":
          await coll.dropIndexes();
          return this.messageResult(start, "Dropped all non-_id indexes.");
        case "drop":
          await coll.drop();
          return this.messageResult(start, `Dropped collection ${command.collection}.`);
        case "renameCollection":
          if (typeof args[0] !== "string") throw new DbError("renameCollection() expects the new name.");
          await coll.rename(args[0]);
          return this.messageResult(start, `Renamed ${command.collection} to ${args[0]}.`);
      }
      throw new DbError(`${command.method}() is not supported here.`);
    } finally {
      if (check.write) this.invalidate();
    }
  }
}
