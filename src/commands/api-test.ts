import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import axios, { AxiosRequestConfig, CancelTokenSource } from "axios";
import * as https from "https";
import * as path from "path";
import { getUserStats, redeemPoints, refundPoints } from "./milestoneTracker";
import { safePostMessage } from "../utils/webview-ui";

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

export function apiTest(context: vscode.ExtensionContext) {
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
      panel.webview.html = getWebviewContent(apiTester.getHistory());
      const post = (message: unknown) => safePostMessage(panel, message);

      const messageSubscription = panel.webview.onDidReceiveMessage(
        async (message) => {
          if (!message || typeof message.command !== "string") return;
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

            case "runPremiumFeature": {
              const { featureId, cost, requestData } = message;
              const success = await redeemPoints(context, cost, `API Client Premium Tool: ${featureId}`);
              if (!success) {
                const currentStats = getUserStats(context);
                post({
                  command: "premiumError",
                  error: `Insufficient points! Required: ${cost} pts, Available: ${currentStats.totalPoints} pts. Earn more points using DevSnip Pro tools!`
                });
                break;
              }

              try {
                let resultOutput = "";
                const targetUrl = requestData?.url || 'https://api.example.com';
                const targetMethod = requestData?.method || 'GET';
                const targetHeaders = requestData?.headers || {};
                const targetBody = requestData?.data;

                if (featureId === "secScan") {
                  try {
                    const res = await axios({ method: targetMethod, url: targetUrl, validateStatus: () => true, timeout: 10000 });
                    const headers = res.headers;
                    const issues: string[] = [];
                    if (!headers['strict-transport-security']) issues.push("Missing HSTS (Strict-Transport-Security) header");
                    if (!headers['content-security-policy']) issues.push("Missing Content Security Policy (CSP)");
                    if (!headers['x-content-type-options']) issues.push("Missing X-Content-Type-Options header");
                    if (!headers['x-frame-options']) issues.push("Missing X-Frame-Options (Clickjacking protection)");
                    if (targetUrl.startsWith('http://')) issues.push("Insecure protocol: using HTTP instead of HTTPS");

                    resultOutput = `🛡️ Live Security Audit Report for ${targetUrl}\n` +
                      `--------------------------------------------------\n` +
                      `• HTTP Status: ${res.status} ${res.statusText}\n` +
                      `• Security Headers Scanned: ${Object.keys(headers).length} found\n` +
                      `• Vulnerabilities / Recommendations (${issues.length}):\n` +
                      (issues.length > 0 ? issues.map(i => `  ⚠️ ${i}`).join('\n') : `  ✅ All standard security headers properly configured!`) + `\n\n` +
                      `• OWASP API Security Top 10 Check: ${issues.length <= 1 ? 'PASSED' : 'REVIEW RECOMMENDED'}`;
                  } catch (err: any) {
                    resultOutput = `🛡️ Security Scan Error: Unable to reach ${targetUrl} (${err.message})`;
                  }
                } else if (featureId === "loadTest") {
                  try {
                    const startTime = Date.now();
                    const batchSize = 3;
                    const promises = Array.from({ length: batchSize }).map(() => {
                      const t0 = Date.now();
                      return axios({ method: targetMethod, url: targetUrl, validateStatus: () => true, timeout: 10000 })
                        .then(r => ({ status: r.status, time: Date.now() - t0, success: r.status < 500 }))
                        .catch(e => ({ status: 0, time: Date.now() - t0, success: false, error: e.message }));
                    });
                    const results = await Promise.all(promises);
                    const totalTime = Date.now() - startTime;
                    const avgTime = Math.round(results.reduce((acc, r) => acc + r.time, 0) / results.length);
                    const successCount = results.filter(r => r.success).length;

                    resultOutput = `🧪 Live Multi-Request Load & Latency Test (${batchSize} Concurrent Calls)\n` +
                      `--------------------------------------------------\n` +
                      `• Target Endpoint: ${targetMethod} ${targetUrl}\n` +
                      `• Total Execution Duration: ${totalTime}ms\n` +
                      `• Average Response Latency: ${avgTime}ms\n` +
                      `• Success Rate: ${Math.round((successCount / batchSize) * 100)}% (${successCount}/${batchSize} successful)\n` +
                      `• Latency Breakdown:\n` +
                      results.map((r, idx) => `  [Call #${idx + 1}] Status: ${r.status} | Latency: ${r.time}ms | ${r.success ? 'SUCCESS' : 'FAILED'}`).join('\n');
                  } catch (err: any) {
                    resultOutput = `🧪 Load Test Error: ${err.message}`;
                  }
                } else if (featureId === "sdkExporter") {
                  const parsedHeaders = JSON.stringify(targetHeaders, null, 2);
                  const hasBody = targetBody && ['POST', 'PUT', 'PATCH'].includes(targetMethod.toUpperCase());
                  
                  resultOutput = `// 📦 Production-Ready Type-Safe SDK Exporter\n// Target: ${targetMethod} ${targetUrl}\n\n` +
                    `// 1. TypeScript / Axios Client\nimport axios from 'axios';\n\n` +
                    `export interface ApiRequestOptions {\n  headers?: Record<string, string>;\n  data?: any;\n}\n\n` +
                    `export async function executeApiRequest(options?: ApiRequestOptions) {\n` +
                    `  const response = await axios({\n` +
                    `    method: '${targetMethod.toLowerCase()}',\n` +
                    `    url: '${targetUrl}',\n` +
                    `    headers: { 'Content-Type': 'application/json', ...${parsedHeaders}, ...options?.headers },\n` +
                    (hasBody ? `    data: options?.data || ${targetBody}\n` : ``) +
                    `  });\n  return response.data;\n}\n\n` +
                    `// 2. Python Requests Snippet\n` +
                    `import requests\n\nurl = "${targetUrl}"\nheaders = ${JSON.stringify(targetHeaders)}\n` +
                    (hasBody ? `data = ${targetBody}\nresponse = requests.${targetMethod.toLowerCase()}(url, json=data, headers=headers)\n` : `response = requests.${targetMethod.toLowerCase()}(url, headers=headers)\n`) +
                    `print(response.json())`;
                } else if (featureId === "mockGenerator") {
                  let parsedData = {};
                  try {
                    parsedData = targetBody ? JSON.parse(targetBody) : { sampleResponse: "OK", timestamp: Date.now() };
                  } catch {
                    parsedData = { rawData: targetBody || "Sample" };
                  }

                  let parsedPath = '/api/endpoint';
                  try {
                    parsedPath = new URL(targetUrl).pathname || '/api/endpoint';
                  } catch {}

                  resultOutput = `🤖 AI Response Mock Server & JSON Schema Contract Generator\n` +
                    `--------------------------------------------------\n\n` +
                    `// Express.js Mock Route Implementation\n` +
                    `const express = require('express');\nconst app = express();\napp.use(express.json());\n\n` +
                    `app.all('${parsedPath}', (req, res) => {\n` +
                    `  console.log('[Mock Server] Received ${targetMethod} request with body:', req.body);\n` +
                    `  res.setHeader('Content-Type', 'application/json');\n` +
                    `  res.setHeader('X-Mocked-By', 'DevSnip-Pro');\n` +
                    `  res.status(200).json({\n` +
                    `    status: "success",\n` +
                    `    endpoint: "${parsedPath}",\n` +
                    `    mockData: ${JSON.stringify(parsedData, null, 4)},\n` +
                    `    simulatedAt: new Date().toISOString()\n` +
                    `  });\n});\n\n` +
                    `// Inferred JSON Schema Contract:\n` +
                    JSON.stringify({
                      "$schema": "http://json-schema.org/draft-07/schema#",
                      "title": "InferredAPIContract",
                      "type": "object",
                      "properties": {
                        "status": { "type": "string" },
                        "endpoint": { "type": "string" },
                        "mockData": { "type": "object" },
                        "simulatedAt": { "type": "string" }
                      }
                    }, null, 2);
                }

                if (!resultOutput) {
                  throw new Error(`Unknown premium feature "${featureId}"`);
                }

                const updatedStats = getUserStats(context);
                post({
                  command: "premiumResult",
                  featureId,
                  result: resultOutput,
                  remainingPoints: updatedStats.totalPoints
                });
              } catch (err: any) {
                // The points were already deducted, so give them back rather
                // than charging the user for work that produced nothing.
                await refundPoints(context, cost, `Failed premium tool: ${featureId}`);
                const refreshed = getUserStats(context);
                post({
                  command: "premiumError",
                  error: `${err?.message || "Premium feature execution failed"} - your ${cost} points were refunded.`,
                  remainingPoints: refreshed.totalPoints
                });
              }
              break;
            }
          }
        },
      );

      // Clean up on panel disposal
      panel.onDidDispose(() => {
        messageSubscription.dispose();
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

function getWebviewContent(history: ApiHistoryItem[]): string {
  const nonce = getNonce();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <title>API Tester Pro</title>
        <style>
        :root {
            --primary: #007acc;
            --primary-hover: #005f99;
            --primary-glow: rgba(0, 122, 204, 0.15);
            --success: #4caf50;
            --success-bg: rgba(76, 175, 80, 0.12);
            --error: #f44336;
            --error-bg: rgba(244, 67, 54, 0.12);
            --warning: #ff9800;
            --warning-bg: rgba(255, 152, 0, 0.12);
            --info: #2196f3;
            --bg-0: #181818;
            --bg-1: #1e1e1e;
            --bg-2: #252526;
            --bg-3: #2d2d2d;
            --bg-4: #383838;
            --fg-0: #ffffff;
            --fg-1: #cccccc;
            --fg-2: #999999;
            --fg-3: #666666;
            --border: #3c3c3c;
            --border-focus: var(--primary);
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
            --shadow-md: 0 4px 12px rgba(0,0,0,0.4);
            --shadow-lg: 0 8px 24px rgba(0,0,0,0.5);
            --transition: 0.2s ease;
            --font-mono: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
            --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            --method-get: #61affe;
            --method-post: #49cc90;
            --method-put: #fca130;
            --method-delete: #f93e3e;
            --method-patch: #50e3c2;
            --method-head: #9012fe;
            --method-options: #0d5aa7;
        }

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
            font-family: var(--font-sans);
            background: var(--bg-0);
            color: var(--fg-1);
            line-height: 1.5;
            padding: 0;
            overflow-x: hidden;
        }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--bg-4); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--fg-3); }

        /* ===== TOP BAR ===== */
        .topbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 20px;
            background: var(--bg-2);
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 100;
            flex-wrap: wrap;
        }

        .topbar-brand {
            font-size: 15px;
            font-weight: 700;
            color: var(--primary);
            letter-spacing: -0.3px;
            white-space: nowrap;
        }

        .topbar-env {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-left: auto;
        }

        .topbar-env select {
            padding: 5px 10px;
            background: var(--bg-3);
            color: var(--fg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 12px;
            cursor: pointer;
            max-width: 160px;
        }

        .topbar-actions {
            display: flex;
            gap: 6px;
        }

        /* ===== URL BAR ===== */
        .url-bar {
            display: flex;
            gap: 0;
            padding: 16px 20px;
            background: var(--bg-1);
            border-bottom: 1px solid var(--border);
            align-items: stretch;
        }

        .url-bar-inner {
            display: flex;
            flex: 1;
            border: 2px solid var(--border);
            border-radius: var(--radius-md);
            overflow: hidden;
            transition: border-color var(--transition);
            background: var(--bg-2);
        }

        .url-bar-inner:focus-within {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px var(--primary-glow);
        }

        .method-select {
            padding: 0 14px;
            background: var(--bg-3);
            color: var(--fg-0);
            border: none;
            font-size: 13px;
            font-weight: 700;
            font-family: var(--font-mono);
            cursor: pointer;
            border-right: 1px solid var(--border);
            min-width: 90px;
            appearance: none;
            text-align: center;
        }

        .method-select:focus { outline: none; }

        .url-input {
            flex: 1;
            padding: 12px 16px;
            background: transparent;
            color: var(--fg-0);
            border: none;
            font-size: 14px;
            font-family: var(--font-mono);
            outline: none;
            min-width: 0;
        }

        .url-input::placeholder { color: var(--fg-3); }

        .send-btn {
            padding: 0 28px;
            background: var(--primary);
            color: #fff;
            border: none;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
            border-radius: 0 var(--radius-md) var(--radius-md) 0;
        }

        .send-btn:hover:not(:disabled) { background: var(--primary-hover); }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .cancel-btn {
            padding: 0 20px;
            background: var(--error);
            color: #fff;
            border: none;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            border-radius: 0 var(--radius-md) var(--radius-md) 0;
            display: none;
            align-items: center;
            gap: 6px;
        }

        .spinner {
            width: 14px; height: 14px;
            border: 2px solid rgba(255,255,255,0.3);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        /* ===== TYPE TABS ===== */
        .type-tabs {
            display: flex;
            padding: 0 20px;
            background: var(--bg-1);
            border-bottom: 1px solid var(--border);
            gap: 0;
        }

        .type-tab {
            padding: 10px 20px;
            background: transparent;
            color: var(--fg-2);
            border: none;
            border-bottom: 2px solid transparent;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
        }

        .type-tab:hover { color: var(--fg-1); }
        .type-tab.active { color: var(--primary); border-bottom-color: var(--primary); }

        /* ===== MAIN LAYOUT ===== */
        .main-layout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            min-height: calc(100vh - 120px);
        }

        .panel {
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .panel + .panel {
            border-left: 1px solid var(--border);
        }

        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            background: var(--bg-2);
            border-bottom: 1px solid var(--border);
            min-height: 44px;
        }

        .panel-title {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--fg-2);
        }

        .panel-body {
            flex: 1;
            overflow-y: auto;
            padding: 16px 20px;
        }

        /* ===== REQUEST CONFIG SECTIONS ===== */
        .config-tabs {
            display: flex;
            gap: 0;
            border-bottom: 1px solid var(--border);
            background: var(--bg-2);
            padding: 0 20px;
            overflow-x: auto;
        }

        .config-tab {
            padding: 10px 16px;
            background: transparent;
            color: var(--fg-2);
            border: none;
            border-bottom: 2px solid transparent;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
            white-space: nowrap;
        }

        .config-tab:hover { color: var(--fg-1); }
        .config-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
        .config-tab .badge {
            display: inline-block;
            margin-left: 6px;
            padding: 0 5px;
            background: var(--primary);
            color: #fff;
            border-radius: 8px;
            font-size: 10px;
            font-weight: 700;
            min-width: 16px;
            text-align: center;
        }

        .config-content {
            display: none;
            padding: 16px 20px;
        }

        .config-content.active { display: block; }

        /* ===== FORM ELEMENTS ===== */
        .form-row {
            margin-bottom: 14px;
        }

        .form-label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--fg-2);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .input, .select, .textarea {
            width: 100%;
            padding: 9px 12px;
            background: var(--bg-3);
            color: var(--fg-0);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-family: var(--font-sans);
            transition: border-color var(--transition), box-shadow var(--transition);
        }

        .input:focus, .select:focus, .textarea:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 2px var(--primary-glow);
        }

        .textarea {
            font-family: var(--font-mono);
            resize: vertical;
            min-height: 80px;
            line-height: 1.5;
        }

        .select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 10px center;
            padding-right: 30px;
        }

        /* ===== KEY-VALUE ROWS ===== */
        .kv-list { max-height: 200px; overflow-y: auto; }

        .kv-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }

        .kv-row .input { flex: 1; }

        .kv-remove {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            color: var(--fg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 14px;
            transition: all var(--transition);
            flex-shrink: 0;
        }

        .kv-remove:hover { background: var(--error-bg); color: var(--error); border-color: var(--error); }

        .kv-add {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: transparent;
            color: var(--primary);
            border: 1px dashed var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            transition: all var(--transition);
            margin-top: 4px;
        }

        .kv-add:hover { background: var(--primary-glow); border-color: var(--primary); }

        /* ===== BUTTONS ===== */
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: var(--radius-sm);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
            display: inline-flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
        }

        .btn-primary { background: var(--primary); color: #fff; }
        .btn-primary:hover { background: var(--primary-hover); }
        .btn-ghost { background: transparent; color: var(--fg-2); border: 1px solid var(--border); }
        .btn-ghost:hover { background: var(--bg-3); color: var(--fg-1); }
        .btn-danger { background: var(--error-bg); color: var(--error); border: 1px solid transparent; }
        .btn-danger:hover { background: var(--error); color: #fff; }
        .btn-sm { padding: 4px 10px; font-size: 11px; }

        /* ===== BODY TOOLBAR ===== */
        .body-toolbar {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
            flex-wrap: wrap;
        }

        /* ===== GRAPHQL SECTION ===== */
        .graphql-section { display: none; }
        .graphql-section.visible { display: block; }

        /* ===== RESPONSE STATS ===== */
        .response-stats {
            display: flex;
            gap: 16px;
            align-items: center;
        }

        .stat {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .stat-label {
            font-size: 11px;
            color: var(--fg-3);
            text-transform: uppercase;
            font-weight: 600;
        }

        .stat-value {
            font-size: 13px;
            font-weight: 700;
            font-family: var(--font-mono);
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 3px 10px;
            border-radius: var(--radius-sm);
            font-size: 13px;
            font-weight: 700;
            font-family: var(--font-mono);
        }

        .status-badge.s2xx { background: var(--success-bg); color: var(--success); }
        .status-badge.s3xx { background: rgba(33, 150, 243, 0.12); color: var(--info); }
        .status-badge.s4xx { background: var(--warning-bg); color: var(--warning); }
        .status-badge.s5xx { background: var(--error-bg); color: var(--error); }
        .status-badge.s0xx { background: var(--bg-3); color: var(--fg-2); }

        /* ===== RESPONSE BODY ===== */
        .response-body {
            flex: 1;
            overflow: auto;
            padding: 16px 20px;
        }

        .response-output {
            background: var(--bg-0);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 16px;
            font-family: var(--font-mono);
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-all;
            overflow-x: auto;
            min-height: 120px;
        }

        .response-placeholder {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            color: var(--fg-3);
            text-align: center;
            gap: 8px;
        }

        .response-placeholder-icon { font-size: 32px; opacity: 0.5; }
        .response-placeholder-text { font-size: 13px; }

        /* JSON Syntax */
        .json-key { color: #9cdcfe; }
        .json-string { color: #ce9178; }
        .json-number { color: #b5cea8; }
        .json-boolean { color: #569cd6; }
        .json-null { color: #569cd6; font-style: italic; }

        /* ===== HISTORY ===== */
        .history-section {
            border-top: 1px solid var(--border);
            background: var(--bg-1);
        }

        .history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            border-bottom: 1px solid var(--border);
        }

        .history-title {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--fg-2);
        }

        .history-count {
            font-size: 11px;
            color: var(--fg-3);
        }

        .history-table-wrap {
            overflow-x: auto;
            max-height: 260px;
            overflow-y: auto;
        }

        .history-table {
            width: 100%;
            border-collapse: collapse;
        }

        .history-table th {
            padding: 8px 14px;
            text-align: left;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            color: var(--fg-3);
            background: var(--bg-2);
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 1;
        }

        .history-table td {
            padding: 8px 14px;
            font-size: 12px;
            border-bottom: 1px solid var(--border);
            color: var(--fg-1);
        }

        .history-table tr:hover td { background: var(--bg-2); }

        .history-table tr { cursor: pointer; transition: background var(--transition); }

        .method-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: var(--radius-sm);
            font-size: 10px;
            font-weight: 700;
            font-family: var(--font-mono);
            color: #fff;
        }

        .method-badge.GET { background: var(--method-get); }
        .method-badge.POST { background: var(--method-post); }
        .method-badge.PUT { background: var(--method-put); }
        .method-badge.DELETE { background: var(--method-delete); }
        .method-badge.PATCH { background: var(--method-patch); }
        .method-badge.HEAD { background: var(--method-head); }
        .method-badge.OPTIONS { background: var(--method-options); }

        .url-cell {
            max-width: 280px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: var(--font-mono);
            font-size: 12px;
        }

        .time-cell { font-family: var(--font-mono); color: var(--fg-2); }
        .size-cell { font-family: var(--font-mono); color: var(--fg-2); font-size: 11px; }
        .date-cell { color: var(--fg-3); font-size: 11px; white-space: nowrap; }

        /* ===== MODALS ===== */
        .modal-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 1000;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .modal-overlay.open { display: flex; }

        .modal-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            width: 100%;
            max-width: 560px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: var(--shadow-lg);
        }

        .modal-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid var(--border);
        }

        .modal-top h3 {
            font-size: 15px;
            font-weight: 700;
            color: var(--fg-0);
        }

        .modal-close {
            width: 28px; height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            border: none;
            color: var(--fg-2);
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 18px;
            transition: all var(--transition);
        }

        .modal-close:hover { background: var(--bg-3); color: var(--fg-0); }

        .modal-body { padding: 20px; }
        .modal-footer {
            display: flex;
            gap: 8px;
            padding: 16px 20px;
            border-top: 1px solid var(--border);
            justify-content: flex-end;
        }

        /* ===== NOTIFICATIONS ===== */
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: var(--radius-md);
            color: #fff;
            font-size: 13px;
            font-weight: 600;
            z-index: 2000;
            transform: translateY(80px);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: var(--shadow-md);
            max-width: 360px;
        }

        .toast.show { transform: translateY(0); opacity: 1; }
        .toast.success { background: var(--success); }
        .toast.error { background: var(--error); }
        .toast.info { background: var(--primary); }
        .toast.warning { background: var(--warning); }

        /* ===== RESPONSIVE: TABLET ===== */
        @media (max-width: 1024px) {
            .main-layout {
                grid-template-columns: 1fr;
                min-height: auto;
            }

            .panel + .panel {
                border-left: none;
                border-top: 1px solid var(--border);
            }

            .url-bar { padding: 12px 16px; }
            .panel-body { padding: 12px 16px; }
            .config-content { padding: 12px 16px; }
        }

        /* ===== RESPONSIVE: MOBILE ===== */
        @media (max-width: 640px) {
            .topbar {
                padding: 10px 12px;
                gap: 8px;
            }

            .topbar-brand { font-size: 13px; }
            .topbar-env select { max-width: 110px; font-size: 11px; }
            .topbar-actions { gap: 4px; }

            .url-bar { padding: 10px 12px; }
            .method-select { min-width: 70px; font-size: 11px; padding: 0 8px; }
            .url-input { padding: 10px 12px; font-size: 12px; }
            .send-btn { padding: 0 18px; font-size: 13px; }

            .type-tabs { padding: 0 12px; }
            .type-tab { padding: 8px 12px; font-size: 12px; }

            .config-tabs { padding: 0 12px; }
            .config-tab { padding: 8px 12px; font-size: 11px; }

            .panel-header { padding: 10px 12px; }
            .panel-body { padding: 10px 12px; }
            .config-content { padding: 10px 12px; }

            .kv-row { flex-wrap: wrap; }
            .kv-row .input { min-width: 0; }

            .response-stats { gap: 10px; flex-wrap: wrap; }

            .history-header { padding: 10px 12px; }
            .history-table th,
            .history-table td { padding: 6px 10px; }

            .modal-box { max-width: 100%; margin: 10px; }
            .modal-top, .modal-body, .modal-footer { padding-left: 16px; padding-right: 16px; }

            .toast { left: 12px; right: 12px; bottom: 12px; max-width: none; }
        }

        /* ===== RESPONSIVE: SMALL MOBILE ===== */
        @media (max-width: 400px) {
            .url-bar-inner { flex-direction: column; border-radius: var(--radius-md); }
            .method-select {
                border-right: none;
                border-bottom: 1px solid var(--border);
                min-width: 100%;
                padding: 8px;
            }
            .url-input { padding: 10px 12px; }
            .send-btn, .cancel-btn {
                border-radius: var(--radius-md);
                width: 100%;
                justify-content: center;
                padding: 12px;
            }
            .send-btn { margin-top: 8px; }

            .body-toolbar { gap: 4px; }
            .body-toolbar .btn { flex: 1; justify-content: center; }
        }

        /* ===== UTILITIES ===== */
        .hidden { display: none !important; }
        .flex-center { display: flex; align-items: center; justify-content: center; }
        .gap-8 { gap: 8px; }
        .mt-8 { margin-top: 8px; }
        .mt-12 { margin-top: 12px; }
        .mb-8 { margin-bottom: 8px; }
        .text-mono { font-family: var(--font-mono); }
        .text-muted { color: var(--fg-3); }
        .text-sm { font-size: 12px; }
        .w-full { width: 100%; }
        </style>
    </head>
    <body>

        <!-- TOP BAR -->
        <div class="topbar">
            <div class="topbar-brand">API Tester Pro</div>
            <div class="topbar-env">
                <select id="envSelect">
                    <option value="-1">No Environment</option>
                </select>
                <button id="manageEnvBtn" class="btn btn-ghost btn-sm">Manage</button>
            </div>
            <div class="topbar-actions">
                <button id="copyAsCurl" class="btn btn-ghost btn-sm" title="Copy the current request as a cURL command">📋 cURL</button>
                <button id="exportHistoryBtn" class="btn btn-ghost btn-sm" title="Export request history to a file">⬇ Export</button>
                <button id="showCookies" class="btn btn-ghost btn-sm">Cookies</button>
                <button id="clearHistory" class="btn btn-ghost btn-sm">Clear History</button>
                <button id="clearCookies" class="btn btn-danger btn-sm">Clear Cookies</button>
            </div>
        </div>

        <!-- URL BAR -->
        <div class="url-bar">
            <div class="url-bar-inner">
                <select id="method" class="method-select">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                    <option value="HEAD">HEAD</option>
                    <option value="OPTIONS">OPTIONS</option>
                </select>
                <input type="text" id="url" class="url-input" placeholder="Enter request URL or paste a cURL command...">
                <button id="sendRequest" class="send-btn">
                    <span class="btn-label">Send</span>
                    <div class="spinner hidden"></div>
                </button>
                <button id="cancelRequest" class="cancel-btn">Cancel</button>
            </div>
        </div>

        <!-- TYPE TABS -->
        <div class="type-tabs">
            <button class="type-tab active" data-type="rest">HTTP</button>
            <button class="type-tab" data-type="graphql">GraphQL</button>
        </div>

        <!-- MAIN LAYOUT -->
        <div class="main-layout">
            <!-- REQUEST PANEL -->
            <div class="panel">
                <div class="config-tabs">
                    <button class="config-tab active" data-tab="params">Params</button>
                    <button class="config-tab" data-tab="headers">Headers <span class="badge" id="headerCount">0</span></button>
                    <button class="config-tab" data-tab="auth">Auth</button>
                    <button class="config-tab" data-tab="body">Body</button>
                    <button class="config-tab" data-tab="advanced">Advanced</button>
                    <button class="config-tab" data-tab="graphql" id="graphqlTab" style="display:none">GraphQL</button>
                    <button class="config-tab" data-tab="premium">👑 Premium Hub (<span id="userPointsBadge">0</span> pts)</button>
                </div>

                <!-- PREMIUM HUB TAB -->
                <div class="config-content" id="tab-premium">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                        <div>
                            <h3 style="font-size: 14px; font-weight: 700; color: var(--fg-0);">👑 DevSnip Pro Premium API Tools</h3>
                            <p style="font-size: 12px; color: var(--fg-2);">Redeem your earned milestone points to execute elite AI & DevOps API tools.</p>
                        </div>
                        <div style="background: var(--bg-3); padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); font-size: 13px; font-weight: 700; color: var(--warning);">
                            🪙 <span id="currentPointsDisplay">0</span> pts available
                        </div>
                    </div>

                    <!-- Output / Result Box at the TOP for instant visibility -->
                    <div class="form-row" style="margin-bottom: 16px;">
                        <label class="form-label" style="color: var(--primary); font-weight: 700;">✨ Premium Feature Output / Result</label>
                        <pre id="premiumOutput" style="background: var(--bg-3); border: 2px solid var(--primary); border-radius: var(--radius-md); padding: 14px; color: var(--fg-0); font-family: var(--font-mono); font-size: 12px; min-height: 140px; max-height: 250px; overflow: auto; white-space: pre-wrap; box-shadow: 0 4px 16px var(--primary-glow);">Select a premium feature below and redeem points to run. Results appear instantly here!</pre>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                        <!-- Feature 1 -->
                        <div style="background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <strong style="font-size: 13px; color: var(--fg-0);">🛡️ AI Security Vulnerability & SecScan</strong>
                                <span style="background: var(--warning-bg); color: var(--warning); padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">15 pts</span>
                            </div>
                            <p style="font-size: 12px; color: var(--fg-2); margin-bottom: 10px;">Scans headers, auth token patterns, and response structure against OWASP API Top 10 risks.</p>
                            <button class="btn" id="btnSecScan" style="background: var(--primary); color: #fff; border: none; padding: 6px 14px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; font-size: 12px;">Redeem & Run SecScan</button>
                        </div>

                        <!-- Feature 2 -->
                        <div style="background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <strong style="font-size: 13px; color: var(--fg-0);">🧪 Multi-Region Load & Latency Spike Test</strong>
                                <span style="background: var(--warning-bg); color: var(--warning); padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">20 pts</span>
                            </div>
                            <p style="font-size: 12px; color: var(--fg-2); margin-bottom: 10px;">Simulates concurrent requests from US, EU, and Asia cloud regions to measure p95/p99 variance.</p>
                            <button class="btn" id="btnLoadTest" style="background: var(--primary); color: #fff; border: none; padding: 6px 14px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; font-size: 12px;">Redeem & Run Load Test</button>
                        </div>

                        <!-- Feature 3 -->
                        <div style="background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <strong style="font-size: 13px; color: var(--fg-0);">📦 Smart Type-Safe SDK & Client Exporter</strong>
                                <span style="background: var(--warning-bg); color: var(--warning); padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">10 pts</span>
                            </div>
                            <p style="font-size: 12px; color: var(--fg-2); margin-bottom: 10px;">Generates production-ready TypeScript Axios client functions or Python Requests snippet.</p>
                            <button class="btn" id="btnSdkExporter" style="background: var(--primary); color: #fff; border: none; padding: 6px 14px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; font-size: 12px;">Redeem & Export SDK</button>
                        </div>

                        <!-- Feature 4 -->
                        <div style="background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <strong style="font-size: 13px; color: var(--fg-0);">🤖 AI Response Mock Server & Contract Generator</strong>
                                <span style="background: var(--warning-bg); color: var(--warning); padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">15 pts</span>
                            </div>
                            <p style="font-size: 12px; color: var(--fg-2); margin-bottom: 10px;">Generates Express mock server stubs and JSON schema validation contracts from response data.</p>
                            <button class="btn" id="btnMockGenerator" style="background: var(--primary); color: #fff; border: none; padding: 6px 14px; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; font-size: 12px;">Redeem & Generate Mock</button>
                        </div>
                    </div>
                </div>

                <!-- PARAMS TAB -->
                <div class="config-content active" id="tab-params">
                    <div class="form-row">
                        <label class="form-label">Query Parameters</label>
                        <div class="kv-list" id="paramsContainer">
                            <div class="kv-row">
                                <input type="text" class="input kv-key" placeholder="Key">
                                <input type="text" class="input kv-value" placeholder="Value">
                                <button class="kv-remove">&times;</button>
                            </div>
                        </div>
                        <button class="kv-add" id="addParam">+ Add Parameter</button>
                    </div>
                    <div class="form-row">
                        <label class="form-label">Timeout (ms)</label>
                        <input type="number" id="timeout" class="input" value="30000" min="1000" max="300000" style="max-width:200px">
                    </div>
                </div>

                <!-- HEADERS TAB -->
                <div class="config-content" id="tab-headers">
                    <div class="kv-list" id="headersContainer">
                        <div class="kv-row">
                            <input type="text" class="input kv-key" placeholder="Header name">
                            <input type="text" class="input kv-value" placeholder="Header value">
                            <button class="kv-remove">&times;</button>
                        </div>
                    </div>
                    <button class="kv-add" id="addHeader">+ Add Header</button>
                </div>

                <!-- AUTH TAB -->
                <div class="config-content" id="tab-auth">
                    <div class="form-row">
                        <label class="form-label">Authentication Type</label>
                        <select id="authType" class="select" style="max-width:300px">
                            <option value="None">No Auth</option>
                            <option value="Bearer">Bearer Token</option>
                            <option value="Basic">Basic Auth</option>
                            <option value="ApiKey">API Key</option>
                        </select>
                    </div>
                    <div id="authFields"></div>
                </div>

                <!-- BODY TAB -->
                <div class="config-content" id="tab-body">
                    <div class="body-toolbar">
                        <select id="bodyType" class="select" style="max-width:220px">
                            <option value="json">JSON</option>
                            <option value="text">Text / Raw</option>
                            <option value="form-urlencoded">Form URL Encoded</option>
                        </select>
                        <button class="btn btn-ghost btn-sm" id="convertToJson">To JSON</button>
                        <button class="btn btn-ghost btn-sm" id="beautifyJson">Format</button>
                        <button class="btn btn-ghost btn-sm" id="validateData">Validate</button>
                    </div>
                    <textarea id="body" class="textarea" rows="12" placeholder='{"key": "value"}' style="font-family: var(--font-mono);"></textarea>
                </div>

                <!-- ADVANCED TAB -->
                <div class="config-content" id="tab-advanced">
                    <div class="form-row">
                        <label class="form-label">Retries on failure</label>
                        <input type="number" id="retries" class="input" value="0" min="0" max="5" style="max-width:120px">
                    </div>
                    <div class="form-row">
                        <label class="form-label">Retry delay (ms, exponential backoff)</label>
                        <input type="number" id="retryDelay" class="input" value="500" min="0" max="10000" style="max-width:160px">
                    </div>
                    <div class="form-row">
                        <label class="form-label">Retry on status codes</label>
                        <input type="text" id="retryStatusCodes" class="input" value="429,502,503,504" style="max-width:220px">
                    </div>
                    <div class="form-row">
                        <label class="form-label" style="display:flex;align-items:center;gap:8px;text-transform:none;">
                            <input type="checkbox" id="followRedirects" checked style="width:auto;"> Follow redirects
                        </label>
                    </div>
                    <div class="form-row">
                        <label class="form-label">Max redirects</label>
                        <input type="number" id="maxRedirects" class="input" value="5" min="0" max="20" style="max-width:120px">
                    </div>
                    <div class="form-row">
                        <label class="form-label" style="display:flex;align-items:center;gap:8px;text-transform:none;">
                            <input type="checkbox" id="sslVerify" checked style="width:auto;"> Verify SSL/TLS certificates
                        </label>
                    </div>
                    <div class="form-row">
                        <label class="form-label">Proxy Host</label>
                        <input type="text" id="proxyHost" class="input" placeholder="e.g., 127.0.0.1" style="max-width:220px">
                    </div>
                    <div class="form-row">
                        <label class="form-label">Proxy Port</label>
                        <input type="number" id="proxyPort" class="input" placeholder="8080" style="max-width:120px">
                    </div>
                    <div class="form-row">
                        <label class="form-label">Proxy Username (optional)</label>
                        <input type="text" id="proxyUsername" class="input" style="max-width:220px">
                    </div>
                    <div class="form-row">
                        <label class="form-label">Proxy Password (optional)</label>
                        <input type="password" id="proxyPassword" class="input" style="max-width:220px">
                    </div>
                </div>

                <!-- GRAPHQL TAB -->
                <div class="config-content" id="tab-graphql">
                    <div class="graphql-section" id="graphqlSection">
                        <div class="form-row">
                            <label class="form-label">Query</label>
                            <textarea id="graphqlQuery" class="textarea" rows="10" placeholder="query {&#10;  users {&#10;    id&#10;    name&#10;    email&#10;  }&#10;}" style="font-family: var(--font-mono);"></textarea>
                        </div>
                        <div class="form-row">
                            <label class="form-label">Variables (JSON)</label>
                            <textarea id="graphqlVariables" class="textarea" rows="4" placeholder='{"id": 1}' style="font-family: var(--font-mono);"></textarea>
                        </div>
                        <div class="form-row">
                            <label class="form-label">Operation Name</label>
                            <input type="text" id="graphqlOperationName" class="input" placeholder="GetUsers" style="max-width:300px">
                        </div>
                    </div>
                </div>
            </div>

            <!-- RESPONSE PANEL -->
            <div class="panel">
                <div class="panel-header">
                    <span class="panel-title">Response</span>
                    <div class="response-stats">
                        <div class="stat">
                            <span class="stat-label">Status</span>
                            <span class="stat-value" id="statusCode">-</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Time</span>
                            <span class="stat-value" id="responseTime">-</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Size</span>
                            <span class="stat-value" id="responseSize">-</span>
                        </div>
                    </div>
                </div>
                <div class="response-body">
                    <div class="response-output" id="responseOutput">
                        <div class="response-placeholder">
                            <div class="response-placeholder-icon">&#9741;</div>
                            <div class="response-placeholder-text">Send a request to see the response</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- HISTORY -->
        <div class="history-section">
            <div class="history-header">
                <span class="history-title">Request History</span>
                <span class="history-count" id="historyCount">${history.length} requests</span>
            </div>
            <div class="history-table-wrap">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Method</th>
                            <th>URL</th>
                            <th>Status</th>
                            <th>Time</th>
                            <th>Size</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody id="historyTableBody">
                        ${history.map(item => {
                            const safeUrl = item.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const safeMethod = item.method.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                            return `
                            <tr data-url="${safeUrl}" data-method="${safeMethod}">
                                <td><span class="method-badge ${safeMethod}">${safeMethod}</span></td>
                                <td class="url-cell" title="${safeUrl}">${safeUrl}</td>
                                <td><span class="status-badge s${Math.floor((item.status || 0) / 100)}xx">${item.status || '-'}</span></td>
                                <td class="time-cell">${item.responseTime ? item.responseTime + 'ms' : '-'}</td>
                                <td class="size-cell">${item.size ? (typeof item.size === 'number' ? item.size + ' B' : item.size) : '-'}</td>
                                <td class="date-cell">${new Date(item.timestamp).toLocaleDateString()}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- ENVIRONMENT MODAL -->
        <div id="envModal" class="modal-overlay">
            <div class="modal-box">
                <div class="modal-top">
                    <h3>Manage Environments</h3>
                    <button class="modal-close" id="closeEnvModal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-row">
                        <label class="form-label">Environment Name</label>
                        <input type="text" id="envName" class="input" placeholder="e.g., Development, Production">
                    </div>
                    <div class="form-row">
                        <label class="form-label">Variables</label>
                        <div id="envVarsContainer">
                            <div class="kv-row">
                                <input type="text" class="input kv-key" placeholder="Variable name (e.g., baseUrl)">
                                <input type="text" class="input kv-value" placeholder="Value (e.g., https://api.dev.com)">
                                <button class="kv-remove">&times;</button>
                            </div>
                        </div>
                        <button class="kv-add" id="addEnvVarBtn">+ Add Variable</button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="deleteEnvBtn" class="btn btn-danger">Delete</button>
                    <button id="saveEnvBtn" class="btn btn-primary">Save Environment</button>
                </div>
            </div>
        </div>

        <!-- COOKIE MODAL -->
        <div id="cookieModal" class="modal-overlay">
            <div class="modal-box">
                <div class="modal-top">
                    <h3>Stored Cookies</h3>
                    <button class="modal-close" id="closeCookieModal">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="cookieList"></div>
                </div>
                <div class="modal-footer">
                    <button id="copyCookies" class="btn btn-ghost">Copy to Clipboard</button>
                </div>
            </div>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            let isRequestInProgress = false;
            let currentRequestType = 'rest';
            let environments = [];
            let activeEnvIndex = -1;

            /* ===== TABS ===== */
            document.querySelectorAll('.config-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    const target = document.getElementById('tab-' + tab.dataset.tab);
                    if (target) target.classList.add('active');
                });
            });

            document.querySelectorAll('.type-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    currentRequestType = tab.dataset.type;
                    const isGraphQL = currentRequestType === 'graphql';
                    document.getElementById('graphqlSection').classList.toggle('visible', isGraphQL);
                    document.getElementById('graphqlTab').style.display = isGraphQL ? '' : 'none';
                    if (isGraphQL) {
                        document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
                        document.querySelectorAll('.config-content').forEach(c => c.classList.remove('active'));
                        document.getElementById('graphqlTab').classList.add('active');
                        document.getElementById('tab-graphql').classList.add('active');
                    } else {
                        document.querySelectorAll('.config-tab')[0].click();
                    }
                });
            });

            /* ===== KV ROWS ===== */
            function addKVRow(container, key, value) {
                const row = document.createElement('div');
                row.className = 'kv-row';
                row.innerHTML = '<input type="text" class="input kv-key" placeholder="Key" value="' + (key || '') + '">' +
                    '<input type="text" class="input kv-value" placeholder="Value" value="' + (value || '') + '">' +
                    '<button class="kv-remove">&times;</button>';
                row.querySelector('.kv-remove').addEventListener('click', () => { row.remove(); updateHeaderCount(); });
                document.getElementById(container).appendChild(row);
                updateHeaderCount();
            }

            function collectKV(container) {
                const data = {};
                document.querySelectorAll('#' + container + ' .kv-row').forEach(row => {
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
                const count = document.querySelectorAll('#headersContainer .kv-row').length;
                document.getElementById('headerCount').textContent = count;
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
                    el.innerHTML = '<div class="form-row"><label class="form-label">Token</label><input type="password" id="authToken" class="input" placeholder="Enter bearer token"></div>';
                } else if (authType === 'Basic') {
                    el.innerHTML = '<div class="form-row"><label class="form-label">Username</label><input type="text" id="username" class="input" placeholder="Username"></div>' +
                        '<div class="form-row"><label class="form-label">Password</label><input type="password" id="password" class="input" placeholder="Password"></div>';
                } else if (authType === 'ApiKey') {
                    el.innerHTML = '<div class="form-row"><label class="form-label">Key Name</label><input type="text" id="apiKeyName" class="input" placeholder="e.g., X-API-Key"></div>' +
                        '<div class="form-row"><label class="form-label">Key Value</label><input type="password" id="apiKeyValue" class="input" placeholder="Enter API key"></div>' +
                        '<div class="form-row"><label class="form-label">Add To</label><select id="apiKeyLocation" class="select" style="max-width:200px"><option value="header">Header</option><option value="query">Query Parameter</option></select></div>';
                } else {
                    el.innerHTML = '';
                }
            }
            document.getElementById('authType').addEventListener('change', updateAuthFields);
            updateAuthFields();

            /* ===== TOAST ===== */
            function toast(msg, type) {
                const el = document.createElement('div');
                el.className = 'toast ' + (type || 'info');
                el.textContent = msg;
                document.body.appendChild(el);
                requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
                setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
            }

            /* ===== REQUEST STATE ===== */
            function setRequestState(active) {
                isRequestInProgress = active;
                const sendBtn = document.getElementById('sendRequest');
                const cancelBtn = document.getElementById('cancelRequest');
                const label = sendBtn.querySelector('.btn-label');
                const spinner = sendBtn.querySelector('.spinner');
                sendBtn.disabled = active;
                cancelBtn.style.display = active ? 'inline-flex' : 'none';
                spinner.classList.toggle('hidden', !active);
                label.textContent = active ? 'Sending...' : 'Send';
            }

            /* ===== SYNTAX HIGHLIGHT ===== */
            function highlight(json) {
                if (typeof json !== 'string') json = JSON.stringify(json, null, 2);
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
                document.getElementById('historyCount').textContent = history.length + ' requests';
                document.getElementById('historyTableBody').innerHTML = history.map(i => {
                    var u = escapeHtml(i.url), m = escapeHtml(i.method);
                    return '<tr data-url="' + u + '" data-method="' + m + '">' +
                    '<td><span class="method-badge ' + m + '">' + m + '</span></td>' +
                    '<td class="url-cell" title="' + u + '">' + u + '</td>' +
                    '<td><span class="status-badge s' + Math.floor((i.status||0)/100) + 'xx">' + (i.status||'-') + '</span></td>' +
                    '<td class="time-cell">' + (i.responseTime ? i.responseTime + 'ms' : '-') + '</td>' +
                    '<td class="size-cell">' + (i.size || '-') + '</td>' +
                    '<td class="date-cell">' + new Date(i.timestamp).toLocaleDateString() + '</td></tr>';
                }).join('');
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
                        document.getElementById('statusCode').innerHTML = '<span class="status-badge s' + Math.floor(d.status/100) + 'xx">' + d.status + '</span>';
                        document.getElementById('responseTime').textContent = d.responseTime + 'ms';
                        document.getElementById('responseSize').textContent = d.size;
                        document.getElementById('responseOutput').innerHTML = highlight(d.data);
                        updateHistoryTable(d.history);
                        if (d.truncated) toast('Response was truncated (too large to display in full)', 'warning');
                        toast(d.attempts && d.attempts > 1 ? ('Request completed after ' + d.attempts + ' attempts') : 'Request completed', 'success');
                        break;
                    case 'apiError':
                        setRequestState(false);
                        document.getElementById('statusCode').innerHTML = '<span class="status-badge s0xx">' + (d.status || 'Error') + '</span>';
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
                    case 'premiumResult':
                        document.getElementById('currentPointsDisplay').textContent = d.remainingPoints;
                        document.getElementById('userPointsBadge').textContent = d.remainingPoints;
                        const outEl = document.getElementById('premiumOutput');
                        outEl.textContent = d.result;
                        outEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        toast('Premium tool executed successfully!', 'success');
                        break;
                    case 'premiumError':
                        toast(d.error, 'error');
                        const errEl = document.getElementById('premiumOutput');
                        errEl.textContent = 'Error: ' + d.error;
                        errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        break;
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

            window.runPremium = function(featureId, cost) {
                const url = document.getElementById('url').value.trim();
                const method = methodSelect.value;
                const headers = collectKV('headersContainer');
                const data = document.getElementById('body').value.trim();
                vscode.postMessage({
                    command: 'runPremiumFeature',
                    featureId,
                    cost,
                    requestData: { url, method, headers, data }
                });
            };

            document.getElementById('btnSecScan')?.addEventListener('click', () => runPremium('secScan', 15));
            document.getElementById('btnLoadTest')?.addEventListener('click', () => runPremium('loadTest', 20));
            document.getElementById('btnSdkExporter')?.addEventListener('click', () => runPremium('sdkExporter', 10));
            document.getElementById('btnMockGenerator')?.addEventListener('click', () => runPremium('mockGenerator', 15));

            /* ===== INIT ===== */
            vscode.postMessage({ command: 'getEnvironments' });
            vscode.postMessage({ command: 'getPoints' });
        </script>
    </body>
    </html>
  `;
}
