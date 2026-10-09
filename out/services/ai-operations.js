"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluatePrompts = exports.scoreAgainstCriteria = exports.testAgent = exports.testRagPipeline = exports.searchVectors = exports.testEmbeddings = exports.benchmarkModel = exports.compareModels = exports.streamChat = exports.callChat = void 0;
const axios_1 = __importDefault(require("axios"));
const llm_providers_1 = require("./llm-providers");
const vector_db_1 = require("./vector-db");
const json_tools_1 = require("./json-tools");
const assertions_1 = require("./assertions");
/**
 * The operations behind every AI/ML feature in the REST API Client.
 *
 * These are plain async functions over the provider adapters: no VS Code and
 * no entitlement logic, so they are unit-testable and the access boundary
 * stays in one place (FeatureAccessService) rather than being duplicated here.
 */
const DEFAULT_TIMEOUT_MS = 120000;
function errorMessage(error) {
    if (axios_1.default.isCancel?.(error))
        return "Request cancelled.";
    if (error?.response) {
        const data = error.response.data;
        const detail = typeof data === "string"
            ? data.slice(0, 400)
            : data?.error?.message || data?.message || JSON.stringify(data ?? {}).slice(0, 400);
        return `HTTP ${error.response.status}: ${detail}`;
    }
    if (error?.code === "ECONNREFUSED") {
        return "Connection refused. If this is a local model server, check that it is running and the base URL is right.";
    }
    if (error?.code === "ETIMEDOUT" || error?.code === "ECONNABORTED")
        return "The request timed out.";
    return error?.message ? String(error.message) : "The request failed.";
}
/** Sends one chat completion and normalises the outcome. */
async function callChat(options, cancelToken) {
    const request = (0, llm_providers_1.buildChatRequest)({ ...options, stream: false });
    const started = Date.now();
    const config = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        data: request.body,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        validateStatus: () => true,
        ...(cancelToken ? { cancelToken: cancelToken.token } : {})
    };
    try {
        const response = await (0, axios_1.default)(config);
        const latencyMs = Date.now() - started;
        const parsed = (0, llm_providers_1.parseChatResponse)(options.provider, response.data);
        const cost = (0, llm_providers_1.estimateCost)(options.model, parsed.usage);
        if (response.status >= 400) {
            const data = response.data;
            const detail = typeof data === "string"
                ? data.slice(0, 400)
                : data?.error?.message || data?.message || JSON.stringify(data ?? {}).slice(0, 400);
            return {
                ok: false,
                status: response.status,
                latencyMs,
                parsed,
                raw: response.data,
                error: `HTTP ${response.status}: ${detail}`,
                costUsd: cost.usd,
                costKnown: cost.known
            };
        }
        return {
            ok: true,
            status: response.status,
            latencyMs,
            parsed,
            raw: response.data,
            costUsd: cost.usd,
            costKnown: cost.known
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 0,
            latencyMs: Date.now() - started,
            parsed: { text: "", usage: {}, toolCalls: [] },
            raw: undefined,
            error: errorMessage(error),
            costUsd: 0,
            costKnown: false
        };
    }
}
exports.callChat = callChat;
/**
 * Streams a completion, emitting each delta as it arrives and measuring
 * time-to-first-token and inter-chunk latency along the way.
 */
async function streamChat(options, onEvent, cancelToken) {
    const request = (0, llm_providers_1.buildChatRequest)({ ...options, stream: true });
    const started = Date.now();
    let firstTokenAt = 0;
    let lastChunkAt = started;
    const gaps = [];
    let text = "";
    let chunks = 0;
    const emptyDiagnostics = () => ({
        timeToFirstTokenMs: firstTokenAt ? firstTokenAt - started : 0,
        totalMs: Date.now() - started,
        chunks,
        characters: text.length,
        interTokenMs: (0, assertions_1.percentiles)(gaps),
        charactersPerSecond: text.length ? Math.round((text.length / Math.max(1, Date.now() - started)) * 1000) : 0
    });
    try {
        const response = await (0, axios_1.default)({
            method: request.method,
            url: request.url,
            headers: { ...request.headers, Accept: "text/event-stream" },
            data: request.body,
            responseType: "stream",
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            validateStatus: () => true,
            ...(cancelToken ? { cancelToken: cancelToken.token } : {})
        });
        if (response.status >= 400) {
            // The body is a stream; collect it so the error is useful.
            const body = await new Promise(resolve => {
                let buffer = "";
                response.data.on("data", (chunk) => (buffer += chunk.toString("utf8")));
                response.data.on("end", () => resolve(buffer));
                response.data.on("error", () => resolve(buffer));
            });
            const error = `HTTP ${response.status}: ${body.slice(0, 400)}`;
            onEvent({ type: "error", error });
            return { text: "", diagnostics: emptyDiagnostics(), error };
        }
        await new Promise((resolve, reject) => {
            let buffer = "";
            response.data.on("data", (chunk) => {
                buffer += chunk.toString("utf8");
                // Providers frame events with a blank line (SSE) or a newline (Ollama).
                const parts = buffer.split(/\r?\n/);
                buffer = parts.pop() ?? "";
                for (const part of parts) {
                    const { text: delta, done } = (0, llm_providers_1.parseStreamChunk)(options.provider, part);
                    if (delta) {
                        const now = Date.now();
                        if (!firstTokenAt)
                            firstTokenAt = now;
                        else
                            gaps.push(now - lastChunkAt);
                        lastChunkAt = now;
                        chunks++;
                        text += delta;
                        onEvent({ type: "delta", text: delta, atMs: now - started });
                    }
                    if (done)
                        resolve();
                }
            });
            response.data.on("end", () => resolve());
            response.data.on("error", (error) => reject(error));
        });
        const diagnostics = emptyDiagnostics();
        onEvent({ type: "done", atMs: diagnostics.totalMs });
        return { text, diagnostics };
    }
    catch (error) {
        const message = errorMessage(error);
        onEvent({ type: "error", error: message });
        return { text, diagnostics: emptyDiagnostics(), error: message };
    }
}
exports.streamChat = streamChat;
/** Runs one prompt against several models concurrently. */
async function compareModels(targets, messages, shared = {}) {
    if (!targets.length)
        throw new Error("Add at least one model to compare.");
    const rows = await Promise.all(targets.map(async (target) => {
        const result = await callChat({
            provider: target.provider,
            model: target.model,
            apiKey: target.apiKey,
            baseUrl: target.baseUrl,
            apiVersion: target.apiVersion,
            messages,
            temperature: shared.temperature,
            maxTokens: shared.maxTokens,
            timeoutMs: shared.timeoutMs
        });
        return {
            label: target.label || `${target.provider}/${target.model}`,
            provider: target.provider,
            model: target.model,
            ok: result.ok,
            text: result.parsed.text,
            latencyMs: result.latencyMs,
            promptTokens: result.parsed.usage.promptTokens,
            completionTokens: result.parsed.usage.completionTokens,
            costUsd: result.costUsd,
            costKnown: result.costKnown,
            error: result.error
        };
    }));
    const successful = rows.filter(row => row.ok);
    const fastest = successful.slice().sort((a, b) => a.latencyMs - b.latencyMs)[0]?.label;
    const priced = successful.filter(row => row.costKnown);
    const cheapest = priced.slice().sort((a, b) => a.costUsd - b.costUsd)[0]?.label;
    return { rows, fastest, cheapest };
}
exports.compareModels = compareModels;
/** Repeats a prompt to measure latency distribution and throughput. */
async function benchmarkModel(options, runs, concurrency = 1) {
    const total = Math.max(1, Math.min(runs, 50));
    const parallel = Math.max(1, Math.min(concurrency, 10));
    const latencies = [];
    const errors = [];
    let successes = 0;
    let completionTokens = 0;
    let totalCost = 0;
    let costKnown = true;
    let elapsed = 0;
    const startedAll = Date.now();
    for (let index = 0; index < total; index += parallel) {
        const batch = Math.min(parallel, total - index);
        const results = await Promise.all(Array.from({ length: batch }, () => callChat(options)));
        for (const result of results) {
            if (result.ok) {
                successes++;
                latencies.push(result.latencyMs);
                completionTokens += result.parsed.usage.completionTokens ?? 0;
                totalCost += result.costUsd;
                if (!result.costKnown)
                    costKnown = false;
            }
            else if (result.error) {
                errors.push(result.error);
            }
        }
    }
    elapsed = Date.now() - startedAll;
    return {
        runs: total,
        successes,
        failures: total - successes,
        latency: (0, assertions_1.percentiles)(latencies),
        tokensPerSecond: elapsed > 0 ? Math.round((completionTokens / elapsed) * 1000 * 10) / 10 : 0,
        totalCostUsd: totalCost,
        costKnown,
        errors: [...new Set(errors)].slice(0, 5)
    };
}
exports.benchmarkModel = benchmarkModel;
async function testEmbeddings(options) {
    const inputs = options.input.filter(entry => entry.trim());
    if (!inputs.length)
        throw new Error("Provide at least one input to embed.");
    const request = (0, llm_providers_1.buildEmbeddingsRequest)({ ...options, input: inputs });
    const started = Date.now();
    try {
        const response = await (0, axios_1.default)({
            method: request.method,
            url: request.url,
            headers: request.headers,
            data: request.body,
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            validateStatus: () => true
        });
        const latencyMs = Date.now() - started;
        if (response.status >= 400) {
            return {
                ok: false,
                dimensions: 0,
                count: 0,
                latencyMs,
                similarities: [],
                preview: [],
                error: `HTTP ${response.status}: ${JSON.stringify(response.data ?? {}).slice(0, 300)}`
            };
        }
        const vectors = (0, llm_providers_1.parseEmbeddingsResponse)(options.provider, response.data);
        if (!vectors.length) {
            return {
                ok: false,
                dimensions: 0,
                count: 0,
                latencyMs,
                similarities: [],
                preview: [],
                error: "The response did not contain any embedding vectors."
            };
        }
        const similarities = [];
        for (let i = 0; i < vectors.length; i++) {
            for (let j = i + 1; j < vectors.length; j++) {
                similarities.push({ a: i, b: j, score: Math.round((0, llm_providers_1.cosineSimilarity)(vectors[i], vectors[j]) * 10000) / 10000 });
            }
        }
        return {
            ok: true,
            dimensions: vectors[0].length,
            count: vectors.length,
            latencyMs,
            similarities,
            preview: vectors[0].slice(0, 8).map(value => Math.round(value * 10000) / 10000)
        };
    }
    catch (error) {
        return {
            ok: false,
            dimensions: 0,
            count: 0,
            latencyMs: Date.now() - started,
            similarities: [],
            preview: [],
            error: errorMessage(error)
        };
    }
}
exports.testEmbeddings = testEmbeddings;
/** Queries a vector database, embedding the query text first when needed. */
async function searchVectors(options) {
    const started = Date.now();
    try {
        let vector = options.vector;
        if (!vector?.length) {
            if (!options.queryText?.trim())
                throw new Error("Provide a query vector or query text to embed.");
            if (!options.embedding)
                throw new Error("Choose an embedding model so the query text can be vectorised.");
            const embedded = await testEmbeddings({
                provider: options.embedding.provider,
                model: options.embedding.model,
                apiKey: options.embedding.apiKey,
                baseUrl: options.embedding.baseUrl,
                input: [options.queryText],
                timeoutMs: options.timeoutMs
            });
            if (!embedded.ok)
                throw new Error(embedded.error || "Could not embed the query text.");
            // testEmbeddings only returns a preview, so fetch the full vector here.
            const request = (0, llm_providers_1.buildEmbeddingsRequest)({
                provider: options.embedding.provider,
                model: options.embedding.model,
                apiKey: options.embedding.apiKey,
                baseUrl: options.embedding.baseUrl,
                input: [options.queryText]
            });
            const response = await (0, axios_1.default)({
                method: request.method,
                url: request.url,
                headers: request.headers,
                data: request.body,
                timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
                validateStatus: () => true
            });
            vector = (0, llm_providers_1.parseEmbeddingsResponse)(options.embedding.provider, response.data)[0];
            if (!vector?.length)
                throw new Error("The embedding provider returned no vector for the query text.");
        }
        const request = (0, vector_db_1.buildVectorQuery)({
            db: options.db,
            baseUrl: options.baseUrl,
            collection: options.collection,
            vector,
            topK: options.topK,
            apiKey: options.apiKey
        });
        const response = await (0, axios_1.default)({
            method: request.method,
            url: request.url,
            headers: request.headers,
            data: request.body,
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            validateStatus: () => true
        });
        const latencyMs = Date.now() - started;
        if (response.status >= 400) {
            return {
                ok: false,
                matches: [],
                latencyMs,
                error: `HTTP ${response.status}: ${JSON.stringify(response.data ?? {}).slice(0, 300)}`
            };
        }
        return { ok: true, matches: (0, vector_db_1.parseVectorResponse)(options.db, response.data), latencyMs };
    }
    catch (error) {
        return { ok: false, matches: [], latencyMs: Date.now() - started, error: errorMessage(error) };
    }
}
exports.searchVectors = searchVectors;
/** Retrieves context, generates an answer with it, and scores the grounding. */
async function testRagPipeline(options) {
    if (!options.question.trim())
        throw new Error("Enter a question for the pipeline to answer.");
    const retrieval = await searchVectors({ ...options.retrieval, queryText: options.retrieval.queryText || options.question });
    if (!retrieval.ok) {
        return {
            ok: false,
            matches: [],
            answer: "",
            grounding: { score: 0, supported: 0, total: 0 },
            retrievalMs: retrieval.latencyMs,
            generationMs: 0,
            contextTokens: 0,
            costUsd: 0,
            error: `Retrieval failed - ${retrieval.error}`
        };
    }
    const context = retrieval.matches
        .map((match, index) => `[${index + 1}] ${match.text}`)
        .filter(entry => entry.trim().length > 4)
        .join("\n\n");
    const template = options.promptTemplate ||
        "Answer the question using only the context below. If the context does not contain the answer, say so.\n\nContext:\n{{context}}\n\nQuestion: {{question}}";
    const prompt = template.replace(/\{\{context\}\}/g, context).replace(/\{\{question\}\}/g, options.question);
    const generation = await callChat({
        ...options.generation,
        messages: [...(options.generation.messages ?? []), { role: "user", content: prompt }]
    });
    if (!generation.ok) {
        return {
            ok: false,
            matches: retrieval.matches,
            answer: "",
            grounding: { score: 0, supported: 0, total: 0 },
            retrievalMs: retrieval.latencyMs,
            generationMs: generation.latencyMs,
            contextTokens: (0, llm_providers_1.estimateTokens)(context),
            costUsd: 0,
            error: `Generation failed - ${generation.error}`
        };
    }
    return {
        ok: true,
        matches: retrieval.matches,
        answer: generation.parsed.text,
        grounding: (0, vector_db_1.groundingScore)(generation.parsed.text, context),
        retrievalMs: retrieval.latencyMs,
        generationMs: generation.latencyMs,
        contextTokens: (0, llm_providers_1.estimateTokens)(context),
        costUsd: generation.costUsd
    };
}
exports.testRagPipeline = testRagPipeline;
/**
 * Drives a tool-calling loop.
 *
 * Tool results come from a caller-supplied table of canned responses, so the
 * agent's decision-making can be tested without the extension executing
 * anything the model asks for.
 */
async function testAgent(options) {
    const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 5, 10));
    const messages = [...options.base.messages];
    const turns = [];
    let totalCost = 0;
    let totalLatency = 0;
    for (let turn = 1; turn <= maxTurns; turn++) {
        const result = await callChat({ ...options.base, messages, tools: options.tools });
        totalLatency += result.latencyMs;
        totalCost += result.costUsd;
        if (!result.ok) {
            return {
                ok: false,
                turns,
                finalAnswer: "",
                totalLatencyMs: totalLatency,
                totalCostUsd: totalCost,
                stoppedBecause: "error",
                error: result.error
            };
        }
        const calls = result.parsed.toolCalls;
        const record = {
            turn,
            assistantText: result.parsed.text,
            toolCalls: [],
            latencyMs: result.latencyMs
        };
        if (!calls.length) {
            turns.push(record);
            return {
                ok: true,
                turns,
                finalAnswer: result.parsed.text,
                totalLatencyMs: totalLatency,
                totalCostUsd: totalCost,
                stoppedBecause: "answered"
            };
        }
        messages.push({ role: "assistant", content: result.parsed.text || "" });
        for (const call of calls) {
            const response = options.toolResponses[call.name] ?? `{"error":"No canned response configured for tool \\"${call.name}\\""}`;
            record.toolCalls.push({ name: call.name, arguments: call.arguments, result: response });
            messages.push({ role: "tool", content: response, toolCallId: call.id, name: call.name });
        }
        turns.push(record);
    }
    return {
        ok: true,
        turns,
        finalAnswer: turns[turns.length - 1]?.assistantText ?? "",
        totalLatencyMs: totalLatency,
        totalCostUsd: totalCost,
        stoppedBecause: "max-turns"
    };
}
exports.testAgent = testAgent;
/** Scores a model reply against declarative criteria. */
function scoreAgainstCriteria(text, criteria) {
    const checks = [];
    const lower = text.toLowerCase();
    for (const phrase of criteria.mustInclude ?? []) {
        checks.push({ name: `includes "${phrase}"`, passed: lower.includes(phrase.toLowerCase()) });
    }
    for (const phrase of criteria.mustNotInclude ?? []) {
        checks.push({ name: `excludes "${phrase}"`, passed: !lower.includes(phrase.toLowerCase()) });
    }
    if (criteria.pattern) {
        try {
            checks.push({ name: `matches /${criteria.pattern}/`, passed: new RegExp(criteria.pattern).test(text) });
        }
        catch (error) {
            checks.push({
                name: "pattern",
                passed: false,
                detail: `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    if (criteria.minWords !== undefined) {
        checks.push({ name: `at least ${criteria.minWords} words`, passed: words >= criteria.minWords, detail: `${words} words` });
    }
    if (criteria.maxWords !== undefined) {
        checks.push({ name: `at most ${criteria.maxWords} words`, passed: words <= criteria.maxWords, detail: `${words} words` });
    }
    if (criteria.jsonSchema) {
        const parsed = (0, json_tools_1.extractJson)(text);
        if (!parsed.ok) {
            checks.push({ name: "valid JSON", passed: false, detail: parsed.error });
        }
        else {
            const violations = (0, json_tools_1.validateSchema)(parsed.value, criteria.jsonSchema);
            checks.push({
                name: "matches JSON schema",
                passed: violations.length === 0,
                detail: violations.length ? violations.slice(0, 3).map(v => `${v.path} ${v.message}`).join("; ") : undefined
            });
        }
    }
    return checks;
}
exports.scoreAgainstCriteria = scoreAgainstCriteria;
/** Runs prompt variants against one model and scores each reply. */
async function evaluatePrompts(options) {
    if (!options.variants.length)
        throw new Error("Add at least one prompt variant to evaluate.");
    const rows = await Promise.all(options.variants.map(async (variant) => {
        const messages = [];
        if (variant.system)
            messages.push({ role: "system", content: variant.system });
        messages.push({ role: "user", content: variant.user });
        const result = await callChat({ ...options.base, messages });
        if (!result.ok) {
            return {
                label: variant.label,
                ok: false,
                text: "",
                score: 0,
                maxScore: 0,
                checks: [],
                latencyMs: result.latencyMs,
                costUsd: 0,
                error: result.error
            };
        }
        const checks = scoreAgainstCriteria(result.parsed.text, options.criteria);
        return {
            label: variant.label,
            ok: true,
            text: result.parsed.text,
            score: checks.filter(check => check.passed).length,
            maxScore: checks.length,
            checks,
            latencyMs: result.latencyMs,
            costUsd: result.costUsd
        };
    }));
    const best = rows
        .filter(row => row.ok && row.maxScore > 0)
        .sort((a, b) => b.score / b.maxScore - a.score / a.maxScore || a.latencyMs - b.latencyMs)[0]?.label;
    return { rows, best };
}
exports.evaluatePrompts = evaluatePrompts;
//# sourceMappingURL=ai-operations.js.map