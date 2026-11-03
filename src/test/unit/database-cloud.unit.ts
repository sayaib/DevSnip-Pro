/**
 * Database Client: cloud databases. Connection-string parsing and validation
 * for every cloud form, the provider catalog, secret masking, credentials in
 * SecretStorage, request signing, value marshalling, and each API adapter
 * (DynamoDB, Cosmos DB, Spanner, Firestore, BigQuery) against a local mock
 * of its REST API. No cloud account is needed.
 */
import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { createHmac } from "crypto";
import { CLOUD_SERVICES, cloudWarnings, inferCloudService, AUTH_LABELS } from "../../database/cloud";
import { connectionWarnings, credentialSecrets, detectKind, hasMaskedPassword, maskConnectionString, parseConnection, PASSWORD_MASK, redact, restoreMaskedPassword, secretsOf } from "../../database/connection-string";
import { parseIni, rdsAuthToken, resolveAwsCredentials, signRequest } from "../../database/cloud-auth/aws";
import { cosmosAuthorization } from "../../database/cloud-auth/azure";
import { inspectCredentials } from "../../database/cloud-auth/gcp";
import { applyTokenAuth } from "../../database/cloud-auth/tokens";
import { buildSelect, buildUpdate, categorize, googleSqlCast, quoteIdent } from "../../database/sql-builder";
import { DynamoAdapter, fromItem, toItem } from "../../database/adapters/dynamodb";
import { CosmosAdapter, partitionKeyHeader, PK_COLUMN } from "../../database/adapters/cosmosdb";
import { FirestoreAdapter, fromFields, parseFirestoreQuery, toValue } from "../../database/adapters/firestore";
import { SpannerAdapter } from "../../database/adapters/spanner";
import { BigQueryAdapter, decodeBigQuery } from "../../database/adapters/bigquery";
import { createAdapter } from "../../database/adapters";
import { ConnectionStore } from "../../database/store";
import { DatabaseService, HostUi } from "../../database/service";
import { ColumnInfo, DB_KINDS, DbError } from "../../database/types";
import { suite, test } from "./run-unit-tests";

const SA_KEY = JSON.stringify({
  type: "service_account",
  project_id: "acme-prod-123",
  private_key_id: "abc123def456abc123def456",
  client_email: "reader@acme-prod-123.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n-----END PRIVATE KEY-----\n"
});

function throwsDb(fn: () => unknown, pattern: RegExp): void {
  assert.throws(fn, (error: unknown) => error instanceof DbError && pattern.test(`${error.message} ${error.hint ?? ""}`));
}

async function rejectsDb(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DbError, `expected a DbError, got ${error}`);
    assert.match(`${error.message} ${error.hint ?? ""}`, pattern);
    return;
  }
  assert.fail("expected a rejection");
}

class MemoryState {
  data = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.data.has(key) ? this.data.get(key) : fallback) as T; }
  update(key: string, value: unknown): Thenable<void> { this.data.set(key, JSON.parse(JSON.stringify(value))); return Promise.resolve(); }
}
class MemorySecrets {
  data = new Map<string, string>();
  get(key: string): Thenable<string | undefined> { return Promise.resolve(this.data.get(key)); }
  store(key: string, value: string): Thenable<void> { this.data.set(key, value); return Promise.resolve(); }
  delete(key: string): Thenable<void> { this.data.delete(key); return Promise.resolve(); }
}

const ui: HostUi = {
  confirm: async () => true,
  confirmByTyping: async () => true,
  pickSqliteFile: async () => undefined,
  copy: async () => undefined,
  openDocument: async () => undefined,
  baseDir: () => undefined
};

interface Seen { method: string; path: string; headers: http.IncomingHttpHeaders; body: any }

/** A local stand-in for a cloud REST API: `route` answers each request; every request is recorded. */
async function mockApi(route: (req: Seen) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let text = "";
    req.on("data", c => (text += c));
    req.on("end", () => {
      let body: any = text;
      try { body = text ? JSON.parse(text) : undefined; } catch { /* form bodies stay text */ }
      const entry = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body };
      seen.push(entry);
      const answer = route(entry) ?? { status: 404, body: { error: { message: `no route for ${req.method} ${req.url}` } } };
      res.writeHead(answer.status ?? 200, { "content-type": "application/json", ...answer.headers });
      res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise(resolve => server.close(() => resolve())) };
}

suite("database cloud: connection strings", () => {
  test("recognises every cloud form, including pasted portal and JDBC strings", () => {
    assert.strictEqual(detectKind("redshift://u:p@c.abc.us-west-2.redshift.amazonaws.com:5439/dev"), "redshift");
    assert.strictEqual(detectKind("dynamodb://us-east-1"), "dynamodb");
    assert.strictEqual(detectKind("AccountEndpoint=https://acct.documents.azure.com:443/;AccountKey=a2V5;"), "cosmosdb");
    assert.strictEqual(detectKind("spanner://p/i/d"), "spanner");
    assert.strictEqual(detectKind("jdbc:cloudspanner:/projects/my-proj/instances/i/databases/d"), "spanner");
    assert.strictEqual(detectKind("firestore://my-proj"), "firestore");
    assert.strictEqual(detectKind("bigquery://my-proj"), "bigquery");
    // A postgresql:// URL that points at Redshift gets Redshift's catalog queries.
    assert.strictEqual(parseConnection("postgresql://u:p@wg.123456789012.us-east-1.redshift-serverless.amazonaws.com:5439/dev").kind, "redshift");
    assert.strictEqual(parseConnection("postgresql://u:p@db.example.com/app").kind, "postgres");
  });

  test("parses Redshift with TLS on and dev as the default database", () => {
    const spec = parseConnection("jdbc:redshift://awsuser:pw@ex.abc.us-west-2.redshift.amazonaws.com:5439");
    assert.strictEqual(spec.kind, "redshift");
    assert.strictEqual(spec.ssl, true);
    assert.strictEqual(spec.database, "dev");
    assert.strictEqual(spec.port, 5439);
    assert.strictEqual(parseConnection("redshift://u:p@ex.abc.us-west-2.redshift.amazonaws.com/dev?sslmode=disable").ssl, false);
    assert.strictEqual(parseConnection("redshift://u:p@host/dev").port, 5439);
    throwsDb(() => parseConnection("jdbc:redshift:iam://cluster:us-west-2/dev"), /IAM JDBC URLs are not supported/);
  });

  test("parses DynamoDB regions, endpoints and auth, and validates them", () => {
    const keys = parseConnection("dynamodb://AKIAIOSFODNN7EXAMPLE:wJalr%2FK7MDENG%2BbPx@eu-west-2");
    assert.deepStrictEqual([keys.region, keys.user, keys.password, keys.options.auth, keys.endpoint, keys.ssl], ["eu-west-2", "AKIAIOSFODNN7EXAMPLE", "wJalr/K7MDENG+bPx", "access-key", undefined, true]);
    const named = parseConnection("dynamodb://AKIAIOSFODNN7EXAMPLE:s@dynamodb.ap-southeast-2.amazonaws.com");
    assert.strictEqual(named.region, "ap-southeast-2");
    assert.strictEqual(named.endpoint, "https://dynamodb.ap-southeast-2.amazonaws.com");
    const local = parseConnection("dynamodb://localhost:8000");
    assert.deepStrictEqual([local.endpoint, local.region, local.options.auth, local.ssl], ["http://localhost:8000", "us-east-1", "emulator", false]);
    assert.deepStrictEqual(connectionWarnings(local), [], "a local endpoint needs no TLS");
    assert.match(connectionWarnings(parseConnection("dynamodb://us-east-1?endpoint=http://ddb.internal.example:8000")).join(" "), /plain http/);
    const profile = parseConnection("dynamodb://us-east-1?profile=dev");
    assert.strictEqual(profile.options.auth, "profile");
    assert.strictEqual(parseConnection("dynamodb://us-east-1").options.auth, "env");
    throwsDb(() => parseConnection("dynamodb://moon-base-9"), /not an AWS region/);
    throwsDb(() => parseConnection("dynamodb://AKIAIOSFODNN7EXAMPLE@us-east-1"), /secret access key/);
    throwsDb(() => parseConnection("dynamodb://us-east-1?auth=magic"), /Unknown DynamoDB auth/);
    throwsDb(() => parseConnection("dynamodb://us-east-1?endpoint=ftp://x"), /http:\/\/ or https:\/\//);
  });

  test("parses Cosmos DB portal strings and rejects incomplete ones", () => {
    const spec = parseConnection("AccountEndpoint=https://acct.documents.azure.com:443/;AccountKey=c2VjcmV0a2V5MTIz==;Database=app;");
    assert.deepStrictEqual([spec.kind, spec.host, spec.port, spec.endpoint, spec.database, spec.password, spec.ssl], ["cosmosdb", "acct.documents.azure.com", 443, "https://acct.documents.azure.com", "app", "c2VjcmV0a2V5MTIz==", true]);
    const short = parseConnection("cosmosdb://:c2VjcmV0@acct.documents.azure.com/app");
    assert.strictEqual(short.endpoint, "https://acct.documents.azure.com");
    assert.strictEqual(short.password, "c2VjcmV0");
    throwsDb(() => parseConnection("AccountEndpoint=https://acct.documents.azure.com:443/;"), /no AccountKey/);
    throwsDb(() => parseConnection("AccountKey=abc==;"), /no AccountEndpoint/);
    throwsDb(() => parseConnection("AccountEndpoint=https://acct.documents.azure.com/;AccountKey=not a key!;"), /not a valid key/);
  });

  test("parses Google Cloud forms: short, resource names, JDBC and emulators", () => {
    const sp = parseConnection("spanner://my-project/my-instance/orders");
    assert.deepStrictEqual([sp.project, sp.instance, sp.database, sp.options.auth, sp.endpoint], ["my-project", "my-instance", "orders", "adc", undefined]);
    const res = parseConnection("spanner://projects/my-project/instances/main/databases/db1");
    assert.deepStrictEqual([res.project, res.instance, res.database], ["my-project", "main", "db1"]);
    const jdbc = parseConnection("jdbc:cloudspanner:/projects/test-project/instances/test-instance/databases/db;autoConfigEmulator=true");
    assert.deepStrictEqual([jdbc.endpoint, jdbc.options.auth], ["http://localhost:9020", "emulator"]);
    const fs = parseConnection("firestore://my-project");
    assert.deepStrictEqual([fs.database, fs.options.auth], ["(default)", "adc"]);
    assert.strictEqual(parseConnection("firestore://demo?endpoint=localhost:8080").options.auth, "emulator");
    const bq = parseConnection("bigquery://my-project/analytics?location=EU&maxbytesbilled=1000000000");
    assert.deepStrictEqual([bq.project, bq.database, bq.options.dataset, bq.region, bq.options.maxbytesbilled], ["my-project", "my-project", "analytics", "EU", "1000000000"]);
    const simba = parseConnection("jdbc:bigquery://https://www.googleapis.com/bigquery/v2:443;ProjectId=my-project;DefaultDataset=sales;OAuthType=3");
    assert.deepStrictEqual([simba.project, simba.options.dataset], ["my-project", "sales"]);
    assert.strictEqual(parseConnection("bigquery://my-project?keyfile=/k.json").options.auth, "key-file");
  });

  test("validates Google Cloud IDs and auth with helpful messages", () => {
    throwsDb(() => parseConnection("spanner://my-project"), /instance ID/);
    throwsDb(() => parseConnection("spanner://My Project/i"), /not a valid project ID/);
    throwsDb(() => parseConnection("spanner://my-project/Bad_Inst"), /not a valid instance ID/);
    throwsDb(() => parseConnection("firestore://my-project/Bad_DB"), /Firestore database ID/);
    throwsDb(() => parseConnection("bigquery://my-project/bad-dataset"), /dataset ID/);
    throwsDb(() => parseConnection("bigquery://my-project?maxbytesbilled=1GB"), /whole number of bytes/);
    throwsDb(() => parseConnection("bigquery://my-project?auth=key-file"), /path of the service-account key file/);
    throwsDb(() => parseConnection("firestore://my-project?auth=emulator"), /emulator endpoint/);
    throwsDb(() => parseConnection("bigquery://"), /project ID/);
    // Emulators accept any project name.
    assert.strictEqual(parseConnection("spanner://Demo/inst?endpoint=http://localhost:9020").project, "Demo");
  });

  test("every kind's example parses and builds its adapter", () => {
    for (const kind of ["redshift", "dynamodb", "cosmosdb", "spanner", "firestore", "bigquery"] as const) {
      const spec = parseConnection(DB_KINDS[kind].example);
      assert.strictEqual(spec.kind, kind);
      assert.strictEqual(createAdapter(spec, { readOnly: false }).kind, kind);
      assert.ok(DB_KINDS[kind].cloud, `${kind} is listed under a provider`);
    }
  });
});

suite("database cloud: secrets", () => {
  test("masks account keys and session tokens like passwords, and restores them", () => {
    const cosmos = "AccountEndpoint=https://acct.documents.azure.com:443/;AccountKey=c2VjcmV0a2V5MTIz==;Database=app;";
    const masked = maskConnectionString(cosmos);
    assert.ok(!masked.includes("c2VjcmV0a2V5MTIz"), masked);
    assert.ok(masked.includes(`AccountKey=${PASSWORD_MASK}`));
    assert.ok(hasMaskedPassword(masked));
    assert.strictEqual(restoreMaskedPassword(masked.replace("app", "other"), cosmos), cosmos.replace("app", "other"));

    const dynamo = "dynamodb://AKIAIOSFODNN7EXAMPLE:SecretKey123@us-east-1?auth=access-key&sessiontoken=TokenValue%2B123";
    const m2 = maskConnectionString(dynamo);
    assert.ok(!m2.includes("SecretKey123") && !m2.includes("TokenValue"), m2);
    assert.strictEqual((m2.match(/\*{8}/g) ?? []).length, 2);
    assert.strictEqual(restoreMaskedPassword(m2, dynamo), dynamo);
    // A new token replaces only the token.
    assert.strictEqual(restoreMaskedPassword(m2.replace(`sessiontoken=${PASSWORD_MASK}`, "sessiontoken=New"), dynamo), dynamo.replace("TokenValue%2B123", "New"));
    const secrets = secretsOf(dynamo, parseConnection(dynamo));
    assert.ok(secrets.includes("SecretKey123") && secrets.includes("TokenValue+123"));
    assert.strictEqual(redact("token TokenValue+123 rejected", secrets), "token *** rejected");
  });

  test("checks pasted service account keys and redacts every secret part", () => {
    assert.deepStrictEqual(inspectCredentials(SA_KEY), { type: "service_account", clientEmail: "reader@acme-prod-123.iam.gserviceaccount.com", projectId: "acme-prod-123" });
    assert.strictEqual(inspectCredentials(JSON.stringify({ type: "authorized_user", client_id: "x", client_secret: "y", refresh_token: "z" })).type, "authorized_user");
    throwsDb(() => inspectCredentials("{not json"), /not valid JSON/);
    throwsDb(() => inspectCredentials(JSON.stringify({ type: "external_account" })), /not supported/);
    throwsDb(() => inspectCredentials(JSON.stringify({ type: "service_account", client_email: "a@b" })), /missing client_email or private_key/);
    const parts = credentialSecrets(SA_KEY);
    assert.ok(parts.some(p => p.includes("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj")));
    assert.ok(parts.includes("abc123def456abc123def456"));
    assert.ok(!redact(`bad key MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj here`, parts).includes("MIIEv"));
  });

  test("stores a service account key in its own secret, and only while it is used", async () => {
    const state = new MemoryState();
    const secrets = new MemorySecrets();
    const store = new ConnectionStore(state, secrets);
    await rejectsDb(store.save({ name: "sp", connectionString: "spanner://acme-prod-123/main?auth=service-account" }), /Paste the service account key/);
    await rejectsDb(store.save({ name: "sp", connectionString: "spanner://acme-prod-123/main?auth=service-account", credentials: "{}" }), /not supported|missing/);
    const profile = await store.save({ name: "sp", connectionString: "spanner://acme-prod-123/main?auth=service-account", credentials: SA_KEY });
    assert.strictEqual(profile.hasCredentials, true);
    assert.strictEqual(profile.cloud, "gcp-spanner");
    assert.strictEqual(await store.credentials(profile.id), SA_KEY);
    assert.ok(!JSON.stringify(state.data.get("devsnip.database.connections")).includes("PRIVATE KEY"), "the key never reaches globalState");
    // Editing without pasting again keeps the stored key.
    const again = await store.save({ id: profile.id, name: "sp2", connectionString: "spanner://acme-prod-123/main/db?auth=service-account" });
    assert.strictEqual(again.hasCredentials, true);
    assert.strictEqual(await store.credentials(profile.id), SA_KEY);
    // Switching to ADC drops the key from the keychain.
    const adc = await store.save({ id: profile.id, name: "sp2", connectionString: "spanner://acme-prod-123/main/db" });
    assert.strictEqual(adc.hasCredentials, undefined);
    assert.strictEqual(await store.credentials(profile.id), undefined);
    await store.remove(profile.id);
    assert.strictEqual(secrets.data.size, 0);
  });

  test("detect reports the cloud service and the key's account, never the key", async () => {
    const service = new DatabaseService(new ConnectionStore(new MemoryState(), new MemorySecrets()), ui, () => undefined);
    const res = await service.handle("detect", { connectionString: "spanner://other-project-1/main?auth=service-account", credentials: SA_KEY }) as any;
    assert.strictEqual(res.cloud.id, "gcp-spanner");
    assert.strictEqual(res.credentials.clientEmail, "reader@acme-prod-123.iam.gserviceaccount.com");
    assert.ok(res.warnings.some((w: string) => /belongs to project acme-prod-123/.test(w)));
    assert.ok(!JSON.stringify(res).includes("PRIVATE KEY"));
    const rds = await service.handle("detect", { connectionString: "postgresql://u:p@db.cluster-ro-abc123.us-east-1.rds.amazonaws.com/app?sslmode=require" }) as any;
    assert.strictEqual(rds.cloud.id, "aws-aurora");
    assert.ok(rds.warnings.some((w: string) => /reader endpoint/.test(w)));
    const init = await service.handle("init") as any;
    assert.strictEqual(init.cloud.services.length, CLOUD_SERVICES.length);
  });
});

suite("database cloud: providers", () => {
  test("recognises each provider's endpoints", () => {
    const cases: Array<[string, string, string | undefined]> = [
      ["postgres", "mydb.abc123xyz789.us-east-1.rds.amazonaws.com", "aws-rds"],
      ["postgres", "proxy1.proxy-abc123xyz789.us-east-1.rds.amazonaws.com", "aws-rds"],
      ["mysql", "app.cluster-abc123xyz789.eu-west-1.rds.amazonaws.com", "aws-aurora"],
      ["mysql", "app.cluster-ro-abc123xyz789.eu-west-1.rds.amazonaws.com", "aws-aurora"],
      ["redshift", "ex.abc.us-west-2.redshift.amazonaws.com", "aws-redshift"],
      ["sqlserver", "myserver.database.windows.net", "azure-sql"],
      ["postgres", "myserver.postgres.database.azure.com", "azure-postgres"],
      ["mysql", "myserver.mysql.database.azure.com", "azure-mysql"],
      ["mongodb", "acct.mongo.cosmos.azure.com", "azure-cosmos"],
      ["dynamodb", "", "aws-dynamodb"],
      ["bigquery", "", "gcp-bigquery"],
      ["postgres", "10.0.0.5", undefined],
      ["postgres", "localhost", undefined]
    ];
    for (const [kind, host, expected] of cases) assert.strictEqual(inferCloudService({ kind: kind as never, host }), expected, `${kind} ${host}`);
  });

  test("every service offers known engines and auth methods with sensible TLS defaults", () => {
    const ids = new Set<string>();
    for (const service of CLOUD_SERVICES) {
      assert.ok(!ids.has(service.id), service.id);
      ids.add(service.id);
      assert.ok(/^https:\/\//.test(service.docs), service.id);
      for (const engine of service.engines) {
        assert.ok(DB_KINDS[engine.kind], `${service.id} ${engine.kind}`);
        assert.ok(engine.auth.length && engine.auth.every(a => AUTH_LABELS[a]), `${service.id} ${engine.kind}`);
        // Public cloud endpoints default to encryption, except where the service itself needs an option first (RDS Oracle).
        if (!["dynamodb", "cosmosdb", "spanner", "firestore", "bigquery", "oracle"].includes(engine.kind)) assert.ok(engine.tls && engine.tls !== "false", `${service.id} ${engine.kind} TLS`);
      }
    }
    for (const provider of ["aws", "azure", "gcp"]) assert.ok(CLOUD_SERVICES.some(s => s.provider === provider));
  });

  test("warns about cloud-specific mistakes", () => {
    const warn = (service: string | undefined, raw: string) => cloudWarnings(service, parseConnection(raw)).join(" ");
    assert.match(warn("azure-sql", "Server=tcp:s.database.windows.net,1433;Database=db;User Id=u;Password=p;Encrypt=false"), /requires encryption/);
    assert.match(warn("aws-rds", "mongodb://u:p@h/db"), /does not offer this kind/);
    assert.match(warn("azure-postgres", "postgresql://u:p@db.example.org/app?sslmode=require"), /does not look like a Azure Database for PostgreSQL endpoint|does not look like/);
    assert.match(warn("aws-rds", "postgresql://u@mydb.abc.us-east-1.rds.amazonaws.com/app?auth=aws-iam"), /turn TLS on/);
    assert.match(warn("gcp-cloudsql", "postgresql://u:p@127.0.0.1/app?sslmode=require"), /Auth Proxy already encrypts/);
    assert.strictEqual(warn(undefined, "postgresql://u:p@mydb.abc.us-east-1.rds.amazonaws.com/app?sslmode=require"), "");
  });
});

suite("database cloud: request signing and tokens", () => {
  test("SigV4 matches AWS's published get-vanilla test vector", () => {
    const headers = signRequest({
      method: "GET", url: "https://example.amazonaws.com/", headers: {}, body: "", region: "us-east-1", service: "service",
      credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
      date: new Date(Date.UTC(2015, 7, 30, 12, 36, 0))
    });
    assert.strictEqual(headers.authorization, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
    assert.strictEqual(headers["x-amz-date"], "20150830T123600Z");
  });

  test("an RDS IAM token is a presigned connect URL without a scheme", () => {
    const token = rdsAuthToken({ host: "mydb.abc.us-east-1.rds.amazonaws.com", port: 5432, user: "app_user", region: "us-east-1", credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", sessionToken: "tok/en" }, date: new Date(Date.UTC(2024, 0, 2, 3, 4, 5)) });
    assert.match(token, /^mydb\.abc\.us-east-1\.rds\.amazonaws\.com:5432\/\?Action=connect&DBUser=app_user&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20240102%2Fus-east-1%2Frds-db%2Faws4_request&X-Amz-Date=20240102T030405Z&X-Amz-Expires=900&X-Amz-Security-Token=tok%2Fen&X-Amz-SignedHeaders=host&X-Amz-Signature=[0-9a-f]{64}$/);
  });

  test("reads AWS profiles and the environment", async () => {
    const ini = parseIni("[default]\naws_access_key_id = AKIA1\n# comment\n[profile dev]\nregion=eu-west-1\n");
    assert.deepStrictEqual(ini, { default: { aws_access_key_id: "AKIA1" }, "profile dev": { region: "eu-west-1" } });
    const env = { AWS_ACCESS_KEY_ID: "AKIAENV", AWS_SECRET_ACCESS_KEY: "envsecret", AWS_SESSION_TOKEN: "envtoken", AWS_SHARED_CREDENTIALS_FILE: "/nonexistent", AWS_CONFIG_FILE: "/nonexistent" };
    const fromEnv = await resolveAwsCredentials(parseConnection("dynamodb://us-east-1"), env);
    assert.deepStrictEqual(fromEnv, { accessKeyId: "AKIAENV", secretAccessKey: "envsecret", sessionToken: "envtoken" });
    await rejectsDb(resolveAwsCredentials(parseConnection("dynamodb://us-east-1?profile=nope"), { AWS_SHARED_CREDENTIALS_FILE: "/nonexistent", AWS_CONFIG_FILE: "/nonexistent" }), /profile "nope" was not found/);
  });

  test("token auth swaps the password for an RDS token, and testConnection redacts it", async () => {
    const saved = { ...process.env };
    process.env.AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "secretsecret";
    delete process.env.AWS_SESSION_TOKEN;
    try {
      const spec = parseConnection("postgresql://app_user@mydb.abc.eu-west-1.rds.amazonaws.com/app?sslmode=require&auth=aws-iam");
      const token = await applyTokenAuth(spec);
      assert.ok(token && spec.password === token);
      assert.match(token!, /^mydb\.abc\.eu-west-1\.rds\.amazonaws\.com:5432\/\?Action=connect&DBUser=app_user.*%2Feu-west-1%2Frds-db%2F/);
      await rejectsDb(applyTokenAuth(parseConnection("sqlserver://u:p@h:1433/db?auth=aws-iam")), /not available for this database/);
      // The token reaches the adapter but never an error message.
      let seen = "";
      const service = new DatabaseService(new ConnectionStore(new MemoryState(), new MemorySecrets()), ui, () => undefined, ((s: any) => ({
        kind: s.kind, connect: async () => { seen = s.password ?? ""; throw new Error(`password authentication failed for ${s.password}`); }, close: async () => undefined
      })) as never);
      const error = await service.handle("testConnection", { connectionString: "postgresql://app_user@mydb.abc.eu-west-1.rds.amazonaws.com/app?sslmode=require&auth=aws-iam" }).catch(e => e as DbError);
      assert.ok(seen.includes("Action=connect"));
      assert.ok(error instanceof DbError && !(error as DbError).message.includes("X-Amz-Signature"), String((error as DbError).message));
    } finally {
      process.env = saved;
    }
  });

  test("Cosmos DB signs with the decoded account key", () => {
    const key = Buffer.from("not-a-real-key").toString("base64");
    const date = "Tue, 01 Jan 2030 00:00:00 GMT";
    const expected = createHmac("sha256", Buffer.from(key, "base64")).update(`get\ndocs\ndbs/app/colls/users\n${date.toLowerCase()}\n\n`).digest("base64");
    assert.strictEqual(decodeURIComponent(cosmosAuthorization("GET", "docs", "dbs/app/colls/users", date, key)), `type=master&ver=1.0&sig=${expected}`);
  });
});

suite("database cloud: values and queries", () => {
  test("DynamoDB items round-trip through JSON, keeping sets, binary and big numbers", () => {
    const item = { pk: { S: "a" }, n: { N: "42" }, big: { N: "12345678901234567890" }, f: { N: "1.5" }, ok: { BOOL: true }, none: { NULL: true }, tags: { SS: ["x", "y"] }, nums: { NS: ["1", "2"] }, bin: { B: "AAE=" }, m: { M: { l: { L: [{ S: "q" }, { N: "1" }] } } } };
    const json = fromItem(item);
    assert.deepStrictEqual(json, { pk: "a", n: 42, big: { $numberDecimal: "12345678901234567890" }, f: 1.5, ok: true, none: null, tags: { $SS: ["x", "y"] }, nums: { $NS: ["1", "2"] }, bin: { $binary: { base64: "AAE=", subType: "00" } }, m: { l: ["q", 1] } });
    assert.deepStrictEqual(toItem(JSON.parse(JSON.stringify(json))), item);
    throwsDb(() => toItem({ s: { $SS: [] } }), /sets cannot be empty/);
  });

  test("Firestore values round-trip, keeping timestamps, references and whole doubles", () => {
    const fields = {
      name: { stringValue: "Ada" }, age: { integerValue: "36" }, big: { integerValue: "9007199254740993" }, score: { doubleValue: 2 }, ratio: { doubleValue: 0.5 },
      at: { timestampValue: "2024-01-02T03:04:05.123Z" }, ref: { referenceValue: "projects/p/databases/(default)/documents/users/x" }, geo: { geoPointValue: { latitude: 1, longitude: 2 } },
      tags: { arrayValue: { values: [{ stringValue: "a" }] } }, meta: { mapValue: { fields: { ok: { booleanValue: true }, none: { nullValue: null } } } }
    };
    const json = fromFields(fields);
    assert.deepStrictEqual(json.score, { $numberDouble: "2.0" });
    assert.deepStrictEqual(json.at, { $date: "2024-01-02T03:04:05.123Z" });
    assert.deepStrictEqual(json.big, { $numberLong: "9007199254740993" });
    const back = (toValue(JSON.parse(JSON.stringify(json))) as any).mapValue.fields;
    assert.deepStrictEqual(back, fields);
    throwsDb(() => toValue([[1]]), /cannot directly contain arrays/);
  });

  test("parses the Firestore console's SQL-like queries into structured queries", () => {
    const q = parseFirestoreQuery("SELECT * FROM users WHERE age >= 21 AND city IN ('Oslo', 'Rome') AND email IS NOT NULL ORDER BY age DESC LIMIT 20 OFFSET 40;");
    assert.strictEqual(q.collection, "users");
    assert.deepStrictEqual(q.structuredQuery.orderBy, [{ field: { fieldPath: "age" }, direction: "DESCENDING" }]);
    assert.strictEqual(q.structuredQuery.limit, 20);
    assert.strictEqual(q.structuredQuery.offset, 40);
    const filters = (q.structuredQuery.where as any).compositeFilter.filters;
    assert.deepStrictEqual(filters[0], { fieldFilter: { field: { fieldPath: "age" }, op: "GREATER_THAN_OR_EQUAL", value: { integerValue: "21" } } });
    assert.deepStrictEqual(filters[1].fieldFilter.value, { arrayValue: { values: [{ stringValue: "Oslo" }, { stringValue: "Rome" }] } });
    assert.deepStrictEqual(filters[2], { unaryFilter: { field: { fieldPath: "email" }, op: "IS_NOT_NULL" } });
    const sub = parseFirestoreQuery("select count(*) from users/alice/orders where tags array_contains 'new' and `odd name` = \"x\"", (c, id) => `${c}/${id}`);
    assert.strictEqual(sub.count, true);
    assert.strictEqual(sub.collection, "users/alice/orders");
    assert.deepStrictEqual((sub.structuredQuery.from as any)[0], { collectionId: "orders" });
    assert.strictEqual((sub.structuredQuery.where as any).compositeFilter.filters[1].fieldFilter.field.fieldPath, "`odd name`");
    const byId = parseFirestoreQuery("SELECT * FROM users WHERE _id = 'alice'", (c, id) => `projects/p/databases/(default)/documents/${c}/${id}`);
    assert.deepStrictEqual((byId.structuredQuery.where as any).fieldFilter, { field: { fieldPath: "__name__" }, op: "EQUAL", value: { referenceValue: "projects/p/databases/(default)/documents/users/alice" } });
    throwsDb(() => parseFirestoreQuery("SELECT * FROM users/alice"), /document path/);
    throwsDb(() => parseFirestoreQuery("SELECT * FROM users WHERE a = 1 OR b = 2"), /OR is not supported/);
    throwsDb(() => parseFirestoreQuery("DELETE FROM users"), /SELECT \* FROM collection/);
    assert.strictEqual(parseFirestoreQuery('{"structuredQuery":{"from":[{"collectionId":"users"}],"limit":5}}').collection, "users");
  });

  test("builds GoogleSQL with backticks and parameters cast to the column type", () => {
    const col = (name: string, dataType: string, extra: Partial<ColumnInfo> = {}): ColumnInfo => ({ name, dataType, category: categorize(dataType), nullable: true, primaryKey: false, autoIncrement: false, editable: true, ...extra });
    const columns = [col("SingerId", "INT64", { primaryKey: true, nullable: false }), col("Name", "STRING(MAX)"), col("Born", "DATE"), col("Meta", "JSON"), col("Pic", "BYTES(MAX)")];
    assert.strictEqual(quoteIdent("we`ird", "googlesql"), "`we\\`ird`");
    assert.strictEqual(categorize("BYTES(MAX)"), "binary");
    const plan = buildSelect({ target: { object: "Singers" }, page: 2, pageSize: 10, search: "50%", filters: [{ column: "SingerId", op: "gt", value: "7" }, { column: "Born", op: "eq", value: "1990-01-01" }] }, columns, "primary", "googlesql");
    assert.strictEqual(plan.select.sql, "SELECT * FROM `Singers` WHERE `SingerId` > CAST(@p1 AS INT64) AND `Born` = CAST(@p2 AS DATE) AND (LOWER(CAST(`SingerId` AS STRING)) LIKE LOWER(@p3) OR LOWER(CAST(`Name` AS STRING)) LIKE LOWER(@p4) OR LOWER(CAST(`Born` AS STRING)) LIKE LOWER(@p5)) ORDER BY `SingerId` LIMIT 10 OFFSET 10");
    assert.deepStrictEqual(plan.select.params, ["7", "1990-01-01", "%50\\%%", "%50\\%%", "%50\\%%"]);
    const update = buildUpdate({ object: "Singers", schema: "music" }, columns, { SingerId: 12345678901234567890n.toString() }, "primary", { Name: { mode: "value", value: "Ada" }, Meta: { mode: "value", value: "{\"a\":1}" } }, "googlesql");
    assert.strictEqual(update.sql, "UPDATE `music`.`Singers` SET `Name` = @p1, `Meta` = PARSE_JSON(@p2) WHERE `SingerId` = CAST(@p3 AS INT64)");
    assert.deepStrictEqual(update.params, ["Ada", "{\"a\":1}", "12345678901234567890"]);
    assert.strictEqual(googleSqlCast("@p1", col("n", "INTEGER")), "CAST(@p1 AS INT64)");
    assert.strictEqual(googleSqlCast("@p1", col("n", "NUMERIC(10,2)")), "CAST(@p1 AS NUMERIC)");
  });

  test("decodes BigQuery cells by schema, keeping microseconds and nested records", () => {
    assert.strictEqual(decodeBigQuery("1700000000123456", { name: "t", type: "TIMESTAMP" }), "2023-11-14T22:13:20.123456Z");
    assert.strictEqual(decodeBigQuery("1.7E9", { name: "t", type: "TIMESTAMP" }), "2023-11-14T22:13:20.000Z");
    assert.strictEqual(decodeBigQuery("9007199254740993", { name: "n", type: "INTEGER" }), "9007199254740993");
    assert.deepStrictEqual(decodeBigQuery([{ v: "1" }, { v: "2" }], { name: "a", type: "INT64", mode: "REPEATED" }), [1, 2]);
    assert.deepStrictEqual(decodeBigQuery({ f: [{ v: "x" }, { v: "true" }] }, { name: "r", type: "RECORD", fields: [{ name: "s", type: "STRING" }, { name: "b", type: "BOOL" }] }), { s: "x", b: true });
  });
});

suite("database cloud: adapters against mock APIs", () => {
  test("DynamoDB signs requests, pages with NextToken and guards writes with conditions", async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ pk: { S: `k${i}` }, n: { N: String(i) } }));
    const api = await mockApi(req => {
      const op = String(req.headers["x-amz-target"] ?? "").split(".").pop();
      const b = req.body ?? {};
      switch (op) {
        case "ListTables": return { body: { TableNames: ["orders"] } };
        case "DescribeTable": return { body: { Table: { TableName: "orders", ItemCount: 5, KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }], AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }], GlobalSecondaryIndexes: [{ IndexName: "by-n", KeySchema: [{ AttributeName: "n", KeyType: "HASH" }], Projection: { ProjectionType: "ALL" } }] } } };
        case "Scan": return { body: { Items: items.slice(0, b.Limit) } };
        case "ExecuteStatement": {
          const start = b.NextToken ? Number(b.NextToken) : 0;
          const page = items.slice(start, start + (b.Limit ?? 100));
          return { body: { Items: page, NextToken: start + page.length < items.length ? String(start + page.length) : undefined } };
        }
        case "PutItem": return /attribute_not_exists/.test(b.ConditionExpression) && b.Item.pk.S === "k0" ? { status: 400, body: { __type: "com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException", message: "The conditional request failed" } } : { body: {} };
        case "BatchWriteItem": return { body: { UnprocessedItems: {} } };
      }
      return undefined;
    });
    try {
      const adapter = new DynamoAdapter(parseConnection(`dynamodb://AKIAIOSFODNN7EXAMPLE:secret@us-west-2?endpoint=${encodeURIComponent(api.url)}`));
      assert.match((await adapter.connect()).version, /DynamoDB Local|Amazon DynamoDB/);
      assert.match(String(api.seen[0].headers.authorization), /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/\d{8}\/us-west-2\/dynamodb\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=[0-9a-f]{64}$/);
      assert.deepStrictEqual(await adapter.listObjects(), [{ name: "orders", type: "table", rows: 5 }]);
      const target = { database: "us-west-2", object: "orders" };
      const p1 = await adapter.fetchPage({ target, page: 1, pageSize: 2 });
      assert.deepStrictEqual(p1.rows.map(r => r.pk), ["k0", "k1"]);
      assert.strictEqual(p1.hasMore, true);
      assert.deepStrictEqual(p1.keyColumns, ["pk"]);
      const p3 = await adapter.fetchPage({ target, page: 3, pageSize: 2 });
      assert.deepStrictEqual([p3.rows.map(r => r.pk), p3.hasMore], [["k4"], false]);
      const p4 = await adapter.fetchPage({ target, page: 4, pageSize: 2 });
      assert.strictEqual(p4.rows.length, 0);
      const filtered = api.seen.length;
      await adapter.fetchPage({ target, page: 1, pageSize: 2, filters: [{ column: "n", op: "gt", value: "1" }, { column: "pk", op: "starts", value: "k" }] });
      const stmt = api.seen.slice(filtered).find(s => s.body?.Statement)!.body;
      assert.strictEqual(stmt.Statement, `SELECT * FROM "orders" WHERE "n" > ? AND begins_with("pk", ?)`);
      assert.deepStrictEqual(stmt.Parameters, [{ N: "1" }, { S: "k" }]);
      await rejectsDb(adapter.insert(target, { $document: { mode: "value", value: JSON.stringify({ pk: "k0" }) } }), /already exists/);
      await rejectsDb(adapter.insert(target, { $document: { mode: "value", value: JSON.stringify({ other: 1 }) } }), /key attribute pk is missing/);
      await rejectsDb(adapter.update(target, { pk: "k1" }, "primary", { $document: { mode: "value", value: JSON.stringify({ pk: "k9" }) } }), /cannot be changed/);
      assert.strictEqual(await adapter.update(target, { pk: "k1" }, "primary", { $document: { mode: "value", value: JSON.stringify({ pk: "k1", n: 7 }) } }), 1);
      assert.match(api.seen[api.seen.length - 1].body.ConditionExpression, /attribute_exists/);
      assert.strictEqual(await adapter.remove(target, [{ pk: "k1" }, { pk: "k2" }]), 2);
      assert.strictEqual((await adapter.indexes(target)).map(i => i.type).join(","), "table,GSI");
      assert.deepStrictEqual(adapter.classify("SELECT * FROM t; DELETE FROM t WHERE pk = 'a'").map(c => [c.verb, c.write, !!c.danger]), [["select", false, false], ["delete", true, true]]);
      throwsDb(() => adapter.classify("DROP TABLE t"), /does not support DROP/);
      await rejectsDb(adapter.fetchPage({ target, page: 1, pageSize: 2, sort: { column: "n", dir: "asc" } }), /cannot be sorted/);
    } finally {
      await api.close();
    }
  });

  test("Cosmos DB queries each partition range with signed requests and addresses documents by partition key", async () => {
    const docs = [{ id: "1", tenant: "a", name: "x", _rid: "r1", _self: "s", _etag: "e1", _ts: 1 }, { id: "2", tenant: "b", name: "y", _rid: "r2", _self: "s", _etag: "e2", _ts: 2 }];
    const api = await mockApi(req => {
      if (req.method === "GET" && req.path === "/") return { body: { id: "acct" } };
      if (req.path === "/dbs") return { body: { Databases: [{ id: "app" }] } };
      if (req.path === "/dbs/app/colls") return { body: { DocumentCollections: [{ id: "users" }] } };
      if (req.path === "/dbs/app/colls/users") return { body: { id: "users", partitionKey: { paths: ["/tenant"], kind: "Hash" }, indexingPolicy: { indexingMode: "consistent", includedPaths: [{ path: "/*" }] } } };
      if (req.path === "/dbs/app/colls/users/pkranges") return { body: { PartitionKeyRanges: [{ id: "0" }] } };
      if (req.method === "POST" && req.path === "/dbs/app/colls/users/docs" && req.headers["x-ms-documentdb-isquery"]) {
        return { body: { Documents: /COUNT/.test(req.body.query) ? [2] : docs } };
      }
      if (req.method === "PUT" || req.method === "DELETE" || req.method === "POST") return { body: {} };
      return undefined;
    });
    try {
      const adapter = new CosmosAdapter(parseConnection(`AccountEndpoint=${api.url}/;AccountKey=${Buffer.from("k").toString("base64")};`));
      await adapter.connect();
      assert.deepStrictEqual(await adapter.listDatabases(), ["app"]);
      const target = { database: "app", object: "users" };
      const page = await adapter.fetchPage({ target, page: 1, pageSize: 50, filters: [{ column: "name", op: "contains", value: "x" }], sort: { column: "name", dir: "desc" } });
      assert.strictEqual(page.total, 2);
      assert.deepStrictEqual(page.keyColumns, ["id", PK_COLUMN]);
      assert.strictEqual(page.rows[0][PK_COLUMN], '["a"]');
      assert.ok(!("_rid" in page.rows[0]) && "_etag" in page.rows[0]);
      const query = api.seen.find(s => s.body?.query?.startsWith("SELECT * FROM c WHERE"))!;
      assert.strictEqual(query.body.query, 'SELECT * FROM c WHERE CONTAINS(c["name"], @p0, true) ORDER BY c["name"] DESC OFFSET 0 LIMIT 50');
      assert.strictEqual(query.headers["x-ms-documentdb-partitionkeyrangeid"], "0");
      assert.match(decodeURIComponent(String(query.headers.authorization)), /^type=master&ver=1\.0&sig=[A-Za-z0-9+/]+=*$/);
      await adapter.update(target, page.rows[0], "primary", { $document: { mode: "value", value: JSON.stringify({ id: "1", tenant: "a", name: "z", _etag: "e1" }) } });
      const put = api.seen.find(s => s.method === "PUT")!;
      assert.strictEqual(put.path, "/dbs/app/colls/users/docs/1");
      assert.strictEqual(put.headers["x-ms-documentdb-partitionkey"], '["a"]');
      assert.ok(!("_etag" in put.body));
      await rejectsDb(adapter.update(target, page.rows[0], "primary", { $document: { mode: "value", value: JSON.stringify({ id: "1", tenant: "b" }) } }), /partition key value cannot be changed/);
      assert.strictEqual(await adapter.remove(target, [page.rows[0], page.rows[1]]), 2);
      assert.deepStrictEqual(api.seen.filter(s => s.method === "DELETE").map(s => s.headers["x-ms-documentdb-partitionkey"]).sort(), ['["a"]', '["b"]']);
      const console = await adapter.runQuery("SELECT * FROM users u WHERE u.tenant = 'a'", { database: "app" });
      assert.strictEqual(console.rows.length, 2);
      throwsDb(() => adapter.classify("DELETE FROM c"), /start with SELECT/);
      assert.strictEqual(partitionKeyHeader({ a: { b: 1 } }, ["/a/b", "/missing"]), "[1,{}]");
    } finally {
      await api.close();
    }
  });

  test("Spanner runs reads in sessions, commits DML and applies DDL operations", async () => {
    const api = await mockApi(req => {
      if (req.path.endsWith("/sessions")) return { body: { name: "projects/p/instances/i/databases/db/sessions/s1" } };
      if (req.path.endsWith(":executeSql")) {
        const sql: string = req.body.sql;
        if (/INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '' ORDER/.test(sql)) return { body: { metadata: { rowType: { fields: [{ name: "name", type: { code: "STRING" } }, { name: "type", type: { code: "STRING" } }] } }, rows: [["Singers", "BASE TABLE"]] } };
        if (/INFORMATION_SCHEMA.COLUMNS/.test(sql)) return { body: { metadata: { rowType: { fields: ["name", "type", "nullable", "def", "generated"].map(n => ({ name: n, type: { code: "STRING" } })) } }, rows: [["SingerId", "INT64", "NO", null, "NEVER"], ["Name", "STRING(MAX)", "YES", null, "NEVER"], ["Tags", "ARRAY<STRING(MAX)>", "YES", null, "NEVER"]] } };
        if (/INDEX_TYPE = 'PRIMARY_KEY'/.test(sql)) return { body: { metadata: { rowType: { fields: [{ name: "name", type: { code: "STRING" } }] } }, rows: [["SingerId"]] } };
        if (/TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE/.test(sql)) return { body: { metadata: { rowType: { fields: [{ name: "type", type: { code: "STRING" } }] } }, rows: [["BASE TABLE"]] } };
        if (/^SELECT \* FROM `Singers`/.test(sql)) return { body: { metadata: { rowType: { fields: [{ name: "SingerId", type: { code: "INT64" } }, { name: "Name", type: { code: "STRING" } }, { name: "Tags", type: { code: "ARRAY", arrayElementType: { code: "STRING" } } }] } }, rows: [["9007199254740993", "Ada", ["x"]]] } };
        if (/^SELECT COUNT/.test(sql)) return { body: { metadata: { rowType: { fields: [{ name: "n", type: { code: "INT64" } }] } }, rows: [["1"]] } };
        if (/^UPDATE/.test(sql)) return { body: { metadata: { transaction: { id: "tx1" } }, stats: { rowCountExact: "1" } } };
        return { body: { metadata: { rowType: { fields: [{ name: "x", type: { code: "INT64" } }] } }, rows: [["1"]] } };
      }
      if (req.path.endsWith(":commit")) return { body: { commitTimestamp: "now" } };
      if (req.method === "PATCH" && req.path.endsWith("/ddl")) return { body: { name: "projects/p/instances/i/databases/db/operations/op1", done: false } };
      if (req.path.endsWith("/operations/op1")) return { body: { name: "op1", done: true } };
      if (req.method === "DELETE") return { body: {} };
      return undefined;
    });
    try {
      const adapter = new SpannerAdapter(parseConnection(`spanner://p/inst/db?endpoint=${encodeURIComponent(api.url)}`));
      assert.strictEqual((await adapter.connect()).version, "Cloud Spanner emulator");
      assert.ok(!api.seen.some(s => s.headers.authorization), "emulators get no token");
      assert.deepStrictEqual(await adapter.listObjects("db"), [{ name: "Singers", type: "table" }]);
      const target = { database: "db", object: "Singers" };
      const page = await adapter.fetchPage({ target, page: 1, pageSize: 50 });
      assert.deepStrictEqual(page.rows[0], { SingerId: "9007199254740993", Name: "Ada", Tags: ["x"] });
      assert.strictEqual(page.columns.find(c => c.name === "Tags")!.editable, false);
      assert.strictEqual(await adapter.update(target, { SingerId: "9007199254740993" }, "primary", { Name: { mode: "value", value: "Bo" } }), 1);
      const dml = api.seen.find(s => /^UPDATE/.test(s.body?.sql ?? ""))!;
      assert.strictEqual(dml.body.sql, "UPDATE `Singers` SET `Name` = @p1 WHERE `SingerId` = CAST(@p2 AS INT64)");
      assert.deepStrictEqual(dml.body.paramTypes, { p1: { code: "STRING" }, p2: { code: "STRING" } });
      assert.deepStrictEqual(dml.body.transaction, { begin: { readWrite: {} } });
      assert.ok(api.seen.some(s => s.path.endsWith(":commit") && s.body.transactionId === "tx1"));
      const ddl = await adapter.runQuery("CREATE TABLE T (Id INT64) PRIMARY KEY (Id); CREATE INDEX TI ON T (Id)", { database: "db" });
      assert.match(ddl.message ?? "", /2 schema changes completed/);
      assert.deepStrictEqual(api.seen.find(s => s.method === "PATCH")!.body.statements, ["CREATE TABLE T (Id INT64) PRIMARY KEY (Id)", "CREATE INDEX TI ON T (Id)"]);
      await adapter.close();
      assert.ok(api.seen.some(s => s.method === "DELETE" && s.path.endsWith("/sessions/s1")));
    } finally {
      await api.close();
    }
  });

  test("BigQuery browses tables for free and runs filtered pages as typed query jobs", async () => {
    const schema = { fields: [{ name: "id", type: "INTEGER" }, { name: "name", type: "STRING" }, { name: "at", type: "TIMESTAMP" }] };
    const api = await mockApi(req => {
      if (/\/datasets\?maxResults=1$/.test(req.path)) return { body: { datasets: [] } };
      if (/\/datasets\?maxResults=1000/.test(req.path)) return { body: { datasets: [{ datasetReference: { datasetId: "sales" } }] } };
      if (/\/datasets\/sales\/tables\?/.test(req.path)) return { body: { tables: [{ tableReference: { tableId: "orders" }, type: "TABLE" }, { tableReference: { tableId: "v" }, type: "VIEW" }] } };
      if (/\/datasets\/sales\/tables\/orders$/.test(req.path)) return { body: { type: "TABLE", numRows: "3", schema } };
      if (/\/tables\/orders\/data\?/.test(req.path)) return { body: { totalRows: "3", rows: [{ f: [{ v: "1" }, { v: "a" }, { v: "1700000000000000" }] }] } };
      if (req.method === "POST" && /\/queries$/.test(req.path)) return { body: { jobComplete: true, jobReference: { jobId: "j1" }, schema, rows: [{ f: [{ v: "2" }, { v: "b" }, { v: null }] }], totalBytesProcessed: "1500000", totalBytesBilled: "10485760" } };
      return undefined;
    });
    try {
      const adapter = new BigQueryAdapter(parseConnection(`bigquery://my-project?endpoint=${encodeURIComponent(api.url)}&maxbytesbilled=1000000000`));
      assert.strictEqual((await adapter.connect()).defaultDatabase, "my-project");
      assert.deepStrictEqual(await adapter.listSchemas(), ["sales"]);
      assert.deepStrictEqual(await adapter.listObjects("my-project", "sales"), [{ name: "orders", type: "table" }, { name: "v", type: "view" }]);
      const target = { database: "my-project", schema: "sales", object: "orders" };
      const free = await adapter.fetchPage({ target, page: 2, pageSize: 1 });
      assert.strictEqual(free.total, 3);
      assert.match(free.note ?? "", /no query cost/);
      assert.ok(api.seen.some(s => s.path.includes("/data?startIndex=1&maxResults=1")));
      assert.strictEqual(free.canInsert, false);
      const filtered = await adapter.fetchPage({ target, page: 1, pageSize: 10, filters: [{ column: "id", op: "gte", value: "2" }] });
      assert.deepStrictEqual(filtered.rows[0], { id: 2, name: "b", at: null });
      assert.match(filtered.note ?? "", /Scanned 1\.50 MB, billed 10\.5 MB/);
      const job = api.seen.find(s => s.method === "POST")!.body;
      assert.strictEqual(job.query, "SELECT * FROM `sales`.`orders` WHERE `id` >= CAST(@p1 AS INT64) LIMIT 10 OFFSET 0");
      assert.deepStrictEqual(job.queryParameters, [{ name: "p1", parameterType: { type: "STRING" }, parameterValue: { value: "2" } }]);
      assert.strictEqual(job.maximumBytesBilled, "1000000000");
      assert.strictEqual(job.useLegacySql, false);
      const result = await adapter.runQuery("SELECT * FROM orders", { database: "my-project", schema: "sales" });
      assert.match(result.note ?? "", /Scanned/);
      assert.deepStrictEqual(api.seen.filter(s => s.method === "POST").pop()!.body.defaultDataset, { projectId: "my-project", datasetId: "sales" });
    } finally {
      await api.close();
    }
  });

  test("Firestore builds structured queries, counts, and writes with preconditions", async () => {
    const root = "/v1/projects/demo-proj/databases/(default)/documents";
    const api = await mockApi(req => {
      if (req.path === `${root}:listCollectionIds`) return { body: { collectionIds: ["users"] } };
      if (req.path === `${root}:runQuery`) return { body: [{ document: { name: `projects/demo-proj/databases/(default)/documents/users/alice`, fields: { age: { integerValue: "36" }, at: { timestampValue: "2024-01-01T00:00:00Z" } } } }, { readTime: "x" }] };
      if (req.path === `${root}:runAggregationQuery`) return { body: [{ result: { aggregateFields: { n: { integerValue: "1" } } } }] };
      if (req.method === "PATCH" || req.method === "POST") return { body: {} };
      return undefined;
    });
    try {
      const adapter = new FirestoreAdapter(parseConnection(`firestore://demo-proj?endpoint=${encodeURIComponent(api.url)}`));
      assert.strictEqual((await adapter.connect()).version, "Firestore emulator");
      assert.strictEqual(api.seen[0].headers.authorization, "Bearer owner");
      const target = { database: "(default)", object: "users" };
      const page = await adapter.fetchPage({ target, page: 2, pageSize: 10, filters: [{ column: "age", op: "gte", value: "21" }, { column: "name", op: "starts", value: "Al" }], sort: { column: "age", dir: "desc" } });
      assert.deepStrictEqual(page.rows[0], { _id: "alice", age: 36, at: { $date: "2024-01-01T00:00:00Z" } });
      assert.strictEqual(page.total, 1);
      const q = api.seen.filter(s => s.path === `${root}:runQuery`).pop()!.body.structuredQuery;
      assert.deepStrictEqual([q.offset, q.limit, q.orderBy[0].direction, q.where.compositeFilter.filters.length], [10, 10, "DESCENDING", 3]);
      const count = api.seen.find(s => s.path === `${root}:runAggregationQuery`)!.body.structuredAggregationQuery.structuredQuery;
      assert.ok(!("limit" in count) && !("orderBy" in count));
      await rejectsDb(adapter.fetchPage({ target, page: 1, pageSize: 10, filters: [{ column: "name", op: "contains", value: "x" }] }), /cannot search inside text/);
      await adapter.update(target, { _id: "alice" }, "_id", { $document: { mode: "value", value: JSON.stringify({ _id: "alice", age: 37 }) } });
      const patch = api.seen.find(s => s.method === "PATCH")!;
      assert.strictEqual(patch.path, `${root}/users/alice?currentDocument.exists=true`);
      assert.deepStrictEqual(patch.body, { fields: { age: { integerValue: "37" } } });
      await adapter.insert(target, { $document: { mode: "value", value: JSON.stringify({ _id: "bob", age: 1 }) } });
      assert.ok(api.seen.some(s => s.method === "POST" && s.path === `${root}/users?documentId=bob`));
      assert.strictEqual(await adapter.remove(target, [{ _id: "alice" }]), 1);
      assert.deepStrictEqual(api.seen.find(s => s.path.endsWith("documents:commit"))!.body.writes, [{ delete: "projects/demo-proj/databases/(default)/documents/users/alice" }]);
      const counted = await adapter.runQuery("SELECT COUNT(*) FROM users WHERE age > 1", {});
      assert.deepStrictEqual(counted.rows, [{ count: 1 }]);
    } finally {
      await api.close();
    }
  });
});
