"use strict";
/**
 * Shared contract of the Database Client: every adapter (PostgreSQL,
 * CockroachDB, MySQL, MariaDB, SQL Server, Oracle, SQLite, ClickHouse,
 * MongoDB, Redis) speaks this shape, so the panel and the webview never
 * branch on driver details - only on `kind`, `family` and `features`.
 *
 * Everything that crosses into the webview is plain JSON: driver values are
 * encoded by `encodeValue` first, and connection strings never cross at all.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITS = exports.DbError = exports.RunControl = exports.FILTER_OPS = exports.DB_KINDS = void 0;
const ALL = { editRows: true, indexes: true, cancel: true, serverReadOnly: true };
exports.DB_KINDS = {
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
        label: "SQLite", family: "sql", schemas: false, driver: "node:sqlite or sql.js", features: { ...ALL, cancel: false },
        example: "sqlite:///Users/me/project/dev.db",
        notes: "Queries run inside VS Code, so a running query cannot be cancelled."
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
    }
};
exports.FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts", "ends", "null", "notnull", "in"];
/**
 * Lets the service cancel a console query. Adapters register what stops the
 * query on the server (a cancel request, a KILL, closing the cursor).
 */
class RunControl {
    constructor() {
        this.hooks = [];
        this.cancelled = false;
    }
    onCancel(hook) {
        if (this.cancelled)
            void Promise.resolve().then(hook).catch(() => undefined);
        else
            this.hooks.push(hook);
    }
    /** Settles with `run`, or rejects as soon as the run is cancelled (the server-side stop may finish later). */
    race(run) {
        return new Promise((resolve, reject) => {
            if (this.cancelled) {
                run.catch(() => undefined);
                reject(cancelledError());
                return;
            }
            this.hooks.push(() => reject(cancelledError()));
            run.then(resolve, reject);
        });
    }
    async cancel() {
        if (this.cancelled)
            return;
        this.cancelled = true;
        const hooks = this.hooks;
        this.hooks = [];
        await Promise.allSettled(hooks.map(hook => Promise.resolve().then(hook)));
    }
}
exports.RunControl = RunControl;
function cancelledError() {
    return new DbError("The query was cancelled.", "Statements that finished before the cancel are not rolled back.", "CANCELLED");
}
/** A user-facing error: message and hint are already free of credentials. */
class DbError extends Error {
    constructor(message, hint, code) {
        super(message);
        this.hint = hint;
        this.code = code;
    }
    at(position) {
        if (typeof position === "number" && Number.isFinite(position) && position >= 0)
            this.position = Math.floor(position);
        return this;
    }
}
exports.DbError = DbError;
/** Limits that keep a panel responsive on large databases. */
exports.LIMITS = {
    connectTimeoutMs: 10000,
    queryTimeoutMs: 30000,
    maxPageSize: 500,
    maxQueryRows: 1000,
    maxScanKeys: 10000,
    mongoSample: 200,
    maxCellChars: 20000
};
//# sourceMappingURL=types.js.map