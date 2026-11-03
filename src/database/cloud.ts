/**
 * Cloud database services of AWS, Azure and Google Cloud, as presets over the
 * Database Client's engines.
 *
 * Services that speak an engine's wire protocol (RDS, Aurora, Cloud SQL,
 * AlloyDB, Azure SQL/PostgreSQL/MySQL) reuse that engine's adapter: a preset
 * only supplies ports, TLS defaults, host hints and the auth methods that
 * work there. Services with their own API (DynamoDB, Cosmos DB, Spanner,
 * Firestore, BigQuery) and Redshift have kinds of their own.
 *
 * Pure (no vscode, no network), so it is unit tested directly and its
 * catalog is sent to the webview as is.
 */

import type { ConnectionSpec } from "./connection-string";
import { DbKind } from "./types";

export type CloudProvider = "aws" | "azure" | "gcp";

export const CLOUD_PROVIDERS: Record<CloudProvider, { label: string; short: string }> = {
  aws: { label: "Amazon Web Services", short: "AWS" },
  azure: { label: "Microsoft Azure", short: "Azure" },
  gcp: { label: "Google Cloud", short: "Google Cloud" }
};

/**
 * How a connection authenticates.
 * - password: user name and password (or the engine's own key).
 * - aws-iam / azure-ad / gcp-iam: a short-lived token from the provider replaces the password.
 * - access-key, profile, env: AWS credentials given, read from ~/.aws, or from the environment.
 * - service-account, key-file, adc, emulator: Google credentials pasted, read from a file,
 *   Application Default Credentials (gcloud), or none for a local emulator.
 */
export type CloudAuth = "password" | "aws-iam" | "azure-ad" | "gcp-iam" | "access-key" | "profile" | "env" | "account-key" | "service-account" | "key-file" | "adc" | "emulator";

export const AUTH_LABELS: Record<CloudAuth, string> = {
  password: "User and password",
  "aws-iam": "IAM database authentication",
  "azure-ad": "Microsoft Entra ID (Azure CLI sign-in)",
  "gcp-iam": "IAM database authentication",
  "access-key": "Access key",
  profile: "AWS profile (~/.aws)",
  env: "Environment / default credentials",
  "account-key": "Account key",
  "service-account": "Service account key (JSON)",
  "key-file": "Key file path",
  adc: "Application Default Credentials (gcloud)",
  emulator: "Local emulator (no auth)"
};

export interface CloudEngine {
  kind: DbKind;
  /** Shown in the engine picker, e.g. "PostgreSQL". */
  label: string;
  port?: number;
  /** Placeholder for the user field. */
  user?: string;
  /** Placeholder for the database field. */
  database?: string;
  /** Default of the form's TLS choice for this engine (the form's own vocabulary). */
  tls: string;
  /** Auth methods available with this engine, first is the default. */
  auth: CloudAuth[];
}

export interface CloudService {
  id: string;
  provider: CloudProvider;
  label: string;
  /** One line under the label. */
  description: string;
  engines: CloudEngine[];
  /** Example endpoint, used as the host placeholder. */
  hostHint?: string;
  /** Regular expression (source) matching the service's endpoints, used to recognise pasted strings. */
  hostPattern?: string;
  /** Shown under the form. */
  notes?: string;
  /** Where to find the endpoint and credentials. */
  docs: string;
}

const PG = "PostgreSQL";
const MY = "MySQL";

export const CLOUD_SERVICES: CloudService[] = [
  // ---------------------------------------------------------------- AWS
  {
    id: "aws-rds", provider: "aws", label: "Amazon RDS", description: "Managed PostgreSQL, MySQL, MariaDB, SQL Server and Oracle",
    engines: [
      { kind: "postgres", label: PG, port: 5432, user: "postgres", database: "postgres", tls: "require", auth: ["password", "aws-iam"] },
      { kind: "mysql", label: MY, port: 3306, user: "admin", database: "", tls: "REQUIRED", auth: ["password", "aws-iam"] },
      { kind: "mariadb", label: "MariaDB", port: 3306, user: "admin", database: "", tls: "REQUIRED", auth: ["password", "aws-iam"] },
      { kind: "sqlserver", label: "SQL Server", port: 1433, user: "admin", database: "master", tls: "trust", auth: ["password"] },
      { kind: "oracle", label: "Oracle", port: 1521, user: "admin", database: "ORCL", tls: "", auth: ["password"] }
    ],
    hostHint: "mydb.abc123xyz789.us-east-1.rds.amazonaws.com",
    hostPattern: "^(?!.*\\.cluster-)[a-z0-9-]+\\.(proxy-)?[a-z0-9]+\\.[a-z0-9-]+\\.rds\\.amazonaws\\.com(\\.cn)?$",
    notes: "TLS encrypts without checking the certificate, because the Amazon RDS CA is not in Node's trust store. To verify it, download the RDS CA bundle and add sslrootcert=/path/global-bundle.pem (PostgreSQL). Oracle TLS needs the SSL option on port 2484.",
    docs: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ConnectToInstance.html"
  },
  {
    id: "aws-aurora", provider: "aws", label: "Amazon Aurora", description: "Aurora PostgreSQL and Aurora MySQL clusters",
    engines: [
      { kind: "postgres", label: `Aurora ${PG}`, port: 5432, user: "postgres", database: "postgres", tls: "require", auth: ["password", "aws-iam"] },
      { kind: "mysql", label: `Aurora ${MY}`, port: 3306, user: "admin", database: "", tls: "REQUIRED", auth: ["password", "aws-iam"] }
    ],
    hostHint: "mycluster.cluster-abc123xyz789.us-east-1.rds.amazonaws.com",
    hostPattern: "\\.cluster-(ro-|custom-)?[a-z0-9]+\\.[a-z0-9-]+\\.rds\\.amazonaws\\.com(\\.cn)?$",
    notes: "Use the cluster (writer) endpoint to edit data; the reader endpoint (cluster-ro-) is read-only.",
    docs: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Connecting.html"
  },
  {
    id: "aws-dynamodb", provider: "aws", label: "Amazon DynamoDB", description: "Key-value and document tables, with PartiQL queries",
    engines: [{ kind: "dynamodb", label: "DynamoDB", tls: "", auth: ["access-key", "profile", "env", "emulator"] }],
    notes: "Browsing scans tables page by page and uses read capacity. For DynamoDB Local, choose the emulator and set the endpoint, e.g. http://localhost:8000.",
    docs: "https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ql-reference.html"
  },
  {
    id: "aws-redshift", provider: "aws", label: "Amazon Redshift", description: "Provisioned clusters and Redshift Serverless",
    engines: [{ kind: "redshift", label: "Redshift", port: 5439, user: "awsuser", database: "dev", tls: "require", auth: ["password"] }],
    hostHint: "examplecluster.abc123xyz789.us-west-2.redshift.amazonaws.com",
    hostPattern: "\\.redshift(-serverless)?\\.amazonaws\\.com(\\.cn)?$",
    notes: "For Redshift Serverless use the workgroup endpoint (default-workgroup.123456789012.us-east-1.redshift-serverless.amazonaws.com).",
    docs: "https://docs.aws.amazon.com/redshift/latest/mgmt/connecting-to-cluster.html"
  },
  // ---------------------------------------------------------------- Azure
  {
    id: "azure-sql", provider: "azure", label: "Azure SQL Database", description: "Azure SQL Database and SQL Managed Instance",
    engines: [{ kind: "sqlserver", label: "SQL Server", port: 1433, user: "sqladmin", database: "mydb", tls: "true", auth: ["password", "azure-ad"] }],
    hostHint: "myserver.database.windows.net",
    hostPattern: "\\.database\\.(windows\\.net|chinacloudapi\\.cn|usgovcloudapi\\.net|cloudapi\\.de)$",
    notes: "Add your IP under the server's Networking firewall rules first. Paste the ADO.NET connection string from the portal into Connection string.",
    docs: "https://learn.microsoft.com/azure/azure-sql/database/connect-query-content-reference-guide"
  },
  {
    id: "azure-cosmos", provider: "azure", label: "Azure Cosmos DB", description: "NoSQL API, or the MongoDB API",
    engines: [
      { kind: "cosmosdb", label: "NoSQL API", tls: "", auth: ["account-key", "emulator"] },
      { kind: "mongodb", label: "MongoDB API", port: 10255, user: "myaccount", database: "", tls: "tls", auth: ["password"] }
    ],
    hostHint: "myaccount.documents.azure.com",
    hostPattern: "\\.(documents|mongo\\.cosmos)\\.azure\\.com$",
    notes: "Find the URI and PRIMARY KEY under Keys in the portal, or paste the PRIMARY CONNECTION STRING. Queries are charged in request units.",
    docs: "https://learn.microsoft.com/azure/cosmos-db/nosql/query/"
  },
  {
    id: "azure-postgres", provider: "azure", label: "Azure Database for PostgreSQL", description: "Flexible Server",
    engines: [{ kind: "postgres", label: PG, port: 5432, user: "myadmin", database: "postgres", tls: "verify-full", auth: ["password", "azure-ad"] }],
    hostHint: "myserver.postgres.database.azure.com",
    hostPattern: "\\.postgres\\.database\\.azure\\.com$",
    notes: "Allow your IP under Networking first. With Entra ID, the user is your Entra ID user or group name.",
    docs: "https://learn.microsoft.com/azure/postgresql/flexible-server/quickstart-create-server"
  },
  {
    id: "azure-mysql", provider: "azure", label: "Azure Database for MySQL", description: "Flexible Server",
    engines: [{ kind: "mysql", label: MY, port: 3306, user: "myadmin", database: "", tls: "VERIFY_IDENTITY", auth: ["password", "azure-ad"] }],
    hostHint: "myserver.mysql.database.azure.com",
    hostPattern: "\\.mysql\\.database\\.azure\\.com$",
    notes: "Allow your IP under Networking first. Flexible Server requires TLS by default.",
    docs: "https://learn.microsoft.com/azure/mysql/flexible-server/how-to-connect-tls-ssl"
  },
  // ---------------------------------------------------------------- Google Cloud
  {
    id: "gcp-cloudsql", provider: "gcp", label: "Cloud SQL", description: "Managed MySQL, PostgreSQL and SQL Server",
    engines: [
      { kind: "postgres", label: PG, port: 5432, user: "postgres", database: "postgres", tls: "require", auth: ["password", "gcp-iam"] },
      { kind: "mysql", label: MY, port: 3306, user: "root", database: "", tls: "REQUIRED", auth: ["password", "gcp-iam"] },
      { kind: "sqlserver", label: "SQL Server", port: 1433, user: "sqlserver", database: "master", tls: "trust", auth: ["password"] }
    ],
    hostHint: "34.123.45.67, or 127.0.0.1 with the Cloud SQL Auth Proxy",
    notes: "Connect to the instance's public IP (add your network under Authorized networks), or run the Cloud SQL Auth Proxy and connect to 127.0.0.1 with TLS off.",
    docs: "https://cloud.google.com/sql/docs/postgres/connect-auth-proxy"
  },
  {
    id: "gcp-spanner", provider: "gcp", label: "Cloud Spanner", description: "GoogleSQL databases",
    engines: [{ kind: "spanner", label: "Spanner", tls: "", auth: ["adc", "service-account", "key-file", "emulator"] }],
    notes: "Needs the Cloud Spanner Database Reader role to browse, and Database User to edit. For the emulator, set the endpoint to http://localhost:9020.",
    docs: "https://cloud.google.com/spanner/docs/reference/rest"
  },
  {
    id: "gcp-firestore", provider: "gcp", label: "Firestore", description: "Native-mode document databases",
    engines: [{ kind: "firestore", label: "Firestore", tls: "", auth: ["adc", "service-account", "key-file", "emulator"] }],
    notes: "Needs the Cloud Datastore Viewer role to browse, and Cloud Datastore User to edit. For the emulator, set the endpoint to http://localhost:8080.",
    docs: "https://cloud.google.com/firestore/docs/reference/rest"
  },
  {
    id: "gcp-bigquery", provider: "gcp", label: "BigQuery", description: "Datasets, tables and views; query jobs",
    engines: [{ kind: "bigquery", label: "BigQuery", tls: "", auth: ["adc", "service-account", "key-file", "emulator"] }],
    notes: "Queries are billed by bytes scanned. Set Max bytes billed to cap what a single query may cost.",
    docs: "https://cloud.google.com/bigquery/docs/reference/rest"
  },
  {
    id: "gcp-alloydb", provider: "gcp", label: "AlloyDB", description: "PostgreSQL-compatible clusters",
    engines: [{ kind: "postgres", label: `AlloyDB (${PG})`, port: 5432, user: "postgres", database: "postgres", tls: "require", auth: ["password", "gcp-iam"] }],
    hostHint: "10.0.0.5, or 127.0.0.1 with the AlloyDB Auth Proxy",
    notes: "AlloyDB instances have private IPs: connect from inside the VPC, or through the AlloyDB Auth Proxy on 127.0.0.1 with TLS off.",
    docs: "https://cloud.google.com/alloydb/docs/auth-proxy/connect"
  }
];

export function cloudService(id: string | undefined): CloudService | undefined {
  return id ? CLOUD_SERVICES.find(s => s.id === id) : undefined;
}

/** The service whose endpoints a host name belongs to, or that owns the kind outright (DynamoDB, Spanner...). */
export function inferCloudService(spec: Pick<ConnectionSpec, "kind" | "host">): string | undefined {
  const host = String(spec.host ?? "").toLowerCase().split(",")[0];
  for (const service of CLOUD_SERVICES) {
    if (!service.hostPattern || !host) continue;
    if (new RegExp(service.hostPattern, "i").test(host) && service.engines.some(e => e.kind === spec.kind)) return service.id;
  }
  const owners = CLOUD_SERVICES.filter(s => s.engines.length === 1 && s.engines[0].kind === spec.kind);
  return owners.length === 1 ? owners[0].id : undefined;
}

/** The provider of a connection: from its saved service, else from its kind. */
export function providerOf(serviceId: string | undefined, kind: DbKind): CloudProvider | undefined {
  return (cloudService(serviceId) ?? cloudService(inferCloudService({ kind, host: "" })))?.provider;
}

// ---------------------------------------------------------------------------
// Validation helpers shared by the parser and the warnings below.
// ---------------------------------------------------------------------------

/** us-east-1, eu-central-2, us-gov-west-1, cn-north-1, ap-southeast-4... */
export const AWS_REGION = /^[a-z]{2}(-gov|-iso[a-z]?)?-[a-z]+-\d{1,2}$/;
export const AWS_ACCESS_KEY_ID = /^(AKIA|ASIA|AIDA|AROA)[A-Z0-9]{12,124}$/;
/** 6-30 characters, lower case letters, digits and hyphens, starting with a letter; or domain:project. */
export const GCP_PROJECT_ID = /^([a-z][a-z0-9.-]{1,61}:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const SPANNER_ID = /^[a-z][a-z0-9_-]{0,62}[a-z0-9]$/;

/** The AWS region a host name names, e.g. mydb.abc.eu-west-1.rds.amazonaws.com → eu-west-1. */
export function regionFromHost(host: string | undefined): string | undefined {
  const parts = String(host ?? "").toLowerCase().split(".");
  return parts.find(p => AWS_REGION.test(p));
}

const LOCAL = /^(localhost|127\.0\.0\.1|::1|host\.docker\.internal|0\.0\.0\.0)$/i;

/**
 * Advice for a connection to a cloud service, beyond the generic warnings.
 * `serviceId` is what the user picked; the spec is what they typed.
 */
export function cloudWarnings(serviceId: string | undefined, spec: ConnectionSpec): string[] {
  const service = cloudService(serviceId ?? inferCloudService(spec));
  if (!service) return [];
  const out: string[] = [];
  const host = String(spec.host ?? "").toLowerCase();
  const auth = String(spec.options.auth ?? "").toLowerCase();
  if (!service.engines.some(e => e.kind === spec.kind)) {
    out.push(`${service.label} does not offer this kind of database; check the service you picked.`);
    return out;
  }
  if (service.hostPattern && host && !LOCAL.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !new RegExp(service.hostPattern, "i").test(host)) {
    out.push(`This host does not look like a ${service.label} endpoint (e.g. ${service.hostHint}).`);
  }
  if (service.id === "aws-aurora" && /\.cluster-ro-/.test(host)) out.push("This is the Aurora reader endpoint: writes will fail. Turn on Read-only, or use the cluster endpoint.");
  if ((auth === "aws-iam" || auth === "azure-ad" || auth === "gcp-iam") && !spec.ssl && !LOCAL.test(host)) out.push("Token authentication sends the token as the password, so turn TLS on.");
  if (service.id === "gcp-cloudsql" && host && !LOCAL.test(host) && !spec.ssl) out.push("Cloud SQL public IPs should use TLS, or connect through the Cloud SQL Auth Proxy on 127.0.0.1.");
  if (service.id === "gcp-cloudsql" && LOCAL.test(host) && spec.ssl) out.push("The Cloud SQL Auth Proxy already encrypts the connection; turn TLS off for 127.0.0.1.");
  if (service.id === "azure-sql" && !spec.ssl) out.push("Azure SQL Database requires encryption; turn TLS on.");
  if (service.id === "aws-rds" && spec.kind === "oracle" && spec.ssl && spec.port === 1521) out.push("RDS for Oracle listens for TLS on port 2484 (with the SSL option), not 1521.");
  return out;
}
