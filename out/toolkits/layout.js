"use strict";
/**
 * The navigation of DevSnip Pro: every section, in order, and every tool's
 * single home, ordered by how often developers reach for it.
 *
 * This file is the one source of truth for where a tool appears. The Tools
 * sidebar, the "Browse all tools" hub, tool search, command palette titles,
 * the toolkit registry (which stamps `section` and `category` onto each tool
 * definition) and analytics feature areas are all derived from it.
 *
 * It must stay light: the sidebar imports it during activation, so it may
 * not import tool definitions or engines. Toolkit tools are referenced by
 * their stable id (`tool`); the id's prefix names the module that defines
 * the tool, not the section it is shown in.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findEntry = exports.HUB_COMMANDS = exports.COMMAND_PREFIX = exports.NAV = void 0;
const e = (command, label, codicon, description, extra = {}) => ({ command, label, codicon, description, ...extra });
exports.NAV = [
    {
        id: "api", title: "Backend & API", emoji: "🔌", codicon: "cloud", color: "terminal.ansiBrightBlue",
        description: "Send and debug HTTP requests, convert cURL, fix CORS, work with OpenAPI and GraphQL, and scaffold REST endpoints.",
        entries: [
            e("openGUI", "REST API Client", "cloud", "Send HTTP, GraphQL and WebSocket requests with environments, collections and AI providers.", { hubIcon: "api", keywords: ["http", "rest", "postman", "request", "graphql", "websocket", "llm"] }),
            e("curlConverter", "cURL Converter", "terminal-cmd", "Turn a cURL command into fetch, Axios, Python, Go, Dart, Kotlin, Swift and more.", { tool: "web.curl" }),
            e("apiResponseInspector", "API Response Inspector", "inspect", "Pretty-print a raw HTTP response with status, headers, paging and caching hints.", { tool: "web.api-response" }),
            e("urlTools", "URL & Query String Tool", "link", "Parse URLs and query params, build encoded URLs, convert query strings ↔ JSON.", { tool: "web.url" }),
            e("corsHelper", "CORS Builder & Debugger", "globe", "CORS config for Express, NestJS, Next.js and nginx, and fixes for CORS errors.", { tool: "web.cors" }),
            e("openApiTools", "OpenAPI / Swagger Toolkit", "book", "Lint a spec, list endpoints, and generate TypeScript types, a fetch client and cURL.", { tool: "web.openapi" }),
            e("graphqlTools", "GraphQL Formatter & Types", "symbol-structure", "Format queries, build request bodies, and turn SDL into TypeScript.", { tool: "web.graphql" }),
            e("apiScaffolder", "API Resource Scaffolder", "server", "A validated CRUD API for Express, NestJS, Next.js or Fastify on Prisma or Mongoose.", { tool: "web.api-scaffold" })
        ]
    },
    {
        id: "frontend", title: "Web & Frontend", emoji: "🎨", codicon: "browser", color: "terminal.ansiBrightCyan",
        description: "React and Next.js scaffolding, HTML to JSX, CSS units, colours, SEO tags and caching.",
        entries: [
            e("reactGenerator", "React / Next.js Generator", "symbol-class", "Components, App Router pages, route handlers, server actions, hooks and stores.", { tool: "web.react" }),
            e("htmlToJsx", "HTML → JSX", "code", "Convert HTML or SVG into valid JSX/TSX or a React component.", { tool: "web.html-jsx" }),
            e("cssUnits", "CSS Units & Fluid Type", "symbol-ruler", "px ↔ rem/em/vw, fluid clamp() values and type scales for CSS and Tailwind.", { tool: "web.css-units" }),
            e("colorConverter", "Color Converter & Palette", "symbol-color", "Convert colours for CSS, Tailwind, Android, Compose, Flutter and SwiftUI; shades and contrast.", { tool: "mobile.colors" }),
            e("metaTagsGenerator", "SEO & Social Meta Tags", "tag", "Title, description, Open Graph, X cards, JSON-LD, robots.txt and the Next.js Metadata API.", { tool: "web.meta" }),
            e("cacheControl", "Cache-Control Builder", "dashboard", "Explain Cache-Control headers and get caching config per asset type.", { tool: "web.cache" })
        ]
    },
    {
        id: "mobile", title: "Mobile Development", emoji: "📱", codicon: "device-mobile", color: "terminal.ansiBrightMagenta",
        description: "Android, iOS, React Native, Expo and Flutter: devices, deep links, permissions, environments, signing, SDK versions and CI.",
        entries: [
            e("deviceCommands", "adb & simctl Commands", "terminal", "Install, logs, deep links, port reverse, proxy, screenshots and more.", { tool: "mobile.devices" }),
            e("deepLinkHelper", "Deep Links & Universal Links", "link-external", "AASA, assetlinks.json, intent filters and router config, with test commands.", { tool: "mobile.deep-links" }),
            e("appPermissions", "App Permissions", "checklist", "Info.plist strings, AndroidManifest entries, Expo plugins and runtime requests.", { tool: "mobile.permissions" }),
            e("mobileLocalApi", "Local API from Devices", "plug", "Reach your dev server from emulators and phones: URLs, cleartext and ATS config.", { tool: "mobile.local-api" }),
            e("appEnvironments", "Environments & Flavors", "versions", "Dev / staging / prod builds for Android, iOS, Flutter, React Native and Expo.", { tool: "mobile.environments" }),
            e("appSigning", "Signing & Keystores", "key", "Upload keystores, Gradle signing, SHA-1/SHA-256 fingerprints and iOS signing.", { tool: "mobile.signing" }),
            e("sdkVersions", "SDK & Build Compatibility", "layers", "Check AGP, Gradle, JDK and SDK levels; Xcode, Flutter and React Native versions.", { tool: "mobile.versions" }),
            e("mobileCiGenerator", "Mobile CI Workflow", "github-action", "GitHub Actions for Flutter, Android, iOS, React Native and Expo, with store uploads.", { tool: "mobile.ci" }),
            e("densityConverter", "dp / px / pt & Asset Sizes", "symbol-numeric", "Convert sizes across densities and look up icon, splash and store sizes.", { tool: "mobile.density" })
        ]
    },
    {
        id: "code", title: "Code & Productivity", emoji: "⚡", codicon: "rocket", color: "terminal.ansiBrightYellow",
        description: "Snippets, workspace clean-up, dependencies, README files and the OpenCode assistant.",
        entries: [
            e("showSnippets", "Saved Snippets", "file-code", "Browse, insert and manage the snippets you have saved.", { hubIcon: "code", keywords: ["snippet", "template", "insert"] }),
            e("createCustomSnippet", "Create Snippet", "edit", "Save the selected code as a reusable custom snippet.", { hubIcon: "sparkles", keywords: ["snippet", "save selection"] }),
            e("listAndRemoveConsoleLogs", "Clean Console Logs", "trash", "Find console.log calls across the workspace and remove them.", { hubIcon: "filter", keywords: ["console.log", "debug statements", "cleanup"] }),
            e("removeUnusedImports", "Remove Unused Imports", "symbol-method", "Detect imports that are never used and remove them.", { hubIcon: "scissors", keywords: ["imports", "cleanup", "unused"] }),
            e("dependencyManager", "Dependencies & Installation", "package", "Check npm, yarn, pnpm, pip, Maven and Gradle dependencies and update them.", { hubIcon: "package", keywords: ["npm", "pip", "maven", "gradle", "outdated", "upgrade"] }),
            e("readmeManager", "README Viewer & Manager", "book", "Browse, preview and edit the README files in your workspace.", { hubIcon: "book", keywords: ["readme", "markdown", "docs"] }),
            e("openCodeIntegration", "OpenCode Integration", "comment-discussion", "Run the OpenCode AI assistant from inside VS Code.", { hubIcon: "message", keywords: ["ai assistant", "agent", "opencode"] })
        ]
    },
    {
        id: "text", title: "Text & Formatters", emoji: "📝", codicon: "symbol-text", color: "terminal.ansiBrightWhite",
        description: "Format and validate JSON, YAML and XML; compare text; test regular expressions; convert case.",
        entries: [
            e("jsonFormatter", "JSON / YAML / XML Formatter", "json", "Format, minify and validate JSON, YAML and XML, and convert between them.", { tool: "text.format" }),
            e("textDiff", "Diff Checker", "diff", "Compare two texts line by line, or two JSON documents structurally.", { tool: "dev.diff" }),
            e("regexLibrary", "Regex Tester & Library", "regex", "Test a regex with groups, start from tested patterns, copy code for 9 languages.", { tool: "dev.regex-library" }),
            e("caseConverter", "Case Converter & Text Tools", "case-sensitive", "camelCase, snake_case, kebab-case and more; sort, dedupe and count lines.", { tool: "dev.text" })
        ]
    },
    {
        id: "convert", title: "Encoders & Converters", emoji: "🔄", codicon: "arrow-swap", color: "terminal.ansiBrightYellow",
        description: "Encode and decode, convert timestamps and data formats, generate IDs and turn JSON into types.",
        entries: [
            e("base64Encoder", "Encode / Decode", "symbol-string", "Base64, URL, HTML entities, hex and Unicode escapes, in both directions.", { tool: "dev.encode" }),
            e("timestampConverter", "Timestamp Converter", "watch", "Unix seconds/ms ↔ dates, time zones, relative time and date math.", { tool: "dev.timestamp" }),
            e("idGenerator", "UUID & ID Generator", "symbol-key", "UUID v4/v7, ULID, Nano ID, ObjectId and passwords; decode an ID's timestamp.", { tool: "dev.ids" }),
            e("jsonToTypes", "JSON to Types", "symbol-interface", "TypeScript, Zod, Dart, Kotlin, Swift, Pydantic, Java, Go or JSON Schema from sample JSON.", { tool: "data.types" }),
            e("dataConverter", "Data Converter", "table", "Convert between CSV, JSON, JSON Lines, YAML, Markdown tables and SQL inserts.", { tool: "data.convert" })
        ]
    },
    {
        id: "database", title: "Database", emoji: "🗄️", codicon: "database", color: "terminal.ansiBrightGreen",
        description: "Connect to and edit your databases, format SQL, build queries and connection strings, and translate SQL to MongoDB.",
        entries: [
            e("databaseClient", "Database Client", "database", "Connect with a connection string to browse and edit Postgres, MySQL, SQL Server, SQLite, MongoDB or Redis.", { hubIcon: "database", keywords: ["database", "sql", "postgres", "mysql", "mongodb", "redis", "sqlite", "sql server", "crud", "table", "query", "db client"] }),
            e("sparkSqlFormatter", "SQL Formatter & Linter", "database", "Format SQL for Postgres, MySQL, SQL Server, Spark and Trino, and flag risky patterns.", { tool: "data.sql" }),
            e("sqlQueryHelper", "SQL Query Helper", "list-ordered", "Parameterised SELECT, INSERT, UPDATE, UPSERT, DELETE and pagination queries.", { tool: "data.sql-helper" }),
            e("connectionString", "Database Connection Strings", "plug", "Build or fix Postgres, MySQL, MongoDB and Redis URLs with driver setup.", { tool: "web.db-url" }),
            e("sqlToMongo", "SQL → MongoDB Query", "symbol-namespace", "Translate SELECTs into MongoDB find() or aggregation pipelines.", { tool: "web.sql-mongo" })
        ]
    },
    {
        id: "testing", title: "Testing & Debugging", emoji: "🐞", codicon: "bug", color: "terminal.ansiBrightRed",
        description: "Explain build errors, analyse logs, generate test data, validate payloads and find what is using a port.",
        entries: [
            e("buildErrorExplainer", "Build Error Explainer", "bug", "Paste a Gradle, Xcode, CocoaPods, Metro, Flutter or npm log and get the fix.", { tool: "mobile.build-errors" }),
            e("observabilityAnalyze", "Log Analyzer & Formatter", "pulse", "Summarise app, JSON and access logs: errors, status codes, slow requests.", { tool: "devops.logs" }),
            e("mockDataGenerator", "Mock Data Generator", "sparkle", "Seeded fake records as JSON, CSV or SQL inserts.", { tool: "data.mock" }),
            e("jsonSchemaValidator", "JSON Schema Validator", "verified", "Validate JSON against a schema with every violation's path, or infer a schema.", { tool: "data.schema-validate" }),
            e("networkTools", "Port & Network Toolkit", "radio-tower", "Which ports are in use, what a port is for, and CIDR / subnet maths.", { tool: "devops.network" })
        ]
    },
    {
        id: "git", title: "Git & Version Control", emoji: "🌿", codicon: "git-merge", color: "terminal.ansiBrightGreen",
        description: "Git commands for everyday situations, commit messages, .gitignore files and version numbers.",
        entries: [
            e("gitRecipes", "Git Command Recipes", "git-merge", "The exact commands to undo, rename, sync, squash, recover - and commit messages.", { tool: "web.git" }),
            e("gitignoreGenerator", ".gitignore Generator", "filter", ".gitignore for your stack, detected from the workspace, or check an existing one.", { tool: "web.gitignore" }),
            e("semverCalculator", "Semver & App Versions", "versions", "Check npm/pub ranges, bump versions, and derive versionCode and build numbers.", { tool: "web.semver" })
        ]
    },
    {
        id: "devops", title: "DevOps & Cloud", emoji: "🐳", codicon: "server-environment", color: "terminal.ansiBrightBlue",
        description: "Containers, Kubernetes, CI/CD, cloud deploys, environment files, schedules, servers and observability.",
        entries: [
            e("dockerfileHelper", "Dockerfile", "package", "Generate a small, secure multi-stage Dockerfile, or check an existing one.", { tool: "devops.dockerfile" }),
            e("composeHelper", "Docker Compose", "layers", "Generate a local stack with health checks, or validate a compose file.", { tool: "devops.compose" }),
            e("dockerRunToCompose", "docker run → Compose", "arrow-swap", "Turn docker run commands into a compose.yaml.", { tool: "devops.docker-run" }),
            e("ciPipelineGenerator", "CI Pipeline", "github-action", "GitHub Actions, GitLab CI or Jenkins pipelines with caching.", { tool: "devops.ci" }),
            e("envChecker", ".env Checker", "symbol-variable", "Validate a .env file, compare it with .env.example, find undeclared variables.", { tool: "devops.env" }),
            e("kubernetesHelper", "Kubernetes & Helm", "server", "Generate Kubernetes manifests or a Helm chart, or validate existing ones.", { tool: "devops.k8s" }),
            e("cloudDeployGenerator", "Cloud Deploy Workflow", "cloud-upload", "Deploy to GHCR, Docker Hub, AWS ECS, S3 + CloudFront or Azure with OIDC.", { tool: "devops.deploy" }),
            e("cronHelper", "Cron Expression Helper", "calendar", "Explain a cron schedule and list its next runs, for crontab, Actions and Kubernetes.", { tool: "dev.cron" }),
            e("nginxConfig", "Nginx Config", "settings-gear", "Reverse proxy, SPA, static or load-balancer configs with HTTPS and headers.", { tool: "devops.nginx" }),
            e("healthCheckGenerator", "Health Check Endpoints", "heart", "Liveness and readiness endpoints with matching Docker and Kubernetes probes.", { tool: "devops.health" }),
            e("terraformGenerator", "Terraform Starter", "symbol-structure", "A clean Terraform module with variables, outputs and remote state.", { tool: "devops.terraform" }),
            e("pm2Config", "PM2 Ecosystem", "server-process", "ecosystem.config.js with cluster mode, memory limits and restarts.", { tool: "devops.pm2" }),
            e("observabilityStarter", "Observability Starter", "graph-line", "OpenTelemetry tracing, structured logs and a local Jaeger.", { tool: "devops.observability" })
        ]
    },
    {
        id: "security", title: "Security & Auth", emoji: "🛡️", codicon: "shield", color: "terminal.ansiBrightRed",
        description: "Tokens, OAuth, hashes and signatures, security headers, cookies, certificates and security scans.",
        entries: [
            e("jwtDecoder", "JWT Decoder & Signer", "key", "Decode a JWT locally, verify it with a secret or public key, or sign test tokens.", { tool: "dev.jwt" }),
            e("securityAudit", "Workspace Security Audit", "search", "Scan the workspace for secrets, injection risks and unsafe code.", { hubIcon: "search", keywords: ["secrets", "sast", "vulnerabilities", "scan"] }),
            e("hashGenerator", "Hash, HMAC & Webhooks", "symbol-key", "MD5/SHA hashes, HMAC, and webhook signature checks for GitHub, Stripe, Shopify and Slack.", { tool: "dev.hash" }),
            e("oauthPkce", "OAuth 2.0 & PKCE", "lock", "PKCE values, authorization URLs and token requests for common providers.", { tool: "web.oauth" }),
            e("securityHeaders", "CSP & Security Headers", "shield", "Build a Content-Security-Policy and security headers, or audit the ones you send.", { tool: "web.security-headers" }),
            e("endpointSecurityScan", "Endpoint Security Scan", "radio-tower", "Check an endpoint's security headers, HSTS, CSP, CORS, TLS and cookies.", { hubIcon: "globe", keywords: ["headers", "tls", "hsts", "pentest", "url scan"] }),
            e("cookieInspector", "Cookie Inspector & Builder", "eye", "Find Set-Cookie problems browsers reject silently, or build a secure cookie.", { tool: "web.cookies" }),
            e("dependencyAudit", "Dependency & Config Check", "package", "Check lockfiles, known advisories and CI hardening.", { hubIcon: "package", keywords: ["npm audit", "advisories", "supply chain", "lockfile"] }),
            e("certInspector", "Certificate & SSL Pinning", "verified", "Decode PEM certificates: validity, SANs, fingerprints and SPKI pins.", { tool: "mobile.certificates" }),
            e("cloudSecurityAudit", "Cloud & Container Audit", "cloud", "Audit Terraform, Kubernetes, Docker and IAM configuration.", { hubIcon: "cloud", keywords: ["terraform", "kubernetes", "iam", "misconfiguration"] })
        ]
    },
    {
        id: "ai", title: "AI & ML", emoji: "🤖", codicon: "hubot", color: "terminal.ansiBrightCyan",
        description: "Build LLM apps (prompts, models, costs, clients, output handling) and train and serve models.",
        categories: ["LLM apps", "Models & training"],
        entries: [
            e("promptTemplate", "Prompt Builder", "comment-discussion", "Fill a prompt template, check it for mistakes and export an API payload.", { tool: "ai.prompt-builder", category: "LLM apps" }),
            e("tokenCounter", "LLM Models, Tokens & Cost", "symbol-numeric", "Estimate tokens and cost per model, or compare models' context and prices.", { tool: "ai.token-cost", category: "LLM apps" }),
            e("llmClientSetup", "LLM Client Setup", "plug", "Generate a client for OpenAI, Anthropic, Gemini, Azure, Ollama and more.", { tool: "ai.llm-config", category: "LLM apps" }),
            e("llmJsonValidator", "LLM Output & JSON", "json", "Clean up a model answer, or extract, repair and validate its JSON.", { tool: "ai.json-output", category: "LLM apps" }),
            e("llmApiTester", "LLM API Tester", "debug-alt", "Send one chat request and see the answer, latency, tokens and cost.", { tool: "ai.llm-tester", category: "LLM apps" }),
            e("jsonToToon", "JSON → TOON for Prompts", "symbol-array", "Shrink JSON in prompts by 30-60% of tokens without losing data.", { tool: "ai.toon", category: "LLM apps" }),
            e("aiAppStarter", "AI App Starter", "rocket", "A runnable AI app project for your stack.", { tool: "ai.project", category: "LLM apps" }),
            e("mlCodeGen", "AI/ML Code Snippets", "file-code", "Tested snippets for common AI and ML tasks.", { tool: "ai.snippets", category: "LLM apps" }),
            e("gpuVram", "GPU Memory & Speed", "circuit-board", "Estimate VRAM and tokens per second to run or fine-tune a model.", { tool: "ai.vram", category: "Models & training" }),
            e("mlopsGenerator", "Model Serving Starter", "server-process", "Serve a model behind FastAPI with Docker, Kubernetes GPU scheduling and CI.", { tool: "devops.serving", category: "Models & training" }),
            e("metricsCalculator", "Model Metrics", "graph", "Accuracy, precision, recall, F1 and more from a confusion matrix or predictions.", { tool: "ai.metrics", category: "Models & training" }),
            e("datasetSplit", "Dataset Split Planner", "split-horizontal", "Exact train / validation / test counts and scikit-learn code.", { tool: "ai.dataset-split", category: "Models & training" }),
            e("lrScheduler", "Learning-Rate Schedule", "graph-line", "Plot a learning-rate schedule and get the matching PyTorch code.", { tool: "ai.lr-schedule", category: "Models & training" }),
            e("modelCard", "Model Card", "note", "Write a Hugging Face-compatible model card for a trained model.", { tool: "ai.model-card", category: "Models & training" })
        ]
    },
    {
        id: "data", title: "Data & RAG", emoji: "🧬", codicon: "library", color: "terminal.ansiBrightGreen",
        description: "Retrieval-augmented generation from chunking to evaluation, and data engineering: transform, profile, schemas and Spark.",
        categories: ["RAG", "Data engineering"],
        journey: [
            { command: "chunkingTester", title: "1. Chunk your documents", text: "Split text into passages small enough to retrieve precisely, big enough to keep context." },
            { command: "embeddingCost", title: "2. Size the index", text: "How many chunks, what embedding costs and how much storage and RAM you need." },
            { command: "embeddingModelGuide", title: "3. Pick an embedding model", text: "Dimensions, input limits and price decide cost and quality." },
            { command: "vectorStoreSetup", title: "4. Set up a vector store", text: "Collection settings, a local Docker service and client code." },
            { command: "retrievalConfig", title: "5. Configure retrieval", text: "Top-k, MMR, thresholds, hybrid search and reranking." },
            { command: "contextWindow", title: "6. Fit the context window", text: "How many chunks fit next to the system prompt, history and answer." },
            { command: "ragPipeline", title: "7. Generate the pipeline", text: "Runnable ingest + ask code for your stack." },
            { command: "ragEvalScores", title: "8. Measure quality", text: "Hit rate, MRR and nDCG on real questions; then check answers are grounded." }
        ],
        entries: [
            e("chunkingTester", "Chunking Tester", "list-flat", "Compare chunking strategies and spot problems before you embed anything.", { tool: "rag.chunker", category: "RAG" }),
            e("ragPipeline", "RAG Pipeline Generator", "rocket", "Generate a runnable ingest-and-ask RAG project for your stack.", { tool: "rag.pipeline", category: "RAG" }),
            e("vectorStoreSetup", "Vector Store Setup", "database", "Chroma, Qdrant, pgvector, Pinecone, Weaviate or OpenSearch, with client code.", { tool: "rag.vector-store", category: "RAG" }),
            e("embeddingModelGuide", "Embedding Model Guide", "book", "Compare embedding models by quality, dimensions, cost and languages.", { tool: "rag.embedding-models", category: "RAG" }),
            e("retrievalConfig", "Retrieval Configuration", "settings-gear", "top-k, thresholds, MMR, hybrid search and reranking settings with code.", { tool: "rag.retrieval", category: "RAG" }),
            e("contextWindow", "Context Window Budget", "symbol-numeric", "How many retrieved chunks fit next to the prompt, history and answer.", { tool: "rag.context-budget", category: "RAG" }),
            e("ragPromptBuilder", "Grounded Prompt Assembler", "comment-discussion", "Assemble a grounded prompt with citations from retrieved chunks.", { tool: "rag.prompt", category: "RAG" }),
            e("embeddingCost", "Chunk & Index Size Calculator", "symbol-ruler", "Chunks, embedding cost, vector storage and index RAM for a corpus.", { tool: "rag.ingestion-plan", category: "RAG" }),
            e("ragEvalScores", "Retrieval Evaluation", "checklist", "Hit rate, precision, recall, MRR and nDCG@k for your retriever.", { tool: "rag.retrieval-eval", category: "RAG" }),
            e("ragHallucinationAnalyzer", "Answer Grounding Checker", "verified", "Check which sentences of an answer the retrieved context supports.", { tool: "rag.grounding", category: "RAG" }),
            e("vectorSimilarity", "Vector Similarity", "symbol-array", "Cosine similarity, dot product and distance between embedding vectors.", { tool: "ai.vector-similarity", category: "RAG" }),
            e("semanticDedup", "Near-Duplicate Chunk Finder", "copy", "Find repeated passages that waste index space and crowd out results.", { tool: "rag.dedup", category: "RAG" }),
            e("hybridSearchRrf", "Hybrid Search Fusion (RRF)", "merge", "Merge keyword and vector rankings with Reciprocal Rank Fusion.", { tool: "rag.rrf", category: "RAG" }),
            e("chunkMetadataValidator", "Chunk Metadata Validator", "checklist", "Check chunk metadata for missing, inconsistent or oversized fields.", { tool: "rag.metadata", category: "RAG" }),
            e("dataTransform", "Data Transformer", "filter", "Filter, pick, rename, sort, dedupe and flatten records - jq without the syntax.", { tool: "data.transform", category: "Data engineering" }),
            e("dataQualityChecker", "Data Profiler & Quality Check", "graph", "Types, missing values, distinct counts, ranges and outliers per column.", { tool: "data.profile", category: "Data engineering" }),
            e("jsonlViewer", "JSON Lines Inspector", "list-flat", "Validate JSONL line by line, see its fields and preview records.", { tool: "data.jsonl", category: "Data engineering" }),
            e("schemaViewer", "Schema Viewer & Diff", "symbol-structure", "View JSON Schema, Avro or Spark schemas as a tree, or diff two for breaking changes.", { tool: "data.schema", category: "Data engineering" }),
            e("partitionCalc", "Partition & File Size Planner", "split-horizontal", "Size Parquet/Delta partitions and output files, with PySpark code.", { tool: "data.partitions", category: "Data engineering" }),
            e("sparkCostEstimator", "Spark Cluster & Cost", "server", "Workers, executor layout and daily and monthly cost for a Spark job.", { tool: "data.spark-cluster", category: "Data engineering" }),
            e("deltaLakeAnalyzer", "Delta Lake Log Analyzer", "history", "Operations, small files, schema changes and OPTIMIZE / VACUUM advice.", { tool: "data.delta-log", category: "Data engineering" })
        ]
    }
];
exports.COMMAND_PREFIX = "sayaib.hue-console.";
/** Commands that open the "Browse all tools" hub; the old per-section hub commands open it on their section. */
exports.HUB_COMMANDS = {
    advancedToolsHub: "all",
    webDevHub: "frontend",
    mobileDevHub: "mobile",
    aiMlHub: "ai",
    ragHub: "data",
    bigDataHub: "data",
    devopsGenerator: "devops"
};
function findEntry(command) {
    const bare = command.startsWith(exports.COMMAND_PREFIX) ? command.slice(exports.COMMAND_PREFIX.length) : command;
    for (const section of exports.NAV) {
        const entry = section.entries.find(e => e.command === bare);
        if (entry)
            return { section, entry };
    }
    return undefined;
}
exports.findEntry = findEntry;
//# sourceMappingURL=layout.js.map