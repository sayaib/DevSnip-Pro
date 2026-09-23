import * as vscode from "vscode";
import { FeatureAccessError, FeatureAccessService } from "../premium/feature-access";
import {
  CATEGORY_GROUPS,
  CATEGORY_LABELS,
  FEATURE_GROUP_LABELS,
  getFeature
} from "../premium/feature-registry";
import { CollectionStore, SavedRequest } from "../services/collections";
import {
  benchmarkModel,
  callChat,
  compareModels,
  evaluatePrompts,
  streamChat,
  testAgent,
  testEmbeddings,
  testRagPipeline,
  searchVectors
} from "../services/ai-operations";
import {
  ChatMessage,
  PROVIDERS,
  ProviderId,
  buildChatRequest,
  estimateCost,
  estimateTokens
} from "../services/llm-providers";
import { VECTOR_DBS, VectorDbId } from "../services/vector-db";
import { CODE_LANGUAGES, CodeLanguage, generateClientCode, inspectJwt, requestOAuthToken } from "../services/dev-operations";
import { diffJson, extractJson, readPath, validateSchema } from "../services/json-tools";
import { AssertionSubject, parseAssertionRules, percentiles, runAssertions } from "../services/assertions";
import { getUserStats } from "./milestoneTracker";
import { CATEGORY_LABELS as SECURITY_AREA_LABELS } from "../services/security-analysis";
import { runEndpointScan } from "../services/security-probe";

/**
 * Bridges the REST API Client webview to the feature services.
 *
 * Two rules hold throughout this file:
 *
 *  1. Every handler runs inside `access.run(featureId, ...)`. The entitlement
 *     check happens here, in the extension host, immediately before the work -
 *     never in the webview, and never merely by hiding a control.
 *  2. Nothing trusts the message payload. Values are coerced and bounded
 *     before they reach a service.
 */

export interface FeatureContext {
  access: FeatureAccessService;
  collections: CollectionStore;
  extensionContext: vscode.ExtensionContext;
  /** Sends a message back to the webview, tolerating a disposed panel. */
  post: (message: unknown) => void;
  /** The client's own HTTP sender, reused so history and cookies stay shared. */
  sendHttp: (request: Record<string, unknown>) => Promise<any>;
}

type Handler = (message: Record<string, any>, context: FeatureContext) => Promise<unknown>;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asProvider(value: unknown): ProviderId {
  const id = asString(value, "openai") as ProviderId;
  return PROVIDERS.some(provider => provider.id === id) ? id : "openai";
}

function asVectorDb(value: unknown): VectorDbId {
  const id = asString(value, "qdrant") as VectorDbId;
  return VECTOR_DBS.some(db => db.id === id) ? id : "qdrant";
}

function asMessages(value: unknown, fallbackUser = ""): ChatMessage[] {
  if (Array.isArray(value)) {
    const messages = value
      .filter(entry => entry && typeof entry === "object")
      .map(entry => {
        const record = entry as Record<string, unknown>;
        const role = asString(record.role, "user");
        return {
          role: (["system", "user", "assistant", "tool"].includes(role) ? role : "user") as ChatMessage["role"],
          content: asString(record.content)
        };
      })
      .filter(message => message.content.trim());
    if (messages.length) return messages;
  }
  return fallbackUser.trim() ? [{ role: "user", content: fallbackUser }] : [];
}

/** Builds the chat options shared by every AI handler. */
function chatOptionsFrom(message: Record<string, any>): {
  provider: ProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs: number;
} {
  const provider = asProvider(message.provider);
  return {
    provider,
    model: asString(message.model) || PROVIDERS.find(entry => entry.id === provider)!.defaultModel,
    apiKey: asString(message.apiKey) || undefined,
    baseUrl: asString(message.baseUrl) || undefined,
    apiVersion: asString(message.apiVersion) || undefined,
    temperature: message.temperature === undefined ? undefined : asNumber(message.temperature, 0.7, 0, 2),
    maxTokens: message.maxTokens === undefined ? undefined : asNumber(message.maxTokens, 1024, 1, 32000),
    timeoutMs: asNumber(message.timeoutMs, 120000, 1000, 600000)
  };
}

/**
 * Records an AI call so the analytics feature has something to aggregate.
 * Prompts and keys are never stored - only the metadata needed for a total.
 */
const AI_LOG_KEY = "devsnip.apiClient.aiCallLog";
const AI_LOG_LIMIT = 500;

interface AiLogEntry {
  at: number;
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  feature: string;
}

async function logAiCall(context: FeatureContext, entry: AiLogEntry): Promise<void> {
  try {
    const existing = context.extensionContext.globalState.get<AiLogEntry[]>(AI_LOG_KEY, []);
    const next = [entry, ...(Array.isArray(existing) ? existing : [])].slice(0, AI_LOG_LIMIT);
    await context.extensionContext.globalState.update(AI_LOG_KEY, next);
  } catch (error) {
    console.error("DevSnip Pro: could not record the AI call.", error);
  }
}

function readAiLog(context: FeatureContext): AiLogEntry[] {
  const stored = context.extensionContext.globalState.get<unknown>(AI_LOG_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry): entry is AiLogEntry => Boolean(entry) && typeof entry === "object");
}

/** Prompt version history, used by the prompt-versioning feature. */
const PROMPT_VERSIONS_KEY = "devsnip.apiClient.promptVersions";

interface PromptVersion {
  version: number;
  text: string;
  note: string;
  savedAt: number;
}

// --------------------------------------------------------------- handlers

const handlers: Record<string, Handler> = {
  // ------------------------------------------------------ developer tools
  "feature:generateCode": async (message, context) =>
    context.access.run("code-generation", async () => {
      const language = asString(message.language, "javascript-fetch") as CodeLanguage;
      if (!CODE_LANGUAGES.some(entry => entry.id === language)) {
        throw new Error(`"${language}" is not a supported target language.`);
      }
      const headers: Record<string, string> = {};
      if (message.headers && typeof message.headers === "object") {
        for (const [key, value] of Object.entries(message.headers as Record<string, unknown>)) {
          if (typeof value === "string") headers[key] = value;
        }
      }
      const url = asString(message.url).trim();
      if (!url) throw new Error("Enter a request URL before generating code.");
      return {
        language,
        code: generateClientCode({ method: asString(message.method, "GET"), url, headers, body: asString(message.body) || undefined }, language)
      };
    }),

  /**
   * Authorises a WebSocket session. The page also cannot connect without the
   * connect-src allowance the host emits only for entitled users, so this is a
   * second layer rather than the only one.
   */
  "feature:websocketGrant": async (message, context) =>
    context.access.run("websocket-client", async () => {
      const url = asString(message.url).trim();
      if (!/^wss?:\/\//i.test(url)) throw new Error("Enter a ws:// or wss:// URL.");
      return { granted: true, url };
    }),

  "feature:inspectJwt": async (message, context) =>
    context.access.run("jwt-inspector", async () => {
      const token = asString(message.token).trim();
      if (!token) throw new Error("Paste a JWT to inspect.");
      return inspectJwt(token);
    }),

  "feature:jsonTools": async (message, context) =>
    context.access.run("json-tools", async () => {
      const action = asString(message.action, "format");
      const text = asString(message.text);
      if (!text.trim()) throw new Error("There is nothing to process. Paste JSON or send a request first.");

      if (action === "query") {
        const path = asString(message.path).trim();
        if (!path) throw new Error("Enter a JSON path such as data.items[0].id");
        const parsed = extractJson(text);
        if (!parsed.ok) throw new Error(`That is not valid JSON: ${parsed.error}`);
        const value = readPath(parsed.value, path);
        return { action, path, found: value !== undefined, result: JSON.stringify(value ?? null, null, 2) };
      }
      if (action === "validate") {
        const parsed = extractJson(text);
        if (!parsed.ok) return { action, valid: false, error: parsed.error };
        const schemaText = asString(message.schema).trim();
        if (!schemaText) return { action, valid: true, message: "Valid JSON." };
        let schema: unknown;
        try {
          schema = JSON.parse(schemaText);
        } catch (error) {
          throw new Error(`The schema itself is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        const violations = validateSchema(parsed.value, schema);
        return { action, valid: violations.length === 0, violations };
      }

      const parsed = extractJson(text);
      if (!parsed.ok) throw new Error(`That is not valid JSON: ${parsed.error}`);
      return {
        action,
        result: action === "minify" ? JSON.stringify(parsed.value) : JSON.stringify(parsed.value, null, 2)
      };
    }),

  // -------------------------------------------------------------- premium
  "feature:oauthToken": async (message, context) =>
    context.access.run("oauth2-helper", async () => {
      const grant = asString(message.grant, "client_credentials") as "client_credentials" | "password" | "refresh_token";
      if (!["client_credentials", "password", "refresh_token"].includes(grant)) {
        throw new Error(`"${grant}" is not a supported grant type.`);
      }
      const result = await requestOAuthToken({
        grant,
        tokenUrl: asString(message.tokenUrl),
        clientId: asString(message.clientId),
        clientSecret: asString(message.clientSecret) || undefined,
        scope: asString(message.scope) || undefined,
        username: asString(message.username) || undefined,
        password: asString(message.password) || undefined,
        refreshToken: asString(message.refreshToken) || undefined,
        useBasicAuth: message.useBasicAuth === true
      });

      // The access token goes to secret storage; the webview only ever gets a
      // masked preview plus a flag saying a token is available to apply.
      if (result.ok && result.accessToken) {
        await context.extensionContext.secrets.store("devsnip.apiClient.oauthAccessToken", result.accessToken);
      }
      return {
        ok: result.ok,
        error: result.error,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
        scope: result.scope,
        preview: result.safePreview,
        tokenAvailable: Boolean(result.ok && result.accessToken)
      };
    }),

  /** Moves the stored OAuth token into the request's Authorization header. */
  "feature:applyOauthToken": async (_message, context) =>
    context.access.run("oauth2-helper", async () => {
      const token = await context.extensionContext.secrets.get("devsnip.apiClient.oauthAccessToken");
      if (!token) throw new Error("Fetch a token first.");
      return { authType: "Bearer", authToken: token };
    }),

  "feature:runAssertions": async (message, context) =>
    context.access.run("assertions", async () => {
      const rules = parseAssertionRules(message.rules);
      if (!rules.length) throw new Error("Add at least one assertion.");
      const response = message.response as Record<string, any> | undefined;
      if (!response) throw new Error("Send a request first so there is a response to assert on.");

      const bodyText =
        typeof response.data === "string" ? response.data : JSON.stringify(response.data ?? null);
      const subject: AssertionSubject = {
        status: asNumber(response.status, 0, 0, 599),
        latencyMs: asNumber(response.responseTime, 0, 0, Number.MAX_SAFE_INTEGER),
        sizeBytes: Buffer.byteLength(bodyText, "utf8"),
        headers: (response.headers ?? {}) as Record<string, unknown>,
        body: typeof response.data === "string" ? extractJson(response.data).value ?? response.data : response.data,
        bodyText
      };
      return runAssertions(rules, subject);
    }),

  "feature:batchTest": async (message, context) =>
    context.access.run("batch-performance", async () => {
      const count = asNumber(message.count, 10, 1, 100);
      const concurrency = asNumber(message.concurrency, 5, 1, 25);
      const template = message.request as Record<string, unknown> | undefined;
      if (!template?.url) throw new Error("Configure a request before running a batch.");

      const latencies: number[] = [];
      const statuses: Record<string, number> = {};
      let failures = 0;
      const started = Date.now();

      for (let index = 0; index < count; index += concurrency) {
        const size = Math.min(concurrency, count - index);
        const results = await Promise.all(
          Array.from({ length: size }, async () => {
            const at = Date.now();
            try {
              const response = await context.sendHttp(template);
              latencies.push(Date.now() - at);
              const key = String(response?.status ?? 0);
              statuses[key] = (statuses[key] ?? 0) + 1;
              return response?.status < 500;
            } catch {
              latencies.push(Date.now() - at);
              failures++;
              statuses.error = (statuses.error ?? 0) + 1;
              return false;
            }
          })
        );
        void results;
      }

      const elapsed = Date.now() - started;
      const successes = count - failures - (statuses["500"] ?? 0);
      return {
        count,
        concurrency,
        elapsedMs: elapsed,
        requestsPerSecond: elapsed ? Math.round((count / elapsed) * 1000 * 10) / 10 : 0,
        successRate: Math.round((successes / count) * 100),
        statuses,
        latency: percentiles(latencies)
      };
    }),

  "feature:diffResponses": async (message, context) =>
    context.access.run("response-diff", async () => {
      const left = extractJson(asString(message.left));
      const right = extractJson(asString(message.right));
      if (!left.ok) throw new Error(`The first payload is not valid JSON: ${left.error}`);
      if (!right.ok) throw new Error(`The second payload is not valid JSON: ${right.error}`);
      const differences = diffJson(left.value, right.value);
      return {
        identical: differences.length === 0,
        total: differences.length,
        differences: differences.slice(0, 300).map(entry => ({
          ...entry,
          left: JSON.stringify(entry.left ?? null),
          right: JSON.stringify(entry.right ?? null)
        }))
      };
    }),

  // ---------------------------------------------------------- collections
  "feature:listCollections": async (_message, context) => {
    const limit = context.access.limitFor("collections-basic");
    return { requests: context.collections.list(), limit };
  },

  "feature:saveRequest": async (message, context) =>
    context.access.run("collections-basic", async () => context.collections.save(message.request)),

  "feature:deleteRequest": async (message, context) =>
    context.access.run("collections-basic", async () => ({
      total: await context.collections.delete(asString(message.id))
    })),

  "feature:exportCollection": async (_message, context) =>
    context.access.run("collections-advanced", async () => {
      const document = context.collections.export();
      const uri = await vscode.window.showSaveDialog({
        filters: { "JSON Files": ["json"] },
        defaultUri: vscode.Uri.file("devsnip-collection.json")
      });
      if (!uri) return { cancelled: true };
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(document, null, 2), "utf8"));
      return { cancelled: false, path: uri.fsPath, count: document.requests.length };
    }),

  "feature:importCollection": async (_message, context) =>
    context.access.run("collections-advanced", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { "JSON Files": ["json"] },
        title: "Import a DevSnip Pro collection"
      });
      if (!picked?.length) return { cancelled: true };
      const bytes = await vscode.workspace.fs.readFile(picked[0]);
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.from(bytes).toString("utf8"));
      } catch (error) {
        throw new Error(`That file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { cancelled: false, ...(await context.collections.import(payload)) };
    }),

  "feature:runChain": async (message, context) =>
    context.access.run("request-chaining", async () => {
      const ids: string[] = Array.isArray(message.ids) ? message.ids.filter((id: unknown) => typeof id === "string") : [];
      if (!ids.length) throw new Error("Choose at least one saved request to run.");

      const variables: Record<string, string> = {};
      const steps: Array<Record<string, unknown>> = [];

      for (const id of ids) {
        const saved: SavedRequest | undefined = context.collections.get(id);
        if (!saved) {
          steps.push({ id, name: id, ok: false, error: "This saved request no longer exists." });
          break;
        }

        // Substitute values captured by earlier steps.
        const substitute = (text: string) =>
          text.replace(/\{\{(\w+)\}\}/g, (match, name) => variables[name] ?? match);
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(saved.headers)) headers[key] = substitute(value);
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(saved.params)) params[key] = substitute(value);

        const started = Date.now();
        try {
          const response = await context.sendHttp({
            method: saved.method,
            url: substitute(saved.url),
            headers,
            params,
            data: saved.body ? substitute(saved.body) : undefined,
            bodyType: saved.bodyType
          });

          const body = typeof response?.data === "string" ? extractJson(response.data).value : response?.data;
          const captured: Record<string, string> = {};
          for (const [name, path] of Object.entries(saved.extract ?? {})) {
            const value = readPath(body, path);
            if (value !== undefined) {
              const text = typeof value === "string" ? value : JSON.stringify(value);
              variables[name] = text;
              captured[name] = text.slice(0, 200);
            }
          }

          steps.push({
            id,
            name: saved.name,
            ok: response?.status >= 200 && response?.status < 400,
            status: response?.status,
            latencyMs: Date.now() - started,
            captured
          });

          if (!(response?.status >= 200 && response?.status < 400)) break;
        } catch (error: any) {
          steps.push({
            id,
            name: saved.name,
            ok: false,
            latencyMs: Date.now() - started,
            error: error?.message ? String(error.message) : "The step failed."
          });
          break;
        }
      }

      return { steps, variables, completed: steps.every(step => step.ok) };
    }),

  // ------------------------------------------------------------- AI / ML
  "feature:estimateTokens": async (message, context) =>
    context.access.run("token-analysis", async () => {
      const options = chatOptionsFrom(message);
      const messages = asMessages(message.messages, asString(message.prompt));
      const promptText = messages.map(entry => entry.content).join("\n");
      const promptTokens = estimateTokens(promptText);
      const expectedCompletion = asNumber(message.expectedCompletionTokens, 500, 0, 32000);
      const cost = estimateCost(options.model, { promptTokens, completionTokens: expectedCompletion });
      return {
        model: options.model,
        promptTokens,
        expectedCompletion,
        totalTokens: promptTokens + expectedCompletion,
        costUsd: cost.usd,
        costKnown: cost.known,
        preview: buildChatRequest({ ...options, messages }).url
      };
    }),

  "feature:llmRequest": async (message, context) => {
    const featureId = asString(message.featureId, "llm-request") === "prompt-test" ? "prompt-test" : "llm-request";
    return context.access.run(featureId, async () => {
      const options = chatOptionsFrom(message);
      const messages = asMessages(message.messages, asString(message.prompt));
      if (!messages.length) throw new Error("Enter a prompt to send.");

      const result = await callChat({ ...options, messages, jsonMode: message.jsonMode === true });
      await logAiCall(context, {
        at: Date.now(),
        provider: options.provider,
        model: options.model,
        ok: result.ok,
        latencyMs: result.latencyMs,
        promptTokens: result.parsed.usage.promptTokens ?? 0,
        completionTokens: result.parsed.usage.completionTokens ?? 0,
        costUsd: result.costUsd,
        feature: featureId
      });

      if (!result.ok) throw new Error(result.error || "The AI request failed.");
      return {
        text: result.parsed.text,
        usage: result.parsed.usage,
        finishReason: result.parsed.finishReason,
        model: result.parsed.model ?? options.model,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
        costKnown: result.costKnown,
        raw: result.raw
      };
    });
  },

  "feature:validateAiJson": async (message, context) =>
    context.access.run("ai-schema-validation", async () => {
      const text = asString(message.text);
      if (!text.trim()) throw new Error("Run a prompt first, or paste the model output to validate.");
      const parsed = extractJson(text);
      if (!parsed.ok) return { valid: false, parseError: parsed.error };
      const schemaText = asString(message.schema).trim();
      if (!schemaText) return { valid: true, parsed: JSON.stringify(parsed.value, null, 2) };
      let schema: unknown;
      try {
        schema = JSON.parse(schemaText);
      } catch (error) {
        throw new Error(`The schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      const violations = validateSchema(parsed.value, schema);
      return { valid: violations.length === 0, violations, parsed: JSON.stringify(parsed.value, null, 2) };
    }),

  "feature:compareModels": async (message, context) =>
    context.access.run("llm-compare", async () => {
      const targets = Array.isArray(message.targets) ? message.targets : [];
      if (targets.length < 2) throw new Error("Choose at least two models to compare.");
      const messages = asMessages(message.messages, asString(message.prompt));
      if (!messages.length) throw new Error("Enter a prompt to compare.");

      const result = await compareModels(
        targets.slice(0, 6).map((target: Record<string, unknown>) => ({
          label: asString(target.label),
          provider: asProvider(target.provider),
          model: asString(target.model),
          apiKey: asString(target.apiKey) || undefined,
          baseUrl: asString(target.baseUrl) || undefined,
          apiVersion: asString(target.apiVersion) || undefined
        })),
        messages,
        {
          temperature: message.temperature === undefined ? undefined : asNumber(message.temperature, 0.7, 0, 2),
          maxTokens: message.maxTokens === undefined ? undefined : asNumber(message.maxTokens, 1024, 1, 32000)
        }
      );

      for (const row of result.rows) {
        await logAiCall(context, {
          at: Date.now(),
          provider: row.provider,
          model: row.model,
          ok: row.ok,
          latencyMs: row.latencyMs,
          promptTokens: row.promptTokens ?? 0,
          completionTokens: row.completionTokens ?? 0,
          costUsd: row.costUsd,
          feature: "llm-compare"
        });
      }
      return result;
    }),

  "feature:benchmarkModel": async (message, context) =>
    context.access.run("llm-benchmark", async () => {
      const options = chatOptionsFrom(message);
      const messages = asMessages(message.messages, asString(message.prompt));
      if (!messages.length) throw new Error("Enter a prompt to benchmark.");
      return benchmarkModel(
        { ...options, messages },
        asNumber(message.runs, 5, 1, 50),
        asNumber(message.concurrency, 1, 1, 10)
      );
    }),

  "feature:testEmbeddings": async (message, context) =>
    context.access.run("embeddings-test", async () => {
      const inputs = Array.isArray(message.inputs)
        ? message.inputs.filter((entry: unknown) => typeof entry === "string" && entry.trim()).slice(0, 20)
        : [];
      if (!inputs.length) throw new Error("Add at least one input to embed.");
      return testEmbeddings({
        provider: asProvider(message.provider),
        model: asString(message.model, "text-embedding-3-small"),
        apiKey: asString(message.apiKey) || undefined,
        baseUrl: asString(message.baseUrl) || undefined,
        input: inputs
      });
    }),

  "feature:searchVectors": async (message, context) =>
    context.access.run("vector-search-test", async () => {
      const vector = Array.isArray(message.vector)
        ? message.vector.map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value))
        : undefined;
      return searchVectors({
        db: asVectorDb(message.db),
        baseUrl: asString(message.baseUrl),
        collection: asString(message.collection),
        topK: asNumber(message.topK, 5, 1, 50),
        apiKey: asString(message.apiKey) || undefined,
        vector,
        queryText: asString(message.queryText) || undefined,
        embedding: message.embeddingModel
          ? {
              provider: asProvider(message.embeddingProvider),
              model: asString(message.embeddingModel),
              apiKey: asString(message.embeddingApiKey) || asString(message.apiKey) || undefined,
              baseUrl: asString(message.embeddingBaseUrl) || undefined
            }
          : undefined
      });
    }),

  "feature:testRag": async (message, context) =>
    context.access.run("rag-pipeline-test", async () => {
      const generation = chatOptionsFrom(message);
      return testRagPipeline({
        question: asString(message.question),
        promptTemplate: asString(message.promptTemplate) || undefined,
        retrieval: {
          db: asVectorDb(message.db),
          baseUrl: asString(message.baseUrl),
          collection: asString(message.collection),
          topK: asNumber(message.topK, 4, 1, 20),
          apiKey: asString(message.vectorApiKey) || undefined,
          queryText: asString(message.question),
          embedding: {
            provider: asProvider(message.embeddingProvider),
            model: asString(message.embeddingModel, "text-embedding-3-small"),
            apiKey: asString(message.embeddingApiKey) || asString(message.apiKey) || undefined,
            baseUrl: asString(message.embeddingBaseUrl) || undefined
          }
        },
        generation: { ...generation, messages: [] }
      });
    }),

  "feature:testAgent": async (message, context) =>
    context.access.run("agent-test", async () => {
      const options = chatOptionsFrom(message);
      const tools = Array.isArray(message.tools)
        ? message.tools
            .filter((tool: unknown) => tool && typeof tool === "object")
            .slice(0, 10)
            .map((tool: Record<string, unknown>) => ({
              name: asString(tool.name, "tool"),
              description: asString(tool.description),
              parameters:
                tool.parameters && typeof tool.parameters === "object"
                  ? (tool.parameters as Record<string, unknown>)
                  : { type: "object", properties: {} }
            }))
        : [];
      if (!tools.length) throw new Error("Declare at least one tool for the agent to call.");

      const toolResponses: Record<string, string> = {};
      if (message.toolResponses && typeof message.toolResponses === "object") {
        for (const [name, value] of Object.entries(message.toolResponses as Record<string, unknown>)) {
          if (typeof value === "string") toolResponses[name] = value;
        }
      }

      return testAgent({
        base: { ...options, messages: asMessages(message.messages, asString(message.prompt)) },
        tools,
        toolResponses,
        maxTurns: asNumber(message.maxTurns, 5, 1, 10)
      });
    }),

  "feature:evaluatePrompts": async (message, context) =>
    context.access.run("prompt-eval", async () => {
      const options = chatOptionsFrom(message);
      const variants = Array.isArray(message.variants)
        ? message.variants
            .filter((entry: unknown) => entry && typeof entry === "object")
            .slice(0, 8)
            .map((entry: Record<string, unknown>, index: number) => ({
              label: asString(entry.label, `Variant ${index + 1}`),
              system: asString(entry.system) || undefined,
              user: asString(entry.user)
            }))
            .filter((variant: { user: string }) => variant.user.trim())
        : [];
      if (!variants.length) throw new Error("Add at least one prompt variant.");

      const criteriaInput = (message.criteria ?? {}) as Record<string, unknown>;
      let jsonSchema: unknown;
      const schemaText = asString(criteriaInput.jsonSchema).trim();
      if (schemaText) {
        try {
          jsonSchema = JSON.parse(schemaText);
        } catch (error) {
          throw new Error(`The evaluation schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return evaluatePrompts({
        base: { ...options, messages: [] },
        variants,
        criteria: {
          mustInclude: Array.isArray(criteriaInput.mustInclude)
            ? criteriaInput.mustInclude.filter((entry: unknown): entry is string => typeof entry === "string")
            : undefined,
          mustNotInclude: Array.isArray(criteriaInput.mustNotInclude)
            ? criteriaInput.mustNotInclude.filter((entry: unknown): entry is string => typeof entry === "string")
            : undefined,
          pattern: asString(criteriaInput.pattern) || undefined,
          minWords: criteriaInput.minWords === undefined ? undefined : asNumber(criteriaInput.minWords, 0, 0, 100000),
          maxWords: criteriaInput.maxWords === undefined ? undefined : asNumber(criteriaInput.maxWords, 0, 0, 100000),
          jsonSchema
        }
      });
    }),

  "feature:savePromptVersion": async (message, context) =>
    context.access.run("prompt-versioning", async () => {
      const name = asString(message.name).trim();
      const text = asString(message.text);
      if (!name) throw new Error("Give the prompt a name so its versions can be tracked.");
      if (!text.trim()) throw new Error("There is no prompt text to save.");

      const store = context.extensionContext.globalState.get<Record<string, PromptVersion[]>>(PROMPT_VERSIONS_KEY, {});
      const history = Array.isArray(store[name]) ? store[name] : [];
      const version: PromptVersion = {
        version: (history[0]?.version ?? 0) + 1,
        text,
        note: asString(message.note).slice(0, 200),
        savedAt: Date.now()
      };
      const next = { ...store, [name]: [version, ...history].slice(0, 50) };
      await context.extensionContext.globalState.update(PROMPT_VERSIONS_KEY, next);
      return { name, version: version.version, total: next[name].length };
    }),

  "feature:listPromptVersions": async (message, context) =>
    context.access.run("prompt-versioning", async () => {
      const store = context.extensionContext.globalState.get<Record<string, PromptVersion[]>>(PROMPT_VERSIONS_KEY, {});
      const name = asString(message.name).trim();
      if (!name) return { names: Object.keys(store), versions: [] };
      return { names: Object.keys(store), versions: store[name] ?? [] };
    }),

  "feature:diffPromptVersions": async (message, context) =>
    context.access.run("prompt-versioning", async () => {
      const store = context.extensionContext.globalState.get<Record<string, PromptVersion[]>>(PROMPT_VERSIONS_KEY, {});
      const history = store[asString(message.name)] ?? [];
      const left = history.find(entry => entry.version === asNumber(message.left, 0, 0, 10000));
      const right = history.find(entry => entry.version === asNumber(message.right, 0, 0, 10000));
      if (!left || !right) throw new Error("Pick two saved versions to compare.");

      // Line-level diff, enough to see what changed in a prompt.
      const leftLines = left.text.split("\n");
      const rightLines = right.text.split("\n");
      const rows: Array<{ kind: "same" | "added" | "removed"; text: string }> = [];
      const max = Math.max(leftLines.length, rightLines.length);
      for (let index = 0; index < max; index++) {
        const a = leftLines[index];
        const b = rightLines[index];
        if (a === b) {
          if (a !== undefined) rows.push({ kind: "same", text: a });
        } else {
          if (a !== undefined) rows.push({ kind: "removed", text: a });
          if (b !== undefined) rows.push({ kind: "added", text: b });
        }
      }
      return { left: left.version, right: right.version, rows };
    }),

  "feature:aiAnalytics": async (_message, context) =>
    context.access.run("ai-history-analytics", async () => {
      const entries = readAiLog(context);
      if (!entries.length) return { empty: true, models: [], totals: null };

      const byModel = new Map<string, { provider: string; model: string; calls: number; failures: number; promptTokens: number; completionTokens: number; costUsd: number; latencies: number[] }>();
      for (const entry of entries) {
        const key = `${entry.provider}/${entry.model}`;
        const bucket = byModel.get(key) ?? {
          provider: entry.provider,
          model: entry.model,
          calls: 0,
          failures: 0,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          latencies: []
        };
        bucket.calls++;
        if (!entry.ok) bucket.failures++;
        bucket.promptTokens += entry.promptTokens;
        bucket.completionTokens += entry.completionTokens;
        bucket.costUsd += entry.costUsd;
        bucket.latencies.push(entry.latencyMs);
        byModel.set(key, bucket);
      }

      const models = [...byModel.values()]
        .map(bucket => ({
          provider: bucket.provider,
          model: bucket.model,
          calls: bucket.calls,
          failureRate: Math.round((bucket.failures / bucket.calls) * 100),
          promptTokens: bucket.promptTokens,
          completionTokens: bucket.completionTokens,
          costUsd: Math.round(bucket.costUsd * 10000) / 10000,
          latency: percentiles(bucket.latencies)
        }))
        .sort((a, b) => b.calls - a.calls);

      return {
        empty: false,
        models,
        totals: {
          calls: entries.length,
          costUsd: Math.round(entries.reduce((sum, entry) => sum + entry.costUsd, 0) * 10000) / 10000,
          tokens: entries.reduce((sum, entry) => sum + entry.promptTokens + entry.completionTokens, 0),
          failureRate: Math.round((entries.filter(entry => !entry.ok).length / entries.length) * 100)
        }
      };
    }),

  "feature:clearAiAnalytics": async (_message, context) =>
    context.access.run("ai-history-analytics", async () => {
      await context.extensionContext.globalState.update(AI_LOG_KEY, []);
      return { cleared: true };
    })
};

/** Streaming needs to push many messages, so it is handled outside the table. */
async function handleStream(message: Record<string, any>, context: FeatureContext): Promise<void> {
  const wantsDiagnostics = message.diagnostics === true;
  const featureId = wantsDiagnostics ? "streaming-diagnostics" : "llm-streaming";

  try {
    await context.access.run(featureId, async () => {
      const options = chatOptionsFrom(message);
      const messages = asMessages(message.messages, asString(message.prompt));
      if (!messages.length) throw new Error("Enter a prompt to stream.");

      context.post({ command: "featureStreamStart", featureId });
      const result = await streamChat({ ...options, messages }, event => {
        if (event.type === "delta") context.post({ command: "featureStreamDelta", text: event.text });
        else if (event.type === "error") context.post({ command: "featureStreamError", error: event.error });
      });

      await logAiCall(context, {
        at: Date.now(),
        provider: options.provider,
        model: options.model,
        ok: !result.error,
        latencyMs: result.diagnostics.totalMs,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        feature: featureId
      });

      context.post({
        command: "featureStreamDone",
        featureId,
        text: result.text,
        error: result.error,
        // Detailed timings are the premium half of streaming.
        diagnostics: wantsDiagnostics ? result.diagnostics : { totalMs: result.diagnostics.totalMs, characters: result.diagnostics.characters }
      });
      if (result.error) throw new Error(result.error);
      return result;
    });
  } catch (error) {
    context.post({
      command: "featureError",
      featureId,
      ...describeError(error)
    });
  }
}

function describeError(error: unknown): {
  error: string;
  denial?: string;
  pointCost?: number;
  pointBalance?: number;
  pointsShort?: number;
  upgradeable?: boolean;
} {
  if (error instanceof FeatureAccessError) {
    const decision = error.decision;
    return {
      error: decision.message || "This feature is not available.",
      denial: decision.reason,
      pointCost: decision.pointCost,
      pointBalance: decision.pointBalance,
      pointsShort: decision.pointsShort,
      upgradeable: decision.reason === "insufficient-points"
    };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

/**
 * Entry point used by the REST API Client's message loop.
 * Returns true when the message belonged to the feature system.
 */
export async function handleFeatureMessage(
  message: Record<string, any>,
  context: FeatureContext
): Promise<boolean> {
  const command = asString(message?.command);
  if (!command.startsWith("feature:")) return false;

  if (command === "feature:stream") {
    await handleStream(message, context);
    return true;
  }

  if (command === "feature:getCatalog") {
    context.post({ command: "featureCatalog", ...buildCatalog(context) });
    return true;
  }

  // Re-reads the balance and every access decision.
  if (command === "feature:refresh") {
    context.post({ command: "featureCatalog", ...buildCatalog(context) });
    return true;
  }

  // Opens the tracker, where points are earned and the daily bonus is claimed.
  if (command === "feature:openPointsTracker") {
    await vscode.commands.executeCommand("sayaib.hue-console.milestoneTracker");
    context.post({ command: "featureCatalog", ...buildCatalog(context) });
    return true;
  }

  if (command === "feature:unlockWithPoints") {
    await handlePointUnlock(message, context);
    return true;
  }

  const handler = handlers[command];
  if (!handler) {
    context.post({ command: "featureError", featureId: command, error: `Unsupported feature request "${command}".` });
    return true;
  }

  const targetFeature = asString(message.featureId) || command.replace("feature:", "");
  const chargeable = context.access.costFor(targetFeature);
  try {
    const result = await handler(message, context);
    context.post({
      command: "featureResult",
      featureId: targetFeature,
      requestId: asString(message.requestId),
      result,
      pointsCharged: chargeable,
      remainingPoints: getUserStats(context.extensionContext).totalPoints
    });
  } catch (error) {
    context.post({
      command: "featureError",
      featureId: targetFeature,
      requestId: asString(message.requestId),
      ...describeError(error),
      remainingPoints: getUserStats(context.extensionContext).totalPoints
    });
  }
  // The catalog carries usage counters, so refresh it after any metered call.
  context.post({ command: "featureCatalog", ...buildCatalog(context) });
  return true;
}

/**
 * One-off unlock with DevSnip Pro points, preserving the pre-subscription
 * behaviour for the four tools that were points-gated before.
 */
async function handlePointUnlock(message: Record<string, any>, context: FeatureContext): Promise<void> {
  const featureId = asString(message.featureId);
  const feature = getFeature(featureId);

  if (!feature) {
    context.post({ command: "featureError", featureId, error: "That feature does not exist." });
    return;
  }

  try {
    // access.run enforces the balance and charges the cost only once the work
    // has succeeded, so a failed run never costs the user anything.
    const result = await context.access.run(featureId, () => runPointUnlockedFeature(featureId, message, context));
    const stats = getUserStats(context.extensionContext);
    context.post({
      command: "featureResult",
      featureId,
      result,
      remainingPoints: stats.totalPoints,
      pointsCharged: context.access.costFor(featureId)
    });
  } catch (error) {
    const stats = getUserStats(context.extensionContext);
    context.post({
      command: "featureError",
      featureId,
      ...describeError(error),
      remainingPoints: stats.totalPoints
    });
  }
}

/**
 * Runs a points-unlocked tool.
 *
 * The caller wraps this in `access.run`, which enforces the points balance and
 * charges the cost once the work succeeds. The switch below is the whole set of
 * features reachable through this path.
 */
async function runPointUnlockedFeature(
  featureId: string,
  message: Record<string, any>,
  context: FeatureContext
): Promise<unknown> {
  const request = (message.request ?? {}) as Record<string, unknown>;
  const url = asString(request.url);
  const method = asString(request.method, "GET");

  switch (featureId) {
    case "security-headers-scan": {
      if (!url) throw new Error("Configure a request URL first.");
      // The client shares the Security section's engine rather than keeping a
      // second, weaker copy of the rules: the same scan, the same verdicts.
      const headers: Record<string, string> = {};
      if (request.headers && typeof request.headers === "object") {
        for (const [name, value] of Object.entries(request.headers as Record<string, unknown>)) {
          if (typeof value === "string" && value.trim()) headers[name] = value;
        }
      }
      const report = await runEndpointScan({
        url,
        method: "GET",
        headers,
        timeoutMs: 20000
      });
      const actionable = report.checks.filter(check => check.status === "fail" || check.status === "warn");
      return {
        url,
        grade: report.summary.grade,
        score: report.summary.score,
        durationMs: report.durationMs,
        counts: {
          failed: report.summary.failed,
          warnings: report.summary.warnings,
          passed: report.summary.passed,
          critical: report.summary.critical,
          high: report.summary.high,
          medium: report.summary.medium,
          low: report.summary.low
        },
        issues: actionable.map(check => ({
          status: check.status,
          severity: check.severity,
          area: SECURITY_AREA_LABELS[check.category] || check.category,
          title: check.title,
          detail: check.detail,
          evidence: check.evidence,
          remediation: check.remediation,
          reference: check.reference
        })),
        passed: report.checks.filter(check => check.status === "pass").map(check => check.title),
        notes: report.notes,
        verdict: actionable.length === 0
          ? `Every applicable check passed (grade ${report.summary.grade}).`
          : `${actionable.length} issue(s) to review - grade ${report.summary.grade}, score ${report.summary.score}/100.`,
        openFullScan: "Run the Security Hub (DevSnip Pro: Security Hub) for the full report, filters and export."
      };
    }

    case "load-test": {
      if (!url) throw new Error("Configure a request URL first.");
      const latencies: number[] = [];
      let successes = 0;
      const runs = 5;
      for (let index = 0; index < runs; index++) {
        const started = Date.now();
        try {
          const response = await context.sendHttp(request);
          latencies.push(Date.now() - started);
          if (response?.status < 500) successes++;
        } catch {
          latencies.push(Date.now() - started);
        }
      }
      return {
        url,
        method,
        runs,
        successRate: Math.round((successes / runs) * 100),
        latency: percentiles(latencies)
      };
    }

    case "sdk-export": {
      if (!url) throw new Error("Configure a request URL first.");
      const headers: Record<string, string> = {};
      if (request.headers && typeof request.headers === "object") {
        for (const [key, value] of Object.entries(request.headers as Record<string, unknown>)) {
          if (typeof value === "string") headers[key] = value;
        }
      }
      const body = asString(request.data) || undefined;
      return {
        typescript: generateClientCode({ method, url, headers, body }, "javascript-axios"),
        python: generateClientCode({ method, url, headers, body }, "python")
      };
    }

    case "mock-generator": {
      if (!url) throw new Error("Configure a request URL first.");
      const { generateMockServer } = await import("../services/dev-operations");
      return { code: generateMockServer({ method, url, body: asString(request.data) || undefined }) };
    }

    default:
      throw new Error(`"${featureId}" is not a points-unlockable feature.`);
  }
}

/**
 * The catalog the webview renders from.
 *
 * It carries the access decision for every feature, so the page never computes
 * entitlement - it only reflects what the host decided.
 */
export function buildCatalog(context: FeatureContext): Record<string, unknown> {
  const snapshot = context.access.snapshot();
  return {
    pointBalance: snapshot.pointBalance,
    categories: (Object.keys(CATEGORY_GROUPS) as Array<keyof typeof CATEGORY_GROUPS>).map(category => ({
      id: category,
      label: CATEGORY_LABELS[category],
      groups: CATEGORY_GROUPS[category].map(group => ({
        id: group,
        label: FEATURE_GROUP_LABELS[group],
        features: snapshot.features
          .filter(feature => feature.group === group)
          .map(feature => ({
            id: feature.id,
            name: feature.name,
            tier: feature.tier,
            description: feature.description,
            premiumBenefit: feature.premiumBenefit,
            locked: feature.locked,
            reason: feature.decision.reason,
            message: feature.decision.message,
            pointCost: feature.tier === "premium" ? feature.pointCost ?? 0 : 0,
            pointsShort: feature.decision.pointsShort,
            limit: feature.decision.limit
          }))
      }))
    })),
    providers: PROVIDERS.map(provider => ({
      id: provider.id,
      label: provider.label,
      defaultBaseUrl: provider.defaultBaseUrl,
      defaultModel: provider.defaultModel,
      requiresKey: provider.requiresKey,
      models: provider.models,
      docsUrl: provider.docsUrl
    })),
    vectorDbs: VECTOR_DBS,
    codeLanguages: CODE_LANGUAGES,
    developmentMode: false
  };
}
