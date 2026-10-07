# DevSnip Pro 11.75.2: end-to-end QA report

Date: 2026-10-07. Platform: macOS (arm64), VS Code 1.140.0 for the integration runs, Node 22.

**Result: production-ready.** Every item below is PASS after the fixes listed. **FIXED** means the check failed during QA and passes after the fix.

## How it was tested

| Layer | What ran |
|:---|:---|
| Real VS Code | 56 integration tests. A new `all-commands.test.ts` runs every one of the 132 contributed commands and fails on any of these: a thrown error, an error notification, an unhandled rejection, a webview tool that opens no panel, or memory retained across open/close cycles (measured with forced GC). |
| Unit | 537 tests, including live CRUD against **PostgreSQL 16, MySQL 8.4, SQL Server 2022, MongoDB, Redis 7 and SQLite**. |
| Toolkit engine | 97 tools, **987 runs**: defaults, every built-in example, every option of every select, every toggle, every action, empty input, and malformed input (quotes, backslashes, NUL). Every generated TS/JS file is checked with the TypeScript parser, every Python file with `ast.parse` (92 files), and every JSON/YAML file with a parser. |
| Generated artifacts | Validated with the real tools in Docker: `actionlint` (12 GitHub workflows), `docker compose config`, `nginx -t` (4 configs), `kubeconform`, `helm lint` + `helm template`, `hadolint`, and `terraform fmt -check` + `terraform validate` with real providers (5 templates × 3 environments). |
| REST API Client | 42 live checks against local HTTP and HTTPS servers. 43 live checks of the points-priced tools, against mock OpenAI-compatible, OAuth and Qdrant servers. |
| Webview UIs | A bridge ran the real extension host code and served its real panels in a browser. 96 tool pages were driven (Run, all 57 presets, Copy, Reset). The REST client, Database Client, sidebar, Security Hub, Dependency Manager, Console Log Cleaner and hubs were clicked through end to end against real servers. |
| Security | 18 live checks: planted secrets, a clean file for false positives, IaC misconfigurations, real TLS endpoints (`badssl.com` expired and self-signed certificates, plain HTTP, an unresolvable host). |
| Lifecycle | Restart persistence (8 checks), the snippet survive-update flow, theme migration on update, and What's New after update. |

## Checklist

### Activation, lifecycle and performance
| Feature | Status | Notes |
|:---|:---|:---|
| Activation without errors | PASS | Loads 31 modules, about 13 ms of module time. |
| All 132 commands registered and runnable | PASS | Every command runs in real VS Code. |
| Lazy-loaded commands (REST, security, deps, snippets, hygiene, OpenCode) | PASS | |
| Restart: environments, history, collections, points, quests, theme, favorites | PASS | |
| Update: custom snippets restored | PASS | |
| Update: theme in use kept free; What's New shown once | PASS | |
| Memory across repeated panel open/close | **FIXED** | Closed panels stayed in memory until the next theme change. That was 3.7 MB retained per cycle, unbounded. Now flat (61.2 → 61.6 MB over 4 cycles of about 115 panels). |
| API compatibility with the declared minimum VS Code 1.93 | PASS | Compiles against `@types/vscode@1.93`. |

### REST API Client
| Feature | Status | Notes |
|:---|:---|:---|
| GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, query params, headers | PASS | |
| JSON, text and form bodies; inline JSON validation in the panel | PASS | |
| Bearer, API key (header and query) and Basic auth | PASS | |
| Basic auth with an empty password | **FIXED** | It wasn't sent at all. |
| 4xx/5xx shown as responses; timeout, refused connection, unknown host, invalid URL | PASS | Each has a clear title and hint. |
| Redirects (follow, off, loop) | PASS | |
| gzip, UTF-8, HTML and empty 204 responses | PASS | |
| Very large JSON response (9.7 MB) | **FIXED** | It was posted to the panel whole and could freeze it. Now truncated at 2 MB. |
| Binary responses (images) | **FIXED** | Shown as garbled text. Now described by type and size. |
| Cookies stored and sent back | PASS | |
| GraphQL (variables, operation name, invalid variables) | PASS | |
| Environments: create, edit, activate, `{{var}}` in URL and headers, undefined variable | PASS | Tested through the UI as well. |
| History: secrets redacted, capped at 50 | PASS | |
| Self-signed HTTPS rejected by default and allowed when turned off | PASS | |
| Cancel an in-flight request | PASS | Tested through the UI as well. |
| cURL paste-import (method, headers, body, Basic auth) | PASS | Tested through the UI. |
| Save to collection (UI) | PASS | |

### Points-priced REST tools
| Feature | Status | Notes |
|:---|:---|:---|
| Access control: refused with cost and shortfall; charged only on success; no charge on invalid runs | PASS | |
| Assertions, response diff, SDK export, mock generator, security headers scan, load test | PASS | |
| Collections and request chaining (token captured and passed to the next step) | PASS | |
| Batch test with concurrency | **FIXED** | Requests cancelled each other: 16 of 20 failed at concurrency 5. |
| Batch success rate | **FIXED** | Only HTTP 500 counted as a failure; 502, 503 and 504 counted as successes. |
| Batch and load runs vs history | **FIXED** | They flooded History and pushed out real requests. |
| OAuth client credentials | PASS | The token is stored in secrets and the page only sees a preview. A wrong secret gives a clear error. |
| LLM request, streaming, bad key, empty prompt, token estimate, JSON-output validation | PASS | |
| Compare models, benchmark, embeddings, vector search (Qdrant), RAG test, agent tool-call round trip, prompt eval | PASS | |
| Prompt versioning and diff; AI usage analytics | PASS | |

### Database Client
| Feature | Status | Notes |
|:---|:---|:---|
| PostgreSQL, MySQL, SQL Server, SQLite, MongoDB, Redis: connect, browse, filter, insert, update, delete | PASS | Live. |
| Wrong password, missing database, unreachable host (10 s timeout, no hang) | PASS | |
| Passwords never appear in errors or the connection list | PASS | |
| Read-only mode blocks writes in the console and still allows reads | PASS | Read-only MongoDB also refuses `runCommand`, a deliberate safe default. |
| Bad query shows the server's error | PASS | |
| UI: test connection, save, tree, open table, paging, search, insert row (checked in Postgres) | PASS | |
| Pager text "1 rows" | **FIXED** | |

### Toolkit tools (97)
| Feature | Status | Notes |
|:---|:---|:---|
| Every tool: defaults, examples and options; no crash on empty or malformed input | PASS | 987 runs. |
| Saved choice that is no longer an option (CI Pipeline, LLM Client Setup crashed) | **FIXED** | Falls back to the default for every tool. |
| SQL tools: unterminated quote | **FIXED** | It said "Something went wrong". Now a clear input error with its position. |
| App Signing CI snippet | **FIXED** | It wasn't valid YAML. |
| AI App Starter: model name escaping in generated code | **FIXED** | |
| Azure Web App Terraform | **FIXED** | Now `terraform fmt` clean. |
| All other generated workflows, Compose, nginx, K8s, Helm, Dockerfiles and Terraform | PASS | Passed the real validators. |
| UI: 96 pages render, Run, presets, Copy toast, Reset; no console errors | PASS | |

### Security
| Feature | Status | Notes |
|:---|:---|:---|
| Secrets (AWS, GitHub, Stripe, private key, DB URL), eval, SQL concatenation; secrets masked | PASS | |
| No false positives on env lookups or documented example keys | PASS | |
| Placeholder connection strings in `.env.example` | **FIXED** | They were reported as high-severity leaks. Real passwords are still reported. |
| Cloud/IaC: public S3, open SSH, privileged pod, `:latest`, secret in a Dockerfile | PASS | |
| Posture: compromised package, `.env` not ignored, no lockfile | PASS | |
| Endpoint scan: grades, expired/self-signed certificate, plain HTTP, unresolvable host | PASS | The public test sites were sometimes slow. The scanner reports a timeout instead of hanging. |
| Certificate inspector | PASS | |
| Security Hub UI: workspace, cloud and posture scans | PASS | |
| Security Hub unhandled action errors | **FIXED** | |

### Other features
| Feature | Status | Notes |
|:---|:---|:---|
| Tools sidebar: search, open a tool, favorite, theme picker, locked-theme preview | PASS | Against the real host. |
| Hubs (all), What's New, Get Started | PASS | |
| Milestones & Points: quests, freezes, rewards, recap, notifications | PASS | Unit tests plus UI. |
| Themes: locks, purchase, preview (30 s, status bar), migration | PASS | |
| Snippets: create, cancel, restore after update | PASS | |
| Snippets: duplicate prefix | **FIXED** | Now asks Replace or Keep both. |
| Dependency Manager: npm, pip and Maven against live registries | PASS | |
| Console Log Cleaner: finds active calls only; removes them; file saved | PASS | |
| Console Log Cleaner: blank lines | **FIXED** | It left blank lines behind. |
| Unused imports, README manager, OpenCode panel | PASS | |
| Settings (`apiTimeout`, `rewards.notifications` and the others read with their defaults) | PASS | |

## Not covered, or only partly

These were outside what could be verified on this machine, or need the user's accounts or devices:

- **Windows and Linux** were not run, only macOS. Path handling has unit tests with the platform separator.
- **The WebSocket client** was tested only for its points grant and URL validation, not a live socket session.
- **Real cloud deploys** (AWS, Azure, GHCR) were not run. The generated workflows and Terraform were validated, not executed against accounts.
- **OpenCode install and launch** spawn real processes. Only detection and the panel were exercised.
- **Native modal dialogs and the OS keychain**: the test host refuses modals, so confirmations were exercised through their cancel and accept code paths instead.
- **Toolkit "Insert at cursor", "Open" and "Save to workspace"** go through the same code that now reports failures in the panel. They were not driven in a real editor.
