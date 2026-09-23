import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import axios, { AxiosRequestConfig, CancelTokenSource } from "axios";
import * as https from "https";
import * as path from "path";
import { getUserStats, onDidChangePoints } from "./milestoneTracker";
import { safePostMessage } from "../utils/webview-ui";
import { FeatureAccessService } from "../premium/feature-access";
import { CollectionStore } from "../services/collections";
import { FeatureContext, buildCatalog, handleFeatureMessage } from "./api-client-features";

interface ApiHistoryItem {
  id: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  responseTime?: number;
  size?: number;
  attempts?: number;
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

  public async saveEnvironment(env: Environment): Promise<void> {
    const existingIndex = this.environments.findIndex(e => e.name === env.name);
    if (existingIndex >= 0) {
      this.environments[existingIndex] = env;
    } else {
      this.environments.push(env);
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

  private validateJson(jsonString: string): boolean {
    if (!jsonString.trim()) return true;
    try {
      JSON.parse(jsonString);
      return true;
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

    // Validation
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
    return JSON.stringify(this.history, null, 2);
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
          attempts: attempt + 1
        });

        return {
          status: response.status,
          headers: response.headers,
          data: responseData,
          responseTime,
          size: this.formatBytes(responseSize),
          truncated,
          attempts: attempt + 1,
          history: this.history.slice(0, 10) // Only send last 10 for UI
        };
      } catch (error: any) {
        if (axios.isCancel(error)) {
          throw new Error("Request was cancelled");
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
        const errorData = error.response?.data || error.message;

        // Add failed request to history
        this.addToHistory({
          url: finalUrl,
          method: request.method,
          timestamp: Date.now(),
          status: errorStatus,
          responseTime,
          attempts: attempt + 1
        });

        throw {
          message: error.message,
          status: errorStatus,
          response: errorData,
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
        "API Tester Pro",
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
      panel.webview.html = getWebviewContent(apiTester.getHistory(), services.access.check("websocket-client").allowed);
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
          panel.webview.html = getWebviewContent(apiTester.getHistory(), nowAllowed);
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
              } catch (error: any) {
                post({
                  command: "apiError",
                  error: error.message || "Request failed",
                  status: error.status || 0,
                  response: error.response,
                  responseTime: error.responseTime,
                  attempts: error.attempts
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
                  defaultUri: vscode.Uri.file(path.join(context.extensionPath, `devsnip-api-history.${format}`))
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

            case "saveEnvironment":
              await apiTester.saveEnvironment(message.environment);
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
        <title>API Tester Pro</title>
        <style>
        /* ==========================================================
           DevSnip Pro REST API Client
           Every colour comes from a VS Code theme variable with a
           fallback, so the panel follows dark, light and high-contrast
           themes instead of imposing its own palette.
           ========================================================== */
        :root {
            --bg: var(--vscode-editor-background, #1e1e1e);
            --bg-raised: var(--vscode-sideBar-background, var(--vscode-editor-background, #252526));
            --bg-sunken: var(--vscode-input-background, rgba(127,127,127,0.10));
            --bg-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.12));
            --bg-active: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,0.20));
            --fg-0: var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc));
            --fg-1: var(--vscode-foreground, #cccccc);
            --fg-2: var(--vscode-descriptionForeground, rgba(127,127,127,0.95));
            --border: var(--vscode-panel-border, var(--vscode-input-border, rgba(127,127,127,0.30)));
            --border-strong: var(--vscode-contrastBorder, var(--vscode-panel-border, rgba(127,127,127,0.45)));
            --primary: var(--vscode-button-background, #0e639c);
            --primary-fg: var(--vscode-button-foreground, #ffffff);
            --primary-hover: var(--vscode-button-hoverBackground, #1177bb);
            --accent: var(--vscode-textLink-foreground, #3794ff);
            --focus: var(--vscode-focusBorder, #007fd4);
            --success: var(--vscode-testing-iconPassed, #3fb950);
            --warning: var(--vscode-editorWarning-foreground, #cca700);
            --error: var(--vscode-errorForeground, #f14c4c);
            --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
            --font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
            --radius: 5px;
            --radius-lg: 8px;
            --sidebar-w: 236px;
        }

        *, *::before, *::after { box-sizing: border-box; }
        html, body { height: 100%; }
        body {
            margin: 0;
            background: var(--bg);
            color: var(--fg-0);
            font-family: var(--font);
            font-size: 13px;
            line-height: 1.5;
            overflow: hidden;
        }

        /* Visible focus everywhere, never removed for looks. */
        :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; border-radius: 3px; }
        .sr-only {
            position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
            overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
        }

        /* ---------------------------------------------------- shell */
        .app {
            display: grid;
            grid-template-rows: auto 1fr;
            grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
            grid-template-areas: "topbar topbar" "sidebar main";
            height: 100vh;
        }
        .app.sidebar-collapsed { grid-template-columns: 0 minmax(0, 1fr); }

        /* ---------------------------------------------------- topbar */
        .topbar {
            grid-area: topbar;
            display: flex; align-items: center; gap: 10px;
            padding: 0 12px; height: 40px;
            background: var(--bg-raised);
            border-bottom: 1px solid var(--border);
        }
        .tool-actions-row {
            display: flex; flex-wrap: wrap; gap: 8px;
            margin: 12px 0 4px;
        }
        .tool-actions-row .btn { min-width: 104px; justify-content: center; }
        .points-summary { margin-bottom: 20px; }
        .points-heading { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); margin: 0 0 8px; }
        .points-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
        .points-row {
            display: flex; align-items: center; gap: 8px; padding: 8px 11px;
            border: 1px solid var(--border); border-radius: 6px; font-size: 12px;
        }
        .points-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .points-row .price { flex: none; font-weight: 700; font-size: 11px; color: var(--accent); }
        .points-row.short .price { color: var(--warning); }
        .points-row .gap { flex: none; font-size: 11px; color: var(--fg-2); }
        .points-earn { margin: 0; padding-left: 18px; font-size: 12px; color: var(--fg-1); line-height: 1.8; }
        .points-note { font-size: 11.5px; color: var(--fg-2); margin: 8px 0 0; }
        .points-empty { font-size: 12px; color: var(--fg-2); }
        .points-badge {
            display: inline-flex; align-items: center; gap: 5px; flex: none;
            padding: 3px 9px; margin-right: 8px; border-radius: 999px;
            border: 1px solid var(--accent); background: transparent; color: var(--accent);
            font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
        }
        .points-badge .unit { font-weight: 600; opacity: .8; }
        .points-badge:hover { border-color: var(--focus); }
        .points-badge:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
        .topbar-brand { font-weight: 600; font-size: 13px; white-space: nowrap; display: flex; align-items: center; gap: 7px; }
        .topbar-brand .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
        .topbar-spacer { flex: 1 1 auto; min-width: 8px; }
        .topbar-env { display: flex; align-items: center; gap: 6px; min-width: 0; }
        .topbar-actions { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
        .icon-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 26px; padding: 0;
            border: 1px solid transparent; border-radius: var(--radius);
            background: transparent; color: var(--fg-1); cursor: pointer; font-size: 13px;
        }
        .icon-btn:hover { background: var(--bg-hover); border-color: var(--border); }

        /* ---------------------------------------------------- sidebar */
        .sidebar {
            grid-area: sidebar;
            background: var(--bg-raised);
            border-right: 1px solid var(--border);
            display: flex; flex-direction: column;
            min-width: 0; overflow: hidden;
        }
        .app.sidebar-collapsed .sidebar { display: none; }
        .sidebar-top { padding: 10px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border); }
        .search-wrap { position: relative; display: flex; }
        .search-wrap .search-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--fg-2); font-size: 11px; pointer-events: none; }
        .sidebar-scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding-bottom: 12px; }

        .nav-section { border-bottom: 1px solid var(--border); }
        .nav-section-head {
            display: flex; align-items: center; gap: 6px; width: 100%;
            padding: 7px 10px; background: transparent; border: 0; cursor: pointer;
            color: var(--fg-2); font: inherit; font-size: 10.5px; font-weight: 700;
            letter-spacing: .07em; text-transform: uppercase; text-align: left;
        }
        .nav-section-head:hover { color: var(--fg-0); background: var(--bg-hover); }
        .nav-section-head .chev { transition: transform .15s ease; flex: none; font-size: 9px; }
        .nav-section[data-collapsed="true"] .chev { transform: rotate(-90deg); }
        .nav-section[data-collapsed="true"] .nav-section-body { display: none; }
        .nav-section-head .count { margin-left: auto; font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 10px; }
        .nav-section-body { padding: 0 6px 8px; }

        .nav-item {
            display: flex; align-items: center; gap: 7px; width: 100%;
            padding: 5px 8px; border: 1px solid transparent; border-radius: var(--radius);
            background: transparent; color: var(--fg-1); cursor: pointer;
            font: inherit; font-size: 12px; text-align: left;
        }
        .nav-item:hover { background: var(--bg-hover); }
        .nav-item.active { background: var(--bg-active); color: var(--fg-0); font-weight: 600; }
        .nav-item .nav-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .nav-item .lock { flex: none; font-size: 10px; color: var(--fg-2); }
        .nav-item .cost-tag, .feature-cost {
            flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: .02em;
            padding: 1px 6px; border-radius: 999px; white-space: nowrap;
            border: 1px solid var(--accent); color: var(--accent);
        }
        .nav-item .cost-tag.short, .feature-cost.short { border-color: var(--warning); color: var(--warning); }
        .points-bar {
            display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
            padding: 7px 10px; margin-bottom: 12px; font-size: 11.5px;
            border: 1px solid var(--border); border-radius: 6px; color: var(--fg-1);
        }
        .points-bar strong { color: var(--fg-0); }
        .points-bar .spacer { margin-left: auto; }

        .nav-group { margin-bottom: 2px; }
        .nav-group-head {
            display: flex; align-items: center; gap: 6px; width: 100%;
            padding: 4px 8px; background: transparent; border: 0; cursor: pointer;
            color: var(--fg-2); font: inherit; font-size: 11px; font-weight: 600; text-align: left;
        }
        .nav-group-head:hover { color: var(--fg-0); }
        .nav-group-head .chev { font-size: 9px; transition: transform .15s ease; flex: none; }
        .nav-group[data-collapsed="true"] .chev { transform: rotate(-90deg); }
        .nav-group[data-collapsed="true"] .nav-group-body { display: none; }
        .nav-group-body { padding-left: 12px; }

        .tier-tag {
            flex: none; font-size: 8.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
            padding: 1px 5px; border-radius: 3px; border: 1px solid var(--warning); color: var(--warning);
        }

        /* Sidebar history + collection rows */
        .hist-row {
            display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 6px;
            width: 100%; padding: 5px 8px; border: 1px solid transparent; border-radius: var(--radius);
            background: transparent; color: var(--fg-1); cursor: pointer; font: inherit; font-size: 11.5px; text-align: left;
        }
        .hist-row:hover { background: var(--bg-hover); }
        .hist-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; }
        .hist-meta { font-size: 10px; color: var(--fg-2); white-space: nowrap; }
        .empty-hint { padding: 10px 10px 4px; color: var(--fg-2); font-size: 11.5px; line-height: 1.6; }

        /* ---------------------------------------------------- main */
        .main { grid-area: main; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
        .view { display: none; flex-direction: column; min-height: 0; flex: 1 1 auto; }
        .view.active { display: flex; }

        /* ---------------------------------------------------- url bar */
        .url-bar { padding: 12px 14px 10px; border-bottom: 1px solid var(--border); background: var(--bg); }
        .url-row { display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; }
        .method-select {
            flex: 0 0 auto; min-width: 104px;
            font-weight: 700; font-size: 12px; letter-spacing: .02em;
            background: var(--bg-sunken); color: var(--fg-0);
            border: 1px solid var(--border); border-radius: var(--radius);
            padding: 0 8px; height: 32px; cursor: pointer; font-family: var(--font);
        }
        .url-field { flex: 1 1 320px; min-width: 200px; display: flex; flex-direction: column; gap: 3px; }
        .url-input {
            width: 100%; height: 32px; padding: 0 10px;
            background: var(--bg-sunken); color: var(--fg-0);
            border: 1px solid var(--border); border-radius: var(--radius);
            font-family: var(--font-mono); font-size: 12px;
        }
        .url-input:focus { border-color: var(--focus); }
        .url-input.invalid { border-color: var(--error); }
        .url-error { display: none; font-size: 11px; color: var(--error); }
        .url-error.show { display: block; }
        .send-btn {
            flex: 0 0 auto; min-width: 92px; height: 32px; padding: 0 18px;
            display: inline-flex; align-items: center; justify-content: center; gap: 7px;
            background: var(--primary); color: var(--primary-fg);
            border: 1px solid transparent; border-radius: var(--radius);
            font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .send-btn:hover:not(:disabled) { background: var(--primary-hover); }
        .send-btn:disabled { opacity: .65; cursor: progress; }
        .cancel-btn {
            display: none; flex: 0 0 auto; height: 32px; padding: 0 14px;
            background: transparent; color: var(--error);
            border: 1px solid var(--error); border-radius: var(--radius);
            font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
        }
        .cancel-btn.visible { display: inline-flex; align-items: center; }
        .spinner {
            width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent;
            border-radius: 50%; animation: spin .7s linear infinite; flex: none;
        }
        .spinner.hidden { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } .chev { transition: none !important; } }

        /* ---------------------------------------------------- type tabs */
        .type-tabs { display: flex; gap: 2px; padding: 8px 14px 0; background: var(--bg); }
        .type-tab {
            padding: 4px 12px; border: 1px solid transparent; border-radius: 999px;
            background: transparent; color: var(--fg-2); cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
        }
        .type-tab:hover { color: var(--fg-0); background: var(--bg-hover); }
        .type-tab.active { color: var(--primary-fg); background: var(--primary); }

        /* ---------------------------------------------------- split panes */
        .workspace { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) minmax(0, 1fr); }
        @media (min-width: 1100px) { .workspace { grid-template-rows: none; grid-template-columns: minmax(0,1fr) minmax(0,1fr); } }
        .pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
        .pane + .pane { border-top: 1px solid var(--border); }
        @media (min-width: 1100px) { .pane + .pane { border-top: 0; border-left: 1px solid var(--border); } }
        .pane-head {
            display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
            padding: 0 12px; min-height: 34px; border-bottom: 1px solid var(--border); background: var(--bg-raised);
        }
        .pane-title { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-2); }
        .pane-body { flex: 1 1 auto; min-height: 0; overflow: auto; }

        /* ---------------------------------------------------- config tabs */
        .config-tabs { display: flex; gap: 1px; overflow-x: auto; scrollbar-width: thin; }
        .config-tab {
            position: relative; white-space: nowrap;
            padding: 8px 11px; border: 0; border-bottom: 2px solid transparent;
            background: transparent; color: var(--fg-2); cursor: pointer; font: inherit; font-size: 12px;
        }
        .config-tab:hover { color: var(--fg-0); }
        .config-tab.active { color: var(--fg-0); border-bottom-color: var(--primary); font-weight: 600; }
        .config-tab .badge {
            display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 999px;
            background: var(--bg-sunken); border: 1px solid var(--border); color: var(--fg-2); font-size: 10px; font-weight: 600;
        }
        .config-content { display: none; padding: 14px; }
        .config-content.active { display: block; }

        /* ---------------------------------------------------- forms */
        .form-label { display: block; margin-bottom: 5px; font-size: 11.5px; color: var(--fg-2); }
        .input, .select, .textarea {
            width: 100%; padding: 6px 9px;
            background: var(--bg-sunken); color: var(--fg-0);
            border: 1px solid var(--border); border-radius: var(--radius);
            font-family: var(--font); font-size: 12px;
        }
        .textarea { font-family: var(--font-mono); resize: vertical; min-height: 90px; line-height: 1.55; }
        .input:focus, .select:focus, .textarea:focus { border-color: var(--focus); }
        .input.invalid, .textarea.invalid { border-color: var(--error); }
        .form-row { margin-bottom: 12px; }
        .field-note { margin-top: 4px; font-size: 11px; color: var(--fg-2); }
        .field-note.error { color: var(--error); }
        .field-note.ok { color: var(--success); }

        .btn {
            display: inline-flex; align-items: center; justify-content: center; gap: 6px;
            padding: 6px 12px; border: 1px solid transparent; border-radius: var(--radius);
            background: var(--primary); color: var(--primary-fg);
            font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
        }
        .btn:hover { background: var(--primary-hover); }
        .btn-ghost { background: transparent; color: var(--fg-1); border-color: var(--border); }
        .btn-ghost:hover { background: var(--bg-hover); color: var(--fg-0); }
        .btn-danger { background: transparent; color: var(--error); border-color: var(--error); }
        .btn-danger:hover { background: var(--error); color: var(--bg); }
        .btn-sm { padding: 4px 9px; font-size: 11.5px; }
        .btn:disabled { opacity: .55; cursor: not-allowed; }

        /* ---------------------------------------------------- key/value editor */
        .kv-head {
            display: grid; grid-template-columns: 26px minmax(0,1fr) minmax(0,1.4fr) 56px;
            gap: 6px; padding: 0 2px 5px; font-size: 10px; font-weight: 700;
            letter-spacing: .06em; text-transform: uppercase; color: var(--fg-2);
        }
        .kv-row {
            display: grid; grid-template-columns: 26px minmax(0,1fr) minmax(0,1.4fr) 56px;
            gap: 6px; align-items: center; margin-bottom: 5px;
        }
        .kv-row.disabled .kv-key, .kv-row.disabled .kv-value { opacity: .45; text-decoration: line-through; }
        .kv-toggle { width: 14px; height: 14px; margin: 0 auto; accent-color: var(--primary); cursor: pointer; }
        .kv-row .input { font-family: var(--font-mono); font-size: 11.5px; }
        .kv-actions { display: flex; gap: 3px; justify-content: flex-end; }
        .kv-icon {
            width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
            background: transparent; border: 1px solid transparent; border-radius: var(--radius);
            color: var(--fg-2); cursor: pointer; font-size: 12px; line-height: 1;
        }
        .kv-icon:hover { background: var(--bg-hover); color: var(--fg-0); border-color: var(--border); }
        .kv-icon.danger:hover { color: var(--error); border-color: var(--error); }
        .kv-add {
            margin-top: 6px; padding: 5px 11px;
            background: transparent; border: 1px dashed var(--border); border-radius: var(--radius);
            color: var(--fg-1); cursor: pointer; font: inherit; font-size: 11.5px;
        }
        .kv-add:hover { border-color: var(--focus); color: var(--fg-0); }
        .kv-empty { padding: 14px 4px; color: var(--fg-2); font-size: 11.5px; }

        /* ---------------------------------------------------- response */
        .status-strip { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
        .status-pill {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 2px 10px; border-radius: 999px;
            border: 1px solid var(--border); background: var(--bg-sunken);
            font-size: 11.5px; font-weight: 700; white-space: nowrap;
        }
        /* Status is conveyed by icon and text, not colour alone. */
        .status-pill.s2xx { border-color: var(--success); color: var(--success); }
        .status-pill.s3xx { border-color: var(--accent); color: var(--accent); }
        .status-pill.s4xx { border-color: var(--warning); color: var(--warning); }
        .status-pill.s5xx, .status-pill.s0xx { border-color: var(--error); color: var(--error); }
        .status-metric { display: inline-flex; align-items: baseline; gap: 5px; font-size: 11.5px; }
        .status-metric .label { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
        .status-metric .value { font-family: var(--font-mono); color: var(--fg-0); }

        .resp-tabs { display: flex; gap: 1px; }
        .resp-tab {
            padding: 6px 10px; border: 0; border-bottom: 2px solid transparent;
            background: transparent; color: var(--fg-2); cursor: pointer; font: inherit; font-size: 11.5px;
        }
        .resp-tab:hover { color: var(--fg-0); }
        .resp-tab.active { color: var(--fg-0); border-bottom-color: var(--primary); font-weight: 600; }
        .resp-toolbar { display: flex; align-items: center; gap: 6px; margin-left: auto; }
        .resp-search {
            width: 132px; height: 24px; padding: 0 8px;
            background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--radius);
            color: var(--fg-0); font-size: 11.5px;
        }
        .response-output {
            margin: 0; padding: 12px 14px;
            font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
            white-space: pre-wrap; word-break: break-word; color: var(--fg-0);
        }
        .response-notice { margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--border); border-left: 3px solid var(--warning); border-radius: 4px; color: var(--fg-1); font-family: var(--font-sans); font-size: 11.5px; line-height: 1.5; }
        .response-notice + .response-notice, .plain-response + .response-notice { margin: 10px 0 0; }
        .plain-response { white-space: pre-wrap; word-break: break-word; }
        .link-btn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
        .link-btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
        .response-output mark { background: var(--vscode-editor-findMatchHighlightBackground, var(--warning)); color: var(--vscode-editor-foreground, inherit); outline: 1px solid var(--warning); border-radius: 2px; }
        .resp-view { display: none; }
        .resp-view.active { display: block; }

        /* JSON syntax colours: theme token colours where available. */
        .json-key { color: var(--vscode-symbolIcon-propertyForeground, var(--accent)); }
        .json-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
        .json-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
        .json-boolean { color: var(--vscode-debugTokenExpression-boolean, #569cd6); }
        .json-null { color: var(--fg-2); }

        /* ---------------------------------------------------- empty states */
        .empty-state {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 8px; padding: 42px 22px; text-align: center; color: var(--fg-2); min-height: 160px;
        }
        .empty-state .glyph { font-size: 22px; opacity: .8; }
        .empty-state h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--fg-0); }
        .empty-state p { margin: 0; font-size: 12px; max-width: 42ch; line-height: 1.6; }

        /* ---------------------------------------------------- tool view */
        .tool-head {
            display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap;
            padding: 14px; border-bottom: 1px solid var(--border); background: var(--bg-raised);
        }
        .tool-title { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
        .tool-sub { margin: 0; font-size: 12px; color: var(--fg-2); max-width: 64ch; line-height: 1.55; }
        .tool-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .tier-pill {
            font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
            padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-2);
        }
        .tier-pill.premium { border-color: var(--warning); color: var(--warning); }
        .tier-pill.warn { border-color: var(--error); color: var(--error); }
        .tool-body { padding: 14px; }

        .locked-card {
            max-width: 460px; margin: 26px auto; padding: 22px;
            border: 1px dashed var(--border); border-radius: var(--radius-lg);
            background: var(--bg-raised); text-align: center;
        }
        .locked-card .glyph { font-size: 22px; }
        .locked-card h3 { margin: 8px 0 6px; font-size: 14px; }
        .locked-card p { margin: 0 0 8px; font-size: 12px; color: var(--fg-2); line-height: 1.6; }
        .locked-card .why { font-size: 11.5px; color: var(--fg-2); margin-bottom: 14px; }

        .feature-devbar {
            display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
            margin: 0 14px 12px; padding: 7px 11px;
            border: 1px dashed var(--border); border-radius: var(--radius);
            font-size: 11px; color: var(--fg-2);
        }
        .feature-output {
            margin-top: 12px; padding: 12px;
            background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--radius);
            font-family: var(--font-mono); font-size: 11.5px; line-height: 1.55;
            white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto;
        }
        .feature-output.error { border-color: var(--error); color: var(--error); }
        .feature-table { width: 100%; border-collapse: collapse; font-size: 11.5px; font-family: var(--font); }
        .feature-table th, .feature-table td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--border); vertical-align: top; }
        .feature-table th { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
        .pass { color: var(--success); } .fail { color: var(--error); }
        .tool-form .form-row { display: grid; grid-template-columns: 148px minmax(0,1fr); gap: 9px; align-items: center; margin-bottom: 9px; }
        .tool-form .form-row > label { font-size: 11.5px; color: var(--fg-2); }
        .tool-form .hint { margin: -4px 0 10px 157px; font-size: 11px; color: var(--fg-2); line-height: 1.5; }
        .tool-form textarea { min-height: 78px; }
        @media (max-width: 780px) {
            .tool-form .form-row { grid-template-columns: 1fr; }
            .tool-form .hint { margin-left: 0; }
        }

        /* ---------------------------------------------------- points hub */
        .points-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
        .points-card { border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; background: var(--bg-raised); }
        .points-card h4 { margin: 0 0 5px; font-size: 12.5px; }
        .points-card p { margin: 0 0 10px; font-size: 11.5px; color: var(--fg-2); line-height: 1.5; }

        /* ---------------------------------------------------- modals */
        .modal-overlay {
            position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
            background: rgba(0,0,0,.55); z-index: 100; padding: 20px;
        }
        .modal-overlay.open { display: flex; }
        .modal {
            width: min(560px, 100%); max-height: 84vh; display: flex; flex-direction: column;
            background: var(--bg-raised); border: 1px solid var(--border-strong);
            border-radius: var(--radius-lg); box-shadow: 0 12px 40px rgba(0,0,0,.4);
        }
        .modal-header {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            padding: 12px 16px; border-bottom: 1px solid var(--border);
        }
        .modal-title { font-size: 13px; font-weight: 600; }
        .modal-close {
            width: 26px; height: 26px; padding: 0; background: transparent; border: 0; border-radius: var(--radius);
            color: var(--fg-2); font-size: 18px; line-height: 1; cursor: pointer;
        }
        .modal-close:hover { background: var(--bg-hover); color: var(--fg-0); }
        .modal-body { padding: 16px; overflow: auto; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }

        .cookie-item {
            display: flex; align-items: center; justify-content: space-between; gap: 10px;
            padding: 8px 10px; margin-bottom: 6px;
            background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--radius);
            font-family: var(--font-mono); font-size: 11.5px; word-break: break-all;
        }

        /* ---------------------------------------------------- toasts */
        .toast-container { position: fixed; bottom: 16px; right: 16px; z-index: 200; display: flex; flex-direction: column; gap: 8px; }
        .toast {
            display: flex; align-items: center; gap: 8px;
            padding: 9px 14px; min-width: 190px; max-width: 320px;
            background: var(--bg-raised); color: var(--fg-0);
            border: 1px solid var(--border); border-left-width: 3px; border-radius: var(--radius);
            box-shadow: 0 6px 20px rgba(0,0,0,.35); font-size: 12px;
            animation: toast-in .18s ease;
        }
        .toast.success { border-left-color: var(--success); }
        .toast.error { border-left-color: var(--error); }
        .toast.warning { border-left-color: var(--warning); }
        .toast.info { border-left-color: var(--accent); }
        @keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

        .method-badge {
            display: inline-block; min-width: 42px; text-align: center;
            padding: 1px 5px; border-radius: 3px; border: 1px solid var(--border);
            font-family: var(--font-mono); font-size: 9.5px; font-weight: 700; letter-spacing: .03em;
        }
        .method-badge.GET { color: var(--success); border-color: var(--success); }
        .method-badge.POST { color: var(--accent); border-color: var(--accent); }
        .method-badge.PUT, .method-badge.PATCH { color: var(--warning); border-color: var(--warning); }
        .method-badge.DELETE { color: var(--error); border-color: var(--error); }

        /* ---------------------------------------------------- responsive */
        @media (max-width: 900px) {
            :root { --sidebar-w: 196px; }
            .topbar-actions .btn-label-text { display: none; }
        }
        @media (max-width: 720px) {
            .app { grid-template-columns: 1fr; grid-template-areas: "topbar" "main"; }
            .sidebar { display: none; }
            .app.sidebar-open { grid-template-columns: var(--sidebar-w) minmax(0,1fr); grid-template-areas: "topbar topbar" "sidebar main"; }
            .app.sidebar-open .sidebar { display: flex; }
            .url-row { gap: 6px; }
            .send-btn { min-width: 76px; padding: 0 12px; }
            .config-content, .tool-body { padding: 11px; }
            .kv-head, .kv-row { grid-template-columns: 24px minmax(0,1fr) minmax(0,1fr) 50px; }
        }
        @media (max-width: 560px) {
            .kv-head { display: none; }
            .kv-row { grid-template-columns: 24px minmax(0,1fr) 50px; grid-template-areas: "t k a" ". v v"; }
            .kv-row .kv-key { grid-area: k; } .kv-row .kv-value { grid-area: v; }
            .kv-row .kv-toggle { grid-area: t; } .kv-row .kv-actions { grid-area: a; }
            .url-field { flex-basis: 100%; order: 3; }
        }
        </style>
    </head>
    <body>
    <div class="app" id="appShell">

        <!-- ============================ TOP BAR ============================ -->
        <header class="topbar">
            <button class="icon-btn" id="toggleSidebar" type="button" title="Toggle the workspace sidebar" aria-label="Toggle the workspace sidebar" aria-expanded="true">&#9776;</button>
            <div class="topbar-brand"><span class="dot" aria-hidden="true"></span>REST API Client</div>
            <div class="topbar-spacer"></div>
            <div class="topbar-env">
                <label class="sr-only" for="envSelect">Active environment</label>
                <select id="envSelect" class="select" style="width:auto;min-width:130px;max-width:190px;">
                    <option value="-1">No Environment</option>
                </select>
                <button id="manageEnvBtn" class="btn btn-ghost btn-sm" type="button">Manage</button>
            </div>
            <button id="pointsBadge" class="points-badge" type="button"
                    title="Your DevSnip Pro points. Premium tools are unlocked by spending them."
                    aria-label="Points balance">
                <span aria-hidden="true">◆</span><span id="userPointsBadge">0</span><span class="unit">pts</span>
            </button>
            <div class="topbar-actions">
                <button id="copyAsCurl" class="btn btn-ghost btn-sm" type="button" title="Copy the current request as a cURL command">cURL</button>
                <button id="exportHistoryBtn" class="btn btn-ghost btn-sm" type="button" title="Export request history to a file">Export</button>
                <button id="showCookies" class="btn btn-ghost btn-sm" type="button" title="View stored cookies">Cookies</button>
                <button id="clearHistory" class="btn btn-ghost btn-sm" type="button" title="Clear request history">Clear History</button>
                <button id="clearCookies" class="btn btn-ghost btn-sm" type="button" title="Clear stored cookies">Clear Cookies</button>
            </div>
        </header>

        <!-- ============================ SIDEBAR ============================ -->
        <nav class="sidebar" id="sidebar" aria-label="Workspace">
            <div class="sidebar-top">
                <button class="btn btn-sm" id="newRequestBtn" type="button" style="width:100%;">+ New Request</button>
                <div class="search-wrap">
                    <span class="search-icon" aria-hidden="true">&#9906;</span>
                    <label class="sr-only" for="sidebarSearch">Search collections, history and tools</label>
                    <input type="search" id="sidebarSearch" class="input" placeholder="Search tools and requests" style="padding-left:24px;">
                </div>
            </div>

            <div class="sidebar-scroll">
                <!-- Collections -->
                <section class="nav-section" data-section="collections">
                    <button class="nav-section-head" type="button" aria-expanded="true" aria-controls="collectionsBody">
                        <span class="chev" aria-hidden="true">&#9660;</span><span>Collections</span>
                        <span class="count" id="collectionsCount"></span>
                    </button>
                    <div class="nav-section-body" id="collectionsBody">
                        <div id="collectionsTree"></div>
                        <button class="kv-add" id="saveToCollectionBtn" type="button" style="width:100%;margin-top:4px;">+ Save current request</button>
                    </div>
                </section>

                <!-- History -->
                <section class="nav-section" data-section="history">
                    <button class="nav-section-head" type="button" aria-expanded="true" aria-controls="historyBody">
                        <span class="chev" aria-hidden="true">&#9660;</span><span>History</span>
                        <span class="count" id="historyCount">0 requests</span>
                    </button>
                    <div class="nav-section-body" id="historyBody">
                        <div id="historyTableBody"></div>
                    </div>
                </section>

                <!-- AI / ML and Developer Tools are rendered from the feature
                     catalog the extension host sends, so the sidebar always
                     matches the user's real entitlement. -->
                <div id="toolNav"></div>
            </div>
        </nav>

        <!-- ============================= MAIN ============================== -->
        <main class="main">

            <!-- ------------------------- REQUEST VIEW ------------------------- -->
            <section class="view active" id="view-request" aria-label="Request builder">
                <div class="url-bar">
                    <div class="url-row">
                        <label class="sr-only" for="method">HTTP method</label>
                        <select id="method" class="method-select">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                            <option value="DELETE">DELETE</option>
                            <option value="HEAD">HEAD</option>
                            <option value="OPTIONS">OPTIONS</option>
                        </select>
                        <div class="url-field">
                            <label class="sr-only" for="url">Request URL</label>
                            <input type="text" id="url" class="url-input" placeholder="https://api.example.com/users  —  or paste a cURL command" autocomplete="off" spellcheck="false" aria-describedby="urlError">
                            <span class="url-error" id="urlError" role="status" aria-live="polite" role="alert"></span>
                        </div>
                        <button id="sendRequest" class="send-btn" type="button" title="Send the request (Ctrl/Cmd + Enter)">
                            <span class="btn-label">Send</span>
                            <div class="spinner hidden" aria-hidden="true"></div>
                        </button>
                        <button id="cancelRequest" class="cancel-btn" type="button">Cancel</button>
                    </div>
                </div>

                <div class="type-tabs" role="tablist" aria-label="Request protocol">
                    <button class="type-tab active" data-type="rest" type="button" role="tab" aria-selected="true">HTTP</button>
                    <button class="type-tab" data-type="graphql" type="button" role="tab" aria-selected="false">GraphQL</button>
                </div>

                <div class="workspace">
                    <!-- Request configuration -->
                    <div class="pane">
                        <div class="pane-head">
                            <div class="config-tabs" role="tablist" aria-label="Request configuration">
                                <button class="config-tab active" data-tab="params" type="button" role="tab" aria-selected="true">Params <span class="badge" id="paramCount">0</span></button>
                                <button class="config-tab" data-tab="headers" type="button" role="tab" aria-selected="false">Headers <span class="badge" id="headerCount">0</span></button>
                                <button class="config-tab" data-tab="body" type="button" role="tab" aria-selected="false">Body</button>
                                <button class="config-tab" data-tab="auth" type="button" role="tab" aria-selected="false">Auth</button>
                                <button class="config-tab" data-tab="tests" type="button" role="tab" aria-selected="false">Tests</button>
                                <button class="config-tab" data-tab="advanced" type="button" role="tab" aria-selected="false">Advanced</button>
                                <button class="config-tab" data-tab="graphql" id="graphqlTab" type="button" role="tab" aria-selected="false" style="display:none">GraphQL</button>
                            </div>
                        </div>
                        <div class="pane-body">
                            <!-- PARAMS -->
                            <div class="config-content active" id="tab-params">
                                <div class="kv-head" aria-hidden="true"><span></span><span>Key</span><span>Value</span><span></span></div>
                                <div id="paramsContainer"></div>
                                <button class="kv-add" id="addParam" type="button">+ Add parameter</button>
                            </div>

                            <!-- HEADERS -->
                            <div class="config-content" id="tab-headers">
                                <div class="kv-head" aria-hidden="true"><span></span><span>Key</span><span>Value</span><span></span></div>
                                <div id="headersContainer"></div>
                                <button class="kv-add" id="addHeader" type="button">+ Add header</button>
                            </div>

                            <!-- BODY -->
                            <div class="config-content" id="tab-body">
                                <div class="form-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                                    <label class="sr-only" for="bodyType">Body type</label>
                                    <select id="bodyType" class="select" style="width:auto;min-width:180px;">
                                        <option value="json">JSON</option>
                                        <option value="text">Text</option>
                                        <option value="form-urlencoded">Form URL Encoded</option>
                                    </select>
                                    <button class="btn btn-ghost btn-sm" id="beautifyJson" type="button">Format</button>
                                    <button class="btn btn-ghost btn-sm" id="minifyJson" type="button">Minify</button>
                                    <button class="btn btn-ghost btn-sm" id="validateData" type="button">Validate</button>
                                    <button class="btn btn-ghost btn-sm" id="convertToJson" type="button">To JSON</button>
                                </div>
                                <label class="sr-only" for="body">Request body</label>
                                <textarea id="body" class="textarea" rows="12" placeholder='{ "key": "value" }' spellcheck="false" aria-describedby="bodyNote"></textarea>
                                <div class="field-note" id="bodyNote"></div>
                            </div>

                            <!-- AUTH -->
                            <div class="config-content" id="tab-auth">
                                <div class="form-row">
                                    <label class="form-label" for="authType">Authentication type</label>
                                    <select id="authType" class="select" style="max-width:320px">
                                        <option value="">No Auth</option>
                                        <option value="Bearer">Bearer Token</option>
                                        <option value="Basic">Basic Auth</option>
                                        <option value="ApiKey">API Key</option>
                                    </select>
                                </div>
                                <div id="authFields"></div>
                            </div>

                            <!-- TESTS -->
                            <div class="config-content" id="tab-tests">
                                <div id="testsPanel"></div>
                            </div>

                            <!-- ADVANCED -->
                            <div class="config-content" id="tab-advanced">
                                <div class="form-row">
                                    <label class="form-label" for="timeout">Timeout (ms)</label>
                                    <input type="number" id="timeout" class="input" value="30000" min="1000" max="300000" style="max-width:160px">
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="retries">Automatic retries</label>
                                    <input type="number" id="retries" class="input" value="0" min="0" max="5" style="max-width:120px">
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="retryDelay">Retry base delay (ms)</label>
                                    <input type="number" id="retryDelay" class="input" value="500" min="0" max="10000" style="max-width:160px">
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="retryStatusCodes">Retry on status codes</label>
                                    <input type="text" id="retryStatusCodes" class="input" value="429,502,503,504" style="max-width:240px">
                                </div>
                                <div class="form-row">
                                    <label style="display:flex;align-items:center;gap:7px;font-size:12px;">
                                        <input type="checkbox" id="followRedirects" checked style="width:auto;accent-color:var(--primary);"> Follow redirects
                                    </label>
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="maxRedirects">Maximum redirects</label>
                                    <input type="number" id="maxRedirects" class="input" value="5" min="0" max="20" style="max-width:120px">
                                </div>
                                <div class="form-row">
                                    <label style="display:flex;align-items:center;gap:7px;font-size:12px;">
                                        <input type="checkbox" id="sslVerify" checked style="width:auto;accent-color:var(--primary);"> Verify SSL/TLS certificates
                                    </label>
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="proxyHost">Proxy host</label>
                                    <input type="text" id="proxyHost" class="input" placeholder="127.0.0.1" style="max-width:240px">
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="proxyPort">Proxy port</label>
                                    <input type="number" id="proxyPort" class="input" placeholder="8080" style="max-width:120px">
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="proxyUsername">Proxy username</label>
                                    <input type="text" id="proxyUsername" class="input" style="max-width:240px">
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="proxyPassword">Proxy password</label>
                                    <input type="password" id="proxyPassword" class="input" style="max-width:240px">
                                </div>
                            </div>

                            <!-- GRAPHQL -->
                            <div class="config-content" id="tab-graphql">
                                <div class="graphql-section" id="graphqlSection">
                                    <div class="form-row">
                                        <label class="form-label" for="graphqlQuery">Query</label>
                                        <textarea id="graphqlQuery" class="textarea" rows="10" spellcheck="false" placeholder="query {&#10;  users {&#10;    id&#10;    name&#10;  }&#10;}"></textarea>
                                    </div>
                                    <div class="form-row">
                                        <label class="form-label" for="graphqlVariables">Variables (JSON)</label>
                                        <textarea id="graphqlVariables" class="textarea" rows="4" spellcheck="false" placeholder='{ "id": 1 }'></textarea>
                                    </div>
                                    <div class="form-row">
                                        <label class="form-label" for="graphqlOperationName">Operation name</label>
                                        <input type="text" id="graphqlOperationName" class="input" placeholder="GetUsers" style="max-width:320px">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Response -->
                    <div class="pane">
                        <div class="pane-head">
                            <div class="status-strip" id="statusStrip">
                                <span class="pane-title">Response</span>
                                <span class="status-pill" id="statusCode" role="status" aria-live="polite">Idle</span>
                                <span class="status-metric"><span class="label">Time</span><span class="value" id="responseTime">-</span></span>
                                <span class="status-metric"><span class="label">Size</span><span class="value" id="responseSize">-</span></span>
                            </div>
                            <div class="resp-toolbar">
                                <label class="sr-only" for="responseSearch">Search the response</label>
                                <input type="search" id="responseSearch" class="resp-search" placeholder="Find in response">
                                <button class="btn btn-ghost btn-sm" id="copyResponseBtn" type="button" title="Copy the response body">Copy</button>
                                <button class="btn btn-ghost btn-sm" id="downloadResponseBtn" type="button" title="Save the response to a file">Save</button>
                            </div>
                        </div>
                        <div class="pane-head" style="min-height:30px;">
                            <div class="resp-tabs" role="tablist" aria-label="Response view">
                                <button class="resp-tab active" data-resp="body" type="button" role="tab" aria-selected="true">Body</button>
                                <button class="resp-tab" data-resp="headers" type="button" role="tab" aria-selected="false">Headers <span class="badge" id="respHeaderCount">0</span></button>
                                <button class="resp-tab" data-resp="cookies" type="button" role="tab" aria-selected="false">Cookies</button>
                                <button class="resp-tab" data-resp="raw" type="button" role="tab" aria-selected="false">Raw</button>
                            </div>
                        </div>
                        <div class="pane-body">
                            <div class="resp-view active" id="resp-body">
                                <pre class="response-output" id="responseOutput"><div class="empty-state"><div class="glyph" aria-hidden="true">&#9679;</div><h3>No response yet</h3><p>Configure your request and select Send to see the response here.</p></div></pre>
                            </div>
                            <div class="resp-view" id="resp-headers"><pre class="response-output" id="responseHeaders"></pre></div>
                            <div class="resp-view" id="resp-cookies"><pre class="response-output" id="responseCookies"></pre></div>
                            <div class="resp-view" id="resp-raw"><pre class="response-output" id="responseRaw"></pre></div>
                        </div>
                    </div>
                </div>
            </section>

            <!-- --------------------------- TOOL VIEW --------------------------- -->
            <section class="view" id="view-tool" aria-label="Tool">
                <div class="tool-head">
                    <div>
                        <h2 class="tool-title" id="toolTitle">Tools</h2>
                        <p class="tool-sub" id="toolSub"></p>
                    </div>
                    <div class="tool-actions">
                        <span class="tier-pill" id="featureTierPill">Free</span>
                        <button class="btn btn-ghost btn-sm" id="featureRefreshBtn" type="button">Refresh</button>
                        <button class="btn btn-sm" id="featureUpgradeBtn" type="button">Earn points</button>
                        <button class="btn btn-ghost btn-sm" id="backToRequest" type="button">Back to request</button>
                    </div>
                </div>
                <div class="pane-body">
                    <div class="tool-body">
                        <div id="toolFormHost" class="tool-form"></div>
                        <div class="feature-output" id="featureOutput" hidden></div>
                    </div>
                </div>
            </section>

            <!-- --------------------------- POINTS VIEW --------------------------- -->
            <section class="view" id="view-points" aria-label="Points">
                <div class="tool-head">
                    <div>
                        <h2 class="tool-title">Your points</h2>
                        <p class="tool-sub">Premium tools are unlocked by spending points you earn using DevSnip Pro.</p>
                    </div>
                    <div class="tool-actions">
                        <span class="tier-pill"><span id="currentPointsDisplay">0</span> pts</span>
                        <button class="btn btn-ghost btn-sm" id="openPointsTracker" type="button">Open tracker</button>
                        <button class="btn btn-ghost btn-sm" id="backToRequestFromPoints" type="button">Back to request</button>
                    </div>
                </div>
                <div class="pane-body">
                    <div class="tool-body">
                        <section class="points-summary" aria-labelledby="pointsUnlockedHeading">
                            <h3 id="pointsUnlockedHeading" class="points-heading">Unlocked at this balance</h3>
                            <div id="pointsUnlockedList" class="points-list"></div>
                        </section>
                        <section class="points-summary" aria-labelledby="pointsLockedHeading">
                            <h3 id="pointsLockedHeading" class="points-heading">Needs more points</h3>
                            <div id="pointsLockedList" class="points-list"></div>
                        </section>
                        <section class="points-summary" aria-labelledby="pointsEarnHeading">
                            <h3 id="pointsEarnHeading" class="points-heading">How to earn points</h3>
                            <ul class="points-earn">
                                <li>Run any DevSnip Pro tool: <strong>+3</strong> (+1 after 5 runs of the same tool in a day)</li>
                                <li>Create a custom snippet: <strong>+10</strong></li>
                                <li>Run a security or cloud audit: <strong>+8</strong></li>
                                <li>Run an AI, RAG or prompt tool: <strong>+5</strong></li>
                                <li>Daily login <strong>+5</strong>, daily bonus <strong>+10</strong></li>
                                <li>Milestones: <strong>+10 to +500</strong></li>
                            </ul>
                            <p class="points-note">Up to 120 points a day can be earned from tool use, plus one-time milestone bonuses.</p>
                        </section>
                    </div>
                </div>
            </section>
        </main>
    </div>

    <!-- ============================== MODALS ============================== -->
    <div id="envModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="envModalTitle">
        <div class="modal">
            <div class="modal-header">
                <span class="modal-title" id="envModalTitle">Manage environments</span>
                <button class="modal-close" id="closeEnvModal" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-row">
                    <label class="form-label" for="envName">Environment name</label>
                    <input type="text" id="envName" class="input" placeholder="Development, Staging, Production">
                </div>
                <div class="form-row">
                    <span class="form-label">Variables — reference them as <code>{{name}}</code> in the URL, headers or body</span>
                    <div class="kv-head" aria-hidden="true"><span></span><span>Name</span><span>Value</span><span></span></div>
                    <div id="envVarsContainer"></div>
                    <button class="kv-add" id="addEnvVarBtn" type="button">+ Add variable</button>
                </div>
            </div>
            <div class="modal-footer">
                <button id="deleteEnvBtn" class="btn btn-danger" type="button">Delete</button>
                <button id="saveEnvBtn" class="btn" type="button">Save environment</button>
            </div>
        </div>
    </div>

    <div id="cookieModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cookieModalTitle">
        <div class="modal">
            <div class="modal-header">
                <span class="modal-title" id="cookieModalTitle">Stored cookies</span>
                <button class="modal-close" id="closeCookieModal" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body"><div id="cookieList"></div></div>
            <div class="modal-footer"><button id="copyCookies" class="btn btn-ghost" type="button">Copy all</button></div>
        </div>
    </div>

    <div id="saveRequestModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="saveRequestTitle">
        <div class="modal">
            <div class="modal-header">
                <span class="modal-title" id="saveRequestTitle">Save request to a collection</span>
                <button class="modal-close" id="closeSaveRequestModal" type="button" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-row">
                    <label class="form-label" for="saveRequestName">Request name</label>
                    <input type="text" id="saveRequestName" class="input" placeholder="Get users">
                </div>
                <div class="form-row">
                    <label class="form-label" for="saveRequestFolder">Collection</label>
                    <input type="text" id="saveRequestFolder" class="input" list="collectionFolders" placeholder="Default">
                    <datalist id="collectionFolders"></datalist>
                </div>
                <div class="field-note" id="saveRequestNote"></div>
            </div>
            <div class="modal-footer">
                <button id="confirmSaveRequest" class="btn" type="button">Save request</button>
            </div>
        </div>
    </div>

    <div class="toast-container" id="toastContainer" role="status" aria-live="polite"></div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let isRequestInProgress = false;
            let currentView = 'request';
            let lastHistory = [];
            let savedRequests = [];
            let sidebarQuery = '';
            let activeRespTab = 'body';
            const collapsedSections = {};
            const collapsedGroups = {};
            let currentRequestType = 'rest';
            let environments = [];
            let activeEnvIndex = -1;

            /* ===== TABS ===== */
            /* Keeps the visual state and the accessible state in step. */
            function setTabSelected(tabs, active) {
                tabs.forEach(t => {
                    const isActive = t === active;
                    t.classList.toggle('active', isActive);
                    if (t.getAttribute('role') === 'tab') {
                        t.setAttribute('aria-selected', isActive ? 'true' : 'false');
                        t.tabIndex = isActive ? 0 : -1;
                    }
                });
            }

            document.querySelectorAll('.config-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    setTabSelected(document.querySelectorAll('.config-tab'), tab);
                    document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
                    const target = document.getElementById('tab-' + tab.dataset.tab);
                    if (target) target.classList.add('active');
                });
            });

            document.querySelectorAll('.type-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    setTabSelected(document.querySelectorAll('.type-tab'), tab);
                    currentRequestType = tab.dataset.type;
                    const isGraphQL = currentRequestType === 'graphql';
                    document.getElementById('graphqlSection').classList.toggle('visible', isGraphQL);
                    document.getElementById('graphqlTab').style.display = isGraphQL ? '' : 'none';
                    if (isGraphQL) {
                        document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
                        setTabSelected(document.querySelectorAll('.config-tab'), document.getElementById('graphqlTab'));
                        document.getElementById('tab-graphql').classList.add('active');
                    } else {
                        document.querySelectorAll('.config-tab')[0].click();
                    }
                });
            });

            /* ===== KV ROWS ===== */
            function addKVRow(container, key, value, enabled) {
                const host = document.getElementById(container);
                if (!host) return;
                const row = document.createElement('div');
                row.className = 'kv-row';

                const toggle = document.createElement('input');
                toggle.type = 'checkbox';
                toggle.className = 'kv-toggle';
                toggle.checked = enabled !== false;
                toggle.title = 'Include this entry in the request';
                toggle.setAttribute('aria-label', 'Include this entry in the request');

                const keyInput = document.createElement('input');
                keyInput.type = 'text';
                keyInput.className = 'input kv-key';
                keyInput.placeholder = 'Key';
                keyInput.value = key || '';
                keyInput.setAttribute('aria-label', 'Key');

                const valueInput = document.createElement('input');
                valueInput.type = 'text';
                valueInput.className = 'input kv-value';
                valueInput.placeholder = 'Value';
                valueInput.value = value || '';
                valueInput.setAttribute('aria-label', 'Value');

                const actions = document.createElement('div');
                actions.className = 'kv-actions';

                const duplicate = document.createElement('button');
                duplicate.type = 'button';
                duplicate.className = 'kv-icon';
                duplicate.title = 'Duplicate this entry';
                duplicate.setAttribute('aria-label', 'Duplicate this entry');
                duplicate.textContent = '\u29C9';
                duplicate.addEventListener('click', () => {
                    addKVRow(container, keyInput.value, valueInput.value, toggle.checked);
                });

                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'kv-icon danger';
                remove.title = 'Remove this entry';
                remove.setAttribute('aria-label', 'Remove this entry');
                remove.textContent = '\u00D7';
                remove.addEventListener('click', () => { row.remove(); updateHeaderCount(); });

                function syncDisabled() { row.classList.toggle('disabled', !toggle.checked); updateHeaderCount(); }
                toggle.addEventListener('change', syncDisabled);
                keyInput.addEventListener('input', updateHeaderCount);

                actions.appendChild(duplicate);
                actions.appendChild(remove);
                row.appendChild(toggle);
                row.appendChild(keyInput);
                row.appendChild(valueInput);
                row.appendChild(actions);
                host.appendChild(row);
                syncDisabled();
            }

            function collectKV(container) {
                const data = {};
                document.querySelectorAll('#' + container + ' .kv-row').forEach(row => {
                    const toggle = row.querySelector('.kv-toggle');
                    // A row the user switched off is left out of the request.
                    if (toggle && !toggle.checked) return;
                    const k = row.querySelector('.kv-key').value.trim();
                    const v = row.querySelector('.kv-value').value.trim();
                    if (k) data[k] = v;
                });
                return data;
            }

            document.getElementById('addParam').addEventListener('click', () => addKVRow('paramsContainer'));
            document.getElementById('addHeader').addEventListener('click', () => addKVRow('headersContainer'));

            document.querySelectorAll('.kv-remove').forEach(btn => {
                btn.addEventListener('click', function() { this.closest('.kv-row').remove(); updateHeaderCount(); });
            });

            function updateHeaderCount() {
                // Badges count the entries that will actually be sent.
                const countActive = id => document.querySelectorAll('#' + id + ' .kv-row').length
                    ? Array.prototype.filter.call(
                        document.querySelectorAll('#' + id + ' .kv-row'),
                        row => {
                            const toggle = row.querySelector('.kv-toggle');
                            const key = row.querySelector('.kv-key');
                            return (!toggle || toggle.checked) && key && key.value.trim();
                        }).length
                    : 0;
                const headerBadge = document.getElementById('headerCount');
                if (headerBadge) headerBadge.textContent = countActive('headersContainer');
                const paramBadge = document.getElementById('paramCount');
                if (paramBadge) paramBadge.textContent = countActive('paramsContainer');
            }

            /* ===== URL VALIDATION =====
               Inline and non-blocking: it explains the problem without
               preventing the user from continuing to type. */
            function validateUrlField() {
                const input = document.getElementById('url');
                const note = document.getElementById('urlError');
                if (!input || !note) return true;
                const raw = input.value.trim();
                const resolved = raw.replace(/\{\{\w+\}\}/g, 'placeholder');

                var clearValidity = function () {
                    input.classList.remove('invalid');
                    input.removeAttribute('aria-invalid');
                    input.removeAttribute('aria-describedby');
                    note.classList.remove('show');
                };
                if (!raw) { clearValidity(); note.textContent = ''; return false; }
                if (/^\s*curl\s/i.test(raw)) { clearValidity(); return true; }

                let message = '';
                try {
                    const parsed = new URL(resolved);
                    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                        message = 'Only http:// and https:// URLs can be sent.';
                    }
                } catch (error) {
                    message = /^https?:\/\//i.test(resolved)
                        ? 'This URL could not be parsed. Check for stray spaces or characters.'
                        : 'Include the scheme, for example https://api.example.com/users';
                }
                input.classList.toggle('invalid', Boolean(message));
                // Announce validity to assistive tech, not just with a colour.
                if (message) {
                    input.setAttribute('aria-invalid', 'true');
                    input.setAttribute('aria-describedby', 'urlError');
                } else {
                    input.removeAttribute('aria-invalid');
                    input.removeAttribute('aria-describedby');
                }
                note.textContent = message;
                note.classList.toggle('show', Boolean(message));
                return !message;
            }

            /* ===== METHOD COLOR ===== */
            const methodSelect = document.getElementById('method');
            function updateMethodColor() {
                const m = methodSelect.value;
                methodSelect.style.background = 'var(--method-' + m.toLowerCase() + ', var(--bg-3))';
            }
            methodSelect.addEventListener('change', updateMethodColor);
            updateMethodColor();

            /* ===== AUTH ===== */
            function updateAuthFields() {
                const authType = document.getElementById('authType').value;
                const el = document.getElementById('authFields');
                if (authType === 'Bearer') {
                    el.innerHTML = '<div class="form-row"><label class="form-label" for="authToken">Token</label><input type="password" id="authToken" class="input" placeholder="Enter bearer token"></div>';
                } else if (authType === 'Basic') {
                    el.innerHTML = '<div class="form-row"><label class="form-label" for="username">Username</label><input type="text" id="username" class="input" placeholder="Username"></div>' +
                        '<div class="form-row"><label class="form-label" for="password">Password</label><input type="password" id="password" class="input" placeholder="Password"></div>';
                } else if (authType === 'ApiKey') {
                    el.innerHTML = '<div class="form-row"><label class="form-label" for="apiKeyName">Key Name</label><input type="text" id="apiKeyName" class="input" placeholder="e.g., X-API-Key"></div>' +
                        '<div class="form-row"><label class="form-label" for="apiKeyValue">Key Value</label><input type="password" id="apiKeyValue" class="input" placeholder="Enter API key"></div>' +
                        '<div class="form-row"><label class="form-label">Add To</label><select id="apiKeyLocation" class="select" style="max-width:200px"><option value="header">Header</option><option value="query">Query Parameter</option></select></div>';
                } else {
                    el.innerHTML = '';
                }
            }
            document.getElementById('authType').addEventListener('change', updateAuthFields);
            updateAuthFields();

            /* ===== TOAST ===== */
            function toast(msg, type) {
                const host = document.getElementById('toastContainer') || document.body;
                const el = document.createElement('div');
                el.className = 'toast ' + (type || 'info');
                // Icon plus text, so the meaning does not rely on colour alone.
                const glyph = type === 'error' ? '\u2717' : type === 'warning' ? '\u26A0' : type === 'success' ? '\u2713' : '\u2139';
                const icon = document.createElement('span');
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = glyph;
                const text = document.createElement('span');
                text.textContent = msg;
                el.appendChild(icon);
                el.appendChild(text);
                host.appendChild(el);
                setTimeout(() => el.remove(), 3200);
            }

            /* ===== REQUEST STATE ===== */
            function setRequestState(active) {
                isRequestInProgress = active;
                const sendBtn = document.getElementById('sendRequest');
                const cancelBtn = document.getElementById('cancelRequest');
                const label = sendBtn.querySelector('.btn-label');
                const spinner = sendBtn.querySelector('.spinner');
                // Only the Send button is disabled, so the rest of the panel
                // stays usable while a request is in flight.
                sendBtn.disabled = active;
                sendBtn.setAttribute('aria-busy', active ? 'true' : 'false');
                cancelBtn.classList.toggle('visible', active);
                spinner.classList.toggle('hidden', !active);
                label.textContent = active ? 'Sending' : 'Send';
                if (active) setStatus('pending');
            }

            /* ===== STATUS PILL =====
               Conveys state with an icon and words as well as colour. */
            function setStatus(kind, status, statusText) {
                const pill = document.getElementById('statusCode');
                if (!pill) return;
                if (kind === 'idle') { pill.className = 'status-pill'; pill.textContent = 'Idle'; return; }
                if (kind === 'pending') { pill.className = 'status-pill'; pill.textContent = '\u25CB Sending'; return; }
                if (kind === 'error') {
                    pill.className = 'status-pill s0xx';
                    pill.textContent = '\u2717 ' + (statusText || 'Request failed');
                    return;
                }
                const family = Math.floor((status || 0) / 100);
                const glyph = family === 2 ? '\u2713' : family === 3 ? '\u21BB' : family === 4 ? '\u26A0' : '\u2717';
                pill.className = 'status-pill s' + (family || 0) + 'xx';
                pill.textContent = glyph + ' ' + status + (statusText ? ' ' + statusText : '');
            }

            /* ===== SYNTAX HIGHLIGHT ===== */
            /* Beyond this many characters the payload is shown as plain text.
               Syntax highlighting wraps every token in a span, so a multi-MB
               response would otherwise create tens of thousands of DOM nodes
               and make scrolling, searching and selection crawl. */
            var HIGHLIGHT_CHAR_BUDGET = 120000;
            var fullResponseText = '';
            var responseIsTruncated = false;

            function highlight(json, options) {
                if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
                fullResponseText = json;
                responseIsTruncated = false;

                if (!(options && options.force) && json.length > HIGHLIGHT_CHAR_BUDGET) {
                    responseIsTruncated = true;
                    var shown = json.slice(0, HIGHLIGHT_CHAR_BUDGET);
                    var remaining = json.length - shown.length;
                    return '<div class="response-notice" role="status">' +
                        'Showing the first ' + Math.round(HIGHLIGHT_CHAR_BUDGET / 1000) + ' KB of a ' +
                        (Math.round(json.length / 1000)).toLocaleString() + ' KB response as plain text, so the panel stays responsive. ' +
                        '<button type="button" class="link-btn" id="renderFullResponse">Highlight the whole response</button>' +
                        '</div><span class="plain-response">' + escapeHtml(shown) +
                        '</span><div class="response-notice">' + remaining.toLocaleString() +
                        ' more characters. Use Copy or Save to get the full payload.</div>';
                }

                var result = '';
                var i = 0;
                var len = json.length;
                while (i < len) {
                    if (json[i] === '"') {
                        var start = i; i++;
                        while (i < len && json[i] !== '"') {
                            if (json[i] === '\\\\') i++;
                            i++;
                        }
                        i++;
                        var raw = json.substring(start, i);
                        var content = raw.substring(1, raw.length - 1);
                        var isKey = (i < len && json[i] === ':');
                        result += '<span class="' + (isKey ? 'json-key' : 'json-string') + '">' + escapeHtml(content) + '</span>';
                        if (isKey) { while (i < len && json[i] !== ':') i++; i++; }
                    } else if (json[i] === '-' || (json[i] >= '0' && json[i] <= '9')) {
                        var start = i;
                        if (json[i] === '-') i++;
                        while (i < len && json[i] >= '0' && json[i] <= '9') i++;
                        if (i < len && json[i] === '.') { i++; while (i < len && json[i] >= '0' && json[i] <= '9') i++; }
                        if (i < len && (json[i] === 'e' || json[i] === 'E')) { i++; if (i < len && (json[i] === '+' || json[i] === '-')) i++; while (i < len && json[i] >= '0' && json[i] <= '9') i++; }
                        result += '<span class="json-number">' + json.substring(start, i) + '</span>';
                    } else if (json.substring(i, i + 4) === 'true') {
                        result += '<span class="json-boolean">true</span>'; i += 4;
                    } else if (json.substring(i, i + 5) === 'false') {
                        result += '<span class="json-boolean">false</span>'; i += 5;
                    } else if (json.substring(i, i + 4) === 'null') {
                        result += '<span class="json-null">null</span>'; i += 4;
                    } else {
                        result += escapeHtml(json[i]); i++;
                    }
                }
                return result;
            }

            /* The opt-in escape hatch for a payload above the render budget. */
            function wireFullResponseButton() {
                var button = document.getElementById('renderFullResponse');
                if (!button) return;
                button.addEventListener('click', function () {
                    button.disabled = true;
                    button.textContent = 'Rendering...';
                    // Let the disabled state paint before the expensive work.
                    setTimeout(function () {
                        document.getElementById('responseOutput').innerHTML = highlight(fullResponseText, { force: true });
                        toast('Full response highlighted', 'success');
                    }, 16);
                });
            }

            /* ===== JSON/XML HELPERS ===== */
            function convertToJson(c) {
                c = c.trim();
                try { return JSON.parse(c); } catch(e) {}
                if (c.startsWith('<') && c.endsWith('>')) {
                    const p = new DOMParser();
                    const x = p.parseFromString(c, 'text/xml');
                    if (!x.getElementsByTagName('parsererror').length) {
                        function n2j(node) {
                            const r = {};
                            if (node.attributes && node.attributes.length) {
                                r['@attributes'] = {};
                                for (let i = 0; i < node.attributes.length; i++) r['@attributes'][node.attributes[i].name] = node.attributes[i].value;
                            }
                            if (node.childNodes && node.childNodes.length) {
                                for (let i = 0; i < node.childNodes.length; i++) {
                                    const ch = node.childNodes[i];
                                    if (ch.nodeType === 3) { const t = ch.textContent.trim(); if (t) { if (!Object.keys(r).length) return t; r['#text'] = t; } }
                                    else if (ch.nodeType === 1) { const j = n2j(ch); if (r[ch.nodeName]) { if (!Array.isArray(r[ch.nodeName])) r[ch.nodeName] = [r[ch.nodeName]]; r[ch.nodeName].push(j); } else r[ch.nodeName] = j; }
                                }
                            }
                            return r;
                        }
                        return n2j(x.documentElement);
                    }
                    throw new Error('Invalid XML');
                }
                if (c.includes('=') && !c.includes('{') && !c.includes('<')) {
                    const r = {}; c.split('&').forEach(p => { const [k,v] = p.split('='); if (k) r[decodeURIComponent(k)] = v ? decodeURIComponent(v) : ''; }); return r;
                }
                throw new Error('Could not parse');
            }

            function formatXml(xml) {
                const p = new DOMParser(); const x = p.parseFromString(xml, 'text/xml');
                if (x.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
                let s = new XMLSerializer().serializeToString(x).replace(/></g, '>\\n<').replace(/^\\s*\\n/gm, '');
                let ind = 0; return s.split('\\n').map(l => { const t = l.trim(); if (t.startsWith('</')) ind--; const r = ' '.repeat(Math.max(0, ind)) + t; if (t.startsWith('<') && !t.startsWith('</') && !t.endsWith('/>')) ind++; return r; }).join('\\n');
            }

            /* ===== SHARED REQUEST PAYLOAD ===== */
            function buildRequestPayload() {
                const proxyHost = document.getElementById('proxyHost')?.value?.trim();
                return {
                    method: methodSelect.value,
                    url: document.getElementById('url').value.trim(),
                    data: document.getElementById('body').value.trim(),
                    params: collectKV('paramsContainer'),
                    headers: collectKV('headersContainer'),
                    authType: document.getElementById('authType').value,
                    authToken: document.getElementById('authToken')?.value,
                    username: document.getElementById('username')?.value,
                    password: document.getElementById('password')?.value,
                    apiKeyName: document.getElementById('apiKeyName')?.value,
                    apiKeyValue: document.getElementById('apiKeyValue')?.value,
                    apiKeyLocation: document.getElementById('apiKeyLocation')?.value,
                    timeout: parseInt(document.getElementById('timeout').value) || 30000,
                    requestType: currentRequestType,
                    graphqlQuery: document.getElementById('graphqlQuery')?.value?.trim() || '',
                    graphqlVariables: document.getElementById('graphqlVariables')?.value?.trim() || '',
                    graphqlOperationName: document.getElementById('graphqlOperationName')?.value?.trim() || '',
                    bodyType: document.getElementById('bodyType')?.value || 'json',
                    retries: parseInt(document.getElementById('retries')?.value) || 0,
                    retryDelay: parseInt(document.getElementById('retryDelay')?.value) || 500,
                    retryStatusCodes: (document.getElementById('retryStatusCodes')?.value || '')
                        .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n)),
                    followRedirects: document.getElementById('followRedirects')?.checked ?? true,
                    maxRedirects: parseInt(document.getElementById('maxRedirects')?.value) || 5,
                    rejectUnauthorized: document.getElementById('sslVerify')?.checked ?? true,
                    proxy: proxyHost ? {
                        host: proxyHost,
                        port: parseInt(document.getElementById('proxyPort')?.value) || 8080,
                        auth: document.getElementById('proxyUsername')?.value ? {
                            username: document.getElementById('proxyUsername').value,
                            password: document.getElementById('proxyPassword')?.value || ''
                        } : undefined
                    } : undefined
                };
            }

            /* ===== SEND ===== */
            document.getElementById('sendRequest').addEventListener('click', () => {
                if (isRequestInProgress) return;
                const url = document.getElementById('url').value.trim();
                if (!url) { toast('Enter a URL', 'error'); return; }
                if (!/^https?:\\/\\//i.test(url)) { toast('URL must start with http:// or https://', 'error'); return; }
                setRequestState(true);
                vscode.postMessage(Object.assign({ command: 'testAPI' }, buildRequestPayload()));
            });

            document.getElementById('cancelRequest').addEventListener('click', () => vscode.postMessage({ command: 'cancelRequest' }));

            /* ===== COPY AS CURL ===== */
            document.getElementById('copyAsCurl').addEventListener('click', () => {
                const url = document.getElementById('url').value.trim();
                if (!url) { toast('Enter a URL first', 'error'); return; }
                vscode.postMessage(Object.assign({ command: 'generateCurl' }, buildRequestPayload()));
            });

            /* ===== EXPORT HISTORY ===== */
            document.getElementById('exportHistoryBtn').addEventListener('click', () => {
                vscode.postMessage({ command: 'exportHistory', format: 'json' });
            });

            /* ===== IMPORT FROM CURL (paste into URL bar) ===== */
            document.getElementById('url').addEventListener('paste', (e) => {
                const text = (e.clipboardData || window.clipboardData).getData('text');
                if (text && text.trim().toLowerCase().startsWith('curl ')) {
                    e.preventDefault();
                    vscode.postMessage({ command: 'parseCurl', curl: text });
                }
            });

            /* ===== HISTORY CLICK ===== */
            document.getElementById('historyTableBody').addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                if (!row) return;
                const url = row.dataset.url;
                const method = row.dataset.method;
                if (url) document.getElementById('url').value = url;
                if (method) { methodSelect.value = method; updateMethodColor(); }
            });

            /* ===== BODY TOOLBAR ===== */
            document.getElementById('convertToJson').addEventListener('click', () => {
                const ta = document.getElementById('body'); const c = ta.value.trim();
                if (!c) { toast('Nothing to convert', 'warning'); return; }
                try { ta.value = JSON.stringify(convertToJson(c), null, 2); toast('Converted to JSON', 'success'); } catch(e) { toast('Conversion failed: ' + e.message, 'error'); }
            });
            document.getElementById('beautifyJson').addEventListener('click', () => {
                const ta = document.getElementById('body'); const c = ta.value.trim();
                if (!c) { toast('Nothing to format', 'warning'); return; }
                try { ta.value = JSON.stringify(JSON.parse(c), null, 2); toast('Formatted', 'success'); }
                catch(e) { try { ta.value = formatXml(c); toast('XML formatted', 'success'); } catch(e2) { toast('Invalid format', 'error'); } }
            });
            document.getElementById('validateData').addEventListener('click', () => {
                const c = document.getElementById('body').value.trim();
                if (!c) { toast('Nothing to validate', 'warning'); return; }
                try { JSON.parse(c); toast('Valid JSON', 'success'); } catch(e) {
                    try { const p = new DOMParser(); const x = p.parseFromString(c, 'text/xml'); if (x.getElementsByTagName('parsererror').length) throw 0; toast('Valid XML', 'success'); }
                    catch(e2) { toast('Invalid JSON/XML', 'error'); }
                }
            });

            /* ===== COOKIE MODAL ===== */
            document.getElementById('showCookies').addEventListener('click', () => vscode.postMessage({ command: 'getCookies' }));
            document.getElementById('closeCookieModal').addEventListener('click', () => document.getElementById('cookieModal').classList.remove('open'));
            document.getElementById('cookieList').addEventListener('click', (e) => {
                const item = e.target.closest('.cookie-item');
                if (item && item.dataset.cookie) {
                    navigator.clipboard.writeText(item.dataset.cookie).then(() => toast('Cookie copied!', 'success')).catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = item.dataset.cookie;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        toast('Cookie copied!', 'success');
                    });
                }
            });
            document.getElementById('copyCookies').addEventListener('click', () => {
                const text = document.getElementById('cookieList').innerText;
                navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success')).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    toast('Copied!', 'success');
                });
            });
            document.getElementById('clearHistory').addEventListener('click', () => { vscode.postMessage({ command: 'clearHistory' }); });
            document.getElementById('clearCookies').addEventListener('click', () => { vscode.postMessage({ command: 'clearCookies' }); });

            /* ===== ENVIRONMENT ===== */
            function updateEnvSelect() {
                const s = document.getElementById('envSelect');
                s.innerHTML = '<option value="-1">No Environment</option>';
                environments.forEach((e, i) => { const o = document.createElement('option'); o.value = i; o.textContent = e.name; if (i === activeEnvIndex) o.selected = true; s.appendChild(o); });
            }
            function openEnvModal() {
                document.getElementById('envModal').classList.add('open');
                const idx = parseInt(document.getElementById('envSelect').value);
                document.getElementById('envName').value = idx >= 0 && environments[idx] ? environments[idx].name : '';
                const c = document.getElementById('envVarsContainer'); c.innerHTML = '';
                if (idx >= 0 && environments[idx]) { Object.entries(environments[idx].variables).forEach(([k,v]) => addKVRow('envVarsContainer', k, v)); }
                else addKVRow('envVarsContainer');
            }
            document.getElementById('manageEnvBtn').addEventListener('click', openEnvModal);
            document.getElementById('closeEnvModal').addEventListener('click', () => document.getElementById('envModal').classList.remove('open'));
            document.getElementById('addEnvVarBtn').addEventListener('click', () => addKVRow('envVarsContainer'));
            document.getElementById('envSelect').addEventListener('change', (e) => vscode.postMessage({ command: 'setActiveEnvironment', index: parseInt(e.target.value) }));
            document.getElementById('saveEnvBtn').addEventListener('click', () => {
                const name = document.getElementById('envName').value.trim();
                if (!name) { toast('Enter environment name', 'error'); return; }
                vscode.postMessage({ command: 'saveEnvironment', environment: { name, variables: collectKV('envVarsContainer') } });
                document.getElementById('envModal').classList.remove('open');
            });
            document.getElementById('deleteEnvBtn').addEventListener('click', () => {
                const idx = parseInt(document.getElementById('envSelect').value);
                if (idx >= 0 && environments[idx])
                    vscode.postMessage({ command: 'deleteEnvironment', name: environments[idx].name });
                document.getElementById('envModal').classList.remove('open');
            });

            /* ===== HISTORY TABLE UPDATE ===== */
            function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

            function updateHistoryTable(history) {
                lastHistory = Array.isArray(history) ? history : [];
                document.getElementById('historyCount').textContent =
                    lastHistory.length + (lastHistory.length === 1 ? ' request' : ' requests');
                renderHistoryList();
            }

            /* Compact, scannable history rows in the sidebar. */
            function renderHistoryList() {
                const host = document.getElementById('historyTableBody');
                if (!host) return;
                const query = (sidebarQuery || '').toLowerCase();
                const rows = lastHistory.filter(entry =>
                    !query || (entry.url + ' ' + entry.method).toLowerCase().indexOf(query) !== -1);

                host.innerHTML = '';
                if (!rows.length) {
                    const hint = document.createElement('div');
                    hint.className = 'empty-hint';
                    hint.textContent = lastHistory.length
                        ? 'No request matches that search.'
                        : 'Sent requests appear here. Select one to load it again.';
                    host.appendChild(hint);
                    return;
                }

                rows.forEach(entry => {
                    let path = entry.url;
                    try { path = new URL(entry.url).pathname || '/'; } catch (e) { /* keep the raw value */ }
                    const family = Math.floor((entry.status || 0) / 100);

                    const row = document.createElement('button');
                    row.type = 'button';
                    row.className = 'hist-row';
                    row.title = entry.method + ' ' + entry.url +
                        (entry.status ? ' \u2014 ' + entry.status : '') +
                        (entry.responseTime ? ' in ' + entry.responseTime + 'ms' : '');

                    const badge = document.createElement('span');
                    badge.className = 'method-badge ' + entry.method;
                    badge.textContent = entry.method;

                    const label = document.createElement('span');
                    label.className = 'hist-path';
                    label.textContent = path;

                    const meta = document.createElement('span');
                    meta.className = 'hist-meta';
                    const glyph = family === 2 ? '\u2713' : family === 3 ? '\u21BB' : family === 4 ? '\u26A0' : family === 5 ? '\u2717' : '';
                    meta.textContent = (entry.status ? glyph + ' ' + entry.status : '-') +
                        (entry.responseTime ? '  ' + entry.responseTime + 'ms' : '');

                    row.appendChild(badge);
                    row.appendChild(label);
                    row.appendChild(meta);
                    row.addEventListener('click', () => {
                        document.getElementById('url').value = entry.url;
                        document.getElementById('method').value = entry.method;
                        validateUrlField();
                        showView('request');
                        toast('Loaded ' + entry.method + ' ' + path, 'info');
                    });
                    host.appendChild(row);
                });
            }

            /* ===== MESSAGE HANDLING ===== */
            window.addEventListener('message', (e) => {
                const d = e.data;
                switch (d.command) {
                    case 'requestStarted':
                        setRequestState(true);
                        document.getElementById('responseOutput').innerHTML = '<div class="response-placeholder"><div class="spinner" style="width:24px;height:24px;border-width:3px;"></div><div class="response-placeholder-text">Sending request...</div></div>';
                        break;
                    case 'apiResponse':
                        setRequestState(false);
                        // Kept so the assertion, diff and JSON tools can work
                        // against the response the user just received.
                        window.__lastResponse = { status: d.status, headers: d.headers, data: d.data, responseTime: d.responseTime };
                        window.__lastResponseText = typeof d.data === 'string' ? d.data : JSON.stringify(d.data, null, 2);
                        setStatus('http', d.status, d.statusText);
                        document.getElementById('responseTime').textContent = d.responseTime + 'ms';
                        document.getElementById('responseSize').textContent = d.size;
                        document.getElementById('responseOutput').innerHTML = highlight(d.data);
                        wireFullResponseButton();
                        renderResponseViews(window.__lastResponse);
                        document.getElementById('responseSearch').value = '';
                        updateHistoryTable(d.history);
                        if (d.truncated) toast('Response was truncated (too large to display in full)', 'warning');
                        toast(d.attempts && d.attempts > 1 ? ('Request completed after ' + d.attempts + ' attempts') : 'Request completed', 'success');
                        break;
                    case 'apiError':
                        setRequestState(false);
                        window.__lastResponse = { status: d.status || 0, headers: {}, data: d.response, responseTime: d.responseTime };
                        window.__lastResponseText = typeof d.response === 'string' ? d.response : JSON.stringify(d.response ?? d.error, null, 2);
                        if (d.status) setStatus('http', d.status); else setStatus('error', 0, d.error);
                        renderResponseViews(window.__lastResponse);
                        document.getElementById('responseTime').textContent = d.responseTime ? d.responseTime + 'ms' : '-';
                        document.getElementById('responseSize').textContent = '-';
                        var errHtml = '<span style="color:var(--error)">Error: ' + escapeHtml(d.error) + '</span>';
                        if (d.response) {
                            var responseStr = typeof d.response === 'string' ? d.response : JSON.stringify(d.response, null, 2);
                            errHtml += '\\n\\n' + highlight(responseStr);
                        }
                        document.getElementById('responseOutput').innerHTML = errHtml;
                        toast('Request failed: ' + d.error, 'error');
                        break;
                    case 'requestCancelled':
                        setRequestState(false);
                        document.getElementById('responseOutput').innerHTML = '<div class="response-placeholder"><div class="response-placeholder-icon">&#9888;</div><div class="response-placeholder-text">Request was cancelled</div></div>';
                        break;
                    case 'showCookies':
                        const cl = document.getElementById('cookieList'); cl.innerHTML = '';
                        if (!Object.keys(d.cookies).length) { cl.innerHTML = '<div class="response-placeholder"><div class="response-placeholder-text">No cookies stored</div></div>'; }
                        else { for (const [domain, cookies] of Object.entries(d.cookies)) { const div = document.createElement('div'); div.className = 'form-row'; div.innerHTML = '<div class="form-label">' + domain + '</div>' + cookies.map(c => '<div class="input text-mono text-sm cookie-item" style="margin-bottom:4px;cursor:pointer" data-cookie="' + escapeHtml(c) + '">' + escapeHtml(c) + '</div>').join(''); cl.appendChild(div); } }
                        document.getElementById('cookieModal').classList.add('open');
                        break;
                    case 'historyCleared': updateHistoryTable([]); toast('History cleared', 'success'); break;
                    case 'cookiesCleared': toast('Cookies cleared', 'success'); break;
                    case 'showEnvironments': case 'environmentSaved': case 'environmentDeleted': case 'environmentActivated':
                        environments = d.environments || []; activeEnvIndex = d.activeIndex ?? -1; updateEnvSelect();
                        if (d.command === 'environmentSaved') toast('Environment saved', 'success');
                        if (d.command === 'environmentDeleted') toast('Environment deleted', 'success');
                        break;
                    case 'showPoints':
                        document.getElementById('currentPointsDisplay').textContent = d.points;
                        document.getElementById('userPointsBadge').textContent = d.points;
                        break;
                    case 'responseSaved':
                        toast(d.success ? 'Response saved to ' + d.path : (d.error || 'Could not save the response'), d.success ? 'success' : 'error');
                        break;
                    case 'featureCatalog':
                        featureCatalog = d;
                        renderCatalog();
                        break;
                    case 'featureResult':
                        if (typeof d.remainingPoints === 'number') syncPointBalance(d.remainingPoints);
                        if (d.pointsCharged) {
                            toast('\u2212' + d.pointsCharged + ' points \u00b7 balance ' + d.remainingPoints, 'info');
                        }
                        if (d.featureId === 'websocket-client' && d.result && d.result.granted && window.__wsConnect) {
                            window.__wsConnect();
                            break;
                        }
                        // Collection changes are reflected in the sidebar tree.
                        if (d.result && Array.isArray(d.result.requests)) {
                            savedRequests = d.result.requests;
                            renderCollections();
                        }
                        if (d.featureId === 'collections-basic' && d.result && d.result.saved) {
                            document.getElementById('saveRequestModal').classList.remove('open');
                            toast('Saved "' + d.result.saved.name + '"', 'success');
                            refreshCollections();
                            break;
                        }
                        if (d.featureId === 'collections-basic' && d.result && typeof d.result.total === 'number' && !d.result.saved) {
                            toast('Request deleted', 'success');
                            refreshCollections();
                            break;
                        }
                        if (currentView !== 'tool') break;
                        renderFeatureResult(d.featureId, d.result);
                        if (typeof d.remainingPoints === 'number') {
                            document.getElementById('userPointsBadge').textContent = d.remainingPoints;
                            document.getElementById('currentPointsDisplay').textContent = d.remainingPoints;
                        }
                        break;
                    case 'featureError': {
                        var saveModal = document.getElementById('saveRequestModal');
                        if (d.featureId === 'collections-basic' && saveModal && saveModal.classList.contains('open')) {
                            var note = document.getElementById('saveRequestNote');
                            note.className = 'field-note error';
                            note.textContent = d.error || 'That request could not be saved.';
                            if (d.upgradeable) toast('Premium removes the saved-request limit', 'warning');
                            break;
                        }
                        if (typeof d.remainingPoints === 'number') syncPointBalance(d.remainingPoints);
                        featureOutput(d.error || 'That action failed.', true);
                        if (d.denial === 'insufficient-points') {
                            // Running out of points is recoverable, so show the
                            // way to earn more rather than leaving a dead end.
                            toast('Not enough points \u00b7 ' + (d.pointsShort || 0) + ' more needed', 'warning');
                            showEarnPoints();
                        } else if (d.upgradeable) {
                            toast('Premium is required for this tool', 'warning');
                        }
                        break;
                    }
                    case 'featureStreamStart':
                        window.__streamBuffer = '';
                        featureOutput('', false);
                        break;
                    case 'featureStreamDelta':
                        window.__streamBuffer = (window.__streamBuffer || '') + d.text;
                        featureOutput(window.__streamBuffer, false);
                        break;
                    case 'featureStreamError':
                        featureOutput(d.error || 'The stream failed.', true);
                        break;
                    case 'featureStreamDone': {
                        window.__lastAiText = d.text || window.__streamBuffer || '';
                        var diag = d.diagnostics || {};
                        var summary = '\\n\\n---\\ntotal: ' + (diag.totalMs || 0) + 'ms, ' + (diag.characters || 0) + ' characters';
                        if (diag.timeToFirstTokenMs !== undefined) {
                            summary += '\\ntime to first token: ' + diag.timeToFirstTokenMs + 'ms' +
                                '\\nchunks: ' + diag.chunks +
                                '\\ninter-chunk p50/p90/p99: ' + diag.interTokenMs.p50 + '/' + diag.interTokenMs.p90 + '/' + diag.interTokenMs.p99 + 'ms' +
                                '\\nthroughput: ' + diag.charactersPerSecond + ' chars/s';
                        }
                        featureOutput((window.__streamBuffer || d.text || '') + summary, Boolean(d.error));
                        break;
                    }
                    case 'curlGenerated':
                        if (d.error) { toast('Failed to generate cURL: ' + d.error, 'error'); break; }
                        navigator.clipboard.writeText(d.curl).then(() => toast('cURL command copied to clipboard!', 'success')).catch(() => {
                            const ta = document.createElement('textarea');
                            ta.value = d.curl;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            toast('cURL command copied to clipboard!', 'success');
                        });
                        break;
                    case 'curlParsed': {
                        if (d.error) { toast('cURL import failed: ' + d.error, 'error'); break; }
                        const r = d.request || {};
                        if (r.url) document.getElementById('url').value = r.url;
                        if (r.method) { methodSelect.value = r.method; updateMethodColor(); }
                        const headersContainer = document.getElementById('headersContainer');
                        headersContainer.innerHTML = '';
                        if (r.headers && Object.keys(r.headers).length) {
                            Object.entries(r.headers).forEach(([k, v]) => addKVRow('headersContainer', k, v));
                        } else {
                            addKVRow('headersContainer');
                        }
                        if (r.data !== undefined) document.getElementById('body').value = r.data;
                        if (r.authType === 'Basic') {
                            document.getElementById('authType').value = 'Basic';
                            updateAuthFields();
                            if (document.getElementById('username')) document.getElementById('username').value = r.username || '';
                            if (document.getElementById('password')) document.getElementById('password').value = r.password || '';
                        }
                        if (r.rejectUnauthorized === false && document.getElementById('sslVerify')) {
                            document.getElementById('sslVerify').checked = false;
                        }
                        if (r.followRedirects && document.getElementById('followRedirects')) {
                            document.getElementById('followRedirects').checked = true;
                        }
                        if (r.proxy && document.getElementById('proxyHost')) {
                            document.getElementById('proxyHost').value = r.proxy.host || '';
                            document.getElementById('proxyPort').value = r.proxy.port || '';
                            if (r.proxy.auth) {
                                document.getElementById('proxyUsername').value = r.proxy.auth.username || '';
                                document.getElementById('proxyPassword').value = r.proxy.auth.password || '';
                            }
                        }
                        toast('cURL command imported successfully', 'success');
                        break;
                    }
                    case 'historyExported':
                        if (d.success) toast('History exported successfully', 'success');
                        else if (d.error) toast('Export failed: ' + d.error, 'error');
                        break;
                    case 'error': toast('Error: ' + d.message, 'error'); break;
                }
            });



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

            function currentRequestSnapshot() {
                return {
                    method: methodSelect.value,
                    url: document.getElementById('url').value.trim(),
                    headers: collectKV('headersContainer'),
                    params: collectKV('paramsContainer'),
                    data: document.getElementById('body').value.trim(),
                    body: document.getElementById('body').value.trim()
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

                'security-headers-scan': function (body) { pointToolForm(body, 'Scan the configured endpoint for security headers.'); },
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
            function renderFeatureResult(featureId, result) {
                if (result === null || result === undefined) { featureOutput('Done.', false); return; }

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


            /* ===================== APP SHELL =====================
               View switching, the sidebar, collections and the response
               viewer. All of it drives the same messages the extension host
               already understands. */

            function showView(name) {
                currentView = name;
                ['request', 'tool', 'points'].forEach(function (view) {
                    var el = document.getElementById('view-' + view);
                    if (el) el.classList.toggle('active', view === name);
                });
                if (name !== 'tool') {
                    activeFeature = null;
                    if (typeof renderToolNav === 'function') renderToolNav();
                }
            }

            /* ---- sidebar ---- */
            function initSidebarSections() {
                document.querySelectorAll('.sidebar .nav-section[data-section]').forEach(function (section) {
                    var head = section.querySelector('.nav-section-head');
                    if (!head) return;
                    head.addEventListener('click', function () {
                        var collapsed = section.getAttribute('data-collapsed') === 'true';
                        if (collapsed) section.removeAttribute('data-collapsed');
                        else section.setAttribute('data-collapsed', 'true');
                        head.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
                    });
                });
            }

            function applySidebarSearch() {
                renderHistoryList();
                renderCollections();
                if (typeof renderToolNav === 'function') renderToolNav();
            }

            /* ---- collections ---- */
            function renderCollections() {
                var host = document.getElementById('collectionsTree');
                var counter = document.getElementById('collectionsCount');
                if (!host) return;
                var query = (sidebarQuery || '').toLowerCase();
                var matching = savedRequests.filter(function (request) {
                    return !query || (request.name + ' ' + request.url + ' ' + request.folder).toLowerCase().indexOf(query) !== -1;
                });
                if (counter) counter.textContent = savedRequests.length ? String(savedRequests.length) : '';

                host.innerHTML = '';
                if (!matching.length) {
                    var hint = document.createElement('div');
                    hint.className = 'empty-hint';
                    hint.textContent = savedRequests.length
                        ? 'No saved request matches that search.'
                        : 'Save a request to keep it here for later.';
                    host.appendChild(hint);
                    return;
                }

                var folders = {};
                matching.forEach(function (request) {
                    var folder = request.folder || 'Default';
                    (folders[folder] = folders[folder] || []).push(request);
                });

                Object.keys(folders).sort().forEach(function (folder) {
                    var group = document.createElement('div');
                    group.className = 'nav-group';
                    var key = 'collection/' + folder;
                    if (collapsedGroups[key]) group.setAttribute('data-collapsed', 'true');

                    var head = document.createElement('button');
                    head.type = 'button';
                    head.className = 'nav-group-head';
                    head.setAttribute('aria-expanded', collapsedGroups[key] ? 'false' : 'true');
                    head.innerHTML = '<span class="chev" aria-hidden="true">&#9660;</span>';
                    var label = document.createElement('span');
                    label.textContent = folder + ' (' + folders[folder].length + ')';
                    head.appendChild(label);
                    head.addEventListener('click', function () {
                        var collapsed = group.getAttribute('data-collapsed') === 'true';
                        collapsedGroups[key] = !collapsed;
                        if (collapsed) group.removeAttribute('data-collapsed');
                        else group.setAttribute('data-collapsed', 'true');
                        head.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
                    });

                    var body = document.createElement('div');
                    body.className = 'nav-group-body';

                    folders[folder].forEach(function (request) {
                        var row = document.createElement('div');
                        row.className = 'hist-row';
                        row.style.cursor = 'default';

                        var badge = document.createElement('span');
                        badge.className = 'method-badge ' + request.method;
                        badge.textContent = request.method;

                        var open = document.createElement('button');
                        open.type = 'button';
                        open.className = 'hist-path';
                        open.style.cssText = 'background:none;border:0;padding:0;color:inherit;font:inherit;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                        open.textContent = request.name;
                        open.title = request.method + ' ' + request.url;
                        open.addEventListener('click', function () { loadSavedRequest(request); });

                        var remove = document.createElement('button');
                        remove.type = 'button';
                        remove.className = 'kv-icon danger';
                        remove.title = 'Delete "' + request.name + '"';
                        remove.setAttribute('aria-label', 'Delete ' + request.name);
                        remove.textContent = '\u00D7';
                        remove.addEventListener('click', function () {
                            vscode.postMessage({ command: 'feature:deleteRequest', featureId: 'collections-basic', id: request.id });
                        });

                        row.appendChild(badge);
                        row.appendChild(open);
                        row.appendChild(remove);
                        body.appendChild(row);
                    });

                    group.appendChild(head);
                    group.appendChild(body);
                    host.appendChild(group);
                });
            }

            function loadSavedRequest(request) {
                document.getElementById('url').value = request.url || '';
                document.getElementById('method').value = request.method || 'GET';
                document.getElementById('body').value = request.body || '';
                if (request.bodyType) document.getElementById('bodyType').value = request.bodyType;

                document.getElementById('headersContainer').innerHTML = '';
                Object.keys(request.headers || {}).forEach(function (key) {
                    addKVRow('headersContainer', key, request.headers[key]);
                });
                document.getElementById('paramsContainer').innerHTML = '';
                Object.keys(request.params || {}).forEach(function (key) {
                    addKVRow('paramsContainer', key, request.params[key]);
                });

                updateHeaderCount();
                validateUrlField();
                showView('request');
                toast('Loaded "' + request.name + '"', 'success');
            }

            function refreshCollections() {
                vscode.postMessage({ command: 'feature:listCollections', featureId: 'collections-basic' });
            }

            /* ---- response viewer ---- */
            function showRespTab(name) {
                activeRespTab = name;
                document.querySelectorAll('.resp-tab').forEach(function (tab) {
                    var on = tab.dataset.resp === name;
                    tab.classList.toggle('active', on);
                    tab.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                ['body', 'headers', 'cookies', 'raw'].forEach(function (view) {
                    var el = document.getElementById('resp-' + view);
                    if (el) el.classList.toggle('active', view === name);
                });
            }

            function renderResponseViews(payload) {
                var headers = payload.headers || {};
                var headerKeys = Object.keys(headers);
                var headerBadge = document.getElementById('respHeaderCount');
                if (headerBadge) headerBadge.textContent = headerKeys.length;

                document.getElementById('responseHeaders').textContent = headerKeys.length
                    ? headerKeys.sort().map(function (key) { return key + ': ' + headers[key]; }).join('\\n')
                    : 'This response carried no headers.';

                var cookies = headers['set-cookie'];
                document.getElementById('responseCookies').textContent = cookies
                    ? (Array.isArray(cookies) ? cookies.join('\\n') : String(cookies))
                    : 'This response did not set any cookies.';

                document.getElementById('responseRaw').textContent =
                    typeof payload.data === 'string' ? payload.data : JSON.stringify(payload.data, null, 2);
            }

            function applyResponseSearch() {
                var term = (document.getElementById('responseSearch') || {}).value || '';
                var host = document.getElementById('responseOutput');
                if (!host) return;
                // Clear any previous highlight by re-rendering from the source.
                if (!window.__lastResponse) return;
                host.innerHTML = highlight(window.__lastResponse.data);
                wireFullResponseButton();
                if (!term.trim()) return;

                var safe = term.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
                var pattern = new RegExp(safe, 'gi');
                var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
                var targets = [];
                while (walker.nextNode()) targets.push(walker.currentNode);

                var hits = 0;
                targets.forEach(function (node) {
                    if (!pattern.test(node.nodeValue)) return;
                    pattern.lastIndex = 0;
                    var span = document.createElement('span');
                    span.innerHTML = escapeHtml(node.nodeValue).replace(pattern, function (m) {
                        hits++;
                        return '<mark>' + m + '</mark>';
                    });
                    node.parentNode.replaceChild(span, node);
                });
                if (!term.trim()) return;

                // The rendered view may be capped, so report against the whole payload.
                var totalInPayload = 0;
                if (fullResponseText) {
                    var counter = new RegExp(safe, 'gi');
                    while (counter.exec(fullResponseText) !== null) totalInPayload++;
                }
                if (!hits && !totalInPayload) {
                    toast('No match for "' + term + '" in the response', 'info');
                } else if (responseIsTruncated && totalInPayload > hits) {
                    toast(hits + ' of ' + totalInPayload + ' matches are in the part shown - highlight the whole response to see the rest', 'info');
                }
            }

            function emptyResponseState() {
                return '<div class="empty-state"><div class="glyph" aria-hidden="true">&#9679;</div>' +
                    '<h3>No response yet</h3><p>Configure your request and select Send to see the response here.</p></div>';
            }

            /* ---- wiring ---- */
            initSidebarSections();
            showRespTab('body');

            document.getElementById('toggleSidebar').addEventListener('click', function () {
                var shell = document.getElementById('appShell');
                var narrow = window.matchMedia('(max-width: 720px)').matches;
                var cls = narrow ? 'sidebar-open' : 'sidebar-collapsed';
                shell.classList.toggle(cls);
                var open = narrow ? shell.classList.contains('sidebar-open') : !shell.classList.contains('sidebar-collapsed');
                this.setAttribute('aria-expanded', open ? 'true' : 'false');
            });

            document.getElementById('sidebarSearch').addEventListener('input', function () {
                sidebarQuery = this.value.trim();
                applySidebarSearch();
            });

            document.getElementById('newRequestBtn').addEventListener('click', function () {
                document.getElementById('url').value = '';
                document.getElementById('body').value = '';
                document.getElementById('method').value = 'GET';
                document.getElementById('headersContainer').innerHTML = '';
                document.getElementById('paramsContainer').innerHTML = '';
                document.getElementById('responseOutput').innerHTML = emptyResponseState();
                document.getElementById('responseTime').textContent = '-';
                document.getElementById('responseSize').textContent = '-';
                setStatus('idle');
                updateHeaderCount();
                validateUrlField();
                showView('request');
                document.getElementById('url').focus();
            });

            document.querySelectorAll('.resp-tab').forEach(function (tab) {
                tab.addEventListener('click', function () { showRespTab(tab.dataset.resp); });
            });

            document.getElementById('responseSearch').addEventListener('input', applyResponseSearch);

            document.getElementById('copyResponseBtn').addEventListener('click', function () {
                if (!window.__lastResponseText) { toast('There is no response to copy yet', 'warning'); return; }
                navigator.clipboard.writeText(window.__lastResponseText).then(
                    function () { toast('Response copied to the clipboard', 'success'); },
                    function () { toast('The clipboard is not available here', 'error'); });
            });

            document.getElementById('downloadResponseBtn').addEventListener('click', function () {
                if (!window.__lastResponseText) { toast('There is no response to save yet', 'warning'); return; }
                vscode.postMessage({ command: 'saveResponse', body: window.__lastResponseText });
            });

            document.getElementById('url').addEventListener('input', validateUrlField);
            document.getElementById('url').addEventListener('blur', validateUrlField);

            // Ctrl/Cmd + Enter sends from anywhere in the request view.
            /* ===== TAB KEYBOARD NAVIGATION =====
               Elements with role="tab" are expected to behave like a tab list:
               arrow keys move between tabs and only the active tab is in the
               page's tab order, so Tab steps past the whole group instead of
               through every tab in it. */
            function wireTabList(list) {
                var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
                if (!tabs.length) return;

                function syncTabStops() {
                    tabs.forEach(function (tab) {
                        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
                    });
                }

                function focusTab(index) {
                    var next = tabs[(index + tabs.length) % tabs.length];
                    if (!next) return;
                    next.tabIndex = 0;
                    next.focus();
                    next.click();
                    syncTabStops();
                }

                list.addEventListener('keydown', function (event) {
                    var current = tabs.indexOf(document.activeElement);
                    if (current === -1) return;
                    switch (event.key) {
                        case 'ArrowRight':
                        case 'ArrowDown':
                            event.preventDefault(); focusTab(current + 1); break;
                        case 'ArrowLeft':
                        case 'ArrowUp':
                            event.preventDefault(); focusTab(current - 1); break;
                        case 'Home':
                            event.preventDefault(); focusTab(0); break;
                        case 'End':
                            event.preventDefault(); focusTab(tabs.length - 1); break;
                        default:
                            break;
                    }
                });

                // Clicking a tab changes which one holds the tab stop.
                tabs.forEach(function (tab) { tab.addEventListener('click', syncTabStops); });
                syncTabStops();
            }
            document.querySelectorAll('[role="tablist"]').forEach(wireTabList);

            document.addEventListener('keydown', function (event) {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    if (!isRequestInProgress) document.getElementById('sendRequest').click();
                }
                if (event.key === 'Escape') {
                    document.querySelectorAll('.modal-overlay.open').forEach(function (m) { m.classList.remove('open'); });
                }
            });

            document.getElementById('backToRequest').addEventListener('click', function () { showView('request'); });
            document.getElementById('backToRequestFromPoints').addEventListener('click', function () { showView('request'); });
            document.getElementById('openPointsTracker')?.addEventListener('click', function () {
                vscode.postMessage({ command: 'feature:openPointsTracker' });
            });
            document.getElementById('pointsBadge')?.addEventListener('click', function () { showView('points'); });

            /* Save the current request into a collection. */
            document.getElementById('saveToCollectionBtn').addEventListener('click', function () {
                var url = document.getElementById('url').value.trim();
                if (!url) { toast('Enter a URL before saving the request', 'warning'); return; }
                document.getElementById('saveRequestName').value = '';
                document.getElementById('saveRequestFolder').value = 'Default';
                document.getElementById('saveRequestNote').textContent = '';
                var list = document.getElementById('collectionFolders');
                list.innerHTML = '';
                var seen = {};
                savedRequests.forEach(function (request) {
                    if (seen[request.folder]) return;
                    seen[request.folder] = true;
                    var option = document.createElement('option');
                    option.value = request.folder;
                    list.appendChild(option);
                });
                document.getElementById('saveRequestModal').classList.add('open');
                document.getElementById('saveRequestName').focus();
            });

            document.getElementById('closeSaveRequestModal').addEventListener('click', function () {
                document.getElementById('saveRequestModal').classList.remove('open');
            });

            document.getElementById('confirmSaveRequest').addEventListener('click', function () {
                var url = document.getElementById('url').value.trim();
                var name = document.getElementById('saveRequestName').value.trim() || url;
                vscode.postMessage({
                    command: 'feature:saveRequest',
                    featureId: 'collections-basic',
                    request: {
                        name: name,
                        folder: document.getElementById('saveRequestFolder').value.trim() || 'Default',
                        method: document.getElementById('method').value,
                        url: url,
                        headers: collectKV('headersContainer'),
                        params: collectKV('paramsContainer'),
                        body: document.getElementById('body').value,
                        bodyType: document.getElementById('bodyType').value
                    }
                });
            });

            document.getElementById('minifyJson').addEventListener('click', function () {
                var field = document.getElementById('body');
                var note = document.getElementById('bodyNote');
                try {
                    field.value = JSON.stringify(JSON.parse(field.value));
                    field.classList.remove('invalid');
                    note.className = 'field-note ok';
                    note.textContent = 'Minified.';
                } catch (error) {
                    field.classList.add('invalid');
                    note.className = 'field-note error';
                    note.textContent = 'Not valid JSON: ' + error.message;
                }
            });

            refreshCollections();

            vscode.postMessage({ command: 'feature:getCatalog' });

            /* ===== INIT ===== */
            vscode.postMessage({ command: 'getEnvironments' });
            vscode.postMessage({ command: 'getPoints' });
        </script>
    </body>
    </html>
  `;
}
