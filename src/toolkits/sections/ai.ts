import { SectionInfo, ToolContext, ToolDefinition, ToolInputError, ToolResult, bool, fmtNumber, fmtUsd, num, str } from "../types";
import { CHAT_MODEL_CATALOG, PRICES_AS_OF, chatModelOptions, estimateTokens, findChatModel, formatContext } from "../engines/models";
import { PROMPT_TEMPLATES, PromptFormat, formatPrompt, lintPrompt, parseVariableValues, promptTokens, renderPrompt, templateVariables } from "../engines/prompts";
import { LLM_PROVIDER_OPTIONS, LlmProvider, generateLlmConfig } from "../engines/llm-config";
import { formatResponse, repairJson } from "../engines/llm-output";
import { ARCHITECTURES, GPUS, PRECISION_BYTES, Workload, estimateSpeed, estimateVram, gpusNeeded, suggestions } from "../engines/vram";
import { Schedule, classificationMetrics, experimentRecord, modelCard, parseClassCounts, regressionMetrics, scheduleCode, scheduleSeries, splitCode, splitDataset } from "../engines/ml-training";
import { AI_SNIPPETS } from "../engines/ai-snippets";
import { ToonDelimiter, encodeToon } from "../engines/toon";
import { scaffoldAiProject } from "../engines/ai-project";
import { validateSchema } from "../../services/json-tools";
import { code, f, opts, pct, table, text } from "./helpers";

export const AI_SECTION: SectionInfo = {
  id: "ai",
  title: "AI & ML",
  icon: "hubot",
  description: "Prompts, model costs, LLM client setup, output handling, GPU sizing and training helpers.",
  categories: ["Prompts", "Models & cost", "LLM output", "Embeddings", "Training & evaluation", "Code & projects"]
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

interface SavedPrompt { name: string; system: string; user: string }
const PROMPT_STORE = "toolkit.promptTemplates";

const savedPrompts = (ctx: ToolContext): SavedPrompt[] => ctx.storage?.get<SavedPrompt[]>(PROMPT_STORE, []) ?? [];

const promptBuilder: ToolDefinition = {
  id: "ai.prompt-builder",
  command: "promptTemplate",
  section: "ai",
  category: "Prompts",
  title: "Prompt Builder",
  summary: "Fill a prompt template, check it for common mistakes and export it as an API payload.",
  guide: "Use {{name}} placeholders in the system or user prompt, or {{name|default}} for a default. Fill them in Variables as name: value lines (a value may span several lines) or as a JSON object. Save your own templates to reuse them from the Presets menu.",
  keywords: ["template", "prompt engineering", "system prompt", "placeholder", "payload", "messages"],
  icon: "message",
  live: true,
  fields: [
    f.area("system", "System prompt", { rows: 4, placeholder: "Role, rules and output format" }),
    f.area("user", "User prompt", { rows: 7, required: true, placeholder: "Task with {{variables}}" }),
    f.area("variables", "Variables", { rows: 4, placeholder: "language: TypeScript\ncode: |paste here|", help: "name: value lines or a JSON object." }),
    f.select("format", "Export as", opts(["text", "Plain text / Markdown"], ["openai", "OpenAI messages JSON"], ["anthropic", "Anthropic messages JSON"], ["gemini", "Gemini contents JSON"])),
    f.select("model", "Model", chatModelOptions(), { default: "gpt-4.1-mini" }),
    f.text("saveName", "Template name (for saving)", { width: "narrow", placeholder: "My review prompt" })
  ],
  actions: [{ id: "save", label: "Save template" }, { id: "delete", label: "Delete saved template" }],
  examples: PROMPT_TEMPLATES.map(t => ({ label: `${t.category}: ${t.name}`, values: { system: t.system, user: t.user, variables: "", saveName: "" } })),
  dynamicExamples: ctx => savedPrompts(ctx).map(p => ({ label: `Saved: ${p.name}`, values: { system: p.system, user: p.user, saveName: p.name } })),
  async run(values, ctx, action) {
    const system = str(values, "system");
    const user = str(values, "user");
    if (action === "save" || action === "delete") {
      const name = str(values, "saveName").trim();
      if (!name) throw new ToolInputError("Enter a template name first.");
      if (!ctx.storage) throw new ToolInputError("Saving templates is not available here.");
      const others = savedPrompts(ctx).filter(p => p.name.toLowerCase() !== name.toLowerCase());
      if (action === "delete") {
        if (others.length === savedPrompts(ctx).length) throw new ToolInputError(`No saved template is named "${name}".`);
        await ctx.storage.set(PROMPT_STORE, others);
        return { messages: [{ kind: "success", text: `Deleted "${name}". It is no longer in the Presets menu.` }] };
      }
      if (!user.trim()) throw new ToolInputError("The user prompt is empty.");
      if (others.length >= 100) throw new ToolInputError("You have 100 saved templates; delete one first.");
      await ctx.storage.set(PROMPT_STORE, [...others, { name, system, user }].sort((a, b) => a.name.localeCompare(b.name)));
      return { messages: [{ kind: "success", text: `Saved "${name}". Find it under Presets (it stays on this machine).` }] };
    }
    if (!user.trim()) throw new ToolInputError("Write a user prompt, or pick one from Presets.");
    let vars: Record<string, string>;
    try { vars = parseVariableValues(str(values, "variables")); } catch (error) { throw new ToolInputError(`Variables: ${(error as Error).message}`); }
    const rendered = renderPrompt(system, user, vars);
    const variables = templateVariables(system, user);
    const model = str(values, "model", "gpt-4.1-mini");
    const out = formatPrompt(rendered, str(values, "format", "text") as PromptFormat, model);
    const tokens = promptTokens(rendered);
    const info = findChatModel(model);
    const messages: ToolResult["messages"] = [];
    if (rendered.missing.length) messages.push({ kind: "warning", text: `No value for: ${rendered.missing.join(", ")}. Add them under Variables.` });
    if (rendered.usedDefaults.length) messages.push({ kind: "info", text: `Used defaults for: ${rendered.usedDefaults.join(", ")}.` });
    for (const note of lintPrompt(rendered)) if (!(rendered.missing.length && /placeholders/.test(note))) messages.push({ kind: "info", text: note });
    return {
      stats: [
        { label: "Prompt tokens (est.)", value: fmtNumber(tokens) },
        { label: "Variables", value: `${variables.length - rendered.missing.length}/${variables.length}`, tone: rendered.missing.length ? "warn" : "good" },
        ...(info?.input !== undefined ? [{ label: `Input cost (${info.label})`, value: fmtUsd((tokens / 1e6) * info.input) }] : []),
        ...(info ? [{ label: "Context used", value: pct(tokens / info.contextWindow, 2) }] : [])
      ],
      messages,
      outputs: [code("Prompt", out.language, out.content)]
    };
  }
};

const toon: ToolDefinition = {
  id: "ai.toon",
  command: "jsonToToon",
  section: "ai",
  category: "Prompts",
  title: "JSON → TOON for Prompts",
  summary: "Shrink JSON you put in prompts: TOON writes arrays of records as a table with the field names once, often saving 30-60% of tokens with no loss of data.",
  guide: "TOON (Token-Oriented Object Notation) keeps JSON's data model: objects become indented key: value lines, arrays state their length (tags[3]: a,b,c), and lists of uniform objects become tables - users[2]{id,name}: followed by one row per record. Models read it reliably; tell them the format in the prompt (\"Data is in TOON format\"). Deeply nested or irregular data saves less.",
  keywords: ["toon", "token oriented object notation", "tokens", "compress", "prompt", "json", "llm context"],
  icon: "tree",
  live: true,
  fields: [
    f.code("json", "JSON", "json", { rows: 12, required: true, fromEditor: true, default: '{\n  "orders": [\n    { "id": 1001, "customer": "Ada", "total": 42.5, "status": "shipped" },\n    { "id": 1002, "customer": "Linus", "total": 18, "status": "pending" },\n    { "id": 1003, "customer": "Grace", "total": 99.99, "status": "shipped" }\n  ],\n  "page": { "number": 1, "hasMore": false }\n}' }),
    f.select("delimiter", "Delimiter", opts([",", "Comma"], ["\t", "Tab (fewest tokens)"], ["|", "Pipe"])),
    f.select("indent", "Indent", opts(["2", "2 spaces"], ["1", "1 space"], ["4", "4 spaces"]))
  ],
  run(values) {
    const text = str(values, "json");
    if (!text.trim()) throw new ToolInputError("Paste JSON to convert.");
    let value: unknown;
    try { value = JSON.parse(text); } catch (error) { throw new ToolInputError(`That is not valid JSON: ${(error as Error).message}`); }
    const output = encodeToon(value, { delimiter: str(values, "delimiter", ",") as ToonDelimiter, indent: Number(str(values, "indent", "2")) || 2 });
    const pretty = estimateTokens(JSON.stringify(value, null, 2));
    const minified = estimateTokens(JSON.stringify(value));
    const toonTokens = estimateTokens(output);
    const saving = minified ? 1 - toonTokens / minified : 0;
    return {
      stats: [
        { label: "JSON (pretty)", value: `${fmtNumber(pretty)} tokens` },
        { label: "JSON (minified)", value: `${fmtNumber(minified)} tokens` },
        { label: "TOON", value: `${fmtNumber(toonTokens)} tokens`, tone: saving > 0.1 ? "good" : "neutral" },
        { label: "Saved vs minified JSON", value: pct(Math.max(0, saving), 0), tone: saving > 0.1 ? "good" : saving < 0 ? "warn" : "neutral" }
      ],
      messages: saving < 0.05 ? [{ kind: "info", text: "Little saving here: TOON helps most with arrays of objects that share the same fields." }] : [],
      outputs: [code("TOON", "text", output)]
    };
  }
};

// ---------------------------------------------------------------------------
// Models & cost
// ---------------------------------------------------------------------------

const PROVIDER_FILTER = opts(["all", "All providers"], "OpenAI", "Anthropic", "Google", ["Open weights", "Open weights (self-hosted)"]);

const tokenCost: ToolDefinition = {
  id: "ai.token-cost",
  command: "tokenCounter",
  section: "ai",
  category: "Models & cost",
  title: "Token & Cost Estimator",
  summary: "Estimate tokens for a text and what a request, a day and a month cost on each model.",
  guide: `Token counts are estimated with a BPE-style heuristic (typically within 10-15% of the real tokenizer for English and code). Prices are list prices per million tokens as of ${PRICES_AS_OF}; batch APIs and prompt caching are usually cheaper.`,
  keywords: ["tokens", "tokenizer", "pricing", "budget", "cost calculator", "llm cost"],
  icon: "coins",
  live: true,
  examples: [{ label: "Support chatbot: 1,200-token prompt, 300-token answers, 20k requests/day", values: { text: "", inputTokens: 1200, outputTokens: 300, requestsPerDay: 20000, cachedPct: 50 } }, { label: "Batch summarisation: 8k in, 500 out, 2k/day", values: { text: "", inputTokens: 8000, outputTokens: 500, requestsPerDay: 2000, cachedPct: 0 } }],
  fields: [
    f.area("text", "Prompt text", { rows: 8, fromEditor: true, placeholder: "Paste a prompt, or leave empty and enter a token count" }),
    f.num("inputTokens", "Input tokens per request", 0, { help: "Overrides the estimate when greater than 0.", min: 0 }),
    f.num("outputTokens", "Output tokens per request", 500, { min: 0 }),
    f.num("requestsPerDay", "Requests per day", 1000, { min: 0 }),
    f.num("cachedPct", "Cached input %", 0, { min: 0, max: 100, help: "Share of input served from the prompt cache (~90% cheaper on most providers)." }),
    f.select("provider", "Provider", PROVIDER_FILTER)
  ],
  run(values) {
    const content = str(values, "text");
    const override = num(values, "inputTokens", 0, { min: 0, label: "Input tokens" });
    const input = override > 0 ? override : estimateTokens(content);
    if (!input) throw new ToolInputError("Paste some text or enter the input tokens per request.");
    const output = num(values, "outputTokens", 500, { min: 0, label: "Output tokens" });
    const perDay = num(values, "requestsPerDay", 1000, { min: 0, label: "Requests per day" });
    const cached = num(values, "cachedPct", 0, { min: 0, max: 100, label: "Cached input %" }) / 100;
    const provider = str(values, "provider", "all");
    const rows = CHAT_MODEL_CATALOG
      .filter(m => provider === "all" || m.provider === provider)
      .map(m => {
        const fits = input + output <= m.contextWindow && output <= m.maxOutput;
        if (m.input === undefined || m.output === undefined) return { m, cost: Infinity, row: [m.label, "self-hosted", "-", "-", "-", fits ? "yes" : "no"] as Array<string | number> };
        const cost = ((input * (1 - cached) + input * cached * 0.1) * m.input + output * m.output) / 1e6;
        return { m, cost, row: [m.label, `$${m.input} / $${m.output}`, fmtUsd(cost), fmtUsd(cost * perDay), fmtUsd(cost * perDay * 30), fits ? "yes" : output > m.maxOutput ? `no (max output ${formatContext(m.maxOutput)})` : "no"] };
      })
      .sort((a, b) => a.cost - b.cost);
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const cheapest = rows.find(r => Number.isFinite(r.cost));
    return {
      stats: [
        { label: "Input tokens", value: fmtNumber(input) },
        { label: "Characters", value: fmtNumber(content.length) },
        { label: "Words", value: fmtNumber(words) },
        ...(cheapest ? [{ label: `Cheapest: ${cheapest.m.label}`, value: `${fmtUsd(cheapest.cost * perDay * 30)}/mo`, tone: "good" as const }] : [])
      ],
      messages: override > 0 || !content ? [] : [{ kind: "info", text: "Exact counts need the provider's tokenizer (tiktoken for OpenAI, the count_tokens API for Anthropic and Gemini)." }],
      outputs: [table("Cost by model", ["Model", "$/1M in / out", "Per request", "Per day", "Per month", "Fits context"], rows.map(r => r.row))]
    };
  }
};

const modelCompare: ToolDefinition = {
  id: "ai.model-compare",
  command: "modelComparison",
  section: "ai",
  category: "Models & cost",
  title: "Model Comparison",
  summary: "Compare context window, output limit and price across current chat models.",
  keywords: ["compare models", "context window", "gpt", "claude", "gemini", "llama", "pricing"],
  icon: "barChart",
  live: true,
  fields: [
    f.select("provider", "Provider", PROVIDER_FILTER),
    f.num("minContext", "Minimum context (K tokens)", 0, { min: 0 }),
    f.select("sort", "Sort by", opts(["price", "Input price"], ["context", "Context window"], ["output", "Max output"]))
  ],
  run(values) {
    const provider = str(values, "provider", "all");
    const min = num(values, "minContext", 0, { min: 0, label: "Minimum context" }) * 1000;
    const sort = str(values, "sort", "price");
    const models = CHAT_MODEL_CATALOG.filter(m => (provider === "all" || m.provider === provider) && m.contextWindow >= min)
      .sort((a, b) => sort === "context" ? b.contextWindow - a.contextWindow : sort === "output" ? b.maxOutput - a.maxOutput : (a.input ?? Infinity) - (b.input ?? Infinity));
    if (!models.length) return { messages: [{ kind: "warning", text: "No model matches these filters." }] };
    return {
      stats: [{ label: "Models", value: String(models.length) }, { label: "Prices as of", value: PRICES_AS_OF }],
      outputs: [table("Models", ["Model", "Provider", "Id", "Context", "Max output", "Input $/1M", "Output $/1M", "Notes"],
        models.map(m => [m.label, m.provider, m.id, formatContext(m.contextWindow), formatContext(m.maxOutput), m.input !== undefined ? `$${m.input}` : "-", m.output !== undefined ? `$${m.output}` : "-", m.notes ?? ""]))]
    };
  }
};

const llmConfig: ToolDefinition = {
  id: "ai.llm-config",
  command: "llmClientSetup",
  section: "ai",
  category: "Models & cost",
  title: "LLM Client Setup",
  summary: "Generate a production-ready client for OpenAI, Anthropic, Gemini, Azure, Ollama or any OpenAI-compatible server.",
  guide: "The generated code reads keys from environment variables, sets a timeout and retries, and optionally streams. Copy the .env block into your .env (never commit it).",
  keywords: ["api client", "sdk", "openai", "anthropic", "gemini", "azure openai", "ollama", "vllm", "env", "configuration"],
  icon: "key",
  live: true,
  fields: [
    f.select("provider", "Provider", LLM_PROVIDER_OPTIONS.map(p => ({ value: p.value, label: p.label }))),
    f.select("language", "Language", opts(["python", "Python"], ["typescript", "TypeScript"], ["curl", "curl"])),
    f.text("model", "Model", { width: "narrow", placeholder: "Default for the provider" }),
    f.text("baseUrl", "Base URL", { width: "narrow", placeholder: "http://localhost:8000/v1", showIf: { field: "provider", equals: ["openai-compatible"] } }),
    f.toggle("stream", "Stream tokens", false),
    f.num("temperature", "Temperature", 0.2, { min: 0, max: 2, step: 0.1 }),
    f.num("timeoutSeconds", "Timeout (s)", 60, { min: 1, max: 600 }),
    f.num("maxRetries", "Max retries", 3, { min: 0, max: 10 })
  ],
  run(values) {
    const provider = str(values, "provider", "openai") as LlmProvider;
    const cfg = generateLlmConfig({
      provider,
      language: str(values, "language", "python") as "python" | "typescript" | "curl",
      model: str(values, "model").trim() || LLM_PROVIDER_OPTIONS.find(p => p.value === provider)!.defaultModel,
      stream: bool(values, "stream"),
      temperature: num(values, "temperature", 0.2, { min: 0, max: 2, label: "Temperature" }),
      timeoutSeconds: num(values, "timeoutSeconds", 60, { min: 1, max: 600, integer: true, label: "Timeout" }),
      maxRetries: num(values, "maxRetries", 3, { min: 0, max: 10, integer: true, label: "Max retries" }),
      baseUrl: str(values, "baseUrl").trim() || undefined
    });
    return {
      messages: cfg.notes.map(n => ({ kind: "info" as const, text: n })),
      outputs: [code("Install", "shell", cfg.install), code(".env", "dotenv", cfg.env, ".env.example"), code(cfg.code.fileName, cfg.code.language, cfg.code.content, cfg.code.fileName)]
    };
  }
};

const TESTER_PROVIDERS = opts(["openai", "OpenAI"], ["anthropic", "Anthropic"], ["gemini", "Google Gemini"], ["azure-openai", "Azure OpenAI"], ["ollama", "Ollama (local)"], ["custom", "OpenAI-compatible"]);
const KEY_ENV: Record<string, string[]> = { openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "azure-openai": ["AZURE_OPENAI_API_KEY"], custom: ["LLM_API_KEY", "OPENAI_API_KEY"] };

const llmTester: ToolDefinition = {
  id: "ai.llm-tester",
  command: "llmApiTester",
  section: "ai",
  category: "Models & cost",
  title: "LLM API Tester",
  summary: "Send one chat request to a provider and see the answer, latency, token usage and cost.",
  guide: "Leave the API key empty to use the matching environment variable of the VS Code process (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, AZURE_OPENAI_API_KEY). A key typed here is used for this request only: it is never saved or logged.",
  keywords: ["test api", "chat completion", "latency", "api key", "ping model"],
  icon: "api",
  network: true,
  runLabel: "Send request",
  fields: [
    f.select("provider", "Provider", TESTER_PROVIDERS),
    f.text("model", "Model", { width: "narrow", placeholder: "gpt-4.1-mini" }),
    f.text("baseUrl", "Base URL", { width: "narrow", placeholder: "Provider default", help: "Required for Azure (https://<resource>.openai.azure.com), Ollama and OpenAI-compatible servers." }),
    f.secret("apiKey", "API key", { width: "narrow", placeholder: "Empty = use environment variable" }),
    f.area("system", "System prompt", { rows: 2, default: "You are a concise assistant." }),
    f.area("user", "User message", { rows: 4, required: true, default: "Reply with the single word: pong" }),
    f.num("temperature", "Temperature", 0, { min: 0, max: 2, step: 0.1 }),
    f.num("maxTokens", "Max output tokens", 256, { min: 1, max: 32000 }),
    f.toggle("jsonMode", "JSON mode", false)
  ],
  async run(values) {
    const provider = str(values, "provider", "openai") as "openai" | "anthropic" | "gemini" | "azure-openai" | "ollama" | "custom";
    const model = str(values, "model").trim();
    if (!model) throw new ToolInputError("Enter the model (or Azure deployment) name.");
    const user = str(values, "user").trim();
    if (!user) throw new ToolInputError("Write a user message.");
    const baseUrl = str(values, "baseUrl").trim() || (provider === "ollama" ? "http://localhost:11434/v1" : undefined);
    if ((provider === "azure-openai" || provider === "custom") && !baseUrl) throw new ToolInputError("This provider needs a base URL.");
    let apiKey = str(values, "apiKey").trim();
    let keySource = "entered";
    if (!apiKey && provider !== "ollama") {
      const name = (KEY_ENV[provider] ?? []).find(n => process.env[n]);
      if (!name) throw new ToolInputError(`No API key: enter one, or set ${(KEY_ENV[provider] ?? ["the key variable"]).join(" / ")} in the environment VS Code was started from.`);
      apiKey = process.env[name]!;
      keySource = name;
    }
    // Loaded on first use: keeps the HTTP client out of extension startup.
    const { callChat } = await import("../../services/ai-operations");
    const result = await callChat({
      provider, model, apiKey, baseUrl,
      messages: [...(str(values, "system").trim() ? [{ role: "system" as const, content: str(values, "system") }] : []), { role: "user" as const, content: user }],
      temperature: num(values, "temperature", 0, { min: 0, max: 2, label: "Temperature" }),
      maxTokens: num(values, "maxTokens", 256, { min: 1, max: 32000, integer: true, label: "Max output tokens" }),
      jsonMode: bool(values, "jsonMode"),
      apiVersion: provider === "azure-openai" ? "2024-10-21" : undefined,
      timeoutMs: 60_000
    });
    const usage = result.parsed.usage;
    const stats: NonNullable<ToolResult["stats"]> = [
      { label: "Status", value: result.status ? String(result.status) : "no response", tone: result.ok ? "good" : "bad" },
      { label: "Latency", value: `${fmtNumber(result.latencyMs)} ms` },
      { label: "Tokens in / out", value: `${usage.promptTokens ?? "?"} / ${usage.completionTokens ?? "?"}` },
      { label: "Cost", value: result.costKnown ? fmtUsd(result.costUsd) : "unknown model price" }
    ];
    if (!result.ok) return { stats, messages: [{ kind: "error", text: result.error ?? "The request failed." }], outputs: result.raw !== undefined ? [code("Response body", "json", JSON.stringify(result.raw, null, 2))] : [] };
    return {
      stats,
      messages: [{ kind: "success", text: `Answered by ${model}. Key: ${keySource === "entered" ? "the key you entered (not saved)" : provider === "ollama" ? "none needed" : `from ${keySource}`}.` }],
      outputs: [text("Answer", result.parsed.text || "(empty response)"), code("Raw response", "json", JSON.stringify(result.raw, null, 2))]
    };
  }
};

const vramTool: ToolDefinition = {
  id: "ai.vram",
  command: "gpuVram",
  section: "ai",
  category: "Models & cost",
  title: "GPU Memory & Speed Estimator",
  summary: "How much VRAM a model needs for inference, LoRA, QLoRA or full fine-tuning, and how fast it will run.",
  guide: "Weights = parameters × bytes per parameter. The KV cache grows with context length × concurrent sequences. Training adds gradients and optimizer state. Speed estimates assume a memory-bandwidth-bound decoder; real throughput depends on the serving stack (vLLM, TGI, llama.cpp).",
  keywords: ["vram", "gpu", "memory", "inference", "fine-tune", "lora", "qlora", "kv cache", "quantization", "tokens per second"],
  icon: "cpu",
  live: true,
  fields: [
    f.select("arch", "Model", [...ARCHITECTURES.map(a => ({ value: a.id, label: a.label })), { value: "custom", label: "Custom…" }], { default: "llama-3.1-8b" }),
    f.num("paramsB", "Parameters (B)", 8, { showIf: { field: "arch", equals: ["custom"] }, min: 0.1 }),
    f.num("layers", "Layers", 32, { showIf: { field: "arch", equals: ["custom"] }, min: 1 }),
    f.num("hidden", "Hidden size", 4096, { showIf: { field: "arch", equals: ["custom"] }, min: 64 }),
    f.num("kvHeads", "KV heads", 8, { showIf: { field: "arch", equals: ["custom"] }, min: 1 }),
    f.num("headDim", "Head dim", 128, { showIf: { field: "arch", equals: ["custom"] }, min: 16 }),
    f.select("workload", "Workload", opts(["inference", "Inference"], ["lora", "LoRA fine-tune"], ["qlora", "QLoRA fine-tune"], ["full", "Full fine-tune"])),
    f.select("precision", "Weights precision", opts(["bf16", "BF16 / FP16"], ["fp8", "FP8"], ["int8", "INT8"], ["int4", "4-bit (AWQ/GPTQ/Q4)"], ["fp32", "FP32"]), { showIf: { field: "workload", equals: ["inference", "lora"] } }),
    f.select("kvPrecision", "KV cache", opts(["fp16", "FP16"], ["fp8", "FP8"]), { showIf: { field: "workload", equals: ["inference"] } }),
    f.num("context", "Context length", 8192, { min: 128 }),
    f.num("batch", "Concurrent sequences / batch", 1, { min: 1 }),
    f.num("loraRank", "LoRA rank", 16, { min: 1, showIf: { field: "workload", equals: ["lora", "qlora"] } }),
    f.select("gpu", "GPU", GPUS.map(g => ({ value: g.id, label: g.label })), { default: "a10g" }),
    f.num("gpuCount", "GPUs", 1, { min: 1, max: 64 }),
    f.num("promptTokens", "Prompt tokens (for time to first token)", 1000, { min: 1, showIf: { field: "workload", equals: ["inference"] } })
  ],
  run(values) {
    const archId = str(values, "arch", "llama-3.1-8b");
    const preset = ARCHITECTURES.find(a => a.id === archId);
    const workload = str(values, "workload", "inference") as Workload;
    const input = {
      paramsB: preset?.paramsB ?? num(values, "paramsB", 8, { min: 0.1, label: "Parameters" }),
      layers: preset?.layers ?? num(values, "layers", 32, { min: 1, integer: true, label: "Layers" }),
      hidden: preset?.hidden ?? num(values, "hidden", 4096, { min: 64, integer: true, label: "Hidden size" }),
      kvHeads: preset?.kvHeads ?? num(values, "kvHeads", 8, { min: 1, integer: true, label: "KV heads" }),
      headDim: preset?.headDim ?? num(values, "headDim", 128, { min: 16, integer: true, label: "Head dim" }),
      workload,
      precision: (str(values, "precision", "bf16") in PRECISION_BYTES ? str(values, "precision", "bf16") : "bf16") as keyof typeof PRECISION_BYTES,
      kvPrecision: str(values, "kvPrecision", "fp16") as "fp16" | "fp8",
      context: num(values, "context", 8192, { min: 128, integer: true, label: "Context length" }),
      batch: num(values, "batch", 1, { min: 1, integer: true, label: "Batch" }),
      loraRank: num(values, "loraRank", 16, { min: 1, integer: true, label: "LoRA rank" }),
      promptTokens: num(values, "promptTokens", 1000, { min: 1, integer: true, label: "Prompt tokens" })
    };
    const gpu = GPUS.find(g => g.id === str(values, "gpu", "a10g")) ?? GPUS[0];
    const count = num(values, "gpuCount", 1, { min: 1, max: 64, integer: true, label: "GPUs" });
    const b = estimateVram(input);
    const available = gpu.memoryGB * count;
    const fits = b.totalGB <= available * 0.9;
    const needed = gpusNeeded(b.totalGB, gpu);
    const stats: NonNullable<ToolResult["stats"]> = [
      { label: "Total VRAM", value: `${b.totalGB.toFixed(1)} GB`, tone: fits ? "good" : "bad" },
      { label: `Available (${count}× ${gpu.label})`, value: `${available} GB` },
      { label: fits ? "Fits" : "GPUs needed", value: fits ? `${pct(b.totalGB / available, 0)} used` : String(needed), tone: fits ? "good" : "warn" }
    ];
    if (workload === "inference") {
      const speed = estimateSpeed(input, b, gpu, count);
      stats.push({ label: "Decode speed (per sequence)", value: `~${fmtNumber(speed.decodeTokensPerSecond)} tok/s` }, { label: "Time to first token", value: `~${fmtNumber(speed.timeToFirstTokenMs)} ms` });
    } else {
      stats.push({ label: "Trainable parameters", value: fmtNumber(b.trainableParams / 1e6, 1) + "M" });
    }
    return {
      stats,
      messages: [...suggestions(input, b, gpu).map(t => ({ kind: "info" as const, text: t })), ...(count > 1 ? [{ kind: "info" as const, text: "Multi-GPU needs tensor or pipeline parallelism (vLLM --tensor-parallel-size, DeepSpeed/FSDP for training); communication overhead lowers real throughput." }] : [])],
      outputs: [table("Memory breakdown", ["Component", "GB", "Share"], [
        ["Weights", b.weightsGB.toFixed(2), pct(b.weightsGB / b.totalGB)],
        ["KV cache", b.kvCacheGB.toFixed(2), pct(b.kvCacheGB / b.totalGB)],
        ["Gradients + optimizer", b.trainingStateGB.toFixed(2), pct(b.trainingStateGB / b.totalGB)],
        ["Activations", b.activationsGB.toFixed(2), pct(b.activationsGB / b.totalGB)],
        ["Runtime overhead", b.overheadGB.toFixed(2), pct(b.overheadGB / b.totalGB)],
        ["Total", b.totalGB.toFixed(2), "100%"]
      ])]
    };
  }
};

// ---------------------------------------------------------------------------
// LLM output
// ---------------------------------------------------------------------------

const jsonValidator: ToolDefinition = {
  id: "ai.json-output",
  command: "llmJsonValidator",
  section: "ai",
  category: "LLM output",
  title: "LLM JSON Extractor & Validator",
  summary: "Pull JSON out of a model response, repair common mistakes and validate it against a JSON Schema.",
  guide: "Handles code fences, text around the JSON, single quotes, trailing commas, comments, unquoted keys, Python True/False/None and truncated output. Repairs are listed so you can fix the prompt instead of relying on them.",
  keywords: ["json", "structured output", "schema", "repair", "parse", "validate", "function calling"],
  icon: "braces",
  live: true,
  examples: [{ label: "Chatty response with broken JSON", values: { response: "Sure! Here is the data you asked for:\n```json\n{\n  name: 'Ada Lovelace',\n  \"born\": 1815,\n  \"languages\": [\"English\", \"French\",],\n  \"mathematician\": True, // obviously\n}\n```\nLet me know if you need anything else.", schema: '{"type": "object", "required": ["name", "born", "email"], "properties": {"name": {"type": "string"}, "born": {"type": "integer"}, "email": {"type": "string"}}}' } }],
  fields: [
    f.area("response", "Model response", { rows: 10, required: true, fromEditor: true, placeholder: "Here is the result:\n```json\n{ 'name': 'Ada', \"tags\": [\"x\",], }\n```" }),
    f.code("schema", "JSON Schema (optional)", "json", { rows: 6, placeholder: "{ \"type\": \"object\", \"required\": [\"name\"] }" })
  ],
  run(values) {
    const raw = str(values, "response");
    if (!raw.trim()) throw new ToolInputError("Paste a model response.");
    const result = repairJson(raw);
    if (!result.ok) {
      const e = result.error!;
      return {
        stats: [{ label: "Valid JSON", value: "no", tone: "bad" }],
        messages: [{ kind: "error", text: `${e.message} (line ${e.line}, column ${e.column})` }, ...result.fixes.map(fx => ({ kind: "info" as const, text: `Tried: ${fx}` }))],
        outputs: [code("Near the error", "text", e.excerpt)]
      };
    }
    const messages: NonNullable<ToolResult["messages"]> = result.fixes.length
      ? [{ kind: "warning", text: `Repaired ${result.fixes.length} problem(s): ${result.fixes.join("; ")}. Consider the provider's structured-output mode.` }]
      : [{ kind: "success", text: "The response contains valid JSON." }];
    const stats: NonNullable<ToolResult["stats"]> = [{ label: "Valid JSON", value: result.fixes.length ? "after repair" : "yes", tone: result.fixes.length ? "warn" : "good" }];
    const schemaText = str(values, "schema").trim();
    if (schemaText) {
      let schema: unknown;
      try { schema = JSON.parse(schemaText); } catch (error) { throw new ToolInputError(`The JSON Schema is not valid JSON: ${(error as Error).message}`); }
      const violations = validateSchema(result.value, schema);
      stats.push({ label: "Schema", value: violations.length ? `${violations.length} violation(s)` : "valid", tone: violations.length ? "bad" : "good" });
      for (const v of violations) messages.push({ kind: "error", text: `${v.path}: ${v.message}` });
    }
    return { stats, messages, outputs: [code("JSON", "json", JSON.stringify(result.value, null, 2))] };
  }
};

const responseFormatter: ToolDefinition = {
  id: "ai.response-formatter",
  command: "llmResponseFormatter",
  section: "ai",
  category: "LLM output",
  title: "Response Formatter",
  summary: "Clean up a model answer: strip reasoning tags, tidy Markdown, pretty-print JSON and extract code blocks.",
  keywords: ["markdown", "format", "clean", "code blocks", "think tags", "plain text"],
  icon: "sparkles",
  live: true,
  examples: [{ label: "Reasoning model answer with code", values: { response: "<think>The user wants a Python function. I should keep it short.</think>\n\nHere is a **retry helper**:\n\n\n```python\nimport time\n\ndef retry(fn, attempts=3):\n    for i in range(attempts):\n        try:\n            return fn()\n        except Exception:\n            time.sleep(2 ** i)\n    raise RuntimeError(\"gave up\")\n```\n\nConfig used:\n```json\n{\"attempts\":3,\"backoff\":\"exponential\"}\n```" } }],
  fields: [
    f.area("response", "Model response", { rows: 12, required: true, fromEditor: true }),
    f.toggle("stripReasoning", "Remove <think> blocks", true),
    f.toggle("prettyJson", "Pretty-print JSON blocks", true)
  ],
  run(values) {
    const raw = str(values, "response");
    if (!raw.trim()) throw new ToolInputError("Paste a model response.");
    const r = formatResponse(raw, { stripReasoning: bool(values, "stripReasoning", true), prettyJson: bool(values, "prettyJson", true) });
    return {
      stats: [
        { label: "Code blocks", value: String(r.codeBlocks.length) },
        { label: "JSON blocks formatted", value: String(r.jsonBlocks) },
        { label: "Reasoning blocks removed", value: String(r.reasoningRemoved) },
        { label: "Tokens (est.)", value: fmtNumber(estimateTokens(r.markdown)) }
      ],
      outputs: [
        code("Markdown", "markdown", r.markdown),
        text("Plain text", r.plainText),
        ...r.codeBlocks.map((b, i) => code(`Code block ${i + 1} (${b.language}, ${b.lines} lines)`, b.language, b.content))
      ]
    };
  }
};

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

function parseVectors(input: string): number[][] {
  const t = input.trim();
  if (!t) throw new ToolInputError("Paste two or more vectors.");
  let vectors: unknown;
  if (t.startsWith("[[")) {
    try { vectors = JSON.parse(t); } catch { throw new ToolInputError("Could not parse the JSON array of vectors."); }
  } else {
    vectors = t.split(/\r?\n/).filter(l => l.trim()).map((line, i) => {
      const clean = line.trim().replace(/^[^[\d-]*:\s*/, "");
      try { return JSON.parse(clean.startsWith("[") ? clean : `[${clean}]`); } catch { throw new ToolInputError(`Line ${i + 1} is not a list of numbers.`); }
    });
  }
  if (!Array.isArray(vectors) || vectors.some(v => !Array.isArray(v) || !v.length || v.some(x => typeof x !== "number" || !Number.isFinite(x)))) throw new ToolInputError("Every vector must be a non-empty list of numbers.");
  const out = vectors as number[][];
  if (out.length < 2) throw new ToolInputError("Paste at least two vectors to compare.");
  const dims = out[0].length;
  const bad = out.findIndex(v => v.length !== dims);
  if (bad >= 0) throw new ToolInputError(`Vector ${bad + 1} has ${out[bad].length} dimensions but vector 1 has ${dims}. Vectors from different models cannot be compared.`);
  return out;
}

const vectorMath: ToolDefinition = {
  id: "ai.vector-similarity",
  command: "vectorSimilarity",
  section: "ai",
  category: "Embeddings",
  title: "Vector Similarity",
  summary: "Cosine similarity, dot product and distance between embedding vectors, plus normalisation.",
  guide: "Paste one vector per line (as [0.1, 0.2, …] or comma-separated; an optional \"label:\" prefix names it) or a JSON array of vectors. For normalised embeddings cosine similarity and dot product are identical.",
  keywords: ["cosine", "embedding", "dot product", "euclidean", "normalize", "similarity"],
  icon: "target",
  live: true,
  examples: [{ label: "Query vs two documents", values: { vectors: "query: [0.12, 0.98, 0.05, 0.10]\ndoc_refunds: [0.10, 0.95, 0.10, 0.12]\ndoc_shipping: [0.90, 0.05, 0.40, 0.02]" } }],
  fields: [f.area("vectors", "Vectors", { rows: 8, required: true, placeholder: "query: [0.12, 0.98, 0.05]\ndoc1: [0.10, 0.95, 0.10]\ndoc2: [0.90, 0.05, 0.40]" })],
  run(values) {
    const raw = str(values, "vectors");
    const labels = raw.trim().startsWith("[[") ? [] : raw.split(/\r?\n/).filter(l => l.trim()).map(l => /^\s*([^[\d-][^:]*):/.exec(l)?.[1].trim());
    const vectors = parseVectors(raw);
    const name = (i: number) => labels[i] || `v${i + 1}`;
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const norms = vectors.map(norm);
    if (norms.some(n => n === 0)) throw new ToolInputError("A zero vector has no direction; cosine similarity is undefined.");
    const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
    const rows: Array<Array<string | number>> = [];
    for (let i = 0; i < vectors.length; i++) for (let j = i + 1; j < vectors.length; j++) {
      const d = dot(vectors[i], vectors[j]);
      rows.push([`${name(i)} ↔ ${name(j)}`, (d / (norms[i] * norms[j])).toFixed(4), d.toFixed(4), Math.sqrt(vectors[i].reduce((s, x, k) => s + (x - vectors[j][k]) ** 2, 0)).toFixed(4)]);
    }
    rows.sort((a, b) => Number(b[1]) - Number(a[1]));
    const normalized = norms.every(n => Math.abs(n - 1) < 1e-3);
    return {
      stats: [{ label: "Vectors", value: String(vectors.length) }, { label: "Dimensions", value: String(vectors[0].length) }, { label: "Normalised", value: normalized ? "yes" : "no", tone: normalized ? "good" : "neutral" }],
      messages: normalized ? [] : [{ kind: "info", text: "The vectors are not unit length. Normalise them before storing if your index uses dot product." }],
      outputs: [
        table("Pairwise similarity (most similar first)", ["Pair", "Cosine", "Dot product", "Euclidean"], rows),
        code("Normalised vectors", "json", JSON.stringify(vectors.map((v, i) => v.map(x => Number((x / norms[i]).toFixed(6)))), null, 0))
      ]
    };
  }
};

// ---------------------------------------------------------------------------
// Training & evaluation
// ---------------------------------------------------------------------------

const datasetSplit: ToolDefinition = {
  id: "ai.dataset-split",
  command: "datasetSplit",
  section: "ai",
  category: "Training & evaluation",
  title: "Dataset Split Planner",
  summary: "Exact train / validation / test counts (optionally per class) and matching scikit-learn code.",
  keywords: ["train test split", "validation", "stratify", "class imbalance", "sklearn"],
  icon: "split",
  live: true,
  fields: [
    f.num("total", "Total samples", 10000, { min: 1 }),
    f.num("train", "Train %", 70, { min: 0, max: 100 }),
    f.num("val", "Validation %", 15, { min: 0, max: 100 }),
    f.num("seed", "Random seed", 42, { min: 0 }),
    f.area("classes", "Class counts (optional)", { rows: 3, placeholder: "cat: 5000\ndog: 4200\nbird: 800", help: "Per-class counts replace the total and enable a stratified split." })
  ],
  run(values) {
    const classesText = str(values, "classes").trim();
    const classes = classesText ? parseClassCounts(classesText) : [];
    const train = num(values, "train", 70, { min: 0, max: 100, label: "Train %" });
    const val = num(values, "val", 15, { min: 0, max: 100, label: "Validation %" });
    const r = splitDataset(num(values, "total", 10000, { min: 1, integer: true, label: "Total samples" }), train, val, classes);
    const outputs = [
      table("Split", ["Split", "Samples", "Share"], [["Train", r.counts.train, `${train}%`], ["Validation", r.counts.val, `${val}%`], ["Test", r.counts.test, `${(100 - train - val).toFixed(1).replace(/\.0$/, "")}%`]]),
      ...(r.perClass.length ? [table("Per class", ["Class", "Total", "Train", "Validation", "Test"], r.perClass.map(c => [c.label, c.total, c.train, c.val, c.test]))] : []),
      code("scikit-learn", "python", splitCode(train, val, classes.length > 1, num(values, "seed", 42, { min: 0, integer: true, label: "Seed" })), "split.py")
    ];
    return { messages: r.warnings.map(w => ({ kind: "warning" as const, text: w })), outputs };
  }
};

const metricsTool: ToolDefinition = {
  id: "ai.metrics",
  command: "metricsCalculator",
  section: "ai",
  category: "Training & evaluation",
  title: "Model Metrics",
  summary: "Accuracy, precision, recall and F1 from a confusion matrix, or MAE / RMSE / R² / MAPE for regression.",
  keywords: ["confusion matrix", "f1", "precision", "recall", "rmse", "mae", "r2", "evaluation"],
  icon: "gauge",
  live: true,
  fields: [
    f.select("mode", "Task", opts(["classification", "Classification"], ["regression", "Regression"])),
    f.area("matrix", "Confusion matrix (rows = actual, columns = predicted)", { rows: 4, default: "42, 3, 1\n5, 38, 2\n0, 4, 45", showIf: { field: "mode", equals: ["classification"] } }),
    f.text("labels", "Class labels (optional)", { placeholder: "cat, dog, bird", showIf: { field: "mode", equals: ["classification"] } }),
    f.area("actual", "Actual values", { rows: 3, default: "3.0, 2.5, 4.2, 5.1, 3.8", showIf: { field: "mode", equals: ["regression"] } }),
    f.area("predicted", "Predicted values", { rows: 3, default: "2.8, 2.7, 4.0, 4.8, 4.1", showIf: { field: "mode", equals: ["regression"] } })
  ],
  run(values) {
    if (str(values, "mode", "classification") === "regression") {
      const r = regressionMetrics(str(values, "actual"), str(values, "predicted"));
      return {
        stats: [{ label: "MAE", value: r.mae.toFixed(4) }, { label: "RMSE", value: r.rmse.toFixed(4) }, { label: "R²", value: r.r2.toFixed(4), tone: r.r2 > 0.8 ? "good" : r.r2 > 0.5 ? "neutral" : "warn" }, ...(r.mape !== undefined ? [{ label: "MAPE", value: `${r.mape.toFixed(2)}%` }] : []), { label: "Samples", value: String(r.n) }],
        messages: r.r2 < 0 ? [{ kind: "warning", text: "R² is negative: the model is worse than always predicting the mean." }] : []
      };
    }
    const m = classificationMetrics(str(values, "matrix"), str(values, "labels"));
    const worst = m.perClass.slice().sort((a, b) => a.f1 - b.f1)[0];
    return {
      stats: [{ label: "Accuracy", value: pct(m.accuracy, 2) }, { label: "Macro F1", value: pct(m.macroF1, 2) }, { label: "Weighted F1", value: pct(m.weightedF1, 2) }, { label: "Macro precision", value: pct(m.macroPrecision, 2) }, { label: "Macro recall", value: pct(m.macroRecall, 2) }, { label: "Samples", value: fmtNumber(m.total) }],
      messages: m.perClass.length > 1 && worst.f1 < m.macroF1 - 0.1 ? [{ kind: "info", text: `"${worst.label}" is the weakest class (F1 ${pct(worst.f1)}); look at its errors first.` }] : [],
      outputs: [table("Per class", ["Class", "Precision", "Recall", "F1", "Support"], m.perClass.map(c => [c.label, pct(c.precision), pct(c.recall), pct(c.f1), c.support]))]
    };
  }
};

const lrSchedule: ToolDefinition = {
  id: "ai.lr-schedule",
  command: "lrScheduler",
  section: "ai",
  category: "Training & evaluation",
  title: "Learning-Rate Schedule",
  summary: "Plot a learning-rate schedule over training steps and get the matching PyTorch code.",
  keywords: ["learning rate", "scheduler", "warmup", "cosine", "one cycle", "pytorch"],
  icon: "lineChart",
  live: true,
  fields: [
    f.select("schedule", "Schedule", opts(["warmup-cosine", "Warmup + cosine"], ["warmup-linear", "Warmup + linear decay"], ["cosine", "Cosine annealing"], ["one-cycle", "One-cycle"], ["step", "Step decay"], ["exponential", "Exponential"], ["constant", "Constant"])),
    f.num("baseLr", "Peak learning rate", 0.0003, { step: 0.0001, min: 0 }),
    f.num("minLr", "Minimum learning rate", 0.00001, { step: 0.00001, min: 0, showIf: { field: "schedule", equals: ["warmup-cosine", "warmup-linear", "cosine"] } }),
    f.num("steps", "Total steps", 10000, { min: 1 }),
    f.num("warmupSteps", "Warmup steps", 500, { min: 0, showIf: { field: "schedule", equals: ["warmup-cosine", "warmup-linear"] } }),
    f.num("stepSize", "Decay every N steps", 3000, { min: 1, showIf: { field: "schedule", equals: ["step"] } }),
    f.num("gamma", "Decay factor (gamma)", 0.1, { step: 0.01, min: 0, max: 1, showIf: { field: "schedule", equals: ["step", "exponential"] } })
  ],
  run(values) {
    const s = {
      schedule: str(values, "schedule", "warmup-cosine") as Schedule,
      baseLr: num(values, "baseLr", 3e-4, { min: 0, label: "Peak learning rate" }),
      minLr: num(values, "minLr", 1e-5, { min: 0, label: "Minimum learning rate" }),
      steps: num(values, "steps", 10000, { min: 1, max: 10_000_000, integer: true, label: "Total steps" }),
      warmupSteps: num(values, "warmupSteps", 500, { min: 0, integer: true, label: "Warmup steps" }),
      stepSize: num(values, "stepSize", 3000, { min: 1, integer: true, label: "Step size" }),
      gamma: num(values, "gamma", 0.1, { min: 0, max: 1, label: "Gamma" })
    };
    if (s.warmupSteps >= s.steps && s.schedule.startsWith("warmup")) throw new ToolInputError("Warmup must be shorter than the total steps.");
    if (s.minLr > s.baseLr) throw new ToolInputError("The minimum learning rate is above the peak.");
    const series = scheduleSeries(s);
    const messages: NonNullable<ToolResult["messages"]> = [];
    if (s.schedule === "exponential" && s.gamma < 0.999 && s.steps > 1000) messages.push({ kind: "warning", text: `With gamma ${s.gamma} per step the rate reaches ${(s.baseLr * Math.pow(s.gamma, s.steps)).toExponential(1)} - exponential decay is usually applied per epoch, or with gamma close to 1.` });
    return {
      stats: [{ label: "Start", value: series[0][1].toExponential(2) }, { label: "Peak", value: Math.max(...series.map(p => p[1])).toExponential(2) }, { label: "End", value: series[series.length - 1][1].toExponential(2) }],
      messages,
      outputs: [{ kind: "chart", title: "Learning rate by step", xLabel: "step", yLabel: "learning rate", series: [{ name: s.schedule, points: series }] }, code("PyTorch", "python", scheduleCode(s), "scheduler.py")]
    };
  }
};

const modelCardTool: ToolDefinition = {
  id: "ai.model-card",
  command: "modelCard",
  section: "ai",
  category: "Training & evaluation",
  title: "Model Card",
  summary: "Write a Hugging Face-compatible model card (README.md with metadata) for a trained model.",
  keywords: ["model card", "hugging face", "documentation", "readme", "responsible ai"],
  icon: "doc",
  fields: [
    f.text("name", "Model name", { required: true, width: "narrow", default: "sentiment-classifier" }),
    f.text("baseModel", "Base model", { width: "narrow", placeholder: "distilbert-base-uncased" }),
    f.text("task", "Task (pipeline tag)", { width: "narrow", default: "text-classification" }),
    f.text("license", "License", { width: "narrow", default: "apache-2.0" }),
    f.text("language", "Languages", { width: "narrow", default: "en" }),
    f.text("author", "Author", { width: "narrow" }),
    f.text("datasets", "Datasets", { placeholder: "imdb, your-org/reviews" }),
    f.area("metrics", "Metrics", { rows: 3, placeholder: "accuracy: 0.93\nf1: 0.92" }),
    f.area("intendedUse", "Intended use", { rows: 3 }),
    f.area("limitations", "Limitations & risks", { rows: 3 })
  ],
  run(values) {
    const name = str(values, "name").trim();
    if (!name) throw new ToolInputError("Enter the model name.");
    const card = modelCard({ name, baseModel: str(values, "baseModel"), task: str(values, "task"), license: str(values, "license"), language: str(values, "language"), datasets: str(values, "datasets"), metrics: str(values, "metrics"), intendedUse: str(values, "intendedUse"), limitations: str(values, "limitations"), author: str(values, "author") });
    const missing = ["intendedUse", "limitations", "metrics"].filter(k => !str(values, k).trim());
    return {
      messages: missing.length ? [{ kind: "info", text: `Consider filling in: ${missing.join(", ")}. Reviewers look for these first.` }] : [],
      outputs: [code("README.md", "markdown", card, "README.md")]
    };
  }
};

const experimentLog: ToolDefinition = {
  id: "ai.experiment-log",
  command: "experimentLogger",
  section: "ai",
  category: "Training & evaluation",
  title: "Experiment Log",
  summary: "Record a training run (parameters, metrics, notes) as a JSON line you can append to experiments.jsonl.",
  guide: "Keep experiments.jsonl in the repository: one line per run is easy to diff, grep and load with pandas (pd.read_json(path, lines=True)).",
  keywords: ["experiment tracking", "mlflow", "runs", "hyperparameters", "jsonl"],
  icon: "notebook",
  fields: [
    f.text("name", "Run name", { width: "narrow", required: true, default: "baseline" }),
    f.text("model", "Model", { width: "narrow", placeholder: "resnet50" }),
    f.area("params", "Parameters", { rows: 4, default: "lr: 3e-4\nbatch_size: 32\nepochs: 10" }),
    f.area("metrics", "Metrics", { rows: 3, default: "val_accuracy: 0.912\nval_loss: 0.27" }),
    f.text("tags", "Tags", { placeholder: "baseline, augmentation" }),
    f.area("notes", "Notes", { rows: 2 })
  ],
  run(values, ctx) {
    const record = experimentRecord({ name: str(values, "name"), model: str(values, "model"), params: str(values, "params"), metrics: str(values, "metrics"), notes: str(values, "notes"), tags: str(values, "tags") }, ctx.now?.() ?? new Date());
    const line = JSON.stringify(record);
    return {
      outputs: [
        { kind: "files", title: "Append to the log", files: [{ path: "experiments/experiments.jsonl", content: line + "\n", language: "json", mode: "append" }] },
        code("Record", "json", JSON.stringify(record, null, 2))
      ]
    };
  }
};

// ---------------------------------------------------------------------------
// Code & projects
// ---------------------------------------------------------------------------

const snippetsTool: ToolDefinition = {
  id: "ai.snippets",
  command: "mlCodeGen",
  section: "ai",
  category: "Code & projects",
  title: "AI/ML Code Snippets",
  summary: "Complete, tested snippets for structured output, tool calling, streaming, embeddings, eval and training.",
  keywords: ["snippet", "example", "tool calling", "function calling", "streaming", "sse", "pytorch", "lora", "sklearn", "zod", "pydantic", "retry"],
  icon: "code",
  live: true,
  fields: [f.select("snippet", "Snippet", AI_SNIPPETS.map(s => ({ value: s.id, label: `${s.category} · ${s.title} (${s.language === "python" ? "Python" : "TypeScript"})` })))],
  run(values) {
    const s = AI_SNIPPETS.find(x => x.id === str(values, "snippet")) ?? AI_SNIPPETS[0];
    const ext = s.language === "python" ? "py" : "ts";
    return {
      messages: [{ kind: "info", text: s.description }],
      outputs: [code("Install", "shell", s.install), code(s.title, s.language, s.code, `${s.id.replace(/^(py|ts)-/, "").replace(/-/g, "_")}.${ext}`)]
    };
  }
};

const aiProject: ToolDefinition = {
  id: "ai.project",
  command: "aiAppStarter",
  section: "ai",
  category: "Code & projects",
  title: "AI App Starter",
  summary: "Scaffold a small, production-shaped LLM project: config, client with retries, prompts folder, tests and optional evals and Dockerfile.",
  keywords: ["scaffold", "starter", "project", "template", "boilerplate", "llm app"],
  icon: "rocket",
  fields: [
    f.text("name", "Project name", { width: "narrow", default: "ai-app", required: true }),
    f.select("language", "Language", opts(["python", "Python"], ["typescript", "TypeScript"])),
    f.select("provider", "Provider", opts(["openai", "OpenAI"], ["anthropic", "Anthropic"], ["ollama", "Ollama (local)"])),
    f.text("model", "Model", { width: "narrow", placeholder: "Provider default" }),
    f.toggle("evals", "Include eval harness", true),
    f.toggle("docker", "Include Dockerfile", true)
  ],
  run(values) {
    const provider = str(values, "provider", "openai") as "openai" | "anthropic" | "ollama";
    const files = scaffoldAiProject({
      name: str(values, "name").trim() || "ai-app",
      language: str(values, "language", "python") as "python" | "typescript",
      provider,
      model: str(values, "model").trim() || (provider === "anthropic" ? "claude-sonnet-4-5" : provider === "ollama" ? "llama3.2" : "gpt-4.1-mini"),
      evals: bool(values, "evals", true),
      docker: bool(values, "docker", true)
    });
    return { stats: [{ label: "Files", value: String(files.length) }], outputs: [{ kind: "files", title: "Project files", files }] };
  }
};

export const AI_TOOLS: ToolDefinition[] = [
  promptBuilder, toon, tokenCost, modelCompare, llmConfig, llmTester, vramTool,
  jsonValidator, responseFormatter, vectorMath,
  datasetSplit, metricsTool, lrSchedule, modelCardTool, experimentLog,
  snippetsTool, aiProject
];

