# Connect a database

1. Open the **Database Client** and choose **New connection**.
2. Paste a connection string, for example:
   - `postgresql://user:password@localhost:5432/app`
   - `mysql://root@127.0.0.1:3306/shop`
   - `mongodb://localhost:27017/app`
   - `redis://localhost:6379/0`
   - `sqlite:///path/to/dev.db` (or click **Browse…**)
3. Click **Test connection**, then **Save & connect**.

Browse databases, schemas and tables; sort, search and filter rows; insert, edit and delete records; and run SQL, `db.users.find(...)` or Redis commands in the query console.

Connection strings are stored in your operating system's keychain. Mark a connection **read-only** to block every write.
