# Database Client

The Database Client in DevSnip Pro connects to ten kinds of self-hosted databases and to the managed databases of AWS, Azure and Google Cloud, lets you browse and edit their data, and runs queries — inside VS Code, with credentials kept in your operating system's keychain.

Open it from the **Database** section of the DevSnip Pro sidebar, or run **DevSnip Pro: Database Client** from the Command Palette.

- [Supported databases](#supported-databases)
- [Cloud databases](#cloud-databases)
- [Prerequisites](#prerequisites)
- [Connect](#connect)
- [Browse and edit data](#browse-and-edit-data)
- [Query console](#query-console)
- [Security](#security)
- [Limits](#limits)
- [Large tables](#large-tables)
- [Troubleshooting](#troubleshooting)
- [Test it locally](#test-it-locally)
- [Add a database (for contributors)](#add-a-database-for-contributors)

## Supported databases

The self-hosted databases below are covered by end-to-end tests against a real server (see [Test it locally](#test-it-locally)); the "tested with" column lists the versions those tests ran against. The cloud services are covered by tests against mock APIs; see [Cloud databases](#cloud-databases).

| Database | Driver (bundled) | Tested with | Edit rows | Indexes | Cancel queries | Server-side read-only |
| :-- | :-- | :-- | :-: | :-: | :-: | :-: |
| PostgreSQL | `pg` | 16 | ✓ | ✓ | ✓ | ✓ |
| CockroachDB | `pg` | v24.3 | ✓ | ✓ | ✓ | ✓ |
| MySQL | `mysql2` | 8.4 | ✓ | ✓ | ✓ | ✓ |
| MariaDB | `mysql2` | 11.4 | ✓ | ✓ | ✓ | ✓ |
| SQL Server | `mssql` (tedious) | 2022 | ✓ | ✓ | ✓ | — |
| Oracle Database | `oracledb` (Thin mode) | 23ai Free | ✓ | ✓ | ✓ | ✓ |
| SQLite | `node:sqlite` on a worker thread, or `sql.js` on older Node | 3.x | ✓ | ✓ | ✓ (not on `sql.js`) | ✓ |
| ClickHouse | HTTP interface (no driver) | 24.8 | insert only | ✓ | ✓ | ✓ |
| MongoDB | `mongodb` | 7.0 | ✓ | ✓ | ✓ (`find`, `aggregate`) | — |
| Redis / Valkey | `ioredis` | 7.4 | ✓ | — | — | — |
| Amazon Redshift | `pg` | not yet live-tested | ✓ (tables with a primary key) | — | ✓ | — |
| Amazon DynamoDB | DynamoDB API (SigV4) | mock API | ✓ | ✓ (keys, GSIs, LSIs) | — | — |
| Azure Cosmos DB (NoSQL) | REST API | mock API | ✓ | ✓ (indexing policy) | — | — |
| Cloud Spanner | REST API | mock API | ✓ | ✓ | — | — |
| Firestore | REST API | mock API | ✓ | — | — | — |
| BigQuery | REST API | mock API | — (console DML only) | — | ✓ | — |

What the columns mean:

- **Edit rows** — insert, edit and delete rows, documents or keys from the data grid.
- **Indexes** — the Structure view lists the table's indexes.
- **Cancel queries** — a running console query can be stopped on the server.
- **Server-side read-only** — a connection marked read-only is also read-only in the server session, so a write hidden in a function or procedure call still fails. Where there is no ✓, read-only connections are protected by DevSnip Pro's statement check only.

Notes per database:

- **CockroachDB** — `postgresql://` URLs pointing at CockroachDB work too; the client recognises it from the server version. Tables without a primary key are edited through CockroachDB's hidden `rowid`.
- **MariaDB** — `mariadb://` connections were saved as "MySQL" by earlier versions. They are relabelled the next time they connect.
- **SQL Server** — SQL Server logins only. Windows (integrated) authentication is not supported.
- **Oracle** — Oracle Database 12.1 or later. Thin mode is pure JavaScript, so no Oracle Instant Client is needed. Wallets, Kerberos and LDAP naming are not supported; connect with a user and password.
- **SQLite** — queries run on a worker thread, so a long one never freezes VS Code, stops after 30 seconds, and can be cancelled. VS Code builds without `node:sqlite` (Node older than 22.5) fall back to `sql.js`, which copies the file into memory: it opens files up to 512 MB and cannot cancel. `:memory:` databases cannot be opened from another process.
- **ClickHouse** — uses the HTTP interface (port 8123, or 8443 with TLS), not the native protocol (port 9000). ClickHouse rows have no unique key, so the grid can insert rows but not edit or delete them; use `ALTER TABLE … UPDATE` or `ALTER TABLE … DELETE` in a query tab.
- **MongoDB** — cancelling stops `find` and `aggregate` cursors on the server. Other commands stop waiting at once and finish within the 30-second server time limit.
- **Redis** — Valkey and other Redis-compatible servers work too. Commands that block, subscribe or change the connection (`SUBSCRIBE`, `MONITOR`, `SELECT`, `MULTI`, …) are not available in the console.

## Cloud databases

In the **New connection** dialog, pick where the database runs — **Self-hosted**, **AWS**, **Azure** or **Google Cloud** — then the service. The explorer groups saved connections the same way.

| Provider | Service | Connects through | Authentication |
| :-- | :-- | :-- | :-- |
| AWS | Amazon RDS (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle) | the engine's driver | password; IAM database authentication (PostgreSQL, MySQL, MariaDB) |
| AWS | Amazon Aurora (PostgreSQL, MySQL) | the engine's driver | password; IAM database authentication |
| AWS | Amazon DynamoDB | the DynamoDB API, signed with SigV4 | access key (and session token); a profile in `~/.aws`; environment; DynamoDB Local |
| AWS | Amazon Redshift (provisioned and Serverless) | `pg`, with Redshift's catalog queries | password |
| Azure | Azure SQL Database | `mssql` | SQL login; Microsoft Entra ID through `az login` |
| Azure | Azure Cosmos DB | NoSQL API over REST; the MongoDB API through `mongodb` | account key; emulator |
| Azure | Azure Database for PostgreSQL / MySQL (Flexible Server) | the engine's driver | password; Microsoft Entra ID through `az login` |
| Google Cloud | Cloud SQL (PostgreSQL, MySQL, SQL Server) | the engine's driver | password; IAM database authentication (PostgreSQL, MySQL) |
| Google Cloud | AlloyDB | `pg` | password; IAM database authentication |
| Google Cloud | Cloud Spanner (GoogleSQL) | the Spanner REST API | Application Default Credentials; a pasted service account key; a key file; emulator |
| Google Cloud | Firestore (Native mode) | the Firestore REST API | as Spanner |
| Google Cloud | BigQuery | the BigQuery REST API | as Spanner |

Services that speak an engine's protocol reuse that engine's driver with the service's defaults: the usual port, TLS on, the endpoint format as a hint, and warnings for common mistakes (an Aurora reader endpoint, Azure SQL without encryption, TLS through the Cloud SQL Auth Proxy). DynamoDB, Cosmos DB, Spanner, Firestore and BigQuery are reached over HTTPS without an SDK, so nothing extra is installed and nothing loads until you connect.

**Credentials.** Passwords, account keys, secret access keys and session tokens live in the connection string, which is kept in VS Code SecretStorage and shown masked (`********`). A pasted Google service account key gets a SecretStorage entry of its own; it is deleted when the connection stops using it or is removed, and only its account email is ever shown. Key files are read from disk at each connect; only their path is saved. Tokens for IAM / Entra ID authentication are made at connect time (an RDS token lasts 15 minutes, so sessions reconnect every 10 minutes) and are redacted from errors.

**Signing in with provider tools.** IAM authentication for RDS and Aurora uses your AWS credentials (the named profile, `AWS_ACCESS_KEY_ID` and friends, or the default profile); SSO and role profiles are resolved through the AWS CLI (`aws configure export-credentials`). Entra ID uses the Azure CLI's signed-in account (`az account get-access-token`). Google services use Application Default Credentials (`gcloud auth application-default login`), then `gcloud auth print-access-token`.

Connection string forms:

| Service | Example |
| :-- | :-- |
| Amazon RDS / Aurora | `postgresql://postgres:password@mydb.abc123xyz789.us-east-1.rds.amazonaws.com:5432/postgres?sslmode=require` |
| RDS with IAM | `postgresql://app_user@mydb.abc123xyz789.us-east-1.rds.amazonaws.com/app?sslmode=require&auth=aws-iam&profile=dev` |
| Amazon Redshift | `redshift://awsuser:password@examplecluster.abc123xyz789.us-west-2.redshift.amazonaws.com:5439/dev` |
| DynamoDB | `dynamodb://AKIA…:SECRET@us-east-1`, `dynamodb://us-east-1?profile=dev`, `dynamodb://localhost:8000` |
| Azure SQL with Entra ID | `Server=tcp:myserver.database.windows.net,1433;Database=app;User Id=me@contoso.com;Encrypt=true;auth=azure-ad` |
| Cosmos DB (NoSQL) | `AccountEndpoint=https://myaccount.documents.azure.com:443/;AccountKey=…;Database=app;` |
| Cosmos DB (MongoDB API) | `mongodb://myaccount:KEY@myaccount.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false` |
| Cloud SQL through the Auth Proxy | `postgresql://postgres:password@127.0.0.1:5432/postgres` |
| Cloud SQL with IAM | `postgresql://me%40example.com@34.123.45.67/app?sslmode=require&auth=gcp-iam` |
| Cloud Spanner | `spanner://my-project/my-instance/my-database`, `jdbc:cloudspanner:/projects/p/instances/i/databases/d` |
| Firestore | `firestore://my-project` (or `firestore://my-project/other-db`) |
| BigQuery | `bigquery://my-project/default_dataset?location=EU&maxbytesbilled=1000000000` |
| Emulators | add `?endpoint=http://localhost:9020` (Spanner), `:8080` (Firestore), `:9050` (BigQuery) |

How the API services browse:

- **DynamoDB** — the region is the database; tables page through PartiQL `SELECT`s with continuation tokens, so there is no total count (the footer shows DynamoDB's own estimate) and no sorting. The filter box takes a PartiQL condition. Items are JSON; sets, binary and numbers beyond double precision use markers such as `{"$SS": [...]}` so they survive an edit. Inserts never overwrite and saves never recreate a deleted item. The console runs PartiQL.
- **Cosmos DB** — databases and containers; the filter box takes a `WHERE` condition on `c`. Queries run per physical partition so `ORDER BY` and `OFFSET`/`LIMIT` work; edits address the document's partition key. The console runs SQL queries and picks the container from the name after `FROM`. Queries cost request units.
- **Spanner** — GoogleSQL databases browse and edit like any SQL database; DML commits right away; `CREATE`/`ALTER`/`DROP` run as schema operations. PostgreSQL-dialect databases work in the console only.
- **Firestore** — root collections; a subcollection opens from the console (`SELECT * FROM users/alice/orders`). Filters cover equality, comparisons, `IN`, null checks and *starts with*; there is no text search. Timestamps, references and whole doubles keep their type through edits.
- **BigQuery** — the project's datasets and tables, read-only in the grid. An unfiltered table pages with `tabledata.list`, which costs nothing; filters, sorting, views and the console run query jobs, and the result says how many bytes were scanned. Set **Max bytes billed** to cap a single query. Running queries can be cancelled.

The cloud paths are covered by unit tests against local mock APIs (`database-cloud.unit.ts`): request signing (including AWS's published SigV4 test vector), paging, writes and error handling. They have not been run against live cloud accounts or the Docker emulators yet.

## Prerequisites

- VS Code 1.93 or later. Every driver ships with the extension; nothing else needs to be installed.
- Network access from your machine to the database (VPN, firewall and security-group rules apply as usual).
- A database user. For browsing, a read-only user is enough — see [Use a least-privilege user](#use-a-least-privilege-user).

## Connect

Click **+** in the Connections panel (or a database card on the welcome page). The dialog has two modes that stay in sync:

- **Form** — choose the database type and fill in host, port, user, password, database (the *service name* for Oracle, the *database number* for Redis), TLS and optional driver options.
- **Connection string** — paste a URL. `DATABASE_URL=…` lines, quoted strings and `jdbc:` URLs are accepted.

As you type, the dialog shows what it detected (type, host, database, user, whether a password and TLS are set) and warns about risky settings, such as TLS being off for a remote host. **Test connection** opens a throwaway connection and reports the server version and round-trip time. **Save & connect** stores the connection and opens it in the explorer.

Mark a connection **Read-only** to block every write — see [Read-only connections](#read-only-connections).

### Connection string examples

| Database | Example |
| :-- | :-- |
| PostgreSQL | `postgresql://user:password@localhost:5432/app` |
| PostgreSQL with TLS | `postgresql://user:password@db.example.com:5432/app?sslmode=verify-full&sslrootcert=/path/ca.pem` |
| CockroachDB (local, insecure) | `cockroachdb://root@localhost:26257/defaultdb?sslmode=disable` |
| CockroachDB (client certificates) | `cockroachdb://maxroach@host:26257/bank?sslmode=verify-full&sslrootcert=certs/ca.crt&sslcert=certs/client.maxroach.crt&sslkey=certs/client.maxroach.key` |
| MySQL | `mysql://user:password@localhost:3306/app` |
| MySQL with TLS | `mysql://user:password@db.example.com:3306/app?ssl-mode=VERIFY_IDENTITY` |
| MariaDB | `mariadb://user:password@localhost:3306/app` |
| SQL Server | `Server=localhost,1433;Database=app;User Id=sa;Password=secret;Encrypt=false` |
| SQL Server (Azure) | `Server=tcp:myserver.database.windows.net,1433;Database=app;User Id=me;Password=…;Encrypt=true` |
| SQL Server (URL form) | `sqlserver://user:password@localhost:1433/app?encrypt=false` |
| Oracle (service name) | `oracle://user:password@localhost:1521/FREEPDB1` |
| Oracle (SID) | `oracle://user:password@localhost:1521/?sid=XE` |
| Oracle (TCPS) | `oracle://user:password@db.example.com:2484/ORCLPDB1?ssl=true` |
| Oracle (JDBC) | `jdbc:oracle:thin:user/password@//localhost:1521/FREEPDB1` |
| Oracle (descriptor) | `jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=svc)))` |
| SQLite | `sqlite:///Users/me/project/dev.db` (or **Browse…**); relative paths resolve against the first workspace folder |
| ClickHouse | `clickhouse://default:password@localhost:8123/default` |
| ClickHouse Cloud | `clickhouse://default:password@abc123.clickhouse.cloud/default?secure=true` |
| MongoDB | `mongodb://user:password@localhost:27017/app?authSource=admin` |
| MongoDB Atlas | `mongodb+srv://user:password@cluster0.abcde.mongodb.net/app` |
| Redis | `redis://:password@localhost:6379/0` (or `redis://user:password@…` with ACL users) |
| Redis with TLS | `rediss://:password@cache.example.com:6380/0` |

Passwords with special characters must be percent-encoded in URLs (`@` → `%40`, `:` → `%3A`). The Form mode does that for you.

### Authentication and TLS

| Database | Authentication | TLS |
| :-- | :-- | :-- |
| PostgreSQL, CockroachDB | Password; client certificates with `sslcert` and `sslkey` | `sslmode=require` encrypts; `verify-ca` / `verify-full` also check the certificate (add `sslrootcert` for a private CA) |
| MySQL, MariaDB | Password | `ssl-mode=REQUIRED` encrypts; `VERIFY_IDENTITY` also checks the certificate; `ssl={json}` passes driver TLS options |
| SQL Server | SQL Server login | `Encrypt=true` (on by default for remote hosts); `TrustServerCertificate=true` for self-signed certificates |
| Oracle | User and password | `?ssl=true` or `tcps://` connects over TCPS and verifies the server certificate |
| ClickHouse | User and password (sent in headers, never in the URL) | `?secure=true` uses HTTPS and verifies the certificate |
| MongoDB | Any mechanism the URL names (`authSource`, `authMechanism`) | `tls=true`; `mongodb+srv://` always uses TLS; `tlsAllowInvalidCertificates=true` for self-signed certificates |
| Redis | Password, or ACL user and password | `rediss://`; `?skip_verify=true` for self-signed certificates |

## Browse and edit data

The **explorer** lists connections with a status dot (grey: not connected, amber: connecting, green: connected, red: failed). Expand a connection to see its databases, schemas (PostgreSQL, CockroachDB, SQL Server, Oracle), tables, views and collections, with row estimates. Redis shows one entry per database with its key count. Type in **Filter tables and collections** to narrow the tree, and right-click any item for its actions.

Click a table to open it in a **data tab**:

- **Sort** by clicking a column header (ascending, descending, off). **Resize** a column by dragging its right edge; double-click the edge to reset it.
- **Search** looks in every text-like column. **Filter** builds conditions (`=`, `≠`, `>`, `contains`, `starts with`, `is null`, `in list`, …) that are always sent as bound parameters.
- MongoDB tabs also take a filter document such as `{ status: "active", age: { $gt: 21 } }`; Redis tabs take a key pattern such as `user:*` and a type.
- **Pagination** loads 25 to 500 rows at a time; the footer shows the total and the server round-trip time.
- **Structure** shows the columns (type, nullable, default, primary key, auto-increment, read-only) and the indexes.

### Insert, edit and delete

- **Insert row** opens a form with one field per column. Each field can be a **value**, **NULL** or **DEFAULT**; auto-increment and defaulted columns start as DEFAULT. Values are checked against the column type before anything is sent (numbers, booleans, JSON).
- **Edit** a row by double-clicking it (or with its pencil button). Only the fields you change are written.
- **Delete** the selected rows with **Delete (n)**. You are asked to confirm first.
- **Duplicate row** (right-click a cell) opens the editor pre-filled, without the key.
- MongoDB documents are edited as Extended JSON; shell helpers such as `ObjectId("…")`, `ISODate("…")` and `NumberLong(…)` are accepted. Redis keys get an editor for every type (string, hash, list, set, sorted set, JSON) with a TTL.

How rows are identified for an update or delete:

| Table | Rows are matched by |
| :-- | :-- |
| With a primary key | The primary key |
| Without a primary key: PostgreSQL | `ctid` (re-read after every save, because an update moves the row) |
| Without a primary key: Oracle | `ROWID` |
| Without a primary key: CockroachDB | The hidden `rowid` column |
| Without a primary key: SQLite | `rowid` (unless the table is `WITHOUT ROWID`) |
| Without a primary key: MySQL, MariaDB, SQL Server | Not editable — rows can still be inserted; add a primary key, or use the query console |
| ClickHouse | Not editable — rows can be inserted |
| Views | Read-only |

**Empty table…** (`TRUNCATE`, or `DELETE` on SQLite) and **Drop table…** ask you to type the table's name to confirm.

## Query console

Open a query tab with the terminal icon next to a connection, database or table, or with **+** in the tab bar. Pick the connection, database and — for PostgreSQL, CockroachDB and Oracle — the schema at the top.

- <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs the selection, or everything when nothing is selected.
- **Format** (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd>) re-lays out SQL; string literals, quoted names and comments are kept exactly. PL/SQL blocks are not reformatted.
- The editor highlights SQL, mongosh commands and Redis commands, and numbers its lines.
- When the server reports where an error is, that spot is underlined, the line number turns red, and **Go to error** selects it.
- **Cancel** stops a running query on the server (where supported — see the table at the top). The timer shows how long it has been running.
- Results show up to 1,000 rows. **Sort** and **filter** them in place, resize columns, and copy them as JSON or CSV, or open them in an editor.
- **History** keeps your last 30 queries per connection.

How each database runs a script with several statements:

| Database | Behaviour |
| :-- | :-- |
| PostgreSQL, CockroachDB | One round trip; the last result set is shown. A single `SELECT` is read through a cursor, so a huge result never reaches memory. |
| MySQL, MariaDB | Statements run one after another on the same session (`SET`, variables and temporary tables carry over). |
| SQL Server | One batch on a dedicated connection. Pick the database from the selector instead of `USE`. |
| Oracle | Statements split on `;`. A PL/SQL block (`BEGIN`, `DECLARE`, `CREATE PROCEDURE`, …) runs as one unit to the end of the text, or up to a line holding only `/`. `DBMS_OUTPUT` lines are shown under the result. |
| SQLite | All statements run in order. |
| ClickHouse | Statements run one after another. |
| MongoDB | One command, e.g. `db.users.find({ active: true }).sort({ createdAt: -1 }).limit(20)` |
| Redis | One command per line, up to 50. |

Examples:

```sql
-- PostgreSQL: the 10 biggest customers this year
SELECT c.name, sum(o.total) AS revenue
FROM customers c JOIN orders o ON o.customer_id = c.id
WHERE o.created_at >= date_trunc('year', now())
GROUP BY c.name
ORDER BY revenue DESC
LIMIT 10;
```

```sql
-- Oracle: a PL/SQL block with output, then a query
BEGIN
  FOR r IN (SELECT table_name FROM user_tables) LOOP
    DBMS_OUTPUT.PUT_LINE(r.table_name);
  END LOOP;
END;
/
SELECT COUNT(*) FROM user_tables
```

```sql
-- ClickHouse: change rows with a mutation (the grid cannot edit ClickHouse rows)
ALTER TABLE events UPDATE kind = 'purchase' WHERE kind = 'buy';
```

```js
// MongoDB
db.orders.aggregate([{ $match: { status: "paid" } }, { $group: { _id: "$customerId", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }])
db.users.updateOne({ email: "ann@example.com" }, { $set: { plan: "pro" } })
```

```text
# Redis
HGETALL user:42
EXPIRE session:abc 3600
```

Statements that destroy data ask for confirmation before they run: `DROP`, `TRUNCATE`, `ALTER … DROP`, `ALTER … DELETE`, `DELETE` and `UPDATE` (with an extra warning when there is no `WHERE`), PL/SQL blocks containing `DELETE`, `DROP` or `TRUNCATE`, MongoDB `drop`, `deleteMany` and `dropDatabase`, and Redis `FLUSHALL`, `FLUSHDB`, `DEL`, `CONFIG SET` and similar.

## Security

### Credentials

- The full connection string, including the password, is stored only in VS Code's **SecretStorage**, which uses the operating system keychain (Keychain on macOS, Credential Manager on Windows, libsecret on Linux). Settings hold only the name, type, flags and a copy with the password replaced by `********`.
- The webview never receives a password back. When you edit a connection, the password appears as `********` (or "Saved password" in the form); leaving it unchanged keeps the stored one.
- Every error is redacted before it is shown: the password, its URL-encoded form and the full connection string are removed, and credentials in any echoed URL or `Password=` pair are masked.
- ClickHouse credentials are sent in HTTP headers, not in the URL.

### Queries

- Everything the data grid and the row editor send is a **bound parameter**. Table and column names are quoted, and only names that came back from the database's own catalog are ever used.
- The webview is treated as untrusted input: the extension validates every request again (sizes, operators, key columns) and re-reads table metadata itself before any write.
- Destructive actions need a native VS Code confirmation; dropping or emptying a table needs its name typed.

### Read-only connections

A connection marked **Read-only** refuses inserts, updates, deletes and drops in the grid, and every console statement that writes. On these databases the server session is read-only as well, so a write hidden in a function or procedure call still fails:

| Database | How the server enforces it |
| :-- | :-- |
| PostgreSQL, CockroachDB | `default_transaction_read_only=on` for the session |
| MySQL, MariaDB | `SET SESSION TRANSACTION READ ONLY` |
| Oracle | Console statements run in a `SET TRANSACTION READ ONLY` transaction |
| SQLite | The file is opened read-only |
| ClickHouse | Every request runs with `readonly=2` |

SQL Server, MongoDB and Redis rely on the statement check alone, so also use a read-only database user there.

### Use a least-privilege user

Connect with the smallest set of rights you need. For browsing and reading:

```sql
-- PostgreSQL / CockroachDB
CREATE ROLE devsnip_reader LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE app TO devsnip_reader;
GRANT USAGE ON SCHEMA public TO devsnip_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO devsnip_reader;

-- MySQL / MariaDB
CREATE USER 'devsnip_reader'@'%' IDENTIFIED BY '…';
GRANT SELECT, SHOW VIEW ON app.* TO 'devsnip_reader'@'%';

-- SQL Server
CREATE LOGIN devsnip_reader WITH PASSWORD = '…';
CREATE USER devsnip_reader FOR LOGIN devsnip_reader;
ALTER ROLE db_datareader ADD MEMBER devsnip_reader;

-- Oracle
CREATE USER devsnip_reader IDENTIFIED BY "…";
GRANT CREATE SESSION TO devsnip_reader;
GRANT SELECT ON app.employees TO devsnip_reader;

-- ClickHouse
CREATE USER devsnip_reader IDENTIFIED BY '…' SETTINGS readonly = 1;
GRANT SELECT ON app.* TO devsnip_reader;
```

For MongoDB, use the built-in `read` role; for Redis, an ACL user such as `ACL SETUSER reader on >… ~* +@read`.

Other recommendations:

- Keep TLS on for anything that is not on your machine; the dialog warns when it is off for a remote host.
- Prefer certificate verification (`verify-full`, `VERIFY_IDENTITY`, `Encrypt=true` without `TrustServerCertificate`) outside local development.
- Mark production connections **Read-only**, and give them a colour (red) so they stand out in the explorer and the tab bar.

## Limits

| Limit | Value |
| :-- | :-- |
| Connect timeout | 10 seconds |
| Query timeout | 30 seconds (enforced by the server where it supports one) |
| Rows per page in the grid | 500 (only the rows in view are drawn) |
| Rows shown in the console | 1,000 (the rest is never fetched; only the rows in view are drawn) |
| Table size shown as an estimate | 1,000,000 rows and up, unfiltered (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle) |
| Searches not counted automatically | on tables of 100,000 rows and up |
| SQLite file size with `sql.js` | 512 MB |
| Redis keys scanned per page | 10,000 |
| MongoDB documents sampled to infer fields | 200 |
| Saved connections | 100 |

## Large tables

The client is built to stay responsive on tables with millions of rows:

- **Bounded fetching.** The grid reads one page with `LIMIT`/`OFFSET` (or `OFFSET … FETCH`); the console stops reading after 1,000 rows, through a server cursor or stream where the driver has one. Nothing loads a whole table.
- **Counting.** A page's total is counted once and reused for the next pages of the same filter (for 30 seconds, or until you change data). An unfiltered table of a million rows or more shows the estimate the database keeps in its statistics ("about 12,400,000 rows") instead of running `COUNT(*)`; **Count rows** in the footer counts exactly. A text search of a large table is not counted at all, because it cannot use an index and counting would scan the table a second time: the grid shows whether another page follows.
- **Searching.** On tables of 100,000 rows and up, the search box runs when you press Enter rather than as you type.
- **Time limits.** Grid and console queries stop on the server after 30 seconds: PostgreSQL `statement_timeout`, MySQL `max_execution_time`, MariaDB `max_statement_time`, SQL Server and Oracle call timeouts, ClickHouse `max_execution_time`, and SQLite by stopping its worker thread.
- **Rendering.** Pages and results over 120 rows draw only the rows in view, so a 1,000-row result costs about as much as a 60-row one.

What stays slow on very large tables is what the database itself has to scan: a jump to a deep page (`OFFSET` reads and skips every row before it), sorting by a column without an index, and searching across all columns. Filter or sort by indexed columns to reach rows deep in a table.

`scripts/db-benchmark.js` measures these paths on generated SQLite tables of any size (`node --expose-gc scripts/db-benchmark.js 100000 1000000 10000000` after `npm run compile`).

## Troubleshooting

| Message | What to check |
| :-- | :-- |
| **Connection refused** | The server is not running, or not listening on that host and port. For Docker, check the published port (`-p 5432:5432`). |
| **The database host could not be found** | The host name, VPN and DNS. |
| **Timed out** | Firewalls and security groups; for cloud databases, whether your IP is allowed. |
| **Authentication failed** | User and password. MongoDB: `authSource` (often `admin`). Oracle: an expired password shows its own message. |
| **TLS certificate problem** | Self-signed certificates: `sslmode=no-verify` (PostgreSQL), `TrustServerCertificate=true` (SQL Server), `tlsAllowInvalidCertificates=true` (MongoDB), `?skip_verify=true` (Redis). Better: point at your CA with `sslrootcert` (PostgreSQL, CockroachDB). |
| **The server does not support SSL** / **requires SSL** | Turn TLS on or off to match the server (`sslmode=require` or `sslmode=disable`). |
| **ORA-12514 / listener does not know that service** | The Oracle service name after the port (e.g. `/FREEPDB1`, `/ORCLPDB1`). For SID-only databases use `?sid=XE`. |
| **ORA-00942 / ORA-00904** | Oracle stores unquoted names in upper case: `SELECT * FROM employees` reads `EMPLOYEES`; a table created as `"employees"` must be quoted. |
| **Port 9000 is ClickHouse's native protocol** | Use the HTTP port, 8123 (or 8443 with `?secure=true`). |
| **Windows authentication is not supported** | Use a SQL Server login (`User Id=…;Password=…`). |
| **This table has no primary key** | MySQL, MariaDB and SQL Server rows without a key cannot be identified safely. Add a primary key, or change rows in the query console. |
| **No row was updated** | Someone else changed or deleted the row. Refresh and try again. |
| **The connection was lost** | The server closed it (restart, idle timeout, network). Click **Reconnect**; the next action also reconnects automatically. |
| **This connection is read-only** | Edit the connection and clear **Read-only**. |

## Test it locally

### Unit tests (no database needed)

```bash
npm run compile
npm run lint
npm run test:unit
```

These cover connection-string parsing, masking and redaction, the SQL generated for every dialect, the Oracle script splitter, error positions, cancellation, the service's safety rules, and SQLite end to end (on both `node:sqlite` and `sql.js`).

### Live tests against real servers

`src/test/unit/database-live.unit.ts` runs the same checks against real servers: connect, browse, filter, insert, edit and delete, tables without keys, views, indexes, error positions, a cancelled query, a 1,500-row result capped at 1,000, read-only enforcement on the server, a wrong password, and an unreachable port. Each suite is skipped unless its URL is set, and it cleans up the `devsnip_test_*` objects it creates.

Start the servers with Docker (ports chosen to avoid clashing with local installs):

```bash
docker run -d --name dsx-pg -e POSTGRES_PASSWORD=pgpass -e POSTGRES_DB=app -p 55432:5432 postgres:16-alpine
docker run -d --name dsx-crdb -p 56257:26257 cockroachdb/cockroach:latest-v24.3 start-single-node --insecure
docker run -d --name dsx-my -e MYSQL_ROOT_PASSWORD=mypass -e MYSQL_DATABASE=app -p 53306:3306 mysql:8.4
docker run -d --name dsx-maria -e MARIADB_ROOT_PASSWORD=mariapass -e MARIADB_DATABASE=app -p 53307:3306 mariadb:11.4
docker run -d --name dsx-mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=Sql_Pass_1234 -p 51433:1433 mcr.microsoft.com/mssql/server:2022-latest
docker run -d --name dsx-ora -e ORACLE_PASSWORD=OraPass_1 -e APP_USER=app -e APP_USER_PASSWORD=AppPass_1 -p 51521:1521 gvenzl/oracle-free:23-slim
docker run -d --name dsx-ch -e CLICKHOUSE_USER=chuser -e CLICKHOUSE_PASSWORD=chpass -e CLICKHOUSE_DB=app -p 58123:8123 clickhouse/clickhouse-server:24.8-alpine
docker run -d --name dsx-mongo -p 57017:27017 mongo:7
docker run -d --name dsx-redis -p 56379:6379 redis:7-alpine
```

Then create the databases the containers don't create themselves, and run the tests:

```bash
docker exec dsx-crdb ./cockroach sql --insecure -e "CREATE DATABASE IF NOT EXISTS app"
docker exec dsx-mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P Sql_Pass_1234 -Q "CREATE DATABASE app"
```

```bash
DEVSNIP_TEST_POSTGRES_URL=postgresql://postgres:pgpass@localhost:55432/app \
DEVSNIP_TEST_COCKROACHDB_URL='cockroachdb://root@localhost:56257/app?sslmode=disable' \
DEVSNIP_TEST_MYSQL_URL=mysql://root:mypass@127.0.0.1:53306/app \
DEVSNIP_TEST_MARIADB_URL=mariadb://root:mariapass@127.0.0.1:53307/app \
DEVSNIP_TEST_SQLSERVER_URL='Server=localhost,51433;Database=app;User Id=sa;Password=Sql_Pass_1234;Encrypt=false' \
DEVSNIP_TEST_ORACLE_URL=oracle://app:AppPass_1@localhost:51521/FREEPDB1 \
DEVSNIP_TEST_CLICKHOUSE_URL=clickhouse://chuser:chpass@localhost:58123/app \
DEVSNIP_TEST_MONGODB_URL=mongodb://127.0.0.1:57017/app \
DEVSNIP_TEST_REDIS_URL=redis://localhost:56379/15 \
npm run test:unit
```

The Oracle container takes a minute or two to start; wait for `DATABASE IS READY TO USE!` in `docker logs dsx-ora`. SQL Server and Oracle each need about 2 GB of memory, so on a small Docker VM run them one at a time.

### In VS Code

Press <kbd>F5</kbd> to start an Extension Development Host, open **DevSnip Pro: Database Client**, and connect to any of the containers above. `npm test` runs the integration tests inside VS Code, including one that opens the Database Client panel.

## Add a database (for contributors)

The client is split so that a new database touches as little as possible:

| File | Role |
| :-- | :-- |
| `src/database/types.ts` | `DbKind`, the per-kind metadata and capability list (`DB_KINDS`), and the `DbAdapter` contract |
| `src/database/connection-string.ts` | Detecting, parsing, masking and redacting connection strings; mapping driver errors to messages |
| `src/database/sql-builder.ts` | Dialect-aware SQL for the grid and the row editor (quoting, placeholders, paging, search, keys) |
| `src/database/adapters/*.ts` | One adapter per database; SQL adapters extend `sql-base.ts`, which does metadata caching, paging and CRUD |
| `src/database/service.ts` | The single validated entry point for the webview: sessions, safety rules, confirmations, cancellation |
| `media/db-client.js`, `src/database/page.ts` | The webview UI and its styles |

To add a database:

1. Add the kind to `DbKind` and `DB_KINDS` (label, family, driver, default port, example, features, notes).
2. Teach `connection-string.ts` its scheme, and map its common errors in `friendlyError`.
3. Write an adapter. A SQL database usually extends `SqlAdapter` and implements `connect`, `exec`, `introspect`, `listDatabases`, `listSchemas`, `listObjects`, `runQuery` (registering a cancel hook on the `RunControl`) and `indexes`; add a dialect to `sql-builder.ts` if its SQL differs.
4. Register it in `adapters/index.ts`, and give it an abbreviation and colour in `media/db-client.js` (a test checks both).
5. Add unit tests and a live suite, and list it here only once those pass against a real server.
