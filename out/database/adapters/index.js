"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdapter = void 0;
const mongodb_1 = require("./mongodb");
const mysql_1 = require("./mysql");
const postgres_1 = require("./postgres");
const redis_1 = require("./redis");
const sqlite_1 = require("./sqlite");
const sqlserver_1 = require("./sqlserver");
/** One adapter per connection; drivers load lazily on first connect. */
function createAdapter(spec, options) {
    switch (spec.kind) {
        case "postgres": return new postgres_1.PostgresAdapter(spec, options.readOnly);
        case "mysql": return new mysql_1.MysqlAdapter(spec, options.readOnly);
        case "sqlserver": return new sqlserver_1.SqlServerAdapter(spec);
        case "sqlite": return new sqlite_1.SqliteAdapter(spec, options.readOnly);
        case "mongodb": return new mongodb_1.MongoAdapter(spec);
        case "redis": return new redis_1.RedisAdapter(spec);
    }
}
exports.createAdapter = createAdapter;
//# sourceMappingURL=index.js.map