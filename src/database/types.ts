/**
 * Shared contract of the Database Client: every adapter (PostgreSQL,
 * CockroachDB, MySQL, MariaDB, SQL Server, Oracle, SQLite, ClickHouse,
 * MongoDB, Redis, and the cloud services Redshift, DynamoDB, Cosmos DB,
 * Spanner, Firestore and BigQuery) speaks this shape, so the panel and the webview never
 * branch on driver details - only on `kind`, `family` and `features`.
 *
 * Everything that crosses into the webview is plain JSON: driver values are
 * encoded by `encodeValue` first, and connection strings never cross at all.
 */

export type DbKind =
  | "postgres" | "cockroachdb" | "mysql" | "mariadb" | "sqlserver" | "oracle" | "sqlite" | "clickhouse" | "mongodb" | "redis"
  | "redshift" | "dynamodb" | "cosmosdb" | "spanner" | "firestore" | "bigquery";

/** Decides which editor, filter and query console the UI shows. */
export type DbFamily = "sql" | "document" | "keyvalue";

/** What the client can do with a kind of database. Shown in the UI and the docs, and checked by tests. */
export interface KindFeatures {
  /** Rows, documents or keys can be inserted, edited and deleted from the grid. */
  editRows: boolean;
  /** Indexes are listed in the Structure view. */
  indexes: boolean;
  /** A running console query can be cancelled on the server. */
  cancel: boolean;
  /** Read-only connections are also enforced by the server session, not only by the statement check. */
  serverReadOnly: boolean;
}

export interface KindInfo {
  label: string;
  family: DbFamily;
  /** True when objects live in schemas inside a database. */
  schemas: boolean;
  example: string;
  defaultPort?: number;
  /** npm driver (or protocol) used to talk to the server. */
  driver: string;
  features: KindFeatures;
  /** Limits worth knowing before connecting. */
  notes?: string;
  /** Document kinds with a native filter language: the placeholder of the grid's filter box. */
  filterHint?: string;
  /** Set when the grid's free-text search is not available, with the reason. */
  noSearch?: string;
  /** Only reachable through a cloud provider; listed under that provider in the UI. */
  cloud?: "aws" | "azure" | "gcp";
}

const ALL: KindFeatures = { editRows: true, indexes: true, cancel: true, serverReadOnly: true };

export const DB_KINDS: Record<DbKind, KindInfo> = {
  postgres: { label: "PostgreSQL", family: "sql", schemas: true, defaultPort: 5432, driver: "pg", features: ALL, example: "postgresql://user:password@localhost:5432/app" },
  cockroachdb: {
    label: "CockroachDB", family: "sql", schemas: true, defaultPort: 26257, driver: "pg", features: ALL,
    example: "cockroachdb://root@localhost:26257/defaultdb?sslmode=disable",
    notes: "Tables without a primary key are edited through CockroachDB's hidden rowid."
  },
  mysql: { label: "MySQL", family: "sql", schemas: false, defaultPort: 3306, driver: "mysql2", features: ALL, example: "mysql://user:password@localhost:3306/app" },
  mariadb: { label: "MariaDB", family: "sql", schemas: false, defaultPort: 3306, driver: "mysql2", features: ALL, example: "mariadb://user:password@localhost:3306/app" },
  sqlserver: {
    label: "SQL Server", family: "sql", schemas: true, defaultPort: 1433, driver: "mssql (tedious)", features: { ...ALL, serverReadOnly: false },
    example: "Server=localhost,1433;Database=app;User Id=sa;Password=secret;Encrypt=false",
    notes: "SQL Server logins only; Windows authentication is not supported."
  },
  oracle: {
    label: "Oracle", family: "sql", schemas: true, defaultPort: 1521, driver: "oracledb (thin mode)", features: ALL,
    example: "oracle://user:password@localhost:1521/FREEPDB1",
    notes: "Oracle Database 12.1 or later. No Oracle Client install is needed."
  },
  sqlite: {
    label: "SQLite", family: "sql", schemas: false, driver: "node:sqlite (worker thread) or sql.js", features: ALL,
    example: "sqlite:///Users/me/project/dev.db",
    notes: "Queries run on a worker thread, so a long one never freezes VS Code and can be cancelled. On VS Code builds without node:sqlite, sql.js opens files up to 512 MB and cannot cancel."
  },
  clickhouse: {
    label: "ClickHouse", family: "sql", schemas: false, defaultPort: 8123, driver: "HTTP interface", features: { ...ALL, editRows: false },
    example: "clickhouse://default:password@localhost:8123/default",
    notes: "Rows can be inserted, but not edited or deleted from the grid: ClickHouse rows have no unique key. Use ALTER TABLE ... UPDATE/DELETE in a query tab."
  },
  mongodb: { label: "MongoDB", family: "document", schemas: false, defaultPort: 27017, driver: "mongodb", features: { ...ALL, serverReadOnly: false }, example: "mongodb://user:password@localhost:27017/app" },
  redis: {
    label: "Redis", family: "keyvalue", schemas: false, defaultPort: 6379, driver: "ioredis", features: { editRows: true, indexes: false, cancel: false, serverReadOnly: false },
    example: "redis://:password@localhost:6379/0",
    notes: "Valkey and other Redis-compatible servers work too."
  },
  redshift: {
    label: "Amazon Redshift", family: "sql", schemas: true, defaultPort: 5439, driver: "pg", cloud: "aws", features: { ...ALL, indexes: false, serverReadOnly: false },
    example: "redshift://awsuser:password@examplecluster.abc123xyz789.us-west-2.redshift.amazonaws.com:5439/dev",
    notes: "Redshift tables have no enforced primary keys: rows of tables without a declared key are read-only here."
  },
  dynamodb: {
    label: "Amazon DynamoDB", family: "document", schemas: false, driver: "HTTPS API (SigV4)", cloud: "aws", features: { editRows: true, indexes: true, cancel: false, serverReadOnly: false },
    example: "dynamodb://AKIAIOSFODNN7EXAMPLE:secret@us-east-1",
    filterHint: "PartiQL WHERE: status = 'active' AND age > 21",
    noSearch: "DynamoDB has no text search. Use Filter, or a PartiQL condition.",
    notes: "Browsing scans the table page by page; each page costs read capacity. Sorting is not available on scans."
  },
  cosmosdb: {
    label: "Azure Cosmos DB", family: "document", schemas: false, driver: "HTTPS API (NoSQL)", cloud: "azure", features: { editRows: true, indexes: true, cancel: false, serverReadOnly: false },
    example: "AccountEndpoint=https://myaccount.documents.azure.com:443/;AccountKey=secret;",
    filterHint: "WHERE: c.status = 'active' AND c.age > 21",
    notes: "NoSQL API. For the MongoDB API, connect with the account's mongodb:// connection string instead."
  },
  spanner: {
    label: "Cloud Spanner", family: "sql", schemas: false, driver: "REST API", cloud: "gcp", features: { editRows: true, indexes: true, cancel: false, serverReadOnly: false },
    example: "spanner://my-project/my-instance/my-database",
    notes: "GoogleSQL databases. Schema changes (CREATE, ALTER, DROP) run as DDL operations and can take a while."
  },
  firestore: {
    label: "Firestore", family: "document", schemas: false, driver: "REST API", cloud: "gcp", features: { editRows: true, indexes: false, cancel: false, serverReadOnly: false },
    example: "firestore://my-project",
    noSearch: "Firestore has no text search. Use Filter: equals, starts with, or a comparison.",
    notes: "Native-mode databases. Root collections are listed; open subcollections with a query (collection path)."
  },
  bigquery: {
    label: "BigQuery", family: "sql", schemas: true, driver: "REST API", cloud: "gcp", features: { editRows: false, indexes: false, cancel: true, serverReadOnly: false },
    example: "bigquery://my-project?location=US",
    notes: "Browsing an unfiltered table is free. Filters, sorting and queries run as query jobs, billed by bytes scanned."
  }
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

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  /** Index method or kind, e.g. btree, hash, CLUSTERED, text, minmax. */
  type?: string;
  /** Partial index condition, or other detail worth showing. */
  detail?: string;
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
  /** The total comes from table statistics (a large table), not COUNT(*). */
  totalEstimated?: boolean;
  /** The total is an estimate or was not counted; countRows gives the exact number. */
  countable?: boolean;
  /** True when the count stopped at a cap (Redis SCAN). */
  totalCapped?: boolean;
  keyColumns: string[];
  keyStrategy: KeyStrategy;
  /** Set when rows cannot be changed here, with the reason. */
  readOnly?: string;
  /** False when nothing can be inserted (views). Rows of tables without a key can still be inserted. */
  canInsert?: boolean;
  /** Cursor-paged stores (DynamoDB) cannot count: whether another page exists. */
  hasMore?: boolean;
  /** Shown under the grid, e.g. the bytes a BigQuery page scanned. */
  note?: string;
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
  /** Shown next to the result, e.g. the bytes a BigQuery job scanned. */
  note?: string;
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

/**
 * Lets the service cancel a console query. Adapters register what stops the
 * query on the server (a cancel request, a KILL, closing the cursor).
 */
export class RunControl {
  private hooks: Array<() => unknown> = [];
  cancelled = false;

  onCancel(hook: () => unknown): void {
    if (this.cancelled) void Promise.resolve().then(hook).catch(() => undefined);
    else this.hooks.push(hook);
  }

  /** Settles with `run`, or rejects as soon as the run is cancelled (the server-side stop may finish later). */
  race<T>(run: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.cancelled) { run.catch(() => undefined); reject(cancelledError()); return; }
      this.hooks.push(() => reject(cancelledError()));
      run.then(resolve, reject);
    });
  }

  async cancel(): Promise<void> {
    if (this.cancelled) return;
    this.cancelled = true;
    const hooks = this.hooks;
    this.hooks = [];
    await Promise.allSettled(hooks.map(hook => Promise.resolve().then(hook)));
  }
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
  runQuery(text: string, context: { database?: string; schema?: string }, control?: RunControl): Promise<QueryResult>;
  /** Drops (or for Redis, flushes) the object. */
  drop(target: DbTarget): Promise<void>;
  /** Deletes every row but keeps the object. */
  truncate(target: DbTarget): Promise<void>;
  /** Splits console input into statements and flags writes and destructive ones. Throws on input it cannot run. */
  classify(text: string): StatementCheck[];
  /** Forgets cached table metadata (after a refresh or a schema change). */
  invalidate(): void;
  /** Indexes of a table or collection, for the Structure view. */
  indexes?(target: DbTarget): Promise<IndexInfo[]>;
  /** An exact count for a page request whose total was estimated. */
  countRows?(request: PageRequest): Promise<number>;
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
  /** Cloud service this connection belongs to (an id from CLOUD_SERVICES), when it is a cloud database. */
  cloud?: string;
  /** True when a credentials file (a GCP service-account key) is stored in SecretStorage next to the connection string. */
  hasCredentials?: boolean;
  createdAt: number;
  lastConnectedAt?: number;
}

function cancelledError(): DbError {
  return new DbError("The query was cancelled.", "Statements that finished before the cancel are not rolled back.", "CANCELLED");
}

/** A user-facing error: message and hint are already free of credentials. */
export class DbError extends Error {
  /** 0-based offset of the error in the query text that was run, when the server reports one. */
  position?: number;

  constructor(message: string, readonly hint?: string, readonly code?: string) {
    super(message);
  }

  at(position: number | undefined): this {
    if (typeof position === "number" && Number.isFinite(position) && position >= 0) this.position = Math.floor(position);
    return this;
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
