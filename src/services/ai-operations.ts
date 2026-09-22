import axios, { AxiosRequestConfig, CancelTokenSource } from "axios";
import {
  ChatMessage,
  ChatRequestOptions,
  ParsedChatResponse,
  ProviderId,
  ToolDefinition,
  buildChatRequest,
  buildEmbeddingsRequest,
  cosineSimilarity,
  estimateCost,
  estimateTokens,
  parseChatResponse,
  parseEmbeddingsResponse,
  parseStreamChunk
} from "./llm-providers";
import { buildVectorQuery, groundingScore, parseVectorResponse, VectorDbId, VectorMatch } from "./vector-db";
import { extractJson, validateSchema } from "./json-tools";
import { percentiles } from "./assertions";

/**
 * The operations behind every AI/ML feature in the REST API Client.
 *
 * These are plain async functions over the provider adapters: no VS Code and
 * no entitlement logic, so they are unit-testable and the access boundary
 * stays in one place (FeatureAccessService) rather than being duplicated here.
 */

const DEFAULT_TIMEOUT_MS = 120000;

export interface ChatCallResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  parsed: ParsedChatResponse;
  raw: unknown;
  error?: string;
  costUsd: number;
  costKnown: boolean;
}

export interface AiCallOptions extends ChatRequestOptions {
  timeoutMs?: number;
}

function errorMessage(error: any): string {
  if (axios.isCancel?.(error)) return "Request cancelled.";
  if (error?.response) {
    const data = error.response.data;
    const detail =
      typeof data === "string"
        ? data.slice(0, 400)
        : data?.error?.message || data?.message || JSON.stringify(data ?? {}).slice(0, 400);
    return `HTTP ${error.response.status}: ${detail}`;
  }
  if (error?.code === "ECONNREFUSED") {
    return "Connection refused. If this is a local model server, check that it is running and the base URL is right.";
  }
  if (error?.code === "ETIMEDOUT" || error?.code === "ECONNABORTED") return "The request timed out.";
  return error?.message ? String(error.message) : "The request failed.";
}

/** Sends one chat completion and normalises the outcome. */
export async function callChat(options: AiCallOptions, cancelToken?: CancelTokenSource): Promise<ChatCallResult> {
  const request = buildChatRequest({ ...options, stream: false });
  const started = Date.now();
  const config: AxiosRequestConfig = {
    method: request.method,
    url: request.url,
    headers: request.headers,
    data: request.body,
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    validateStatus: () => true,
    ...(cancelToken ? { cancelToken: cancelToken.token } : {})
  };

  try {
    const response = await axios(config);
    const latencyMs = Date.now() - started;
    const parsed = parseChatResponse(options.provider, response.data);
    const cost = estimateCost(options.model, parsed.usage);

    if (response.status >= 400) {
      const data: any = response.data;
      const detail =
        typeof data === "string"
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
  } catch (error) {
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

export interface StreamEvent {
  type: "delta" | "done" | "error";
  text?: string;
  error?: string;
  /** Milliseconds since the request started. */
  atMs?: number;
}

export interface StreamDiagnostics {
  timeToFirstTokenMs: number;
  totalMs: number;
  chunks: number;
  characters: number;
  /** Gaps between successive chunks, in milliseconds. */
  interTokenMs: { p50: number; p90: number; p99: number; min: number; max: number; mean: number };
  charactersPerSecond: number;
}

export interface StreamResult {
  text: string;
  diagnostics: StreamDiagnostics;
  error?: string;
}

/**
 * Streams a completion, emitting each delta as it arrives and measuring
 * time-to-first-token and inter-chunk latency along the way.
 */
export async function streamChat(
  options: AiCallOptions,
  onEvent: (event: StreamEvent) => void,
  cancelToken?: CancelTokenSource
): Promise<StreamResult> {
  const request = buildChatRequest({ ...options, stream: true });
  const started = Date.now();
  let firstTokenAt = 0;
  let lastChunkAt = started;
  const gaps: number[] = [];
  let text = "";
  let chunks = 0;

  const emptyDiagnostics = (): StreamDiagnostics => ({
    timeToFirstTokenMs: firstTokenAt ? firstTokenAt - started : 0,
    totalMs: Date.now() - started,
    chunks,
    characters: text.length,
    interTokenMs: percentiles(gaps),
    charactersPerSecond: text.length ? Math.round((text.length / Math.max(1, Date.now() - started)) * 1000) : 0
  });

  try {
    const response = await axios({
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
      const body = await new Promise<string>(resolve => {
        let buffer = "";
        response.data.on("data", (chunk: Buffer) => (buffer += chunk.toString("utf8")));
        response.data.on("end", () => resolve(buffer));
        response.data.on("error", () => resolve(buffer));
      });
      const error = `HTTP ${response.status}: ${body.slice(0, 400)}`;
      onEvent({ type: "error", error });
      return { text: "", diagnostics: emptyDiagnostics(), error };
    }

    await new Promise<void>((resolve, reject) => {
      let buffer = "";
      response.data.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        // Providers frame events with a blank line (SSE) or a newline (Ollama).
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const { text: delta, done } = parseStreamChunk(options.provider, part);
          if (delta) {
            const now = Date.now();
            if (!firstTokenAt) firstTokenAt = now;
            else gaps.push(now - lastChunkAt);
            lastChunkAt = now;
            chunks++;
            text += delta;
            onEvent({ type: "delta", text: delta, atMs: now - started });
          }
          if (done) resolve();
        }
      });
      response.data.on("end", () => resolve());
      response.data.on("error", (error: Error) => reject(error));
    });

    const diagnostics = emptyDiagnostics();
    onEvent({ type: "done", atMs: diagnostics.totalMs });
    return { text, diagnostics };
  } catch (error) {
    const message = errorMessage(error);
    onEvent({ type: "error", error: message });
    return { text, diagnostics: emptyDiagnostics(), error: message };
  }
}

export interface ComparisonTarget {
  label: string;
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
}

export interface ComparisonRow {
  label: string;
  provider: ProviderId;
  model: string;
  ok: boolean;
  text: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd: number;
  costKnown: boolean;
  error?: string;
}

/** Runs one prompt against several models concurrently. */
export async function compareModels(
  targets: ComparisonTarget[],
  messages: ChatMessage[],
  shared: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<{ rows: ComparisonRow[]; fastest?: string; cheapest?: string }> {
  if (!targets.length) throw new Error("Add at least one model to compare.");

  const rows = await Promise.all(
    targets.map(async target => {
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
      } satisfies ComparisonRow;
    })
  );

  const successful = rows.filter(row => row.ok);
  const fastest = successful.slice().sort((a, b) => a.latencyMs - b.latencyMs)[0]?.label;
  const priced = successful.filter(row => row.costKnown);
  const cheapest = priced.slice().sort((a, b) => a.costUsd - b.costUsd)[0]?.label;
  return { rows, fastest, cheapest };
}

export interface BenchmarkResult {
  runs: number;
  successes: number;
  failures: number;
  latency: { p50: number; p90: number; p99: number; min: number; max: number; mean: number };
  tokensPerSecond: number;
  totalCostUsd: number;
  costKnown: boolean;
  errors: string[];
}

/** Repeats a prompt to measure latency distribution and throughput. */
export async function benchmarkModel(
  options: AiCallOptions,
  runs: number,
  concurrency = 1
): Promise<BenchmarkResult> {
  const total = Math.max(1, Math.min(runs, 50));
  const parallel = Math.max(1, Math.min(concurrency, 10));
  const latencies: number[] = [];
  const errors: string[] = [];
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
        if (!result.costKnown) costKnown = false;
      } else if (result.error) {
        errors.push(result.error);
      }
    }
  }
  elapsed = Date.now() - startedAll;

  return {
    runs: total,
    successes,
    failures: total - successes,
    latency: percentiles(latencies),
    tokensPerSecond: elapsed > 0 ? Math.round((completionTokens / elapsed) * 1000 * 10) / 10 : 0,
    totalCostUsd: totalCost,
    costKnown,
    errors: [...new Set(errors)].slice(0, 5)
  };
}

export interface EmbeddingsTestResult {
  ok: boolean;
  dimensions: number;
  count: number;
  latencyMs: number;
  /** Pairwise cosine similarity between the supplied inputs. */
  similarities: Array<{ a: number; b: number; score: number }>;
  preview: number[];
  error?: string;
}

export async function testEmbeddings(options: {
  provider: ProviderId;
  model: string;
  input: string[];
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}): Promise<EmbeddingsTestResult> {
  const inputs = options.input.filter(entry => entry.trim());
  if (!inputs.length) throw new Error("Provide at least one input to embed.");

  const request = buildEmbeddingsRequest({ ...options, input: inputs });
  const started = Date.now();
  try {
    const response = await axios({
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

    const vectors = parseEmbeddingsResponse(options.provider, response.data);
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

    const similarities: Array<{ a: number; b: number; score: number }> = [];
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        similarities.push({ a: i, b: j, score: Math.round(cosineSimilarity(vectors[i], vectors[j]) * 10000) / 10000 });
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
  } catch (error) {
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

export interface VectorSearchResult {
  ok: boolean;
  matches: VectorMatch[];
  latencyMs: number;
  error?: string;
}

/** Queries a vector database, embedding the query text first when needed. */
export async function searchVectors(options: {
  db: VectorDbId;
  baseUrl: string;
  collection: string;
  topK: number;
  apiKey?: string;
  /** Either a ready-made vector, or text to embed with the embedding options. */
  vector?: number[];
  queryText?: string;
  embedding?: { provider: ProviderId; model: string; apiKey?: string; baseUrl?: string };
  timeoutMs?: number;
}): Promise<VectorSearchResult> {
  const started = Date.now();
  try {
    let vector = options.vector;
    if (!vector?.length) {
      if (!options.queryText?.trim()) throw new Error("Provide a query vector or query text to embed.");
      if (!options.embedding) throw new Error("Choose an embedding model so the query text can be vectorised.");
      const embedded = await testEmbeddings({
        provider: options.embedding.provider,
        model: options.embedding.model,
        apiKey: options.embedding.apiKey,
        baseUrl: options.embedding.baseUrl,
        input: [options.queryText],
        timeoutMs: options.timeoutMs
      });
      if (!embedded.ok) throw new Error(embedded.error || "Could not embed the query text.");
      // testEmbeddings only returns a preview, so fetch the full vector here.
      const request = buildEmbeddingsRequest({
        provider: options.embedding.provider,
        model: options.embedding.model,
        apiKey: options.embedding.apiKey,
        baseUrl: options.embedding.baseUrl,
        input: [options.queryText]
      });
      const response = await axios({
        method: request.method,
        url: request.url,
        headers: request.headers,
        data: request.body,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        validateStatus: () => true
      });
      vector = parseEmbeddingsResponse(options.embedding.provider, response.data)[0];
      if (!vector?.length) throw new Error("The embedding provider returned no vector for the query text.");
    }

    const request = buildVectorQuery({
      db: options.db,
      baseUrl: options.baseUrl,
      collection: options.collection,
      vector,
      topK: options.topK,
      apiKey: options.apiKey
    });
    const response = await axios({
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
    return { ok: true, matches: parseVectorResponse(options.db, response.data), latencyMs };
  } catch (error) {
    return { ok: false, matches: [], latencyMs: Date.now() - started, error: errorMessage(error) };
  }
}

export interface RagTestResult {
  ok: boolean;
  matches: VectorMatch[];
  answer: string;
  grounding: { score: number; supported: number; total: number };
  retrievalMs: number;
  generationMs: number;
  contextTokens: number;
  costUsd: number;
  error?: string;
}

/** Retrieves context, generates an answer with it, and scores the grounding. */
export async function testRagPipeline(options: {
  question: string;
  retrieval: Parameters<typeof searchVectors>[0];
  generation: AiCallOptions;
  /** Template with {{context}} and {{question}} placeholders. */
  promptTemplate?: string;
}): Promise<RagTestResult> {
  if (!options.question.trim()) throw new Error("Enter a question for the pipeline to answer.");

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

  const template =
    options.promptTemplate ||
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
      contextTokens: estimateTokens(context),
      costUsd: 0,
      error: `Generation failed - ${generation.error}`
    };
  }

  return {
    ok: true,
    matches: retrieval.matches,
    answer: generation.parsed.text,
    grounding: groundingScore(generation.parsed.text, context),
    retrievalMs: retrieval.latencyMs,
    generationMs: generation.latencyMs,
    contextTokens: estimateTokens(context),
    costUsd: generation.costUsd
  };
}

export interface AgentTurn {
  turn: number;
  assistantText: string;
  toolCalls: Array<{ name: string; arguments: string; result: string }>;
  latencyMs: number;
}

export interface AgentTestResult {
  ok: boolean;
  turns: AgentTurn[];
  finalAnswer: string;
  totalLatencyMs: number;
  totalCostUsd: number;
  stoppedBecause: "answered" | "max-turns" | "error";
  error?: string;
}

/**
 * Drives a tool-calling loop.
 *
 * Tool results come from a caller-supplied table of canned responses, so the
 * agent's decision-making can be tested without the extension executing
 * anything the model asks for.
 */
export async function testAgent(options: {
  base: AiCallOptions;
  tools: ToolDefinition[];
  /** name -> JSON string returned to the model when it calls that tool. */
  toolResponses: Record<string, string>;
  maxTurns?: number;
}): Promise<AgentTestResult> {
  const maxTurns = Math.max(1, Math.min(options.maxTurns ?? 5, 10));
  const messages: ChatMessage[] = [...options.base.messages];
  const turns: AgentTurn[] = [];
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
    const record: AgentTurn = {
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

export interface EvalCriteria {
  mustInclude?: string[];
  mustNotInclude?: string[];
  /** Validate the reply as JSON against this schema. */
  jsonSchema?: unknown;
  maxWords?: number;
  minWords?: number;
  /** Regular expression the reply must match. */
  pattern?: string;
}

export interface PromptEvalRow {
  label: string;
  ok: boolean;
  text: string;
  score: number;
  maxScore: number;
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  latencyMs: number;
  costUsd: number;
  error?: string;
}

/** Scores a model reply against declarative criteria. */
export function scoreAgainstCriteria(text: string, criteria: EvalCriteria): PromptEvalRow["checks"] {
  const checks: PromptEvalRow["checks"] = [];
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
    } catch (error) {
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
    const parsed = extractJson(text);
    if (!parsed.ok) {
      checks.push({ name: "valid JSON", passed: false, detail: parsed.error });
    } else {
      const violations = validateSchema(parsed.value, criteria.jsonSchema);
      checks.push({
        name: "matches JSON schema",
        passed: violations.length === 0,
        detail: violations.length ? violations.slice(0, 3).map(v => `${v.path} ${v.message}`).join("; ") : undefined
      });
    }
  }
  return checks;
}

/** Runs prompt variants against one model and scores each reply. */
export async function evaluatePrompts(options: {
  base: AiCallOptions;
  variants: Array<{ label: string; system?: string; user: string }>;
  criteria: EvalCriteria;
}): Promise<{ rows: PromptEvalRow[]; best?: string }> {
  if (!options.variants.length) throw new Error("Add at least one prompt variant to evaluate.");

  const rows = await Promise.all(
    options.variants.map(async variant => {
      const messages: ChatMessage[] = [];
      if (variant.system) messages.push({ role: "system", content: variant.system });
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
        } satisfies PromptEvalRow;
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
      } satisfies PromptEvalRow;
    })
  );

  const best = rows
    .filter(row => row.ok && row.maxScore > 0)
    .sort((a, b) => b.score / b.maxScore - a.score / a.maxScore || a.latencyMs - b.latencyMs)[0]?.label;
  return { rows, best };
}
