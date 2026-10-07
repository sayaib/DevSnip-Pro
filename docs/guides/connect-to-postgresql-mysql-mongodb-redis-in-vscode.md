# How to connect to PostgreSQL, MySQL, MongoDB and Redis in VS Code

**Short answer:** install a database client extension, paste a connection string, test it, and browse your tables from the sidebar. This guide uses the free **Database Client** in [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console), which supports PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, MongoDB and Redis from one panel.

![DevSnip Pro Database Client in VS Code browsing a PostgreSQL table with pagination and filters](../images/database.jpg)

During development most database work is small and frequent: check that a migration added the column, look at the row your API just wrote, fix a bad test record, or try a query before putting it in code. Doing it in the editor removes the trip to a separate application.

## 1. Connect with a connection string

Run **DevSnip Pro: Database Client** and paste a connection string:

```
postgresql://app:secret@localhost:5432/app_dev
mysql://root:secret@localhost:3306/shop
Server=localhost,1433;Database=crm;User Id=sa;Password=…;TrustServerCertificate=true
sqlite:///Users/me/project/dev.db
mongodb://localhost:27017/app
redis://localhost:6379/0
```

As you type, the panel shows what it detected: the database type, host, database, user, whether TLS is on, and warnings such as TLS being off for a remote host. Press **Test**, then **Save & connect**.

The connection string is stored in your operating system's keychain (VS Code SecretStorage). The password is never displayed again and never appears in error messages.

**Connection problems?** The message says why: connection refused, host not found, authentication failed or TLS. For a local server with a self-signed certificate add `sslmode=no-verify` (PostgreSQL), `TrustServerCertificate=true` (SQL Server) or `tlsAllowInvalidCertificates=true` (MongoDB). SQL Server needs a SQL login; Windows authentication is not supported.

## 2. Browse and edit data safely

- **Browse:** databases, schemas, tables, views, collections or Redis keys, with each table's columns, types, keys and defaults under **Structure**.
- **Find rows:** sort, search across columns, or add filter conditions such as `status = active`. In MongoDB use a filter document such as `{ plan: "pro", seats: { $gt: 5 } }`; in Redis a key pattern such as `session:*`.
- **Edit:** the row editor knows column types, NULL and DEFAULT. MongoDB documents accept Extended JSON (`ObjectId()`, `ISODate()`). Redis keys get an editor per type (strings, hashes, lists, sets, sorted sets) with TTLs.

Safety nets:

- Deleting rows and destructive statements (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `deleteMany`, `FLUSHDB`) ask first.
- Dropping a table asks you to type its name.
- Mark a production connection **read-only**: DevSnip Pro refuses writes, and on PostgreSQL and MySQL the session itself is read-only.
- Tables without a primary key (on MySQL and SQL Server) and views are shown read-only rather than risk changing the wrong row.

## 3. Run queries

![DevSnip Pro database query console in VS Code running a SQL join with results](../images/database-query.jpg)

The query console runs SQL, `db.collection.find({...})` calls, or Redis commands. Press <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> to run the selection or the whole buffer, then copy results as JSON or CSV for a test fixture or a bug report.

Related tools in the **Database** section of the sidebar:

- **SQL Formatter & Linter:** consistent formatting, plus warnings about `SELECT *`, missing `WHERE` and similar mistakes.
- **SQL Query Helper:** parameterised SELECT, INSERT, UPDATE, UPSERT, DELETE and pagination queries.
- **Database Connection Strings:** builds or fixes PostgreSQL, MySQL, MongoDB and Redis URLs, with driver setup.
- **SQL → MongoDB Query:** translates a SQL query into its MongoDB equivalent.

## A development loop that works

1. Keep one saved connection per environment, with a colour (green for local, red for production) and **read-only** on anything shared.
2. After running a migration, open the table's **Structure** to confirm it.
3. After calling an endpoint in the REST API Client, check the row it wrote.
4. Copy query results as JSON straight into a test fixture.

For heavy administration (users and roles, backups, query plans at scale) a dedicated database tool still goes further; for the everyday loop, staying in the editor is faster.

---

**Try it:** [Install DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) (free, no account) or run `code --install-extension sayaib.hue-console`.

Related: [How to test REST APIs in VS Code](test-rest-apis-in-vscode.md) · [Format JSON, decode JWTs and other quick tools](format-json-decode-jwt-in-vscode.md) · [All guides](README.md)
