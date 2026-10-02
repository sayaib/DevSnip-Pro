# VS Code database development tools

During development most database work is small and frequent: check that a migration added the column, look at the row your API just wrote, fix a bad test record, or try a query before putting it in code. A database client inside VS Code removes the trip to a separate application for each of these.

This guide uses the free **Database Client** in [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console). It supports PostgreSQL, MySQL/MariaDB, SQL Server, SQLite, MongoDB and Redis.

## Connect with a connection string

Run **DevSnip Pro: Database Client** and paste a connection string:

```
postgresql://app:secret@localhost:5432/app_dev
mysql://root:secret@localhost:3306/shop
Server=localhost,1433;Database=crm;User Id=sa;Password=…;TrustServerCertificate=true
sqlite:///Users/me/project/dev.db
mongodb://localhost:27017/app
redis://localhost:6379/0
```

As you type, the panel shows what it detected: the database type, host, database, user, whether TLS is on, and warnings such as TLS being off for a remote host. **Test** before saving.

The connection string is stored in your operating system's keychain (VS Code SecretStorage). The password is never displayed again, and never appears in error messages.

## Work with data safely

- **Browse:** databases, schemas, tables, views, collections or Redis keys, with each table's columns, types, keys and defaults under **Structure**.
- **Find rows:** sort, search across columns, or add filter conditions such as `status = active` or `created_at > 2026-01-01`. In MongoDB, use a filter document such as `{ plan: "pro", seats: { $gt: 5 } }`. In Redis, use a key pattern such as `session:*`.
- **Edit:** the row editor knows column types, NULL and DEFAULT. MongoDB documents accept Extended JSON (`ObjectId()`, `ISODate()`).

Safety nets worth knowing:

- Deleting rows and destructive statements (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` without `WHERE`, `deleteMany`, `FLUSHDB`) ask first.
- Dropping a table asks you to type its name.
- Mark a production connection **read-only**: DevSnip Pro refuses writes, and on PostgreSQL and MySQL the session itself is read-only.

## Write and test queries

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
