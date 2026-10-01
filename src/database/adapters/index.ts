import { ConnectionSpec } from "../connection-string";
import { DbAdapter } from "../types";
import { MongoAdapter } from "./mongodb";
import { MysqlAdapter } from "./mysql";
import { PostgresAdapter } from "./postgres";
import { RedisAdapter } from "./redis";
import { SqliteAdapter } from "./sqlite";
import { SqlServerAdapter } from "./sqlserver";

/** One adapter per connection; drivers load lazily on first connect. */
export function createAdapter(spec: ConnectionSpec, options: { readOnly: boolean }): DbAdapter {
  switch (spec.kind) {
    case "postgres": return new PostgresAdapter(spec, options.readOnly);
    case "mysql": return new MysqlAdapter(spec, options.readOnly);
    case "sqlserver": return new SqlServerAdapter(spec);
    case "sqlite": return new SqliteAdapter(spec, options.readOnly);
    case "mongodb": return new MongoAdapter(spec);
    case "redis": return new RedisAdapter(spec);
  }
}
