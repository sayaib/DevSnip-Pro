import * as assert from "assert";
import {
  buildChatRequest,
  buildEmbeddingsRequest,
  cosineSimilarity,
  estimateCost,
  estimateTokens,
  parseChatResponse,
  parseEmbeddingsResponse,
  parseStreamChunk
} from "../../services/llm-providers";
import { buildVectorQuery, groundingScore, parseVectorResponse } from "../../services/vector-db";
import { diffJson, extractJson, inferSchema, readPath, validateSchema } from "../../services/json-tools";
import { parseAssertionRules, percentiles, runAssertions } from "../../services/assertions";
import { generateClientCode, inspectJwt } from "../../services/dev-operations";
import { scoreAgainstCriteria } from "../../services/ai-operations";
import { suite, test } from "./run-unit-tests";

suite("LLM provider adapters", () => {
  test("OpenAI requests carry the model, messages and bearer token", () => {
    const request = buildChatRequest({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
      messages: [{ role: "user", content: "hi" }]
    });
    assert.strictEqual(request.url, "https://api.openai.com/v1/chat/completions");
    assert.strictEqual(request.headers.Authorization, "Bearer sk-test");
    const body = request.body as any;
    assert.strictEqual(body.model, "gpt-4o-mini");
    assert.deepStrictEqual(body.messages, [{ role: "user", content: "hi" }]);
  });

  test("Anthropic uses x-api-key, a version header and a hoisted system prompt", () => {
    const request = buildChatRequest({
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
    const body = request.body as any;
    assert.strictEqual(body.system, "Be brief.", "Anthropic takes the system prompt as its own field");
    assert.strictEqual(body.messages.length, 1, "the system message must not stay in messages");
    assert.ok(body.max_tokens > 0, "Anthropic requires max_tokens");
  });

  test("Gemini maps roles and sends the key as a header, not a query parameter", () => {
    const request = buildChatRequest({
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
    const body = request.body as any;
    assert.strictEqual(body.contents[1].role, "model", "assistant maps to model for Gemini");
  });

  test("Azure targets a deployment with an api-version", () => {
    const request = buildChatRequest({
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

  test("Ollama targets the local chat endpoint and needs no key", () => {
    const request = buildChatRequest({
      provider: "ollama",
      model: "llama3.2",
      messages: [{ role: "user", content: "hi" }]
    });
    assert.strictEqual(request.url, "http://127.0.0.1:11434/api/chat");
    assert.strictEqual(request.headers.Authorization, undefined);
  });

  test("a trailing slash on the base URL does not produce a double slash", () => {
    const request = buildChatRequest({
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://proxy.example.com/v1/",
      messages: [{ role: "user", content: "hi" }]
    });
    assert.strictEqual(request.url, "https://proxy.example.com/v1/chat/completions");
  });

  test("tool definitions are translated per provider", () => {
    const tools = [{ name: "lookup", description: "Look something up", parameters: { type: "object", properties: {} } }];
    const openai = buildChatRequest({ provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "x" }], tools }).body as any;
    assert.strictEqual(openai.tools[0].type, "function");
    assert.strictEqual(openai.tools[0].function.name, "lookup");

    const anthropic = buildChatRequest({ provider: "anthropic", model: "claude-sonnet-4-5", messages: [{ role: "user", content: "x" }], tools }).body as any;
    assert.strictEqual(anthropic.tools[0].name, "lookup");
    assert.ok(anthropic.tools[0].input_schema, "Anthropic calls it input_schema");
  });

  test("responses are parsed into text, usage and tool calls", () => {
    const openai = parseChatResponse("openai", {
      model: "gpt-4o-mini",
      choices: [{ message: { content: "hello", tool_calls: [{ id: "c1", function: { name: "t", arguments: "{}" } }] }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    });
    assert.strictEqual(openai.text, "hello");
    assert.strictEqual(openai.usage.totalTokens, 15);
    assert.strictEqual(openai.toolCalls[0].name, "t");

    const anthropic = parseChatResponse("anthropic", {
      model: "claude",
      content: [{ type: "text", text: "hi there" }],
      usage: { input_tokens: 4, output_tokens: 2 }
    });
    assert.strictEqual(anthropic.text, "hi there");
    assert.strictEqual(anthropic.usage.totalTokens, 6);

    const gemini = parseChatResponse("gemini", {
      candidates: [{ content: { parts: [{ text: "gem" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 }
    });
    assert.strictEqual(gemini.text, "gem");
    assert.strictEqual(gemini.usage.promptTokens, 3);

    const ollama = parseChatResponse("ollama", { model: "llama3.2", message: { content: "local" }, prompt_eval_count: 7, eval_count: 3 });
    assert.strictEqual(ollama.text, "local");
    assert.strictEqual(ollama.usage.totalTokens, 10);
  });

  test("an unexpected payload is flagged rather than crashing", () => {
    const result = parseChatResponse("openai", { unexpected: true });
    assert.strictEqual(result.text, "");
    assert.strictEqual(result.unrecognised, true);
    assert.doesNotThrow(() => parseChatResponse("openai", null));
  });

  test("stream chunks are decoded per provider", () => {
    assert.strictEqual(parseStreamChunk("openai", 'data: {"choices":[{"delta":{"content":"ab"}}]}').text, "ab");
    assert.strictEqual(parseStreamChunk("openai", "data: [DONE]").done, true);
    assert.strictEqual(parseStreamChunk("anthropic", 'data: {"type":"content_block_delta","delta":{"text":"xy"}}').text, "xy");
    assert.strictEqual(parseStreamChunk("gemini", 'data: {"candidates":[{"content":{"parts":[{"text":"g"}]}}]}').text, "g");
    assert.strictEqual(parseStreamChunk("ollama", '{"message":{"content":"o"},"done":false}').text, "o");
    assert.strictEqual(parseStreamChunk("openai", "").text, "", "keep-alives are ignored");
    assert.doesNotThrow(() => parseStreamChunk("openai", "data: not json"));
  });

  test("embeddings requests and responses are handled per provider", () => {
    const openai = buildEmbeddingsRequest({ provider: "openai", model: "text-embedding-3-small", input: ["a"], apiKey: "k" });
    assert.strictEqual(openai.url, "https://api.openai.com/v1/embeddings");
    assert.deepStrictEqual(parseEmbeddingsResponse("openai", { data: [{ embedding: [1, 2] }] }), [[1, 2]]);
    assert.deepStrictEqual(parseEmbeddingsResponse("ollama", { embeddings: [[3, 4]] }), [[3, 4]]);
    assert.throws(() => buildEmbeddingsRequest({ provider: "anthropic", model: "x", input: ["a"] }), /does not expose an embeddings endpoint/);
  });

  test("cosine similarity behaves at the boundaries", () => {
    assert.strictEqual(Math.round(cosineSimilarity([1, 0], [1, 0]) * 100) / 100, 1);
    assert.strictEqual(Math.round(cosineSimilarity([1, 0], [0, 1]) * 100) / 100, 0);
    assert.strictEqual(cosineSimilarity([], []), 0);
    assert.strictEqual(cosineSimilarity([0, 0], [0, 0]), 0, "a zero vector must not divide by zero");
  });

  test("token and cost estimates are sane", () => {
    assert.strictEqual(estimateTokens(""), 0);
    assert.ok(estimateTokens("hello world") > 0);
    const known = estimateCost("gpt-4o-mini", { promptTokens: 1_000_000, completionTokens: 0 });
    assert.strictEqual(known.known, true);
    assert.ok(known.usd > 0);
    assert.strictEqual(estimateCost("some-unlisted-model", { promptTokens: 100 }).known, false);
  });
});

suite("vector database adapters", () => {
  test("each vendor gets its own endpoint and auth header", () => {
    const qdrant = buildVectorQuery({ db: "qdrant", baseUrl: "http://localhost:6333", collection: "docs", vector: [1], topK: 3 });
    assert.ok(qdrant.url.endsWith("/collections/docs/points/search"));

    const pinecone = buildVectorQuery({ db: "pinecone", baseUrl: "https://idx.pinecone.io", collection: "ns", vector: [1], topK: 3, apiKey: "pk" });
    assert.strictEqual(pinecone.headers["Api-Key"], "pk");
    assert.strictEqual((pinecone.body as any).namespace, "ns");

    const chroma = buildVectorQuery({ db: "chroma", baseUrl: "http://localhost:8000", collection: "c1", vector: [1], topK: 3 });
    assert.ok(chroma.url.includes("/api/v1/collections/c1/query"));
  });

  test("topK is clamped to a sane range", () => {
    const request = buildVectorQuery({ db: "qdrant", baseUrl: "http://x", collection: "c", vector: [1], topK: 9999 });
    assert.strictEqual((request.body as any).limit, 100);
  });

  test("responses normalise to matches with higher-is-better scores", () => {
    const qdrant = parseVectorResponse("qdrant", { result: [{ id: 1, score: 0.9, payload: { text: "hello" } }] });
    assert.strictEqual(qdrant[0].text, "hello");
    assert.strictEqual(qdrant[0].score, 0.9);

    const chroma = parseVectorResponse("chroma", {
      ids: [["a"]], documents: [["doc"]], distances: [[0.25]], metadatas: [[{ source: "x" }]]
    });
    assert.strictEqual(chroma[0].text, "doc");
    assert.strictEqual(chroma[0].score, 0.75, "a distance is converted to a similarity");

    assert.deepStrictEqual(parseVectorResponse("qdrant", null), []);
  });

  test("payload text is found under any of the common field names", () => {
    const matches = parseVectorResponse("pinecone", { matches: [{ id: "1", score: 1, metadata: { page_content: "from langchain" } }] });
    assert.strictEqual(matches[0].text, "from langchain");
  });

  test("grounding scores an answer against its context", () => {
    const context = "The service retries failed requests three times with exponential backoff.";
    const grounded = groundingScore("The service retries failed requests three times with exponential backoff.", context);
    assert.strictEqual(grounded.score, 1);

    const invented = groundingScore("The service sends an email notification to the account administrator daily.", context);
    assert.ok(invented.score < 1, "unsupported claims should lower the score");
    assert.strictEqual(groundingScore("", context).total, 0);
  });
});

suite("JSON tooling", () => {
  test("readPath walks objects, arrays and wildcards", () => {
    const data = { items: [{ id: 1, name: "a" }, { id: 2, name: "b" }], meta: { total: 2 } };
    assert.strictEqual(readPath(data, "meta.total"), 2);
    assert.strictEqual(readPath(data, "items[0].name"), "a");
    assert.deepStrictEqual(readPath(data, "items[*].id"), [1, 2]);
    assert.strictEqual(readPath(data, "$.meta.total"), 2);
    assert.strictEqual(readPath(data, "missing.path"), undefined);
    assert.deepStrictEqual(readPath(data, ""), data);
  });

  test("diffJson reports additions, removals and changes", () => {
    const differences = diffJson({ a: 1, b: 2, gone: true }, { a: 1, b: 3, added: "x" });
    const byKind = Object.fromEntries(differences.map(entry => [entry.path, entry.kind]));
    assert.strictEqual(byKind.b, "changed");
    assert.strictEqual(byKind.gone, "removed");
    assert.strictEqual(byKind.added, "added");
    assert.strictEqual(byKind.a, undefined, "identical values are not reported");
    assert.deepStrictEqual(diffJson({ a: 1 }, { a: 1 }), []);
  });

  test("schema validation covers the common keywords", () => {
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
    assert.deepStrictEqual(validateSchema({ id: 1, name: "ok", tags: ["a"], role: "admin" }, schema), []);

    const violations = validateSchema({ id: 0, tags: ["a", "b", "c"], role: "root", extra: 1 }, schema);
    const paths = violations.map(entry => entry.path);
    assert.ok(paths.includes("$.name"), "a missing required field is reported");
    assert.ok(paths.includes("$.id"), "the minimum is enforced");
    assert.ok(paths.includes("$.tags"), "maxItems is enforced");
    assert.ok(paths.includes("$.role"), "enum is enforced");
    assert.ok(paths.includes("$.extra"), "additionalProperties false is enforced");
  });

  test("a wrong type does not cascade into unrelated errors", () => {
    const violations = validateSchema("a string", { type: "object", required: ["id"] });
    assert.strictEqual(violations.length, 1);
    assert.match(violations[0].message, /expected object/);
  });

  test("extractJson copes with fenced and surrounded output", () => {
    assert.deepStrictEqual(extractJson('{"a":1}').value, { a: 1 });
    assert.deepStrictEqual(extractJson('```json\n{"a":1}\n```').value, { a: 1 });
    assert.deepStrictEqual(extractJson('Sure! {"a":1} hope that helps').value, { a: 1 });
    assert.strictEqual(extractJson("not json at all").ok, false);
  });

  test("inferSchema describes an example payload", () => {
    const schema = inferSchema({ id: 1, name: "x", tags: ["a"], nested: { ok: true } }) as any;
    assert.strictEqual(schema.type, "object");
    assert.strictEqual(schema.properties.id.type, "integer");
    assert.strictEqual(schema.properties.tags.type, "array");
    assert.strictEqual(schema.properties.nested.properties.ok.type, "boolean");
  });
});

suite("assertions", () => {
  const subject = {
    status: 200,
    latencyMs: 120,
    sizeBytes: 44,
    headers: { "Content-Type": "application/json", "x-request-id": "abc" },
    body: { data: { id: 7, items: [1, 2, 3] }, ok: true },
    bodyText: '{"data":{"id":7,"items":[1,2,3]},"ok":true}'
  };

  test("status, latency and header rules evaluate correctly", () => {
    const report = runAssertions(
      [
        { target: "status", operator: "equals", expected: 200 },
        { target: "latency", operator: "lessThan", expected: 500 },
        { target: "header", selector: "content-type", operator: "contains", expected: "json" }
      ],
      subject
    );
    assert.strictEqual(report.allPassed, true);
    assert.strictEqual(report.passed, 3);
  });

  test("header lookup is case-insensitive", () => {
    const report = runAssertions([{ target: "header", selector: "CONTENT-TYPE", operator: "exists" }], subject);
    assert.strictEqual(report.allPassed, true);
  });

  test("JSON path rules can assert on nested values", () => {
    const report = runAssertions(
      [
        { target: "json", selector: "data.id", operator: "equals", expected: 7 },
        { target: "json", selector: "data.items", operator: "isArray" },
        { target: "json", selector: "data.items", operator: "hasLength", expected: 3 },
        { target: "json", selector: "data.missing", operator: "notExists" }
      ],
      subject
    );
    assert.strictEqual(report.allPassed, true, JSON.stringify(report.results));
  });

  test("failures are reported with the actual value", () => {
    const report = runAssertions([{ target: "status", operator: "equals", expected: 404 }], subject);
    assert.strictEqual(report.failed, 1);
    assert.strictEqual(report.results[0].actual, "200");
  });

  test("an invalid regular expression fails safely", () => {
    const report = runAssertions([{ target: "body", operator: "matches", expected: "([" }], subject);
    assert.strictEqual(report.results[0].passed, false);
    assert.match(report.results[0].detail ?? "", /invalid regular expression/);
  });

  test("malformed rules from a webview are discarded", () => {
    const rules = parseAssertionRules([
      { target: "status", operator: "equals", expected: 200 },
      { target: "nonsense", operator: "equals" },
      { target: "status", operator: "explode" },
      "not an object",
      null
    ]);
    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(parseAssertionRules("not an array"), []);
  });

  test("percentiles handle small and empty samples", () => {
    assert.deepStrictEqual(percentiles([]), { p50: 0, p90: 0, p99: 0, min: 0, max: 0, mean: 0 });
    const stats = percentiles([10, 20, 30, 40, 50]);
    assert.strictEqual(stats.min, 10);
    assert.strictEqual(stats.max, 50);
    assert.strictEqual(stats.mean, 30);
  });
});

suite("developer operations", () => {
  const request = {
    method: "POST",
    url: "https://api.example.com/items",
    headers: { "Content-Type": "application/json", "X-Token": 'a"quote' },
    body: '{"name":"test"}'
  };

  test("every target language produces code containing the URL and method", () => {
    for (const language of ["javascript-fetch", "javascript-axios", "python", "go", "java", "csharp"] as const) {
      const code = generateClientCode(request, language);
      assert.ok(code.includes("https://api.example.com/items"), `${language} is missing the URL`);
      assert.ok(/POST/i.test(code), `${language} is missing the method`);
      assert.ok(code.length > 50, `${language} produced suspiciously little code`);
    }
  });

  test("quotes in a header value are escaped, not concatenated into broken code", () => {
    const code = generateClientCode(request, "javascript-fetch");
    assert.ok(code.includes('"a\\"quote"'), "the embedded quote must be escaped");
    assert.doesNotThrow(() => JSON.parse(`"${'a\\"quote'}"`));
  });

  test("a GET request does not emit a body", () => {
    const code = generateClientCode({ ...request, method: "GET" }, "javascript-fetch");
    assert.ok(!code.includes("body:"), "GET must not carry a body");
  });

  test("a JWT is decoded with its claims and timings", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "42", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    const result = inspectJwt(`${header}.${payload}.signature`);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.payload?.sub, "42");
    assert.strictEqual(result.expired, false);
    assert.strictEqual(result.signaturePresent, true);
  });

  test("an expired token and the none algorithm are both flagged", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 10 })).toString("base64url");
    const result = inspectJwt(`${header}.${payload}.`);
    assert.strictEqual(result.expired, true);
    assert.ok(result.warnings.some(warning => /unsigned/i.test(warning)));
    assert.ok(result.warnings.some(warning => /expired/i.test(warning)));
  });

  test("a Bearer prefix is tolerated and rubbish is rejected", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "x" })).toString("base64url");
    assert.strictEqual(inspectJwt(`Bearer ${header}.${payload}.sig`).valid, true);
    assert.strictEqual(inspectJwt("nonsense").valid, false);
    assert.strictEqual(inspectJwt("still.nonsense").valid, false);
  });
});

suite("prompt evaluation scoring", () => {
  test("required and forbidden phrases are checked case-insensitively", () => {
    const checks = scoreAgainstCriteria("Unit Tests catch regressions early.", {
      mustInclude: ["unit tests"],
      mustNotInclude: ["lorem"]
    });
    assert.strictEqual(checks.filter(check => check.passed).length, 2);
  });

  test("word bounds are enforced", () => {
    const checks = scoreAgainstCriteria("one two three", { minWords: 5, maxWords: 10 });
    assert.strictEqual(checks[0].passed, false);
    assert.strictEqual(checks[1].passed, true);
  });

  test("JSON schema criteria validate the model's output", () => {
    const schema = { type: "object", required: ["answer"] };
    const good = scoreAgainstCriteria('```json\n{"answer":"yes"}\n```', { jsonSchema: schema });
    assert.strictEqual(good.every(check => check.passed), true);

    const bad = scoreAgainstCriteria('{"other":"no"}', { jsonSchema: schema });
    assert.strictEqual(bad.some(check => !check.passed), true);

    const unparsable = scoreAgainstCriteria("I cannot do that", { jsonSchema: schema });
    assert.strictEqual(unparsable[0].passed, false);
  });
});
