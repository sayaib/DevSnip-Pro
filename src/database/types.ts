/**
 * Shared contract of the Database Client: every adapter (Postgres, MySQL,
 * SQL Server, SQLite, MongoDB, Redis) speaks this shape, so the panel and the
 * webview never branch on driver details - only on `kind` and `family`.
 *
 * Everything that crosses into the webview is plain JSON: driver values are
 * encoded by `encodeValue` first, and connection strings never cross at all.
 */

export type DbKind = "postgres" | "mysql" | "sqlserver" | "sqlite" | "mongodb" | "redis";

/** Decides which editor, filter and query console the UI shows. */
export type DbFamily = "sql" | "document" | "keyvalue";

export const DB_KINDS: Record<DbKind, { label: string; family: DbFamily; schemas: boolean; example: string }> = {
  postgres: { label: "PostgreSQL", family: "sql", schemas: true, example: "postgresql://user:password@localhost:5432/app" },
  mysql: { label: "MySQL / MariaDB", family: "sql", schemas: false, example: "mysql://user:password@localhost:3306/app" },
  sqlserver: { label: "SQL Server", family: "sql", schemas: true, example: "Server=localhost,1433;Database=app;User Id=sa;Password=secret;Encrypt=false" },
  sqlite: { label: "SQLite", family: "sql", schemas: false, example: "sqlite:///Users/me/project/dev.db" },
  mongodb: { label: "MongoDB", family: "document", schemas: false, example: "mongodb://user:password@localhost:27017/app" },
  redis: { label: "Redis", family: "keyvalue", schemas: false, example: "redis://:password@localhost:6379/0" }
};

/** Coarse type of a column, used to coerce edited text and to pick an input. */
export type ValueCategory = "number" | "boolean" | "json" | "date" | "text" | "binary" | "other";

export interface ColumnInfo {
  name: string;
  /** Database type as reported by the server, e.g. "character varying(255)". */
  dataType: string;
  category: ValueCategory;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  /** Raw default expression, if any (shown, never evaluated). */
  defaultValue?: string | null;
  /** False for generated, computed and binary columns. */
  editable: boolean;
  /** MongoDB only: share of sampled documents that have this field. */
  presence?: number;
  /** False when the grid cannot sort by this column (defaults to true). */
  sortable?: boolean;
}

export interface ObjectInfo {
  name: string;
  type: "table" | "view" | "collection" | "keys";
  /** Server estimate, not an exact count. */
  rows?: number;
}

/** What a data tab is looking at. `object` is a table, view, collection or (Redis) the keyspace. */
export interface DbTarget {
  database?: string;
  schema?: string;
  object: string;
}

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "starts" | "ends" | "null" | "notnull" | "in";

export const FILTER_OPS: FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts", "ends", "null", "notnull", "in"];

export interface FilterRule {
  column: string;
  op: FilterOp;
  value?: string;
}

export interface PageRequest {
  target: DbTarget;
  /** 1-based. */
  page: number;
  pageSize: number;
  sort?: { column: string; dir: "asc" | "desc" };
  filters?: FilterRule[];
  /** Free-text search across text-like columns (SQL), string fields (MongoDB) or key names (Redis). */
  search?: string;
  /** MongoDB: a JSON filter document. Redis: a SCAN MATCH pattern. */
  query?: string;
  /** Redis: only keys of this type. */
  keyType?: string;
}

/** How rows of this result are identified for update and delete. */
export type KeyStrategy = "primary" | "rowid" | "ctid" | "all" | "_id" | "key" | "none";

export type Row = Record<string, unknown>;

export interface PageResult {
  columns: ColumnInfo[];
  rows: Row[];
  /** Null when counting was skipped or failed. */
  total: number | null;
  /** True when the count stopped at a cap (Redis SCAN). */
  totalCapped?: boolean;
  keyColumns: string[];
  keyStrategy: KeyStrategy;
  /** Set when rows cannot be changed here, with the reason. */
  readOnly?: string;
  elapsedMs: number;
}

/** A value the user typed into the row editor. */
export interface CellInput {
  /** "default" leaves the column out of an INSERT so the database fills it. */
  mode: "value" | "null" | "default";
  value?: string;
}

export interface QueryResult {
  columns: string[];
  rows: Row[];
  /** Rows changed by a write, when the driver reports it. */
  affected?: number;
  /** Plain-text result (Redis replies, MongoDB acknowledgements). */
  message?: string;
  truncated?: boolean;
  elapsedMs: number;
}

export interface ServerInfo {
  version: string;
  /** The database the connection string selected, when it named one. */
  defaultDatabase?: string;
}

/** What the query console is about to run, checked before it runs. */
export interface StatementCheck {
  verb: string;
  write: boolean;
  /** Why the statement needs confirmation, if it destroys data. */
  danger?: string;
}

/** Redis: one key read in full for the editor. */
export interface KeyValue {
  key: string;
  type: string;
  /** Milliseconds, -1 when the key never expires. */
  ttlMs: number;
  value: unknown;
  truncated?: boolean;
}

/** The driver side of one saved connection. */
export interface DbAdapter {
  readonly kind: DbKind;
  connect(): Promise<ServerInfo>;
  close(): Promise<void>;
  /** A cheap round trip, used for the status indicator and reconnects. */
  ping(): Promise<void>;
  listDatabases(): Promise<string[]>;
  /** Empty for databases without schemas. */
  listSchemas(database: string): Promise<string[]>;
  listObjects(database: string, schema?: string): Promise<ObjectInfo[]>;
  describe(target: DbTarget): Promise<ColumnInfo[]>;
  fetchPage(request: PageRequest): Promise<PageResult>;
  insert(target: DbTarget, values: Record<string, CellInput>): Promise<number>;
  update(target: DbTarget, key: Row, strategy: KeyStrategy, values: Record<string, CellInput>): Promise<number>;
  remove(target: DbTarget, keys: Row[], strategy: KeyStrategy): Promise<number>;
  runQuery(text: string, context: { database?: string; schema?: string }): Promise<QueryResult>;
  /** Drops (or for Redis, flushes) the object. */
  drop(target: DbTarget): Promise<void>;
  /** Deletes every row but keeps the object. */
  truncate(target: DbTarget): Promise<void>;
  /** Splits console input into statements and flags writes and destructive ones. Throws on input it cannot run. */
  classify(text: string): StatementCheck[];
  /** Forgets cached table metadata (after a refresh or a schema change). */
  invalidate(): void;
  /** MongoDB only. */
  createCollection?(database: string, name: string): Promise<void>;
  /** Redis only. */
  readKey?(database: string, key: string): Promise<KeyValue>;
  /** Redis only: key counts per database, from one INFO call. */
  databaseSizes?(): Promise<Record<string, number>>;
}

/** Saved connection as stored in globalState. The connection string lives in SecretStorage. */
export interface ConnectionProfile {
  id: string;
  name: string;
  kind: DbKind;
  /** Connection string with the password masked; safe to show. */
  display: string;
  readOnly: boolean;
  color?: string;
  createdAt: number;
  lastConnectedAt?: number;
}

/** A user-facing error: message and hint are already free of credentials. */
export class DbError extends Error {
  constructor(message: string, readonly hint?: string, readonly code?: string) {
    super(message);
  }
}

/** Limits that keep a panel responsive on large databases. */
export const LIMITS = {
  connectTimeoutMs: 10_000,
  queryTimeoutMs: 30_000,
  maxPageSize: 500,
  maxQueryRows: 1000,
  maxScanKeys: 10_000,
  mongoSample: 200,
  maxCellChars: 20_000
};
