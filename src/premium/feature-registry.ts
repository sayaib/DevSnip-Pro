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

export type FeatureTier = "free" | "premium";
export type FeatureCategory = "ai-ml" | "software-development";

/** Sub-groups used by the client's navigation tree. */
export type FeatureGroup =
  | "rest"
  | "graphql"
  | "websocket"
  | "authentication"
  | "api-testing"
  | "developer-tools"
  | "llm-apis"
  | "embeddings"
  | "rag"
  | "ai-agents"
  | "prompt-testing"
  | "model-comparison";

export interface DeveloperFeature {
  id: string;
  name: string;
  category: FeatureCategory;
  group: FeatureGroup;
  tier: FeatureTier;
  description: string;
  /**
   * Whether the feature is available at all in this build. A disabled feature
   * is inaccessible to every tier - used to retire a capability without
   * deleting its code path.
   */
  enabled: boolean;
  /** Shown on the locked card so users know what they would be unlocking. */
  premiumBenefit?: string;
}

/**
 * Usage limits, kept together so a limit is never a magic number buried in a
 * service. `undefined` means "not limited for that tier".
 */
export interface FeatureLimit {
  featureId: string;
  /** Maximum uses per calendar day for the free tier. */
  freeLimit?: number;
  premiumLimit?: number | "unlimited";
  /** Shown to the user when the limit is reached. */
  unit: string;
}

export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
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

export const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  "software-development": "Software Developer",
  "ai-ml": "AI / ML Developer"
};

/** Order the navigation tree renders groups in, per category. */
export const CATEGORY_GROUPS: Record<FeatureCategory, FeatureGroup[]> = {
  "software-development": ["rest", "graphql", "websocket", "authentication", "api-testing", "developer-tools"],
  "ai-ml": ["llm-apis", "embeddings", "rag", "ai-agents", "prompt-testing", "model-comparison"]
};

export const DEVELOPER_FEATURES: DeveloperFeature[] = [
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
    description: "Save requests and reopen them later.",
    premiumBenefit: "Free saves a limited number of requests; Premium is unlimited and adds import and export."
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
    name: "Advanced Collections",
    category: "software-development",
    group: "developer-tools",
    tier: "premium",
    enabled: true,
    description: "Unlimited saved requests, plus collection import and export as JSON for sharing with a team.",
    premiumBenefit: "Share a whole collection instead of one request at a time."
  },
  {
    id: "security-headers-scan",
    name: "Security Header Scan",
    category: "software-development",
    group: "api-testing",
    tier: "premium",
    enabled: true,
    description: "Check a live endpoint for HSTS, CSP, frame and content-type protections and report what is missing.",
    premiumBenefit: "Also unlockable with DevSnip Pro points."
  },
  {
    id: "sdk-export",
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
export const FEATURE_LIMITS: FeatureLimit[] = [
  { featureId: "llm-request", freeLimit: 25, premiumLimit: "unlimited", unit: "AI requests" },
  { featureId: "prompt-test", freeLimit: 25, premiumLimit: "unlimited", unit: "prompt runs" },
  { featureId: "llm-streaming", freeLimit: 10, premiumLimit: "unlimited", unit: "streamed responses" },
  { featureId: "collections-basic", freeLimit: 15, premiumLimit: "unlimited", unit: "saved requests" },
  { featureId: "llm-compare", premiumLimit: "unlimited", unit: "model comparisons" },
  { featureId: "prompt-eval", premiumLimit: "unlimited", unit: "prompt evaluations" },
  { featureId: "rag-pipeline-test", premiumLimit: "unlimited", unit: "RAG tests" },
  { featureId: "llm-benchmark", premiumLimit: "unlimited", unit: "benchmark runs" }
];

/**
 * Features that a free user may also unlock by spending DevSnip Pro points.
 * This preserves the points-based tools that shipped before subscriptions
 * existed - a free user keeps exactly the access they had.
 */
export const POINT_UNLOCKABLE: Record<string, number> = {
  "security-headers-scan": 15,
  "load-test": 20,
  "sdk-export": 10,
  "mock-generator": 15
};

const featureIndex = new Map(DEVELOPER_FEATURES.map(feature => [feature.id, feature]));
const limitIndex = new Map(FEATURE_LIMITS.map(limit => [limit.featureId, limit]));

export function getFeature(featureId: string): DeveloperFeature | undefined {
  return featureIndex.get(featureId);
}

export function getFeatureLimit(featureId: string): FeatureLimit | undefined {
  return limitIndex.get(featureId);
}

export function featuresByCategory(category: FeatureCategory): DeveloperFeature[] {
  return DEVELOPER_FEATURES.filter(feature => feature.category === category);
}

export function featuresByGroup(group: FeatureGroup): DeveloperFeature[] {
  return DEVELOPER_FEATURES.filter(feature => feature.group === group);
}

/** Every feature id, used by tests to prove nothing is defined twice. */
export function allFeatureIds(): string[] {
  return DEVELOPER_FEATURES.map(feature => feature.id);
}
