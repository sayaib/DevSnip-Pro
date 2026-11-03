# Database Client performance and stability audit — 3 November 2026

Audited the Database Client (host service, all adapters, and the `media/db-client.js` webview) for behavior on tables with millions of rows: blocking work, unbounded memory, redundant queries, query lifecycle, and rendering cost. Every issue below was fixed unless it is listed under remaining limitations.

Measurements ran on an 8-core Apple Silicon Mac with 16 GB RAM, Node 22.17, against generated SQLite tables of 100,000, 1,000,000 and 10,000,000 rows (10 columns, 1.57 GB at 10M). Docker was not running, so the server engines were not benchmarked live; their changes are covered by unit tests.

## Already sound

- Console results are bounded on every engine: PostgreSQL reads through a server cursor, MySQL and SQL Server stream and stop after 1,000 rows, Oracle uses `maxRows`, ClickHouse stops reading the response, MongoDB closes the cursor. The grid always reads one page with `LIMIT`/`OFFSET` or `OFFSET … FETCH`.
- Pools have error handlers, sessions close on dispose and on lost connections, and cancelled console runs are cleaned up.
- Server-side time limits already existed for PostgreSQL (`statement_timeout`), SQL Server (request timeout), Oracle (`callTimeout`), ClickHouse (`max_execution_time`) and MongoDB (`maxTimeMS`).

## Issues found and fixed

| # | Issue | Impact | Fix |
| :-- | :-- | :-- | :-- |
| 1 | SQLite ran synchronously on the extension host (`node:sqlite`). | A search of 10M rows froze all of VS Code for 6.6 s; a full scan for 11.9 s. | SQLite runs on a worker thread (`sqlite-worker.ts`); the console has its own worker. |
| 2 | SQLite queries had no time limit and could not be cancelled. | A runaway query ran until it finished. | The worker is stopped after 30 s or on Cancel; SQLite rolls back an unfinished write. SQLite now reports Cancel queries ✓. |
| 3 | The `sql.js` fallback copies the whole file into WebAssembly memory. | A multi-GB file crashed or exhausted memory. | Files over 512 MB are refused with a clear message. |
| 4 | Every page turn re-ran `COUNT(*)` (all SQL engines) or `countDocuments` (MongoDB). | A full scan per page on PostgreSQL/InnoDB. | Counts are cached per query for 30 s and cleared on every write. |
| 5 | Unfiltered huge tables were counted exactly on first open. | Seconds per open on PostgreSQL/MySQL with millions of rows. | Tables of 1M+ rows show the statistics estimate (PostgreSQL `reltuples`, MySQL `TABLE_ROWS`, SQL Server partitions, Oracle `NUM_ROWS`), labelled "about"; **Count rows** counts exactly. |
| 6 | A text search on a large table counted its matches. | A second full scan (search cannot use an index). | Searches of 100K+ row tables are not counted; the grid pages by "has more", and **Count rows** is available. |
| 7 | Search ran on every typing pause. | A full scan per pause on large tables, queued behind each other. | On 100K+ row tables search runs on Enter. |
| 8 | MySQL/MariaDB timeouts were client-side only. | Abandoned queries kept running on the server and held pooled connections. | Sessions set `max_execution_time` (MySQL) / `max_statement_time` (MariaDB). |
| 9 | MySQL's timeout error was reported as "The query was cancelled". | Misleading message. | Reported as a 30-second limit with a hint. |
| 10 | The Redis console fetched whole collections (`KEYS *`, `HGETALL`, `SMEMBERS`, `LRANGE 0 -1`, `ZRANGE`, `XRANGE`) before capping at 1,000 rows. | Millions of elements in VS Code's memory; `KEYS` blocks the server. | The size is checked first (`DBSIZE`, `HLEN`, …); over 10,000 elements the command is refused with the `SCAN`-family alternative. |
| 11 | The grid and console drew every row. | 10,106 DOM nodes for a 500-row page; 16,090 for a 1,000-row result. | Results over 120 rows render only the rows in view (fixed row height, spacer rows), with column widths locked so they do not jump. |
| 12 | Select-all re-rendered the whole grid. | ~80 ms per click on a 500-row page. | Updates only the rendered rows. |
| 13 | Result sorting forced a layout per column and built an `Intl` collator per comparison. | Slow re-sorts. | Widths are read before writing; one shared collator. |
| 14 | An estimated total could make "go back to the last page" re-request the same page. | Possible reload loop on overshooting estimates. | Only exact totals move the page back. |
| 15 | The DynamoDB cursor cache grew with every distinct filter. | Slow memory growth in long sessions. | Capped at 50 queries. |
| 16 | Query history stored entries of any size in webview state. | Up to 30 × 200 KB per connection rewritten on every save. | Scripts over 20,000 characters are run but not remembered. |

## Benchmarks (host side, SQLite)

`blocked` is the longest time the extension host's event loop could not run anything else. Reproduce with `node --expose-gc scripts/db-benchmark.js 100000 1000000 10000000` after `npm run compile`.

### 10,000,000 rows

| Operation | Before ms (blocked) | After ms (blocked) |
| :-- | --: | --: |
| Page 1, 50 rows | 31 (26) | 31 (1) |
| Page 2, 50 rows | 27 (23) | 0.4 (1) |
| Page 1, 500 rows | 30 (25) | 1.5 (1) |
| Middle page (OFFSET 5M) | 541 (536) | 154 (1) |
| Last page | 320 (316) | 329 (8) |
| Sort by unindexed column | 606 (601) | 718 (4) |
| Filter on indexed column | 39 (35) | 39 (1) |
| Same filter, page 2 | 41 (36) | 0.4 (1) |
| Search all columns | 6,586 (6,581) | 292 (2) |
| Console `SELECT *` (capped at 1,000) | 5 (1) | 61 (2) |
| Console aggregate | 3,423 (3,420) | 3,342 (8) |
| Cheap request during a full scan: wait | 11,914 | 0 |
| Full scan with no match | 11,914 (11,909) | 6,034 (9) |
| RSS | ~57 MB | ~107–118 MB |

### 1,000,000 and 100,000 rows

| Operation | 1M before | 1M after | 100K before | 100K after |
| :-- | --: | --: | --: | --: |
| Page 2 | 3.9 | 0.4 | 0.5 | 0.4 |
| Last page (blocked) | 76 (73) | 31 (1) | 10 (6) | 4 (1) |
| Search all columns (blocked) | 914 (911) | 269 (1) | 138 (132) | 73 (1) |
| Console aggregate (blocked) | 298 (294) | 315 (8) | 30 (25) | 29 (1) |
| Request during a full scan: wait | 1,212 | 0 | 122 | 0 |

Heap growth per operation stayed under 2 MB at every size, before and after: results were already bounded.

Notes: wall times for scans are SQLite's own work and barely change; what changed is that they no longer block VS Code and are not repeated. The middle-page gain at 10M partly reflects a warmer OS file cache. The console's first query now pays ~40 ms to start its worker. Each open SQLite connection costs ~50 MB more RSS for its two worker threads.

## Webview rendering

Measured in the browser harness (Chromium) on the 1M-row table, comparing the same build with virtualization switched off. The pane was hidden, so layout and paint are not included; they scale with the DOM size and favor the virtualized grid further.

| Measurement | Before | After |
| :-- | --: | --: |
| DOM nodes, 500-row page | 10,106 | 790 |
| Select all, 500-row page | ~80 ms | <1 ms |
| Console, 1,000 rows: result to rows | 166 ms | 75 ms |
| DOM nodes, 1,000-row result | 16,090 | 510 |
| Re-sort 1,000 rows by a number column | ~85 ms | ~35 ms |
| Re-sort 1,000 rows by a text column | ~67 ms | ~52 ms |

## Tests added

- `database-performance.unit.ts`: count caching and invalidation, statistics estimates and exact counts on request, search counts on large tables, the bounded count cache; a 300,000-row SQLite table scanned without stalling the event loop (<100 ms), capped console results and heap, cancel and timeout of SQLite queries with recovery, the `sql.js` size guard, server time-limit messages, the Redis size check, and the virtualized renderers.
- `scripts/db-benchmark.js`: the benchmark above, at any size.

## Validation

- `npm run compile` (including the web bundle) and `npm run lint`: clean.
- Unit tests: 909 of 909 passing.
- VS Code integration tests: 82 passing, 2 pending (run before the final Redis change, which is covered by unit tests).
- Browser harness: virtualized grid and console, select-all, Enter-to-search and **Count rows** on the 10M-row table.

## Remaining limitations

- **Deep pages and unindexed sorts still scan.** `OFFSET` reads every row before the page, and sorting by a column without an index sorts the table. Keyset pagination was not added; filter or sort by indexed columns to reach deep rows.
- **Server engines were not benchmarked live.** PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, MongoDB, Redis and ClickHouse changes (estimates, count caching, MySQL/MariaDB time limits, the Redis size check) are verified by unit tests only; Docker was not running. Estimates can be stale (InnoDB, or PostgreSQL before `ANALYZE`) and are always labelled.
- **Superseded grid loads are not cancelled on server engines.** When a newer page request replaces an older one, the older query runs to completion (bounded by the 30-second server limits) and its result is discarded.
- **MySQL's `max_execution_time` covers SELECTs only**; MariaDB's `max_statement_time` stops every statement after 30 s, including long DDL in the console, as PostgreSQL's `statement_timeout` already did.
- **`sql.js`** (VS Code builds with Node older than 22.5) still runs in-process, cannot cancel, and opens files up to 512 MB.
