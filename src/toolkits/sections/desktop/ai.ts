import { ToolSpec, ToolInputError, ToolResult, bool, fmtNumber, fmtUsd, num, str } from "../../types";

import { code, f, opts, text } from "../helpers";
const TESTER_PROVIDERS = opts(["openai", "OpenAI"], ["anthropic", "Anthropic"], ["gemini", "Google Gemini"], ["azure-openai", "Azure OpenAI"], ["ollama", "Ollama (local)"], ["custom", "OpenAI-compatible"]);

const KEY_ENV: Record<string, string[]> = { openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY"], gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "azure-openai": ["AZURE_OPENAI_API_KEY"], custom: ["LLM_API_KEY", "OPENAI_API_KEY"] };

const llmTester: ToolSpec = {
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
    const { callChat } = await import("../../../services/ai-operations");
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
export const DESKTOP_AI_TOOLS: ToolSpec[] = [llmTester];
