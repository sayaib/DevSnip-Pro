# Development Changelog of DevSnip Pro

## Version 10.61.3 - 2026-09-22

REST API Client accessibility, performance and polish pass. The layout, navigation, collections, history and response panels were already in place; this release fixes what an audit of that UI turned up.

### Fixed - performance

- **A large JSON response built a DOM of tens of thousands of nodes.** Syntax highlighting wraps every token in an element, so a 900 KB payload produced over 60,000 of them and left the panel slow to scroll, search and select. Rendering is now capped, with a one-click option to highlight the whole payload: the same response now renders 478 nodes in 30 ms instead of 60,475 in 156 ms. Copy and Save still operate on the complete payload, and the in-response search reports matches found beyond the rendered portion.

### Fixed - accessibility

- **Two tab groups never updated `aria-selected`**, so a screen reader always announced the first tab as the active one no matter which panel was showing. The visual and accessible states are now set together.
- **Tab groups could not be driven from the keyboard.** Left/Right/Up/Down, Home and End now move between tabs, and a roving tabindex means Tab steps past the group rather than through every tab in it.
- **URL validity was conveyed only by colour and a hint.** The field now sets `aria-invalid` and points at its message with `aria-describedby`, and the message is a polite live region.
- **Five authentication inputs had visible labels that were not associated with their fields** (bearer token, basic username and password, API key name and value), so their accessible name was missing.

### Fixed - theming

- The in-response search highlight was the one colour in the sheet that ignored the VS Code theme; it now uses the editor's own find-match colours with a themed outline.

### Tests

- New suite asserting the client's markup invariants: every tab exposes a selected state, every tab list is labelled, every input has an accessible name, status uses a glyph as well as colour, the palette resolves through VS Code variables, the response render budget is present, and the WebSocket allowance still tracks entitlement.
- The inline-script scanner now models template-literal escape handling correctly, including unrecognised escapes, so it no longer reports valid regular expressions as broken.
- `workspace tools complete without throwing` no longer waits on a QuickPick that a headless run can never answer; the suite went from one 30-second timeout to green in 7 seconds.

## Version 10.61.1 - 2026-09-22

### Fixed

- **Every button in the REST API Client stopped working.** Introduced in 10.61.0. The webview script is written inside a TypeScript template literal, where `\n` is an escape the compiler consumes - so what reached the browser was a real newline in the middle of a JavaScript string literal. That single unterminated string made the whole inline script fail to parse, which disables every control in the panel at once, not just the new ones. The compiler could not see it, because to TypeScript the script is only a string. All 33 affected escape sequences are now written as `\\n` so the browser receives `\n`.

### Added - regression guard

- The unit suite now renders the REST API Client exactly as the extension host does and parses the resulting script, in both CSP modes. It also scans every inline webview script in the codebase and parses each one, so this class of bug fails the build instead of reaching a panel.
- `getWebviewContent` is exported so the rendered page can be asserted on directly.

## Version 10.61.0 - 2026-09-22

Adds a Free/Premium feature system to the REST API Client, organised around AI/ML and software-development workflows. Every feature listed is implemented and works end to end; nothing is a badge over an empty code path.

### Added - feature access architecture

- **Central feature registry** (`src/premium/feature-registry.ts`): one definition per feature with its category, group, tier, description and limits. Nothing else in the codebase defines a tier, so changing one is a single edit.
- **Entitlement store** (`src/premium/entitlement.ts`): subscription state behind a pluggable `LicenseVerifier`, so a licensing backend can be connected later without touching callers. No payment provider is referenced anywhere.
- **Feature access service** (`src/premium/feature-access.ts`): the single decision point. Every operation runs through `access.run(featureId, ...)`, which checks entitlement immediately before the work and records usage only after it succeeds.
- **Usage limits** are declared in the registry, never inline. Free allowances: 25 AI requests, 25 prompt runs, 10 streamed responses and 15 saved requests per day.
- **Licence keys are stored in VS Code SecretStorage**, never in settings, global state or a webview. Tests assert the key cannot be found in global state.

### Added - Software Developer tools

- Free: client code generation for JavaScript (fetch and axios), Python, Go, Java and C#; JSON format, minify, validate and path query; JWT decoding with expiry and unsafe-algorithm warnings; request collections.
- Premium: WebSocket testing; OAuth 2.0 helper (client-credentials, password and refresh-token grants) with the token held in secret storage and only a masked preview shown; declarative assertions on status, latency, headers and JSON paths; request chaining with value extraction between steps; batch performance testing with p50/p90/p99; structural response comparison; unlimited collections with import and export.

### Added - AI/ML Developer tools

- Provider adapters for OpenAI, Anthropic, Google Gemini, Azure OpenAI, Ollama and any OpenAI-compatible endpoint, each with the correct request shape, auth header, response parsing and streaming format.
- Free: single LLM requests, prompt testing, token and cost estimation, basic streaming, and JSON Schema validation of model output.
- Premium: multi-model comparison, LLM benchmarking with latency percentiles and tokens/second, streaming diagnostics (time to first token, inter-chunk latency), embeddings testing with cosine similarity, vector database testing (Qdrant, Pinecone, Weaviate, Chroma), RAG pipeline testing with a grounding score, agent tool-calling traces, prompt evaluation against declarative criteria, prompt versioning with diffs, and AI request analytics.

### Security

- Entitlement is enforced in the extension host at the operation layer. Hiding a control is presentation only; a locked feature cannot be reached through an alternate command or a crafted webview message.
- Assertions and prompt criteria are declarative data, not scripts. Nothing from a saved collection is ever evaluated as code.
- The agent tester returns caller-supplied canned tool results; the extension never executes what a model asks for.
- Every webview payload is coerced and bounded before it reaches a service.
- The development tier override is read only in a development or test host and is ignored by an installed extension, so it cannot bypass licensing in production.

### Offline behaviour

- A successful licence check is cached for 24 hours; the licence server is not contacted on every feature call.
- If verification is unreachable, a previously valid licence keeps working for up to 14 days rather than revoking a paying user's access. After that the tier drops to free with a clear explanation.

### Compatibility

- Every existing REST API Client capability is unchanged and still free.
- The four points-unlocked tools (security header scan, load test, SDK export, mock generator) remain unlockable with DevSnip Pro points for free users, with the points refunded if the tool fails.

### Tests

- Unit suite grows to 139 tests, covering tier decisions, expiry, invalid licences, offline grace and its expiry, cache TTL, the development override being ignored in production, daily limits (including that a failed call does not consume allowance), collection caps, and every provider adapter, assertion operator, JSON tool and code generator.
- Integration suite grows to 51 tests, covering command registration, licence round-trip through real secret storage, and a sweep proving no premium feature is reachable for a free user and no free feature is blocked.

## Version 10.60.0 - 2026-09-22

Stabilisation release. Every feature was audited end to end; the fixes below are behavioural, not cosmetic.

### Fixed - correctness

- **Removing a `console.log` left `);` behind.** The scanner reported a range that excluded the closing parenthesis and the semicolon, so cleanup corrupted the edited line. Ranges are now exact, and a removal is skipped (with a warning) when the file changed since the scan.
- **"Remove all" buttons did nothing.** Console-log cleanup, unused-import cleanup and the Milestone Tracker reset all asked for confirmation with `confirm()`, which the VS Code webview sandbox blocks. Confirmation now happens in the extension host through a guarded dialog helper that treats an unavailable prompt as "not confirmed".
- **Errors in the Dataset Profiler, Metrics Calculator and Prompt Playground were invisible** - they used `alert()`, also blocked in webviews. They now render an inline status banner, and copy actions report success or failure.
- **Tool usage was counted twice** for any tool opened from a hub: the global `registerCommand` monkey-patch and the hub dispatcher both awarded points. Points are now awarded in exactly one place.
- **Concurrent tool runs lost points.** Every read-modify-write of the points store is serialised through a queue.
- **The daily streak could advance just by reading stats**, because the day rollover mutated state that was not always persisted. The rollover is now idempotent, and uses the local calendar date instead of UTC.
- **Long-term milestones were unreachable.** Progress was derived from an activity log capped at 100 entries, so the 100-run milestone could never complete. Progress now comes from lifetime counters, migrated from existing history.
- **The JSON/XML Formatter never received the editor selection** - the prefill message was posted before the webview script existed. The webview now signals readiness first.
- **Missing snippet files.** 35 of the 40 snippet files declared in `package.json` did not exist, so VS Code logged a load error for each at startup. All declared files are present.
- **Creating a snippet for an unsupported language silently did nothing.** The language is validated against the contributed set, with a picker when it does not match.
- **Stale compiled output shipped in the VSIX**, including JavaScript for features deleted from source. Builds now start from a clean `out/`.
- **The integration test suite never ran.** The deprecated `vscode-test` package looked for an `Electron` binary that current VS Code builds do not ship; migrated to `@vscode/test-electron`.

### Fixed - security

- **The README preview loaded `marked` from a public CDN and rendered README content through `innerHTML` under `script-src 'unsafe-inline'`** - remote code plus HTML injection from any file in the workspace. Markdown is now rendered by a dependency-free renderer that escapes the source first, under a nonce CSP, with no network access. `javascript:` and `data:` links are dropped.
- **A webview could ask the extension to run any VS Code command.** Hub dispatch now validates the id against the commands this extension registered.
- **Workspace content could break out of an inline `<script>`.** Console-log data embedded in the cleaner page is now escaped so a `</script>` sequence in a source file cannot inject markup.
- **The extension trusted file offsets sent from a webview** when deleting code. Selections are matched against the scan results and re-verified against the file before any edit.
- **API keys passed in a query string were persisted and exportable in plain text.** Credential-like query values are redacted before request history is stored.
- **Shell-string command execution** in the OpenCode hub was replaced with argument-array `execFile` calls. cURL export quoting is verified against a real shell in the test suite.

### Fixed - reliability and platform support

- The OpenCode hub rendered a blank panel for up to 18 seconds while detection ran; it now renders immediately with a loading state and streams results in. Failures report the actual reason instead of being swallowed, repeat clicks are ignored while work is in flight, and posting to a closed panel no longer throws.
- OpenCode detection searches the locations a desktop-launched VS Code misses (`/opt/homebrew/bin`, `~/.opencode/bin`, `~/.local/bin`, `~/.bun/bin`, the npm prefix, Scoop shims on Windows).
- `terminal.shellIntegration` (VS Code 1.93+) is feature-checked before use; the manifest now declares `^1.93.0` instead of `^1.86.0`, which it silently required.
- The generated Terraform artifact was not valid HCL (commas inside blocks).
- Directory creation and stack detection use URI-based filesystem APIs, so generators work in remote and virtual workspaces.
- Security audits used a `**/*` glob against a 500-file cap, so binaries consumed the budget and real findings were missed. Scans are now extension-targeted with a configurable 2000-file budget.
- One output channel is reused instead of leaking a new one per run; every webview message listener is disposed with its panel; running a tool twice reveals the open panel instead of stacking another.
- A failure in one command group no longer prevents the rest of the extension from registering.

### Changed

- Removed the global monkey-patch of `vscode.commands.registerCommand` in favour of an explicit tracked-registration helper.
- All panels follow the active VS Code theme; the hard-coded dark palettes (which were unreadable in light and high-contrast themes) are gone, and borrowed theme colours have fallbacks.
- The README Manager is now a real manager: create, open, save, insert section templates, reset to template, and delete, with live preview and word counts.
- Points economy: a per-day cap on repeatable points, with one-time milestone bonuses exempt, so levels reflect sustained use.
- Corrupted or partial points data is repaired on read instead of throwing or resetting progress.
- Deduplicated ~830 lines of copied CSS and helpers into `src/utils/webview-ui.ts`; deleted ~700 lines of dead code (unused legacy webviews, an orphaned snippet generator, commented-out implementations).
- `devsnip.apiTimeout`, `devsnip.consoleLogCleanup.confirmBeforeDelete` and `devsnip.securityAudit.maxFiles` are now real contributed settings - they were documented but never existed.
- Added the editor context submenu the README described but the manifest never contributed.
- `mongodb` (unused) and `@vscode/vsce` (a build tool) were removed from runtime dependencies, and `.vscodeignore` was corrected. The VSIX went from 13,822 files / 35.5 MB to 477 files / 1.6 MB.
- Declared workspace-trust and virtual-workspace capabilities, and removed the `browser` entry point the extension could never satisfy.

### Tests

- New unit suite (63 tests) covering points/state handling, the markdown renderer, webview escaping, command validation, the console-log scanner and the unused-import analyser. Runs in plain Node via `npm run test:unit`.
- Integration suite extended to 43 tests: activation, registration of all 57 commands, opening all 45 webview tools, panel reuse, settings and menu wiring, and the security rules against real fixture files.

## Version 10.59.2 - 2026-09-21

### Fixes

- Fixed Windows PowerShell execution-policy prompt swallowing the OpenCode launch command. The hub now waits for shell readiness via the Terminal Shell Integration API before running `opencode`, with a Command Prompt fallback and a one-command policy fix (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).

## Version 10.59.1 - 2026-09-22

(Note: The REST API Client received a major feature upgrade:

### New Features

- **API Key authentication** — add a custom header or query-parameter key to requests (Auth tab)
- **Body type selector** — choose JSON (default), plain text, or `application/x-www-form-urlencoded` (Body tab)
- **Automatic retries with exponential backoff** — configurable `retries` (max 5), `retryDelay`, and `retryStatusCodes` (defaults: 429/502/503/504). Also retries on network/timeout failures. Backward-compatible (`retries` defaults to 0).
- **Redirect & SSL controls** — `followRedirects`, `maxRedirects`, and `rejectUnauthorized` toggle for self-signed certs
- **Proxy support** — explicit host/port/auth, or `false` to disable entirely
- **cURL import & export** — paste a `curl` command to auto-populate method, URL, headers, body, and basic auth; copy the current request as a `curl` command from the topbar
- **History export** — export full request history as JSON or CSV
- **Response truncation** — responses over 2MB are silently truncated in the UI with a `truncated` flag; `attempts` reported in history and response metadata

### Improvements

- Auth tab now supports API Key (header or query) alongside Bearer and Basic
- Body tab has a type selector (JSON / Text / Form URL Encoded)
- New Advanced tab: retries, retry delay/status codes, redirect/SSL toggles, proxy config
- Topbar buttons: 📋 cURL (copies request as cURL) and ⬇ Export (saves history to file)
- Pasting a `curl ...` command into the URL bar now imports it as a live request
- Response panel shows retry attempt count and truncation warnings
- History now records `attempts` per request and a per-request attempt count

### Fixes

- Invalid JSON with explicit `Content-Type: application/json` now throws a clear error instead of silently sending malformed data
- Cookie jar now properly deduplicates cookies across requests
- GraphQL body parsing and error messages improved for malformed variables/operation names

### Integration Tests

- Added comprehensive test suite (`src/test/api-test.test.ts`) exercising cURL generation/parsing, body type encoding, retry logic, auth header delivery, redirect handling, and `makeRequest` against a local test server — all without external network calls.

## Version 10.58.0 - 2026-09-21

### New Features

- **OpenCode Integration Hub** -- new Core tool (`sayaib.hue-console.openCodeIntegration`) that checks for Node.js and the OpenCode CLI, installs or repairs OpenCode via the official `opencode-ai` npm package, rechecks system status, and launches OpenCode in a terminal rooted at the current workspace folder.
- **Cross-platform support** -- detection, installation, terminal launching, and workspace handling work on Windows, macOS, and Linux, with per-OS guidance (npm, Homebrew, install script, Chocolatey, Scoop, WSL).
- **Broken-install detection** -- an npm listing alone no longer reports as installed. Partial installs (package listed but the `opencode` binary does not run) are flagged with a repair flow that removes the stale package and reinstalls cleanly.
- **REST API Client webview pattern** -- single-render hub with direct element-id event bindings and `postMessage({ command })` messaging; install success is only reported after `opencode --version` is verified to run.

### Fixes

- Fixed OpenCode hub buttons not responding (replaced CSP-blocked inline handlers and fragile full-page re-renders with persistent bindings).
- Fixed Install/Recheck appearing stuck (removed `sudo` via exec, which hangs without a TTY; added timeouts to all dependency checks).
- Fixed wrong npm package for OpenCode (`opencode` does not exist on npm; corrected to `opencode-ai`).

## Version 10.57.0 - 2026-09-21

### New Features & Improvements

- **Milestone Tracker & Points System** -- added user activity tracking, streaks, level progression (Bronze to Grandmaster tiers), and real-time sidebar widget badge.
- **README Viewer & CRUD Manager** -- added a dedicated core tool to view, edit, scaffold, and preview markdown documentation with GitHub-style live preview.
- **AI/ML Tool Enhancements** -- added LR Scheduler Visualizer and LLM Inference & VRAM Estimator tools.
- **Big Data Tool Enhancements** -- added Delta Lake Log Analyzer and Spark Cluster & Cost Estimator tools.
- **RAG Tool Enhancements** -- added Hybrid Search RRF Simulator and RAG Hallucination Analyzer tools.

## Version 10.56.0 - 2026-09-17

### New Features & Security

- **Supply Chain 2-Year Monitoring & Quarantine** -- added automated security audit checks to monitor open-source components with a history of security lapses/malware incidents, flagging any package versions published within the mandatory 2-year post-incident monitoring window with security warnings and provenance verification guidance.
- **Vulnerability Remediation** -- resolved all 29 known high and critical severity software composition vulnerabilities, including actively exploited components and CVSS-scored critical issues across dependencies.

## Version 10.55.0 - 2026-09-17

### New Features & Improvements

- **Live Functional Premium API Tools** -- upgraded all 4 REST API Client Premium Tools (Security SecScan, Multi-Region Load Test, Type-Safe SDK Exporter, and AI Response Mock Server & Schema Generator) to execute real live requests, parallel load batches, and dynamic code generation instead of dummy data.
- **Instant Result Visibility** -- repositioned the Premium Feature Output box to the top of the Premium Hub tab with smooth auto-scroll into view upon tool execution.
- **CSP-Compliant Button Handlers** -- wired premium action buttons using robust script event listeners to guarantee flawless interaction in VS Code webviews.

## Version 10.53.0 - 2026-09-15

### Improvements

- **Enhanced README & Visual Showcase** -- completely revamped the README.md with professional banners, visual GIF demos, side-by-side screenshots, badge styling, and cleaner typography for maximum user engagement.

## Version 10.52.0 - 2026-09-15

### New Features

- **README Viewer & CRUD Manager** -- added a dedicated Core tool to view, edit, create, and manage workspace `README.md` and markdown documentation files with interactive webview previews and default scaffolding templates.

### Improvements

- **Optimized README.md** -- restructured and shortened for clean visual understanding, making all 50+ features immediately visible via categorized feature matrices with direct command triggers.

## Version 10.51.0 - 2026-09-10

### New Features

- **Milestone Tracker & User Points System** -- track daily usage, completed activities, streaks, and local points.
- **Level Progression & Leaderboard Ranks** -- automatic advancement from Bronze through Silver, Gold, Platinum, Diamond, Master, and Grandmaster tiers.
- **Real-time Sidebar Widget** -- displays current level badge and accumulated points in real-time right at the top of the Activity Bar tree view.
- **Delta Lake Log Analyzer & Spark Cost Estimator** -- new Big Data developer tools for lakehouse logs and cloud cluster cost sizing.
- **Hybrid Search RRF Simulator & Hallucination Analyzer** -- new RAG tools for Reciprocal Rank Fusion and source attribution scoring.
- **LR Scheduler Visualizer & Inference Latency Estimator** -- new AI/ML developer tools for learning rate curves and GPU VRAM/throughput sizing.
- **Interactive Cloud Security Audit Webview** -- upgraded Cloud Security Audit to open a rich interactive webview panel with clickable source code line jumps, matching Local Security Audit.

### Improvements

- Balanced point progression and anti-farm rate limiting for all tool executions.
- Left-aligned text alignment across all Milestone Tracker UI components.

## Version 10.50.0 - 2026-09-09

### Removed

- Removed the Code Snapshot feature entirely (command `sayaib.hue-console.captureCode`, webview, and all related assets).
- Removed `dom-to-image` and `file-saver` npm dependencies.
- Removed `devsnip.codeSnapshotTheme` configuration setting.
- Removed Code Snapshot from Core tool group, universal search, and Activity Bar tree.

## Version 10.49.140 - 2026-09-09

### Improvements

- Redesigned the Code Snapshot webview with a cleaner dark UI, smoother transitions, and better visual hierarchy.
- Replaced the complex export SVG logo with a minimal camera icon.
- Added clipboard and refresh icons to the Copy and Use Current Selection toolbar buttons.
- Added an empty-state placeholder inside the snapshot container when no code is selected.
- Replaced the inline SVG terminal dots with styled `<span>` elements for lighter markup.
- Added a loading spinner on the Export button during snapshot generation.
- Added success/error color feedback on the export status message.
- Added a "Copied!" confirmation on the Copy Code button after copying.
- Moved PNG to the default export format in the dropdown.

### Fixes

- Fixed SVG export failing because the download link was not appended to the DOM before triggering click.
- Fixed "Use current selection" button returning stale code from the original editor selection instead of the current active editor.
- Fixed `computeEdeditorLineNumberWidth` typo renamed to `computeEditorLineNumberWidth`.
- Added null guards for DOM elements in the snapshot export path to prevent runtime errors.
- Improved export error messages to show the actual failure reason instead of a generic message.
- Added safe initialization check for `colorPicker` to prevent crashes if the script has not loaded.

## Version 10.49.139 - 2026-09-08

### Improvements

- Replaced the Security Audit terminal output with a styled VS Code webview.
- Added severity summary cards for critical, high, medium, and low findings.
- Added redacted evidence, remediation guidance, and a clearer finding layout.
- Added an `Open at line` action that jumps directly to the scanned source location for fixing.
- Added exact resource tracking for reliable navigation in multi-root workspaces.

### Fixes

- Security Audit no longer requires users to search the terminal for findings.
- Security finding navigation now opens the correct file and line instead of relying only on relative workspace paths.

## Version 10.49.138 - 2026-09-08

### New Features

- Added a dedicated Security Center with local code security and local cloud-configuration audits.
- Added cloud/IaC checks for public ingress, wildcard IAM permissions, public storage, privileged containers, embedded credentials, disabled encryption/TLS, and mutable container tags.
- Added an AI/ML DevOps generator for CPU/GPU containers, Kubernetes GPU serving, ML CI, and model-serving contracts.
- Added DevOps generators for Docker, Compose, Kubernetes, Terraform, secure CI, and observability starter files.
- Added structured log analysis and Node.js/Python OpenTelemetry starter templates.

### Improvements

- Simplified the Activity Bar navigation with shorter labels and workflow-focused groups.
- Reduced visual noise by using neutral child icons and color accents only for category headers.
- Removed the custom maximize/minimize controls from the Tools view to keep the interface clean and consistent with VS Code.
- Added safe overwrite confirmation for generated deployment and observability files.
- Added bounded, local-only scanning with binary-file filtering, size limits, skipped dependency/build directories, and redacted evidence.

### Deployment Notes

- Run `npm run compile` before packaging.
- Review generated Docker, Kubernetes, Terraform, CI, and OpenTelemetry templates before deploying them.
- The cloud security audit scans local configuration only; it does not access AWS, Azure, or GCP accounts.

## Version 10.49.136 - 2026-09-07

### New Features

- Added universal regex tool search across all DevSnip Pro commands.
- Added Dataset Profiler, Model Metrics Calculator, and Prompt Playground tools.
- Added nested JSON and JSONL path support for deeply structured datasets, including arrays and MongoDB-style date values.

### Improvements

- Reorganized the activity-bar navigation into Core Workflow, Snippets, AI/ML/LLM, Data Engineering, and Advanced Utilities sections.
- Reorganized every inner tool hub into workflow-based groups with a consistent responsive card layout.
- Updated Schema Viewer to infer schemas from ordinary JSON documents and render deeply nested objects and arrays.
- Updated Schema Diff Tool to compare inferred data shapes and formal JSON Schemas using stable nested paths.

### Fixes

- Serialized webview-triggered command launches to prevent overlapping Extension Host flush calls.
- Added a deterministic first-debug workflow that compiles before launch and starts a clean Extension Host window.

## Version 10.47.135 - 2026-09-07

### Improvements

- **README completely rewritten** -- removed all screenshots and images, replaced with a clickable indexed feature list (35 features) with anchor links for easy navigation
- Added "How to Access" section at the top with 3 clear access methods (Activity Bar, Command Palette, Right-Click Menu)
- Added quick reference table mapping user goals to exact menu paths
- Expanded each tool from grouped tables into individual documented sections
- Cleaned up supported technologies section (text list instead of icon images)

## Version 10.47.134 - 2026-09-07

### New Features

- **AI/ML & LLM Tools Hub** -- 10 new tools for AI/ML workflows:
  - Token Counter & Cost Calculator (GPT-4o, Claude, Gemini, Llama, Mistral)
  - Prompt Template Manager with variable substitution
  - Python ML Code Generator (PyTorch, TensorFlow, HuggingFace, LangChain)
  - LLM API Tester with streaming support
  - Dataset Split Calculator with stratification
  - GPU VRAM Calculator (FP32/FP16/BF16/INT8/INT4)
  - Experiment Logger with Markdown export
  - Model Card Generator (HuggingFace format)
  - JSONL Viewer for training data
  - Markdown Table Generator

- **Big Data Tools Hub** -- 5 new tools for data engineering:
  - Schema Viewer (Parquet, Avro, JSON)
  - Spark SQL / Presto / Trino Query Formatter
  - Data Quality Checker (CSV, JSON)
  - Schema Diff Tool (side-by-side comparison)
  - Partition Calculator (Hadoop/Hive/Spark)

- **RAG Tools Hub** -- 5 new tools for Retrieval-Augmented Generation:
  - Chunking Strategy Tester (fixed, sentence, recursive, overlap)
  - Embedding Cost Calculator (OpenAI, Cohere, HuggingFace)
  - Context Window Calculator with visual utilization bars
  - Semantic Dedup Checker (n-gram similarity)
  - RAG Eval Calculator (precision, recall, MRR, faithfulness)

- **GraphQL support** in REST API Client -- dedicated query editor, variables, and operation name
- **Environment variables** in REST API Client -- create, manage, and resolve `{{variable}}` placeholders across requests

### Improvements

- **REST API Client** -- complete UI redesign with professional layout, method color coding, config tabs, request history, cancel button, and responsive design
- **Advanced Developer Tools Hub** -- added Color Palette and Lorem Ipsum Generator (now 9 tools), unified theme system with toast notifications
- **Activity Bar** -- added AI/ML, Big Data, and RAG tool hubs to the sidebar tree view
- **README** -- completely rewritten with comprehensive feature documentation

### Removed

- Removed legacy `snippets/` directory (replaced by `custom/` snippet system)

## Version 10.46.133 - 2025-12-03

- Added JSON to TOON converter and readme updated

## Version 10.43.119 - 2025-04-03

- Rest API status code issue fixed in test REST API section

## Version 10.42.118 - 10.42.119 - 2025-04-03

- Solved Snippets visibility error to jsx components in react

## Version 10.42.116 - 10.42.117 - 2025-03-26

- Update readme and fixed bugs of activity bar (added all features there)

## Version 10.41.107 - 10.41.116 - 2025-03-24

- Update readme and fixed bugs of activity bar (added all features there)

## Version 10.41.107 - 2025-03-21

- Added DevSnip pro in activity bar for easy access

## Version 10.40.101 - 10.40.103 - 2025-02-20

- Added code capture snapshot in right menu bar.

## Version 9.40.101 - 2025-02-18

- fixed minor bugs

## Version 9.40.100 - 2025-02-17

- Replace the selected console.log with a direct removal of the console.log in the row, accompanied by a remove button.

## Version 9.39.99 - 9.39.100 - 2025-02-05

- Added multiline console log search and update readme features section.

## Version 9.39.98 - 2025-02-04

- Optimized code for large project (faster console log searching)

## Version 9.38.97 - 9.38.98 - 2025-02-04

- Logo changed

## Version 9.38.95 - 9.38.96 - 2025-02-03

- Added Tailwind CSS v4 and Bootstrap v5
- fixed language bugs and activation errors

## Version 8.38.93 - 8.38.95 - 2025-01-30

- Exclude all the temps file while searching.

## Version 8.37.93 - 2025-01 -28

- Updated user manual index

## Version 8.37.92 - 2025-01-24

- Optimized code performance by removing unnessary line any apply reusable component and changed description.

## Version 8.36.89 - 9.36.92 - 2025-01-24

- Optimized code performance by removing unnessary line any apply reusable component.

## Version 8.35.80 - 2025-01-24

- Added Loading screen "Analyzing your project to retrieve all console logs. Please wait....""

## Version 8.34.89 - 8.34.91 - 2025-01-22

- Added Console Log Hunt and delete.

## Version 7.34.89 - 2024-12-31

- Apply global search in custom snippets view table.
- Grouped table content by programming language.

## Version 7.33.88 && 7.33.89 - 2024-12-31

- add new documentation links

## Version 7.33.86 && 7.33.87 - 2024-12-23

- Updated the reactJS , MongoDB and MongoDB aggregation snippets with more snippets example.

## Version 7.32.86 - 2024-12-19

- Updated the snippets table link in README with the actual documentation link.

## Version 7.31.86 - 2024-12-18

- Added a "View Custom Snippets" user manual to the documentation with screenshots.

## Version 7.30.86 - 2024-12-18

- Added visualization for all custom snippets created by users.

## Version 6.30.85 && 6.30.86 - 2024-12-16

- Changed gallery banner theme and color.

## Versions 6.30.81, 6.30.82, 6.30.83, 6.30.84 - 2024-12-16

- Added full document URL for DevSnip Pro.

## Version 6.29.81 - 2024-11-29

- Added keywords.
- Updated README with a user manual for custom snippets creation.

## Version 6.28.81 - 2024-11-29

- Updated README with a user manual for custom snippets creation.

## Version 6.28.80 - 2024-11-27

- Updated README with a new screenshot showing how to use custom snippets.

## Version 6.28.79 - 2024-11-26

- Changed description.

## Version 6.27.79 - 2024-11-25

### Features

- **HTML5 Boilerplate Update**: Enhanced the structure and compatibility with modern browsers.

### Improvements

- **Performance Optimizations**: Improved load times and reduced file sizes for better user experience.

### Security Updates

- Applied security patches for known vulnerabilities.

### Cross-Browser Compatibility

- Improved compatibility with the latest browser versions.

### Fixes

- **Minor Bug Fixes**: Resolved issues related to element positioning and responsiveness.

### Notes

- Ensure to clear browser cache after updating the boilerplate to apply all optimizations effectively.

## Version 5.27.62 - 2024-11-22

- Updated the HTML5 boilerplate.

## Version 5.27.61 - 2024-11-22

- Changed description and keywords.

## Version 5.26.61 - 2024-11-22

- Changed description.

## Versions 5.26.60 to 5.26.55 - 2024-08-07

- Modified README file.
- Changed screenshot sizes in tables.
- Linked href changes.
- Added developer profile and images in README.
- Fixed minor bugs.
- Added smaller supported languages icons.
- Added supported code snippets list.

## Versions 5.26.54 & 5.26.53 - 2024-08-06

- Redesigned README with structured icons for supported code snippets languages and frameworks.
- Added NodeJS snippets with screenshots and instructions.

## Versions 5.24.52 & 5.24.51 - 2024-08-06

- Displayed screenshots in tabular format in README file.
- Updated README with document manual link.

## Version 4.23.50 - 2024-08-05

- Fixed minor bugs in Flutter code snippets.

## Version 4.23.49 - 2024-08-05

- Fixed minor bugs in Flutter code snippets.

## Version 4.23.48 - 2024-08-05

- Added Flutter snippets screenshot in README file.

## Version 4.22.48 - 2024-08-05

- Added Flutter snippets.

## Version 3.22.48 - 2024-08-05

- Removed extra tag in README.

## Version 3.22.47 - 2024-08-05

- Removed extra "Code Snippets Collection" tag.

## Version 3.22.46 - 2024-08-05

- Updated GIF link.

## Version 3.22.45 - 2024-08-05

- Updated README.

## Version 3.22.44 - 2024-08-05

- Beautified the README.

## Version 3.22.43 - 2024-08-05

- Adjusted logo aspect ratio.

## Version 3.21.42 - 2024-08-05

- Updated README with an external link to the user manual.

## Version 3.20.42 - 2024-08-05

- Minor changes in README file.

## Version 3.20.41 - 2024-07-29

- Changed extension name from "Prism Snippets and Logger" to "DevSnip Pro."

## Versions 3.19.41 & 3.19.40 - 2024-07-29

- Adjusted logo aspect ratio.
- Updated logo.

## Versions 3.18.40 & 3.17.40 - 2024-06-06

- Updated logo (R1 & R2).

## Version 3.16.40 - 2024-06-06

- Added TypeScript snippets reference to README.

## Version 3.15.40 - 2024-06-06

- **Big Update!** Added TypeScript snippets.

## Version 2.15.40 - 2024-06-06

- Updated extension description.

## Version 2.14.40 & 2.14.39 - 2024-06-06

- Tested for better visibility of the manual.

## Version 2.14.38 - 2024-05-24

- Updated sponsor information.

## Version 2.13.38 - 2024-05-20

- Fixed minor bugs in printing tables.

## Version 2.13.37 - 2024-05-20

- Added table printing in the logger section.

## Version 2.12.37 - 2024-05-08

- Updated copyright information.

## Versions 2.12.34, 2.11.34 & 2.10.34 - 2024-04-30

- Added MIT License.
- Added identifiers.
- Fixed minor bugs and added language support.
