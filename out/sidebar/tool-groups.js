"use strict";
/**
 * The Tools sidebar's categories and tools.
 *
 * Icons are codicon ids and colours are VS Code theme colour ids, exactly as
 * the sidebar used when it was a native tree view, so the identity carries over.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sidebarCommands = exports.SIDEBAR_GROUPS = exports.SEARCH_COMMAND = exports.MILESTONE_COMMAND = void 0;
const c = (id) => `sayaib.hue-console.${id}`;
const tool = (label, id, icon, description) => ({ label, command: c(id), icon, description });
exports.MILESTONE_COMMAND = c("milestoneTracker");
exports.SEARCH_COMMAND = c("searchTools");
exports.SIDEBAR_GROUPS = [
    {
        name: "Core", icon: "rocket", color: "terminal.ansiBrightYellow", tools: [
            tool("REST API Client", "openGUI", "cloud", "Send HTTP, GraphQL and WebSocket requests with environments and saved collections."),
            tool("Clean Console Logs", "listAndRemoveConsoleLogs", "trash", "Find console.log calls across the workspace and remove them."),
            tool("Remove Unused Imports", "removeUnusedImports", "symbol-method", "Detect imports that are never used and remove them."),
            tool("README Viewer & Manager", "readmeManager", "book", "Browse, preview and edit the README files in your workspace."),
            tool("OpenCode Integration", "openCodeIntegration", "terminal", "Run the OpenCode AI assistant from inside VS Code."),
        ]
    },
    {
        name: "Snippets", icon: "book", color: "terminal.ansiBrightMagenta", tools: [
            tool("Create Snippet", "createCustomSnippet", "edit", "Save the selected code as a reusable custom snippet."),
            tool("Saved Snippets", "showSnippets", "file-code", "Browse, insert and manage the snippets you have saved."),
        ]
    },
    {
        name: "Developer Tools", icon: "tools", color: "terminal.ansiBrightWhite", tools: [
            tool("All developer tools", "advancedToolsHub", "layout", "Open the hub with every developer utility."),
            tool("JSON/XML Formatter", "jsonFormatter", "json", "Format, minify and validate JSON and XML."),
            tool("Encode / Decode", "base64Encoder", "symbol-string", "Base64, URL, HTML entities, hex and Unicode escapes, in both directions."),
            tool("JWT Decoder", "jwtDecoder", "key", "Decode a JWT locally: header, claims, expiry and an optional signature check."),
            tool("Diff Checker", "textDiff", "diff", "Compare two texts line by line, or two JSON documents structurally."),
            tool("Dependencies & Installation", "dependencyManager", "package", "Check npm, yarn, pnpm, pip, Maven and Gradle dependencies and update them."),
        ]
    },
    {
        name: "AI & ML", icon: "hubot", color: "terminal.ansiBrightCyan", tools: [
            tool("All AI & ML tools", "aiMlHub", "layout", "Open the hub with every AI and ML tool."),
            tool("Prompt Builder", "promptTemplate", "comment-discussion", "Fill a prompt template, check it for mistakes and export an API payload."),
            tool("Token & Cost Estimator", "tokenCounter", "symbol-numeric", "Estimate tokens and per-request, daily and monthly cost for each model."),
            tool("LLM Client Setup", "llmClientSetup", "plug", "Generate a client for OpenAI, Anthropic, Gemini, Azure, Ollama and more."),
            tool("LLM JSON Validator", "llmJsonValidator", "json", "Extract JSON from a model response, repair it and validate it against a schema."),
        ]
    },
    {
        name: "RAG", icon: "search", color: "terminal.ansiBrightGreen", tools: [
            tool("All RAG tools", "ragHub", "layout", "Open the hub with every RAG tool."),
            tool("Chunking Tester", "chunkingTester", "list-flat", "Compare chunking strategies and spot problems before you embed anything."),
            tool("RAG Pipeline Generator", "ragPipeline", "rocket", "Generate a runnable ingest-and-ask RAG project for your stack."),
            tool("Retrieval Evaluation", "ragEvalScores", "checklist", "Hit rate, precision, recall, MRR and nDCG@k for your retriever."),
        ]
    },
    {
        name: "Data", icon: "database", color: "terminal.ansiBrightGreen", tools: [
            tool("All data tools", "bigDataHub", "layout", "Open the hub with every data tool."),
            tool("Data Converter", "dataConverter", "arrow-swap", "Convert between CSV, JSON, JSON Lines, YAML, Markdown tables and SQL."),
            tool("JSON to Types", "jsonToTypes", "symbol-class", "Generate TypeScript, Zod, Pydantic, Go or Java types from sample JSON."),
            tool("SQL Formatter & Linter", "sparkSqlFormatter", "database", "Format SQL for Postgres, MySQL, SQL Server, Spark and Trino, and flag risky patterns."),
            tool("Mock Data Generator", "mockDataGenerator", "sparkle", "Generate seeded fake records as JSON, CSV or SQL inserts."),
        ]
    },
    {
        name: "DevOps", icon: "server-environment", color: "terminal.ansiBrightBlue", tools: [
            tool("All DevOps tools", "devopsGenerator", "layout", "Open the hub with every DevOps tool."),
            tool("Dockerfile", "dockerfileHelper", "package", "Generate a small, secure multi-stage Dockerfile, or check an existing one."),
            tool("Docker Compose", "composeHelper", "layers", "Generate a local stack with health checks, or validate a compose file."),
            tool("Kubernetes & Helm", "kubernetesHelper", "server", "Generate Kubernetes manifests or a Helm chart, or validate existing ones."),
            tool("CI Pipeline", "ciPipelineGenerator", "github-action", "Generate GitHub Actions, GitLab CI or Jenkins pipelines with caching."),
            tool(".env Checker", "envChecker", "key", "Validate a .env file and compare it with .env.example."),
            tool("Log Analyzer", "observabilityAnalyze", "pulse", "Summarise application, JSON and access logs: errors, status codes, slow requests."),
        ]
    },
    {
        name: "Security", icon: "shield", color: "terminal.ansiBrightRed", tools: [
            tool("Security Hub", "securityHub", "shield", "Every DevSnip Pro security check in one place."),
            tool("Endpoint Security Scan", "endpointSecurityScan", "radio-tower", "Check an endpoint's security headers, HSTS, CSP, CORS, TLS and cookies."),
            tool("Workspace Audit", "securityAudit", "search", "Scan the workspace for secrets, injection risks and unsafe code."),
            tool("Cloud & Container Audit", "cloudSecurityAudit", "cloud", "Audit Terraform, Kubernetes, Docker and IAM configuration."),
            tool("Dependency & Config Check", "dependencyAudit", "package", "Check lockfiles, known advisories and CI hardening."),
        ]
    },
];
/** Every command the sidebar can run; anything else posted by the page is ignored. */
function sidebarCommands() {
    return new Set([exports.MILESTONE_COMMAND, exports.SEARCH_COMMAND, ...exports.SIDEBAR_GROUPS.flatMap(group => group.tools.map(t => t.command))]);
}
exports.sidebarCommands = sidebarCommands;
//# sourceMappingURL=tool-groups.js.map