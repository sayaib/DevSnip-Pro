"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateTokens = exports.formatContext = exports.embeddingModelOptions = exports.chatModelOptions = exports.findEmbeddingModel = exports.findChatModel = exports.EMBEDDING_MODELS = exports.CHAT_MODEL_CATALOG = exports.PRICES_AS_OF = void 0;
const llm_providers_1 = require("../../services/llm-providers");
/**
 * Model facts used by the AI and RAG tools: context window, output limit and
 * price. Prices come from MODEL_PRICING (the table the REST client uses too),
 * so there is one place to update them.
 */
exports.PRICES_AS_OF = "2025";
const CHAT_MODELS = [
    { id: "gpt-5", provider: "OpenAI", label: "GPT-5", contextWindow: 400000, maxOutput: 128000, notes: "Reasoning model; reasoning tokens are billed as output." },
    { id: "gpt-5-mini", provider: "OpenAI", label: "GPT-5 mini", contextWindow: 400000, maxOutput: 128000 },
    { id: "gpt-5-nano", provider: "OpenAI", label: "GPT-5 nano", contextWindow: 400000, maxOutput: 128000 },
    { id: "gpt-4.1", provider: "OpenAI", label: "GPT-4.1", contextWindow: 1047576, maxOutput: 32768 },
    { id: "gpt-4.1-mini", provider: "OpenAI", label: "GPT-4.1 mini", contextWindow: 1047576, maxOutput: 32768 },
    { id: "gpt-4o", provider: "OpenAI", label: "GPT-4o", contextWindow: 128000, maxOutput: 16384 },
    { id: "gpt-4o-mini", provider: "OpenAI", label: "GPT-4o mini", contextWindow: 128000, maxOutput: 16384 },
    { id: "o3-mini", provider: "OpenAI", label: "o3-mini", contextWindow: 200000, maxOutput: 100000, notes: "Reasoning tokens are billed as output." },
    { id: "claude-opus-4-5", provider: "Anthropic", label: "Claude Opus 4.5", contextWindow: 200000, maxOutput: 64000 },
    { id: "claude-opus-4-1", provider: "Anthropic", label: "Claude Opus 4.1", contextWindow: 200000, maxOutput: 32000 },
    { id: "claude-sonnet-4-5", provider: "Anthropic", label: "Claude Sonnet 4.5", contextWindow: 200000, maxOutput: 64000 },
    { id: "claude-haiku-4-5", provider: "Anthropic", label: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 64000 },
    { id: "gemini-2.5-pro", provider: "Google", label: "Gemini 2.5 Pro", contextWindow: 1048576, maxOutput: 65536, notes: "Higher price above 200K prompt tokens." },
    { id: "gemini-2.5-flash", provider: "Google", label: "Gemini 2.5 Flash", contextWindow: 1048576, maxOutput: 65536 },
    { id: "gemini-2.0-flash", provider: "Google", label: "Gemini 2.0 Flash", contextWindow: 1048576, maxOutput: 8192 },
    { id: "llama-3.1-8b", provider: "Open weights", label: "Llama 3.1 8B (self-hosted)", contextWindow: 131072, maxOutput: 131072, notes: "Cost is your hardware, not tokens." },
    { id: "llama-3.3-70b", provider: "Open weights", label: "Llama 3.3 70B (self-hosted)", contextWindow: 131072, maxOutput: 131072, notes: "Cost is your hardware, not tokens." },
    { id: "qwen2.5-7b", provider: "Open weights", label: "Qwen2.5 7B (self-hosted)", contextWindow: 131072, maxOutput: 8192, notes: "Cost is your hardware, not tokens." }
];
exports.CHAT_MODEL_CATALOG = CHAT_MODELS.map(model => ({
    ...model,
    input: llm_providers_1.MODEL_PRICING[model.id]?.input,
    output: llm_providers_1.MODEL_PRICING[model.id]?.output
}));
exports.EMBEDDING_MODELS = [
    { id: "text-embedding-3-small", provider: "OpenAI", label: "OpenAI text-embedding-3-small", dimensions: 1536, maxInputTokens: 8191, price: llm_providers_1.MODEL_PRICING["text-embedding-3-small"]?.input, normalized: true, notes: "Supports shortening with the dimensions parameter." },
    { id: "text-embedding-3-large", provider: "OpenAI", label: "OpenAI text-embedding-3-large", dimensions: 3072, maxInputTokens: 8191, price: llm_providers_1.MODEL_PRICING["text-embedding-3-large"]?.input, normalized: true, notes: "Supports shortening with the dimensions parameter." },
    { id: "embed-v4.0", provider: "Cohere", label: "Cohere embed-v4.0", dimensions: 1536, maxInputTokens: 128000, price: 0.12, normalized: true, notes: "Set input_type to search_document / search_query." },
    { id: "gemini-embedding-001", provider: "Google", label: "Google gemini-embedding-001", dimensions: 3072, maxInputTokens: 2048, price: 0.15, normalized: false, notes: "Normalise vectors yourself when using fewer dimensions." },
    { id: "voyage-3.5", provider: "Voyage AI", label: "Voyage voyage-3.5", dimensions: 1024, maxInputTokens: 32000, price: 0.06, normalized: true },
    { id: "nomic-embed-text", provider: "Open weights", label: "nomic-embed-text (Ollama)", dimensions: 768, maxInputTokens: 8192, normalized: false, notes: "Local via Ollama; prefix inputs with search_document: / search_query:." },
    { id: "bge-m3", provider: "Open weights", label: "BAAI bge-m3 (self-hosted)", dimensions: 1024, maxInputTokens: 8192, normalized: true },
    { id: "all-MiniLM-L6-v2", provider: "Open weights", label: "all-MiniLM-L6-v2 (sentence-transformers)", dimensions: 384, maxInputTokens: 256, normalized: true, notes: "Fast and small; inputs over 256 word pieces are truncated." }
];
function findChatModel(id) {
    return exports.CHAT_MODEL_CATALOG.find(model => model.id === id);
}
exports.findChatModel = findChatModel;
function findEmbeddingModel(id) {
    return exports.EMBEDDING_MODELS.find(model => model.id === id);
}
exports.findEmbeddingModel = findEmbeddingModel;
function chatModelOptions() {
    return exports.CHAT_MODEL_CATALOG.map(model => ({ value: model.id, label: `${model.label} - ${formatContext(model.contextWindow)} context` }));
}
exports.chatModelOptions = chatModelOptions;
function embeddingModelOptions() {
    return exports.EMBEDDING_MODELS.map(model => ({ value: model.id, label: `${model.label} (${model.dimensions} dims)` }));
}
exports.embeddingModelOptions = embeddingModelOptions;
function formatContext(tokens) {
    if (tokens >= 1000000)
        return `${(tokens / 1000000).toFixed(tokens % 1000000 ? 1 : 0)}M`;
    return `${Math.round(tokens / 1000)}K`;
}
exports.formatContext = formatContext;
/**
 * Token estimate that tracks real BPE tokenizers (cl100k/o200k style) far
 * better than characters / 4, especially for code, numbers and non-Latin text:
 *  - a common word is usually one token; long or rare words split every ~6 letters;
 *  - digits are grouped in threes;
 *  - punctuation and symbols are mostly one token each;
 *  - CJK characters are roughly one token each; other non-Latin scripts ~2 characters per token.
 * Typically within 10-15% for English prose and code. Exact counts need the
 * provider's tokenizer.
 */
function estimateTokens(text) {
    if (!text)
        return 0;
    let tokens = 0;
    const pieces = text.match(/ ?[A-Za-z]+|\d{1,3}|[぀-ヿ㐀-鿿가-힯]|[^\sA-Za-z\d぀-ヿ㐀-鿿가-힯]+|\s+/g) || [];
    for (const piece of pieces) {
        if (/^\s+$/.test(piece)) {
            // Runs of whitespace (indentation, blank lines) merge into few tokens.
            tokens += piece.includes("\n") ? Math.ceil(piece.length / 8) : piece.length > 1 ? 1 : 0;
            continue;
        }
        const word = piece.trim();
        if (/^[A-Za-z]+$/.test(word))
            tokens += word.length <= 7 ? 1 : Math.ceil(word.length / 6);
        else if (/^\d+$/.test(word))
            tokens += 1;
        else if (/^[぀-ヿ㐀-鿿가-힯]$/.test(word))
            tokens += 1;
        else if (/^[\x21-\x7e]+$/.test(word))
            tokens += Math.max(1, Math.ceil(word.length / 2));
        else
            tokens += Math.max(1, Math.ceil(word.length / 2));
    }
    return Math.max(1, tokens);
}
exports.estimateTokens = estimateTokens;
//# sourceMappingURL=models.js.map