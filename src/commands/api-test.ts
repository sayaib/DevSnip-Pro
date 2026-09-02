import * as vscode from "vscode";
import axios, { AxiosRequestConfig, CancelTokenSource } from "axios";
import * as path from "path";

interface ApiHistoryItem {
  id: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  responseTime?: number;
  size?: number;
}

interface RequestHeaders {
  [key: string]: string;
}

interface ApiRequest {
  method: string;
  url: string;
  data?: any;
  headers?: RequestHeaders;
  authType?: string;
  authToken?: string;
  username?: string;
  password?: string;
  timeout?: number;
  requestType?: 'rest' | 'graphql';
  graphqlQuery?: string;
  graphqlVariables?: string;
  graphqlOperationName?: string;
}

interface Environment {
  name: string;
  variables: { [key: string]: string };
}

class ApiTester {
  private history: ApiHistoryItem[] = [];
  private cookies: { [domain: string]: string[] } = {};
  private cancelTokenSource: CancelTokenSource | null = null;
  private readonly MAX_HISTORY_SIZE = 50;
  private readonly DEFAULT_TIMEOUT = 30000;
  private environments: Environment[] = [];
  private activeEnvironmentIndex: number = -1;

  constructor(private context: vscode.ExtensionContext) {
    this.loadStoredData();
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
      new URL(url);
      return true;
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

  private addToHistory(item: Omit<ApiHistoryItem, 'id'>): void {
    const historyItem: ApiHistoryItem = {
      ...item,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
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

  public async makeRequest(request: ApiRequest): Promise<any> {
    // Resolve environment variables
    const resolvedUrl = this.resolveVariables(request.url);
    const resolvedHeaders: RequestHeaders = {};
    if (request.headers) {
      for (const [key, value] of Object.entries(request.headers)) {
        resolvedHeaders[this.resolveVariables(key)] = this.resolveVariables(value);
      }
    }
    const resolvedData = request.data ? this.resolveVariables(request.data) : undefined;
    const resolvedAuthToken = request.authToken ? this.resolveVariables(request.authToken) : undefined;
    const resolvedUsername = request.username ? this.resolveVariables(request.username) : undefined;
    const resolvedPassword = request.password ? this.resolveVariables(request.password) : undefined;

    // Validation
    if (!this.validateUrl(resolvedUrl)) {
      throw new Error("Invalid URL format");
    }

    // Handle GraphQL request type
    let finalUrl = resolvedUrl;
    let finalData = resolvedData;
    let finalHeaders = { ...resolvedHeaders };

    if (request.requestType === 'graphql') {
      // For GraphQL, wrap query in JSON body
      const graphqlBody: any = {
        query: request.graphqlQuery || resolvedData || ''
      };
      if (request.graphqlVariables) {
        try {
          graphqlBody.variables = JSON.parse(this.resolveVariables(request.graphqlVariables));
        } catch {
          graphqlBody.variables = this.resolveVariables(request.graphqlVariables);
        }
      }
      if (request.graphqlOperationName) {
        graphqlBody.operationName = this.resolveVariables(request.graphqlOperationName);
      }
      finalData = JSON.stringify(graphqlBody);
      finalHeaders['Content-Type'] = 'application/json';
    }

    if (finalData && !this.validateJson(finalData)) {
      throw new Error("Invalid JSON in request body");
    }

    // Cancel previous request if exists
    if (this.cancelTokenSource) {
      this.cancelTokenSource.cancel("New request initiated");
    }

    this.cancelTokenSource = axios.CancelToken.source();
    const startTime = Date.now();

    const config: AxiosRequestConfig = {
      method: request.method as any,
      url: finalUrl,
      timeout: request.timeout || this.DEFAULT_TIMEOUT,
      validateStatus: () => true,
      cancelToken: this.cancelTokenSource.token,
      headers: {
        'User-Agent': 'DevSnip-Pro API Tester',
        ...finalHeaders
      }
    };

    // Handle request body for appropriate methods
    if (["POST", "PUT", "PATCH"].includes(request.method) && finalData) {
      try {
        config.data = JSON.parse(finalData);
        if (!finalHeaders['Content-Type']) {
          config.headers!['Content-Type'] = 'application/json';
        }
      } catch {
        config.data = finalData;
        if (!finalHeaders['Content-Type']) {
          config.headers!['Content-Type'] = 'text/plain';
        }
      }
    }

    // Handle authentication
    if (request.authType) {
      switch (request.authType) {
        case "Bearer":
          if (resolvedAuthToken) {
            config.headers!['Authorization'] = `Bearer ${resolvedAuthToken}`;
          }
          break;
        case "Basic":
          if (resolvedUsername && resolvedPassword) {
            config.auth = {
              username: resolvedUsername,
              password: resolvedPassword,
            };
          }
          break;
      }
    }

    // Add cookies
    const domain = this.getDomainFromUrl(finalUrl);
    if (domain && this.cookies[domain]) {
      config.headers!['Cookie'] = this.cookies[domain].join("; ");
    }

    try {
      const response = await axios(config);
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      // Calculate response size
      const responseSize = JSON.stringify(response.data).length;

      // Store cookies from response
      if (response.headers["set-cookie"]) {
        const existingCookies = this.cookies[domain] || [];
        const newCookies = response.headers["set-cookie"];
        this.cookies[domain] = [...existingCookies, ...newCookies];
        this.saveData();
      }

      // Add to history
      this.addToHistory({
        url: request.url,
        method: request.method,
        timestamp: Date.now(),
        status: response.status,
        responseTime,
        size: responseSize
      });

      return {
        status: response.status,
        headers: response.headers,
        data: response.data,
        responseTime,
        size: this.formatBytes(responseSize),
        history: this.history.slice(0, 10) // Only send last 10 for UI
      };
    } catch (error: any) {
      if (axios.isCancel(error)) {
        throw new Error("Request was cancelled");
      }
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      const errorStatus = error.response?.status || 0;
      const errorData = error.response?.data || error.message;

      // Add failed request to history
      this.addToHistory({
        url: request.url,
        method: request.method,
        timestamp: Date.now(),
        status: errorStatus,
        responseTime
      });

      throw {
        message: error.message,
        status: errorStatus,
        response: errorData,
        responseTime
      };
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

export function apiTest(context: vscode.ExtensionContext) {
  const apiTester = new ApiTester(context);

  const disposable = vscode.commands.registerCommand(
    "sayaib.hue-console.openGUI",
    () => {
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

      const iconPath = path.resolve(context.extensionPath, "logo.png");
      panel.iconPath = vscode.Uri.file(iconPath);
      panel.webview.html = getWebviewContent(apiTester.getHistory());

      panel.webview.onDidReceiveMessage(
        async (message) => {
          try {
            switch (message.command) {
              case "testAPI":
                try {
                  panel.webview.postMessage({ command: "requestStarted" });
                  
                  const result = await apiTester.makeRequest({
                    method: message.method,
                    url: message.url,
                    data: message.data,
                    headers: message.headers,
                    authType: message.authType,
                    authToken: message.authToken,
                    username: message.username,
                    password: message.password,
                    timeout: message.timeout,
                    requestType: message.requestType,
                    graphqlQuery: message.graphqlQuery,
                    graphqlVariables: message.graphqlVariables,
                    graphqlOperationName: message.graphqlOperationName
                  });

                  panel.webview.postMessage({
                    command: "apiResponse",
                    ...result
                  });
                } catch (error: any) {
                  panel.webview.postMessage({
                    command: "apiError",
                    error: error.message,
                    status: error.status || 0,
                    response: error.response,
                    responseTime: error.responseTime
                  });
                }
                break;

              case "cancelRequest":
                apiTester.cancelCurrentRequest();
                panel.webview.postMessage({ command: "requestCancelled" });
                break;

              case "getCookies":
                panel.webview.postMessage({
                  command: "showCookies",
                  cookies: apiTester.getCookies(),
                });
                break;

              case "clearHistory":
                apiTester.clearHistory();
                panel.webview.postMessage({
                  command: "historyCleared",
                  history: []
                });
                break;

              case "clearCookies":
                apiTester.clearCookies();
                panel.webview.postMessage({
                  command: "cookiesCleared"
                });
                break;

              case "getEnvironments":
                panel.webview.postMessage({
                  command: "showEnvironments",
                  environments: apiTester.getEnvironments(),
                  activeIndex: apiTester.getActiveEnvironmentIndex()
                });
                break;

              case "saveEnvironment":
                await apiTester.saveEnvironment(message.environment);
                panel.webview.postMessage({
                  command: "environmentSaved",
                  environments: apiTester.getEnvironments(),
                  activeIndex: apiTester.getActiveEnvironmentIndex()
                });
                break;

              case "deleteEnvironment":
                await apiTester.deleteEnvironment(message.name);
                panel.webview.postMessage({
                  command: "environmentDeleted",
                  environments: apiTester.getEnvironments(),
                  activeIndex: apiTester.getActiveEnvironmentIndex()
                });
                break;

              case "setActiveEnvironment":
                await apiTester.setActiveEnvironment(message.index);
                panel.webview.postMessage({
                  command: "environmentActivated",
                  environments: apiTester.getEnvironments(),
                  activeIndex: apiTester.getActiveEnvironmentIndex()
                });
                break;
            }
          } catch (error: any) {
            panel.webview.postMessage({
              command: "error",
              message: error.message || "An unexpected error occurred"
            });
          }
        },
        undefined,
        context.subscriptions
      );

      // Clean up on panel disposal
      panel.onDidDispose(() => {
        apiTester.cancelCurrentRequest();
      });
    }
  );

  context.subscriptions.push(disposable);
}

function getWebviewContent(history: ApiHistoryItem[]): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                <input type="text" id="url" class="url-input" placeholder="Enter request URL or paste cURL...">
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
                    <button class="config-tab" data-tab="graphql" id="graphqlTab" style="display:none">GraphQL</button>
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
                        </select>
                    </div>
                    <div id="authFields"></div>
                </div>

                <!-- BODY TAB -->
                <div class="config-content" id="tab-body">
                    <div class="body-toolbar">
                        <button class="btn btn-ghost btn-sm" id="convertToJson">To JSON</button>
                        <button class="btn btn-ghost btn-sm" id="beautifyJson">Format</button>
                        <button class="btn btn-ghost btn-sm" id="validateData">Validate</button>
                    </div>
                    <textarea id="body" class="textarea" rows="12" placeholder='{"key": "value"}' style="font-family: var(--font-mono);"></textarea>
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
                        ${history.map(item => `
                            <tr data-url="${item.url}" data-method="${item.method}">
                                <td><span class="method-badge ${item.method}">${item.method}</span></td>
                                <td class="url-cell" title="${item.url}">${item.url}</td>
                                <td><span class="status-badge s${Math.floor((item.status || 0) / 100)}xx">${item.status || '-'}</span></td>
                                <td class="time-cell">${item.responseTime ? item.responseTime + 'ms' : '-'}</td>
                                <td class="size-cell">${item.size ? formatBytes(item.size) : '-'}</td>
                                <td class="date-cell">${new Date(item.timestamp).toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
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

        <script>
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
                row.querySelector('.kv-remove').addEventListener('click', () => row.remove());
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
                json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return json.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)/g, (match) => {
                    let cls = '';
                    if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
                    else if (/true|false/.test(match)) cls = 'json-boolean';
                    else if (/null/.test(match)) cls = 'json-null';
                    else cls = 'json-number';
                    return '<span class="' + cls + '">' + match + '</span>';
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

            /* ===== SEND ===== */
            document.getElementById('sendRequest').addEventListener('click', () => {
                if (isRequestInProgress) return;
                const url = document.getElementById('url').value.trim();
                if (!url) { toast('Enter a URL', 'error'); return; }
                if (!/^https?:\\/\\//i.test(url)) { toast('URL must start with http:// or https://', 'error'); return; }
                vscode.postMessage({
                    command: 'testAPI',
                    method: methodSelect.value,
                    url: url,
                    data: document.getElementById('body').value.trim(),
                    headers: collectKV('headersContainer'),
                    authType: document.getElementById('authType').value,
                    authToken: document.getElementById('authToken')?.value,
                    username: document.getElementById('username')?.value,
                    password: document.getElementById('password')?.value,
                    timeout: parseInt(document.getElementById('timeout').value) || 30000,
                    requestType: currentRequestType,
                    graphqlQuery: document.getElementById('graphqlQuery')?.value?.trim() || '',
                    graphqlVariables: document.getElementById('graphqlVariables')?.value?.trim() || '',
                    graphqlOperationName: document.getElementById('graphqlOperationName')?.value?.trim() || ''
                });
            });

            document.getElementById('cancelRequest').addEventListener('click', () => vscode.postMessage({ command: 'cancelRequest' }));

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
            document.getElementById('copyCookies').addEventListener('click', () => {
                navigator.clipboard.writeText(document.getElementById('cookieList').innerText).then(() => toast('Copied!', 'success'));
            });
            document.getElementById('clearHistory').addEventListener('click', () => { if (confirm('Clear request history?')) vscode.postMessage({ command: 'clearHistory' }); });
            document.getElementById('clearCookies').addEventListener('click', () => { if (confirm('Clear all cookies?')) vscode.postMessage({ command: 'clearCookies' }); });

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
                if (idx >= 0 && environments[idx] && confirm('Delete "' + environments[idx].name + '"?'))
                    vscode.postMessage({ command: 'deleteEnvironment', name: environments[idx].name });
            });

            /* ===== HISTORY TABLE UPDATE ===== */
            function updateHistoryTable(history) {
                document.getElementById('historyCount').textContent = history.length + ' requests';
                document.getElementById('historyTableBody').innerHTML = history.map(i => '<tr data-url="' + i.url + '" data-method="' + i.method + '">' +
                    '<td><span class="method-badge ' + i.method + '">' + i.method + '</span></td>' +
                    '<td class="url-cell" title="' + i.url + '">' + i.url + '</td>' +
                    '<td><span class="status-badge s' + Math.floor((i.status||0)/100) + 'xx">' + (i.status||'-') + '</span></td>' +
                    '<td class="time-cell">' + (i.responseTime ? i.responseTime + 'ms' : '-') + '</td>' +
                    '<td class="size-cell">' + (i.size || '-') + '</td>' +
                    '<td class="date-cell">' + new Date(i.timestamp).toLocaleDateString() + '</td></tr>').join('');
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
                        toast('Request completed', 'success');
                        break;
                    case 'apiError':
                        setRequestState(false);
                        document.getElementById('statusCode').innerHTML = '<span class="status-badge s0xx">' + (d.status || 'Error') + '</span>';
                        document.getElementById('responseTime').textContent = d.responseTime ? d.responseTime + 'ms' : '-';
                        document.getElementById('responseSize').textContent = '-';
                        let err = 'Error: ' + d.error;
                        if (d.response) err += '\\n\\n' + highlight(d.response);
                        document.getElementById('responseOutput').innerHTML = err;
                        toast('Request failed: ' + d.error, 'error');
                        break;
                    case 'requestCancelled':
                        setRequestState(false);
                        document.getElementById('responseOutput').innerHTML = '<div class="response-placeholder"><div class="response-placeholder-icon">&#9888;</div><div class="response-placeholder-text">Request was cancelled</div></div>';
                        break;
                    case 'showCookies':
                        const cl = document.getElementById('cookieList'); cl.innerHTML = '';
                        if (!Object.keys(d.cookies).length) { cl.innerHTML = '<div class="response-placeholder"><div class="response-placeholder-text">No cookies stored</div></div>'; }
                        else { for (const [domain, cookies] of Object.entries(d.cookies)) { const div = document.createElement('div'); div.className = 'form-row'; div.innerHTML = '<div class="form-label">' + domain + '</div>' + cookies.map(c => '<div class="input text-mono text-sm" style="margin-bottom:4px;cursor:pointer" onclick="navigator.clipboard.writeText(this.textContent)">' + c + '</div>').join(''); cl.appendChild(div); } }
                        document.getElementById('cookieModal').classList.add('open');
                        break;
                    case 'historyCleared': updateHistoryTable([]); toast('History cleared', 'success'); break;
                    case 'cookiesCleared': toast('Cookies cleared', 'success'); break;
                    case 'showEnvironments': case 'environmentSaved': case 'environmentDeleted': case 'environmentActivated':
                        environments = d.environments || []; activeEnvIndex = d.activeIndex ?? -1; updateEnvSelect();
                        if (d.command === 'environmentSaved') toast('Environment saved', 'success');
                        if (d.command === 'environmentDeleted') toast('Environment deleted', 'success');
                        break;
                    case 'error': toast('Error: ' + d.message, 'error'); break;
                }
            });

            /* ===== INIT ===== */
            vscode.postMessage({ command: 'getEnvironments' });
        </script>
    </body>
    </html>
  `;

  function getStatusClass(status?: number): string {
    if (!status) return "";
    if (status >= 200 && status < 300) return "status-success";
    if (status >= 400 && status < 500) return "status-error";
    if (status >= 500) return "status-error";
    return "status-warning";
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
