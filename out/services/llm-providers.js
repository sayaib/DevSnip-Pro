"use strict";
/**
 * Provider adapters for the AI/ML side of the REST API Client.
 *
 * Each provider differs in endpoint shape, auth header, message format and
 * where the reply and token usage live in the response. Encoding that once
 * here means every AI feature - single request, streaming, comparison,
 * benchmarking, RAG, agents - shares one correct implementation instead of
 * re-deriving request shapes per tool.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = exports.estimateCost = exports.MODEL_PRICING = exports.cosineSimilarity = exports.parseEmbeddingsResponse = exports.buildEmbeddingsRequest = exports.parseStreamChunk = exports.parseChatResponse = exports.buildChatRequest = exports.getProvider = exports.PROVIDERS = void 0;
exports.PROVIDERS = [
    {
        id: "openai",
        label: "OpenAI",
        defaultBaseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o-mini",
        requiresKey: true,
        models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
        docsUrl: "https://platform.openai.com/docs/api-reference/chat"
    },
    {
        id: "anthropic",
        label: "Anthropic",
        defaultBaseUrl: "https://api.anthropic.com/v1",
        defaultModel: "claude-sonnet-4-5",
        requiresKey: true,
        models: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"],
        docsUrl: "https://docs.anthropic.com/en/api/messages"
    },
    {
        id: "gemini",
        label: "Google Gemini",
        defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
        defaultModel: "gemini-2.0-flash",
        requiresKey: true,
        models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"],
        docsUrl: "https://ai.google.dev/api/generate-content"
    },
    {
        id: "azure-openai",
        label: "Azure OpenAI",
        defaultBaseUrl: "https://<resource>.openai.azure.com",
        defaultModel: "<deployment-name>",
        requiresKey: true,
        models: [],
        docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/reference"
    },
    {
        id: "ollama",
        label: "Ollama (local)",
        defaultBaseUrl: "http://127.0.0.1:11434",
        defaultModel: "llama3.2",
        requiresKey: false,
        models: ["llama3.2", "llama3.1", "qwen2.5", "mistral", "phi4"],
        docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md"
    },
    {
        id: "custom",
        label: "Custom (OpenAI-compatible)",
        defaultBaseUrl: "http://localhost:8000/v1",
        defaultModel: "local-model",
        requiresKey: false,
        models: [],
        docsUrl: "https://platform.openai.com/docs/api-reference/chat"
    }
];
function getProvider(id) {
    const provider = exports.PROVIDERS.find(entry => entry.id === id);
    if (!provider)
        throw new Error(`Unknown AI provider "${id}".`);
    return provider;
}
exports.getProvider = getProvider;
function trimBase(url) {
    return url.replace(/\/+$/, "");
}
function splitSystem(messages) {
    const system = messages
        .filter(message => message.role === "system")
        .map(message => message.content)
        .join("\n\n");
    return { system, rest: messages.filter(message => message.role !== "system") };
}
/**
 * Builds the HTTP request for a chat completion.
 *
 * Kept separate from sending so the same builder powers the live call, the
 * cURL export and the request preview shown in the UI.
 */
function buildChatRequest(options) {
    const provider = getProvider(options.provider);
    const base = trimBase(options.baseUrl || provider.defaultBaseUrl);
    const model = options.model || provider.defaultModel;
    if (options.provider === "anthropic") {
        const { system, rest } = splitSystem(options.messages);
        const body = {
            model,
            max_tokens: options.maxTokens ?? 1024,
            messages: rest.map(message => ({
                role: message.role === "assistant" ? "assistant" : "user",
                content: message.content
            }))
        };
        if (system)
            body.system = system;
        if (options.temperature !== undefined)
            body.temperature = options.temperature;
        if (options.stream)
            body.stream = true;
        if (options.tools?.length) {
            body.tools = options.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters
            }));
        }
        return {
            url: `${base}/messages`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                ...(options.apiKey ? { "x-api-key": options.apiKey } : {})
            },
            body
        };
    }
    if (options.provider === "gemini") {
        const { system, rest } = splitSystem(options.messages);
        const body = {
            contents: rest.map(message => ({
                role: message.role === "assistant" ? "model" : "user",
                parts: [{ text: message.content }]
            })),
            generationConfig: {
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
                ...(options.jsonMode ? { responseMimeType: "application/json" } : {})
            }
        };
        if (system)
            body.systemInstruction = { parts: [{ text: system }] };
        const action = options.stream ? "streamGenerateContent" : "generateContent";
        // Gemini takes the key as a header; it also accepts ?key= but that would
        // put the credential in a URL that gets logged and stored.
        return {
            url: `${base}/models/${encodeURIComponent(model)}:${action}${options.stream ? "?alt=sse" : ""}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(options.apiKey ? { "x-goog-api-key": options.apiKey } : {})
            },
            body
        };
    }
    if (options.provider === "ollama") {
        const body = {
            model,
            messages: options.messages.map(message => ({ role: message.role, content: message.content })),
            stream: Boolean(options.stream),
            options: {
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.maxTokens ? { num_predict: options.maxTokens } : {})
            }
        };
        if (options.jsonMode)
            body.format = "json";
        return {
            url: `${base}/api/chat`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body
        };
    }
    // OpenAI, Azure OpenAI and any OpenAI-compatible endpoint.
    const body = {
        messages: options.messages.map(message => message.role === "tool"
            ? { role: "tool", content: message.content, tool_call_id: message.toolCallId }
            : { role: message.role, content: message.content }),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
        ...(options.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        ...(options.jsonMode ? { response_format: { type: "json_object" } } : {})
    };
    if (options.tools?.length) {
        body.tools = options.tools.map(tool => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        }));
    }
    if (options.provider === "azure-openai") {
        const version = options.apiVersion || "2024-10-21";
        return {
            url: `${base}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(version)}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(options.apiKey ? { "api-key": options.apiKey } : {})
            },
            body
        };
    }
    body.model = model;
    return {
        url: `${base}/chat/completions`,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
        },
        body
    };
}
exports.buildChatRequest = buildChatRequest;
function asRecord(value) {
    return value && typeof value === "object" ? value : undefined;
}
/** Extracts the reply text, usage and tool calls from any supported provider. */
function parseChatResponse(provider, payload) {
    const data = asRecord(payload);
    const empty = { text: "", usage: {}, toolCalls: [], unrecognised: true };
    if (!data)
        return empty;
    if (provider === "anthropic") {
        const blocks = Array.isArray(data.content) ? data.content : [];
        const text = blocks
            .filter((block) => block?.type === "text")
            .map((block) => String(block.text ?? ""))
            .join("");
        const toolCalls = blocks
            .filter((block) => block?.type === "tool_use")
            .map((block) => ({
            id: String(block.id ?? ""),
            name: String(block.name ?? ""),
            arguments: JSON.stringify(block.input ?? {})
        }));
        const usage = asRecord(data.usage) ?? {};
        return {
            text,
            toolCalls,
            model: data.model,
            finishReason: data.stop_reason,
            usage: {
                promptTokens: usage.input_tokens,
                completionTokens: usage.output_tokens,
                totalTokens: usage.input_tokens !== undefined && usage.output_tokens !== undefined
                    ? usage.input_tokens + usage.output_tokens
                    : undefined
            },
            unrecognised: !blocks.length && !data.model
        };
    }
    if (provider === "gemini") {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const parts = candidates[0]?.content?.parts ?? [];
        const text = parts.map((part) => String(part?.text ?? "")).join("");
        const toolCalls = parts
            .filter((part) => part?.functionCall)
            .map((part, index) => ({
            id: `gemini-call-${index}`,
            name: String(part.functionCall.name ?? ""),
            arguments: JSON.stringify(part.functionCall.args ?? {})
        }));
        const usage = asRecord(data.usageMetadata) ?? {};
        return {
            text,
            toolCalls,
            model: data.modelVersion,
            finishReason: candidates[0]?.finishReason,
            usage: {
                promptTokens: usage.promptTokenCount,
                completionTokens: usage.candidatesTokenCount,
                totalTokens: usage.totalTokenCount
            },
            unrecognised: !candidates.length
        };
    }
    if (provider === "ollama") {
        const message = asRecord(data.message);
        return {
            text: String(message?.content ?? ""),
            toolCalls: [],
            model: data.model,
            finishReason: data.done_reason,
            usage: {
                promptTokens: data.prompt_eval_count,
                completionTokens: data.eval_count,
                totalTokens: data.prompt_eval_count !== undefined && data.eval_count !== undefined
                    ? data.prompt_eval_count + data.eval_count
                    : undefined
            },
            unrecognised: !message && !data.model
        };
    }
    const choices = Array.isArray(data.choices) ? data.choices : [];
    const message = asRecord(choices[0]?.message);
    const toolCalls = Array.isArray(message?.tool_calls)
        ? message.tool_calls.map((call) => ({
            id: String(call?.id ?? ""),
            name: String(call?.function?.name ?? ""),
            arguments: String(call?.function?.arguments ?? "{}")
        }))
        : [];
    const usage = asRecord(data.usage) ?? {};
    return {
        text: String(message?.content ?? ""),
        toolCalls,
        model: data.model,
        finishReason: choices[0]?.finish_reason,
        usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens
        },
        unrecognised: !choices.length
    };
}
exports.parseChatResponse = parseChatResponse;
/**
 * Pulls the incremental text out of one streaming chunk.
 * Returns an empty string for keep-alives and metadata frames.
 */
function parseStreamChunk(provider, raw) {
    const line = raw.trim();
    if (!line)
        return { text: "", done: false };
    if (provider === "ollama") {
        // Ollama streams newline-delimited JSON rather than SSE.
        try {
            const data = JSON.parse(line);
            return {
                text: String(data?.message?.content ?? ""),
                done: Boolean(data?.done),
                usage: data?.done
                    ? { promptTokens: data.prompt_eval_count, completionTokens: data.eval_count }
                    : undefined
            };
        }
        catch {
            return { text: "", done: false };
        }
    }
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload || payload === "[DONE]")
        return { text: "", done: payload === "[DONE]" };
    let data;
    try {
        data = JSON.parse(payload);
    }
    catch {
        return { text: "", done: false };
    }
    if (provider === "anthropic") {
        if (data.type === "content_block_delta")
            return { text: String(data.delta?.text ?? ""), done: false };
        if (data.type === "message_delta") {
            return { text: "", done: false, usage: { completionTokens: data.usage?.output_tokens } };
        }
        if (data.type === "message_stop")
            return { text: "", done: true };
        return { text: "", done: false };
    }
    if (provider === "gemini") {
        const parts = data.candidates?.[0]?.content?.parts ?? [];
        return {
            text: parts.map((part) => String(part?.text ?? "")).join(""),
            done: Boolean(data.candidates?.[0]?.finishReason),
            usage: data.usageMetadata
                ? { promptTokens: data.usageMetadata.promptTokenCount, completionTokens: data.usageMetadata.candidatesTokenCount }
                : undefined
        };
    }
    const delta = data.choices?.[0]?.delta;
    return {
        text: String(delta?.content ?? ""),
        done: Boolean(data.choices?.[0]?.finish_reason),
        usage: data.usage
            ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
            : undefined
    };
}
exports.parseStreamChunk = parseStreamChunk;
/** Builds the embeddings request for the providers that offer one. */
function buildEmbeddingsRequest(options) {
    const provider = getProvider(options.provider);
    const base = trimBase(options.baseUrl || provider.defaultBaseUrl);
    if (options.provider === "ollama") {
        return {
            url: `${base}/api/embed`,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: { model: options.model, input: options.input }
        };
    }
    if (options.provider === "gemini") {
        return {
            url: `${base}/models/${encodeURIComponent(options.model)}:batchEmbedContents`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(options.apiKey ? { "x-goog-api-key": options.apiKey } : {})
            },
            body: {
                requests: options.input.map(text => ({
                    model: `models/${options.model}`,
                    content: { parts: [{ text }] }
                }))
            }
        };
    }
    if (options.provider === "azure-openai") {
        const version = options.apiVersion || "2024-10-21";
        return {
            url: `${base}/openai/deployments/${encodeURIComponent(options.model)}/embeddings?api-version=${encodeURIComponent(version)}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(options.apiKey ? { "api-key": options.apiKey } : {})
            },
            body: { input: options.input }
        };
    }
    if (options.provider === "anthropic") {
        throw new Error("Anthropic does not expose an embeddings endpoint. Use OpenAI, Gemini, Azure, Ollama or a custom endpoint.");
    }
    return {
        url: `${base}/embeddings`,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
        },
        body: { model: options.model, input: options.input }
    };
}
exports.buildEmbeddingsRequest = buildEmbeddingsRequest;
/** Normalises an embeddings response into plain vectors. */
function parseEmbeddingsResponse(provider, payload) {
    const data = asRecord(payload);
    if (!data)
        return [];
    if (provider === "ollama") {
        if (Array.isArray(data.embeddings))
            return data.embeddings;
        if (Array.isArray(data.embedding))
            return [data.embedding];
        return [];
    }
    if (provider === "gemini") {
        const embeddings = Array.isArray(data.embeddings) ? data.embeddings : [];
        return embeddings.map((entry) => (Array.isArray(entry?.values) ? entry.values : []));
    }
    const rows = Array.isArray(data.data) ? data.data : [];
    return rows
        .map((row) => (Array.isArray(row?.embedding) ? row.embedding : []))
        .filter((vector) => vector.length > 0);
}
exports.parseEmbeddingsResponse = parseEmbeddingsResponse;
function cosineSimilarity(a, b) {
    const length = Math.min(a.length, b.length);
    if (!length)
        return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < length; index++) {
        dot += a[index] * b[index];
        normA += a[index] * a[index];
        normB += b[index] * b[index];
    }
    if (!normA || !normB)
        return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
exports.cosineSimilarity = cosineSimilarity;
/**
 * Indicative prices in USD per million tokens. Used for estimates only, and
 * kept in one table so a price change is a single edit.
 */
exports.MODEL_PRICING = {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "o3-mini": { input: 1.1, output: 4.4 },
    "claude-opus-4-1": { input: 15, output: 75 },
    "claude-sonnet-4-5": { input: 3, output: 15 },
    "claude-haiku-4-5": { input: 1, output: 5 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    "gemini-2.0-pro": { input: 1.25, output: 5 },
    "gemini-1.5-pro": { input: 1.25, output: 5 },
    "text-embedding-3-small": { input: 0.02, output: 0 },
    "text-embedding-3-large": { input: 0.13, output: 0 }
};
function estimateCost(model, usage) {
    const pricing = exports.MODEL_PRICING[model];
    if (!pricing)
        return { usd: 0, known: false };
    const input = ((usage.promptTokens ?? 0) / 1000000) * pricing.input;
    const output = ((usage.completionTokens ?? 0) / 1000000) * pricing.output;
    return { usd: input + output, known: true };
}
exports.estimateCost = estimateCost;
/**
 * Rough token estimate for text, used before a request is sent.
 * Deliberately approximate: it is a budgeting aid, not a tokenizer.
 */
function estimateTokens(text) {
    if (!text)
        return 0;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const characters = text.length;
    // Blend the two common heuristics (~4 chars and ~0.75 words per token).
    return Math.max(1, Math.round((characters / 4 + words / 0.75) / 2));
}
exports.estimateTokens = estimateTokens;
//# sourceMappingURL=llm-providers.js.map