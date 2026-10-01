"use strict";
/**
 * Shared contract of the Database Client: every adapter (Postgres, MySQL,
 * SQL Server, SQLite, MongoDB, Redis) speaks this shape, so the panel and the
 * webview never branch on driver details - only on `kind` and `family`.
 *
 * Everything that crosses into the webview is plain JSON: driver values are
 * encoded by `encodeValue` first, and connection strings never cross at all.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITS = exports.DbError = exports.FILTER_OPS = exports.DB_KINDS = void 0;
exports.DB_KINDS = {
    postgres: { label: "PostgreSQL", family: "sql", schemas: true, example: "postgresql://user:password@localhost:5432/app" },
    mysql: { label: "MySQL / MariaDB", family: "sql", schemas: false, example: "mysql://user:password@localhost:3306/app" },
    sqlserver: { label: "SQL Server", family: "sql", schemas: true, example: "Server=localhost,1433;Database=app;User Id=sa;Password=secret;Encrypt=false" },
    sqlite: { label: "SQLite", family: "sql", schemas: false, example: "sqlite:///Users/me/project/dev.db" },
    mongodb: { label: "MongoDB", family: "document", schemas: false, example: "mongodb://user:password@localhost:27017/app" },
    redis: { label: "Redis", family: "keyvalue", schemas: false, example: "redis://:password@localhost:6379/0" }
};
exports.FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts", "ends", "null", "notnull", "in"];
/** A user-facing error: message and hint are already free of credentials. */
class DbError extends Error {
    constructor(message, hint, code) {
        super(message);
        this.hint = hint;
        this.code = code;
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