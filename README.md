# DevSnip Pro — API Client, AI & Developer Toolkit for VS Code

**DevSnip Pro is an all-in-one developer toolkit for VS Code: a REST API client, a database client, AI and LLM tools, security scans, code snippets and 100+ focused utilities for web, mobile and DevOps work — without leaving the editor.**

It is for full-stack, backend, mobile and AI developers who would rather not switch between an API client, a database GUI, a dozen browser tools and a terminal to get everyday work done. It is free, needs no account, and everything runs locally unless a tool says otherwise.

![The REST API Client sending a request, with the DevSnip Pro sidebar and its Get started checklist](docs/images/rest-api-client.jpg)

## Why developers use it

- **One place for the daily loop.** Call an API, inspect the response, check the database, format the JSON, decode the JWT — in the same window as your code.
- **Real results, not samples.** Requests, queries and security scans run against your actual endpoints, databases and workspace.
- **Private by design.** No account, no backend. Credentials stay in your OS keychain; analytics are anonymous and switch off with VS Code's telemetry setting.
- **Fast to start, light to carry.** Heavy features load only when you open them, so DevSnip Pro adds almost nothing to VS Code's startup.
- **Easy to find your way.** 110 tools in 13 sections, a search box (<kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd>), favorites, recently used, and a five-step Get started guide.

## Features at a glance

| Area | What you get | Details |
| :--- | :--- | :--- |
| **REST API** | HTTP, GraphQL and WebSocket client with environments, collections, history, cURL import and code generation | [REST API Client](#rest-api-client) |
| **AI & LLM** | Token and cost estimates across models, prompt builder, LLM JSON validation, RAG planning, multi-provider AI requests | [AI & LLM tools](#ai--llm-tools) |
| **Database** | Browse and edit PostgreSQL, MySQL, SQL Server, SQLite, MongoDB and Redis; SQL, mongosh and Redis consoles | [Database Client](#database-client) |
| **Security** | Workspace secret and injection audit, cloud and container audit, dependency checks, endpoint scanner | [Security tools](#security-tools) |
| **Code & Snippets** | Save your own snippets, clean `console.log` calls, remove unused imports, manage dependencies and READMEs | [Developer utilities](#developer-utilities) |
| **Developer tools** | JSON/YAML/XML formatter, diff, regex tester, encoders, timestamps, UUIDs, JSON to types | [Developer utilities](#developer-utilities) |
| **Git & Cloud** | Git command recipes, `.gitignore`, semver; Dockerfile, Compose, Kubernetes, Terraform, CI and GitHub Actions generators | [All tools by section](#all-tools-by-section) |
| **OpenCode** | Install, verify and launch the OpenCode AI coding agent from VS Code | [OpenCode integration](#opencode-integration) |
| **Productivity** | Nine appearance themes, Get started guide, points, streaks and milestones | [Points & milestones](#points--milestones) |

## See it in action

| | |
| :---: | :---: |
| ![Database Client browsing a PostgreSQL table](docs/images/database.jpg) **Database Client** — browse and edit a PostgreSQL table | ![Workspace security audit with findings](docs/images/security.jpg) **Security** — a workspace audit finds a hard-coded key |
| ![LLM tokens and cost by model](docs/images/ai-tokens.jpg) **AI & LLM** — what a prompt costs on 18 models | ![All tools in one searchable grid](docs/images/all-tools.jpg) **All tools** — 110 tools, searchable, in 13 sections |

![Switching appearance themes: Dracula, Nord, Light, Cyberpunk and Monokai](docs/images/themes.gif)

*One click restyles every DevSnip Pro panel. The VS Code window itself keeps your own theme.*

## REST API Client

**DevSnip Pro: REST API Client** handles the whole request cycle: choose a method, enter a URL, set headers, query parameters, a body and authentication, then send and inspect the response.

- All HTTP methods, plus **GraphQL** and **WebSocket**†.
- **Auth:** Bearer, Basic and API keys, and an OAuth 2.0 token helper†.
- **Environments** with `{{variable}}` substitution; **collections** in folders; request **history**.
- **cURL:** paste a cURL command into the URL bar to import it, or export any request as cURL.
- **Code generation** in JavaScript, Python, Go, Java or C#.
- **Response viewer** with formatting, search, headers, cookies, copy and save.
- **Testing†:** assertions, request chaining, batch performance runs, response comparison, mock servers and typed SDK export.

† Advanced tools, paid for with points you earn by using DevSnip Pro (see [Points & milestones](#points--milestones)). Everything else is free.

**Try it:** open the client, enter `https://jsonplaceholder.typicode.com/todos/1` and press <kbd>Enter</kbd>.

## AI & LLM tools

DevSnip Pro's AI tools run locally and need no API key; when you want to call a model, the REST client speaks to OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint with the correct request shape.

- **LLM Models, Tokens & Cost:** estimate tokens and per-request, daily and monthly cost across models, or compare context windows and prices.
- **Prompt Builder:** fill a prompt template and check it for mistakes.
- **LLM Output Cleaner & JSON Validator:** pull the JSON out of a model's reply and validate it.
- **JSON → TOON** to shrink structured data in prompts; **LLM Client Setup** and **AI App Starter** for project boilerplate.
- **RAG** (in **Data & RAG**): chunking tester, pipeline generator, vector store setup, retrieval evaluation, grounding checks and more.
- **In the REST client:** send prompts, stream replies and validate output against a schema for free; compare models side by side, benchmark them, and test embeddings, vector databases (Qdrant, Pinecone, Weaviate, Chroma), RAG pipelines and agents with points.

**Try it:** run **DevSnip Pro: LLM Models, Tokens & Cost** and paste a prompt.

## Database Client

**DevSnip Pro: Database Client** connects with a connection string, detects the database and shows its databases, schemas, tables, collections or keys.

![Database query console with a SQL join and results](docs/images/database-query.jpg)

| Database | Connection string | What you can do |
| :--- | :--- | :--- |
| PostgreSQL | `postgresql://user:pass@host:5432/db` | Browse databases, schemas, tables and views; full CRUD; SQL console |
| MySQL / MariaDB | `mysql://user:pass@host:3306/db` | Browse databases, tables and views; full CRUD; SQL console |
| SQL Server | `Server=host,1433;Database=db;User Id=…;Password=…` or `sqlserver://…` | Browse databases, schemas, tables and views; full CRUD; T-SQL console |
| SQLite | `sqlite:///path/to/app.db` (or **Browse…**) | Browse tables and views; full CRUD; SQL console |
| MongoDB | `mongodb://…` or `mongodb+srv://…` | Browse databases and collections; edit documents; mongosh-style console |
| Redis | `redis://…` or `rediss://…` | Browse keys by pattern and type; edit strings, hashes, lists, sets and sorted sets with TTLs; command console |

- **Data grid:** pagination, sorting, search across columns and filter conditions. MongoDB also takes a filter such as `{ age: { $gt: 21 } }`; Redis takes a key pattern such as `user:*`.
- **Editing:** a type-aware row editor with NULL and DEFAULT, an Extended JSON document editor (`ObjectId()` and `ISODate()` work), and a key editor per Redis type.
- **Query console:** SQL, `db.users.find({ … }).limit(20)` or Redis commands; <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs the selection or everything; copy results as JSON or CSV.
- **Saved connections** with a colour, a live status indicator, test and reconnect.

**Safe by default.** Connection strings live in your OS keychain (VS Code SecretStorage) and passwords are never shown again or included in error messages. Deleting rows and destructive statements (`DROP`, `TRUNCATE`, `DELETE`, `UPDATE` without `WHERE`, `deleteMany`, `FLUSHDB` …) ask first; dropping or emptying a table asks you to type its name. A **read-only** connection refuses every write, and on PostgreSQL and MySQL the database session itself is read-only. Tables without a primary key (on MySQL and SQL Server) and views are shown read-only rather than risk changing the wrong row.

## Security tools

**DevSnip Pro: Security Hub** puts four scans in one panel. Each finding carries the evidence it was based on, a severity and the fix; results are graded, filterable and exportable as Markdown or JSON.

- **Workspace audit:** hard-coded secrets, injection risks, weak cryptography and unsafe configuration in your source. Matched values are masked.
- **Cloud & container audit:** Terraform, Kubernetes, Docker Compose, Dockerfiles and GitHub Actions.
- **Dependencies & config:** lockfiles, unbounded ranges, abandoned or compromised packages, registry credentials, `.env` hygiene and CI security scanning.
- **Endpoint scan** of a URL you are authorised to test: TLS and certificates, HSTS, security headers, CSP, CORS, cookies, authentication behaviour, API hygiene, information exposure and rate limiting. Two read-only active checks (a reflected-input probe and well-known sensitive paths) are opt-in.

Everything runs locally except the endpoint scan, which only contacts the URL you enter.

**Try it:** open a project and run **DevSnip Pro: Workspace Security Audit**.

## Developer utilities

- **Snippets:** select code, run **DevSnip Pro: Create Snippet** and give it a prefix; it appears in IntelliSense (snippets ship for 39 languages). Browse and delete them with **DevSnip Pro: Saved Snippets**.
- **Clean up:** **Clean Console Logs** finds and removes `console.log` calls; **Remove Unused Imports** covers JavaScript, TypeScript, Python and Java.
- **Dependencies & Installation:** lists every dependency in the workspace with its declared range, installed version and the newest allowed and stable versions for npm, yarn, pnpm, pip, Maven and Gradle; installs and in-range updates run only after you confirm the exact command.
- **Formatters and converters:** JSON / YAML / XML formatter, diff checker, regex tester with a pattern library, case converter, encode/decode, timestamps, UUID and ID generator, JSON to TypeScript, Zod, Dart, Kotlin, Swift, Pydantic, Java, Go or JSON Schema.
- **README Viewer & Manager** with a live preview.

## OpenCode integration

**DevSnip Pro: OpenCode Integration** checks for Node.js and the OpenCode CLI, installs or repairs it via npm, and launches it in a terminal rooted at your workspace, on Windows, macOS and Linux.

![OpenCode Integration Hub showing Node.js and OpenCode installed](docs/images/opencode.jpg)

An install is only reported as successful once `opencode --version` actually runs. The panel also shows per-OS alternatives: npm, Homebrew, the install script, and Chocolatey or Scoop on Windows.

## Points & milestones

![Milestones and Points with rank, streak, daily boost and the Feature Explorer milestone](docs/images/milestones.jpg)

Using DevSnip Pro earns points, which move you up the ranks (Bronze to Grandmaster) and pay for a set of advanced REST API Client tools. There is no licence key, subscription, account or leaderboard: progress is personal and stored on your machine.

- **Earn:** any tool run (+3), creating a snippet (+10), a security audit (+8), an AI tool (+5), a daily login (+5) and a daily boost you claim (+10), plus one-time milestones such as Tool Explorer, Weekly Warrior and Feature Explorer.
- **Fair by design:** tool use earns up to 120 points a day, and repeated runs of the same tool earn less, so points reflect real use rather than clicking.
- **Spend:** each premium tool costs 8 to 35 points per run, charged **only after a run succeeds**.

Free tools include the full REST and GraphQL workflow, response inspection, history, environments, unlimited collections, cURL import and export, code generation, JWT decoding, JSON tools, and single AI requests with prompt testing, token costing, streaming and schema validation (capped at 25 AI requests, 25 prompt runs and 10 streamed responses a day).

## All tools by section

The **Tools** sidebar shows every tool in its section, with search, favorites and recently used; **DevSnip Pro: Browse All Tools** shows them as a searchable grid. Toolkit panels have presets, live results, and one-click **Copy**, **Insert at cursor**, **Open in editor** and **Save** (it always asks before overwriting).

| Section | Tools |
| :--- | :--- |
| **Backend & API** | REST API Client, cURL Converter, API Response Inspector, URL & Query String Tool, CORS Builder & Debugger, OpenAPI / Swagger Toolkit, GraphQL Formatter & Types, API Resource Scaffolder |
| **Web & Frontend** | React / Next.js Generator, HTML → JSX, CSS Units & Fluid Type, Color Converter & Palette, SEO & Social Meta Tags, Cache-Control Builder |
| **Mobile Development** | adb & simctl Commands, Deep Links & Universal Links, App Permissions, Local API from Devices, Environments & Flavors, Signing & Keystores, SDK & Build Compatibility, Mobile CI Workflow, dp / px / pt & Asset Sizes |
| **Code & Productivity** | Saved Snippets, Create Snippet, Clean Console Logs, Remove Unused Imports, Dependencies & Installation, README Viewer & Manager, OpenCode Integration |
| **Text & Formatters** | JSON / YAML / XML Formatter, Diff Checker, Regex Tester & Library, Case Converter & Text Tools |
| **Encoders & Converters** | Encode / Decode, Timestamp Converter, UUID & ID Generator, JSON to Types, Data Converter |
| **Database** | Database Client, SQL Formatter & Linter, SQL Query Helper, Database Connection Strings, SQL → MongoDB |
| **Testing & Debugging** | Build Error Explainer, Log Analyzer & Formatter, Mock Data Generator, JSON Schema Validator, Port & Network Toolkit |
| **Git & Version Control** | Git Command Recipes, .gitignore Generator, Semver & App Versions |
| **DevOps & Cloud** | Dockerfile, Docker Compose, docker run → Compose, CI Pipeline, .env Checker, Kubernetes & Helm, Cloud Deploy Workflow, Cron Expression Helper, Nginx, Health Check Endpoints, Terraform, PM2, Observability Starter |
| **Security & Auth** | JWT Decoder & Signer, Workspace Security Audit, Hash / HMAC / Webhooks, OAuth 2.0 & PKCE, CSP & Security Headers, Endpoint Security Scan, Cookie Inspector, Dependency & Config Check, Certificate & SSL Pinning, Cloud & Container Audit |
| **AI & ML** | Prompt Builder, LLM Models / Tokens & Cost, LLM Client Setup, LLM Output Cleaner & JSON Validator, LLM API Tester, JSON → TOON, AI App Starter, AI/ML Code Snippets, GPU Memory & Speed, Model Serving Starter, Model Metrics, Dataset Split Planner, Learning-Rate Schedule, Model Card |
| **Data & RAG** | Chunking Tester, RAG Pipeline Generator, Vector Store Setup, Embedding Model Guide, Retrieval Configuration, Context Window Budget, Grounded Prompt Assembler, Chunk & Index Size Calculator, Retrieval Evaluation, Answer Grounding Checker, Vector Similarity, Near-Duplicate Chunk Finder, Hybrid Search Fusion, Chunk Metadata Validator, Data Transformer, Data Profiler, JSON Lines Inspector, Schema Viewer & Diff, Partition Planner, Spark Cluster & Cost, Delta Lake Log Analyzer |

Generated configuration is checked by the test suite: YAML and JSON are parsed, TypeScript and JavaScript are compiled, Python is byte-compiled, and Compose files are validated with `docker compose config`.

## Installation

- **From VS Code:** open the Extensions view (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search for **DevSnip Pro** and click **Install**.
- **From the Marketplace:** [DevSnip Pro on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console).
- **From the command line:** `code --install-extension sayaib.hue-console`

Requires VS Code 1.93 or newer, on Windows, macOS or Linux.

## Quick start

1. Click the **DevSnip Pro** icon in the Activity Bar. The **Get started** card lists five first steps; each ticks itself off when you actually do it.
2. **Send a request:** open the **REST API Client**, paste a URL and press <kbd>Enter</kbd>.
3. **Check your code:** run **DevSnip Pro: Workspace Security Audit**.
4. **Connect a database:** open the **Database Client**, paste a connection string, **Test**, then **Save & connect**.
5. **Make it yours:** pick a theme from the **Theme** selector at the top of the sidebar.

Prefer a guided tour? Run **DevSnip Pro: Get Started**. After an update, the sidebar shows a short **What's new** card once; **DevSnip Pro: What's New** opens the full release notes any time.

![The Get started walkthrough in VS Code](docs/images/get-started.jpg)

## Settings

| Setting | Default | What it does |
| :--- | :--- | :--- |
| `devsnip.apiTimeout` | `30000` | Request timeout in milliseconds for the REST API Client. A per-request timeout overrides it. |
| `devsnip.consoleLogCleanup.confirmBeforeDelete` | `true` | Ask before removing `console.log` statements. |
| `devsnip.securityAudit.maxFiles` | `2000` | How many files each workspace, cloud or dependency security scan reads. |
| `devsnip.security.endpointTimeout` | `15000` | Default per-request timeout in milliseconds for the endpoint security scanner. |
| `devsnip.security.activeChecks` | `false` | Pre-enable the endpoint scanner's active checks. |
| `devsnip.analytics.enabled` | `true` | Send anonymous usage analytics. See [Privacy and analytics](#privacy-and-analytics). |
| `devsnip.analytics.debug` | `false` | Log every analytics event, exactly as sent, to the **DevSnip Pro: Analytics** output channel. |

**Keyboard shortcuts:** none are set by default, so nothing conflicts with your bindings. Add your own in **Preferences: Open Keyboard Shortcuts (JSON)**, for example `{ "key": "ctrl+shift+a", "command": "sayaib.hue-console.openGUI" }`.

## FAQ

**Is DevSnip Pro free?** Yes. Most features are free with no limits. A set of advanced REST API Client tools costs points, which you earn by using the extension; there is nothing to buy.

**Does it send my code anywhere?** No. Tools run locally. Network requests go only to the URLs and databases you enter. Anonymous usage analytics never include code, file names, URLs, inputs or outputs.

**Does it work offline?** Yes, except the parts that need a network by definition: API requests, database connections, the endpoint scan, AI provider calls and the OpenCode install.

**Will it slow down VS Code?** It is designed not to. The REST client, security analysers and dependency manager load only when you first open them, and the Database Client's drivers load when you connect.

**Can it replace my API client or database GUI?** For the everyday loop — sending requests, saving collections, browsing and editing tables, running queries — yes, inside VS Code. Dedicated tools still go further for team workspaces and database administration.

**Where are my credentials stored?** Database connection strings are in your operating system's keychain via VS Code SecretStorage. API keys typed into a request are used for that request and are not written to history or disk.

**Does it work in remote, WSL or vscode.dev?** Remote and WSL windows work, except the OpenCode hub, which needs a local process. Browser-only VS Code (vscode.dev) is not supported because several tools use Node APIs.

**How do I turn off analytics?** Set VS Code's `telemetry.telemetryLevel` to anything below `all`, or set `devsnip.analytics.enabled` to `false`.

## Troubleshooting

**A new snippet does not appear in IntelliSense.** VS Code loads snippets at startup; reload the window when the extension offers it.

**OpenCode is installed but not detected.** A VS Code window launched from the Dock or a desktop shortcut inherits a minimal `PATH`. Start VS Code from a terminal or add the directory to `PATH`, then press **Recheck System**. On Windows, if PowerShell blocks the launch, use the **Launch in Command Prompt** fallback.

**A security audit finds nothing in a large repository.** It reads up to `devsnip.securityAudit.maxFiles` files and skips dependency, build and cache folders. Raise the setting for very large repositories.

**The Database Client cannot connect.** The message says why: connection refused, host not found, authentication failed, or a TLS problem. For a local server with a self-signed certificate add `sslmode=no-verify` (PostgreSQL), `TrustServerCertificate=true` (SQL Server) or `tlsAllowInvalidCertificates=true` (MongoDB). SQL Server needs a SQL login; Windows authentication is not supported.

**A request never finishes.** Requests time out after `devsnip.apiTimeout`; use **Cancel** to stop one that is running.

**Points look wrong.** Progress is stored per machine. Corrupted data is repaired automatically when read, and **Reset progress** in Milestones & Points (under ⋯) clears it.

## Privacy and analytics

DevSnip Pro has no backend and no account. Requests go only to the URLs you enter; API keys you type are used for that request and are not written to history or disk; credential-looking values in a URL are redacted before a request is stored in history; database connection strings stay in the OS keychain. Of the toolbox tools, only the LLM API Tester uses the network, and it is marked "Uses network".

DevSnip Pro collects **anonymous** usage analytics — which features run, whether they succeed, how long sessions last, and which first steps new users complete — to learn what to improve. It never includes code, snippet contents, file names or paths, search queries, URLs, package names, error messages or anything that identifies you; each installation is a random ID. Nothing is sent unless VS Code's `telemetry.telemetryLevel` is `all`, and `devsnip.analytics.enabled` switches it off for DevSnip Pro only. Set `devsnip.analytics.debug` to see every event before it is sent. The complete event list is in [docs/ANALYTICS.md](docs/ANALYTICS.md).

## Documentation, source and feedback

- **Guides:** [docs/guides](docs/guides) — testing APIs in VS Code, database workflows, security checks, AI tools and more.
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Roadmap:** [docs/ROADMAP.md](docs/ROADMAP.md) · **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Source:** [github.com/sayaib/DevSnip-Pro](https://github.com/sayaib/DevSnip-Pro)
- **Report a bug or request a feature:** [GitHub issues](https://github.com/sayaib/DevSnip-Pro/issues/new/choose)
- **Release notes:** [CHANGELOG.md](CHANGELOG.md), or run **DevSnip Pro: What's New**
- **Online documentation:** [sayaibsarkar.net](https://sayaibsarkar.net/#/dev-snip-pro/document/en)

If DevSnip Pro saves you time, a rating or review on the Marketplace helps other developers find it.

Made by Sayaib Sarkar — [LinkedIn](https://www.linkedin.com/in/sayaib/)
