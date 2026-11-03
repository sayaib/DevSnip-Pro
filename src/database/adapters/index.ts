import { ConnectionSpec } from "../connection-string";
import { DbAdapter } from "../types";
import { BigQueryAdapter } from "./bigquery";
import { ClickHouseAdapter } from "./clickhouse";
import { CosmosAdapter } from "./cosmosdb";
import { DynamoAdapter } from "./dynamodb";
import { FirestoreAdapter } from "./firestore";
import { MongoAdapter } from "./mongodb";
import { MysqlAdapter } from "./mysql";
import { OracleAdapter } from "./oracle";
import { PostgresAdapter } from "./postgres";
import { RedisAdapter } from "./redis";
import { SpannerAdapter } from "./spanner";
import { SqliteAdapter } from "./sqlite";
import { SqlServerAdapter } from "./sqlserver";

/** One adapter per connection; drivers load lazily on first connect, and the cloud APIs need none. */
export function createAdapter(spec: ConnectionSpec, options: { readOnly: boolean }): DbAdapter {
  switch (spec.kind) {
    case "postgres":
    case "cockroachdb":
    case "redshift": return new PostgresAdapter(spec, options.readOnly);
    case "mysql":
    case "mariadb": return new MysqlAdapter(spec, options.readOnly);
    case "sqlserver": return new SqlServerAdapter(spec);
    case "oracle": return new OracleAdapter(spec, options.readOnly);
    case "sqlite": return new SqliteAdapter(spec, options.readOnly);
    case "clickhouse": return new ClickHouseAdapter(spec, options.readOnly);
    case "mongodb": return new MongoAdapter(spec);
    case "redis": return new RedisAdapter(spec);
    case "dynamodb": return new DynamoAdapter(spec);
    case "cosmosdb": return new CosmosAdapter(spec);
    case "spanner": return new SpannerAdapter(spec);
    case "firestore": return new FirestoreAdapter(spec);
    case "bigquery": return new BigQueryAdapter(spec);
  }
}
