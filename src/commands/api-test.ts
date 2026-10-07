import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import axios, { AxiosRequestConfig, CancelTokenSource } from "axios";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import { getUserStats, onDidChangePoints } from "./milestoneTracker";
import { safePostMessage } from "../utils/webview-ui";
import { FeatureAccessService } from "../premium/feature-access";
import { CollectionStore } from "../services/collections";
import { FeatureContext, buildCatalog, handleFeatureMessage } from "./api-client-features";
import { API_CLIENT_INIT_SCRIPT, API_CLIENT_SCRIPT, API_CLIENT_STYLES, apiClientMarkup } from "./api-client-webview";
import { setWebviewHtml } from "../theme/service";
import { reach } from "../onboarding/activation";

/**
 * What is needed to reopen a request from history. Values are the request's
 * templates (with {{variables}} unresolved); headers that carry a literal
 * credential are left out.
 */
interface HistorySnapshot {
  url?: string;
  headers?: RequestHeaders;
  data?: string;
  bodyType?: string;
  requestType?: string;
  graphqlQuery?: string;
  graphqlVariables?: string;
  graphqlOperationName?: string;
  authType?: string;
}

interface ApiHistoryItem {
  id: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  responseTime?: number;
  size?: number;
  attempts?: number;
  request?: HistorySnapshot;
}

/** A failed request explained in terms the user can act on. */
export interface RequestErrorDescription {
  title: string;
  hint: string;
  /** The request-builder area that most likely needs changing. */
  action?: "settings" | "auth" | "body" | "headers" | "env" | "url";
}

const SENSITIVE_NAME = /(auth|token|secret|password|passwd|pwd|key|cookie|session|signature|credential)/i;
const VARIABLE_ONLY = /^(Bearer\s+|Basic\s+)?\{\{\w+\}\}$/i;
const HISTORY_BODY_LIMIT = 20000;

/**
 * Turns a transport error (DNS, TLS, timeouts, ...) or a request-building
 * error into a short title, a suggestion and the place to fix it.
 */
export function describeRequestError(error: { message?: string; code?: string } | undefined, timeoutMs?: number): RequestErrorDescription {
  const message = String(error?.message ?? "");
  const code = String(error?.code ?? "");
  const has = (pattern: RegExp) => pattern.test(code) || pattern.test(message);

  if (/not defined in the active environment|no environment is selected/i.test(message)) {
    return { title: "Undefined variable", hint: message.replace(/^Invalid URL format:\s*/, "") + ". Define it in an environment, or select the environment that has it.", action: "env" };
  }
  if (/^Invalid URL format/i.test(message)) {
    return { title: "Invalid URL", hint: "Use a full http:// or https:// address, for example https://api.example.com/users.", action: "url" };
  }
  if (/Invalid JSON in request body/i.test(message)) {
    return { title: "The body is not valid JSON", hint: "Fix the JSON in the Body tab, or switch the body type to Text to send it as typed.", action: "body" };
  }
  if (/Invalid GraphQL variables/i.test(message)) {
    return { title: "GraphQL variables are not valid JSON", hint: "The Variables field must be a JSON object, for example { \"id\": 1 }." };
  }
  if (has(/ENOTFOUND|EAI_AGAIN/)) {
    return { title: "Could not find the server", hint: "The host name did not resolve. Check it for typos, check your network or VPN, and check the environment's base URL.", action: "url" };
  }
  if (has(/ECONNREFUSED/)) {
    return { title: "Connection refused", hint: "Nothing accepted the connection at that address. Is the server running, and is the port right?", action: "url" };
  }
  if (has(/ECONNABORTED|ETIMEDOUT|ESOCKETTIMEDOUT/) || /timeout/i.test(message)) {
    const limit = timeoutMs ? ` after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 100) / 10} s` : `${timeoutMs} ms`}` : "";
    return { title: `The request timed out${limit}`, hint: "The server did not answer in time. Raise the timeout in Settings, or check that the server is responding.", action: "settings" };
  }
  if (has(/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_TLS/)) {
    return { title: "SSL certificate problem", hint: "The server's certificate could not be verified. For a local or test server with a self-signed certificate, turn off certificate verification in Settings.", action: "settings" };
  }
  if (has(/EPROTO|wrong version number|ERR_SSL/)) {
    return { title: "TLS handshake failed", hint: "This often means https:// was used for a server that only speaks http://. Try http://, or check the port.", action: "url" };
  }
  if (has(/ERR_FR_TOO_MANY_REDIRECTS|Maximum number of redirects/)) {
    return { title: "Too many redirects", hint: "The server kept redirecting. Raise the limit or turn off following redirects in Settings to see the first response.", action: "settings" };
  }
  if (has(/ECONNRESET|socket hang up|EPIPE/)) {
    return { title: "The connection was closed", hint: "The server or a proxy dropped the connection before answering. Check http versus https, the proxy settings, and the server logs.", action: "settings" };
  }
  if (has(/EHOSTUNREACH|ENETUNREACH|ENETDOWN/)) {
    return { title: "Network unreachable", hint: "Your machine could not reach that network. Check your connection, VPN or firewall." };
  }
  if (has(/ERR_BAD_OPTION|proxy/i)) {
    return { title: "Proxy problem", hint: "The request could not go through the configured proxy. Check the proxy host and port in Settings.", action: "settings" };
  }
  return { title: "The request failed", hint: "No response was received. The details below come from the network layer." };
}

interface RequestHeaders {
  [key: string]: string;
}

interface ProxyConfig {
  host: string;
  port: number;
  auth?: { username: string; password: string };
}

type BodyType = 'json' | 'text' | 'form-urlencoded';

interface ApiRequest {
  method: string;
  url: string;
  data?: any;
  params?: RequestHeaders;
  headers?: RequestHeaders;
  authType?: string;
  authToken?: string;
  username?: string;
  password?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyLocation?: 'header' | 'query';
  timeout?: number;
  requestType?: 'rest' | 'graphql';
  graphqlQuery?: string;
  graphqlVariables?: string;
  graphqlOperationName?: string;
  bodyType?: BodyType;
  /** Number of automatic retries on network errors / retryable status codes (max 5). */
  retries?: number;
  /** Base delay in ms for exponential backoff between retries. */
  retryDelay?: number;
  /** HTTP status codes that should trigger a retry. Defaults to [429, 502, 503, 504]. */
  retryStatusCodes?: number[];
  /** Whether to follow HTTP redirects. Defaults to true. */
  followRedirects?: boolean;
  /** Max number of redirects to follow when followRedirects is true. */
  maxRedirects?: number;
  /** Set to false to disable SSL/TLS certificate verification. */
  rejectUnauthorized?: boolean;
  /** Explicit proxy configuration, or false to disable proxy usage entirely. */
  proxy?: ProxyConfig | false;
}

interface Environment {
  name: string;
  variables: { [key: string]: string };
}

interface RequestParts {
  finalUrl: string;
  headers: RequestHeaders;
  bodyData: any;
  auth?: { username: string; password: string };
}

/** POSIX single-quote escaping, exported so the quoting can be verified against a real shell in tests. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

class ApiTester {
  private history: ApiHistoryItem[] = [];
  private cookies: { [domain: string]: string[] } = {};
  private cancelTokenSource: CancelTokenSource | null = null;
  private readonly MAX_HISTORY_SIZE = 50;
  private readonly MAX_RESPONSE_DISPLAY_SIZE = 2 * 1024 * 1024; // 2MB
  private readonly DEFAULT_RETRY_STATUS_CODES = [429, 502, 503, 504];
  private environments: Environment[] = [];
  private activeEnvironmentIndex: number = -1;

  constructor(private context: vscode.ExtensionContext) {
    this.loadStoredData();
  }

  /** Default request timeout, from the `devsnip.apiTimeout` setting. */
  private get defaultTimeout(): number {
    const configured = vscode.workspace.getConfiguration("devsnip").get<number>("apiTimeout", 30000);
    return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 300000) : 30000;
  }

  private loadStoredData(): void {
    try {
      this.cookies = this.context.globalState.get<{ [domain: string]: string[] }>("cookies", {});
      this.history = this.context.globalState.get<ApiHistoryItem[]>("apiHistory", []);
      this.environments = this.context.globalState.get<Environment[]>("environments", []);
      this.activeEnvironmentIndex = this.context.globalState.get<number>("activeEnvironmentIndex", -1);
    } catch (error) {
      console.error("Failed to load stored data:", error);
      this.cookies = {};
      this.history = [];
      this.environments = [];
      this.activeEnvironmentIndex = -1;
    }
  }

  private async saveData(): Promise<void> {
    try {
      await Promise.all([
        this.context.globalState.update("cookies", this.cookies),
        this.context.globalState.update("apiHistory", this.history),
        this.context.globalState.update("environments", this.environments),
        this.context.globalState.update("activeEnvironmentIndex", this.activeEnvironmentIndex)
      ]);
    } catch (error) {
      console.error("Failed to save data:", error);
    }
  }

  public resolveVariables(text: string): string {
    if (!text || this.activeEnvironmentIndex < 0 || !this.environments[this.activeEnvironmentIndex]) {
      return text;
    }
    const env = this.environments[this.activeEnvironmentIndex];
    return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return env.variables[varName] !== undefined ? env.variables[varName] : match;
    });
  }

  public getEnvironments(): Environment[] {
    return this.environments;
  }

  public getActiveEnvironmentIndex(): number {
    return this.activeEnvironmentIndex;
  }

  /**
   * Creates or updates an environment. With `previousName` the environment of
   * that name is renamed in place, so it keeps its position (and stays active).
   */
  public async saveEnvironment(env: Environment, previousName?: string): Promise<void> {
    const name = typeof env?.name === "string" ? env.name.trim() : "";
    if (!name) throw new Error("An environment needs a name.");
    const variables: { [key: string]: string } = {};
    for (const [key, value] of Object.entries(env.variables ?? {})) {
      if (typeof key === "string" && key.trim()) variables[key.trim()] = String(value ?? "");
    }
    const clean: Environment = { name, variables };

    const renameIndex = previousName ? this.environments.findIndex(e => e.name === previousName) : -1;
    const existingIndex = renameIndex >= 0 ? renameIndex : this.environments.findIndex(e => e.name === name);
    if (existingIndex >= 0) {
      this.environments[existingIndex] = clean;
    } else {
      this.environments.push(clean);
    }
    await this.saveData();
  }

  public async deleteEnvironment(name: string): Promise<void> {
    this.environments = this.environments.filter(e => e.name !== name);
    if (this.activeEnvironmentIndex >= this.environments.length) {
      this.activeEnvironmentIndex = this.environments.length - 1;
    }
    await this.saveData();
  }

  public async setActiveEnvironment(index: number): Promise<void> {
    this.activeEnvironmentIndex = index;
    await this.saveData();
  }

  private validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Strips credential-looking query values before a URL is stored or exported.
   * API keys are commonly passed in the query string, and request history is
   * persisted to global state and can be exported to a file.
   */
  public static redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      let changed = false;
      for (const key of [...parsed.searchParams.keys()]) {
        if (/(key|token|secret|password|passwd|pwd|auth|signature|sig|credential)/i.test(key)) {
          parsed.searchParams.set(key, "[redacted]");
          changed = true;
        }
      }
      return changed ? parsed.toString() : url;
    } catch {
      return url;
    }
  }

  /** Strips query values that look like credentials, keeping {{variable}} references. */
  private static redactTemplateUrl(url: string): string {
    return url.replace(/([?&])([^=&#]*)=([^&#]*)/g, (match, sep, key, value) =>
      SENSITIVE_NAME.test(key) && !/^\{\{\w+\}\}$/.test(value) ? `${sep}${key}=[redacted]` : match
    );
  }

  /** The request as typed, minus anything that looks like a literal secret. */
  private static historySnapshot(request: ApiRequest): HistorySnapshot {
    const headers: RequestHeaders = {};
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      if (!SENSITIVE_NAME.test(key) || VARIABLE_ONLY.test(String(value).trim())) headers[key] = String(value);
    }
    const data = typeof request.data === "string" && request.data.length <= HISTORY_BODY_LIMIT ? request.data : undefined;
    const snapshot: HistorySnapshot = {
      headers,
      data,
      bodyType: request.bodyType,
      requestType: request.requestType,
      authType: request.authType || undefined
    };
    if (request.url.includes("{{")) snapshot.url = ApiTester.redactTemplateUrl(request.url);
    if (request.requestType === "graphql") {
      snapshot.graphqlQuery = (request.graphqlQuery ?? "").slice(0, HISTORY_BODY_LIMIT);
      snapshot.graphqlVariables = (request.graphqlVariables ?? "").slice(0, HISTORY_BODY_LIMIT);
      snapshot.graphqlOperationName = request.graphqlOperationName;
    }
    return snapshot;
  }

  private addToHistory(item: Omit<ApiHistoryItem, 'id'>): void {
    const historyItem: ApiHistoryItem = {
      ...item,
      url: ApiTester.redactUrl(item.url),
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    };
    
    this.history.unshift(historyItem);
    if (this.history.length > this.MAX_HISTORY_SIZE) {
      this.history = this.history.slice(0, this.MAX_HISTORY_SIZE);
    }
    this.saveData();
  }

  private getDomainFromUrl(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Resolves environment variables and computes the final URL, headers and body
   * for a given request without performing any network I/O. Shared by makeRequest()
   * and generateCurlCommand() so both stay perfectly in sync.
   */
  private buildRequestParts(request: ApiRequest): RequestParts {
    const resolvedUrl = this.resolveVariables(request.url);
    const resolvedHeaders: RequestHeaders = {};
    if (request.headers) {
      for (const [key, value] of Object.entries(request.headers)) {
        resolvedHeaders[this.resolveVariables(key)] = this.resolveVariables(value);
      }
    }
    const resolvedParams: RequestHeaders = {};
    if (request.params) {
      for (const [key, value] of Object.entries(request.params)) {
        resolvedParams[this.resolveVariables(key)] = this.resolveVariables(value);
      }
    }
    const resolvedData = request.data ? this.resolveVariables(request.data) : undefined;
    const resolvedAuthToken = request.authToken ? this.resolveVariables(request.authToken) : undefined;
    const resolvedUsername = request.username ? this.resolveVariables(request.username) : undefined;
    const resolvedPassword = request.password ? this.resolveVariables(request.password) : undefined;
    const resolvedApiKeyName = request.apiKeyName ? this.resolveVariables(request.apiKeyName) : undefined;
    const resolvedApiKeyValue = request.apiKeyValue ? this.resolveVariables(request.apiKeyValue) : undefined;

    // Validation. An unresolved {{variable}} (typically {{baseUrl}}) is the
    // most common cause of a bad URL, so name it rather than reporting a
    // generic format error. Elsewhere in a valid URL it is left in place.
    const unresolved = Array.from(new Set((resolvedUrl.match(/\{\{(\w+)\}\}/g) ?? [])));
    if (unresolved.length && !this.validateUrl(resolvedUrl)) {
      const env = this.activeEnvironmentIndex >= 0 ? this.environments[this.activeEnvironmentIndex] : undefined;
      throw new Error(
        `Invalid URL format: ${unresolved.join(", ")} ${unresolved.length > 1 ? "are" : "is"} ` +
        (env ? `not defined in the active environment "${env.name}"` : "used but no environment is selected")
      );
    }
    if (!this.validateUrl(resolvedUrl)) {
      throw new Error("Invalid URL format");
    }

    // API Key auth delivered via query string is merged in before the URL is built
    if (request.authType === "ApiKey" && request.apiKeyLocation === "query" && resolvedApiKeyName && resolvedApiKeyValue) {
      resolvedParams[resolvedApiKeyName] = resolvedApiKeyValue;
    }

    let finalUrl = resolvedUrl;
    if (Object.keys(resolvedParams).length > 0) {
      const parsedUrl = new URL(finalUrl);
      for (const [key, value] of Object.entries(resolvedParams)) {
        parsedUrl.searchParams.set(key, value);
      }
      finalUrl = parsedUrl.toString();
    }
    let finalData = resolvedData;
    let finalHeaders = { ...resolvedHeaders };

    if (request.requestType === 'graphql') {
      // For GraphQL, wrap query in JSON body
      const graphqlBody: any = {
        query: this.resolveVariables(request.graphqlQuery || resolvedData || '')
      };
      if (request.graphqlVariables) {
        try {
          graphqlBody.variables = JSON.parse(this.resolveVariables(request.graphqlVariables));
        } catch {
          throw new Error("Invalid GraphQL variables JSON");
        }
      }
      if (request.graphqlOperationName) {
        graphqlBody.operationName = this.resolveVariables(request.graphqlOperationName);
      }
      finalData = JSON.stringify(graphqlBody);
      finalHeaders['Content-Type'] = 'application/json';
    }

    // Handle request body for appropriate methods, honoring the requested body type
    let bodyData: any = undefined;
    if (["POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method.toUpperCase()) && finalData) {
      const contentType = Object.entries(finalHeaders)
        .find(([key]) => key.toLowerCase() === 'content-type')?.[1]?.toLowerCase() || '';
      const bodyType: BodyType = request.bodyType || 'json';

      if (bodyType === 'form-urlencoded') {
        let formObject: Record<string, any> | undefined;
        try {
          const parsed = JSON.parse(finalData);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            formObject = parsed;
          }
        } catch {
          // Not JSON - treat the raw text as an already-encoded form body (e.g. a=1&b=2)
        }
        if (formObject) {
          const usp = new URLSearchParams();
          for (const [k, v] of Object.entries(formObject)) usp.append(k, String(v));
          bodyData = usp.toString();
        } else {
          bodyData = finalData;
        }
        if (!finalHeaders['Content-Type']) {
          finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
      } else if (bodyType === 'text') {
        bodyData = finalData;
        if (!finalHeaders['Content-Type']) {
          finalHeaders['Content-Type'] = 'text/plain';
        }
      } else {
        try {
          bodyData = JSON.parse(finalData);
          if (!finalHeaders['Content-Type']) {
            finalHeaders['Content-Type'] = 'application/json';
          }
        } catch {
          if (contentType.includes('application/json')) {
            throw new Error("Invalid JSON in request body");
          }
          bodyData = finalData;
          if (!finalHeaders['Content-Type']) {
            finalHeaders['Content-Type'] = 'text/plain';
          }
        }
      }
    }

    // Handle authentication
    let auth: { username: string; password: string } | undefined;
    if (request.authType) {
      switch (request.authType) {
        case "Bearer":
          if (resolvedAuthToken) {
            finalHeaders['Authorization'] = `Bearer ${resolvedAuthToken}`;
          }
          break;
        case "Basic":
          if (resolvedUsername && resolvedPassword) {
            auth = { username: resolvedUsername, password: resolvedPassword };
          }
          break;
        case "ApiKey":
          if (request.apiKeyLocation !== "query" && resolvedApiKeyName && resolvedApiKeyValue) {
            finalHeaders[resolvedApiKeyName] = resolvedApiKeyValue;
          }
          break;
      }
    }

    return { finalUrl, headers: finalHeaders, bodyData, auth };
  }

  /**
   * Builds an equivalent cURL command for the given request (without sending it).
   * Includes any cookies currently stored for the target domain.
   */
  public generateCurlCommand(request: ApiRequest): string {
    const { finalUrl, headers, bodyData, auth } = this.buildRequestParts(request);
    const domain = this.getDomainFromUrl(finalUrl);
    const allHeaders = { ...headers };
    if (domain && this.cookies[domain]?.length && !Object.keys(allHeaders).some(h => h.toLowerCase() === 'cookie')) {
      allHeaders['Cookie'] = this.cookies[domain].join('; ');
    }

    const parts: string[] = ['curl', '-X', request.method.toUpperCase()];
    for (const [key, value] of Object.entries(allHeaders)) {
      parts.push('-H', shellQuote(`${key}: ${value}`));
    }
    if (auth) {
      parts.push('-u', shellQuote(`${auth.username}:${auth.password}`));
    }
    if (bodyData !== undefined) {
      const bodyStr = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      parts.push('-d', shellQuote(bodyStr));
    }
    parts.push(shellQuote(finalUrl));
    return parts.join(' ');
  }

  /**
   * Tokenizes a shell-style command line, respecting single/double quotes.
   */
  private tokenizeShellCommand(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: string | null = null;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quote) {
        if (ch === quote) {
          quote = null;
        } else if (ch === '\\' && quote === '"' && i + 1 < input.length) {
          current += input[++i];
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '\\' && input[i + 1] === '\n') {
        i++; // line continuation
      } else if (/\s/.test(ch)) {
        if (current) { tokens.push(current); current = ''; }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  /**
   * Parses a cURL command (as copied from a browser, Postman, etc.) into a partial
   * ApiRequest that can be merged into the request form.
   */
  public parseCurlCommand(curlCommand: string): Partial<ApiRequest> {
    const tokens = this.tokenizeShellCommand(curlCommand.trim());
    if (!tokens.length || tokens[0].toLowerCase() !== 'curl') {
      throw new Error("Not a valid cURL command");
    }

    const result: Partial<ApiRequest> = { headers: {} };
    let url: string | undefined;

    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      switch (tok) {
        case '-X':
        case '--request':
          result.method = (tokens[++i] || 'GET').toUpperCase();
          break;
        case '-H':
        case '--header': {
          const headerVal = tokens[++i] || '';
          const idx = headerVal.indexOf(':');
          if (idx > -1) {
            result.headers![headerVal.slice(0, idx).trim()] = headerVal.slice(idx + 1).trim();
          }
          break;
        }
        case '-d':
        case '--data':
        case '--data-raw':
        case '--data-binary':
        case '--data-urlencode':
          result.data = tokens[++i];
          if (!result.method) result.method = 'POST';
          break;
        case '-u':
        case '--user': {
          const cred = tokens[++i] || '';
          const sepIdx = cred.indexOf(':');
          result.authType = 'Basic';
          result.username = sepIdx > -1 ? cred.slice(0, sepIdx) : cred;
          result.password = sepIdx > -1 ? cred.slice(sepIdx + 1) : '';
          break;
        }
        case '-b':
        case '--cookie':
          result.headers!['Cookie'] = tokens[++i] || '';
          break;
        case '-A':
        case '--user-agent':
          result.headers!['User-Agent'] = tokens[++i] || '';
          break;
        case '-k':
        case '--insecure':
          result.rejectUnauthorized = false;
          break;
        case '-L':
        case '--location':
          result.followRedirects = true;
          break;
        case '-x':
        case '--proxy': {
          const proxyVal = tokens[++i] || '';
          try {
            const proxyUrl = new URL(proxyVal.includes('://') ? proxyVal : `http://${proxyVal}`);
            result.proxy = {
              host: proxyUrl.hostname,
              port: proxyUrl.port ? parseInt(proxyUrl.port, 10) : 8080,
              auth: proxyUrl.username ? { username: proxyUrl.username, password: proxyUrl.password } : undefined
            };
          } catch {
            // Ignore malformed proxy value
          }
          break;
        }
        default:
          if (!tok.startsWith('-') && !url) {
            url = tok;
          }
          break;
      }
    }

    if (!url) throw new Error("No URL found in cURL command");
    result.url = url;
    if (!result.method) result.method = 'GET';
    return result;
  }

  /**
   * Exports the full stored request history as JSON or CSV.
   */
  public exportHistory(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const header = 'id,method,url,status,responseTime,size,attempts,timestamp';
      const rows = this.history.map(h => [
        h.id,
        h.method,
        JSON.stringify(h.url),
        h.status ?? '',
        h.responseTime ?? '',
        h.size ?? '',
        h.attempts ?? 1,
        new Date(h.timestamp).toISOString()
      ].join(','));
      return [header, ...rows].join('\n');
    }
    // The reopen snapshot is for this machine only; exports keep the summary.
    return JSON.stringify(this.history.map(({ request: _snapshot, ...summary }) => summary), null, 2);
  }

  public async makeRequest(request: ApiRequest): Promise<any> {
    const { finalUrl, headers, bodyData, auth } = this.buildRequestParts(request);

    // Cancel previous request if exists
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel("New request initiated");
    }
    this.cancelTokenSource = axios.CancelToken.source();

    const domain = this.getDomainFromUrl(finalUrl);
    const requestHeaders: RequestHeaders = {
      'User-Agent': 'DevSnip-Pro API Tester',
      ...headers
    };
    if (domain && this.cookies[domain]?.length) {
      requestHeaders['Cookie'] = this.cookies[domain].join("; ");
    }

    const maxRedirects = request.followRedirects === false ? 0 : Math.max(0, request.maxRedirects ?? 5);
    const httpsAgent = request.rejectUnauthorized === false
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    const config: AxiosRequestConfig = {
      method: request.method as any,
      url: finalUrl,
      timeout: Number.isFinite(request.timeout) && (request.timeout as number) > 0
        ? Math.min(request.timeout as number, 300000)
        : this.defaultTimeout,
      validateStatus: () => true,
      cancelToken: this.cancelTokenSource.token,
      headers: requestHeaders,
      maxRedirects,
      data: bodyData,
      auth,
      ...(httpsAgent ? { httpsAgent } : {}),
      ...(request.proxy === false ? { proxy: false } : request.proxy ? { proxy: request.proxy } : {})
    };

    const maxRetries = Math.max(0, Math.min(request.retries ?? 0, 5));
    const retryStatusCodes = request.retryStatusCodes && request.retryStatusCodes.length
      ? request.retryStatusCodes
      : this.DEFAULT_RETRY_STATUS_CODES;
    const baseDelay = Math.max(0, request.retryDelay ?? 500);

    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      try {
        const response = await axios(config);

        if (attempt < maxRetries && retryStatusCodes.includes(response.status)) {
          attempt++;
          await this.delay(baseDelay * Math.pow(2, attempt - 1));
          continue;
        }

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        // Calculate response size
        const serializedResponse = typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data ?? '');
        const responseSize = Buffer.byteLength(serializedResponse, 'utf8');

        let responseData = response.data;
        let truncated = false;
        if (responseSize > this.MAX_RESPONSE_DISPLAY_SIZE) {
          truncated = true;
          responseData = typeof response.data === 'string'
            ? response.data.slice(0, this.MAX_RESPONSE_DISPLAY_SIZE) + '\n... [response truncated]'
            : response.data;
        }

        // Store cookies from response
        if (response.headers["set-cookie"]) {
          const existingCookies = this.cookies[domain] || [];
          const newCookies = response.headers["set-cookie"]
            .map(cookie => cookie.split(';', 1)[0])
            .filter(Boolean);
          this.cookies[domain] = Array.from(new Set([...existingCookies, ...newCookies]));
          this.saveData();
        }

        // Add to history
        this.addToHistory({
          url: finalUrl,
          method: request.method,
          timestamp: Date.now(),
          status: response.status,
          responseTime,
          size: responseSize,
          attempts: attempt + 1,
          request: ApiTester.historySnapshot(request)
        });

        return {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          data: responseData,
          responseTime,
          size: this.formatBytes(responseSize),
          truncated,
          attempts: attempt + 1,
          history: this.getAllHistory()
        };
      } catch (error: any) {
        if (axios.isCancel(error)) {
          throw { message: "Request was cancelled", cancelled: true };
        }

        const isNetworkError = !error.response;
        const errorStatus = error.response?.status || 0;
        const canRetry = attempt < maxRetries && (isNetworkError || retryStatusCodes.includes(errorStatus));

        if (canRetry) {
          attempt++;
          await this.delay(baseDelay * Math.pow(2, attempt - 1));
          continue;
        }

        const endTime = Date.now();
        const responseTime = endTime - startTime;
        // Add failed request to history
        this.addToHistory({
          url: finalUrl,
          method: request.method,
          timestamp: Date.now(),
          status: errorStatus,
          responseTime,
          attempts: attempt + 1,
          request: ApiTester.historySnapshot(request)
        });

        throw {
          message: error.message,
          code: error.code,
          timeout: config.timeout,
          status: errorStatus,
          response: error.response?.data,
          responseTime,
          attempts: attempt + 1
        };
      }
    }
  }

  public cancelCurrentRequest(): void {
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel("Request cancelled by user");
      this.cancelTokenSource = null;
    }
  }

  public getCookies(): { [domain: string]: string[] } {
    return this.cookies;
  }

  public clearHistory(): void {
    this.history = [];
    this.saveData();
  }

  public clearCookies(): void {
    this.cookies = {};
    this.saveData();
  }

  public getHistory(): ApiHistoryItem[] {
    return this.history.slice(0, 10);
  }

  /** Everything kept (up to MAX_HISTORY_SIZE), for the sidebar. */
  public getAllHistory(): ApiHistoryItem[] {
    return this.history.slice();
  }
}

export { ApiTester };

/** Builds an ApiRequest object from a raw webview message payload. */
function buildApiRequestFromMessage(message: any): ApiRequest {
  return {
    method: message.method,
    url: message.url,
    data: message.data,
    params: message.params,
    headers: message.headers,
    authType: message.authType,
    authToken: message.authToken,
    username: message.username,
    password: message.password,
    apiKeyName: message.apiKeyName,
    apiKeyValue: message.apiKeyValue,
    apiKeyLocation: message.apiKeyLocation,
    timeout: message.timeout,
    requestType: message.requestType,
    graphqlQuery: message.graphqlQuery,
    graphqlVariables: message.graphqlVariables,
    graphqlOperationName: message.graphqlOperationName,
    bodyType: message.bodyType,
    retries: message.retries,
    retryDelay: message.retryDelay,
    retryStatusCodes: message.retryStatusCodes,
    followRedirects: message.followRedirects,
    maxRedirects: message.maxRedirects,
    rejectUnauthorized: message.rejectUnauthorized,
    proxy: message.proxy
  };
}

export interface ApiClientServices {
  access: FeatureAccessService;
  collections: CollectionStore;
}

export function apiTest(context: vscode.ExtensionContext, services: ApiClientServices) {
  const apiTester = new ApiTester(context);
  let activePanel: vscode.WebviewPanel | undefined;

  const disposable = registerTrackedCommand(
    "sayaib.hue-console.openGUI",
    () => {
      // A single ApiTester backs the client (shared history, cookies and one
      // cancel token), so a second panel would cancel the first panel's
      // request. Reveal the existing panel instead.
      if (activePanel) {
        activePanel.reveal(vscode.ViewColumn.One);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "apiTester",
        "REST API Client",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(context.extensionPath)]
        }
      );

      activePanel = panel;
      const iconPath = path.resolve(context.extensionPath, "logo.png");
      panel.iconPath = vscode.Uri.file(iconPath);
      setWebviewHtml(panel.webview, getWebviewContent(apiTester.getHistory(), services.access.check("websocket-client").allowed));
      const post = (message: unknown) => safePostMessage(panel, message);

      // Everything the Free/Premium feature system needs. `sendHttp` reuses the
      // client's own sender so batch runs and chains share history and cookies.
      const featureContext: FeatureContext = {
        access: services.access,
        collections: services.collections,
        extensionContext: context,
        post,
        sendHttp: (request) => apiTester.makeRequest(buildApiRequestFromMessage(request))
      };

      // Premium tools are paid for with points, so the whole catalog - balance,
      // prices and affordability - is republished whenever the balance moves.
      let webSocketsAllowed = services.access.check("websocket-client").allowed;
      const pointsSubscription = onDidChangePoints(() => {
        const nowAllowed = services.access.check("websocket-client").allowed;
        if (nowAllowed !== webSocketsAllowed) {
          // The WebSocket allowance is baked into the document's CSP, so the
          // page has to be rebuilt when affordability crosses that threshold.
          webSocketsAllowed = nowAllowed;
          setWebviewHtml(panel.webview, getWebviewContent(apiTester.getHistory(), nowAllowed));
          return;
        }
        post({ command: "featureCatalog", ...buildCatalog(featureContext) });
      });

      post({ command: "featureCatalog", ...buildCatalog(featureContext) });

      const messageSubscription = panel.webview.onDidReceiveMessage(
        async (message) => {
          if (!message || typeof message.command !== "string") return;

          // Feature-system traffic is handled (and access-checked) separately.
          if (message.command.startsWith("feature:")) {
            await handleFeatureMessage(message, featureContext);
            return;
          }

          switch (message.command) {
            case "testAPI":
              try {
                post({ command: "requestStarted" });

                const result = await apiTester.makeRequest(buildApiRequestFromMessage(message));

                post({
                  command: "apiResponse",
                  ...result
                });
                void reach("first_api_request");
              } catch (error: any) {
                // A cancelled request is reported by the cancelRequest handler
                // (or superseded by a newer request), not as a failure.
                if (error?.cancelled) break;
                const described = describeRequestError(error, error?.timeout);
                post({
                  command: "apiError",
                  error: error?.message || "Request failed",
                  code: error?.code,
                  title: described.title,
                  hint: described.hint,
                  action: described.action,
                  status: error?.status || 0,
                  response: error?.response,
                  responseTime: error?.responseTime,
                  attempts: error?.attempts,
                  history: apiTester.getAllHistory()
                });
              }
              break;

            case "cancelRequest":
              apiTester.cancelCurrentRequest();
              post({ command: "requestCancelled" });
              break;

            case "generateCurl":
              try {
                const curl = apiTester.generateCurlCommand(buildApiRequestFromMessage(message));
                post({ command: "curlGenerated", curl });
              } catch (error: any) {
                post({ command: "curlGenerated", error: error.message || "Failed to generate cURL command" });
              }
              break;

            case "parseCurl":
              try {
                const parsed = apiTester.parseCurlCommand(message.curl || "");
                post({ command: "curlParsed", request: parsed });
              } catch (error: any) {
                post({ command: "curlParsed", error: error.message || "Failed to parse cURL command" });
              }
              break;

            case "exportHistory":
              try {
                const format: "json" | "csv" = message.format === "csv" ? "csv" : "json";
                const data = apiTester.exportHistory(format);
                const uri = await vscode.window.showSaveDialog({
                  filters: format === "csv" ? { "CSV Files": ["csv"] } : { "JSON Files": ["json"] },
                  defaultUri: vscode.Uri.file(path.join(
                    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir(),
                    `devsnip-api-history.${format}`
                  ))
                });
                if (uri) {
                  await vscode.workspace.fs.writeFile(uri, Buffer.from(data, "utf8"));
                  post({ command: "historyExported", success: true });
                  vscode.window.showInformationMessage(`API history exported to ${uri.fsPath}`);
                }
              } catch (error: any) {
                post({ command: "historyExported", success: false, error: error.message || "Export failed" });
              }
              break;

            case "saveResponse": {
              // Saving is a host concern: the webview sandbox blocks downloads.
              const body = typeof message.body === "string" ? message.body : "";
              if (!body) {
                post({ command: "responseSaved", success: false, error: "There is no response body to save." });
                break;
              }
              const target = await vscode.window.showSaveDialog({
                filters: { "JSON Files": ["json"], "Text Files": ["txt"], "All Files": ["*"] },
                defaultUri: vscode.Uri.file("response.json")
              });
              if (!target) break;
              try {
                await vscode.workspace.fs.writeFile(target, Buffer.from(body, "utf8"));
                post({ command: "responseSaved", success: true, path: target.fsPath });
                vscode.window.showInformationMessage(`Response saved to ${target.fsPath}`);
              } catch (error: any) {
                post({ command: "responseSaved", success: false, error: error?.message || "Could not save the response." });
              }
              break;
            }

            case "getCookies":
              post({
                command: "showCookies",
                cookies: apiTester.getCookies(),
              });
              break;

            case "clearHistory":
              apiTester.clearHistory();
              post({
                command: "historyCleared",
                history: []
              });
              break;

            case "clearCookies":
              apiTester.clearCookies();
              post({
                command: "cookiesCleared"
              });
              break;

            case "getEnvironments":
              post({
                command: "showEnvironments",
                environments: apiTester.getEnvironments(),
                activeIndex: apiTester.getActiveEnvironmentIndex()
              });
              break;

            case "getHistory":
              post({ command: "historyLoaded", history: apiTester.getAllHistory() });
              break;

            case "saveEnvironment":
              try {
                await apiTester.saveEnvironment(
                  message.environment,
                  typeof message.previousName === "string" ? message.previousName : undefined
                );
              } catch (error: any) {
                post({ command: "environmentError", error: error?.message || "The environment could not be saved." });
                break;
              }
              post({
                command: "environmentSaved",
                environments: apiTester.getEnvironments(),
                activeIndex: apiTester.getActiveEnvironmentIndex()
              });
              break;

            case "deleteEnvironment":
              await apiTester.deleteEnvironment(message.name);
              post({
                command: "environmentDeleted",
                environments: apiTester.getEnvironments(),
                activeIndex: apiTester.getActiveEnvironmentIndex()
              });
              break;

            case "setActiveEnvironment":
              await apiTester.setActiveEnvironment(message.index);
              post({
                command: "environmentActivated",
                environments: apiTester.getEnvironments(),
                activeIndex: apiTester.getActiveEnvironmentIndex()
              });
              break;

            case "getPoints": {
              const stats = getUserStats(context);
              post({
                command: "showPoints",
                points: stats.totalPoints
              });
              break;
            }

          }
        },
      );

      // Clean up on panel disposal
      panel.onDidDispose(() => {
        messageSubscription.dispose();
        pointsSubscription.dispose();
        apiTester.cancelCurrentRequest();
        if (activePanel === panel) activePanel = undefined;
      });
    }
  );

  context.subscriptions.push(disposable);
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * @param allowWebSockets Emits a connect-src allowance only when the user is
 * entitled to the WebSocket tool. Without it the browser itself refuses the
 * connection, so the premium gate does not depend on the page behaving.
 */
export function getWebviewContent(history: ApiHistoryItem[], allowWebSockets: boolean): string {
  const nonce = getNonce();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';${allowWebSockets ? " connect-src ws: wss:;" : ""}">
        <title>REST API Client</title>
        <style>${API_CLIENT_STYLES}</style>
    </head>
    <body>
    ${apiClientMarkup()}
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            ${API_CLIENT_SCRIPT}
            /* ===================== FREE / PREMIUM FEATURE BROWSER =====================
               The page never decides entitlement. It renders whatever the
               extension host sends in a featureCatalog message, and every action posts a
               message that is access-checked again in the host before it runs. */
            var featureCatalog = null;
            var activeCategory = 'software-development';
            var activeGroup = null;
            var activeFeature = null;

            function fEl(id) { return document.getElementById(id); }

            function featureById(id) {
                if (!featureCatalog) return null;
                for (var c = 0; c < featureCatalog.categories.length; c++) {
                    var groups = featureCatalog.categories[c].groups;
                    for (var g = 0; g < groups.length; g++) {
                        for (var f = 0; f < groups[g].features.length; f++) {
                            if (groups[g].features[f].id === id) return groups[g].features[f];
                        }
                    }
                }
                return null;
            }

            function renderTier() {
                if (!featureCatalog) return;
                var balance = featureCatalog.pointBalance || 0;

                var pill = fEl('featureTierPill');
                if (pill) {
                    pill.textContent = balance + ' pts';
                    pill.className = 'tier-pill' + (balance > 0 ? ' premium' : '');
                    pill.title = 'Your DevSnip Pro points balance';
                }
                var upgrade = fEl('featureUpgradeBtn');
                if (upgrade) upgrade.textContent = 'Earn points';
                renderPointsView();
            }

            /* Lists what the current balance does and does not unlock. */
            function renderPointsView() {
                var unlocked = fEl('pointsUnlockedList');
                var locked = fEl('pointsLockedList');
                if (!unlocked || !locked || !featureCatalog) return;

                var premium = [];
                featureCatalog.categories.forEach(function (category) {
                    category.groups.forEach(function (group) {
                        group.features.forEach(function (feature) {
                            if (feature.tier === 'premium') premium.push(feature);
                        });
                    });
                });
                premium.sort(function (a, b) { return (a.pointCost || 0) - (b.pointCost || 0); });

                function row(feature) {
                    var el = document.createElement('button');
                    el.type = 'button';
                    el.className = 'points-row' + (feature.locked ? ' short' : '');
                    el.style.textAlign = 'left';
                    el.style.background = 'transparent';
                    el.style.color = 'inherit';
                    el.style.font = 'inherit';
                    el.style.cursor = 'pointer';
                    el.title = feature.description;

                    var name = document.createElement('span');
                    name.className = 'name';
                    name.textContent = feature.name;
                    el.appendChild(name);

                    var price = document.createElement('span');
                    price.className = 'price';
                    price.textContent = feature.pointCost + ' pts';
                    el.appendChild(price);

                    if (feature.locked && feature.pointsShort) {
                        var gap = document.createElement('span');
                        gap.className = 'gap';
                        gap.textContent = '+' + feature.pointsShort + ' needed';
                        el.appendChild(gap);
                    }
                    el.addEventListener('click', function () { openFeature(feature.id); });
                    return el;
                }

                unlocked.innerHTML = '';
                locked.innerHTML = '';
                var affordable = premium.filter(function (f) { return !f.locked; });
                var tooDear = premium.filter(function (f) { return f.locked; });

                if (!affordable.length) {
                    var none = document.createElement('p');
                    none.className = 'points-empty';
                    none.textContent = 'No premium tool is affordable yet. Keep using DevSnip Pro to earn points.';
                    unlocked.appendChild(none);
                } else {
                    affordable.forEach(function (f) { unlocked.appendChild(row(f)); });
                }

                if (!tooDear.length) {
                    var all = document.createElement('p');
                    all.className = 'points-empty';
                    all.textContent = 'Every premium tool is affordable at your current balance.';
                    locked.appendChild(all);
                } else {
                    tooDear.forEach(function (f) { locked.appendChild(row(f)); });
                }
            }

            /* Builds the AI/ML and Developer Tools navigation in the sidebar
               straight from the catalog, so what is listed always matches the
               user's real entitlement. */
            function renderToolNav() {
                var host = fEl('toolNav');
                if (!host || !featureCatalog) return;
                var query = (sidebarQuery || '').toLowerCase();
                host.innerHTML = '';

                featureCatalog.categories.forEach(function (category) {
                    var matchingGroups = category.groups
                        .map(function (group) {
                            return {
                                group: group,
                                features: group.features.filter(function (feature) {
                                    return !query ||
                                        (feature.name + ' ' + feature.description + ' ' + group.label).toLowerCase().indexOf(query) !== -1;
                                })
                            };
                        })
                        .filter(function (entry) { return entry.features.length > 0; });

                    if (!matchingGroups.length) return;

                    var section = document.createElement('section');
                    section.className = 'nav-section';
                    section.setAttribute('data-section', category.id);
                    if (collapsedSections[category.id]) section.setAttribute('data-collapsed', 'true');

                    var head = document.createElement('button');
                    head.type = 'button';
                    head.className = 'nav-section-head';
                    head.setAttribute('aria-expanded', collapsedSections[category.id] ? 'false' : 'true');
                    head.innerHTML = '<span class="chev" aria-hidden="true">&#9660;</span>';
                    var titleSpan = document.createElement('span');
                    titleSpan.textContent = category.label;
                    head.appendChild(titleSpan);
                    head.addEventListener('click', function () {
                        var collapsed = section.getAttribute('data-collapsed') === 'true';
                        collapsedSections[category.id] = !collapsed;
                        if (collapsed) section.removeAttribute('data-collapsed');
                        else section.setAttribute('data-collapsed', 'true');
                        head.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
                    });

                    var body = document.createElement('div');
                    body.className = 'nav-section-body';

                    matchingGroups.forEach(function (entry) {
                        var groupEl = document.createElement('div');
                        groupEl.className = 'nav-group';
                        var groupKey = category.id + '/' + entry.group.id;
                        if (collapsedGroups[groupKey]) groupEl.setAttribute('data-collapsed', 'true');

                        var groupHead = document.createElement('button');
                        groupHead.type = 'button';
                        groupHead.className = 'nav-group-head';
                        groupHead.setAttribute('aria-expanded', collapsedGroups[groupKey] ? 'false' : 'true');
                        groupHead.innerHTML = '<span class="chev" aria-hidden="true">&#9660;</span>';
                        var groupLabel = document.createElement('span');
                        groupLabel.textContent = entry.group.label;
                        groupHead.appendChild(groupLabel);
                        groupHead.addEventListener('click', function () {
                            var collapsed = groupEl.getAttribute('data-collapsed') === 'true';
                            collapsedGroups[groupKey] = !collapsed;
                            if (collapsed) groupEl.removeAttribute('data-collapsed');
                            else groupEl.setAttribute('data-collapsed', 'true');
                            groupHead.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
                        });

                        var groupBody = document.createElement('div');
                        groupBody.className = 'nav-group-body';

                        entry.features.forEach(function (feature) {
                            var item = document.createElement('button');
                            item.type = 'button';
                            item.className = 'nav-item' + (activeFeature === feature.id ? ' active' : '');
                            item.title = feature.description;

                            var name = document.createElement('span');
                            name.className = 'nav-label';
                            name.textContent = feature.name;
                            item.appendChild(name);

                            if (feature.tier === 'premium') {
                                // Points are the unlock path, so show the price
                                // rather than a padlock.
                                var tag = document.createElement('span');
                                tag.className = 'cost-tag' + (feature.locked ? ' short' : '');
                                tag.textContent = feature.pointCost + ' pts';
                                tag.title = feature.locked
                                    ? 'Costs ' + feature.pointCost + ' points; you need ' + feature.pointsShort + ' more'
                                    : 'Costs ' + feature.pointCost + ' points per run';
                                tag.setAttribute('aria-label', feature.locked
                                    ? 'Costs ' + feature.pointCost + ' points, ' + feature.pointsShort + ' more needed'
                                    : 'Costs ' + feature.pointCost + ' points per run');
                                item.appendChild(tag);
                            }

                            item.addEventListener('click', function () { openFeature(feature.id); });
                            groupBody.appendChild(item);
                        });

                        groupEl.appendChild(groupHead);
                        groupEl.appendChild(groupBody);
                        body.appendChild(groupEl);
                    });

                    section.appendChild(head);
                    section.appendChild(body);
                    host.appendChild(section);
                });
            }

            function syncPointBalance(balance) {
                if (typeof balance !== 'number') return;
                if (featureCatalog) featureCatalog.pointBalance = balance;
                var badge = document.getElementById('userPointsBadge');
                if (badge) badge.textContent = balance;
                var display = document.getElementById('currentPointsDisplay');
                if (display) display.textContent = balance;
                var toolBalance = document.getElementById('toolPointBalance');
                if (toolBalance) toolBalance.textContent = balance;
            }

            function renderCatalog() {
                renderTier();
                syncPointBalance(featureCatalog && featureCatalog.pointBalance);
                renderToolNav();
                if (activeFeature) {
                    var still = featureById(activeFeature);
                    // A tool that just became locked must not stay open.
                    if (!still) closeFeaturePanel();
                    else if (still.locked && currentView === 'tool') openFeature(activeFeature);
                }
            }

            /* Explains how points are earned and opens the tracker. */
            function showEarnPoints() {
                var lines = [
                    'Points are earned by using DevSnip Pro:',
                    '',
                    '\u2022 Any tool run: +3 points (+1 after 5 runs of the same tool in a day)',
                    '\u2022 Creating a custom snippet: +10 points',
                    '\u2022 Security or cloud audit: +8 points',
                    '\u2022 AI, RAG or prompt tool: +5 points',
                    '\u2022 Daily login: +5 points, daily bonus: +10 points',
                    '\u2022 Milestones: +10 to +500 points',
                    '',
                    'Up to 120 points a day can be earned from tool use, plus one-time milestone bonuses.',
                    'Open the Milestone & Points Tracker to claim your daily bonus and see your progress.'
                ].join('\\n');
                featureOutput(lines, false);
                toast('Open the Milestone tracker from the Activity Bar to claim points', 'info');
            }

            function closeFeaturePanel() {
                activeFeature = null;
                showView('request');
                renderToolNav();
            }

            function featureOutput(text, isError) {
                var out = fEl('featureOutput');
                if (!out) return;
                out.hidden = false;
                out.className = 'feature-output' + (isError ? ' error' : '');
                if (typeof text === 'string') out.textContent = text;
                else { out.textContent = ''; out.appendChild(text); }
            }

            /* Builds a labelled control row. */
            function row(label, control, hint) {
                var wrapper = document.createElement('div');
                wrapper.className = 'form-row';
                var lab = document.createElement('label');
                lab.textContent = label;
                wrapper.appendChild(lab);
                wrapper.appendChild(control);
                var nodes = [wrapper];
                if (hint) {
                    var note = document.createElement('div');
                    note.className = 'hint';
                    note.textContent = hint;
                    nodes.push(note);
                }
                return nodes;
            }

            function input(id, placeholder, value, type) {
                var el = document.createElement('input');
                el.className = 'input';
                el.id = id;
                el.type = type || 'text';
                if (placeholder) el.placeholder = placeholder;
                if (value !== undefined && value !== null) el.value = value;
                return el;
            }

            function textarea(id, placeholder, value) {
                var el = document.createElement('textarea');
                el.className = 'input';
                el.id = id;
                if (placeholder) el.placeholder = placeholder;
                if (value) el.value = value;
                return el;
            }

            function select(id, options, value) {
                var el = document.createElement('select');
                el.className = 'input';
                el.id = id;
                options.forEach(function (option) {
                    var node = document.createElement('option');
                    node.value = option.value;
                    node.textContent = option.label;
                    if (option.value === value) node.selected = true;
                    el.appendChild(node);
                });
                return el;
            }

            function providerOptions() {
                return (featureCatalog && featureCatalog.providers ? featureCatalog.providers : []).map(function (p) {
                    return { value: p.id, label: p.label };
                });
            }

            function providerById(id) {
                var list = featureCatalog && featureCatalog.providers ? featureCatalog.providers : [];
                for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
                return null;
            }

            /* Shared model/credential block used by every AI feature. */
            function aiControls(container, prefix) {
                var options = providerOptions();
                var providerSelect = select(prefix + 'Provider', options, options.length ? options[0].value : '');
                row('Provider', providerSelect).forEach(function (n) { container.appendChild(n); });

                var modelInput = input(prefix + 'Model', 'model name');
                row('Model', modelInput).forEach(function (n) { container.appendChild(n); });

                var baseInput = input(prefix + 'BaseUrl', 'base URL');
                row('Base URL', baseInput, 'Leave as-is unless you use a proxy, Azure or a local server.')
                    .forEach(function (n) { container.appendChild(n); });

                var keyInput = input(prefix + 'ApiKey', 'API key', '', 'password');
                row('API key', keyInput, 'Sent only with this request. It is not written to history or to disk.')
                    .forEach(function (n) { container.appendChild(n); });

                function sync() {
                    var provider = providerById(providerSelect.value);
                    if (!provider) return;
                    modelInput.placeholder = provider.defaultModel;
                    if (!modelInput.dataset.touched) modelInput.value = provider.defaultModel;
                    baseInput.placeholder = provider.defaultBaseUrl;
                    if (!baseInput.dataset.touched) baseInput.value = provider.defaultBaseUrl;
                    keyInput.disabled = !provider.requiresKey;
                    keyInput.placeholder = provider.requiresKey ? 'API key' : 'not required for this provider';
                }
                modelInput.addEventListener('input', function () { modelInput.dataset.touched = '1'; });
                baseInput.addEventListener('input', function () { baseInput.dataset.touched = '1'; });
                providerSelect.addEventListener('change', function () {
                    delete modelInput.dataset.touched;
                    delete baseInput.dataset.touched;
                    sync();
                });
                sync();

                return function values() {
                    return {
                        provider: providerSelect.value,
                        model: modelInput.value.trim(),
                        baseUrl: baseInput.value.trim(),
                        apiKey: keyInput.value
                    };
                };
            }

            /*
             * Adds an action button to a tool form.
             *
             * Consecutive buttons share one row so they line up as a group. A
             * new row starts whenever something else has been appended since
             * the last button, which keeps buttons next to the fields they act
             * on instead of collecting them all at the top.
             */
            function actionButton(container, label, handler) {
                var last = container.lastElementChild;
                var bar = last && last.classList.contains('tool-actions-row')
                    ? last
                    : null;
                if (!bar) {
                    bar = document.createElement('div');
                    bar.className = 'tool-actions-row';
                    container.appendChild(bar);
                }

                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-sm';
                button.textContent = label;
                button.addEventListener('click', function () {
                    featureOutput('Working...', false);
                    handler();
                });
                bar.appendChild(button);
                return button;
            }

            function send(command, payload) {
                var message = payload || {};
                message.command = command;
                message.featureId = message.featureId || activeFeature;
                vscode.postMessage(message);
            }

            /* Query parameters are part of the URL, so params stays empty. */
            function currentRequestSnapshot() {
                var payload = buildRequestPayload();
                return {
                    method: payload.method,
                    url: payload.url,
                    headers: payload.headers,
                    params: {},
                    data: payload.data,
                    body: payload.data
                };
            }

            function runWithPoints(featureId) {
                vscode.postMessage({
                    command: 'feature:unlockWithPoints',
                    featureId: featureId,
                    request: currentRequestSnapshot()
                });
            }

            /* Each feature renders its own small form into the panel. */
            var featureForms = {
                'code-generation': function (body) {
                    var languages = (featureCatalog.codeLanguages || []).map(function (l) { return { value: l.id, label: l.label }; });
                    var picker = select('cgLanguage', languages, languages.length ? languages[0].value : '');
                    row('Language', picker, 'Uses the request currently configured above.').forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Generate code', function () {
                        var snapshot = currentRequestSnapshot();
                        send('feature:generateCode', {
                            language: picker.value,
                            method: snapshot.method,
                            url: snapshot.url,
                            headers: snapshot.headers,
                            body: snapshot.body
                        });
                    });
                },

                'jwt-inspector': function (body) {
                    var token = textarea('jwtToken', 'Paste a JWT, with or without the "Bearer " prefix');
                    row('Token', token).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Decode token', function () {
                        send('feature:inspectJwt', { token: token.value });
                    });
                },

                'json-tools': function (body) {
                    var action = select('jtAction', [
                        { value: 'format', label: 'Format' },
                        { value: 'minify', label: 'Minify' },
                        { value: 'validate', label: 'Validate against schema' },
                        { value: 'query', label: 'Query with a JSON path' }
                    ], 'format');
                    row('Action', action).forEach(function (n) { body.appendChild(n); });
                    var source = select('jtSource', [
                        { value: 'response', label: 'Last response' },
                        { value: 'body', label: 'Request body' }
                    ], 'response');
                    row('Source', source).forEach(function (n) { body.appendChild(n); });
                    var path = input('jtPath', 'data.items[0].id');
                    row('JSON path', path).forEach(function (n) { body.appendChild(n); });
                    var schema = textarea('jtSchema', '{ "type": "object", "required": ["id"] }');
                    row('Schema', schema).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Run', function () {
                        var text = source.value === 'body'
                            ? document.getElementById('body').value
                            : (window.__lastResponseText || '');
                        send('feature:jsonTools', { action: action.value, text: text, path: path.value, schema: schema.value });
                    });
                },

                'oauth2-helper': function (body) {
                    var grant = select('oaGrant', [
                        { value: 'client_credentials', label: 'Client credentials' },
                        { value: 'password', label: 'Password' },
                        { value: 'refresh_token', label: 'Refresh token' }
                    ], 'client_credentials');
                    row('Grant', grant).forEach(function (n) { body.appendChild(n); });
                    var tokenUrl = input('oaTokenUrl', 'https://auth.example.com/oauth2/token');
                    row('Token URL', tokenUrl).forEach(function (n) { body.appendChild(n); });
                    var clientId = input('oaClientId', 'client id');
                    row('Client id', clientId).forEach(function (n) { body.appendChild(n); });
                    var clientSecret = input('oaClientSecret', 'client secret', '', 'password');
                    row('Client secret', clientSecret).forEach(function (n) { body.appendChild(n); });
                    var scope = input('oaScope', 'scope (optional)');
                    row('Scope', scope).forEach(function (n) { body.appendChild(n); });
                    var username = input('oaUsername', 'username (password grant)');
                    row('Username', username).forEach(function (n) { body.appendChild(n); });
                    var password = input('oaPassword', 'password (password grant)', '', 'password');
                    row('Password', password).forEach(function (n) { body.appendChild(n); });
                    var refresh = input('oaRefresh', 'refresh token');
                    row('Refresh token', refresh).forEach(function (n) { body.appendChild(n); });

                    actionButton(body, 'Fetch token', function () {
                        send('feature:oauthToken', {
                            grant: grant.value, tokenUrl: tokenUrl.value, clientId: clientId.value,
                            clientSecret: clientSecret.value, scope: scope.value,
                            username: username.value, password: password.value, refreshToken: refresh.value
                        });
                    });
                    actionButton(body, 'Apply token to request', function () {
                        send('feature:applyOauthToken', {});
                    });
                },

                'assertions': function (body) {
                    var rules = textarea('asRules', '', JSON.stringify([
                        { target: 'status', operator: 'equals', expected: 200 },
                        { target: 'latency', operator: 'lessThan', expected: 1000 },
                        { target: 'json', selector: 'data.id', operator: 'exists' }
                    ], null, 2));
                    rules.style.minHeight = '150px';
                    row('Rules (JSON)', rules,
                        'targets: status, latency, size, header, body, json. operators: equals, notEquals, contains, notContains, matches, lessThan, greaterThan, exists, notExists, isArray, isObject, hasLength.')
                        .forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Run assertions', function () {
                        var parsed;
                        try { parsed = JSON.parse(rules.value); }
                        catch (error) { featureOutput('The rules are not valid JSON: ' + error.message, true); return; }
                        if (!window.__lastResponse) { featureOutput('Send a request first so there is a response to assert on.', true); return; }
                        send('feature:runAssertions', { rules: parsed, response: window.__lastResponse });
                    });
                },

                'batch-performance': function (body) {
                    var count = input('btCount', '', '20', 'number');
                    row('Requests', count).forEach(function (n) { body.appendChild(n); });
                    var concurrency = input('btConcurrency', '', '5', 'number');
                    row('Concurrency', concurrency, 'Runs the request configured above. Maximum 100 requests, 25 at a time.')
                        .forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Run batch', function () {
                        send('feature:batchTest', {
                            count: Number(count.value), concurrency: Number(concurrency.value),
                            request: currentRequestSnapshot()
                        });
                    });
                },

                'response-diff': function (body) {
                    var left = textarea('rdLeft', 'First JSON payload');
                    row('Left', left).forEach(function (n) { body.appendChild(n); });
                    var right = textarea('rdRight', 'Second JSON payload');
                    row('Right', right).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Use last response as Left', function () {
                        left.value = window.__lastResponseText || '';
                        featureOutput('Copied the last response into the Left field.', false);
                    });
                    actionButton(body, 'Compare', function () {
                        send('feature:diffResponses', { left: left.value, right: right.value });
                    });
                },

                'collections-basic': function (body) { collectionsForm(body, false); },
                'collections-advanced': function (body) { collectionsForm(body, true); },

                'request-chaining': function (body) {
                    var list = document.createElement('div');
                    list.id = 'chainList';
                    list.className = 'feature-meta';
                    list.textContent = 'Loading saved requests...';
                    body.appendChild(list);
                    actionButton(body, 'Run selected chain', function () {
                        var checked = Array.prototype.slice.call(list.querySelectorAll('input:checked'));
                        send('feature:runChain', { ids: checked.map(function (c) { return c.value; }) });
                    });
                    send('feature:listCollections', { featureId: 'request-chaining' });
                },

                'llm-request': function (body) { promptForm(body, 'feature:llmRequest', 'llm-request', 'Send request'); },
                'prompt-test': function (body) { promptForm(body, 'feature:llmRequest', 'prompt-test', 'Run prompt'); },

                'token-analysis': function (body) {
                    var values = aiControls(body, 'ta');
                    var prompt = textarea('taPrompt', 'Prompt text to measure');
                    row('Prompt', prompt).forEach(function (n) { body.appendChild(n); });
                    var expected = input('taExpected', '', '500', 'number');
                    row('Expected reply tokens', expected).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Estimate', function () {
                        var v = values();
                        v.prompt = prompt.value;
                        v.expectedCompletionTokens = Number(expected.value);
                        send('feature:estimateTokens', v);
                    });
                },

                'llm-streaming': function (body) { streamForm(body, false); },
                'streaming-diagnostics': function (body) { streamForm(body, true); },

                'ai-schema-validation': function (body) {
                    var text = textarea('svText', 'Model output (JSON, optionally inside a code fence)');
                    row('Model output', text).forEach(function (n) { body.appendChild(n); });
                    var schema = textarea('svSchema', '{ "type": "object", "required": ["answer"] }');
                    row('JSON Schema', schema).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Use last AI reply', function () {
                        text.value = window.__lastAiText || '';
                        featureOutput('Copied the last AI reply into the field.', false);
                    });
                    actionButton(body, 'Validate', function () {
                        send('feature:validateAiJson', { text: text.value, schema: schema.value });
                    });
                },

                'llm-compare': function (body) {
                    var prompt = textarea('cmpPrompt', 'Prompt sent to every model');
                    row('Prompt', prompt).forEach(function (n) { body.appendChild(n); });
                    var targets = textarea('cmpTargets', '', JSON.stringify([
                        { label: 'GPT-4o mini', provider: 'openai', model: 'gpt-4o-mini', apiKey: '' },
                        { label: 'Claude Haiku', provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: '' }
                    ], null, 2));
                    targets.style.minHeight = '150px';
                    row('Models (JSON)', targets, 'Two to six entries. Each needs provider, model and an apiKey where the provider requires one.')
                        .forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Compare models', function () {
                        var parsed;
                        try { parsed = JSON.parse(targets.value); }
                        catch (error) { featureOutput('The model list is not valid JSON: ' + error.message, true); return; }
                        send('feature:compareModels', { prompt: prompt.value, targets: parsed });
                    });
                },

                'llm-benchmark': function (body) {
                    var values = aiControls(body, 'bm');
                    var prompt = textarea('bmPrompt', 'Prompt to repeat');
                    row('Prompt', prompt).forEach(function (n) { body.appendChild(n); });
                    var runs = input('bmRuns', '', '5', 'number');
                    row('Runs', runs).forEach(function (n) { body.appendChild(n); });
                    var concurrency = input('bmConcurrency', '', '1', 'number');
                    row('Concurrency', concurrency, 'Up to 50 runs, 10 at a time.').forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Run benchmark', function () {
                        var v = values();
                        v.prompt = prompt.value;
                        v.runs = Number(runs.value);
                        v.concurrency = Number(concurrency.value);
                        send('feature:benchmarkModel', v);
                    });
                },

                'embeddings-test': function (body) {
                    var values = aiControls(body, 'emb');
                    var inputs = textarea('embInputs', 'One text per line');
                    row('Inputs', inputs, 'Two or more lines also reports pairwise cosine similarity.')
                        .forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Embed and compare', function () {
                        var v = values();
                        v.inputs = inputs.value.split('\\n').filter(function (line) { return line.trim(); });
                        send('feature:testEmbeddings', v);
                    });
                },

                'vector-search-test': function (body) {
                    var dbs = (featureCatalog.vectorDbs || []).map(function (d) { return { value: d.id, label: d.label }; });
                    var db = select('vsDb', dbs, dbs.length ? dbs[0].value : '');
                    row('Database', db).forEach(function (n) { body.appendChild(n); });
                    var baseUrl = input('vsBaseUrl', 'http://localhost:6333');
                    row('Base URL', baseUrl).forEach(function (n) { body.appendChild(n); });
                    var collection = input('vsCollection', 'collection or namespace');
                    row('Collection', collection).forEach(function (n) { body.appendChild(n); });
                    var apiKey = input('vsApiKey', 'API key if required', '', 'password');
                    row('API key', apiKey).forEach(function (n) { body.appendChild(n); });
                    var topK = input('vsTopK', '', '5', 'number');
                    row('Top K', topK).forEach(function (n) { body.appendChild(n); });
                    var queryText = input('vsQuery', 'query text to embed and search');
                    row('Query', queryText).forEach(function (n) { body.appendChild(n); });
                    var embProvider = select('vsEmbProvider', providerOptions(), 'openai');
                    row('Embedding provider', embProvider).forEach(function (n) { body.appendChild(n); });
                    var embModel = input('vsEmbModel', 'text-embedding-3-small', 'text-embedding-3-small');
                    row('Embedding model', embModel).forEach(function (n) { body.appendChild(n); });
                    var embKey = input('vsEmbKey', 'embedding API key', '', 'password');
                    row('Embedding key', embKey).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Search', function () {
                        send('feature:searchVectors', {
                            db: db.value, baseUrl: baseUrl.value, collection: collection.value,
                            apiKey: apiKey.value, topK: Number(topK.value), queryText: queryText.value,
                            embeddingProvider: embProvider.value, embeddingModel: embModel.value, embeddingApiKey: embKey.value
                        });
                    });
                },

                'rag-pipeline-test': function (body) {
                    var question = textarea('ragQuestion', 'Question to answer from the indexed documents');
                    row('Question', question).forEach(function (n) { body.appendChild(n); });
                    var dbs = (featureCatalog.vectorDbs || []).map(function (d) { return { value: d.id, label: d.label }; });
                    var db = select('ragDb', dbs, dbs.length ? dbs[0].value : '');
                    row('Vector DB', db).forEach(function (n) { body.appendChild(n); });
                    var baseUrl = input('ragBaseUrl', 'http://localhost:6333');
                    row('Vector base URL', baseUrl).forEach(function (n) { body.appendChild(n); });
                    var collection = input('ragCollection', 'collection');
                    row('Collection', collection).forEach(function (n) { body.appendChild(n); });
                    var vectorKey = input('ragVectorKey', 'vector DB key', '', 'password');
                    row('Vector DB key', vectorKey).forEach(function (n) { body.appendChild(n); });
                    var topK = input('ragTopK', '', '4', 'number');
                    row('Top K', topK).forEach(function (n) { body.appendChild(n); });
                    var embModel = input('ragEmbModel', 'text-embedding-3-small', 'text-embedding-3-small');
                    row('Embedding model', embModel).forEach(function (n) { body.appendChild(n); });
                    var values = aiControls(body, 'rag');
                    actionButton(body, 'Run RAG pipeline', function () {
                        var v = values();
                        v.question = question.value;
                        v.db = db.value; v.baseUrl = baseUrl.value; v.collection = collection.value;
                        v.vectorApiKey = vectorKey.value; v.topK = Number(topK.value);
                        v.embeddingProvider = v.provider; v.embeddingModel = embModel.value; v.embeddingApiKey = v.apiKey;
                        // The generation base URL is the model endpoint, not the vector DB.
                        send('feature:testRag', v);
                    });
                },

                'agent-test': function (body) {
                    var values = aiControls(body, 'ag');
                    var prompt = textarea('agPrompt', 'Task for the agent');
                    row('Task', prompt).forEach(function (n) { body.appendChild(n); });
                    var tools = textarea('agTools', '', JSON.stringify([
                        { name: 'get_weather', description: 'Current weather for a city',
                          parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }
                    ], null, 2));
                    tools.style.minHeight = '130px';
                    row('Tools (JSON)', tools).forEach(function (n) { body.appendChild(n); });
                    var responses = textarea('agResponses', '', JSON.stringify({ get_weather: '{"tempC": 18, "sky": "cloudy"}' }, null, 2));
                    row('Tool responses', responses,
                        'Canned results returned to the model. The extension never executes what the agent asks for.')
                        .forEach(function (n) { body.appendChild(n); });
                    var maxTurns = input('agTurns', '', '5', 'number');
                    row('Max turns', maxTurns).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Run agent', function () {
                        var parsedTools, parsedResponses;
                        try { parsedTools = JSON.parse(tools.value); parsedResponses = JSON.parse(responses.value); }
                        catch (error) { featureOutput('Tools or responses are not valid JSON: ' + error.message, true); return; }
                        var v = values();
                        v.prompt = prompt.value; v.tools = parsedTools; v.toolResponses = parsedResponses;
                        v.maxTurns = Number(maxTurns.value);
                        send('feature:testAgent', v);
                    });
                },

                'prompt-eval': function (body) {
                    var values = aiControls(body, 'pe');
                    var variants = textarea('peVariants', '', JSON.stringify([
                        { label: 'Direct', user: 'Summarise the benefits of unit testing in three bullet points.' },
                        { label: 'Role-based', system: 'You are a staff engineer.', user: 'Summarise the benefits of unit testing in three bullet points.' }
                    ], null, 2));
                    variants.style.minHeight = '140px';
                    row('Variants (JSON)', variants).forEach(function (n) { body.appendChild(n); });
                    var criteria = textarea('peCriteria', '', JSON.stringify({
                        mustInclude: ['test'], mustNotInclude: [], maxWords: 150
                    }, null, 2));
                    row('Criteria (JSON)', criteria,
                        'Supports mustInclude, mustNotInclude, pattern, minWords, maxWords and jsonSchema.')
                        .forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Evaluate', function () {
                        var parsedVariants, parsedCriteria;
                        try { parsedVariants = JSON.parse(variants.value); parsedCriteria = JSON.parse(criteria.value); }
                        catch (error) { featureOutput('Variants or criteria are not valid JSON: ' + error.message, true); return; }
                        var v = values();
                        v.variants = parsedVariants; v.criteria = parsedCriteria;
                        send('feature:evaluatePrompts', v);
                    });
                },

                'prompt-versioning': function (body) {
                    var name = input('pvName', 'prompt name');
                    row('Name', name).forEach(function (n) { body.appendChild(n); });
                    var text = textarea('pvText', 'Prompt text');
                    row('Prompt', text).forEach(function (n) { body.appendChild(n); });
                    var note = input('pvNote', 'what changed');
                    row('Note', note).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Save version', function () {
                        send('feature:savePromptVersion', { name: name.value, text: text.value, note: note.value });
                    });
                    actionButton(body, 'List versions', function () {
                        send('feature:listPromptVersions', { name: name.value });
                    });
                    var left = input('pvLeft', 'version A', '', 'number');
                    row('Compare A', left).forEach(function (n) { body.appendChild(n); });
                    var right = input('pvRight', 'version B', '', 'number');
                    row('Compare B', right).forEach(function (n) { body.appendChild(n); });
                    actionButton(body, 'Diff versions', function () {
                        send('feature:diffPromptVersions', { name: name.value, left: Number(left.value), right: Number(right.value) });
                    });
                },

                'ai-history-analytics': function (body) {
                    var note = document.createElement('div');
                    note.className = 'feature-desc';
                    note.textContent = 'Aggregates the AI calls made from this client. Prompts are never stored - only model, latency, tokens and cost.';
                    body.appendChild(note);
                    actionButton(body, 'Show analytics', function () { send('feature:aiAnalytics', {}); });
                    actionButton(body, 'Clear recorded calls', function () { send('feature:clearAiAnalytics', {}); });
                },

                'websocket-client': function (body) {
                    var url = input('wsUrl', 'wss://echo.websocket.org');
                    row('URL', url).forEach(function (n) { body.appendChild(n); });
                    var message = textarea('wsMessage', 'Message to send once connected');
                    row('Message', message).forEach(function (n) { body.appendChild(n); });

                    var log = document.createElement('div');
                    log.className = 'feature-output';
                    log.id = 'wsLog';
                    log.textContent = 'Not connected.';
                    body.appendChild(log);

                    var socket = null;
                    var openedAt = 0;
                    function append(line) {
                        var stamp = socket && openedAt ? '+' + (Date.now() - openedAt) + 'ms ' : '';
                        log.textContent += '\\n' + stamp + line;
                        log.scrollTop = log.scrollHeight;
                    }
                    actionButton(body, 'Connect', function () {
                        if (socket) { featureOutput('Already connected. Disconnect first.', true); return; }
                        // Ask the host to authorise first. Without premium the
                        // page is also served a CSP that forbids ws: entirely.
                        window.__wsPending = { url: url.value.trim() };
                        send('feature:websocketGrant', { url: url.value.trim() });
                    });
                    window.__wsConnect = function () {
                        var urlValue = (window.__wsPending && window.__wsPending.url) || url.value.trim();
                        try {
                            socket = new WebSocket(urlValue);
                        } catch (error) {
                            featureOutput('Could not open the socket: ' + error.message, true);
                            socket = null;
                            return;
                        }
                        log.textContent = 'Connecting to ' + urlValue + '...';
                        socket.onopen = function () { openedAt = Date.now(); append('open'); };
                        socket.onmessage = function (event) { append('received: ' + String(event.data).slice(0, 2000)); };
                        socket.onerror = function () { append('error (see the connection state; browsers do not expose the reason)'); };
                        socket.onclose = function (event) { append('closed (code ' + event.code + ')'); socket = null; };
                        featureOutput('Connecting...', false);
                    };
                    actionButton(body, 'Send', function () {
                        if (!socket || socket.readyState !== 1) { featureOutput('Connect first.', true); return; }
                        socket.send(message.value);
                        append('sent: ' + message.value.slice(0, 2000));
                    });
                    actionButton(body, 'Disconnect', function () {
                        if (socket) { socket.close(); socket = null; append('disconnect requested'); }
                    });
                },

                'security-headers-scan': function (body) { pointToolForm(body, 'Run the full endpoint security scan (TLS, HSTS, headers, CSP, CORS, cookies, disclosure) against the configured request.'); },
                'load-test': function (body) { pointToolForm(body, 'Send a short burst of requests to the configured endpoint.'); },
                'sdk-export': function (body) { pointToolForm(body, 'Generate a typed client and a Python equivalent for the configured request.'); },
                'mock-generator': function (body) { pointToolForm(body, 'Generate an Express mock route and a JSON Schema contract.'); }
            };

            function pointToolForm(body, description) {
                var note = document.createElement('div');
                note.className = 'feature-desc';
                note.textContent = description + ' Uses the request configured above.';
                body.appendChild(note);
                actionButton(body, 'Run', function () {
                    var feature = featureById(activeFeature);
                    if (feature && feature.locked) { runWithPoints(activeFeature); return; }
                    // Premium users run it directly through the points path's
                    // implementation without spending anything.
                    vscode.postMessage({
                        command: 'feature:unlockWithPoints',
                        featureId: activeFeature,
                        request: currentRequestSnapshot()
                    });
                });
            }

            function promptForm(body, command, featureId, label) {
                var values = aiControls(body, featureId.replace(/-/g, ''));
                var system = textarea(featureId + 'System', 'System prompt (optional)');
                row('System', system).forEach(function (n) { body.appendChild(n); });
                var user = textarea(featureId + 'User', 'User prompt');
                row('Prompt', user).forEach(function (n) { body.appendChild(n); });
                actionButton(body, label, function () {
                    var messages = [];
                    if (system.value.trim()) messages.push({ role: 'system', content: system.value });
                    messages.push({ role: 'user', content: user.value });
                    var v = values();
                    v.messages = messages;
                    v.featureId = featureId;
                    send(command, v);
                });
            }

            function streamForm(body, diagnostics) {
                var values = aiControls(body, diagnostics ? 'sd' : 'st');
                var prompt = textarea((diagnostics ? 'sd' : 'st') + 'Prompt', 'Prompt to stream');
                row('Prompt', prompt).forEach(function (n) { body.appendChild(n); });
                actionButton(body, diagnostics ? 'Stream with diagnostics' : 'Stream response', function () {
                    var v = values();
                    v.prompt = prompt.value;
                    v.diagnostics = diagnostics;
                    v.command = 'feature:stream';
                    vscode.postMessage(v);
                });
            }

            function collectionsForm(body, advanced) {
                var name = input('colName', 'Request name');
                row('Name', name).forEach(function (n) { body.appendChild(n); });
                var folder = input('colFolder', 'Folder', 'Default');
                row('Folder', folder).forEach(function (n) { body.appendChild(n); });
                actionButton(body, 'Save current request', function () {
                    var snapshot = currentRequestSnapshot();
                    send('feature:saveRequest', {
                        featureId: 'collections-basic',
                        request: {
                            name: name.value || snapshot.url,
                            folder: folder.value || 'Default',
                            method: snapshot.method,
                            url: snapshot.url,
                            headers: snapshot.headers,
                            params: snapshot.params,
                            body: snapshot.body
                        }
                    });
                });
                actionButton(body, 'List saved requests', function () {
                    send('feature:listCollections', { featureId: 'collections-basic' });
                });
                if (advanced) {
                    actionButton(body, 'Export collection', function () { send('feature:exportCollection', {}); });
                    actionButton(body, 'Import collection', function () { send('feature:importCollection', {}); });
                }
            }

            function openFeature(id) {
                var feature = featureById(id);
                if (!feature) return;

                activeFeature = id;
                var title = fEl('toolTitle');
                var sub = fEl('toolSub');
                var body = fEl('toolFormHost');
                var out = fEl('featureOutput');
                if (!title || !body) return;

                title.textContent = feature.name;
                if (sub) sub.textContent = feature.description;
                body.innerHTML = '';
                if (out) { out.hidden = true; out.textContent = ''; out.className = 'feature-output'; }

                if (feature.locked) {
                    // A locked tool explains itself and offers the way forward;
                    // it never looks like a broken screen.
                    var card = document.createElement('div');
                    card.className = 'locked-card';

                    var glyph = document.createElement('div');
                    glyph.className = 'glyph';
                    glyph.setAttribute('aria-hidden', 'true');
                    glyph.textContent = '\u{1F512}';
                    card.appendChild(glyph);

                    var heading = document.createElement('h3');
                    heading.textContent = feature.name;
                    card.appendChild(heading);

                    var desc = document.createElement('p');
                    desc.textContent = feature.description;
                    card.appendChild(desc);

                    if (feature.premiumBenefit) {
                        var benefit = document.createElement('p');
                        benefit.textContent = feature.premiumBenefit;
                        card.appendChild(benefit);
                    }

                    var why = document.createElement('div');
                    why.className = 'why';
                    why.textContent = feature.message || 'Premium feature';
                    card.appendChild(why);

                    var unlock = document.createElement('button');
                    unlock.type = 'button';
                    unlock.className = 'btn';
                    unlock.textContent = 'Open points tracker';
                    unlock.addEventListener('click', function () { vscode.postMessage({ command: 'feature:openPointsTracker' }); });
                    card.appendChild(unlock);

                    // Points are the primary way in, so say exactly where the
                    // user stands and how to close the gap.
                    if (feature.pointCost) {
                        var ledger = document.createElement('div');
                        ledger.className = 'why';
                        ledger.style.marginTop = '14px';
                        ledger.textContent = 'Price ' + feature.pointCost + ' points per run \u00b7 your balance ' +
                            (featureCatalog.pointBalance || 0) + ' points' +
                            (feature.pointsShort ? ' \u00b7 ' + feature.pointsShort + ' more needed' : '');
                        card.appendChild(ledger);

                        var earn = document.createElement('button');
                        earn.type = 'button';
                        earn.className = 'btn btn-ghost';
                        earn.style.marginLeft = '8px';
                        earn.textContent = 'How to earn points';
                        earn.addEventListener('click', showEarnPoints);
                        card.appendChild(earn);
                    }

                    body.appendChild(card);
                    showView('tool');
                    renderToolNav();
                    return;
                }

                if (feature.pointCost) {
                    var bar = document.createElement('div');
                    bar.className = 'points-bar';
                    bar.setAttribute('role', 'status');
                    var price = document.createElement('span');
                    price.innerHTML = 'Running this costs <strong>' + feature.pointCost + ' points</strong>';
                    bar.appendChild(price);
                    var bal = document.createElement('span');
                    bal.className = 'spacer';
                    bal.innerHTML = 'Balance <strong id="toolPointBalance">' + (featureCatalog.pointBalance || 0) + '</strong> pts';
                    bar.appendChild(bal);
                    var how = document.createElement('button');
                    how.type = 'button';
                    how.className = 'btn btn-ghost btn-sm';
                    how.textContent = 'Earn points';
                    how.addEventListener('click', showEarnPoints);
                    bar.appendChild(how);
                    body.appendChild(bar);
                }

                if (feature.limit && feature.limit.max !== 'unlimited') {
                    var meta = document.createElement('div');
                    meta.className = 'field-note';
                    meta.style.marginBottom = '12px';
                    meta.textContent = feature.limit.used + ' of ' + feature.limit.max + ' ' +
                        feature.limit.unit + ' used today on the free tier.';
                    body.appendChild(meta);
                }

                var builder = featureForms[id];
                if (builder) builder(body);
                else {
                    var note = document.createElement('div');
                    note.className = 'field-note';
                    note.textContent = 'This capability is part of the request builder. Close this panel to use it.';
                    body.appendChild(note);
                }

                showView('tool');
                renderToolNav();
            }

            /* ---- rendering results ---- */
            /* Renders the endpoint security report from the shared scan engine. */
            function securityScanNode(result) {
                var SEVERITY_COLOR = {
                    critical: 'var(--danger, #f14c4c)', high: 'var(--danger, #f14c4c)',
                    medium: 'var(--warning, #cca700)', low: 'var(--muted, #9aa0a6)', none: 'var(--muted, #9aa0a6)'
                };
                var wrap = document.createElement('div');

                var head = document.createElement('div');
                head.className = 'feature-meta';
                head.style.marginBottom = '10px';
                head.textContent = 'Grade ' + result.grade + ' \u00b7 score ' + result.score + '/100 \u00b7 ' +
                    result.counts.failed + ' failed, ' + result.counts.warnings + ' warning, ' +
                    result.counts.passed + ' passed \u00b7 ' + result.durationMs + 'ms';
                wrap.appendChild(head);

                var verdict = document.createElement('div');
                verdict.style.marginBottom = '12px';
                verdict.textContent = result.verdict;
                wrap.appendChild(verdict);

                (result.issues || []).forEach(function (issue) {
                    var row = document.createElement('div');
                    row.style.borderLeft = '3px solid ' + (SEVERITY_COLOR[issue.severity] || SEVERITY_COLOR.none);
                    row.style.padding = '6px 0 6px 10px';
                    row.style.margin = '0 0 10px';

                    var title = document.createElement('div');
                    title.style.fontWeight = '600';
                    title.textContent = (issue.status === 'fail' ? 'FAILED' : 'WARNING') +
                        ' \u00b7 ' + String(issue.severity).toUpperCase() + ' \u00b7 ' + issue.title;
                    row.appendChild(title);

                    var area = document.createElement('div');
                    area.className = 'feature-meta';
                    area.textContent = issue.area;
                    row.appendChild(area);

                    var detail = document.createElement('div');
                    detail.style.margin = '4px 0';
                    detail.textContent = issue.detail;
                    row.appendChild(detail);

                    if (issue.evidence) {
                        var evidence = document.createElement('div');
                        evidence.className = 'feature-meta';
                        evidence.textContent = issue.evidence;
                        row.appendChild(evidence);
                    }
                    if (issue.remediation) {
                        var fix = document.createElement('div');
                        fix.style.marginTop = '4px';
                        fix.textContent = 'Fix: ' + issue.remediation;
                        row.appendChild(fix);
                    }
                    wrap.appendChild(row);
                });

                if (result.passed && result.passed.length) {
                    var passed = document.createElement('div');
                    passed.className = 'feature-meta';
                    passed.style.marginTop = '8px';
                    passed.textContent = 'Passed: ' + result.passed.join(' \u00b7 ');
                    wrap.appendChild(passed);
                }
                if (result.notes && result.notes.length) {
                    var notes = document.createElement('div');
                    notes.className = 'feature-meta';
                    notes.textContent = 'Notes: ' + result.notes.join(' \u00b7 ');
                    wrap.appendChild(notes);
                }
                var more = document.createElement('div');
                more.className = 'feature-meta';
                more.style.marginTop = '8px';
                more.textContent = result.openFullScan || '';
                wrap.appendChild(more);
                return wrap;
            }

            function renderFeatureResult(featureId, result) {
                if (result === null || result === undefined) { featureOutput('Done.', false); return; }

                if (featureId === 'security-headers-scan' && result && result.counts) {
                    featureOutput(securityScanNode(result), result.counts.failed > 0);
                    return;
                }

                if (featureId === 'llm-request' || featureId === 'prompt-test') {
                    window.__lastAiText = result.text || '';
                    featureOutput(
                        result.text + '\\n\\n---\\nmodel: ' + result.model +
                        '\\nlatency: ' + result.latencyMs + 'ms' +
                        '\\ntokens: ' + (result.usage.promptTokens || '?') + ' in / ' + (result.usage.completionTokens || '?') + ' out' +
                        (result.costKnown ? '\\nestimated cost: $' + result.costUsd.toFixed(6) : '\\nestimated cost: unknown for this model'),
                        false);
                    return;
                }

                if (featureId === 'llm-compare' && result.rows) {
                    var table = document.createElement('table');
                    table.className = 'feature-table';
                    table.innerHTML = '<thead><tr><th>Model</th><th>Latency</th><th>Tokens</th><th>Cost</th><th>Reply</th></tr></thead>';
                    var tbody = document.createElement('tbody');
                    result.rows.forEach(function (rowData) {
                        var tr = document.createElement('tr');
                        function cell(text, cls) {
                            var td = document.createElement('td');
                            td.textContent = text;
                            if (cls) td.className = cls;
                            return td;
                        }
                        tr.appendChild(cell(rowData.label));
                        tr.appendChild(cell(rowData.ok ? rowData.latencyMs + 'ms' : '-', rowData.ok ? '' : 'fail'));
                        tr.appendChild(cell(rowData.ok ? (rowData.promptTokens || '?') + '/' + (rowData.completionTokens || '?') : '-'));
                        tr.appendChild(cell(rowData.costKnown ? '$' + rowData.costUsd.toFixed(6) : 'n/a'));
                        tr.appendChild(cell(rowData.ok ? String(rowData.text).slice(0, 400) : (rowData.error || 'failed'), rowData.ok ? '' : 'fail'));
                        tbody.appendChild(tr);
                    });
                    table.appendChild(tbody);
                    var wrap = document.createElement('div');
                    wrap.appendChild(table);
                    var summary = document.createElement('div');
                    summary.className = 'feature-meta';
                    summary.style.marginTop = '8px';
                    summary.textContent = 'Fastest: ' + (result.fastest || 'n/a') + ' | Cheapest: ' + (result.cheapest || 'n/a');
                    wrap.appendChild(summary);
                    featureOutput(wrap, false);
                    return;
                }

                if (featureId === 'assertions' && result.results) {
                    var lines = result.results.map(function (r) {
                        return (r.passed ? 'PASS  ' : 'FAIL  ') + r.label +
                            '\\n        expected: ' + r.expected + '\\n        actual:   ' + r.actual +
                            (r.detail ? '\\n        note:     ' + r.detail : '');
                    });
                    featureOutput(result.passed + ' passed, ' + result.failed + ' failed\\n\\n' + lines.join('\\n\\n'), result.failed > 0);
                    return;
                }

                if (featureId === 'request-chaining' && result.steps) {
                    var chainLines = result.steps.map(function (step, index) {
                        return (index + 1) + '. ' + step.name + ' -> ' + (step.ok ? 'ok ' + step.status : 'FAILED ' + (step.error || step.status)) +
                            ' (' + (step.latencyMs || 0) + 'ms)' +
                            (step.captured && Object.keys(step.captured).length ? '\\n     captured: ' + JSON.stringify(step.captured) : '');
                    });
                    featureOutput(chainLines.join('\\n') + '\\n\\nvariables: ' + JSON.stringify(result.variables, null, 2), !result.completed);
                    return;
                }

                if ((featureId === 'collections-basic' || featureId === 'request-chaining') && result.requests) {
                    var chainList = fEl('chainList');
                    if (chainList && activeFeature === 'request-chaining') {
                        chainList.innerHTML = '';
                        if (!result.requests.length) chainList.textContent = 'No saved requests yet. Save some from the Collections tool first.';
                        result.requests.forEach(function (request) {
                            var label = document.createElement('label');
                            label.style.display = 'block';
                            var box = document.createElement('input');
                            box.type = 'checkbox';
                            box.value = request.id;
                            label.appendChild(box);
                            label.appendChild(document.createTextNode(' ' + request.folder + ' / ' + request.name + '  [' + request.method + ']'));
                            chainList.appendChild(label);
                        });
                        return;
                    }
                    var text = result.requests.length
                        ? result.requests.map(function (r) { return r.folder + ' / ' + r.name + '  ' + r.method + ' ' + r.url; }).join('\\n')
                        : 'No saved requests yet.';
                    if (result.limit && result.limit.max !== 'unlimited') {
                        text += '\\n\\n' + result.requests.length + ' of ' + result.limit.max + ' free slots used.';
                    }
                    featureOutput(text, false);
                    return;
                }

                if (typeof result === 'object' && result.code) { featureOutput(result.code, false); return; }
                if (typeof result === 'object' && result.typescript) {
                    featureOutput(result.typescript + '\\n\\n# Python\\n' + result.python, false);
                    return;
                }
                featureOutput(typeof result === 'string' ? result : JSON.stringify(result, null, 2), false);
            }

            /* ---- wiring ---- */
            fEl('featureRefreshBtn')?.addEventListener('click', function () {
                vscode.postMessage({ command: 'feature:refresh' });
            });
            fEl('featureUpgradeBtn')?.addEventListener('click', function () { showView('points'); });
            fEl('featurePanelClose')?.addEventListener('click', closeFeaturePanel);
            ${API_CLIENT_INIT_SCRIPT}
        </script>
    </body>
    </html>
  `;
}
