# DevSnip Pro — REST API Client & Database Client for VS Code

<a href="https://buymeacoffee.com/ssayaibj"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy me a coffee" height="42"></a>

**Send HTTP and GraphQL requests, browse PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, MongoDB, Redis and more, estimate LLM costs and catch hard-coded secrets — without leaving VS Code.**

Free · No account · Runs locally · 117 developer tools

**[Install from the Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)** · [Get started](#get-started-in-60-seconds) · [Guides](docs/guides/README.md) · [What's new](CHANGELOG.md) · [☕ Buy me a coffee](https://buymeacoffee.com/ssayaibj)

![DevSnip Pro REST API Client in VS Code: a GET request with formatted JSON response, status, time and size](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/rest-api-client.jpg)

## What's inside

|                                                                                        |                                                                          |
| :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------- |
| 🚀 **[REST API client](#rest-api-client-in-vs-code)**                                   | HTTP, GraphQL, environments, collections, cURL import, code generation   |
| 🗄️ **[Database client](#database-client-for-postgresql-mysql-mongodb-and-redis)**       | PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, MongoDB, Redis and more |
| 🤖 **[AI tools](#llm-token-counter-cost-estimates-and-ai-tools)**                       | Token and cost estimates for 18 models, prompt builder, RAG helpers      |
| 🔒 **[Security scans](#security-scan-hard-coded-secrets-containers-dependencies-and-endpoints)** | Hard-coded secrets, containers, dependencies and live endpoints  |
| 📊 **[CSV & Excel viewer](#csv-and-excel-viewer)**                                     | View and edit .csv, .tsv and .xlsx files in a searchable, sortable grid |
| 🧰 **[100+ utilities](#json-formatter-jwt-decoder-curl-converter-and-100-utilities)**   | JSON, JWT, regex, Docker, Kubernetes, cron, UUIDs and more               |
| 🐞 **[Debug & cleanup](#debug-logs-run--debug-and-cleanup)**                              | Debug logs for 8 languages, launch.json setup, unused imports and packages |
| ✂️ **[Snippets & frameworks](#snippets-for-spring-boot-aspnet-core-fastapi-react-and-flutter)** | Spring Boot, ASP.NET Core, FastAPI, React, Flutter and SwiftUI snippets, API scaffolds |

## Get started in 60 seconds

1. Install DevSnip Pro and click its icon in the Activity Bar.
2. Open **REST API Client** from the sidebar.
3. Click **Send a sample request**, or paste any URL or cURL command and press <kbd>Enter</kbd>.
4. Then try the **Database Client**: fill in host, user and password (or paste a connection string such as `postgresql://user:pass@localhost:5432/app`), press **Test connection**, then **Save & connect**.

> **Tip:** the sidebar's **Get started** card ticks off five first steps as you do them. Run **DevSnip Pro: Get Started** for the guided walkthrough.

## REST API client in VS Code

Build a request, send it and inspect the response — all in one panel.

- **Requests:** every HTTP method, plus **GraphQL** (query, variables, operation name) and **WebSocket**†.
- **Auth:** Bearer, Basic, API keys, and an OAuth 2.0 token helper†.
- **Organise:** environments with `{{variable}}` substitution, collections in folders, and request history.
- **cURL:** paste a cURL command to import it, or export any request as cURL.
- **Code generation:** JavaScript (fetch, Axios), Python, Go, Java and C#.
- **Response viewer:** formatting, search, headers, cookies, copy and save.
- **AI providers:** ready-made request shapes for OpenAI, Anthropic, Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint.
- **Testing†:** assertions, request chaining, batch performance runs, response comparison, mock servers and typed SDK export.

<sub>† Advanced tools, paid for with points you earn by using DevSnip Pro — there is nothing to buy. See [Points & milestones](#points--milestones).</sub>

📖 [Test REST APIs in VS Code](docs/guides/test-rest-apis-in-vscode.md) · [Test a GraphQL API in VS Code](docs/guides/test-graphql-api-in-vscode.md)

## Database client for PostgreSQL, MySQL, MongoDB and Redis

Fill in a short form or paste a connection string — DevSnip Pro detects the database and shows its schemas, tables, views, collections or keys.

![DevSnip Pro Database Client in VS Code browsing a PostgreSQL table with pagination and filters](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/database.jpg)

| Database          | Connection string                                         | Console        | Edit rows | Cancel queries |
| :---------------- | :-------------------------------------------------------- | :------------- | :-------: | :------------: |
| PostgreSQL        | `postgresql://user:pass@host:5432/db`                     | SQL            | ✓         | ✓              |
| CockroachDB       | `cockroachdb://user@host:26257/db` (or `postgresql://…`)  | SQL            | ✓         | ✓              |
| MySQL             | `mysql://user:pass@host:3306/db`                          | SQL            | ✓         | ✓              |
| MariaDB           | `mariadb://user:pass@host:3306/db`                        | SQL            | ✓         | ✓              |
| SQL Server        | `Server=host,1433;Database=db;…` or `sqlserver://…`       | T-SQL          | ✓         | ✓              |
| Oracle            | `oracle://user:pass@host:1521/SERVICE` or `jdbc:oracle:thin:@…` | SQL, PL/SQL | ✓       | ✓              |
| SQLite            | `sqlite:///path/to/app.db` (or **Browse…**)               | SQL            | ✓         | —              |
| ClickHouse        | `clickhouse://user:pass@host:8123/db`                     | SQL            | insert only | ✓            |
| MongoDB           | `mongodb://…` or `mongodb+srv://…`                        | mongosh-style  | ✓         | ✓ (find, aggregate) |
| Redis / Valkey    | `redis://…` or `rediss://…`                               | Redis commands | ✓         | —              |

- **Data grid:** pagination, sorting, search, filters and resizable columns — including MongoDB filters like `{ age: { $gt: 21 } }` and Redis patterns like `user:*`.
- **Edit anything:** type-aware row editor (NULL, DEFAULT), Extended JSON documents (`ObjectId()`, `ISODate()`), and an editor for every Redis type with TTLs. Tables without a primary key are edited through PostgreSQL's `ctid`, Oracle's `ROWID`, CockroachDB's hidden `rowid` or SQLite's `rowid`.
- **Query editor:** syntax highlighting, line numbers, **Format**, and errors underlined where the server found them. <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs the selection; a long query can be **cancelled** on the server. Sort, filter and copy results as JSON or CSV.
- **Structure:** columns with types, keys and defaults, plus the table's **indexes**.
- **Safe by default:** passwords live in your OS keychain. Destructive statements ask first, dropping a table asks you to type its name, and **read-only** connections refuse every write — on most databases the server enforces it too.
- **No extra installs:** every driver ships with the extension. Oracle uses node-oracledb Thin mode, so no Oracle Client is needed.

📖 [Database Client reference: setup, examples, security and troubleshooting](docs/DATABASE-CLIENT.md) · 📖 [Connect to PostgreSQL, MySQL, MongoDB and Redis in VS Code](docs/guides/connect-to-postgresql-mysql-mongodb-redis-in-vscode.md)

## LLM token counter, cost estimates and AI tools

Runs locally — no API key needed.

![LLM token and cost estimate for one prompt across 18 chat models](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/ai-tokens.jpg)

- **Tokens & cost:** estimate tokens and per-request, daily and monthly cost across 18 chat models; compare context windows and prices.
- **Prompt Builder:** fill a prompt template and check it for common mistakes.
- **Output Cleaner:** pull the JSON out of a model's reply, repair it and validate it.
- **RAG helpers:** chunking tester, context window budget, vector store setup, retrieval evaluation, grounding checks and more.
- **Starters:** JSON → TOON to shrink prompts, LLM Client Setup and AI App Starter.
- **Call real models** from the REST client: prompts, streaming and schema validation are free; model comparison, benchmarks, embeddings and RAG pipeline tests use points†.

📖 [Count LLM tokens and estimate cost in VS Code](docs/guides/count-llm-tokens-and-cost-in-vscode.md)

## Security scan: hard-coded secrets, containers, dependencies and endpoints

**Security Hub** puts four scans in one panel. Every finding shows its evidence, severity and fix, and results export as Markdown or JSON.

![Workspace security audit in VS Code finding a hard-coded API key, with severity and fix](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/security.jpg)

- **Workspace audit:** hard-coded API keys, tokens and passwords (values are masked), injection risks, weak cryptography and unsafe configuration.
- **Cloud & containers:** Terraform, Kubernetes, Docker Compose, Dockerfiles and GitHub Actions.
- **Dependencies & config:** lockfiles, unbounded ranges, abandoned or compromised packages, registry credentials and `.env` hygiene.
- **Endpoint scan** of a URL you're authorised to test: TLS, HSTS, security headers, CSP, CORS, cookies, auth behaviour and rate limiting.

Everything runs locally except the endpoint scan, which only contacts the URL you enter.

📖 [Find hard-coded secrets and security issues in VS Code](docs/guides/find-hardcoded-secrets-in-vscode.md)

## CSV and Excel viewer

Open `.csv`, `.tsv` and `.xlsx` files as a fast grid instead of raw text, and edit them. Excel workbooks open in the viewer when you click them; for a CSV, right-click it in the Explorer and choose **Open in CSV & Excel Viewer**, use the table button in the editor title bar, or **Open With…**.

- **Every sheet** of a workbook, with dates, times, percentages, currencies and number formats shown the way Excel shows them, and formulas next to their values.
- **Search, sort and filter** hundreds of thousands of rows; the separator and encoding of a CSV are detected.
- **Column stats** (filled, empty, distinct, min, max, sum, average) and Excel-style sum and average for a selection.
- **Export** what you see as CSV, JSON or a Markdown table, or copy cells straight into Excel.
- **Edit** cells, rows and columns: press **Edit**, then click a cell to edit its text, type over it, paste from Excel, or right-click to insert and delete. New columns are named as you add them. Save with <kbd>Ctrl/Cmd</kbd>+<kbd>S</kbd>; undo works as in any editor. Rows you didn't touch are saved exactly as they were, and in workbooks every untouched cell, style, chart and macro is kept.
- Nothing changes until you press **Edit**, no macro runs, and nothing leaves your machine. Old binary `.xls` files need saving as `.xlsx` first.

## JSON formatter, JWT decoder, cURL converter and 100+ utilities

117 tools in 14 sections, all in the **Tools** sidebar with search (<kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd>), favorites and recently used. Every result can be copied, inserted at the cursor, opened in an editor or saved.

![All DevSnip Pro tools in one searchable grid, grouped into 13 sections](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/all-tools.jpg)

- **Text & data:** JSON / YAML / XML formatter, an XML → JSON converter (strict validation, namespaces, CDATA, lossless mode, large files), diff checker, regex tester, timestamps, UUIDs, and JSON to TypeScript, Zod, Pydantic, Go, Kotlin or Swift.
- **API helpers:** cURL converter, OpenAPI / Swagger toolkit, GraphQL types, CORS debugger, JWT decoder and signer, OAuth 2.0 & PKCE.
- **DevOps & cloud:** Dockerfile, Docker Compose, Kubernetes & Helm, Terraform, CI pipeline and Nginx generators (Node.js, Python, Go, Java and .NET), plus a cron helper.
- **Web & mobile:** React / Next.js generator, HTML → JSX, SEO meta tags, adb & simctl commands, deep links, app signing and asset sizes.

See [all tools by section](#all-tools-by-section) below.

📖 [Format JSON, decode JWTs and other quick tools in VS Code](docs/guides/format-json-decode-jwt-in-vscode.md)

## Debug logs, Run & Debug, and cleanup

Language-aware logging and cleanup for **JavaScript, TypeScript, Python, Java, Kotlin, C#, Dart and Swift**.

- **Insert Debug Log** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, or right-click): logs the variable under the cursor, labelled with the file and line, after the statement that sets it. It uses the logger the file already has: `logger.debug` for Python's `logging`, `log.debug` for SLF4J or Lombok in Spring Boot, `_logger.LogDebug` for `ILogger` in ASP.NET Core, `Log.d` on Android, `debugPrint` in Flutter and `os.Logger` in Swift. Otherwise it falls back to `console.log`, `print`, `System.out.println` or `Console.WriteLine`. Works with several cursors.
- **Clean Debug Logs** finds leftover `console.log`, `print`, `System.out.println`, `Console.WriteLine`, `debugPrint` and similar calls across the workspace (and in `<script>` blocks of HTML, Vue, Svelte and PHP). Calls inside comments and strings are ignored. Only statements that stand alone on their lines are removed. A Python block left empty gets `pass`. **Remove Debug Logs in This File** does the same for the open editor, and **Undo** reverts it.
- **Run & Debug Configurations** detects Next.js, Vite, Angular, NestJS, Node.js, React Native, Expo, FastAPI, Django, Flask, Spring Boot, ASP.NET Core, .NET and Flutter projects, including monorepos. It writes `.vscode/launch.json`, `tasks.json` and `extensions.json` for each language's official debugger, and keeps the configurations you already have.
- **Remove Unused Imports** for JavaScript, TypeScript, Python, Java and Kotlin. It never removes `from __future__` imports, `__init__.py` re-exports, names in `__all__`, or `React` in classic-JSX files.
- **Unused Dependencies** lists npm, Python and Flutter/Dart packages that no code, script or config file uses, and gives the command to remove them. Plugins, CLIs, code generators and database drivers that work without an import are not listed.
- **Dependencies & Installation** shows declared, installed and newest versions for npm, yarn, pnpm, pip, Maven, Gradle, **NuGet** (`.csproj`, including Central Package Management) and **pub** (`pubspec.yaml`). Commands run only after you confirm them.
- **OpenCode:** checks for Node.js and the OpenCode CLI, installs or repairs it, and launches it in your workspace.

![OpenCode Integration Hub in VS Code showing Node.js and OpenCode installed](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/opencode.jpg)

📖 [Install and use OpenCode in VS Code](docs/guides/opencode-in-vscode.md)

## Snippets for Spring Boot, ASP.NET Core, FastAPI, React and Flutter

Type `ds-` in a file, or run **DevSnip Pro: Framework Snippets** to pick one from a list. Every snippet was expanded by VS Code and then compiled, and run where a framework allows it.

| Language | Snippets |
| :-- | :-- |
| Java / Spring Boot | REST controller, service, JPA entity and repository, `@RestControllerAdvice` with ProblemDetail, configuration properties, MockMvc test (Boot 4 or 3), JUnit 5 test, SLF4J logger, record DTO |
| C# / ASP.NET Core | Minimal API endpoint group, API controller, `IExceptionHandler`, validated options, EF Core `DbContext`, `[LoggerMessage]`, `ILogger` field, xUnit and `WebApplicationFactory` tests |
| Python | FastAPI app and router, Pydantic model, Flask route, Django view, dataclass, logging setup, pytest test, fixture and parametrize |
| TypeScript / React / Next.js | React component, data-fetching hook, context provider, Next.js page, route handler and server action, Express router and error handler, zod schema, typed `fetch`, Vitest and Testing Library tests |
| Dart / Flutter | Stateless and stateful widgets, `FutureBuilder`, JSON model, `dart:developer` log, widget and unit tests |
| Swift / SwiftUI | SwiftUI view, `ObservableObject` view model, async JSON request, `os.Logger` |

- **Your own snippets:** select code, run **DevSnip Pro: Create Snippet** and give it a prefix. It appears in IntelliSense in any of 39 languages.
- **API Resource Scaffolder** generates a validated CRUD API with pagination for Express, NestJS, Next.js, Fastify, **Spring Boot** (JPA), **ASP.NET Core** (EF Core) or **FastAPI** (SQLAlchemy).

## DevSnip Pro vs Postman and Thunder Client

All three send API requests from VS Code, but they're built for different jobs.

**DevSnip Pro is a good fit if you want:**

- ✅ No account — requests are stored locally in VS Code
- ✅ HTTP, GraphQL, environments, collections, history, cURL import/export and code generation, free
- ✅ A database client, security scans, LLM tools and 100+ utilities in the same extension

**Not supported yet:**

- ❌ Importing Postman or Insomnia collections (paste requests as cURL instead)
- ❌ `.http` / `.rest` files, a CLI runner for CI, gRPC or SOAP
- ❌ Team workspaces and sync

Need team sharing or a CI runner? Postman or Thunder Client fit better. Want requests as `.http` files in your repo? Try REST Client. Other tools' features change, so check their pages for current details.

📖 [Free Postman alternative in VS Code: which API client to use](docs/guides/postman-alternative-in-vscode.md)

## Points & milestones

![Milestones and Points with rank, streak, daily boost and the Feature Explorer milestone](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/milestones.jpg)

Using DevSnip Pro earns points that move you from Bronze to Grandmaster. No licence key, subscription, account or leaderboard — progress stays on your machine.

- **Earn:** run tools, log in daily and keep your streak, finish three daily quests, claim a daily boost, and unlock one-time milestones. Tool use earns up to 120 points a day.
- **Play:** the **Redeem** button on your rank card opens a daily spin, a dev challenge, the Bit Sprint mini-game, a weekly event and a streak check-in chest.
- **Spend:** advanced REST tools marked † cost 8–35 points per run, charged **only after a run succeeds**. Points also unlock themes, streak freezes, and profile items — avatars, titles, badge frames, banners and celebration effects.
- **Quieter notifications:** set `devsnip.rewards.notifications` to `levelsOnly` or `off`.

Free without points: the full REST and GraphQL workflow, history, environments, unlimited collections, cURL, code generation, JSON and JWT tools, and single AI requests with streaming and schema validation (up to 25 AI requests, 25 prompt runs and 10 streamed responses a day).

## Appearance themes

![Switching appearance themes: Dracula, Nord, Light, Cyberpunk and Monokai](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/themes.gif)

Twelve themes restyle every DevSnip Pro panel from the **Theme** selector at the top of the sidebar. **System Default** follows your VS Code theme and is free; the others unlock with points, and you can preview any locked theme for 30 seconds first. Your VS Code window keeps its own theme.

## All tools by section

- **Backend & API** — REST API Client, cURL Converter, API Response Inspector, URL & Query String Tool, CORS Builder & Debugger, OpenAPI / Swagger Toolkit, GraphQL Formatter & Types, API Resource Scaffolder
- **Web & Frontend** — React / Next.js Generator, HTML → JSX, CSS Units & Fluid Type, Color Converter & Palette, SEO & Social Meta Tags, Cache-Control Builder
- **Mobile Development** — adb & simctl Commands, Deep Links & Universal Links, App Permissions, Local API from Devices, Environments & Flavors, Signing & Keystores, SDK & Build Compatibility, Mobile CI Workflow, dp / px / pt & Asset Sizes
- **Code & Productivity** — Saved Snippets, Create Snippet, Framework Snippets, Remove Unused Imports, Dependencies & Installation, Unused Dependencies, README Viewer & Manager, OpenCode Integration
- **Text & Formatters** — JSON / YAML / XML Formatter, XML → JSON Converter, Diff Checker, Regex Tester & Library, Case Converter & Text Tools
- **Encoders & Converters** — Encode / Decode, Timestamp Converter, UUID & ID Generator, JSON to Types, Data Converter
- **Database** — Database Client, SQL Formatter & Linter, SQL Query Helper, Database Connection Strings, SQL → MongoDB
- **Spreadsheets & CSV** — CSV / TSV Viewer, Excel Viewer (.xlsx)
- **Testing & Debugging** — Insert Debug Log, Clean Debug Logs, Run & Debug Configurations, Build Error Explainer, Log Analyzer & Formatter, Mock Data Generator, JSON Schema Validator, Port & Network Toolkit
- **Git & Version Control** — Git Command Recipes, .gitignore Generator, Semver & App Versions
- **DevOps & Cloud** — Dockerfile, Docker Compose, docker run → Compose, CI Pipeline, .env Checker, Kubernetes & Helm, Cloud Deploy Workflow, Cron Expression Helper, Nginx, Health Check Endpoints, Terraform, PM2, Observability Starter
- **Security & Auth** — JWT Decoder & Signer, Workspace Security Audit, Hash / HMAC / Webhooks, OAuth 2.0 & PKCE, CSP & Security Headers, Endpoint Security Scan, Cookie Inspector, Dependency & Config Check, Certificate & SSL Pinning, Cloud & Container Audit
- **AI & ML** — Prompt Builder, LLM Models / Tokens & Cost, LLM Client Setup, LLM Output Cleaner & JSON Validator, LLM API Tester, JSON → TOON, AI App Starter, AI/ML Code Snippets, GPU Memory & Speed, Model Serving Starter, Model Metrics, Dataset Split Planner, Learning-Rate Schedule, Model Card
- **Data & RAG** — Chunking Tester, RAG Pipeline Generator, Vector Store Setup, Embedding Model Guide, Retrieval Configuration, Context Window Budget, Grounded Prompt Assembler, Chunk & Index Size Calculator, Retrieval Evaluation, Answer Grounding Checker, Vector Similarity, Near-Duplicate Chunk Finder, Hybrid Search Fusion, Chunk Metadata Validator, Data Transformer, Data Profiler, JSON Lines Inspector, Schema Viewer & Diff, Partition Planner, Spark Cluster & Cost, Delta Lake Log Analyzer

Generated configuration is checked by the test suite: YAML and JSON are parsed, TypeScript and JavaScript compiled, Python byte-compiled, and Compose files validated with `docker compose config`.

## Installation

- **In VS Code:** open Extensions (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search **DevSnip Pro** and click **Install**.
- **Marketplace:** [DevSnip Pro on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)
- **Command line:** `code --install-extension sayaib.hue-console`

Requires VS Code 1.93+ on Windows, macOS or Linux. After an update, run **DevSnip Pro: What's New** for the release notes.

![The DevSnip Pro Get started walkthrough on the VS Code Welcome page](https://raw.githubusercontent.com/sayaib/DevSnip-Pro/main/docs/images/get-started.jpg)

## FAQ

**Is DevSnip Pro free?**
Yes. Almost everything is free with no limits. A few advanced REST API Client tools cost points, which you earn by using the extension — there is nothing to buy.

**Is it a free Postman alternative?**
For the everyday loop, yes: requests, environments, collections, history, cURL import and code generation, with no account. It can't import Postman collections; paste requests as cURL instead.

**How do I test a GraphQL API?**
In the REST API Client, switch **HTTP** to **GraphQL**, set the method to `POST`, write the query and variables, and send. See [the GraphQL guide](docs/guides/test-graphql-api-in-vscode.md).

**Does it support `.http` files?**
No. Requests are built in a form and saved to collections.

**Does it send my code anywhere?**
No. Tools run locally, and network requests go only to the URLs and databases you enter. See [Privacy](#privacy-and-analytics).

**Does it work offline?**
Yes, except for things that need a network by definition: API requests, database connections, the endpoint scan, AI provider calls and the OpenCode install.

**Will it slow down VS Code?**
No. Heavy features load only when you first open them, and database drivers load when you connect.

**Does it work in Remote, WSL or vscode.dev?**
Remote and WSL work, except the OpenCode hub, which needs a local process. vscode.dev isn't supported because several tools use Node APIs.

## Settings

| Setting                                         | Default | What it does                                                               |
| :---------------------------------------------- | :------ | :------------------------------------------------------------------------- |
| `devsnip.apiTimeout`                            | `30000` | REST request timeout (ms). A per-request timeout overrides it.             |
| `devsnip.consoleLogCleanup.confirmBeforeDelete` | `true`  | Ask before Clean Debug Logs removes `console.log`, `print` and similar calls. |
| `devsnip.securityAudit.maxFiles`                | `2000`  | Files read by each workspace, cloud or dependency scan.                    |
| `devsnip.security.endpointTimeout`              | `15000` | Per-request timeout (ms) for the endpoint scanner.                         |
| `devsnip.security.activeChecks`                 | `false` | Pre-enable the endpoint scanner's active checks.                           |
| `devsnip.rewards.notifications`                 | `all`   | Progress notifications: `all`, `levelsOnly` or `off`.                      |
| `devsnip.analytics.enabled`                     | `true`  | Send anonymous usage analytics.                                            |
| `devsnip.analytics.debug`                       | `false` | Log every analytics event to the **DevSnip Pro: Analytics** output channel. |

**Keyboard shortcuts:** only **Insert Debug Log** has one by default (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, in supported languages). Add your own, for example `{ "key": "ctrl+shift+a", "command": "sayaib.hue-console.openGUI" }`.

## Troubleshooting

**A new snippet doesn't appear in IntelliSense.** VS Code loads snippets at startup — reload the window when prompted.

**OpenCode is installed but not detected.** VS Code launched from the Dock or a shortcut gets a minimal `PATH`. Start it from a terminal or fix `PATH`, then press **Recheck System**. On Windows, use **Launch in Command Prompt** if PowerShell blocks it.

**The Database Client can't connect.** The error says why (refused, host not found, auth failed, unknown Oracle service or TLS); see [Database Client troubleshooting](docs/DATABASE-CLIENT.md#troubleshooting). For a local self-signed certificate add `sslmode=no-verify` (PostgreSQL), `TrustServerCertificate=true` (SQL Server) or `tlsAllowInvalidCertificates=true` (MongoDB). SQL Server needs a SQL login.

**A security audit finds nothing in a large repo.** It reads up to `devsnip.securityAudit.maxFiles` files and skips dependency, build and cache folders — raise the setting.

**A request never finishes.** Requests time out after `devsnip.apiTimeout`; press **Cancel** to stop one early.

**Points look wrong.** Progress is stored per machine and repaired automatically if corrupted. **Reset progress** (under ⋯ in Milestones & Points) clears it.

## Privacy and analytics

- **No backend, no account.** Requests go only to the URLs and databases you enter.
- **Your secrets stay put.** API keys you type aren't written to history or disk, credential-looking URL values are redacted from history, and connection strings stay in your OS keychain.
- **Anonymous analytics only:** which DevSnip Pro tools you open and use, a once-a-day "active" ping, and the country PostHog derives from the connection. Each computer gets one anonymous ID (a salted hash, so it can't be traced back). Never code, file contents or names, paths, keystrokes, anything you type into a tool, URLs, credentials or anything that identifies you.
- **You're in control:** nothing is sent unless VS Code's `telemetry.telemetryLevel` is `all`. Set `devsnip.analytics.enabled` to `false` to opt out, or `devsnip.analytics.debug` to see every event. Full list: [docs/ANALYTICS.md](docs/ANALYTICS.md).

Of the toolbox tools, only the LLM API Tester uses the network, and it's marked "Uses network".

## Support & feedback

- 🐛 [Report a bug or request a feature](https://github.com/sayaib/DevSnip-Pro/issues/new/choose)
- 📖 [Guides](docs/guides/README.md) · [Changelog](CHANGELOG.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md)
- ⭐ A rating or review on the [Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) helps other developers find DevSnip Pro.

If DevSnip Pro saves you time, consider buying me a coffee ❤️

<a href="https://www.buymeacoffee.com/ssayaibj">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="217" height="60">
</a>

Made by Sayaib Sarkar — [LinkedIn](https://www.linkedin.com/in/sayaib/) · [GitHub](https://github.com/sayaib/DevSnip-Pro)
