"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const llm_providers_1 = require("../../services/llm-providers");
const vector_db_1 = require("../../services/vector-db");
const json_tools_1 = require("../../services/json-tools");
const assertions_1 = require("../../services/assertions");
const dev_operations_1 = require("../../services/dev-operations");
const ai_operations_1 = require("../../services/ai-operations");
const run_unit_tests_1 = require("./run-unit-tests");
(0, run_unit_tests_1.suite)("LLM provider adapters", () => {
    (0, run_unit_tests_1.test)("OpenAI requests carry the model, messages and bearer token", () => {
        const request = (0, llm_providers_1.buildChatRequest)({
            provider: "openai",
            model: "gpt-4o-mini",
            apiKey: "sk-test",
            messages: [{ role: "user", content: "hi" }]
        });
        assert.strictEqual(request.url, "https://api.openai.com/v1/chat/completions");
        assert.strictEqual(request.headers.Authorization, "Bearer sk-test");
        const body = request.body;
        assert.strictEqual(body.model, "gpt-4o-mini");
        assert.deepStrictEqual(body.messages, [{ role: "user", content: "hi" }]);
    });
    (0, run_unit_tests_1.test)("Anthropic uses x-api-key, a version header and a hoisted system prompt", () => {
        const request = (0, llm_providers_1.buildChatRequest)({
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            apiKey: "sk-ant",
            messages: [
                { role: "system", content: "Be brief." },
                { role: "user", content: "hi" }
            ]
        });
        assert.strictEqual(request.url, "https://api.anthropic.com/v1/messages");
        assert.strictEqual(request.headers["x-api-key"], "sk-ant");
        assert.ok(request.headers["anthropic-version"]);
        const body = request.body;
        assert.strictEqual(body.system, "Be brief.", "Anthropic takes the system prompt as its own field");
        assert.strictEqual(body.messages.length, 1, "the system message must not stay in messages");
        assert.ok(body.max_tokens > 0, "Anthropic requires max_tokens");
    });
    (0, run_unit_tests_1.test)("Gemini maps roles and sends the key as a header, not a query parameter", () => {
        const request = (0, llm_providers_1.buildChatRequest)({
            provider: "gemini",
            model: "gemini-2.0-flash",
            apiKey: "goog-key",
            messages: [
                { role: "user", content: "hi" },
                { role: "assistant", content: "hello" }
            ]
        });
        assert.ok(request.url.includes("models/gemini-2.0-flash:generateContent"));
        assert.ok(!request.url.includes("goog-key"), "the key must never appear in the URL");
        assert.strictEqual(request.headers["x-goog-api-key"], "goog-key");
        const body = request.body;
        assert.strictEqual(body.contents[1].role, "model", "assistant maps to model for Gemini");
    });
    (0, run_unit_tests_1.test)("Azure targets a deployment with an api-version", () => {
        const request = (0, llm_providers_1.buildChatRequest)({
            provider: "azure-openai",
            model: "my-deployment",
            apiKey: "azure-key",
            baseUrl: "https://example.openai.azure.com",
            messages: [{ role: "user", content: "hi" }]
        });
        assert.ok(request.url.includes("/openai/deployments/my-deployment/chat/completions"));
        assert.ok(request.url.includes("api-version="));
        assert.strictEqual(request.headers["api-key"], "azure-key");
    });
    (0, run_unit_tests_1.test)("Ollama targets the local chat endpoint and needs no key", () => {
        const request = (0, llm_providers_1.buildChatRequest)({
            provider: "ollama",
            model: "llama3.2",
            messages: [{ role: "user", content: "hi" }]
        });
        assert.strictEqual(request.url, "http://127.0.0.1:11434/api/chat");
        assert.strictEqual(request.headers.Authorization, undefined);
    });
    (0, run_unit_tests_1.test)("a trailing slash on the base URL does not produce a double slash", () => {
        const request = (0, llm_providers_1.buildChatRequest)({
            provider: "openai",
            model: "gpt-4o-mini",
            baseUrl: "https://proxy.example.com/v1/",
            messages: [{ role: "user", content: "hi" }]
        });
        assert.strictEqual(request.url, "https://proxy.example.com/v1/chat/completions");
    });
    (0, run_unit_tests_1.test)("tool definitions are translated per provider", () => {
        const tools = [{ name: "lookup", description: "Look something up", parameters: { type: "object", properties: {} } }];
        const openai = (0, llm_providers_1.buildChatRequest)({ provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "x" }], tools }).body;
        assert.strictEqual(openai.tools[0].type, "function");
        assert.strictEqual(openai.tools[0].function.name, "lookup");
        const anthropic = (0, llm_providers_1.buildChatRequest)({ provider: "anthropic", model: "claude-sonnet-4-5", messages: [{ role: "user", content: "x" }], tools }).body;
        assert.strictEqual(anthropic.tools[0].name, "lookup");
        assert.ok(anthropic.tools[0].input_schema, "Anthropic calls it input_schema");
    });
    (0, run_unit_tests_1.test)("responses are parsed into text, usage and tool calls", () => {
        const openai = (0, llm_providers_1.parseChatResponse)("openai", {
            model: "gpt-4o-mini",
            choices: [{ message: { content: "hello", tool_calls: [{ id: "c1", function: { name: "t", arguments: "{}" } }] }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        });
        assert.strictEqual(openai.text, "hello");
        assert.strictEqual(openai.usage.totalTokens, 15);
        assert.strictEqual(openai.toolCalls[0].name, "t");
        const anthropic = (0, llm_providers_1.parseChatResponse)("anthropic", {
            model: "claude",
            content: [{ type: "text", text: "hi there" }],
            usage: { input_tokens: 4, output_tokens: 2 }
        });
        assert.strictEqual(anthropic.text, "hi there");
        assert.strictEqual(anthropic.usage.totalTokens, 6);
        const gemini = (0, llm_providers_1.parseChatResponse)("gemini", {
            candidates: [{ content: { parts: [{ text: "gem" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 }
        });
        assert.strictEqual(gemini.text, "gem");
        assert.strictEqual(gemini.usage.promptTokens, 3);
        const ollama = (0, llm_providers_1.parseChatResponse)("ollama", { model: "llama3.2", message: { content: "local" }, prompt_eval_count: 7, eval_count: 3 });
        assert.strictEqual(ollama.text, "local");
        assert.strictEqual(ollama.usage.totalTokens, 10);
    });
    (0, run_unit_tests_1.test)("an unexpected payload is flagged rather than crashing", () => {
        const result = (0, llm_providers_1.parseChatResponse)("openai", { unexpected: true });
        assert.strictEqual(result.text, "");
        assert.strictEqual(result.unrecognised, true);
        assert.doesNotThrow(() => (0, llm_providers_1.parseChatResponse)("openai", null));
    });
    (0, run_unit_tests_1.test)("stream chunks are decoded per provider", () => {
        assert.strictEqual((0, llm_providers_1.parseStreamChunk)("openai", 'data: {"choices":[{"delta":{"content":"ab"}}]}').text, "ab");
        assert.strictEqual((0, llm_providers_1.parseStreamChunk)("openai", "data: [DONE]").done, true);
        assert.strictEqual((0, llm_providers_1.parseStreamChunk)("anthropic", 'data: {"type":"content_block_delta","delta":{"text":"xy"}}').text, "xy");
        assert.strictEqual((0, llm_providers_1.parseStreamChunk)("gemini", 'data: {"candidates":[{"content":{"parts":[{"text":"g"}]}}]}').text, "g");
        assert.strictEqual((0, llm_providers_1.parseStreamChunk)("ollama", '{"message":{"content":"o"},"done":false}').text, "o");
        assert.strictEqual((0, llm_providers_1.parseStreamChunk)("openai", "").text, "", "keep-alives are ignored");
        assert.doesNotThrow(() => (0, llm_providers_1.parseStreamChunk)("openai", "data: not json"));
    });
    (0, run_unit_tests_1.test)("embeddings requests and responses are handled per provider", () => {
        const openai = (0, llm_providers_1.buildEmbeddingsRequest)({ provider: "openai", model: "text-embedding-3-small", input: ["a"], apiKey: "k" });
        assert.strictEqual(openai.url, "https://api.openai.com/v1/embeddings");
        assert.deepStrictEqual((0, llm_providers_1.parseEmbeddingsResponse)("openai", { data: [{ embedding: [1, 2] }] }), [[1, 2]]);
        assert.deepStrictEqual((0, llm_providers_1.parseEmbeddingsResponse)("ollama", { embeddings: [[3, 4]] }), [[3, 4]]);
        assert.throws(() => (0, llm_providers_1.buildEmbeddingsRequest)({ provider: "anthropic", model: "x", input: ["a"] }), /does not expose an embeddings endpoint/);
    });
    (0, run_unit_tests_1.test)("cosine similarity behaves at the boundaries", () => {
        assert.strictEqual(Math.round((0, llm_providers_1.cosineSimilarity)([1, 0], [1, 0]) * 100) / 100, 1);
        assert.strictEqual(Math.round((0, llm_providers_1.cosineSimilarity)([1, 0], [0, 1]) * 100) / 100, 0);
        assert.strictEqual((0, llm_providers_1.cosineSimilarity)([], []), 0);
        assert.strictEqual((0, llm_providers_1.cosineSimilarity)([0, 0], [0, 0]), 0, "a zero vector must not divide by zero");
    });
    (0, run_unit_tests_1.test)("token and cost estimates are sane", () => {
        assert.strictEqual((0, llm_providers_1.estimateTokens)(""), 0);
        assert.ok((0, llm_providers_1.estimateTokens)("hello world") > 0);
        const known = (0, llm_providers_1.estimateCost)("gpt-4o-mini", { promptTokens: 1000000, completionTokens: 0 });
        assert.strictEqual(known.known, true);
        assert.ok(known.usd > 0);
        assert.strictEqual((0, llm_providers_1.estimateCost)("some-unlisted-model", { promptTokens: 100 }).known, false);
    });
});
(0, run_unit_tests_1.suite)("vector database adapters", () => {
    (0, run_unit_tests_1.test)("each vendor gets its own endpoint and auth header", () => {
        const qdrant = (0, vector_db_1.buildVectorQuery)({ db: "qdrant", baseUrl: "http://localhost:6333", collection: "docs", vector: [1], topK: 3 });
        assert.ok(qdrant.url.endsWith("/collections/docs/points/search"));
        const pinecone = (0, vector_db_1.buildVectorQuery)({ db: "pinecone", baseUrl: "https://idx.pinecone.io", collection: "ns", vector: [1], topK: 3, apiKey: "pk" });
        assert.strictEqual(pinecone.headers["Api-Key"], "pk");
        assert.strictEqual(pinecone.body.namespace, "ns");
        const chroma = (0, vector_db_1.buildVectorQuery)({ db: "chroma", baseUrl: "http://localhost:8000", collection: "c1", vector: [1], topK: 3 });
        assert.ok(chroma.url.includes("/api/v1/collections/c1/query"));
    });
    (0, run_unit_tests_1.test)("topK is clamped to a sane range", () => {
        const request = (0, vector_db_1.buildVectorQuery)({ db: "qdrant", baseUrl: "http://x", collection: "c", vector: [1], topK: 9999 });
        assert.strictEqual(request.body.limit, 100);
    });
    (0, run_unit_tests_1.test)("responses normalise to matches with higher-is-better scores", () => {
        const qdrant = (0, vector_db_1.parseVectorResponse)("qdrant", { result: [{ id: 1, score: 0.9, payload: { text: "hello" } }] });
        assert.strictEqual(qdrant[0].text, "hello");
        assert.strictEqual(qdrant[0].score, 0.9);
        const chroma = (0, vector_db_1.parseVectorResponse)("chroma", {
            ids: [["a"]], documents: [["doc"]], distances: [[0.25]], metadatas: [[{ source: "x" }]]
        });
        assert.strictEqual(chroma[0].text, "doc");
        assert.strictEqual(chroma[0].score, 0.75, "a distance is converted to a similarity");
        assert.deepStrictEqual((0, vector_db_1.parseVectorResponse)("qdrant", null), []);
    });
    (0, run_unit_tests_1.test)("payload text is found under any of the common field names", () => {
        const matches = (0, vector_db_1.parseVectorResponse)("pinecone", { matches: [{ id: "1", score: 1, metadata: { page_content: "from langchain" } }] });
        assert.strictEqual(matches[0].text, "from langchain");
    });
    (0, run_unit_tests_1.test)("grounding scores an answer against its context", () => {
        const context = "The service retries failed requests three times with exponential backoff.";
        const grounded = (0, vector_db_1.groundingScore)("The service retries failed requests three times with exponential backoff.", context);
        assert.strictEqual(grounded.score, 1);
        const invented = (0, vector_db_1.groundingScore)("The service sends an email notification to the account administrator daily.", context);
        assert.ok(invented.score < 1, "unsupported claims should lower the score");
        assert.strictEqual((0, vector_db_1.groundingScore)("", context).total, 0);
    });
});
(0, run_unit_tests_1.suite)("JSON tooling", () => {
    (0, run_unit_tests_1.test)("readPath walks objects, arrays and wildcards", () => {
        const data = { items: [{ id: 1, name: "a" }, { id: 2, name: "b" }], meta: { total: 2 } };
        assert.strictEqual((0, json_tools_1.readPath)(data, "meta.total"), 2);
        assert.strictEqual((0, json_tools_1.readPath)(data, "items[0].name"), "a");
        assert.deepStrictEqual((0, json_tools_1.readPath)(data, "items[*].id"), [1, 2]);
        assert.strictEqual((0, json_tools_1.readPath)(data, "$.meta.total"), 2);
        assert.strictEqual((0, json_tools_1.readPath)(data, "missing.path"), undefined);
        assert.deepStrictEqual((0, json_tools_1.readPath)(data, ""), data);
    });
    (0, run_unit_tests_1.test)("diffJson reports additions, removals and changes", () => {
        const differences = (0, json_tools_1.diffJson)({ a: 1, b: 2, gone: true }, { a: 1, b: 3, added: "x" });
        const byKind = Object.fromEntries(differences.map(entry => [entry.path, entry.kind]));
        assert.strictEqual(byKind.b, "changed");
        assert.strictEqual(byKind.gone, "removed");
        assert.strictEqual(byKind.added, "added");
        assert.strictEqual(byKind.a, undefined, "identical values are not reported");
        assert.deepStrictEqual((0, json_tools_1.diffJson)({ a: 1 }, { a: 1 }), []);
    });
    (0, run_unit_tests_1.test)("schema validation covers the common keywords", () => {
        const schema = {
            type: "object",
            required: ["id", "name"],
            properties: {
                id: { type: "integer", minimum: 1 },
                name: { type: "string", minLength: 2 },
                tags: { type: "array", items: { type: "string" }, maxItems: 2 },
                role: { enum: ["admin", "user"] }
            },
            additionalProperties: false
        };
        assert.deepStrictEqual((0, json_tools_1.validateSchema)({ id: 1, name: "ok", tags: ["a"], role: "admin" }, schema), []);
        const violations = (0, json_tools_1.validateSchema)({ id: 0, tags: ["a", "b", "c"], role: "root", extra: 1 }, schema);
        const paths = violations.map(entry => entry.path);
        assert.ok(paths.includes("$.name"), "a missing required field is reported");
        assert.ok(paths.includes("$.id"), "the minimum is enforced");
        assert.ok(paths.includes("$.tags"), "maxItems is enforced");
        assert.ok(paths.includes("$.role"), "enum is enforced");
        assert.ok(paths.includes("$.extra"), "additionalProperties false is enforced");
    });
    (0, run_unit_tests_1.test)("a wrong type does not cascade into unrelated errors", () => {
        const violations = (0, json_tools_1.validateSchema)("a string", { type: "object", required: ["id"] });
        assert.strictEqual(violations.length, 1);
        assert.match(violations[0].message, /expected object/);
    });
    (0, run_unit_tests_1.test)("extractJson copes with fenced and surrounded output", () => {
        assert.deepStrictEqual((0, json_tools_1.extractJson)('{"a":1}').value, { a: 1 });
        assert.deepStrictEqual((0, json_tools_1.extractJson)('```json\n{"a":1}\n```').value, { a: 1 });
        assert.deepStrictEqual((0, json_tools_1.extractJson)('Sure! {"a":1} hope that helps').value, { a: 1 });
        assert.strictEqual((0, json_tools_1.extractJson)("not json at all").ok, false);
    });
    (0, run_unit_tests_1.test)("inferSchema describes an example payload", () => {
        const schema = (0, json_tools_1.inferSchema)({ id: 1, name: "x", tags: ["a"], nested: { ok: true } });
        assert.strictEqual(schema.type, "object");
        assert.strictEqual(schema.properties.id.type, "integer");
        assert.strictEqual(schema.properties.tags.type, "array");
        assert.strictEqual(schema.properties.nested.properties.ok.type, "boolean");
    });
});
(0, run_unit_tests_1.suite)("assertions", () => {
    const subject = {
        status: 200,
        latencyMs: 120,
        sizeBytes: 44,
        headers: { "Content-Type": "application/json", "x-request-id": "abc" },
        body: { data: { id: 7, items: [1, 2, 3] }, ok: true },
        bodyText: '{"data":{"id":7,"items":[1,2,3]},"ok":true}'
    };
    (0, run_unit_tests_1.test)("status, latency and header rules evaluate correctly", () => {
        const report = (0, assertions_1.runAssertions)([
            { target: "status", operator: "equals", expected: 200 },
            { target: "latency", operator: "lessThan", expected: 500 },
            { target: "header", selector: "content-type", operator: "contains", expected: "json" }
        ], subject);
        assert.strictEqual(report.allPassed, true);
        assert.strictEqual(report.passed, 3);
    });
    (0, run_unit_tests_1.test)("header lookup is case-insensitive", () => {
        const report = (0, assertions_1.runAssertions)([{ target: "header", selector: "CONTENT-TYPE", operator: "exists" }], subject);
        assert.strictEqual(report.allPassed, true);
    });
    (0, run_unit_tests_1.test)("JSON path rules can assert on nested values", () => {
        const report = (0, assertions_1.runAssertions)([
            { target: "json", selector: "data.id", operator: "equals", expected: 7 },
            { target: "json", selector: "data.items", operator: "isArray" },
            { target: "json", selector: "data.items", operator: "hasLength", expected: 3 },
            { target: "json", selector: "data.missing", operator: "notExists" }
        ], subject);
        assert.strictEqual(report.allPassed, true, JSON.stringify(report.results));
    });
    (0, run_unit_tests_1.test)("failures are reported with the actual value", () => {
        const report = (0, assertions_1.runAssertions)([{ target: "status", operator: "equals", expected: 404 }], subject);
        assert.strictEqual(report.failed, 1);
        assert.strictEqual(report.results[0].actual, "200");
    });
    (0, run_unit_tests_1.test)("an invalid regular expression fails safely", () => {
        const report = (0, assertions_1.runAssertions)([{ target: "body", operator: "matches", expected: "([" }], subject);
        assert.strictEqual(report.results[0].passed, false);
        assert.match(report.results[0].detail ?? "", /invalid regular expression/);
    });
    (0, run_unit_tests_1.test)("malformed rules from a webview are discarded", () => {
        const rules = (0, assertions_1.parseAssertionRules)([
            { target: "status", operator: "equals", expected: 200 },
            { target: "nonsense", operator: "equals" },
            { target: "status", operator: "explode" },
            "not an object",
            null
        ]);
        assert.strictEqual(rules.length, 1);
        assert.deepStrictEqual((0, assertions_1.parseAssertionRules)("not an array"), []);
    });
    (0, run_unit_tests_1.test)("percentiles handle small and empty samples", () => {
        assert.deepStrictEqual((0, assertions_1.percentiles)([]), { p50: 0, p90: 0, p99: 0, min: 0, max: 0, mean: 0 });
        const stats = (0, assertions_1.percentiles)([10, 20, 30, 40, 50]);
        assert.strictEqual(stats.min, 10);
        assert.strictEqual(stats.max, 50);
        assert.strictEqual(stats.mean, 30);
    });
});
(0, run_unit_tests_1.suite)("developer operations", () => {
    const request = {
        method: "POST",
        url: "https://api.example.com/items",
        headers: { "Content-Type": "application/json", "X-Token": 'a"quote' },
        body: '{"name":"test"}'
    };
    (0, run_unit_tests_1.test)("every target language produces code containing the URL and method", () => {
        for (const language of ["javascript-fetch", "javascript-axios", "python", "go", "java", "csharp"]) {
            const code = (0, dev_operations_1.generateClientCode)(request, language);
            assert.ok(code.includes("https://api.example.com/items"), `${language} is missing the URL`);
            assert.ok(/POST/i.test(code), `${language} is missing the method`);
            assert.ok(code.length > 50, `${language} produced suspiciously little code`);
        }
    });
    (0, run_unit_tests_1.test)("quotes in a header value are escaped, not concatenated into broken code", () => {
        const code = (0, dev_operations_1.generateClientCode)(request, "javascript-fetch");
        assert.ok(code.includes('"a\\"quote"'), "the embedded quote must be escaped");
        assert.doesNotThrow(() => JSON.parse(`"${'a\\"quote'}"`));
    });
    (0, run_unit_tests_1.test)("a GET request does not emit a body", () => {
        const code = (0, dev_operations_1.generateClientCode)({ ...request, method: "GET" }, "javascript-fetch");
        assert.ok(!code.includes("body:"), "GET must not carry a body");
    });
    (0, run_unit_tests_1.test)("a JWT is decoded with its claims and timings", () => {
        const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ sub: "42", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
        const result = (0, dev_operations_1.inspectJwt)(`${header}.${payload}.signature`);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.payload?.sub, "42");
        assert.strictEqual(result.expired, false);
        assert.strictEqual(result.signaturePresent, true);
    });
    (0, run_unit_tests_1.test)("an expired token and the none algorithm are both flagged", () => {
        const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 10 })).toString("base64url");
        const result = (0, dev_operations_1.inspectJwt)(`${header}.${payload}.`);
        assert.strictEqual(result.expired, true);
        assert.ok(result.warnings.some(warning => /unsigned/i.test(warning)));
        assert.ok(result.warnings.some(warning => /expired/i.test(warning)));
    });
    (0, run_unit_tests_1.test)("a Bearer prefix is tolerated and rubbish is rejected", () => {
        const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
        const payload = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
        assert.strictEqual((0, dev_operations_1.inspectJwt)(`Bearer ${header}.${payload}.sig`).valid, true);
        assert.strictEqual((0, dev_operations_1.inspectJwt)("nonsense").valid, false);
        assert.strictEqual((0, dev_operations_1.inspectJwt)("still.nonsense").valid, false);
    });
});
(0, run_unit_tests_1.suite)("prompt evaluation scoring", () => {
    (0, run_unit_tests_1.test)("required and forbidden phrases are checked case-insensitively", () => {
        const checks = (0, ai_operations_1.scoreAgainstCriteria)("Unit Tests catch regressions early.", {
            mustInclude: ["unit tests"],
            mustNotInclude: ["lorem"]
        });
        assert.strictEqual(checks.filter(check => check.passed).length, 2);
    });
    (0, run_unit_tests_1.test)("word bounds are enforced", () => {
        const checks = (0, ai_operations_1.scoreAgainstCriteria)("one two three", { minWords: 5, maxWords: 10 });
        assert.strictEqual(checks[0].passed, false);
        assert.strictEqual(checks[1].passed, true);
    });
    (0, run_unit_tests_1.test)("JSON schema criteria validate the model's output", () => {
        const schema = { type: "object", required: ["answer"] };
        const good = (0, ai_operations_1.scoreAgainstCriteria)('```json\n{"answer":"yes"}\n```', { jsonSchema: schema });
        assert.strictEqual(good.every(check => check.passed), true);
        const bad = (0, ai_operations_1.scoreAgainstCriteria)('{"other":"no"}', { jsonSchema: schema });
        assert.strictEqual(bad.some(check => !check.passed), true);
        const unparsable = (0, ai_operations_1.scoreAgainstCriteria)("I cannot do that", { jsonSchema: schema });
        assert.strictEqual(unparsable[0].passed, false);
    });
});
//# sourceMappingURL=feature-services.unit.js.map