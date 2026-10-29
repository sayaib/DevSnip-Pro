# Tool organization

Tools are grouped by purpose. Each tool has one navigation home; browser hosts omit unsupported tools and empty subsections. Favorites, recent history and command IDs are preserved.

Redundant legacy mode commands are hidden from the Command Palette; their functionality remains in the parent tool mode selector and their command IDs remain callable. No unique capability was deleted without evidence that it was obsolete.

## Backend & API

### Requests & debugging

- **REST API Client** — Send HTTP, GraphQL and WebSocket requests with environments, collections and AI providers.
- **cURL Converter** — Turn a cURL command into fetch, Axios, Python, Go, Dart, Kotlin, Swift and more.
- **API Response Inspector** — Pretty-print a raw HTTP response with status, headers, paging and caching hints.
- **URL & Query String Tool** — Parse URLs and query params, build encoded URLs, convert query strings ↔ JSON.

### HTTP configuration

- **CORS Builder & Debugger** — CORS config for Express, NestJS, Next.js and nginx, and fixes for CORS errors.
- **Cache-Control Builder** — Explain Cache-Control headers and get caching config per asset type.

### API design & code generation

- **OpenAPI / Swagger Toolkit** — Lint a spec, list endpoints, and generate TypeScript types, a fetch client and cURL.
- **GraphQL Formatter & Types** — Format queries, build request bodies, and turn SDL into TypeScript.
- **API Resource Scaffolder** — CRUD APIs for Express, NestJS, Next.js, Fastify, Spring Boot, ASP.NET Core and FastAPI.

## Web & Frontend

### React & components

- **React / Next.js Generator** — Components, App Router pages, route handlers, server actions, hooks and stores.
- **HTML → JSX** — Convert HTML or SVG into valid JSX/TSX or a React component.

### Styling & accessibility

- **CSS Units & Fluid Type** — px ↔ rem/em/vw, fluid clamp() values and type scales for CSS and Tailwind.
- **Color Converter & Palette** — Convert colours for CSS, Tailwind, Android, Compose, Flutter and SwiftUI; shades and contrast.

### SEO & metadata

- **SEO & Social Meta Tags** — Title, description, Open Graph, X cards, JSON-LD, robots.txt and the Next.js Metadata API.

## Mobile Development

### Devices & connectivity

- **adb & simctl Commands** — Install, logs, deep links, port reverse, proxy, screenshots and more.
- **Local API from Devices** — Reach your dev server from emulators and phones: URLs, cleartext and ATS config.
- **Deep Links & Universal Links** — AASA, assetlinks.json, intent filters and router config, with test commands.

### App configuration

- **App Permissions** — Info.plist strings, AndroidManifest entries, Expo plugins and runtime requests.
- **Environments & Flavors** — Dev / staging / prod builds for Android, iOS, Flutter, React Native and Expo.
- **dp / px / pt & Asset Sizes** — Convert sizes across densities and look up icon, splash and store sizes.

### Build & release

- **Signing & Keystores** — Upload keystores, Gradle signing, SHA-1/SHA-256 fingerprints and iOS signing.
- **SDK & Build Compatibility** — Check AGP, Gradle, JDK and SDK levels; Xcode, Flutter and React Native versions.
- **Mobile CI Workflow** — GitHub Actions for Flutter, Android, iOS, React Native and Expo, with store uploads.

## Code & Productivity

### Snippets

- **Saved Snippets** — Browse, insert and manage the snippets you have saved.
- **Create Snippet** — Save the selected code as a reusable custom snippet.
- **Framework Snippets** — Spring Boot, ASP.NET Core, FastAPI, React, Next.js, Flutter and SwiftUI snippets. Type ds- in a file.

### Code & documentation

- **Remove Unused Imports** — Detect imports that are never used and remove them.
- **README Viewer & Manager** — Browse, preview and edit the README files in your workspace.

### Package management

- **Dependencies & Installation** — Check npm, yarn, pnpm, pip, Maven and Gradle dependencies and update them.
- **Unused Dependencies** — npm, Python and Flutter packages that no code, script or config uses, and the command to remove them.

## Text & Formatters

### Structured text

- **JSON / YAML / XML Formatter** — Format, minify and validate JSON, YAML and XML, and convert between them.
- **XML → JSON Converter** — Validate XML and convert it to JSON: attributes, namespaces, arrays, CDATA, comments; compact or lossless.

### Text analysis & editing

- **Diff Checker** — Compare two texts line by line, or two JSON documents structurally.
- **Regex Tester & Library** — Test a regex with groups, start from tested patterns, copy code for 9 languages.
- **Case Converter & Text Tools** — camelCase, snake_case, kebab-case and more; sort, dedupe and count lines.

## Encoders & Converters

### Encoding & dates

- **Encode / Decode** — Base64, URL, HTML entities, hex and Unicode escapes, in both directions.
- **Timestamp Converter** — Unix seconds/ms ↔ dates, time zones, relative time and date math.

### Identifiers

- **UUID & ID Generator** — UUID v4/v7, ULID, Nano ID, ObjectId and passwords; decode an ID's timestamp.

### Data formats & types

- **JSON to Types** — TypeScript, Zod, Dart, Kotlin, Swift, Pydantic, Java, Go or JSON Schema from sample JSON.
- **Data Converter** — Convert between CSV, JSON, JSON Lines, YAML, Markdown tables and SQL inserts.

## Database

### Connections & data

- **Database Client** — Connect with a connection string to browse and edit Postgres, MySQL, SQL Server, SQLite, MongoDB or Redis.
- **Database Connection Strings** — Build or fix Postgres, MySQL, MongoDB and Redis URLs with driver setup.

### SQL & queries

- **SQL Formatter & Linter** — Format SQL for Postgres, MySQL, SQL Server, Spark and Trino, and flag risky patterns.
- **SQL Query Helper** — Parameterised SELECT, INSERT, UPDATE, UPSERT, DELETE and pagination queries.
- **SQL → MongoDB Query** — Translate SELECTs into MongoDB find() or aggregation pipelines.

## Spreadsheets & CSV

### Tabular files

- **CSV / TSV Viewer** — View and edit .csv and .tsv files as a grid: search, sort, stats, export, and save.
- **Excel Viewer (.xlsx)** — View and edit .xlsx workbooks: every sheet, formulas, dates and number formats. Macros never run.

## Testing & Debugging

### Debugging & logs

- **Insert Debug Log** — Log the selected variable with console.log, print, SLF4J, ILogger, debugPrint or Log.d.
- **Clean Debug Logs** — Find and remove leftover console.log, print, println and Console.WriteLine calls.
- **Run & Debug Configurations** — Detect your projects and get launch.json, tasks.json and run, test and build commands.
- **Build Error Explainer** — Paste a Gradle, Xcode, CocoaPods, Metro, Flutter or npm log and get the fix.
- **Log Analyzer & Formatter** — Summarise app, JSON and access logs: errors, status codes, slow requests.

### Test data & validation

- **Mock Data Generator** — Seeded fake records as JSON, CSV or SQL inserts.
- **JSON Schema Validator** — Validate JSON against a schema with every violation's path, or infer a schema.

## Git & Version Control

### Source control

- **Git Command Recipes** — The exact commands to undo, rename, sync, squash, recover - and commit messages.
- **.gitignore Generator** — .gitignore for your stack, detected from the workspace, or check an existing one.

### Versioning

- **Semver & App Versions** — Check npm/pub ranges, bump versions, and derive versionCode and build numbers.

## DevOps & Cloud

### Containers & orchestration

- **Dockerfile** — Generate a small, secure multi-stage Dockerfile, or check an existing one.
- **Docker Compose** — Generate a local stack with health checks, or validate a compose file.
- **docker run → Compose** — Turn docker run commands into a compose.yaml.
- **Kubernetes & Helm** — Generate Kubernetes manifests or a Helm chart, or validate existing ones.

### CI & deployment

- **CI Pipeline** — GitHub Actions, GitLab CI or Jenkins pipelines with caching.
- **Cloud Deploy Workflow** — Deploy to GHCR, Docker Hub, AWS ECS, S3 + CloudFront or Azure with OIDC.
- **Terraform Starter** — A clean Terraform module with variables, outputs and remote state.

### Runtime & configuration

- **.env Checker** — Validate a .env file, compare it with .env.example, find undeclared variables.
- **Cron Expression Helper** — Explain a cron schedule and list its next runs, for crontab, Actions and Kubernetes.
- **Nginx Config** — Reverse proxy, SPA, static or load-balancer configs with HTTPS and headers.
- **PM2 Ecosystem** — ecosystem.config.js with cluster mode, memory limits and restarts.
- **Port & Network Toolkit** — Which ports are in use, what a port is for, and CIDR / subnet maths.

### Health & observability

- **Health Check Endpoints** — Liveness and readiness endpoints with matching Docker and Kubernetes probes.
- **Observability Starter** — OpenTelemetry tracing, structured logs and a local Jaeger.

## Security & Auth

### Workspace & dependency scans

- **Workspace Security Audit** — Scan the workspace for secrets, injection risks and unsafe code.
- **SCA Scanner** — Spring Boot-aware dependency scan: CVEs, CISA known-exploited, deprecated packages and BOM-safe fixes.
- **OSV Vulnerability Scanner** — Find known CVEs in npm, PyPI, Maven, Go, Cargo, RubyGems, NuGet and more dependencies with OSV.dev.
- **Dependency & Config Check** — Check lockfiles, known advisories and CI hardening.

### Endpoint & cloud scans

- **Endpoint Security Scan** — Check an endpoint's security headers, HSTS, CSP, CORS, TLS and cookies.
- **Cloud & Container Audit** — Audit Terraform, Kubernetes, Docker and IAM configuration.

### Authentication & signatures

- **JWT Decoder & Signer** — Decode a JWT locally, verify it with a secret or public key, or sign test tokens.
- **OAuth 2.0 & PKCE** — PKCE values, authorization URLs and token requests for common providers.
- **Hash, HMAC & Webhooks** — MD5/SHA hashes, HMAC, and webhook signature checks for GitHub, Stripe, Shopify and Slack.

### Browser & transport security

- **CSP & Security Headers** — Build a Content-Security-Policy and security headers, or audit the ones you send.
- **Cookie Inspector & Builder** — Find Set-Cookie problems browsers reject silently, or build a secure cookie.
- **Certificate & SSL Pinning** — Decode PEM certificates: validity, SANs, fingerprints and SPKI pins.

## AI & ML

### LLM apps

- **Prompt Builder** — Fill a prompt template, check it for mistakes and export an API payload.
- **LLM Models, Tokens & Cost** — Estimate tokens and cost per model, or compare models' context and prices.
- **LLM Client Setup** — Generate a client for OpenAI, Anthropic, Gemini, Azure, Ollama and more.
- **LLM Output & JSON** — Clean up a model answer, or extract, repair and validate its JSON.
- **LLM API Tester** — Send one chat request and see the answer, latency, tokens and cost.
- **JSON → TOON for Prompts** — Shrink JSON in prompts by 30-60% of tokens without losing data.
- **AI App Starter** — A runnable AI app project for your stack.
- **AI/ML Code Snippets** — Tested snippets for common AI and ML tasks.

### Models & training

- **GPU Memory & Speed** — Estimate VRAM and tokens per second to run or fine-tune a model.
- **Model Serving Starter** — Serve a model behind FastAPI with Docker, Kubernetes GPU scheduling and CI.
- **Model Metrics** — Accuracy, precision, recall, F1 and more from a confusion matrix or predictions.
- **Dataset Split Planner** — Exact train / validation / test counts and scikit-learn code.
- **Learning-Rate Schedule** — Plot a learning-rate schedule and get the matching PyTorch code.
- **Model Card** — Write a Hugging Face-compatible model card for a trained model.

## Data & RAG

### RAG

- **Chunking Tester** — Compare chunking strategies and spot problems before you embed anything.
- **RAG Pipeline Generator** — Generate a runnable ingest-and-ask RAG project for your stack.
- **Vector Store Setup** — Chroma, Qdrant, pgvector, Pinecone, Weaviate or OpenSearch, with client code.
- **Embedding Model Guide** — Compare embedding models by quality, dimensions, cost and languages.
- **Retrieval Configuration** — top-k, thresholds, MMR, hybrid search and reranking settings with code.
- **Context Window Budget** — How many retrieved chunks fit next to the prompt, history and answer.
- **Grounded Prompt Assembler** — Assemble a grounded prompt with citations from retrieved chunks.
- **Chunk & Index Size Calculator** — Chunks, embedding cost, vector storage and index RAM for a corpus.
- **Retrieval Evaluation** — Hit rate, precision, recall, MRR and nDCG@k for your retriever.
- **Answer Grounding Checker** — Check which sentences of an answer the retrieved context supports.
- **Vector Similarity** — Cosine similarity, dot product and distance between embedding vectors.
- **Near-Duplicate Chunk Finder** — Find repeated passages that waste index space and crowd out results.
- **Hybrid Search Fusion (RRF)** — Merge keyword and vector rankings with Reciprocal Rank Fusion.
- **Chunk Metadata Validator** — Check chunk metadata for missing, inconsistent or oversized fields.

### Data engineering

- **Data Transformer** — Filter, pick, rename, sort, dedupe and flatten records - jq without the syntax.
- **Data Profiler & Quality Check** — Types, missing values, distinct counts, ranges and outliers per column.
- **JSON Lines Inspector** — Validate JSONL line by line, see its fields and preview records.
- **Schema Viewer & Diff** — View JSON Schema, Avro or Spark schemas as a tree, or diff two for breaking changes.
- **Partition & File Size Planner** — Size Parquet/Delta partitions and output files, with PySpark code.
- **Spark Cluster & Cost** — Workers, executor layout and daily and monthly cost for a Spark job.
- **Delta Lake Log Analyzer** — Operations, small files, schema changes and OPTIMIZE / VACUUM advice.

