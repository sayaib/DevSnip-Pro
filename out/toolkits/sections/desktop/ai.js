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
exports.DESKTOP_AI_TOOLS = void 0;
const types_1 = require("../../types");
const helpers_1 = require("../helpers");
const TESTER_PROVIDERS = (0, helpers_1.opts)(["openai", "OpenAI"], ["anthropic", "Anthropic"], ["gemini", "Google Gemini"], ["azure-openai", "Azure OpenAI"], ["ollama", "Ollama (local)"], ["custom", "OpenAI-compatible"]);
const KEY_ENV = { openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "azure-openai": ["AZURE_OPENAI_API_KEY"], custom: ["LLM_API_KEY", "OPENAI_API_KEY"] };
const llmTester = {
    id: "ai.llm-tester",
    command: "llmApiTester",
    title: "LLM API Tester",
    summary: "Send one chat request to a provider and see the answer, latency, token usage and cost.",
    guide: "Leave the API key empty to use the matching environment variable of the VS Code process (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, AZURE_OPENAI_API_KEY). A key typed here is used for this request only: it is never saved or logged.",
    keywords: ["test api", "chat completion", "latency", "api key", "ping model"],
    icon: "api",
    network: true,
    runLabel: "Send request",
    fields: [
        helpers_1.f.select("provider", "Provider", TESTER_PROVIDERS),
        helpers_1.f.text("model", "Model", { width: "narrow", placeholder: "gpt-4.1-mini" }),
        helpers_1.f.text("baseUrl", "Base URL", { width: "narrow", placeholder: "Provider default", help: "Required for Azure (https://<resource>.openai.azure.com), Ollama and OpenAI-compatible servers." }),
        helpers_1.f.secret("apiKey", "API key", { width: "narrow", placeholder: "Empty = use environment variable" }),
        helpers_1.f.area("system", "System prompt", { rows: 2, default: "You are a concise assistant." }),
        helpers_1.f.area("user", "User message", { rows: 4, required: true, default: "Reply with the single word: pong" }),
        helpers_1.f.num("temperature", "Temperature", 0, { min: 0, max: 2, step: 0.1 }),
        helpers_1.f.num("maxTokens", "Max output tokens", 256, { min: 1, max: 32000 }),
        helpers_1.f.toggle("jsonMode", "JSON mode", false)
    ],
    async run(values) {
        const provider = (0, types_1.str)(values, "provider", "openai");
        const model = (0, types_1.str)(values, "model").trim();
        if (!model)
            throw new types_1.ToolInputError("Enter the model (or Azure deployment) name.");
        const user = (0, types_1.str)(values, "user").trim();
        if (!user)
            throw new types_1.ToolInputError("Write a user message.");
        const baseUrl = (0, types_1.str)(values, "baseUrl").trim() || (provider === "ollama" ? "http://localhost:11434/v1" : undefined);
        if ((provider === "azure-openai" || provider === "custom") && !baseUrl)
            throw new types_1.ToolInputError("This provider needs a base URL.");
        let apiKey = (0, types_1.str)(values, "apiKey").trim();
        let keySource = "entered";
        if (!apiKey && provider !== "ollama") {
            const name = (KEY_ENV[provider] ?? []).find(n => process.env[n]);
            if (!name)
                throw new types_1.ToolInputError(`No API key: enter one, or set ${(KEY_ENV[provider] ?? ["the key variable"]).join(" / ")} in the environment VS Code was started from.`);
            apiKey = process.env[name];
            keySource = name;
        }
        // Loaded on first use: keeps the HTTP client out of extension startup.
        const { callChat } = await Promise.resolve().then(() => __importStar(require("../../../services/ai-operations")));
        const result = await callChat({
            provider, model, apiKey, baseUrl,
            messages: [...((0, types_1.str)(values, "system").trim() ? [{ role: "system", content: (0, types_1.str)(values, "system") }] : []), { role: "user", content: user }],
            temperature: (0, types_1.num)(values, "temperature", 0, { min: 0, max: 2, label: "Temperature" }),
            maxTokens: (0, types_1.num)(values, "maxTokens", 256, { min: 1, max: 32000, integer: true, label: "Max output tokens" }),
            jsonMode: (0, types_1.bool)(values, "jsonMode"),
            apiVersion: provider === "azure-openai" ? "2024-10-21" : undefined,
            timeoutMs: 60000
        });
        const usage = result.parsed.usage;
        const stats = [
            { label: "Status", value: result.status ? String(result.status) : "no response", tone: result.ok ? "good" : "bad" },
            { label: "Latency", value: `${(0, types_1.fmtNumber)(result.latencyMs)} ms` },
            { label: "Tokens in / out", value: `${usage.promptTokens ?? "?"} / ${usage.completionTokens ?? "?"}` },
            { label: "Cost", value: result.costKnown ? (0, types_1.fmtUsd)(result.costUsd) : "unknown model price" }
        ];
        if (!result.ok)
            return { stats, messages: [{ kind: "error", text: result.error ?? "The request failed." }], outputs: result.raw !== undefined ? [(0, helpers_1.code)("Response body", "json", JSON.stringify(result.raw, null, 2))] : [] };
        return {
            stats,
            messages: [{ kind: "success", text: `Answered by ${model}. Key: ${keySource === "entered" ? "the key you entered (not saved)" : provider === "ollama" ? "none needed" : `from ${keySource}`}.` }],
            outputs: [(0, helpers_1.text)("Answer", result.parsed.text || "(empty response)"), (0, helpers_1.code)("Raw response", "json", JSON.stringify(result.raw, null, 2))]
        };
    }
};
exports.DESKTOP_AI_TOOLS = [llmTester];
//# sourceMappingURL=ai.js.map