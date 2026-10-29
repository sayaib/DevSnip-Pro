# Desktop and Web compatibility

DevSnip Pro uses one extension ID and Marketplace package. VS Code selects `out/extention.js` for the Node host and `out/browser/extension.js` for its browser worker. No platform setting is required. Desktop keeps the full navigation and all existing registrations.

The browser version provides offline formatters, converters, code/configuration generators, AI/token/RAG planning utilities, workspace analysis using VS Code's virtual filesystem, and editor debug-log actions. It uses the same sidebar, hub, tool forms, themes and local milestone storage. Declarative language snippets continue to work on both platforms.

## Architecture and adaptations

- `src/platform/capabilities.ts` is the command capability policy. Browser support is an explicit allowlist derived from toolkit metadata plus audited host commands. Unknown commands default to Desktop-only.
- `navigationFor` removes unsupported tools, empty sections, subcategories and journey steps. Sidebar favorites/recent lists, hub cards, search, onboarding links, daily tips, available quests/events and the milestone tool explorer use the same policy. Hidden favorites and usage records are preserved in storage.
- Resource URLs use `context.extensionUri` and `Uri.joinPath`. Workspace reads/writes use `workspace.fs`, TextEncoder and TextDecoder, retaining virtual filesystem schemes and authorities. Generated files and editor actions work with the workspace provider's permissions.
- Browser randomness uses Web Crypto; OAuth PKCE uses `crypto.subtle.digest`. A bundled byte codec supports existing text/binary engines without a Node runtime. Desktop crypto implementations are retained.
- Node-only toolkit definitions live behind `src/toolkits/desktop.ts`. The web bundler replaces that boundary with an empty tool list and replaces the random, OAuth and networking adapters. It rejects any resulting runtime import other than `vscode`; it does not provide fake filesystem, socket or process APIs.
- The browser entry point never imports Desktop activation, database drivers, native networking, process runners or snippet backup code. Tools open on demand. Browser analytics are disabled; usage/points remain local.
- Manifest enablement, palette/menu conditions and walkthrough steps gate Desktop-only commands before execution. The package contains both entry points and retains the existing publisher/name/settings identifiers. Workspace Trust requirements remain unchanged.

## Deliberately Desktop-only

The existing REST client promises arbitrary hosts, headers, cookies, WebSockets, network tests and provider calls. CORS and browser-controlled headers/cookies prevent equivalent behavior in a browser worker, so its full command is hidden. No request proxy is added. Live LLM testing and endpoint/dependency scans likewise require unrestricted networking or local resolution. Raw database clients require TCP, drivers and/or local SQLite storage. The spreadsheet viewer currently relies on Node archive handling. Custom snippet management writes installed extension files and performs local backups. Dependency installation/README management and legacy cleanup commands depend on local filesystem/process behavior. These remain available on Desktop. Static command builders (Docker, device commands, keystores, deployment workflows) produce text and remain available on Web; they never execute the generated commands.

JWT signing/verification, the complete hash/HMAC tool, X.509 inspection, local LAN discovery and TCP inspection remain Desktop-only; partially functional forms are not exposed.

## Validation

`npm run compile` typechecks Desktop and creates the single browser bundle. `npm run lint` and `npm run test:unit` cover existing functionality. `npm run test:web:smoke` executes the actual bundled browser code without process, Buffer, filesystem, Node crypto or Node module loading, checks activation and all visible command registrations, validates registry/sidebar/hub/palette parity, and runs each supported tool's defaults, examples and select options. Expected input-validation failures are accepted only for incomplete inputs; all examples must succeed.

`npm run test:web` uses the official @vscode/test-web runner with a Chromium browser and a writable virtual workspace. It also opens the sidebar, formatter and hub. Install its browser once with `npx playwright install chromium`. Set DEVSNIP_TEST_BROWSER to firefox or webkit after installing that browser to run the same suite there. `npm test` runs the Desktop Extension Development Host suite. `npm run package` builds both entry points through vscode:prepublish.

Before a Marketplace release, follow the [official sideload/testing workflow](https://code.visualstudio.com/api/extension-guides/web-extensions#test-your-web-extension) to load the unpacked extension on vscode.dev, and exercise the same tools in vscode.dev and github.dev with a virtual GitHub repository. The automated local browser host is not evidence of a completed test on either hosted service. Check sidebar/navigation/search, an OAuth PKCE example, a formatter, editor insert/copy, generated-file save, reload/state retention and the absence of Desktop-only commands. Publishing is a separate release action.

## Tool inventory

This inventory classifies the existing navigation before filtering. Web tools also remain available on Desktop.

| Section | Tool | Web support / Desktop-only reason |
| --- | --- | --- |
| Backend & API | REST API Client | Desktop filesystem, process, driver or unrestricted networking |
| Backend & API | cURL Converter | Supported |
| Backend & API | API Response Inspector | Supported |
| Backend & API | URL & Query String Tool | Supported |
| Backend & API | CORS Builder & Debugger | Supported |
| Backend & API | OpenAPI / Swagger Toolkit | Supported |
| Backend & API | GraphQL Formatter & Types | Supported |
| Backend & API | API Resource Scaffolder | Supported |
| Web & Frontend | React / Next.js Generator | Supported |
| Web & Frontend | HTML → JSX | Supported |
| Web & Frontend | CSS Units & Fluid Type | Supported |
| Web & Frontend | Color Converter & Palette | Supported |
| Web & Frontend | SEO & Social Meta Tags | Supported |
| Web & Frontend | Cache-Control Builder | Supported |
| Mobile Development | adb & simctl Commands | Supported |
| Mobile Development | Deep Links & Universal Links | Supported |
| Mobile Development | App Permissions | Supported |
| Mobile Development | Local API from Devices | Local network interface discovery |
| Mobile Development | Environments & Flavors | Supported |
| Mobile Development | Signing & Keystores | Supported |
| Mobile Development | SDK & Build Compatibility | Supported |
| Mobile Development | Mobile CI Workflow | Supported |
| Mobile Development | dp / px / pt & Asset Sizes | Supported |
| Code & Productivity | Saved Snippets | Desktop filesystem, process, driver or unrestricted networking |
| Code & Productivity | Create Snippet | Desktop filesystem, process, driver or unrestricted networking |
| Code & Productivity | Framework Snippets | Desktop filesystem, process, driver or unrestricted networking |
| Code & Productivity | Remove Unused Imports | Desktop filesystem, process, driver or unrestricted networking |
| Code & Productivity | Dependencies & Installation | Desktop filesystem, process, driver or unrestricted networking |
| Code & Productivity | Unused Dependencies | Supported |
| Code & Productivity | README Viewer & Manager | Desktop filesystem, process, driver or unrestricted networking |
| Text & Formatters | JSON / YAML / XML Formatter | Supported |
| Text & Formatters | XML → JSON Converter | Supported |
| Text & Formatters | Diff Checker | Supported |
| Text & Formatters | Regex Tester & Library | Supported |
| Text & Formatters | Case Converter & Text Tools | Supported |
| Encoders & Converters | Encode / Decode | Supported |
| Encoders & Converters | Timestamp Converter | Supported |
| Encoders & Converters | UUID & ID Generator | Supported |
| Encoders & Converters | JSON to Types | Supported |
| Encoders & Converters | Data Converter | Supported |
| Database | Database Client | Desktop filesystem, process, driver or unrestricted networking |
| Database | SQL Formatter & Linter | Supported |
| Database | SQL Query Helper | Supported |
| Database | Database Connection Strings | Supported |
| Database | SQL → MongoDB Query | Supported |
| Spreadsheets & CSV | CSV / TSV Viewer | Desktop filesystem, process, driver or unrestricted networking |
| Spreadsheets & CSV | Excel Viewer (.xlsx) | Desktop filesystem, process, driver or unrestricted networking |
| Testing & Debugging | Insert Debug Log | Supported |
| Testing & Debugging | Clean Debug Logs | Desktop filesystem, process, driver or unrestricted networking |
| Testing & Debugging | Run & Debug Configurations | Supported |
| Testing & Debugging | Build Error Explainer | Supported |
| Testing & Debugging | Log Analyzer & Formatter | Supported |
| Testing & Debugging | Mock Data Generator | Supported |
| Testing & Debugging | JSON Schema Validator | Supported |
| Testing & Debugging | Port & Network Toolkit | Local TCP port inspection |
| Git & Version Control | Git Command Recipes | Supported |
| Git & Version Control | .gitignore Generator | Supported |
| Git & Version Control | Semver & App Versions | Supported |
| DevOps & Cloud | Dockerfile | Supported |
| DevOps & Cloud | Docker Compose | Supported |
| DevOps & Cloud | docker run → Compose | Supported |
| DevOps & Cloud | CI Pipeline | Supported |
| DevOps & Cloud | .env Checker | Supported |
| DevOps & Cloud | Kubernetes & Helm | Supported |
| DevOps & Cloud | Cloud Deploy Workflow | Supported |
| DevOps & Cloud | Cron Expression Helper | Supported |
| DevOps & Cloud | Nginx Config | Supported |
| DevOps & Cloud | Health Check Endpoints | Supported |
| DevOps & Cloud | Terraform Starter | Supported |
| DevOps & Cloud | PM2 Ecosystem | Supported |
| DevOps & Cloud | Observability Starter | Supported |
| Security & Auth | JWT Decoder & Signer | Node cryptography for PEM/JWK signing and verification |
| Security & Auth | Workspace Security Audit | Desktop filesystem, process, driver or unrestricted networking |
| Security & Auth | OSV Vulnerability Scanner | Desktop filesystem, process, driver or unrestricted networking |
| Security & Auth | SCA Scanner | Desktop filesystem, process, driver or unrestricted networking |
| Security & Auth | Hash, HMAC & Webhooks | Node hash algorithms and webhook verification |
| Security & Auth | OAuth 2.0 & PKCE | Supported |
| Security & Auth | CSP & Security Headers | Supported |
| Security & Auth | Endpoint Security Scan | Desktop filesystem, process, driver or unrestricted networking |
| Security & Auth | Cookie Inspector & Builder | Supported |
| Security & Auth | Dependency & Config Check | Desktop filesystem, process, driver or unrestricted networking |
| Security & Auth | Certificate & SSL Pinning | Node X.509 certificate inspection |
| Security & Auth | Cloud & Container Audit | Desktop filesystem, process, driver or unrestricted networking |
| AI & ML | Prompt Builder | Supported |
| AI & ML | LLM Models, Tokens & Cost | Supported |
| AI & ML | LLM Client Setup | Supported |
| AI & ML | LLM Output & JSON | Supported |
| AI & ML | LLM API Tester | Provider requests and environment secrets require an unrestricted host |
| AI & ML | JSON → TOON for Prompts | Supported |
| AI & ML | AI App Starter | Supported |
| AI & ML | AI/ML Code Snippets | Supported |
| AI & ML | GPU Memory & Speed | Supported |
| AI & ML | Model Serving Starter | Supported |
| AI & ML | Model Metrics | Supported |
| AI & ML | Dataset Split Planner | Supported |
| AI & ML | Learning-Rate Schedule | Supported |
| AI & ML | Model Card | Supported |
| Data & RAG | Chunking Tester | Supported |
| Data & RAG | RAG Pipeline Generator | Supported |
| Data & RAG | Vector Store Setup | Supported |
| Data & RAG | Embedding Model Guide | Supported |
| Data & RAG | Retrieval Configuration | Supported |
| Data & RAG | Context Window Budget | Supported |
| Data & RAG | Grounded Prompt Assembler | Supported |
| Data & RAG | Chunk & Index Size Calculator | Supported |
| Data & RAG | Retrieval Evaluation | Supported |
| Data & RAG | Answer Grounding Checker | Supported |
| Data & RAG | Vector Similarity | Supported |
| Data & RAG | Near-Duplicate Chunk Finder | Supported |
| Data & RAG | Hybrid Search Fusion (RRF) | Supported |
| Data & RAG | Chunk Metadata Validator | Supported |
| Data & RAG | Data Transformer | Supported |
| Data & RAG | Data Profiler & Quality Check | Supported |
| Data & RAG | JSON Lines Inspector | Supported |
| Data & RAG | Schema Viewer & Diff | Supported |
| Data & RAG | Partition & File Size Planner | Supported |
| Data & RAG | Spark Cluster & Cost | Supported |
| Data & RAG | Delta Lake Log Analyzer | Supported |

## Local validation results

On 29 October 2026: 847 unit tests passed; the Chromium VS Code web host passed 94 tools and 855 variants, virtual workspace UTF-8 read/write, and an editor debug-log insertion; the Desktop integration suite passed 81 tests with 2 existing tests pending. The web bundle is about 1.38 MiB uncompressed and has no external runtime dependency except VS Code. The generated VSIX also installed successfully in an isolated Desktop profile, and its installed browser entry point passed the same real web-host suite. Hosted vscode.dev/github.dev smoke tests and Marketplace publication remain release checks.
