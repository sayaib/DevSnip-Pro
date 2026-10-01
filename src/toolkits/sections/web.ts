import { ToolSpec, ToolInputError, ToolResult, bool, fmtBytes, num, required, str } from "../types";
import { CURL_TARGETS, CurlTarget, curlWarnings, generateFromCurl, parseCurl, toCurl } from "../engines/web-curl";
import { ArrayFormat, AssetKind, CACHE_PRESETS, buildCookie, buildUrl, cacheConfigs, explainCacheControl, objectToQuery, parseCookieHeader, parseSetCookie, parseUrlReport, queryToObject } from "../engines/web-http";
import { analyzeCsp, auditHeaders, buildCsp, checkCors, corsConfigs, explainCorsError, securityHeaderConfigs, securityHeaderSet } from "../engines/web-security";
import { OAUTH_PROVIDERS, parseCallback, pkcePair, randomToken } from "../engines/web-auth";
import { curlExamples, formatGraphql, graphqlOperations, lintSpec, minifyGraphql, openApiFromSample, operations, parseSpec, sampleForGqlType, sdlToTypeScript, specClient, specTypes } from "../engines/web-apispec";
import { TYPE_RATIOS, convertUnits, fluidClamp, htmlToJsx, metaTags, typeScale } from "../engines/web-frontend";
import { ApiDatabase, ApiFramework, DbKind, ReactKind, buildConnectionUrl, connectionSnippets, connectionWarnings, parseConnectionUrl, parseFields, reactScaffold, scaffoldResource, sqlToMongo } from "../engines/web-scaffold";
import { BumpKind, COMMIT_TYPES, GITIGNORE, GITIGNORE_MARKERS, GIT_RECIPES, GitParams, MAX_VERSION_CODE, buildGitignore, bump, commitMessage, compareVersions, derivedVersionCode, describeRange, formatVersion, missingIgnores, parseRange, parseVersion, satisfies } from "../engines/web-git";
import { inspectApiResponse } from "../engines/data-inspect";
import { code, f, list, opts, severityMessages, table, text } from "./helpers";

type Messages = NonNullable<ToolResult["messages"]>;
type Outputs = NonNullable<ToolResult["outputs"]>;

// ---------------------------------------------------------------------------
// HTTP & APIs
// ---------------------------------------------------------------------------

const SAMPLE_CURL = `curl 'https://api.example.com/v1/orders?status=open' \\
  -X POST \\
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.x' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"customerId":"c_123","items":[{"sku":"A-1","qty":2}],"note":"Leave at door"}'`;

const curlTool: ToolSpec = {
  id: "web.curl",
  command: "curlConverter",
  title: "cURL Converter",
  summary: "Turn a cURL command (from the browser's \"Copy as cURL\" or API docs) into fetch, Axios, Node, Python, Go, PHP, Java, Dart/Flutter, Kotlin/OkHttp, Swift or raw HTTP.",
  guide: "Paste the command as copied: bash or Windows cmd quoting, line continuations and combined flags (-sSL, -XPOST) are understood. Headers, JSON / form / multipart bodies, basic auth, cookies, -G, --json, timeouts and redirects are converted. Nothing is sent anywhere.",
  keywords: ["curl", "copy as curl", "fetch", "axios", "requests", "http client", "okhttp", "urlsession", "dio", "convert curl"],
  icon: "terminal",
  live: true,
  fields: [
    f.code("curl", "cURL command", "shell", { rows: 9, required: true, fromEditor: true, default: SAMPLE_CURL }),
    f.select("target", "Convert to", CURL_TARGETS.map(t => ({ value: t.id, label: t.label }))),
    f.toggle("all", "Show every language", false)
  ],
  examples: [
    { label: "JSON POST with a bearer token", values: { curl: SAMPLE_CURL } },
    { label: "File upload (multipart) with basic auth", values: { curl: "curl -u admin:s3cret -F 'file=@./report.pdf' -F 'title=Q3 report' https://files.example.com/upload", target: "dart-http" } },
    { label: "Form login with redirects", values: { curl: "curl -L -X POST https://example.com/login -d 'username=ada' -d 'password=hunter2' -c cookies.txt", target: "python" } },
    { label: "GET with query from -G", values: { curl: "curl -G https://api.example.com/search --data-urlencode 'q=coffee near me' -d limit=10 -H 'Accept: application/json'", target: "swift" } }
  ],
  run(values) {
    const r = parseCurl(required(values, "curl", "cURL command"));
    const target = str(values, "target", "fetch") as CurlTarget;
    const targets = bool(values, "all") ? CURL_TARGETS : CURL_TARGETS.filter(t => t.id === target);
    const bodyLabel = r.bodyKind === "none" ? "none" : r.bodyKind === "multipart" ? `multipart (${r.form.length} parts)` : `${r.bodyKind} · ${fmtBytes(Buffer.byteLength(r.body ?? ""))}`;
    const u = new URL(r.url);
    return {
      stats: [{ label: "Method", value: r.method }, { label: "Host", value: u.host }, { label: "Headers", value: String(r.headers.length) }, { label: "Body", value: bodyLabel }],
      messages: curlWarnings(r).map(t => ({ kind: "warning" as const, text: t })),
      outputs: [
        ...targets.map(t => code(t.label, t.language, generateFromCurl(r, t.id), t.file)),
        table("Request", ["Part", "Value"], [["URL", r.url], ...r.headers.map(([k, v]) => [`Header: ${k}`, /^(authorization|cookie|x-api-key)$/i.test(k) ? `${v.slice(0, 12)}…` : v] as [string, string]), ...(r.basicAuth ? [["Basic auth user", r.basicAuth.user] as [string, string]] : [])]),
        code("Normalised cURL", "shell", toCurl(r))
      ]
    };
  }
};

const apiResponse: ToolSpec = {
  id: "web.api-response",
  command: "apiResponseInspector",
  title: "API Response Inspector",
  summary: "Paste a raw HTTP response (or just the body): pretty-printed body, headers, status meaning, pagination, caching and error hints, and a field list.",
  keywords: ["http response", "headers", "status code", "rest", "curl -i", "pagination", "cache-control"],
  icon: "api",
  live: true,
  fields: [f.code("raw", "Response", "http", { rows: 12, required: true, fromEditor: true, default: 'HTTP/1.1 429 Too Many Requests\nContent-Type: application/json\nRetry-After: 30\nX-RateLimit-Remaining: 0\n\n{"error": {"code": "rate_limited", "message": "Slow down"}, "requestId": "req_123"}' })],
  run(values) {
    const r = inspectApiResponse(str(values, "raw"));
    return {
      stats: [
        ...(r.status ? [{ label: "Status", value: `${r.status}${r.statusText ? " " + r.statusText : ""}`, tone: (r.status < 300 ? "good" : r.status < 400 ? "neutral" : "bad") as "good" | "neutral" | "bad" }] : []),
        { label: "Body", value: `${r.isJson ? "JSON" : "text"} · ${fmtBytes(r.bytes)}` },
        { label: "Headers", value: String(r.headers.length) }
      ],
      messages: r.insights.map(t => ({ kind: "info" as const, text: t })),
      outputs: [
        code("Body", r.isJson ? "json" : "text", r.isJson ? JSON.stringify(r.body, null, 2) : r.bodyText),
        ...(r.headers.length ? [table("Headers", ["Header", "Value"], r.headers)] : []),
        ...(r.fields.length ? [table("Fields", ["Path", "Type", "Example"], r.fields.map(x => [x.path, x.type, x.example]))] : [])
      ]
    };
  }
};

const urlTool: ToolSpec = {
  id: "web.url",
  command: "urlTools",
  title: "URL & Query String Tool",
  summary: "Break a URL into parts and decoded query parameters (with double-encoding and leaked-token checks), build a correctly encoded URL, or convert query strings to and from nested JSON.",
  guide: "Query ↔ JSON uses the bracket convention of qs / Express / Rails / PHP: a[b]=1&tags[]=x → {\"a\":{\"b\":\"1\"},\"tags\":[\"x\"]}. Encoding uses encodeURIComponent plus the characters RFC 3986 reserves.",
  keywords: ["url parser", "query string", "query params", "urlencode", "search params", "qs", "decode url", "percent encoding"],
  icon: "link",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["parse", "Parse a URL"], ["build", "Build a URL"], ["qs-json", "Query string → JSON"], ["json-qs", "JSON → query string"])),
    f.area("url", "URL", { rows: 3, required: true, fromEditor: true, default: "https://shop.example.com:8443/api/v2/products/42?sort=price&tags[]=red&tags[]=sale&q=caf%C3%A9+latte&access_token=abc123#reviews", showIf: { field: "mode", equals: ["parse"] } }),
    f.text("base", "Base URL", { default: "https://api.example.com/v1/search", showIf: { field: "mode", equals: ["build"] } }),
    f.area("params", "Parameters (key=value per line, -key removes)", { rows: 6, default: "q=coffee & cake\ncity=São Paulo\nredirect=https://app.example.com/cb?x=1\npage=2", showIf: { field: "mode", equals: ["build"] } }),
    f.area("query", "Query string", { rows: 4, default: "filter[status]=active&filter[age][gte]=18&sort=-createdAt&fields[]=name&fields[]=email&page=2", showIf: { field: "mode", equals: ["qs-json"] } }),
    f.code("json", "JSON object", "json", { rows: 8, default: '{\n  "filter": { "status": "active", "age": { "gte": 18 } },\n  "fields": ["name", "email"],\n  "page": 2\n}', showIf: { field: "mode", equals: ["json-qs"] } }),
    f.select("arrayFormat", "Arrays as", opts(["brackets", "tags[]=a&tags[]=b"], ["indices", "tags[0]=a&tags[1]=b"], ["repeat", "tags=a&tags=b"], ["comma", "tags=a,b"]), { showIf: { field: "mode", equals: ["json-qs"] } })
  ],
  run(values) {
    const mode = str(values, "mode", "parse");
    if (mode === "build") {
      const url = buildUrl(required(values, "base", "Base URL"), str(values, "params"));
      return { stats: [{ label: "Length", value: `${url.length} chars` }], outputs: [code("URL", "text", url), table("Parameters", ["Key", "Value", "Encoded"], [...new URL(url).searchParams].map(([k, v]) => [k, v, `${encodeURIComponent(k)}=${encodeURIComponent(v)}`]))] };
    }
    if (mode === "qs-json") {
      const obj = queryToObject(required(values, "query", "Query string"));
      return { outputs: [code("JSON", "json", JSON.stringify(obj, null, 2)), code("URLSearchParams (flat)", "javascript", `const params = new URLSearchParams(${JSON.stringify(str(values, "query").replace(/^.*?\?/, ""))});\nconsole.log(Object.fromEntries(params)); // repeated keys keep only the last value\nconsole.log(params.getAll("fields[]"));\n`)] };
    }
    if (mode === "json-qs") {
      let parsed: unknown;
      try { parsed = JSON.parse(required(values, "json", "JSON")); } catch (e) { throw new ToolInputError(`Not valid JSON: ${(e as Error).message}`); }
      const qs = objectToQuery(parsed, str(values, "arrayFormat", "brackets") as ArrayFormat);
      return { outputs: [code("Query string", "text", qs), code("qs library", "javascript", `import qs from "qs";\n\nconst query = qs.stringify(${JSON.stringify(parsed)}, { arrayFormat: ${JSON.stringify(str(values, "arrayFormat", "brackets") === "repeat" ? "repeat" : str(values, "arrayFormat", "brackets"))}, encodeValuesOnly: true });\n`)] };
    }
    const r = parseUrlReport(required(values, "url", "URL"));
    return {
      stats: [{ label: "Parameters", value: String(r.params.length) }, { label: "Warnings", value: String(r.warnings.length), tone: r.warnings.length ? "warn" : "good" }],
      messages: r.warnings.map(t => ({ kind: "warning" as const, text: t })),
      outputs: [table("Parts", ["Part", "Value"], r.parts), ...(r.params.length ? [table("Query parameters", ["Key", "Decoded value", "Raw"], r.params), code("As JSON", "json", JSON.stringify(queryToObject(r.params.map(p => `${encodeURIComponent(p[0])}=${encodeURIComponent(p[1])}`).join("&")), null, 2))] : [])]
    };
  }
};

const SAMPLE_SPEC = `openapi: 3.1.0
info:
  title: Orders API
  version: 1.2.0
servers:
  - url: https://api.example.com/v1
security:
  - bearerAuth: []
paths:
  /orders:
    get:
      operationId: listOrders
      summary: List orders
      parameters:
        - name: status
          in: query
          schema: { type: string, enum: [open, paid, shipped] }
        - name: limit
          in: query
          schema: { type: integer, default: 20 }
      responses:
        "200":
          description: A page of orders
          content:
            application/json:
              schema:
                type: object
                properties:
                  items: { type: array, items: { $ref: "#/components/schemas/Order" } }
                  total: { type: integer }
    post:
      operationId: createOrder
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewOrder" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
  /orders/{orderId}:
    get:
      operationId: getOrder
      parameters:
        - name: orderId
          in: path
          required: true
          schema: { type: string }
      responses:
        "200":
          description: The order
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
        "404":
          description: Not found
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    NewOrder:
      type: object
      required: [customerId, items]
      properties:
        customerId: { type: string }
        items:
          type: array
          items:
            type: object
            required: [sku, qty]
            properties:
              sku: { type: string }
              qty: { type: integer, minimum: 1 }
        note: { type: string, nullable: true }
    Order:
      allOf:
        - $ref: "#/components/schemas/NewOrder"
        - type: object
          required: [id, status, createdAt]
          properties:
            id: { type: string, format: uuid }
            status: { type: string, enum: [open, paid, shipped] }
            createdAt: { type: string, format: date-time }
`;

const openApiTool: ToolSpec = {
  id: "web.openapi",
  command: "openApiTools",
  title: "OpenAPI / Swagger Toolkit",
  summary: "Paste an OpenAPI 3.x or Swagger 2.0 spec (JSON or YAML) to list and lint endpoints, generate TypeScript types, a typed fetch client and cURL examples - or create a spec from sample JSON.",
  guide: "Lint checks the mistakes that break code generators and docs: undeclared path parameters, duplicate operationIds, missing responses and unresolved $refs. The client uses fetch, so it works in browsers, React Native, Node 18+ and edge runtimes.",
  keywords: ["openapi", "swagger", "api docs", "typescript client", "codegen", "openapi to typescript", "api spec", "yaml"],
  icon: "doc",
  fields: [
    f.select("mode", "Generate", opts(["endpoints", "Endpoints & lint"], ["types", "TypeScript types"], ["client", "TypeScript fetch client"], ["curl", "cURL examples"], ["from-sample", "Spec from sample JSON"])),
    f.code("spec", "OpenAPI document", "yaml", { rows: 16, required: true, fromEditor: true, default: SAMPLE_SPEC, showIf: { field: "mode", equals: ["endpoints", "types", "client", "curl"] } }),
    f.select("method", "Method", opts("POST", "GET", "PUT", "PATCH", "DELETE"), { showIf: { field: "mode", equals: ["from-sample"] } }),
    f.text("path", "Path", { width: "narrow", default: "/users/{id}/orders", showIf: { field: "mode", equals: ["from-sample"] } }),
    f.text("status", "Status", { width: "narrow", default: "201", showIf: { field: "mode", equals: ["from-sample"] } }),
    f.code("requestJson", "Request body (JSON, optional)", "json", { rows: 6, default: '{\n  "sku": "A-1",\n  "qty": 2\n}', showIf: { field: "mode", equals: ["from-sample"] } }),
    f.code("responseJson", "Response body (JSON)", "json", { rows: 6, default: '{\n  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",\n  "sku": "A-1",\n  "qty": 2,\n  "createdAt": "2026-01-15T09:30:00Z"\n}', showIf: { field: "mode", equals: ["from-sample"] } })
  ],
  run(values) {
    const mode = str(values, "mode", "endpoints");
    if (mode === "from-sample") {
      const yaml = openApiFromSample(str(values, "method", "POST"), required(values, "path", "Path"), str(values, "requestJson"), str(values, "responseJson"), str(values, "status", "200").trim(), "API");
      return { messages: [{ kind: "info", text: "Inferred from one example: review required fields, formats and descriptions before publishing." }], outputs: [code("openapi.yaml", "yaml", yaml, "openapi.yaml")] };
    }
    const doc = parseSpec(required(values, "spec", "OpenAPI document"));
    const ops = operations(doc);
    const info = (doc.info ?? {}) as Record<string, unknown>;
    const stats: ToolResult["stats"] = [{ label: "Spec", value: doc.openapi ? `OpenAPI ${doc.openapi}` : `Swagger ${doc.swagger}` }, { label: "API", value: `${info.title ?? "?"} ${info.version ?? ""}`.trim() }, { label: "Operations", value: String(ops.length) }];
    if (mode === "types") return { stats, outputs: [code("Types", "typescript", specTypes(doc), "api-types.ts")] };
    if (mode === "client") return { stats, outputs: [code("Client", "typescript", specClient(doc, ops), "api-client.ts")] };
    if (mode === "curl") return { stats, outputs: [code("cURL", "shell", curlExamples(doc, ops))] };
    const issues = lintSpec(doc, ops);
    return {
      stats: [...stats, { label: "Problems", value: String(issues.filter(i => i.severity !== "info").length), tone: issues.some(i => i.severity === "error") ? "bad" : issues.length ? "warn" : "good" }],
      messages: severityMessages(issues, "No problems found."),
      outputs: [table("Endpoints", ["Method", "Path", "operationId", "Summary", "Auth", "Responses"], ops.map(o => [o.method, o.path, o.operationId || "-", `${o.summary}${o.deprecated ? " (deprecated)" : ""}`, o.secured ? "yes" : "no", o.responses.map(r => r.status).join(", ")]))]
    };
  }
};

const SAMPLE_GQL = `query GetUser($id: ID!, $first: Int = 10) { user(id: $id) { id name email
 posts(first: $first, orderBy: {field: CREATED_AT, direction: DESC}) { edges { node { id title tags } } pageInfo { hasNextPage endCursor } }
 ...ProfileFields } }
fragment ProfileFields on User { avatarUrl(size: 128) bio }`;

const SAMPLE_SDL = `"A registered user"
type User implements Node {
  id: ID!
  email: String!
  name: String
  role: Role!
  posts(first: Int = 10): [Post!]!
}

interface Node { id: ID! }

type Post implements Node {
  id: ID!
  title: String!
  tags: [String!]
  author: User!
}

enum Role { ADMIN EDITOR VIEWER }

input CreatePostInput {
  title: String!
  tags: [String!]
}

union SearchResult = User | Post
scalar DateTime`;

const graphqlTool: ToolSpec = {
  id: "web.graphql",
  command: "graphqlTools",
  title: "GraphQL Formatter & Types",
  summary: "Format or minify GraphQL queries, list their operations and variables, build the JSON request body, cURL and fetch calls - or turn a schema (SDL) into TypeScript types.",
  keywords: ["graphql", "gql", "format graphql", "prettify", "apollo", "sdl", "schema to typescript", "variables"],
  icon: "network",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["query", "Query: format & request"], ["sdl", "Schema (SDL) → TypeScript"])),
    f.code("query", "Query / mutation", "graphql", { rows: 10, required: true, fromEditor: true, default: SAMPLE_GQL, showIf: { field: "mode", equals: ["query"] } }),
    f.text("endpoint", "Endpoint", { default: "https://api.example.com/graphql", showIf: { field: "mode", equals: ["query"] } }),
    f.code("sdl", "Schema (SDL)", "graphql", { rows: 14, fromEditor: true, default: SAMPLE_SDL, showIf: { field: "mode", equals: ["sdl"] } })
  ],
  run(values) {
    if (str(values, "mode", "query") === "sdl") {
      const types = sdlToTypeScript(required(values, "sdl", "Schema"));
      return { messages: [{ kind: "info", text: "Nullable GraphQL fields become T | null; input fields that are nullable are optional. For full typed operations use GraphQL Code Generator." }], outputs: [code("TypeScript", "typescript", types, "graphql-types.ts")] };
    }
    const query = required(values, "query", "Query");
    const formatted = formatGraphql(query);
    const { operations: ops, fragments } = graphqlOperations(query);
    const op = ops[0];
    const variables = Object.fromEntries((op?.variables ?? []).map(v => [v.name, v.defaultValue !== undefined ? (Number.isFinite(Number(v.defaultValue)) ? Number(v.defaultValue) : v.defaultValue.replace(/^"|"$/g, "")) : sampleForGqlType(v.type)]));
    const minified = minifyGraphql(query);
    const body = { query: minified, ...(op?.variables.length ? { variables } : {}), ...(op?.name && ops.length > 1 ? { operationName: op.name } : {}) };
    const endpoint = str(values, "endpoint", "https://api.example.com/graphql");
    const messages: Messages = [];
    if (ops.length > 1 && ops.some(o => !o.name)) messages.push({ kind: "error", text: "A document with several operations must name each one, and the request must send operationName." });
    if (op && !op.name) messages.push({ kind: "info", text: "Name your operations (query GetUser { … }): server logs, APQ and Apollo DevTools use the name." });
    const usedFragments = new Set([...query.matchAll(/\.\.\.\s*([_A-Za-z]\w*)/g)].map(m => m[1]).filter(n => n !== "on"));
    for (const name of usedFragments) if (!fragments.includes(name)) messages.push({ kind: "error", text: `Fragment ${name} is used but not defined in this document.` });
    for (const name of fragments) if (!usedFragments.has(name)) messages.push({ kind: "warning", text: `Fragment ${name} is defined but never used (servers reject unused fragments).` });
    return {
      stats: [{ label: "Operations", value: ops.map(o => `${o.type} ${o.name || "(anonymous)"}`).join(", ") || "none" }, { label: "Variables", value: String(op?.variables.length ?? 0) }, { label: "Size", value: `${query.length} → ${minified.length} chars` }],
      messages,
      outputs: [
        code("Formatted", "graphql", formatted),
        ...(op?.variables.length ? [table("Variables", ["Name", "Type", "Default"], op.variables.map(v => [`$${v.name}`, v.type, v.defaultValue ?? ""]))] : []),
        code("Request body (JSON)", "json", JSON.stringify(body, null, 2)),
        code("cURL", "shell", `curl ${endpoint} \\\n  -H 'Content-Type: application/json' \\\n  -H "Authorization: Bearer $TOKEN" \\\n  --data-raw '${JSON.stringify(body).replace(/'/g, "'\\''")}'`),
        code("fetch", "javascript", `const response = await fetch(${JSON.stringify(endpoint)}, {\n  method: "POST",\n  headers: { "Content-Type": "application/json" },\n  body: JSON.stringify({\n    query: \`${formatted.trim().replace(/`/g, "\\`").replace(/\$\{/g, "\\${").split("\n").join("\n    ")}\`,\n    variables: ${JSON.stringify(variables)},\n  }),\n});\nconst { data, errors } = await response.json();\n// GraphQL returns 200 even for errors: always check the errors array.\nif (errors?.length) throw new Error(errors.map(e => e.message).join("; "));\nconsole.log(data);\n`),
        code("Minified", "graphql", minified)
      ]
    };
  }
};

// ---------------------------------------------------------------------------
// Auth & security
// ---------------------------------------------------------------------------

const oauthTool: ToolSpec = {
  id: "web.oauth",
  command: "oauthPkce",
  title: "OAuth 2.0 & PKCE Helper",
  summary: "Generate a PKCE verifier/challenge, state and nonce; build the authorization URL for Google, GitHub, Microsoft, Auth0, Okta, Cognito, Keycloak or Apple; get the token and refresh requests; decode the callback.",
  guide: "Authorization Code + PKCE is the recommended flow for SPAs and mobile apps (RFC 9700): no client secret ships in the app. Values are generated locally with a cryptographic random source. Keep the verifier and state in memory/session storage until the callback.",
  keywords: ["oauth", "oauth2", "pkce", "code verifier", "code challenge", "openid connect", "oidc", "authorization code", "redirect uri", "sso", "login"],
  icon: "lock",
  runLabel: "Generate",
  fields: [
    f.select("provider", "Provider", Object.entries(OAUTH_PROVIDERS).map(([value, p]) => ({ value, label: p.label }))),
    f.text("clientId", "Client ID", { default: "your-client-id" }),
    f.text("redirectUri", "Redirect URI", { default: "http://localhost:3000/auth/callback", help: "Mobile: a custom scheme (com.example.app:/oauth2redirect) or a universal / App Link." }),
    f.text("scope", "Scope (blank = provider default)", {}),
    f.text("authorize", "Authorization endpoint (custom)", { default: OAUTH_PROVIDERS.custom.authorize, showIf: { field: "provider", equals: ["custom"] } }),
    f.text("tokenUrl", "Token endpoint (custom)", { default: OAUTH_PROVIDERS.custom.token, showIf: { field: "provider", equals: ["custom"] } }),
    f.text("verifier", "Existing code_verifier (optional)", { placeholder: "Leave blank to generate a new one" }),
    f.area("callback", "Callback URL to decode (optional)", { rows: 2, placeholder: "http://localhost:3000/auth/callback?code=...&state=..." })
  ],
  run(values) {
    const key = str(values, "provider", "custom");
    const p = OAUTH_PROVIDERS[key] ?? OAUTH_PROVIDERS.custom;
    const authorize = key === "custom" ? str(values, "authorize", p.authorize) : p.authorize;
    const tokenUrl = key === "custom" ? str(values, "tokenUrl", p.token) : p.token;
    const { verifier, challenge } = pkcePair(str(values, "verifier"));
    const state = randomToken(16);
    const nonce = randomToken(16);
    const clientId = str(values, "clientId", "your-client-id").trim();
    const redirect = str(values, "redirectUri").trim();
    if (!redirect) throw new ToolInputError("Enter the redirect URI registered for your app.");
    const scope = str(values, "scope").trim() || p.scope;
    const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, scope, state, code_challenge: challenge, code_challenge_method: "S256", ...(scope.includes("openid") ? { nonce } : {}), ...(p.extra ?? {}) });
    const url = `${authorize}?${params.toString()}`;
    const messages: Messages = [];
    if (p.note) messages.push({ kind: "info", text: p.note });
    if (/\{[a-z]+\}/.test(authorize)) messages.push({ kind: "warning", text: `Replace the placeholders in the endpoint (${authorize.match(/\{[a-z]+\}/g)!.join(", ")}).` });
    if (/^http:\/\/(?!localhost|127\.0\.0\.1)/.test(redirect)) messages.push({ kind: "warning", text: "Redirect URIs must be https (except localhost). Providers reject http for anything else." });
    const outputs: Outputs = [];
    const callback = str(values, "callback").trim();
    if (callback) {
      const cb = parseCallback(callback);
      const err = cb.find(([k]) => k === "error");
      messages.unshift(err ? { kind: "error", text: `The provider returned ${err[1]}: ${cb.find(([k]) => k === "error_description")?.[1] ?? "no description"}.` } : { kind: "success", text: "Callback decoded. Check that its state matches the one you sent, then exchange the code within its lifetime (usually 1-10 minutes, single use)." });
      outputs.push(table("Callback parameters", ["Parameter", "Value"], cb));
    }
    const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
    outputs.push(
      table("Generated values", ["Value", "Use"], [[verifier, "code_verifier - keep secret until the token request"], [challenge, "code_challenge (S256 of the verifier)"], [state, "state - compare on callback (CSRF protection)"], [nonce, "nonce - compare with the ID token's nonce claim"]]),
      code("Authorization URL", "text", url),
      code("Exchange the code for tokens", "shell", `curl -X POST ${sh(tokenUrl)} \\\n  -H 'Content-Type: application/x-www-form-urlencoded' \\\n  -H 'Accept: application/json' \\\n  --data-urlencode 'grant_type=authorization_code' \\\n  --data-urlencode ${sh(`client_id=${clientId}`)} \\\n  --data-urlencode ${sh(`redirect_uri=${redirect}`)} \\\n  --data-urlencode ${sh(`code_verifier=${verifier}`)} \\\n  --data-urlencode 'code=PASTE_CODE_FROM_CALLBACK'\n# Confidential (server-side) clients also send client_secret.`),
      code("Refresh the access token", "shell", `curl -X POST ${sh(tokenUrl)} \\\n  -H 'Content-Type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'grant_type=refresh_token' \\\n  --data-urlencode ${sh(`client_id=${clientId}`)} \\\n  --data-urlencode 'refresh_token=PASTE_REFRESH_TOKEN'`),
      code("PKCE in the browser / React Native (Web Crypto)", "javascript", `function base64url(bytes) {\n  return btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");\n}\n\nexport async function createPkce() {\n  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));\n  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));\n  return { verifier, challenge: base64url(new Uint8Array(digest)) };\n}\n`),
      text("Libraries that do this for you", "Web: oauth4webapi, Auth.js (NextAuth), the provider's SDK.\nReact Native / Expo: expo-auth-session, react-native-app-auth.\nFlutter: flutter_appauth, oauth2.\nAndroid / iOS: AppAuth-Android, AppAuth-iOS, ASWebAuthenticationSession.\nStore tokens in the Keychain / Keystore (expo-secure-store, flutter_secure_storage), never in AsyncStorage or localStorage for long-lived refresh tokens.")
    );
    return { messages, outputs };
  }
};

const corsTool: ToolSpec = {
  id: "web.cors",
  command: "corsHelper",
  title: "CORS Builder & Debugger",
  summary: "Generate correct CORS config for Express, NestJS, Next.js, Fastify, nginx and FastAPI; check response headers the way the browser does; or paste a console error to learn the cause and fix.",
  guide: "CORS is enforced by browsers only. Native mobile apps, curl and server-to-server calls ignore it, which is why an API can work in Postman and fail in the browser. With credentials (cookies), the allowed origin must be exact - never *.",
  keywords: ["cors", "access-control-allow-origin", "preflight", "options", "blocked by cors policy", "credentials", "cross-origin"],
  icon: "shield",
  fields: [
    f.select("mode", "Tool", opts(["build", "Generate config"], ["check", "Check response headers"], ["explain", "Explain a console error"])),
    f.area("origins", "Allowed origins (one per line, * wildcard for subdomains)", { rows: 3, default: "http://localhost:3000\nhttps://app.example.com\nhttps://*.preview.example.com", showIf: { field: "mode", equals: ["build"] } }),
    f.text("methods", "Methods", { default: "GET, POST, PUT, PATCH, DELETE", showIf: { field: "mode", equals: ["build"] } }),
    f.text("headers", "Allowed request headers", { default: "Content-Type, Authorization, X-Request-Id", showIf: { field: "mode", equals: ["build"] } }),
    f.text("expose", "Exposed response headers", { default: "X-Total-Count", showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("credentials", "Allow credentials (cookies)", true, { showIf: { field: "mode", equals: ["build", "check"] } }),
    f.num("maxAge", "Preflight cache (s)", 600, { min: 0, max: 86400, showIf: { field: "mode", equals: ["build"] } }),
    f.text("origin", "Page origin", { default: "http://localhost:3000", showIf: { field: "mode", equals: ["check"] } }),
    f.select("method", "Request method", opts("GET", "POST", "PUT", "PATCH", "DELETE"), { showIf: { field: "mode", equals: ["check"] } }),
    f.text("requestHeaders", "Request headers (comma separated)", { default: "Content-Type: application/json, Authorization", showIf: { field: "mode", equals: ["check"] } }),
    f.num("preflightStatus", "Preflight status", 204, { min: 100, max: 599, showIf: { field: "mode", equals: ["check"] } }),
    f.code("response", "Response headers", "http", { rows: 7, default: "HTTP/1.1 204 No Content\nAccess-Control-Allow-Origin: *\nAccess-Control-Allow-Methods: GET, POST\nAccess-Control-Allow-Headers: Content-Type", showIf: { field: "mode", equals: ["check"] } }),
    f.area("error", "Console error", { rows: 4, default: "Access to fetch at 'https://api.example.com/v1/me' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: It does not have HTTP ok status.", showIf: { field: "mode", equals: ["explain"] } })
  ],
  run(values) {
    const mode = str(values, "mode", "build");
    if (mode === "explain") {
      const found = explainCorsError(required(values, "error", "Console error"));
      if (!found.length) return { messages: [{ kind: "info", text: "No known CORS pattern found. Open DevTools → Network, select the failing request (and its OPTIONS preflight) and check the status and Access-Control-* response headers - then use \"Check response headers\"." }] };
      return { messages: found.map(e => ({ kind: "warning" as const, text: e.title })), outputs: [table("Cause and fix", ["Problem", "Fix"], found.map(e => [e.title, e.fix]))] };
    }
    if (mode === "check") {
      const v = checkCors({ origin: required(values, "origin", "Page origin"), method: str(values, "method", "GET"), requestHeaders: str(values, "requestHeaders").split(",").map(s => s.trim()).filter(Boolean), credentials: bool(values, "credentials"), responseHeaders: str(values, "response"), preflightStatus: num(values, "preflightStatus", 204, { min: 100, max: 599, integer: true }) });
      return {
        stats: [{ label: "Result", value: v.passed ? "allowed" : "BLOCKED", tone: v.passed ? "good" : "bad" }, { label: "Preflight", value: v.preflightNeeded ? "yes" : "no" }],
        messages: v.steps.map(s => ({ kind: s.ok ? "success" as const : "error" as const, text: s.text })),
        outputs: []
      };
    }
    const origins = list(str(values, "origins"));
    if (!origins.length) throw new ToolInputError("Add at least one allowed origin.");
    const credentials = bool(values, "credentials", true);
    const messages: Messages = [];
    if (origins.includes("*") && credentials) messages.push({ kind: "error", text: "* cannot be combined with credentials. List the exact origins instead." });
    for (const o of origins) if (o !== "*" && !/^https?:\/\/[^/]+$/.test(o)) messages.push({ kind: "warning", text: `"${o}" is not an origin (scheme://host[:port], no path or trailing slash).` });
    if (origins.some(o => o.startsWith("http://") && !/localhost|127\.0\.0\.1/.test(o))) messages.push({ kind: "warning", text: "Production origins should be https." });
    const c = corsConfigs({ origins, methods: list(str(values, "methods")).map(m => m.toUpperCase()), headers: list(str(values, "headers")), exposeHeaders: list(str(values, "expose")), credentials, maxAge: num(values, "maxAge", 600, { min: 0, max: 86400, integer: true }) });
    messages.push({ kind: "info", text: "Return the CORS headers on error responses too (401, 404, 500) - otherwise the browser reports a CORS error instead of the real one." });
    return {
      messages,
      outputs: [code("Express (cors)", "typescript", c.express), code("NestJS", "typescript", c.nest), code("Next.js middleware", "typescript", c.next, "middleware.ts"), code("Fastify", "typescript", c.fastify), code("nginx", "nginx", c.nginx), code("FastAPI", "python", c.fastapi)]
    };
  }
};

const headersTool: ToolSpec = {
  id: "web.security-headers",
  command: "securityHeaders",
  title: "CSP & Security Headers",
  summary: "Build a Content-Security-Policy and the full set of security headers for nginx, Express (helmet), Next.js, Vercel, Netlify or a meta tag - or audit headers and a CSP you already send.",
  guide: "Start in Content-Security-Policy-Report-Only mode, watch the reports, then enforce. Nonces with 'strict-dynamic' are the most robust way to allow your own scripts while blocking injected ones.",
  keywords: ["csp", "content security policy", "security headers", "helmet", "hsts", "x-frame-options", "permissions-policy", "clickjacking", "xss"],
  icon: "shield",
  fields: [
    f.select("mode", "Tool", opts(["build", "Build headers"], ["audit", "Audit headers / CSP"])),
    f.text("scripts", "Extra script sources", { default: "https://www.googletagmanager.com", showIf: { field: "mode", equals: ["build"] } }),
    f.text("styles", "Extra style sources", { default: "https://fonts.googleapis.com", showIf: { field: "mode", equals: ["build"] } }),
    f.text("images", "Extra image sources", { default: "https://images.example-cdn.com", showIf: { field: "mode", equals: ["build"] } }),
    f.text("connect", "API / connect sources", { default: "https://api.example.com https://*.google-analytics.com", showIf: { field: "mode", equals: ["build"] } }),
    f.text("fonts", "Font sources", { default: "https://fonts.gstatic.com", showIf: { field: "mode", equals: ["build"] } }),
    f.text("frames", "Allowed iframes (frame-src)", { default: "https://www.youtube-nocookie.com", showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("nonce", "Use nonces + strict-dynamic", true, { showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("inlineStyles", "Allow inline styles", true, { showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("hsts", "HSTS (HTTPS only)", true, { showIf: { field: "mode", equals: ["build"] } }),
    f.select("frameAncestors", "Who may frame the site", opts(["none", "Nobody"], ["self", "Same origin"]), { showIf: { field: "mode", equals: ["build"] } }),
    f.text("reportUri", "Report URI (optional)", { placeholder: "https://example.com/csp-report", showIf: { field: "mode", equals: ["build"] } }),
    f.code("raw", "Response headers or a CSP", "http", { rows: 10, fromEditor: true, default: "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src *\nX-Powered-By: Express\nStrict-Transport-Security: max-age=3600", showIf: { field: "mode", equals: ["audit"] } })
  ],
  run(values) {
    if (str(values, "mode", "build") === "audit") {
      const raw = required(values, "raw", "Headers");
      const looksLikeCsp = !/^[\w-]+:\s/m.test(raw) || /^content-security-policy/i.test(raw.trim()) && !raw.trim().includes("\n");
      const audit = looksLikeCsp ? undefined : auditHeaders(raw);
      const policy = audit ? audit.csp : raw;
      const csp = policy ? analyzeCsp(policy) : undefined;
      return {
        stats: csp ? [{ label: "CSP issues", value: String(csp.issues.filter(i => i.severity !== "info").length), tone: csp.issues.some(i => i.severity === "error") ? "bad" : csp.issues.length ? "warn" : "good" }] : [],
        messages: csp ? severityMessages(csp.issues, "The CSP has no obvious weaknesses.") : [],
        outputs: [...(audit ? [table("Security headers", ["Header", "Status", "Finding"], audit.rows)] : []), ...(csp ? [table("CSP directives", ["Directive", "Sources"], csp.rows)] : [])]
      };
    }
    const sp = (k: string) => str(values, k).split(/[\s,]+/).filter(Boolean);
    const csp = buildCsp({ self: true, scripts: sp("scripts"), styles: sp("styles"), images: sp("images"), connect: sp("connect"), fonts: sp("fonts"), frames: sp("frames"), nonce: bool(values, "nonce", true), inlineStyles: bool(values, "inlineStyles", true), upgradeInsecure: true, reportUri: str(values, "reportUri").trim() || undefined, frameAncestors: str(values, "frameAncestors", "none") as "none" | "self" });
    const headers = securityHeaderSet(csp, bool(values, "hsts", true));
    const c = securityHeaderConfigs(headers);
    const messages: Messages = [{ kind: "info", text: "Roll out with Content-Security-Policy-Report-Only first, then switch to enforcing once reports are clean." }];
    if (bool(values, "nonce", true)) messages.push({ kind: "info", text: "{NONCE} must be a fresh random value per response, added to every <script nonce=\"…\">. Static hosts (nginx, Netlify, Vercel headers) cannot do that, so the nonce is removed from those configs." });
    if (bool(values, "hsts", true)) messages.push({ kind: "warning", text: "HSTS with preload is hard to undo: only enable it once every subdomain serves HTTPS." });
    return {
      outputs: [table("Headers", ["Header", "Value"], headers), code("Express (helmet)", "typescript", c.express), code("Next.js", "javascript", c.next, "next.config.js"), code("nginx", "nginx", c.nginx), code("vercel.json", "json", c.vercel), code("Netlify _headers", "text", c.netlify, "public/_headers"), code("Meta tag (CSP only)", "html", c.meta)],
      messages
    };
  }
};

const cookieTool: ToolSpec = {
  id: "web.cookies",
  command: "cookieInspector",
  title: "Cookie Inspector & Builder",
  summary: "Check Set-Cookie headers for problems browsers silently reject (SameSite=None without Secure, __Host- rules, size, dates), decode a Cookie header, or build a cookie for Express and Next.js.",
  keywords: ["cookie", "set-cookie", "samesite", "httponly", "secure", "session cookie", "__host", "partitioned", "chips"],
  icon: "eye",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["inspect", "Inspect Set-Cookie headers"], ["request", "Decode a Cookie request header"], ["build", "Build a cookie"])),
    f.area("setCookie", "Set-Cookie headers (one per line)", { rows: 5, required: true, fromEditor: true, default: "Set-Cookie: session=abc123; Path=/; SameSite=None\nSet-Cookie: __Host-csrf=xyz; Secure; Path=/; SameSite=Strict\nSet-Cookie: theme=dark; Max-Age=31536000; Path=/", showIf: { field: "mode", equals: ["inspect"] } }),
    f.area("cookieHeader", "Cookie header", { rows: 3, default: "Cookie: session=abc123; theme=dark; cart=%7B%22items%22%3A2%7D", showIf: { field: "mode", equals: ["request"] } }),
    f.text("name", "Name", { width: "narrow", default: "__Host-session", showIf: { field: "mode", equals: ["build"] } }),
    f.text("value", "Value", { width: "narrow", default: "s3cr3t-session-id", showIf: { field: "mode", equals: ["build"] } }),
    f.num("maxAge", "Max-Age (seconds, blank = session)", 604800, { min: 0, showIf: { field: "mode", equals: ["build"] } }),
    f.text("path", "Path", { width: "narrow", default: "/", showIf: { field: "mode", equals: ["build"] } }),
    f.text("domain", "Domain (optional)", { width: "narrow", showIf: { field: "mode", equals: ["build"] } }),
    f.select("sameSite", "SameSite", opts("Lax", "Strict", "None"), { showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("secure", "Secure", true, { showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("httpOnly", "HttpOnly", true, { showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("partitioned", "Partitioned (CHIPS)", false, { showIf: { field: "mode", equals: ["build"] } })
  ],
  run(values, ctx) {
    const mode = str(values, "mode", "inspect");
    if (mode === "request") {
      const pairs = parseCookieHeader(required(values, "cookieHeader", "Cookie header"));
      const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
      return { stats: [{ label: "Cookies", value: String(pairs.length) }, { label: "Size", value: fmtBytes(Buffer.byteLength(str(values, "cookieHeader"))) }], outputs: [table("Cookies", ["Name", "Value", "Decoded"], pairs.map(([k, v]) => [k, v, dec(v)])), code("JSON", "json", JSON.stringify(Object.fromEntries(pairs.map(([k, v]) => [k, dec(v)])), null, 2))] };
    }
    if (mode === "build") {
      const raw = values.maxAge;
      const maxAge = raw === undefined || String(raw).trim() === "" ? undefined : num(values, "maxAge", 0, { min: 0, integer: true, label: "Max-Age" });
      const name = required(values, "name", "Name");
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new ToolInputError("Cookie names cannot contain spaces, separators or control characters.");
      const o = { name, value: str(values, "value"), maxAgeSeconds: maxAge, path: str(values, "path", "/") || "/", domain: str(values, "domain").trim() || undefined, secure: bool(values, "secure", true), httpOnly: bool(values, "httpOnly", true), sameSite: str(values, "sameSite", "Lax") as "Lax" | "Strict" | "None", partitioned: bool(values, "partitioned") };
      const c = buildCookie(o);
      const check = parseSetCookie(c.header, ctx.now?.() ?? new Date());
      return { messages: severityMessages(check.issues.filter(i => i.severity !== "info"), "The cookie is valid and secure."), outputs: [code("Set-Cookie header", "http", c.header), code("Express", "javascript", c.express), code("Next.js", "typescript", c.next), code("Browser (document.cookie)", "javascript", c.browser)] };
    }
    const lines = required(values, "setCookie", "Set-Cookie headers").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const cookies = lines.map(l => parseSetCookie(l, ctx.now?.() ?? new Date()));
    const all = cookies.flatMap(c => c.issues.map(i => ({ ...i, message: `${c.name}: ${i.message}` })));
    return {
      stats: [{ label: "Cookies", value: String(cookies.length) }, { label: "Errors", value: String(all.filter(i => i.severity === "error").length), tone: all.some(i => i.severity === "error") ? "bad" : "good" }],
      messages: severityMessages(all, "All cookies look correct."),
      outputs: [table("Cookies", ["Name", "Value", "Secure", "HttpOnly", "SameSite", "Path", "Domain", "Expiry"], cookies.map(c => [c.name, c.value.length > 24 ? `${c.value.slice(0, 24)}…` : c.value, c.attributes.secure ? "yes" : "no", c.attributes.httponly ? "yes" : "no", String(c.attributes.samesite ?? "(Lax)"), String(c.attributes.path ?? "(request dir)"), String(c.attributes.domain ?? "(host only)"), String(c.attributes["max-age"] !== undefined ? `Max-Age ${c.attributes["max-age"]}` : c.attributes.expires ?? "session")]))]
    };
  }
};

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

const SAMPLE_HTML = `<div class="card" style="max-width: 320px; margin-top: 12px; -webkit-line-clamp: 2">
  <img src="/avatar.png" alt="Avatar" width="64" height="64">
  <label for="email">Email</label>
  <input id="email" type="email" class="input" value="ada@example.com" autofocus tabindex="1">
  <!-- Submit -->
  <button class="btn primary" onclick="save()" disabled>Save {draft}</button>
  <svg viewBox="0 0 24 24" stroke-width="2" fill-rule="evenodd"><path stroke-linecap="round" d="M5 12h14"/></svg>
</div>`;

const htmlJsxTool: ToolSpec = {
  id: "web.html-jsx",
  command: "htmlToJsx",
  title: "HTML → JSX Converter",
  summary: "Paste HTML or SVG and get valid JSX/TSX: className, htmlFor, style objects, camelCase SVG attributes, self-closing tags, comments and escaped braces - optionally wrapped in a component.",
  keywords: ["html to jsx", "html to react", "svg to jsx", "svg to react", "classname", "convert html", "tsx"],
  icon: "code",
  live: true,
  fields: [
    f.code("html", "HTML / SVG", "html", { rows: 12, required: true, fromEditor: true, default: SAMPLE_HTML }),
    f.select("wrap", "Output", opts(["component", "React component"], ["none", "JSX only"])),
    f.text("name", "Component name", { width: "narrow", default: "ProfileCard", showIf: { field: "wrap", equals: ["component"] } }),
    f.toggle("typescript", "TypeScript", true, { showIf: { field: "wrap", equals: ["component"] } })
  ],
  run(values) {
    const wrap = str(values, "wrap", "component") as "component" | "none";
    const ts = bool(values, "typescript", true);
    const r = htmlToJsx(required(values, "html", "HTML"), { wrap, name: str(values, "name", "Component"), typescript: ts });
    const name = (str(values, "name", "Component").replace(/[^A-Za-z0-9_]/g, "") || "Component");
    return { messages: r.warnings.map(t => ({ kind: "info" as const, text: t })), outputs: [code(wrap === "component" ? `${name}.${ts ? "tsx" : "jsx"}` : "JSX", ts || wrap === "none" ? "tsx" : "jsx", r.code, wrap === "component" ? `src/components/${name}.${ts ? "tsx" : "jsx"}` : undefined)] };
  }
};

const reactTool: ToolSpec = {
  id: "web.react",
  command: "reactGenerator",
  title: "React / Next.js Generator",
  summary: "Scaffold the pieces you write every week: a component with test and story, a Next.js App Router page with loading/error, a route handler, a server action with form, a data hook, a context provider, a Zustand store or a React Native screen.",
  guide: "Output follows current conventions: React 19 (useActionState), Next.js 15 (async params, Server Components by default), Vitest + Testing Library, Storybook CSF3.",
  keywords: ["react component", "next.js page", "app router", "route handler", "server action", "custom hook", "context", "zustand", "react native screen", "storybook", "vitest"],
  icon: "layers",
  fields: [
    f.select("kind", "Generate", opts(["component", "Component"], ["next-page", "Next.js page (+ loading, error)"], ["next-route", "Next.js route handler"], ["server-action", "Server action + form"], ["hook", "Data-fetching hook"], ["context", "Context provider"], ["store", "Zustand store"], ["rn-screen", "React Native screen"])),
    f.text("name", "Name", { width: "narrow", default: "UserCard" }),
    f.text("route", "Route", { width: "narrow", default: "users/[id]", showIf: { field: "kind", equals: ["next-page", "next-route", "server-action"] } }),
    f.toggle("typescript", "TypeScript", true),
    f.select("styling", "Styling", opts(["css-module", "CSS module"], ["tailwind", "Tailwind"], ["none", "None"]), { showIf: { field: "kind", equals: ["component"] } }),
    f.toggle("tests", "Tests", true, { showIf: { field: "kind", equals: ["component", "hook"] } }),
    f.toggle("story", "Storybook story", false, { showIf: { field: "kind", equals: ["component"] } })
  ],
  run(values) {
    const name = required(values, "name", "Name");
    if (!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(name)) throw new ToolInputError("Use a name like UserCard or user-card.");
    const files = reactScaffold({ kind: str(values, "kind", "component") as ReactKind, name, typescript: bool(values, "typescript", true), styling: str(values, "styling", "css-module") as "css-module" | "tailwind" | "none", tests: bool(values, "tests", true), story: bool(values, "story"), route: str(values, "route", "") });
    return { outputs: [{ kind: "files", title: "Files", files }] };
  }
};

const metaTool: ToolSpec = {
  id: "web.meta",
  command: "metaTagsGenerator",
  title: "SEO & Social Meta Tags",
  summary: "Title, description, canonical, Open Graph, X/Twitter cards, JSON-LD, robots.txt and web manifest - as HTML or a Next.js Metadata object - with length and image checks.",
  keywords: ["meta tags", "seo", "open graph", "og image", "twitter card", "json-ld", "structured data", "robots.txt", "manifest", "next metadata"],
  icon: "search",
  live: true,
  fields: [
    f.text("title", "Title", { required: true, default: "Acme Notes - Fast, private notes for teams" }),
    f.area("description", "Description", { rows: 3, required: true, default: "Write, share and search notes with your team. End-to-end encrypted, works offline, and syncs across web, iOS and Android." }),
    f.text("url", "Canonical URL", { default: "https://acme-notes.example.com/" }),
    f.text("image", "Social image URL (1200×630)", { default: "https://acme-notes.example.com/og.png" }),
    f.text("siteName", "Site name", { width: "narrow", default: "Acme Notes" }),
    f.text("twitter", "X / Twitter handle", { width: "narrow", default: "@acmenotes" }),
    f.select("type", "Page type", opts(["website", "Website / home"], ["article", "Article / blog post"], ["product", "Product"])),
    f.text("author", "Author", { width: "narrow", showIf: { field: "type", equals: ["article"] } }),
    f.text("locale", "Locale", { width: "narrow", default: "en_US" }),
    f.text("themeColor", "Theme colour", { width: "narrow", default: "#4F46E5" }),
    f.toggle("index", "Allow search indexing", true)
  ],
  run(values) {
    const r = metaTags({ title: required(values, "title", "Title"), description: required(values, "description", "Description"), url: str(values, "url").trim(), image: str(values, "image").trim(), siteName: str(values, "siteName", ""), twitter: str(values, "twitter").trim(), locale: str(values, "locale", "en_US"), themeColor: str(values, "themeColor", "#ffffff"), type: str(values, "type", "website") as "website" | "article" | "product", index: bool(values, "index", true), author: str(values, "author").trim() || undefined });
    return {
      stats: [{ label: "Title", value: `${str(values, "title").length} chars`, tone: str(values, "title").length > 60 ? "warn" : "good" }, { label: "Description", value: `${str(values, "description").length} chars`, tone: str(values, "description").length > 160 || str(values, "description").length < 70 ? "warn" : "good" }],
      messages: r.warnings.map((t, i, a) => ({ kind: i === a.length - 1 ? "info" as const : "warning" as const, text: t })),
      outputs: [code("HTML <head>", "html", r.html), code("Next.js (app/layout.tsx or page.tsx)", "typescript", r.next), code("JSON-LD", "html", r.jsonLd), code("robots.txt", "text", r.robots, "public/robots.txt"), code("site.webmanifest", "json", r.manifest, "public/site.webmanifest")]
    };
  }
};

const cssUnitsTool: ToolSpec = {
  id: "web.css-units",
  command: "cssUnits",
  title: "CSS Units & Fluid Type",
  summary: "Convert px, rem, em, pt and vw; generate fluid clamp() values between two viewport widths; or build a modular type scale as CSS variables and Tailwind config.",
  keywords: ["px to rem", "rem to px", "clamp", "fluid typography", "type scale", "css units", "responsive font size", "tailwind font size"],
  icon: "type",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["convert", "Convert units"], ["clamp", "Fluid clamp()"], ["scale", "Type scale"])),
    f.text("values", "Values", { default: "12px, 14px, 16px, 1.25rem, 24, 2em, 18pt", showIf: { field: "mode", equals: ["convert"] } }),
    f.num("root", "Root font size (px)", 16, { min: 1, max: 100 }),
    f.num("parent", "Parent font size (px)", 16, { min: 1, max: 200, showIf: { field: "mode", equals: ["convert"] } }),
    f.num("viewport", "Viewport width (px)", 1440, { min: 100, max: 8000, showIf: { field: "mode", equals: ["convert"] } }),
    f.num("minSize", "Size at min viewport (px)", 18, { min: 0, showIf: { field: "mode", equals: ["clamp"] } }),
    f.num("maxSize", "Size at max viewport (px)", 32, { min: 0, showIf: { field: "mode", equals: ["clamp"] } }),
    f.num("minVw", "Min viewport (px)", 375, { min: 100, showIf: { field: "mode", equals: ["clamp", "scale"] } }),
    f.num("maxVw", "Max viewport (px)", 1280, { min: 200, showIf: { field: "mode", equals: ["clamp", "scale"] } }),
    f.num("base", "Base size (px)", 16, { min: 8, max: 40, showIf: { field: "mode", equals: ["scale"] } }),
    f.select("ratio", "Scale ratio (desktop)", TYPE_RATIOS.map(([v, , label]) => ({ value: v, label: `${v} - ${label}` })), { default: "1.25", showIf: { field: "mode", equals: ["scale"] } }),
    f.select("minRatio", "Scale ratio (mobile)", [{ value: "none", label: "Same (not fluid)" }, ...TYPE_RATIOS.map(([v, , label]) => ({ value: v, label: `${v} - ${label}` }))], { default: "1.2", showIf: { field: "mode", equals: ["scale"] } })
  ],
  run(values) {
    const mode = str(values, "mode", "convert");
    const root = num(values, "root", 16, { min: 1, max: 100, label: "Root font size" });
    if (mode === "clamp") {
      const r = fluidClamp(num(values, "minSize", 18, { min: 0 }), num(values, "maxSize", 32, { min: 0 }), num(values, "minVw", 375, { min: 100 }), num(values, "maxVw", 1280, { min: 200 }), root);
      return { messages: [{ kind: "info", text: "Using rem in the preferred value keeps the size responsive to the user's browser font setting (WCAG 1.4.4)." }], outputs: [code("CSS", "css", `font-size: ${r.css};`), code("Tailwind (arbitrary value)", "text", `text-[${r.css.replace(/ /g, "_")}]`)] };
    }
    if (mode === "scale") {
      const minRatio = str(values, "minRatio", "1.2");
      const r = typeScale(num(values, "base", 16, { min: 8, max: 40 }), Number(str(values, "ratio", "1.25")), root, minRatio === "none" ? undefined : { minVw: num(values, "minVw", 375, { min: 100 }), maxVw: num(values, "maxVw", 1280, { min: 200 }), minRatio: Number(minRatio) });
      return { outputs: [table("Scale", ["Step", "Size", "Value"], r.rows), code("CSS variables", "css", r.css), code("Tailwind", "javascript", r.tailwind, "tailwind.config.js")] };
    }
    const rows = convertUnits(str(values, "values"), root, num(values, "parent", 16, { min: 1, max: 200 }), num(values, "viewport", 1440, { min: 100, max: 8000 }));
    return { outputs: [table("Conversions", ["Input", "px", "rem", "em", "pt", "vw"], rows)] };
  }
};

const cacheTool: ToolSpec = {
  id: "web.cache",
  command: "cacheControl",
  title: "Cache-Control Builder",
  summary: "Explain any Cache-Control header in plain English, or pick a caching strategy per asset type (hashed bundles, HTML, APIs, images, fonts, service worker) and get nginx, Express, Next.js, Vercel and Netlify config.",
  guide: "The safe default for most sites: cache hashed assets forever (immutable), always revalidate HTML (no-cache), and keep per-user API responses private. no-cache does not mean \"do not cache\" - no-store does.",
  keywords: ["cache-control", "caching", "http cache", "max-age", "immutable", "stale-while-revalidate", "cdn", "performance", "no-cache", "no-store"],
  icon: "gauge",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["build", "Build a caching strategy"], ["explain", "Explain a header"])),
    f.text("header", "Cache-Control", { default: "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400", showIf: { field: "mode", equals: ["explain"] } }),
    ...(Object.entries(CACHE_PRESETS) as Array<[AssetKind, typeof CACHE_PRESETS[AssetKind]]>).map(([k, p]) => f.toggle(`kind_${k}`, p.label, ["hashed", "html", "api-private", "images", "fonts"].includes(k), { showIf: { field: "mode", equals: ["build"] } }))
  ],
  run(values) {
    if (str(values, "mode", "build") === "explain") {
      const r = explainCacheControl(required(values, "header", "Cache-Control"));
      return { messages: r.warnings.length ? r.warnings.map(t => ({ kind: "warning" as const, text: t })) : [{ kind: "success", text: "No conflicting directives." }], outputs: [table("Directives", ["Directive", "Value", "Meaning"], r.rows)] };
    }
    const kinds = (Object.keys(CACHE_PRESETS) as AssetKind[]).filter(k => bool(values, `kind_${k}`));
    if (!kinds.length) throw new ToolInputError("Turn on at least one asset type.");
    const c = cacheConfigs(kinds);
    return { outputs: [table("Strategy", ["Asset", "Cache-Control", "Why"], kinds.map(k => [CACHE_PRESETS[k].label, CACHE_PRESETS[k].value, CACHE_PRESETS[k].why])), code("nginx", "nginx", c.nginx), code("Express", "javascript", c.express), code("Next.js", "javascript", c.next, "next.config.js"), code("vercel.json", "json", c.vercel), code("Netlify _headers", "text", c.netlify, "public/_headers")] };
  }
};

// ---------------------------------------------------------------------------
// Backend & data
// ---------------------------------------------------------------------------

const scaffoldTool: ToolSpec = {
  id: "web.api-scaffold",
  command: "apiScaffolder",
  title: "API Resource Scaffolder",
  summary: "Describe a resource and its fields; get a validated CRUD API (list with pagination, get, create, update, delete) for Express, NestJS, Next.js route handlers or Fastify on Prisma, Mongoose or an in-memory store.",
  guide: "Field syntax: name: type, one per line. Types: string, text, int, number, boolean, date, email, url, uuid, enum(a|b|c), string[], number[], json. Add ! for required and unique for a unique index. id, createdAt and updatedAt are added for you.",
  keywords: ["crud", "rest api", "express", "nestjs", "next.js api", "fastify", "prisma", "mongoose", "zod", "class-validator", "scaffold", "boilerplate"],
  icon: "server",
  fields: [
    f.text("resource", "Resource (singular)", { width: "narrow", default: "product", required: true }),
    f.select("framework", "Framework", opts(["express", "Express + Zod"], ["nestjs", "NestJS + class-validator"], ["next", "Next.js route handlers + Zod"], ["fastify", "Fastify + JSON Schema"])),
    f.select("db", "Database", opts(["prisma", "Prisma (Postgres / MySQL / SQLite)"], ["mongoose", "MongoDB (Mongoose)"], ["memory", "In-memory (prototype)"])),
    f.area("fields", "Fields", { rows: 8, required: true, default: "name: string!\nslug: string! unique\ndescription: text\nprice: number!\nstock: int!\nstatus: enum(draft|active|archived)!\ntags: string[]\nimageUrl: url" })
  ],
  run(values) {
    const fields = parseFields(required(values, "fields", "Fields"));
    const r = scaffoldResource(required(values, "resource", "Resource"), fields, str(values, "framework", "express") as ApiFramework, str(values, "db", "prisma") as ApiDatabase);
    return { stats: [{ label: "Fields", value: String(fields.length) }, { label: "Files", value: String(r.files.length) }], messages: r.steps.map(t => ({ kind: "info" as const, text: t })), outputs: [{ kind: "files", title: "Files", files: r.files }] };
  }
};

const dbTool: ToolSpec = {
  id: "web.db-url",
  command: "connectionString",
  title: "Database Connection Strings",
  summary: "Build or parse PostgreSQL, MySQL, MongoDB, Redis and SQL Server connection strings - with correct password encoding and TLS - and get the .env line, Prisma datasource, driver setup and CLI command.",
  guide: "The #1 connection-string bug is an unencoded special character in the password (@ : / # ? %). Parse mode accepts a URL as pasted (even with a broken password) and gives back the correctly encoded one. Passwords never leave the editor.",
  keywords: ["connection string", "database url", "postgres url", "mongodb uri", "redis url", "prisma datasource", "sslmode", "mysql", "DATABASE_URL"],
  icon: "database",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["build", "Build"], ["parse", "Parse / fix"])),
    f.area("url", "Connection string", { rows: 3, fromEditor: true, default: "postgresql://app_user:p@ss#w0rd!@db.example.com:5432/orders?sslmode=require", showIf: { field: "mode", equals: ["parse"] } }),
    f.select("kind", "Database", opts(["postgres", "PostgreSQL"], ["mysql", "MySQL / MariaDB"], ["mongodb", "MongoDB"], ["mongodb+srv", "MongoDB Atlas (SRV)"], ["redis", "Redis"], ["sqlserver", "SQL Server"]), { showIf: { field: "mode", equals: ["build"] } }),
    f.text("host", "Host", { width: "narrow", default: "localhost", showIf: { field: "mode", equals: ["build"] } }),
    f.num("port", "Port (blank = default)", 5432, { min: 1, max: 65535, showIf: { field: "mode", equals: ["build"] } }),
    f.text("user", "User", { width: "narrow", default: "app", showIf: { field: "mode", equals: ["build"] } }),
    f.secret("password", "Password", { showIf: { field: "mode", equals: ["build"] } }),
    f.text("database", "Database", { width: "narrow", default: "app_dev", showIf: { field: "mode", equals: ["build"] } }),
    f.toggle("ssl", "TLS / SSL", false, { showIf: { field: "mode", equals: ["build"] } }),
    f.text("envName", "Env variable", { width: "narrow", default: "DATABASE_URL" })
  ],
  run(values) {
    const mode = str(values, "mode", "build");
    let parts;
    let raw: string | undefined;
    if (mode === "parse") {
      raw = required(values, "url", "Connection string");
      parts = parseConnectionUrl(raw);
    } else {
      const kind = str(values, "kind", "postgres") as DbKind;
      const defaults: Record<DbKind, number | undefined> = { postgres: 5432, mysql: 3306, mongodb: 27017, "mongodb+srv": undefined, redis: 6379, sqlserver: 1433 };
      const portRaw = values.port;
      const port = kind === "mongodb+srv" ? undefined : portRaw === undefined || String(portRaw).trim() === "" ? defaults[kind] : num(values, "port", 5432, { min: 1, max: 65535, integer: true, label: "Port" });
      parts = { kind, host: required(values, "host", "Host"), port: kind !== "mongodb+srv" && port === 5432 && kind !== "postgres" ? defaults[kind] : port, user: str(values, "user"), password: str(values, "password"), database: str(values, "database"), ssl: bool(values, "ssl"), options: [] as Array<[string, string]> };
    }
    const url = buildConnectionUrl(parts);
    const masked = buildConnectionUrl({ ...parts, password: parts.password ? "********" : "" });
    const env = str(values, "envName", "DATABASE_URL").trim() || "DATABASE_URL";
    const snippets = connectionSnippets(parts, env);
    const warnings = connectionWarnings(raw, parts);
    if (!parts.password && parts.kind !== "redis") warnings.push("No password set - fine for a local container, never for a shared or remote database.");
    return {
      stats: [{ label: "Database", value: parts.kind }, { label: "TLS", value: parts.ssl ? "on" : "off", tone: parts.ssl ? "good" : "warn" }],
      messages: warnings.map(t => ({ kind: "warning" as const, text: t })),
      outputs: [
        code(".env", "dotenv", `${env}="${url}"`),
        table("Parts", ["Part", "Value"], [["Scheme", parts.kind], ["Host", parts.host], ["Port", String(parts.port ?? "(SRV / default)")], ["User", parts.user], ["Password", parts.password ? `${"•".repeat(Math.min(parts.password.length, 10))} (${parts.password.length} chars)` : "(none)"], ["Database", parts.database || "(default)"], ["TLS", parts.ssl ? "yes" : "no"], ...parts.options.map(([k, v]) => [`Option ${k}`, v] as [string, string]), ["Masked URL (safe for logs)", masked]]),
        ...Object.entries(snippets).map(([title, content]) => code(title, title === "CLI" ? "shell" : title === "Prisma" ? "prisma" : "typescript", content))
      ]
    };
  }
};

const sqlMongoTool: ToolSpec = {
  id: "web.sql-mongo",
  command: "sqlToMongo",
  title: "SQL → MongoDB Query",
  summary: "Translate a SQL SELECT (WHERE, IN, LIKE, BETWEEN, IS NULL, ORDER BY, LIMIT/OFFSET, GROUP BY with COUNT/SUM/AVG/MIN/MAX, HAVING) into a MongoDB find() or aggregation pipeline for mongosh, the Node driver and Mongoose.",
  keywords: ["sql to mongodb", "mongodb query", "aggregate", "aggregation pipeline", "mongoose find", "$match", "$group", "nosql"],
  icon: "database",
  live: true,
  fields: [f.code("sql", "SQL", "sql", { rows: 7, required: true, fromEditor: true, default: "SELECT country, COUNT(*) AS customers, AVG(total_spent) AS avg_spent\nFROM customers\nWHERE status IN ('active', 'trial') AND created_at >= '2026-01-01'\nGROUP BY country\nHAVING COUNT(*) > 10\nORDER BY customers DESC\nLIMIT 20" })],
  examples: [
    { label: "Filter, sort and paginate", values: { sql: "SELECT name, email FROM users WHERE age >= 18 AND name LIKE 'A%' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20 OFFSET 40" } },
    { label: "OR with BETWEEN", values: { sql: "SELECT * FROM orders WHERE (status = 'paid' OR status = 'shipped') AND total BETWEEN 10 AND 100" } },
    { label: "Group and count", values: { sql: "SELECT category, COUNT(*) AS n, MAX(price) FROM products GROUP BY category ORDER BY n DESC" } }
  ],
  run(values) {
    const r = sqlToMongo(required(values, "sql", "SQL"));
    return {
      stats: [{ label: "Collection", value: r.collection }, { label: "Kind", value: r.aggregate ? "aggregation" : "find()" }],
      messages: [{ kind: "info", text: "Strings in SQL stay strings: if a field holds dates or ObjectIds, wrap the value (new Date(\"2026-01-01\"), new ObjectId(\"…\")). Index the fields you filter and sort on." }],
      outputs: [code("mongosh", "javascript", r.shell), code("Node.js driver", "javascript", r.node), code("Mongoose", "javascript", r.mongoose)]
    };
  }
};

// ---------------------------------------------------------------------------
// Git & releases
// ---------------------------------------------------------------------------

const gitTool: ToolSpec = {
  id: "web.git",
  command: "gitRecipes",
  title: "Git Command Recipes",
  summary: "The exact Git commands for everyday situations - undo a commit, rename a branch, sync with main, squash, cherry-pick, recover lost work, remove a leaked secret - plus a Conventional Commit message builder.",
  keywords: ["git", "undo commit", "git reset", "git revert", "rename branch", "squash", "cherry-pick", "rebase", "reflog", "conventional commits", "commit message", "git stash"],
  icon: "merge",
  fields: [
    f.select("mode", "Tool", opts(["recipe", "Git recipe"], ["commit", "Commit message"])),
    f.select("recipe", "I want to…", GIT_RECIPES.map(r => ({ value: r.id, label: `${r.group}: ${r.title}` })), { width: "wide", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("branch", "Branch", { width: "narrow", default: "feature/login", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("newBranch", "New branch", { width: "narrow", default: "feature/sign-in", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("base", "Base branch", { width: "narrow", default: "main", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("sha", "Commit / ref", { width: "narrow", default: "a1b2c3d", showIf: { field: "mode", equals: ["recipe"] } }),
    f.num("count", "N (commits / PR #)", 3, { min: 1, max: 100000, showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("file", "File / pattern", { width: "narrow", default: ".env", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("message", "Message / text", { width: "narrow", default: "fix: handle empty cart", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("remote", "Upstream URL", { width: "narrow", default: "https://github.com/original/repo.git", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("tag", "Tag", { width: "narrow", default: "v1.4.0", showIf: { field: "mode", equals: ["recipe"] } }),
    f.text("author", "Author", { width: "narrow", default: "Ada Lovelace <ada@example.com>", showIf: { field: "mode", equals: ["recipe"] } }),
    f.select("type", "Type", COMMIT_TYPES.map(([v, l]) => ({ value: v, label: `${v} - ${l}` })), { showIf: { field: "mode", equals: ["commit"] } }),
    f.text("scope", "Scope (optional)", { width: "narrow", default: "auth", showIf: { field: "mode", equals: ["commit"] } }),
    f.text("subject", "Subject", { default: "add password reset via email", showIf: { field: "mode", equals: ["commit"] } }),
    f.area("body", "Body (why, not how)", { rows: 3, default: "Users locked out of their accounts had to contact support. The reset link expires after 30 minutes and can be used once.", showIf: { field: "mode", equals: ["commit"] } }),
    f.text("breaking", "Breaking change (optional)", { showIf: { field: "mode", equals: ["commit"] } }),
    f.text("issues", "Issues (e.g. 123, PROJ-45)", { width: "narrow", default: "142", showIf: { field: "mode", equals: ["commit"] } })
  ],
  run(values) {
    if (str(values, "mode", "recipe") === "commit") {
      const r = commitMessage({ type: str(values, "type", "feat"), scope: str(values, "scope"), subject: str(values, "subject"), body: str(values, "body"), breaking: str(values, "breaking"), issues: str(values, "issues") });
      return { messages: r.issues.length ? r.issues.map(t => ({ kind: "warning" as const, text: t })) : [{ kind: "success", text: "Follows Conventional Commits." }], outputs: [code("Commit message", "text", r.message), code("Command", "shell", r.command), code("Branch name", "text", r.branch)] };
    }
    const recipe = GIT_RECIPES.find(r => r.id === str(values, "recipe", GIT_RECIPES[0].id)) ?? GIT_RECIPES[0];
    const p: GitParams = { branch: str(values, "branch", "feature/login").trim(), newBranch: str(values, "newBranch", "feature/sign-in").trim(), base: str(values, "base", "main").trim() || "main", sha: str(values, "sha", "a1b2c3d").trim(), count: num(values, "count", 3, { min: 1, integer: true }), file: str(values, "file", ".env").trim(), message: str(values, "message", "update").trim(), remote: str(values, "remote").trim(), tag: str(values, "tag", "v1.0.0").trim(), author: str(values, "author").trim() };
    const messages: Messages = [{ kind: "info", text: recipe.explain }];
    if (recipe.danger) messages.unshift({ kind: "warning", text: recipe.danger });
    return { messages, outputs: [code(recipe.title, "shell", recipe.commands(p) + "\n"), table("Related", ["Situation", "Recipe"], GIT_RECIPES.filter(r => r.group === recipe.group && r.id !== recipe.id).map(r => [r.title, r.group]))] };
  }
};

const gitignoreTool: ToolSpec = {
  id: "web.gitignore",
  command: "gitignoreGenerator",
  title: ".gitignore Generator",
  summary: "Combine .gitignore templates for Node, Next.js, Vite, React Native/Expo, Flutter, Android, iOS, Python, Java, Go, Docker, Terraform, IDEs and OSes - detected from your workspace - or check an existing .gitignore for missing secrets.",
  keywords: [".gitignore", "gitignore", "ignore node_modules", "flutter gitignore", "android gitignore", "xcode gitignore", "expo gitignore"],
  icon: "filter",
  actions: [{ id: "detect", label: "Detect from workspace" }],
  fields: [
    f.select("mode", "Tool", opts(["generate", "Generate"], ["check", "Check an existing .gitignore"])),
    f.text("stacks", "Templates", { width: "wide", default: "node, next, env, macos, windows, vscode, jetbrains, logs", help: `Available: ${Object.keys(GITIGNORE).join(", ")}` }),
    f.code("existing", "Existing .gitignore", "ignore", { rows: 8, fromEditor: true, default: "node_modules\ndist\n", showIf: { field: "mode", equals: ["check"] } })
  ],
  async run(values, ctx, action) {
    if (action === "detect") {
      if (!ctx.workspace) throw new ToolInputError("Open a folder first.");
      const found = new Set<string>();
      for (const [file, key] of GITIGNORE_MARKERS) if (await ctx.workspace.exists(file)) found.add(key);
      if (found.has("expo") && !(await ctx.workspace.readFile("app.json"))?.includes("expo")) found.delete("expo");
      if (found.has("flutter")) { found.delete("java"); found.add("android"); found.add("ios"); }
      const detected = [...found, "env", "macos", "windows", "vscode", "jetbrains", "logs"];
      const existing = await ctx.workspace.readFile(".gitignore");
      return { setValues: { stacks: detected.join(", "), ...(existing !== undefined ? { existing } : {}) }, messages: [{ kind: "success", text: `Detected: ${[...found].join(", ") || "nothing specific"}. Common extras were added.` }], outputs: [code(".gitignore", "ignore", buildGitignore(detected), ".gitignore")] };
    }
    const keys = list(str(values, "stacks")).map(k => k.toLowerCase());
    const unknown = keys.filter(k => !GITIGNORE[k]);
    const known = keys.filter(k => GITIGNORE[k]);
    if (!known.length) throw new ToolInputError(`Choose templates from: ${Object.keys(GITIGNORE).join(", ")}.`);
    const messages: Messages = unknown.length ? [{ kind: "warning", text: `Unknown templates ignored: ${unknown.join(", ")}.` }] : [];
    if (str(values, "mode", "generate") === "check") {
      const missing = missingIgnores(str(values, "existing"), known);
      messages.push(...(missing.length ? missing.map(m => ({ kind: "warning" as const, text: `Missing: ${m}` })) : [{ kind: "success" as const, text: "The important patterns for these stacks are covered." }]));
      if (missing.length) messages.push({ kind: "info", text: "Already-committed files stay tracked after you add them here: git rm --cached <file> (and rotate any secret that was committed)." });
      return { messages, outputs: missing.length ? [code("Add these lines", "ignore", `${missing.join("\n")}\n`)] : [] };
    }
    return { messages, outputs: [code(".gitignore", "ignore", buildGitignore(known), ".gitignore")] };
  }
};

const semverTool: ToolSpec = {
  id: "web.semver",
  command: "semverCalculator",
  title: "Semver & App Version Calculator",
  summary: "See which versions an npm / pub range (^, ~, x, ||, hyphen) allows, sort versions, bump a version (incl. prereleases), and derive Android versionCode, iOS build numbers and Flutter/Expo version strings.",
  guide: "Caret (^) allows changes that do not modify the left-most non-zero digit: ^1.2.3 → <2.0.0, but ^0.2.3 → <0.3.0. Prereleases only match ranges that mention a prerelease of the same version. Dart/Flutter pub uses the same caret rules.",
  keywords: ["semver", "semantic versioning", "caret", "tilde", "version range", "npm version", "bump version", "versionCode", "build number", "CFBundleVersion", "pubspec version"],
  icon: "hash",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["range", "Check a range"], ["sort", "Sort / compare versions"], ["bump", "Bump a version"], ["mobile", "App version & build numbers"])),
    f.text("range", "Range", { default: "^1.4.2 || ~2.0.0", showIf: { field: "mode", equals: ["range"] } }),
    f.area("versions", "Versions", { rows: 4, default: "1.4.1, 1.4.2, 1.9.0, 2.0.0-beta.1, 2.0.3, 2.1.0, 3.0.0", showIf: { field: "mode", equals: ["range", "sort"] } }),
    f.text("version", "Version", { width: "narrow", default: "1.4.2", showIf: { field: "mode", equals: ["bump", "mobile"] } }),
    f.select("bump", "Bump", opts("patch", "minor", "major", "prerelease", "prepatch", "preminor", "premajor", "release"), { showIf: { field: "mode", equals: ["bump"] } }),
    f.text("preid", "Prerelease id", { width: "narrow", default: "rc", showIf: { field: "mode", equals: ["bump"] } }),
    f.num("build", "Build number", 57, { min: 1, max: MAX_VERSION_CODE, showIf: { field: "mode", equals: ["mobile"] } })
  ],
  run(values) {
    const mode = str(values, "mode", "range");
    const versions = () => list(str(values, "versions")).map(parseVersion);
    if (mode === "sort") {
      const sorted = versions().sort(compareVersions);
      return { outputs: [table("Sorted (oldest first)", ["#", "Version", "Prerelease"], sorted.map((v, i) => [i + 1, formatVersion(v), v.pre.length ? "yes" : ""])), code("Highest", "text", formatVersion(sorted[sorted.length - 1]))] };
    }
    if (mode === "bump") {
      const v = parseVersion(required(values, "version", "Version"));
      const kinds: BumpKind[] = ["patch", "minor", "major", "prerelease", "prepatch", "preminor", "premajor", "release"];
      const chosen = str(values, "bump", "patch") as BumpKind;
      const next = formatVersion(bump(v, chosen, str(values, "preid", "rc")));
      return {
        stats: [{ label: "Next", value: next, tone: "good" }],
        outputs: [table("All bumps", ["Bump", "Result"], kinds.map(k => [k, formatVersion(bump(v, k, str(values, "preid", "rc")))])), code("Apply it", "shell", `npm version ${chosen === "release" ? next : chosen}${chosen.startsWith("pre") ? ` --preid=${str(values, "preid", "rc")}` : ""}   # updates package.json, commits and tags v${next}\n# yarn version --new-version ${next}  ·  pnpm version ${chosen}\ngit push --follow-tags`)]
      };
    }
    if (mode === "mobile") {
      const v = parseVersion(required(values, "version", "Version"));
      const build = num(values, "build", 1, { min: 1, max: MAX_VERSION_CODE, integer: true, label: "Build number" });
      const name = formatVersion({ ...v, pre: [] });
      const derived = derivedVersionCode(v, build % 1000);
      const messages: Messages = [{ kind: "info", text: "Android versionCode and the iOS build number must increase with every upload; the version name / CFBundleShortVersionString is what users see." }];
      if (v.pre.length) messages.push({ kind: "warning", text: "Stores do not accept prerelease suffixes in the user-facing version; use the build number to distinguish test builds." });
      if (derived > MAX_VERSION_CODE) messages.push({ kind: "error", text: "The derived versionCode exceeds Google Play's maximum (2100000000)." });
      return {
        messages,
        outputs: [
          table("Values", ["Where", "Field", "Value"], [["Android", "versionName", name], ["Android", "versionCode (sequential)", String(build)], ["Android", "versionCode (derived: MMmmmpppbbb)", String(derived)], ["iOS", "CFBundleShortVersionString (MARKETING_VERSION)", name], ["iOS", "CFBundleVersion (CURRENT_PROJECT_VERSION)", String(build)], ["Flutter", "pubspec.yaml version", `${name}+${build}`], ["Expo", "version / ios.buildNumber / android.versionCode", `${name} / "${build}" / ${build}`], ["npm", "package.json version", formatVersion(v)]]),
          code("pubspec.yaml", "yaml", `version: ${name}+${build}\n`),
          code("app.json (Expo)", "json", JSON.stringify({ expo: { version: name, ios: { buildNumber: String(build) }, android: { versionCode: build } } }, null, 2)),
          code("android/app/build.gradle.kts", "kotlin", `defaultConfig {\n    versionCode = ${build}\n    versionName = "${name}"\n}`),
          code("Commands", "shell", `# iOS (agvtool, in the folder with the .xcodeproj)\nxcrun agvtool new-marketing-version ${name}\nxcrun agvtool new-version -all ${build}\n\n# Flutter (overrides pubspec at build time)\nflutter build appbundle --build-name=${name} --build-number=${build}\n\n# Fastlane\nincrement_version_number(version_number: "${name}")\nincrement_build_number(build_number: ${build})\n\n# CI: use the run number so builds always increase\n# --build-number=\${{ github.run_number }}`)
        ]
      };
    }
    const range = parseRange(str(values, "range"));
    const vs = versions();
    const matching = vs.filter(v => satisfies(v, range));
    const best = matching.sort(compareVersions)[matching.length - 1];
    return {
      stats: [{ label: "Means", value: describeRange(range) }, { label: "Matches", value: `${matching.length} of ${vs.length}`, tone: matching.length ? "good" : "warn" }, { label: "Resolves to", value: best ? formatVersion(best) : "nothing", tone: best ? "good" : "bad" }],
      outputs: [table("Versions", ["Version", "Allowed"], vs.sort(compareVersions).map(v => [formatVersion(v), satisfies(v, range) ? "✓ yes" : "no"]))]
    };
  }
};

export const WEB_TOOLS: ToolSpec[] = [curlTool, apiResponse, urlTool, openApiTool, graphqlTool, oauthTool, corsTool, headersTool, cookieTool, htmlJsxTool, reactTool, metaTool, cssUnitsTool, cacheTool, scaffoldTool, dbTool, sqlMongoTool, gitTool, gitignoreTool, semverTool];
