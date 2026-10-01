# DevSnip Pro

A developer toolkit for VS Code: a full REST and AI API client, a database client, a security scanner, workspace cleanup, snippets, and 100+ focused tools for full-stack web and mobile development, AI and LLM work, RAG, data and DevOps. Everything runs locally unless a tool says otherwise; no account needed.

<p align="center">
  <img src="Devsnip.jpg" alt="DevSnip Pro" />
</p>

## Getting started

Install the extension, then open any tool one of three ways:

- **Activity Bar** — click the DevSnip Pro icon for the Tools sidebar: 13 sections, from Backend & API to Data & RAG.
- **Command Palette** — `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS), then type `DevSnip Pro`.
- **Editor right-click** — the **DevSnip Pro** submenu, for tools that act on the file you are in.

Most people start with the **REST API Client** (`DevSnip Pro: Rest API Client`).

## What you can do

### Test APIs

The REST API Client handles the whole request cycle: pick a method, enter a URL, set headers, query parameters, a body and authentication, then send and inspect the response.

- All HTTP methods, plus GraphQL and WebSocket
- Bearer, Basic and API-key authentication, and an OAuth 2.0 token helper
- Named environments with `{{variable}}` substitution
- Saved collections, organised in folders, with request history
- Import and export cURL commands, and generate client code in JavaScript, Python, Go, Java or C#
- Response viewer with formatting, search, copy and save
- Automated assertions, request chaining and batch performance testing

### Work with databases

The **Database Client** (`DevSnip Pro: Database Client`, or **Database** in the sidebar) is a lightweight database client inside VS Code. Paste a connection string, and it detects the database, checks it, and shows its databases, schemas, tables, collections or keys.

| Database | Connection string | What you can do |
| --- | --- | --- |
| PostgreSQL | `postgresql://user:pass@host:5432/db` | Browse databases, schemas, tables and views; full CRUD; SQL console |
| MySQL / MariaDB | `mysql://user:pass@host:3306/db` | Browse databases, tables and views; full CRUD; SQL console |
| SQL Server | `Server=host,1433;Database=db;User Id=…;Password=…` or `sqlserver://…` | Browse databases, schemas, tables and views; full CRUD; T-SQL console |
| SQLite | `sqlite:///path/to/app.db` (or **Browse…**) | Browse tables and views; full CRUD; SQL console |
| MongoDB | `mongodb://…` or `mongodb+srv://…` | Browse databases and collections; insert, edit and delete documents; mongosh-style console |
| Redis | `redis://…` or `rediss://…` | Browse keys by pattern and type; create and edit strings, hashes, lists, sets and sorted sets with TTLs; command console |

- **Data grid:** pagination, sorting by column, search across columns, and filter conditions (`=`, `≠`, `>`, `contains`, `in list`, `is null` and more). MongoDB also takes a filter document such as `{ age: { $gt: 21 } }`; Redis takes a key pattern such as `user:*`.
- **Editing:** a row editor that knows each column's type, NULL and DEFAULT; a document editor that accepts Extended JSON and shell helpers such as `ObjectId()` and `ISODate()`; a key editor per Redis type. Right-click a cell to copy it, filter by it, or duplicate the row.
- **Structure:** columns with types, keys, defaults and nullability, or the fields a collection's documents use and how often.
- **Query console:** run SQL, mongosh-style commands (`db.users.find({ … }).sort({ … }).limit(20)`) or Redis commands. <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs the selection, or everything. Results can be copied as JSON or CSV or opened in an editor, and recent queries are kept per connection.
- **Saved connections:** save, edit, test, connect, reconnect and remove connections, each with a colour and a live status indicator.

**Safety.** Connection strings are stored in your operating system's keychain through VS Code's SecretStorage. The password is never shown again (it appears as `********` when you edit a connection), and it is removed from every error message. Deleting rows, emptying or dropping a table and destructive console statements (`DROP`, `TRUNCATE`, `DELETE`, `UPDATE` without `WHERE`, `deleteMany`, `FLUSHDB` …) always ask first; dropping or emptying asks you to type the name. A connection marked **read-only** refuses every write, and on PostgreSQL and MySQL the database session itself is read-only too. Rows are identified by their primary key (or by SQLite's `rowid` and PostgreSQL's `ctid`); tables without one, and views, are shown read-only rather than risking the wrong row.

### Work with AI and LLM APIs

The same client speaks to OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint — each with the correct request shape and response parsing.

- Send prompts, stream replies, estimate tokens and cost before you send
- Validate a model's JSON output against a schema
- Compare several models side by side, and benchmark latency and throughput
- Test embeddings, vector databases (Qdrant, Pinecone, Weaviate, Chroma) and full RAG pipelines
- Trace an agent's tool-calling loop, and score prompt variants against your own criteria

### Clean up a codebase

- Find and remove `console.log` statements across the workspace
- Find and remove unused imports in JavaScript, TypeScript, Python and Java
- View, edit and manage README files with a live preview

### Manage dependencies

**DevSnip Pro: Dependencies & Installation** (in the **Code & Productivity** section) finds every project in the workspace and lists each dependency with its declared range, the installed version, the newest version that range allows, and the newest stable release.

- **npm, yarn (1 and 2+), pnpm, pip, Maven and Gradle.** The package manager is detected from `packageManager`, the nearest lockfile, a Maven or Gradle wrapper, or a Python virtual environment (`.venv`, `venv`, or the interpreter selected in VS Code).
- **Clear status per dependency:** up to date, update available within the range, newer major outside the range, missing, installed at the wrong version, or unknown (with the reason).
- **One-click Install missing and Update outdated**, per project or for the whole workspace, with live progress, a cancel button, and a plain-language explanation when something fails (peer conflicts, private registries, PEP 668, proxies and certificates, missing build tools, permissions).
- **Copy any command.** Every install, update and upgrade command is shown and can be copied, quoted correctly for your platform's shell.

Production stays safe by default. Nothing runs without a confirmation that shows the exact command lines. Bulk updates stay inside the declared ranges and only touch development dependencies unless you tick _Include production dependencies_. Upgrading a production dependency past its range, and any Maven or Gradle version change, is offered as a copyable command, never run automatically. Commands are built by the extension from an allow-list, never passed through a shell, and only run in a trusted workspace.

### Check security

**DevSnip Pro: Security Hub** puts four scans behind one panel. Every check is performed for real against the target you choose, and each result carries the evidence it was based on, a severity, and the change that resolves it. Results are graded Pass, Warning or Failed, filterable, and exportable as Markdown or JSON.

**Endpoint scan** sends real requests to a URL you are authorised to test and grades what comes back:

- HTTPS and TLS — certificate trust, hostname match, expiry, protocol version, cipher and key strength, and whether plain HTTP redirects
- HSTS — presence, `max-age`, `includeSubDomains` and preload eligibility
- Security headers — `X-Content-Type-Options`, clickjacking protection, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP and version disclosure
- Content Security Policy — enforcing vs report-only, `unsafe-inline` and `unsafe-eval`, wildcard sources, `object-src`, `base-uri`, `form-action` and reporting
- CORS — reflected or wildcard origins, credentials, allowed methods and headers, and `Vary: Origin`
- Cookies — `Secure`, `HttpOnly`, `SameSite`, `__Host-`/`__Secure-` prefixes, domain scope and lifetime
- Authentication — credentials in a URL, Basic over HTTP, JWT algorithm and expiry, cacheable authenticated responses, and whether the endpoint still answers with the credential stripped
- API security — Content-Type correctness, TRACE, advertised methods, mixed content, subresource integrity and GraphQL introspection
- Information exposure — credential formats, stack traces, database errors, directory listings, source maps, internal addresses and debug headers
- Rate limiting — advertised quota headers, and an optional burst to see whether throttling actually applies

Two extras are opt-in because they send traffic the target did not ask for, though both are read-only: a **reflected-input probe** that checks whether a marker string is encoded on the way out, and requests for **well-known sensitive paths** (`.env`, `.git`, `actuator`, backups), each confirmed by content signature so a catch-all route cannot produce a false positive.

**Workspace audit** applies secret, injection, cryptography and unsafe-configuration rules to the source in the open workspace. **Cloud & container audit** covers Terraform, Kubernetes, Compose, Dockerfiles and GitHub Actions. **Dependency & config check** reads the manifests and reports on lockfiles, unbounded version ranges, abandoned or compromised packages, registry credentials, `.env` hygiene, automated dependency updates and whether CI runs a security scan.

Everything runs locally except the endpoint scan, which only contacts the URL you enter. Matched credential values are masked before they are shown.

### Tools by section

Every tool has exactly one home, in one of 13 sections. Sections run from the tools most developers use daily to the specialised ones, and tools inside a section are ordered by how often they are used. The **Tools** sidebar shows the sections with search (<kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd>), favorites and recently used. **Browse All Tools** shows the same sections as a searchable grid with pinning.

Every toolkit tool opens in its own panel. Panels have presets, live results where that makes sense, and one-click **Copy**, **Insert at cursor**, **Open in editor**, **Save as…** and **Save / Write all to workspace** (it always asks before overwriting). Tools that act on the current file also appear in the editor's right-click **DevSnip Pro** menu.

| Section | Tools |
| --- | --- |
| **Backend & API** | REST API Client, cURL Converter, API Response Inspector, URL & Query String Tool, CORS Builder & Debugger, OpenAPI / Swagger Toolkit, GraphQL Formatter & Types, API Resource Scaffolder |
| **Web & Frontend** | React / Next.js Generator, HTML → JSX, CSS Units & Fluid Type, Color Converter & Palette, SEO & Social Meta Tags, Cache-Control Builder |
| **Mobile Development** | adb & simctl Commands, Deep Links & Universal Links, App Permissions, Local API from Devices, Environments & Flavors, Signing & Keystores, SDK & Build Compatibility, Mobile CI Workflow, dp / px / pt & Asset Sizes |
| **Code & Productivity** | Saved Snippets, Create Snippet, Clean Console Logs, Remove Unused Imports, Dependencies & Installation, README Viewer & Manager, OpenCode Integration |
| **Text & Formatters** | JSON / YAML / XML Formatter, Diff Checker, Regex Tester & Library, Case Converter & Text Tools |
| **Encoders & Converters** | Encode / Decode, Timestamp Converter, UUID & ID Generator, JSON to Types (TypeScript, Zod, Dart, Kotlin, Swift, Pydantic, Java, Go, JSON Schema), Data Converter |
| **Database** | Database Client, SQL Formatter & Linter, SQL Query Helper, Database Connection Strings, SQL → MongoDB |
| **Testing & Debugging** | Build Error Explainer, Log Analyzer & Formatter, Mock Data Generator, JSON Schema Validator, Port & Network Toolkit |
| **Git & Version Control** | Git Command Recipes, .gitignore Generator, Semver & App Versions |
| **DevOps & Cloud** | Dockerfile, Docker Compose, docker run → Compose, CI Pipeline, .env Checker, Kubernetes & Helm, Cloud Deploy Workflow, Cron Expression Helper, Nginx, Health Check Endpoints, Terraform, PM2, Observability Starter |
| **Security & Auth** | JWT Decoder & Signer, Workspace Security Audit, Hash / HMAC / Webhooks, OAuth 2.0 & PKCE, CSP & Security Headers, Endpoint Security Scan, Cookie Inspector, Dependency & Config Check, Certificate & SSL Pinning, Cloud & Container Audit |
| **AI & ML** | Prompt Builder, LLM Models / Tokens & Cost, LLM Client Setup, LLM Output Cleaner & JSON Validator, LLM API Tester, JSON → TOON, AI App Starter, AI/ML Code Snippets, GPU Memory & Speed, Model Serving Starter, Model Metrics, Dataset Split Planner, Learning-Rate Schedule, Model Card |
| **Data & RAG** | RAG: Chunking Tester, RAG Pipeline Generator, Vector Store Setup, Embedding Model Guide, Retrieval Configuration, Context Window Budget, Grounded Prompt Assembler, Chunk & Index Size Calculator, Retrieval Evaluation, Answer Grounding Checker, Vector Similarity, Near-Duplicate Chunk Finder, Hybrid Search Fusion, Chunk Metadata Validator. Data engineering: Data Transformer, Data Profiler, JSON Lines Inspector, Schema Viewer & Diff, Partition Planner, Spark Cluster & Cost, Delta Lake Log Analyzer |

Data & RAG also includes a step-by-step guided path through the RAG tools for newcomers.

Generated configuration is checked by the test suite: YAML and JSON are parsed, TypeScript, TSX and JavaScript are compiled, Python is byte-compiled, and Compose files are validated with `docker compose config`.

### Save your own snippets

Select code, run **Create Your Own Perfect Code Snippet**, and give it a prefix. Snippets are contributed for 40 languages and appear in IntelliSense after a window reload. Browse and delete them under **Show Custom Snippets**.

## Points and premium tools

Most of DevSnip Pro is free and always available. A set of advanced REST API Client tools is unlocked with **points**, which you earn by using the extension — there is no licence key, subscription or account.

**How points work**

- Using DevSnip Pro earns points: any tool run (+3), creating a snippet (+10), running an audit (+8), using an AI tool (+5), a daily login (+5) and bonus (+10), plus milestones (+10 to +500). Up to 120 points a day come from tool use, plus one-time milestone bonuses.
- Each premium tool has a price from 8 to 35 points, shown next to it in the navigation and charged per run.
- Points are deducted **only after a run succeeds**. A bad key, a network error or a failing endpoint costs nothing.
- When your balance is short, the tool tells you the price, your balance and how many more points you need.

Your balance sits in the client header. The **Your points** view lists what your balance unlocks, what it does not, and how to earn more. Points are stored on your machine and work offline.

Free tools include the full REST and GraphQL workflow, response inspection, history, environments, unlimited saved collections, cURL import/export, code generation, JWT decoding, JSON tools, and single AI requests with prompt testing, token costing, streaming and schema validation. Free AI use is capped per day at 25 requests, 25 prompt runs and 10 streamed responses.

## OpenCode integration

**DevSnip Pro: OpenCode Integration** manages the OpenCode CLI from inside VS Code on Windows, macOS and Linux. It checks for Node.js and the `opencode` binary, installs or repairs it via npm, and launches it in a terminal rooted at your workspace.

Install is only reported as successful once `opencode --version` actually runs, so a partial install shows as broken rather than green. Per-OS alternatives are shown in the panel: npm, Homebrew, the install script, and Chocolatey or Scoop on Windows.

## Usage analytics

DevSnip Pro collects **anonymous** usage analytics: which of its features run, how often, whether they succeed, and how long sessions last. This shows which features are valuable and which need work.

- **Never collected:** code, snippet contents, file names or paths, search queries, URLs, package names, error messages, or anything that identifies you. Each installation is represented only by a random ID.
- **Respects VS Code:** nothing is sent unless `telemetry.telemetryLevel` is `all`.
- **Off switch:** set `devsnip.analytics.enabled` to `false` to switch off DevSnip Pro's analytics only.
- **Transparency:** set `devsnip.analytics.debug` to `true` to see every event in the **DevSnip Pro: Analytics** output channel before it is sent.

The complete list of events and properties is in [docs/ANALYTICS.md](docs/ANALYTICS.md).

## Settings

| Setting                                         | Default | What it does                                                                                            |
| :---------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------ |
| `devsnip.apiTimeout`                            | `30000` | Request timeout in milliseconds for the REST API Client. A per-request timeout overrides it.            |
| `devsnip.consoleLogCleanup.confirmBeforeDelete` | `true`  | Ask before removing `console.log` statements.                                                           |
| `devsnip.securityAudit.maxFiles`                | `2000`  | How many files each workspace, cloud or dependency security scan reads.                                 |
| `devsnip.security.endpointTimeout`              | `15000` | Default per-request timeout in milliseconds for the endpoint security scanner.                          |
| `devsnip.security.activeChecks`                 | `false` | Pre-enable the endpoint scanner's active checks (reflected-input probe and well-known sensitive paths). |
| `devsnip.analytics.enabled`                     | `true`  | Send anonymous usage analytics. See [Usage analytics](#usage-analytics).                                |
| `devsnip.analytics.debug`                       | `false` | Log every analytics event, exactly as sent, to the **DevSnip Pro: Analytics** output channel.           |

## Keyboard shortcuts

None are set by default, so nothing conflicts with your existing bindings. To add your own, open **Preferences: Open Keyboard Shortcuts (JSON)**:

```json
[
  { "key": "ctrl+shift+a", "command": "sayaib.hue-console.openGUI" },
  {
    "key": "ctrl+shift+s",
    "command": "sayaib.hue-console.createCustomSnippet"
  },
  {
    "key": "ctrl+shift+l",
    "command": "sayaib.hue-console.listAndRemoveConsoleLogs"
  }
]
```

## Requirements

- **VS Code 1.93 or newer.**
- **A trusted workspace** for anything that reads your files or runs a command. DevSnip Pro does not run in Restricted Mode.
- **An open folder** for audits, cleanup tools, the README manager and the generators. They tell you to open one rather than failing quietly.
- **Node.js and npm** only for the OpenCode integration. Everything else runs without them.
- **Network access** only for the API clients, the Database Client (to reach your database) and the OpenCode install. Every other tool works offline.

Works on Windows, macOS and Linux. Desktop VS Code only — several tools use Node APIs, so it does not run in browser-only environments such as vscode.dev. In a remote or virtual workspace everything works except the OpenCode hub, which needs a local process.

## Troubleshooting

**A new snippet does not appear in IntelliSense.** VS Code loads snippets at startup. Reload the window — the extension offers this after you save one.

**OpenCode is installed but not detected.** A VS Code window launched from the Dock or a desktop shortcut inherits a minimal `PATH`. The hub also searches the usual install locations; if yours is elsewhere, start VS Code from a terminal or add the directory to `PATH`, then press **Recheck System**.

**The OpenCode install fails.** Usually a permissions problem with the global npm prefix. The hub opens a terminal with the command ready — run it there (with `sudo` if your prefix needs it) and press **Recheck System**.

**On Windows, OpenCode does not start when launched.** PowerShell may show a script security prompt. Answer it in the terminal, use the **Launch in Command Prompt** fallback, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**A security audit finds nothing in a large repository.** It reads up to `devsnip.securityAudit.maxFiles` files and skips dependency, build and cache folders. Raise the setting for very large repositories.

**The endpoint scan reports that the endpoint could not be reached.** No check is evaluated when no response arrives, so nothing is guessed. Confirm the URL and that the host is reachable from this machine; an endpoint behind a VPN or a corporate proxy has to be scanned from a network that can reach it.

**A request never finishes.** Requests time out after `devsnip.apiTimeout`. Use **Cancel** to stop one that is running.

**Saving a snippet reports it cannot write.** Snippets live in the extension folder, which must be writable. This can fail if the extension was installed somewhere read-only.

**The Database Client cannot connect.** The message says why: connection refused (is the server running on that port?), host not found, authentication failed, or a TLS problem. For a local server with a self-signed certificate add `sslmode=no-verify` (PostgreSQL), `TrustServerCertificate=true` (SQL Server) or `tlsAllowInvalidCertificates=true` (MongoDB). SQL Server needs a SQL login; Windows authentication is not supported.

**A table cannot be edited in the Database Client.** Rows are changed by primary key. Views, and MySQL or SQL Server tables without a primary key, are read-only; use the query console for those.

**Points look wrong.** Progress is stored per machine. Corrupted data is repaired automatically when read, and **Reset Data** in the Milestone Tracker clears it.

## Privacy

Everything runs locally. DevSnip Pro has no backend and no account, and its only telemetry is the anonymous, opt-out usage analytics described above, which never include code, inputs or outputs. Requests go only to the URLs you enter, and API keys you type are used for that request and are not written to history or to disk. Credential-looking values in a URL are redacted before a request is stored in history. Database connection strings are stored in the OS keychain (VS Code SecretStorage), never in settings or logs, and the Database Client only talks to the database you connect to. Of the toolbox tools, only the LLM API Tester uses the network (marked "Uses network"); a key typed there is used for that request only and never saved.

## Development

```bash
npm install          # install dependencies
npm run compile      # clean build to out/
npm run lint         # ESLint over src/
npm run test:unit    # fast unit suite, plain Node, no VS Code needed
npm test             # compile, lint, then the VS Code integration suite
npm run package      # produce the .vsix
```

The Database Client also has end-to-end tests that run against real servers. They are skipped unless you point them at test databases (they create and remove their own `devsnip_test_*` tables, collections and keys):

```bash
DEVSNIP_TEST_POSTGRES_URL=postgresql://user:pass@localhost:5432/app \
DEVSNIP_TEST_MYSQL_URL=mysql://root:pass@127.0.0.1:3306/app \
DEVSNIP_TEST_SQLSERVER_URL="Server=localhost,1433;Database=app;User Id=sa;Password=...;Encrypt=false" \
DEVSNIP_TEST_MONGODB_URL=mongodb://127.0.0.1:27017/app \
DEVSNIP_TEST_REDIS_URL=redis://localhost:6379/15 \
npm run test:unit
```

## Links and support

- Marketplace: https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console
- Source and issues: https://github.com/sayaib/DevSnip-Pro
- Documentation: https://sayaibsarkar.net/#/dev-snip-pro/document/en

Made by Sayaib Sarkar — https://www.linkedin.com/in/sayaib/
