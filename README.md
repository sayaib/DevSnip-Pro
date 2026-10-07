## ☕ Support DevSnip Pro

If DevSnip Pro helps you code faster, consider supporting the project with a coffee! ❤️

<p align="center">
  <a href="https://www.buymeacoffee.com/ssayaibj">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" width="217" height="60">
  </a>
</p>

# DevSnip Pro — REST API Client & Database Client for VS Code

**A free REST API client for VS Code: send HTTP and GraphQL requests with environments, collections, cURL import and code generation, then check the result in a built-in database client for PostgreSQL, MySQL, SQL Server, SQLite, MongoDB and Redis.** It also includes LLM token and cost tools, a security scan for hard-coded secrets, and 100+ everyday developer utilities.

No account, no backend: everything runs locally unless a tool says otherwise.

**[Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console)** · or run `code --install-extension sayaib.hue-console`

![DevSnip Pro REST API Client in VS Code: a GET request with formatted JSON response, status, time and size](docs/images/rest-api-client.jpg)

## Get started in 60 seconds

1. Install DevSnip Pro and click its icon in the Activity Bar.
2. Open **REST API Client** from the sidebar (or run **DevSnip Pro: REST API Client** from the Command Palette).
3. Click **Send a sample request**, or paste any URL or cURL command and press <kbd>Enter</kbd>.
4. Next, connect a database: open **Database Client**, paste a connection string such as `postgresql://user:pass@localhost:5432/app`, then **Test** and **Save & connect**.

The sidebar's **Get started** card lists five first steps and ticks each one off when you actually do it. **DevSnip Pro: Get Started** opens the guided walkthrough.

## Contents

- [REST API client in VS Code](#rest-api-client-in-vs-code)
- [Database client for PostgreSQL, MySQL, MongoDB and Redis](#database-client-for-postgresql-mysql-mongodb-and-redis)
- [LLM token counter, cost estimates and AI tools](#llm-token-counter-cost-estimates-and-ai-tools)
- [Security scan: hard-coded secrets, containers, dependencies and endpoints](#security-scan-hard-coded-secrets-containers-dependencies-and-endpoints)
- [JSON formatter, JWT decoder, cURL converter and 100+ utilities](#json-formatter-jwt-decoder-curl-converter-and-100-utilities)
- [Code snippets, cleanup and OpenCode](#code-snippets-cleanup-and-opencode)
- [DevSnip Pro vs Postman and Thunder Client](#devsnip-pro-vs-postman-and-thunder-client)
- [FAQ](#faq) · [Settings](#settings) · [Troubleshooting](#troubleshooting) · [Privacy](#privacy-and-analytics) · [Guides](docs/guides/README.md)

## REST API client in VS Code

**DevSnip Pro: REST API Client** is an HTTP client and API testing tool inside VS Code. It handles the whole request cycle: choose a method, enter a URL, set headers, query parameters, a body and authentication, then send and inspect the response.

- All HTTP methods, plus **GraphQL** (query, variables and operation name) and **WebSocket**†.
- **Auth:** Bearer, Basic and API keys, and an OAuth 2.0 token helper†.
- **Environments** with `{{variable}}` substitution; **collections** in folders; request **history**.
- **cURL:** paste a cURL command into the URL bar to import it, or export any request as cURL.
- **Code generation** in JavaScript (fetch and Axios), Python, Go, Java or C#.
- **Response viewer** with formatting, search, headers, cookies, copy and save.
- **AI providers:** the correct request shape for OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint.
- **Testing†:** assertions, request chaining, batch performance runs, response comparison, mock servers and typed SDK export.

† Advanced tools, paid for with points you earn by using DevSnip Pro (see [Points & milestones](#points--milestones)). There is nothing to buy; everything else is free.

Guides: [How to test REST APIs in VS Code](docs/guides/test-rest-apis-in-vscode.md) · [How to test a GraphQL API in VS Code](docs/guides/test-graphql-api-in-vscode.md)

## Database client for PostgreSQL, MySQL, MongoDB and Redis

**DevSnip Pro: Database Client** is a SQL client for PostgreSQL, MySQL, SQL Server and SQLite, and a GUI for MongoDB and Redis. It connects with a connection string, detects the database and shows its databases, schemas, tables, collections or keys.

![DevSnip Pro Database Client in VS Code browsing a PostgreSQL table with pagination and filters](docs/images/database.jpg)

| Database        | Connection string                                                      | What you can do                                                                                               |
| :-------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| PostgreSQL      | `postgresql://user:pass@host:5432/db`                                  | Browse databases, schemas, tables and views; full CRUD; SQL console                                           |
| MySQL / MariaDB | `mysql://user:pass@host:3306/db`                                       | Browse databases, tables and views; full CRUD; SQL console                                                    |
| SQL Server      | `Server=host,1433;Database=db;User Id=…;Password=…` or `sqlserver://…` | Browse databases, schemas, tables and views; full CRUD; T-SQL console                                         |
| SQLite          | `sqlite:///path/to/app.db` (or **Browse…**)                            | Browse tables and views; full CRUD; SQL console                                                               |
| MongoDB         | `mongodb://…` or `mongodb+srv://…`                                     | Browse databases and collections; edit documents; mongosh-style console                                       |
| Redis           | `redis://…` or `rediss://…`                                            | Browse keys by pattern and type; edit strings, hashes, lists, sets and sorted sets with TTLs; command console |

- **Data grid** with pagination, sorting, search and filters; MongoDB filters such as `{ age: { $gt: 21 } }` and Redis key patterns such as `user:*`.
- **Editing:** a type-aware row editor with NULL and DEFAULT, an Extended JSON document editor (`ObjectId()`, `ISODate()`), and a key editor per Redis type.
- **Query console:** SQL, `db.users.find({ … }).limit(20)` or Redis commands; <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> runs the selection; copy results as JSON or CSV.
- **Safe by default:** connection strings live in your OS keychain (VS Code SecretStorage). Destructive statements ask first, dropping a table asks you to type its name, and a **read-only** connection refuses every write (on PostgreSQL and MySQL the session itself is read-only).

Guide: [How to connect to PostgreSQL, MySQL, MongoDB and Redis in VS Code](docs/guides/connect-to-postgresql-mysql-mongodb-redis-in-vscode.md)

## LLM token counter, cost estimates and AI tools

The AI tools run locally and need no API key.

![LLM token and cost estimate for one prompt across 18 chat models](docs/images/ai-tokens.jpg)

- **LLM Models, Tokens & Cost:** estimate tokens and per-request, daily and monthly cost across 18 chat models, or compare context windows and prices.
- **Prompt Builder:** fill a prompt template and check it for common mistakes.
- **LLM Output Cleaner & JSON Validator:** pull the JSON out of a model's reply, repair it and validate it.
- **JSON → TOON** to shrink structured data in prompts; **LLM Client Setup** and **AI App Starter** for project boilerplate.
- **RAG** (in **Data & RAG**): chunking tester, context window budget, vector store setup, retrieval evaluation, grounding checks and more.
- **Call real models** from the REST client: send prompts, stream replies and validate output against a schema for free; compare models side by side, benchmark them and test embeddings, vector databases and RAG pipelines with points†.

Guide: [How to count LLM tokens and estimate cost in VS Code](docs/guides/count-llm-tokens-and-cost-in-vscode.md)

## Security scan: hard-coded secrets, containers, dependencies and endpoints

**DevSnip Pro: Security Hub** puts four scans in one panel. Each finding carries its evidence, a severity and the fix; results are filterable and export as Markdown or JSON.

![Workspace security audit in VS Code finding a hard-coded API key, with severity and fix](docs/images/security.jpg)

- **Workspace audit:** a secret scanner for hard-coded API keys, tokens and passwords, plus injection risks, weak cryptography and unsafe configuration in your source. Matched values are masked.
- **Cloud & container audit:** Terraform, Kubernetes, Docker Compose, Dockerfiles and GitHub Actions.
- **Dependencies & config:** lockfiles, unbounded ranges, abandoned or compromised packages, registry credentials, `.env` hygiene and CI security scanning.
- **Endpoint scan** of a URL you are authorised to test: TLS, HSTS, security headers, CSP, CORS, cookies, authentication behaviour, information exposure and rate limiting. Two read-only active checks are opt-in.

Everything runs locally except the endpoint scan, which only contacts the URL you enter.

Guide: [How to find hard-coded secrets and security issues in VS Code](docs/guides/find-hardcoded-secrets-in-vscode.md)

## JSON formatter, JWT decoder, cURL converter and 100+ utilities

110 tools in 13 sections, all in the **Tools** sidebar with search (<kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd>), favorites and recently used. Toolkit panels have presets, live results, and one-click **Copy**, **Insert at cursor**, **Open in editor** and **Save**.

![All DevSnip Pro tools in one searchable grid, grouped into 13 sections](docs/images/all-tools.jpg)

- **Text & data:** JSON / YAML / XML formatter, diff checker, regex tester, case converter, encode/decode, timestamps, UUIDs, JSON to TypeScript, Zod, Pydantic, Go, Kotlin, Swift and more.
- **API helpers:** cURL converter, OpenAPI / Swagger toolkit, GraphQL formatter and types, CORS debugger, JWT decoder and signer, OAuth 2.0 & PKCE.
- **DevOps & cloud:** Dockerfile, Docker Compose, Kubernetes & Helm, Terraform, CI pipeline and Nginx generators, plus a cron expression helper. Generated configuration is checked by the test suite.
- **Web & mobile:** React / Next.js generator, HTML → JSX, SEO meta tags, adb & simctl commands, deep links, app signing and asset sizes.

The [full list of tools by section](#all-tools-by-section) is below.

Guide: [Format JSON, decode JWTs and other quick developer tools in VS Code](docs/guides/format-json-decode-jwt-in-vscode.md)

## Code snippets, cleanup and OpenCode

- **Snippets:** select code, run **DevSnip Pro: Create Snippet** and give it a prefix; it appears in IntelliSense. Ready-made snippets ship for 39 languages; **DevSnip Pro: Saved Snippets** lists yours.
- **Clean up:** **Clean Console Logs** finds and removes `console.log` calls; **Remove Unused Imports** covers JavaScript, TypeScript, Python and Java.
- **Dependencies & Installation:** every dependency with its declared range, installed version and newest allowed and stable versions for npm, yarn, pnpm, pip, Maven and Gradle; installs run only after you confirm the exact command.
- **OpenCode Integration:** checks for Node.js and the OpenCode CLI, installs or repairs it via npm, and launches it in a terminal at your workspace. An install is only reported as successful once `opencode --version` actually runs.

![OpenCode Integration Hub in VS Code showing Node.js and OpenCode installed](docs/images/opencode.jpg)

Guide: [How to install and use OpenCode in VS Code](docs/guides/opencode-in-vscode.md)

## DevSnip Pro vs Postman and Thunder Client

All three can send API requests from VS Code. They are built for different jobs, so pick by what you need.

|                                                                         | DevSnip Pro                                                |
| :---------------------------------------------------------------------- | :--------------------------------------------------------- |
| Account required                                                        | No                                                         |
| Where requests are stored                                               | Locally, in VS Code storage                                |
| HTTP, GraphQL                                                           | Yes, free                                                  |
| WebSocket, OAuth 2.0 helper, assertions, chaining, batch runs           | Yes, paid with points earned by use†                       |
| Environments, collections, history, cURL import/export, code generation | Yes, free                                                  |
| Import Postman or Insomnia collections                                  | No (cURL import only)                                      |
| `.http` / `.rest` files                                                 | No                                                         |
| Command-line runner for CI                                              | No                                                         |
| gRPC, SOAP                                                              | No                                                         |
| Team workspaces and sync                                                | No                                                         |
| Also included                                                           | Database client, security scans, LLM tools, 100+ utilities |

**Choose DevSnip Pro** if you work alone or locally, want no account, and also want a database client and everyday tools in the same extension. **Choose Postman or Thunder Client** if you need team sharing, collection import or a CI runner. **Choose REST Client** if you want requests as `.http` files in your repository. Features and plans of other tools change; check their pages for current details.

More: [Free Postman alternative in VS Code: which API client to use](docs/guides/postman-alternative-in-vscode.md)

## FAQ

**Is there a free Postman alternative inside VS Code?** Yes. DevSnip Pro's REST API Client is free, needs no account and covers the everyday loop: requests, environments, collections, history, cURL import and code generation. It cannot import Postman collections; paste requests as cURL instead.

**How do I test a GraphQL API in VS Code?** Open the REST API Client, switch the protocol from **HTTP** to **GraphQL**, set the method to `POST`, write the query and JSON variables, and send. See [the GraphQL guide](docs/guides/test-graphql-api-in-vscode.md).

**How do I connect to PostgreSQL (or MySQL, MongoDB, Redis) in VS Code?** Run **DevSnip Pro: Database Client**, paste a connection string, press **Test**, then **Save & connect**.

**How do I count tokens for an LLM prompt in VS Code?** Run **DevSnip Pro: LLM Models, Tokens & Cost** and paste the prompt. Counts are estimates; confirm prices with your provider.

**Does it support `.http` files?** No. Requests are built in a form and saved to collections.

**Is DevSnip Pro free?** Yes. Most features are free with no limits. A set of advanced REST API Client tools costs points, which you earn by using the extension; there is nothing to buy.

**Does it send my code anywhere?** No. Tools run locally. Network requests go only to the URLs and databases you enter. Anonymous usage analytics never include code, file names, URLs, inputs or outputs.

**Does it work offline?** Yes, except the parts that need a network by definition: API requests, database connections, the endpoint scan, AI provider calls and the OpenCode install.

**Will it slow down VS Code?** It is designed not to. The REST client, security analysers and dependency manager load only when you first open them, and the Database Client's drivers load when you connect.

**Where are my credentials stored?** Database connection strings are in your operating system's keychain via VS Code SecretStorage. API keys typed into a request are used for that request and are not written to history or disk.

**Does it work in remote, WSL or vscode.dev?** Remote and WSL windows work, except the OpenCode hub, which needs a local process. Browser-only VS Code (vscode.dev) is not supported because several tools use Node APIs.

**How do I turn off analytics?** Set VS Code's `telemetry.telemetryLevel` to anything below `all`, or set `devsnip.analytics.enabled` to `false`.

## Points & milestones

![Milestones and Points with rank, streak, daily boost and the Feature Explorer milestone](docs/images/milestones.jpg)

Using DevSnip Pro earns points, which move you up the ranks (Bronze to Grandmaster) and pay for the advanced REST API Client tools marked †. There is no licence key, subscription, account or leaderboard: progress is personal and stored on your machine.

- **Earn:** any tool run (+3), creating a snippet (+10), a security audit (+8), an AI tool (+5), a daily login (+5, plus 1 for every day of your streak, up to +15) and a daily boost you claim (+10), plus one-time milestones such as Tool Explorer, Weekly Warrior, Monthly Marathon and Feature Explorer.
- **Daily quests:** three new goals every day, such as "Try a tool you have never used" or "Run a security scan" (+10 to +20 each). Finish all three for a +15 bonus chest.
- **Streak freezes:** earn one every 7 streak days (hold up to 2) or buy one for 50 points. A freeze is used up automatically so a missed day does not break your streak.
- **Themes:** every theme except System Default is unlocked with points, from 25 points (Dark, Light, High Contrast) to 900 (Aurora). Solarized, Synthwave and Aurora also unlock free at Silver, Gold and Platinum, and Ember after a 14-day streak. Click a locked theme to preview it on every panel for 30 seconds before you spend anything. Some milestones unlock frames for your rank badge.
- **Fair by design:** tool use earns up to 120 points a day, and repeated runs of the same tool earn less. Quests and milestones are one-time bonuses outside that limit.
- **Spend:** each premium tool costs 8 to 35 points per run, charged **only after a run succeeds**.
- **Notifications:** rank-ups, rewards, milestones and finished quests show a short VS Code notification, plus a weekly recap. Set `devsnip.rewards.notifications` to `levelsOnly` or `off` to quieten them.

Free tools include the full REST and GraphQL workflow, response inspection, history, environments, unlimited collections, cURL import and export, code generation, JWT decoding, JSON tools, and single AI requests with prompt testing, token costing, streaming and schema validation (capped at 25 AI requests, 25 prompt runs and 10 streamed responses a day).

## Appearance themes

![Switching appearance themes: Dracula, Nord, Light, Cyberpunk and Monokai](docs/images/themes.gif)

Twelve themes restyle every DevSnip Pro panel in one click from the **Theme** selector at the top of the sidebar. System Default, which follows your VS Code theme (including VS Code's own high-contrast themes), is free; the others are unlocked with points you earn by using DevSnip Pro. The VS Code window itself keeps your own theme.

## All tools by section

| Section                   | Tools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Backend & API**         | REST API Client, cURL Converter, API Response Inspector, URL & Query String Tool, CORS Builder & Debugger, OpenAPI / Swagger Toolkit, GraphQL Formatter & Types, API Resource Scaffolder                                                                                                                                                                                                                                                                                                    |
| **Web & Frontend**        | React / Next.js Generator, HTML → JSX, CSS Units & Fluid Type, Color Converter & Palette, SEO & Social Meta Tags, Cache-Control Builder                                                                                                                                                                                                                                                                                                                                                     |
| **Mobile Development**    | adb & simctl Commands, Deep Links & Universal Links, App Permissions, Local API from Devices, Environments & Flavors, Signing & Keystores, SDK & Build Compatibility, Mobile CI Workflow, dp / px / pt & Asset Sizes                                                                                                                                                                                                                                                                        |
| **Code & Productivity**   | Saved Snippets, Create Snippet, Clean Console Logs, Remove Unused Imports, Dependencies & Installation, README Viewer & Manager, OpenCode Integration                                                                                                                                                                                                                                                                                                                                       |
| **Text & Formatters**     | JSON / YAML / XML Formatter, Diff Checker, Regex Tester & Library, Case Converter & Text Tools                                                                                                                                                                                                                                                                                                                                                                                              |
| **Encoders & Converters** | Encode / Decode, Timestamp Converter, UUID & ID Generator, JSON to Types, Data Converter                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Database**              | Database Client, SQL Formatter & Linter, SQL Query Helper, Database Connection Strings, SQL → MongoDB                                                                                                                                                                                                                                                                                                                                                                                       |
| **Testing & Debugging**   | Build Error Explainer, Log Analyzer & Formatter, Mock Data Generator, JSON Schema Validator, Port & Network Toolkit                                                                                                                                                                                                                                                                                                                                                                         |
| **Git & Version Control** | Git Command Recipes, .gitignore Generator, Semver & App Versions                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **DevOps & Cloud**        | Dockerfile, Docker Compose, docker run → Compose, CI Pipeline, .env Checker, Kubernetes & Helm, Cloud Deploy Workflow, Cron Expression Helper, Nginx, Health Check Endpoints, Terraform, PM2, Observability Starter                                                                                                                                                                                                                                                                         |
| **Security & Auth**       | JWT Decoder & Signer, Workspace Security Audit, Hash / HMAC / Webhooks, OAuth 2.0 & PKCE, CSP & Security Headers, Endpoint Security Scan, Cookie Inspector, Dependency & Config Check, Certificate & SSL Pinning, Cloud & Container Audit                                                                                                                                                                                                                                                   |
| **AI & ML**               | Prompt Builder, LLM Models / Tokens & Cost, LLM Client Setup, LLM Output Cleaner & JSON Validator, LLM API Tester, JSON → TOON, AI App Starter, AI/ML Code Snippets, GPU Memory & Speed, Model Serving Starter, Model Metrics, Dataset Split Planner, Learning-Rate Schedule, Model Card                                                                                                                                                                                                    |
| **Data & RAG**            | Chunking Tester, RAG Pipeline Generator, Vector Store Setup, Embedding Model Guide, Retrieval Configuration, Context Window Budget, Grounded Prompt Assembler, Chunk & Index Size Calculator, Retrieval Evaluation, Answer Grounding Checker, Vector Similarity, Near-Duplicate Chunk Finder, Hybrid Search Fusion, Chunk Metadata Validator, Data Transformer, Data Profiler, JSON Lines Inspector, Schema Viewer & Diff, Partition Planner, Spark Cluster & Cost, Delta Lake Log Analyzer |

Generated configuration is checked by the test suite: YAML and JSON are parsed, TypeScript and JavaScript are compiled, Python is byte-compiled, and Compose files are validated with `docker compose config`.

## Installation

- **From VS Code:** open the Extensions view (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>), search for **DevSnip Pro** and click **Install**.
- **From the Marketplace:** [DevSnip Pro on the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console).
- **From the command line:** `code --install-extension sayaib.hue-console`

Requires VS Code 1.93 or newer, on Windows, macOS or Linux. After an update, the sidebar shows a short **What's new** card once; **DevSnip Pro: What's New** opens the full release notes any time.

![The DevSnip Pro Get started walkthrough on the VS Code Welcome page](docs/images/get-started.jpg)

## Settings

| Setting                                         | Default | What it does                                                                                  |
| :---------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------- |
| `devsnip.apiTimeout`                            | `30000` | Request timeout in milliseconds for the REST API Client. A per-request timeout overrides it.  |
| `devsnip.consoleLogCleanup.confirmBeforeDelete` | `true`  | Ask before removing `console.log` statements.                                                 |
| `devsnip.securityAudit.maxFiles`                | `2000`  | How many files each workspace, cloud or dependency security scan reads.                       |
| `devsnip.security.endpointTimeout`              | `15000` | Default per-request timeout in milliseconds for the endpoint security scanner.                |
| `devsnip.security.activeChecks`                 | `false` | Pre-enable the endpoint scanner's active checks.                                              |
| `devsnip.analytics.enabled`                     | `true`  | Send anonymous usage analytics. See [Privacy and analytics](#privacy-and-analytics).          |
| `devsnip.analytics.debug`                       | `false` | Log every analytics event, exactly as sent, to the **DevSnip Pro: Analytics** output channel. |

**Keyboard shortcuts:** none are set by default, so nothing conflicts with your bindings. Add your own in **Preferences: Open Keyboard Shortcuts (JSON)**, for example `{ "key": "ctrl+shift+a", "command": "sayaib.hue-console.openGUI" }`.

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

- **Guides:** [docs/guides](docs/guides/README.md) — REST and GraphQL APIs, databases, LLM tokens, security scans, OpenCode and everyday tools.
- **Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Roadmap:** [docs/ROADMAP.md](docs/ROADMAP.md) · **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Source:** [github.com/sayaib/DevSnip-Pro](https://github.com/sayaib/DevSnip-Pro)
- **Report a bug or request a feature:** [GitHub issues](https://github.com/sayaib/DevSnip-Pro/issues/new/choose)
- **Release notes:** [CHANGELOG.md](CHANGELOG.md), or run **DevSnip Pro: What's New**

If DevSnip Pro saves you time, a rating or review on the Marketplace helps other developers find it.

Made by Sayaib Sarkar — [LinkedIn](https://www.linkedin.com/in/sayaib/)
