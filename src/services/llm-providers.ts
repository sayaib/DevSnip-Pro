/**
 * Provider adapters for the AI/ML side of the REST API Client.
 *
 * Each provider differs in endpoint shape, auth header, message format and
 * where the reply and token usage live in the response. Encoding that once
 * here means every AI feature - single request, streaming, comparison,
 * benchmarking, RAG, agents - shares one correct implementation instead of
 * re-deriving request shapes per tool.
 */

export type ProviderId = "openai" | "anthropic" | "gemini" | "azure-openai" | "ollama" | "custom";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Set on a tool result message. */
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>;
}

export interface ChatRequestOptions {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  apiKey?: string;
  /** Overrides the provider default; required for Azure, Ollama and custom. */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  /** Azure deployments need an api-version query parameter. */
  apiVersion?: string;
  /** Ask the provider for a JSON object response where it supports it. */
  jsonMode?: boolean;
}

export interface BuiltRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: unknown;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ParsedChatResponse {
  text: string;
  usage: TokenUsage;
  finishReason?: string;
  model?: string;
  toolCalls: ToolCall[];
  /** True when the payload did not look like this provider's response. */
  unrecognised?: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Whether an API key is required for a normal call. */
  requiresKey: boolean;
  /** Models offered in the picker; the field stays free-text. */
  models: string[];
  docsUrl: string;
}

export const PROVIDERS: ProviderDescriptor[] = [
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

export function getProvider(id: ProviderId): ProviderDescriptor {
  const provider = PROVIDERS.find(entry => entry.id === id);
  if (!provider) throw new Error(`Unknown AI provider "${id}".`);
  return provider;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

function splitSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
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
export function buildChatRequest(options: ChatRequestOptions): BuiltRequest {
  const provider = getProvider(options.provider);
  const base = trimBase(options.baseUrl || provider.defaultBaseUrl);
  const model = options.model || provider.defaultModel;

  if (options.provider === "anthropic") {
    const { system, rest } = splitSystem(options.messages);
    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 1024,
      messages: rest.map(message => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content
      }))
    };
    if (system) body.system = system;
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.stream) body.stream = true;
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
    const body: Record<string, unknown> = {
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
    if (system) body.systemInstruction = { parts: [{ text: system }] };
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
    const body: Record<string, unknown> = {
      model,
      messages: options.messages.map(message => ({ role: message.role, content: message.content })),
      stream: Boolean(options.stream),
      options: {
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens ? { num_predict: options.maxTokens } : {})
      }
    };
    if (options.jsonMode) body.format = "json";
    return {
      url: `${base}/api/chat`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    };
  }

  // OpenAI, Azure OpenAI and any OpenAI-compatible endpoint.
  const body: Record<string, unknown> = {
    messages: options.messages.map(message =>
      message.role === "tool"
        ? { role: "tool", content: message.content, tool_call_id: message.toolCallId }
        : { role: message.role, content: message.content }
    ),
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

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" ? (value as Record<string, any>) : undefined;
}

/** Extracts the reply text, usage and tool calls from any supported provider. */
export function parseChatResponse(provider: ProviderId, payload: unknown): ParsedChatResponse {
  const data = asRecord(payload);
  const empty: ParsedChatResponse = { text: "", usage: {}, toolCalls: [], unrecognised: true };
  if (!data) return empty;

  if (provider === "anthropic") {
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((block: any) => block?.type === "text")
      .map((block: any) => String(block.text ?? ""))
      .join("");
    const toolCalls: ToolCall[] = blocks
      .filter((block: any) => block?.type === "tool_use")
      .map((block: any) => ({
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
        totalTokens:
          usage.input_tokens !== undefined && usage.output_tokens !== undefined
            ? usage.input_tokens + usage.output_tokens
            : undefined
      },
      unrecognised: !blocks.length && !data.model
    };
  }

  if (provider === "gemini") {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const parts = candidates[0]?.content?.parts ?? [];
    const text = parts.map((part: any) => String(part?.text ?? "")).join("");
    const toolCalls: ToolCall[] = parts
      .filter((part: any) => part?.functionCall)
      .map((part: any, index: number) => ({
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
        totalTokens:
          data.prompt_eval_count !== undefined && data.eval_count !== undefined
            ? data.prompt_eval_count + data.eval_count
            : undefined
      },
      unrecognised: !message && !data.model
    };
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const message = asRecord(choices[0]?.message);
  const toolCalls: ToolCall[] = Array.isArray(message?.tool_calls)
    ? message!.tool_calls.map((call: any) => ({
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

/**
 * Pulls the incremental text out of one streaming chunk.
 * Returns an empty string for keep-alives and metadata frames.
 */
export function parseStreamChunk(provider: ProviderId, raw: string): { text: string; usage?: TokenUsage; done: boolean } {
  const line = raw.trim();
  if (!line) return { text: "", done: false };

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
    } catch {
      return { text: "", done: false };
    }
  }

  const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
  if (!payload || payload === "[DONE]") return { text: "", done: payload === "[DONE]" };

  let data: any;
  try {
    data = JSON.parse(payload);
  } catch {
    return { text: "", done: false };
  }

  if (provider === "anthropic") {
    if (data.type === "content_block_delta") return { text: String(data.delta?.text ?? ""), done: false };
    if (data.type === "message_delta") {
      return { text: "", done: false, usage: { completionTokens: data.usage?.output_tokens } };
    }
    if (data.type === "message_stop") return { text: "", done: true };
    return { text: "", done: false };
  }

  if (provider === "gemini") {
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return {
      text: parts.map((part: any) => String(part?.text ?? "")).join(""),
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

/** Builds the embeddings request for the providers that offer one. */
export function buildEmbeddingsRequest(options: {
  provider: ProviderId;
  model: string;
  input: string[];
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
}): BuiltRequest {
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

/** Normalises an embeddings response into plain vectors. */
export function parseEmbeddingsResponse(provider: ProviderId, payload: unknown): number[][] {
  const data = asRecord(payload);
  if (!data) return [];
  if (provider === "ollama") {
    if (Array.isArray(data.embeddings)) return data.embeddings as number[][];
    if (Array.isArray(data.embedding)) return [data.embedding as number[]];
    return [];
  }
  if (provider === "gemini") {
    const embeddings = Array.isArray(data.embeddings) ? data.embeddings : [];
    return embeddings.map((entry: any) => (Array.isArray(entry?.values) ? entry.values : []));
  }
  const rows = Array.isArray(data.data) ? data.data : [];
  return rows
    .map((row: any) => (Array.isArray(row?.embedding) ? (row.embedding as number[]) : []))
    .filter((vector: number[]) => vector.length > 0);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Indicative prices in USD per million tokens. Used for estimates only, and
 * kept in one table so a price change is a single edit.
 */
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
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

export function estimateCost(model: string, usage: TokenUsage): { usd: number; known: boolean } {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return { usd: 0, known: false };
  const input = ((usage.promptTokens ?? 0) / 1_000_000) * pricing.input;
  const output = ((usage.completionTokens ?? 0) / 1_000_000) * pricing.output;
  return { usd: input + output, known: true };
}

/**
 * Rough token estimate for text, used before a request is sent.
 * Deliberately approximate: it is a budgeting aid, not a tokenizer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const characters = text.length;
  // Blend the two common heuristics (~4 chars and ~0.75 words per token).
  return Math.max(1, Math.round((characters / 4 + words / 0.75) / 2));
}
