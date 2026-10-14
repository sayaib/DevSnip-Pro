"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdapter = void 0;
const clickhouse_1 = require("./clickhouse");
const mongodb_1 = require("./mongodb");
const mysql_1 = require("./mysql");
const oracle_1 = require("./oracle");
const postgres_1 = require("./postgres");
const redis_1 = require("./redis");
const sqlite_1 = require("./sqlite");
const sqlserver_1 = require("./sqlserver");
/** One adapter per connection; drivers load lazily on first connect. */
function createAdapter(spec, options) {
    switch (spec.kind) {
        case "postgres":
        case "cockroachdb": return new postgres_1.PostgresAdapter(spec, options.readOnly);
        case "mysql":
        case "mariadb": return new mysql_1.MysqlAdapter(spec, options.readOnly);
        case "sqlserver": return new sqlserver_1.SqlServerAdapter(spec);
        case "oracle": return new oracle_1.OracleAdapter(spec, options.readOnly);
        case "sqlite": return new sqlite_1.SqliteAdapter(spec, options.readOnly);
        case "clickhouse": return new clickhouse_1.ClickHouseAdapter(spec, options.readOnly);
        case "mongodb": return new mongodb_1.MongoAdapter(spec);
        case "redis": return new redis_1.RedisAdapter(spec);
    }
}
exports.createAdapter = createAdapter;
//# sourceMappingURL=index.js.map