"use strict";
/**
 * The single source of truth for every REST API Client capability.
 *
 * Nothing else in the codebase may define a feature, its tier, or its limits.
 * The webview, the extension host, commands and services all read from here, so
 * a tier change is a one-line edit that takes effect everywhere at once.
 *
 * Rule for this registry: a feature is listed only when it is actually
 * implemented. There are no placeholder entries, so a Premium badge always
 * corresponds to working functionality behind it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.allFeatureIds = exports.featuresByGroup = exports.featuresByCategory = exports.getFeatureLimit = exports.getFeature = exports.pointCostFor = exports.POINT_UNLOCKABLE = exports.FEATURE_LIMITS = exports.DEVELOPER_FEATURES = exports.CATEGORY_GROUPS = exports.CATEGORY_LABELS = exports.FEATURE_GROUP_LABELS = void 0;
exports.FEATURE_GROUP_LABELS = {
    rest: "REST",
    graphql: "GraphQL",
    websocket: "WebSocket",
    authentication: "Authentication",
    "api-testing": "API Testing",
    "developer-tools": "Developer Tools",
    "llm-apis": "LLM APIs",
    embeddings: "Embeddings",
    rag: "RAG",
    "ai-agents": "AI Agents",
    "prompt-testing": "Prompt Testing",
    "model-comparison": "Model Comparison"
};
exports.CATEGORY_LABELS = {
    "software-development": "Software Developer",
    "ai-ml": "AI / ML Developer"
};
/** Order the navigation tree renders groups in, per category. */
exports.CATEGORY_GROUPS = {
    "software-development": ["rest", "graphql", "websocket", "authentication", "api-testing", "developer-tools"],
    "ai-ml": ["llm-apis", "embeddings", "rag", "ai-agents", "prompt-testing", "model-comparison"]
};
exports.DEVELOPER_FEATURES = [
    // ---------------------------------------------------------------- free: REST
    {
        id: "rest-request",
        name: "REST API Requests",
        category: "software-development",
        group: "rest",
        tier: "free",
        enabled: true,
        description: "GET, POST, PUT, PATCH and DELETE with headers, query parameters and a JSON, text or form body."
    },
    {
        id: "response-inspector",
        name: "Response Inspector",
        category: "software-development",
        group: "rest",
        tier: "free",
        enabled: true,
        description: "Status, headers, timing, payload size and a formatted body view for every response."
    },
    {
        id: "request-history",
        name: "Request History",
        category: "software-development",
        group: "rest",
        tier: "free",
        enabled: true,
        description: "The last 50 requests with status, duration and size. Credentials in query strings are redacted before storage."
    },
    {
        id: "environments",
        name: "Environment Variables",
        category: "software-development",
        group: "developer-tools",
        tier: "free",
        enabled: true,
        description: "Named environments with {{variable}} substitution across the URL, headers and body."
    },
    {
        id: "collections-basic",
        name: "Request Collections",
        category: "software-development",
        group: "developer-tools",
        tier: "free",
        enabled: true,
        description: "Save any number of requests, organised into folders, and reopen them later."
    },
    {
        id: "graphql-client",
        name: "GraphQL Client",
        category: "software-development",
        group: "graphql",
        tier: "free",
        enabled: true,
        description: "Send GraphQL queries with variables and an operation name, wrapped into a correct JSON payload."
    },
    {
        id: "auth-basic",
        name: "Request Authentication",
        category: "software-development",
        group: "authentication",
        tier: "free",
        enabled: true,
        description: "Bearer tokens, HTTP Basic credentials, and API keys sent as a header or a query parameter."
    },
    {
        id: "curl-interop",
        name: "cURL Import and Export",
        category: "software-development",
        group: "developer-tools",
        tier: "free",
        enabled: true,
        description: "Turn the current request into a shell-safe cURL command, or paste a cURL command to load it."
    },
    {
        id: "code-generation",
        name: "Client Code Generation",
        category: "software-development",
        group: "developer-tools",
        tier: "free",
        enabled: true,
        description: "Generate a ready-to-run client for the current request in JavaScript (fetch or axios), Python, Go, Java or C#."
    },
    {
        id: "json-tools",
        name: "JSON Format and Validate",
        category: "software-development",
        group: "developer-tools",
        tier: "free",
        enabled: true,
        description: "Format, minify and validate the request body or the last response, and pull values out with a JSON path."
    },
    {
        id: "jwt-inspector",
        name: "JWT Inspector",
        category: "software-development",
        group: "authentication",
        tier: "free",
        enabled: true,
        description: "Decode a JWT header and payload, show issued/expiry times, and flag unsafe algorithms. Decoding happens locally."
    },
    // ------------------------------------------------------------- premium: REST
    {
        id: "websocket-client",
        pointCost: 10,
        name: "WebSocket Testing",
        category: "software-development",
        group: "websocket",
        tier: "premium",
        enabled: true,
        description: "Open a WebSocket connection, send frames and watch the message log with timings.",
        premiumBenefit: "Test realtime endpoints without leaving the API client."
    },
    {
        id: "oauth2-helper",
        pointCost: 12,
        name: "OAuth 2.0 Helper",
        category: "software-development",
        group: "authentication",
        tier: "premium",
        enabled: true,
        description: "Fetch an access token with the client-credentials, password or refresh-token grant and apply it to the request.",
        premiumBenefit: "Client secrets are held in VS Code secret storage, never in the page or in history."
    },
    {
        id: "assertions",
        pointCost: 8,
        name: "Automated Assertions",
        category: "software-development",
        group: "api-testing",
        tier: "premium",
        enabled: true,
        description: "Declarative checks on status, headers, latency and JSON values, with a pass/fail report.",
        premiumBenefit: "Turn a manual request into a repeatable test without writing a script."
    },
    {
        id: "request-chaining",
        pointCost: 15,
        name: "Request Chaining",
        category: "software-development",
        group: "api-testing",
        tier: "premium",
        enabled: true,
        description: "Run saved requests in sequence, extracting values from each response into variables for the next.",
        premiumBenefit: "Drive multi-step flows such as login, then create, then verify."
    },
    {
        id: "batch-performance",
        pointCost: 20,
        name: "Batch and Performance Testing",
        category: "software-development",
        group: "api-testing",
        tier: "premium",
        enabled: true,
        description: "Fire a configurable number of concurrent requests and report success rate with p50, p90 and p99 latency.",
        premiumBenefit: "See tail latency, not just a single sample."
    },
    {
        id: "response-diff",
        pointCost: 8,
        name: "Response Comparison",
        category: "software-development",
        group: "api-testing",
        tier: "premium",
        enabled: true,
        description: "Structurally compare two captured responses and list added, removed and changed values.",
        premiumBenefit: "Spot contract drift between environments or releases."
    },
    {
        id: "collections-advanced",
        pointCost: 10,
        name: "Advanced Collections",
        category: "software-development",
        group: "developer-tools",
        tier: "premium",
        enabled: true,
        description: "Export a whole collection to JSON and import one back, for sharing a set of requests with a team.",
        premiumBenefit: "Share a whole collection instead of one request at a time."
    },
    {
        id: "security-headers-scan",
        pointCost: 15,
        name: "Endpoint Security Scan",
        category: "software-development",
        group: "api-testing",
        tier: "premium",
        enabled: true,
        description: "Run the full endpoint scan against the configured request: TLS and certificate state, HSTS, security headers, CSP, CORS, cookie flags, information exposure and rate limiting, each with a severity and a fix.",
        premiumBenefit: "Also unlockable with DevSnip Pro points."
    },
    {
        id: "sdk-export",
        pointCost: 10,
        name: "Typed SDK Export",
        category: "software-development",
        group: "developer-tools",
        tier: "premium",
        enabled: true,
        description: "Generate a typed client wrapper and a Python equivalent for the current request.",
        premiumBenefit: "Also unlockable with DevSnip Pro points."
    },
    {
        id: "mock-generator",
        pointCost: 15,
        name: "Mock Server and Schema",
        category: "software-development",
        group: "developer-tools",
        tier: "premium",
        enabled: true,
        description: "Generate an Express mock route and an inferred JSON Schema contract from the current request.",
        premiumBenefit: "Also unlockable with DevSnip Pro points."
    },
    // ------------------------------------------------------------ free: AI / ML
    {
        id: "llm-request",
        name: "LLM API Requests",
        category: "ai-ml",
        group: "llm-apis",
        tier: "free",
        enabled: true,
        description: "Send a chat completion to OpenAI, Anthropic, Google Gemini, Azure OpenAI or a local Ollama server. The request shape and response parsing are handled per provider."
    },
    {
        id: "prompt-test",
        name: "Prompt Testing",
        category: "ai-ml",
        group: "prompt-testing",
        tier: "free",
        enabled: true,
        description: "Run a system and user prompt against one model and inspect the reply, token usage and latency."
    },
    {
        id: "token-analysis",
        name: "Token and Cost Analysis",
        category: "ai-ml",
        group: "llm-apis",
        tier: "free",
        enabled: true,
        description: "Estimate prompt tokens and per-call cost before sending, and show the provider's reported usage afterwards."
    },
    {
        id: "llm-streaming",
        name: "Streaming Responses",
        category: "ai-ml",
        group: "llm-apis",
        tier: "free",
        enabled: true,
        description: "Stream a completion token by token and watch it arrive.",
        premiumBenefit: "Premium adds time-to-first-token and inter-token latency diagnostics."
    },
    {
        id: "ai-schema-validation",
        name: "AI Response Schema Validation",
        category: "ai-ml",
        group: "prompt-testing",
        tier: "free",
        enabled: true,
        description: "Validate a model's JSON output against a JSON Schema and see exactly which fields failed."
    },
    // --------------------------------------------------------- premium: AI / ML
    {
        id: "llm-compare",
        pointCost: 30,
        name: "Multi-Model Comparison",
        category: "ai-ml",
        group: "model-comparison",
        tier: "premium",
        enabled: true,
        description: "Send the same prompt to several models at once and compare replies, latency, tokens and cost side by side.",
        premiumBenefit: "Pick a model on evidence instead of guesswork."
    },
    {
        id: "llm-benchmark",
        pointCost: 35,
        name: "LLM Benchmarking",
        category: "ai-ml",
        group: "model-comparison",
        tier: "premium",
        enabled: true,
        description: "Repeat a prompt N times against a model and report latency percentiles, tokens per second and cost per run.",
        premiumBenefit: "Measure real throughput, including variance."
    },
    {
        id: "streaming-diagnostics",
        pointCost: 12,
        name: "Streaming Diagnostics",
        category: "ai-ml",
        group: "llm-apis",
        tier: "premium",
        enabled: true,
        description: "Measure time to first token, inter-token gaps and streaming throughput for a completion.",
        premiumBenefit: "Find out whether slowness is the model or the pipeline."
    },
    {
        id: "embeddings-test",
        pointCost: 18,
        name: "Embeddings Testing",
        category: "ai-ml",
        group: "embeddings",
        tier: "premium",
        enabled: true,
        description: "Call an embeddings endpoint, check the returned dimensions, and compute cosine similarity between inputs.",
        premiumBenefit: "Verify an embedding model before it goes into a pipeline."
    },
    {
        id: "vector-search-test",
        pointCost: 18,
        name: "Vector Database Testing",
        category: "ai-ml",
        group: "embeddings",
        tier: "premium",
        enabled: true,
        description: "Query Qdrant, Pinecone, Weaviate or Chroma with a vector or text and inspect the ranked matches.",
        premiumBenefit: "Test retrieval directly against your index."
    },
    {
        id: "rag-pipeline-test",
        pointCost: 30,
        name: "RAG Pipeline Testing",
        category: "ai-ml",
        group: "rag",
        tier: "premium",
        enabled: true,
        description: "Retrieve context from a vector database, generate an answer with it, and report how much of the answer is grounded in the retrieved text.",
        premiumBenefit: "Test retrieval and generation as one pipeline, with a grounding score."
    },
    {
        id: "agent-test",
        pointCost: 30,
        name: "AI Agent Testing",
        category: "ai-ml",
        group: "ai-agents",
        tier: "premium",
        enabled: true,
        description: "Run a multi-turn tool-calling loop against a model with declared tools, and trace every call the model makes.",
        premiumBenefit: "See the agent's whole decision trace, turn by turn."
    },
    {
        id: "prompt-eval",
        pointCost: 25,
        name: "Prompt Evaluation",
        category: "ai-ml",
        group: "prompt-testing",
        tier: "premium",
        enabled: true,
        description: "Score prompt variants against declarative criteria such as required phrases, forbidden phrases, JSON validity and length.",
        premiumBenefit: "Compare prompt wordings against the same rubric."
    },
    {
        id: "prompt-versioning",
        pointCost: 8,
        name: "Prompt Versioning",
        category: "ai-ml",
        group: "prompt-testing",
        tier: "premium",
        enabled: true,
        description: "Keep a version history for each named prompt and diff any two versions.",
        premiumBenefit: "Track how a production prompt changed, and revert."
    },
    {
        id: "ai-history-analytics",
        pointCost: 10,
        name: "AI Request Analytics",
        category: "ai-ml",
        group: "model-comparison",
        tier: "premium",
        enabled: true,
        description: "Aggregate recorded AI calls by model and provider with total tokens, spend, average latency and failure rate.",
        premiumBenefit: "See where the token budget actually goes."
    },
    {
        id: "load-test",
        pointCost: 20,
        name: "Concurrent Load Test",
        category: "software-development",
        group: "api-testing",
        tier: "premium",
        enabled: true,
        description: "Run a burst of concurrent calls against an endpoint and report latency and success rate.",
        premiumBenefit: "Also unlockable with DevSnip Pro points."
    }
];
/**
 * Daily usage limits. Only features where a cap is meaningful appear here;
 * anything absent is unlimited for both tiers.
 */
exports.FEATURE_LIMITS = [
    { featureId: "llm-request", freeLimit: 25, unit: "AI requests" },
    { featureId: "prompt-test", freeLimit: 25, unit: "prompt runs" },
    { featureId: "llm-streaming", freeLimit: 10, unit: "streamed responses" }
];
/**
 * Every premium feature and what it costs in points, derived from the registry
 * so a price is never defined in two places.
 */
const featureIndexEarly = new Map(exports.DEVELOPER_FEATURES.map(feature => [feature.id, feature]));
exports.POINT_UNLOCKABLE = Object.fromEntries(exports.DEVELOPER_FEATURES
    .filter(feature => feature.tier === "premium" && typeof feature.pointCost === "number")
    .map(feature => [feature.id, feature.pointCost]));
/** Points charged to run a feature, or 0 when it is free. */
function pointCostFor(featureId) {
    const feature = featureIndexEarly.get(featureId);
    return feature && feature.tier === "premium" ? feature.pointCost ?? 0 : 0;
}
exports.pointCostFor = pointCostFor;
const featureIndex = new Map(exports.DEVELOPER_FEATURES.map(feature => [feature.id, feature]));
const limitIndex = new Map(exports.FEATURE_LIMITS.map(limit => [limit.featureId, limit]));
function getFeature(featureId) {
    return featureIndex.get(featureId);
}
exports.getFeature = getFeature;
function getFeatureLimit(featureId) {
    return limitIndex.get(featureId);
}
exports.getFeatureLimit = getFeatureLimit;
function featuresByCategory(category) {
    return exports.DEVELOPER_FEATURES.filter(feature => feature.category === category);
}
exports.featuresByCategory = featuresByCategory;
function featuresByGroup(group) {
    return exports.DEVELOPER_FEATURES.filter(feature => feature.group === group);
}
exports.featuresByGroup = featuresByGroup;
/** Every feature id, used by tests to prove nothing is defined twice. */
function allFeatureIds() {
    return exports.DEVELOPER_FEATURES.map(feature => feature.id);
}
exports.allFeatureIds = allFeatureIds;
//# sourceMappingURL=feature-registry.js.map