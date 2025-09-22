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
}

class ApiTester {
  private history: ApiHistoryItem[] = [];
  private cookies: { [domain: string]: string[] } = {};
  private cancelTokenSource: CancelTokenSource | null = null;
  private readonly MAX_HISTORY_SIZE = 50;
  private readonly DEFAULT_TIMEOUT = 30000;

  constructor(private context: vscode.ExtensionContext) {
    this.loadStoredData();
  }

  private loadStoredData(): void {
    try {
      this.cookies = this.context.globalState.get<{ [domain: string]: string[] }>("cookies", {});
      this.history = this.context.globalState.get<ApiHistoryItem[]>("apiHistory", []);
    } catch (error) {
      console.error("Failed to load stored data:", error);
      this.cookies = {};
      this.history = [];
    }
  }

  private async saveData(): Promise<void> {
    try {
      await Promise.all([
        this.context.globalState.update("cookies", this.cookies),
        this.context.globalState.update("apiHistory", this.history)
      ]);
    } catch (error) {
      console.error("Failed to save data:", error);
    }
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
    // Validation
    if (!this.validateUrl(request.url)) {
      throw new Error("Invalid URL format");
    }

    if (request.data && !this.validateJson(request.data)) {
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
      url: request.url,
      timeout: request.timeout || this.DEFAULT_TIMEOUT,
      validateStatus: () => true,
      cancelToken: this.cancelTokenSource.token,
      headers: {
        'User-Agent': 'DevSnip-Pro API Tester',
        ...request.headers
      }
    };

    // Handle request body for appropriate methods
    if (["POST", "PUT", "PATCH"].includes(request.method) && request.data) {
      try {
        config.data = JSON.parse(request.data);
        config.headers!['Content-Type'] = 'application/json';
      } catch {
        config.data = request.data;
        config.headers!['Content-Type'] = 'text/plain';
      }
    }

    // Handle authentication
    if (request.authType) {
      switch (request.authType) {
        case "Bearer":
          if (request.authToken) {
            config.headers!['Authorization'] = `Bearer ${request.authToken}`;
          }
          break;
        case "Basic":
          if (request.username && request.password) {
            config.auth = {
              username: request.username,
              password: request.password,
            };
          }
          break;
      }
    }

    // Add cookies
    const domain = this.getDomainFromUrl(request.url);
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
        this.cookies[domain] = response.headers["set-cookie"];
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
                    timeout: message.timeout
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
            --primary-color: #007acc;
            --primary-hover: #005f99;
            --success-color: #4CAF50;
            --error-color: #F44336;
            --warning-color: #FFC107;
            --bg-primary: #1e1e1e;
            --bg-secondary: #252526;
            --bg-tertiary: #2d2d2d;
            --text-primary: #ffffff;
            --text-secondary: #cccccc;
            --border-color: #444;
            --json-key: #9cdcfe;
            --json-string: #ce9178;
            --json-number: #b5cea8;
            --json-boolean: #569cd6;
            --json-null: #569cd6;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 20px;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            margin: 0;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            flex-wrap: wrap;
            gap: 10px;
        }

        h1 {
            color: var(--primary-color);
            margin: 0;
            font-size: 2rem;
        }

        .header-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .form-group {
            margin-bottom: 20px;
            position: relative;
        }

        label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-secondary);
            font-weight: 600;
        }

        input, select, textarea {
            width: 100%;
            padding: 12px;
            background-color: var(--bg-tertiary);
            color: var(--text-primary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }

        input:focus, select:focus, textarea:focus {
            border-color: var(--primary-color);
            outline: none;
            box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
        }

        .input-group {
            display: flex;
            gap: 10px;
        }

        .input-group input {
            flex: 1;
        }

        button {
            padding: 12px 24px;
            background-color: var(--primary-color);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }

        button:hover:not(:disabled) {
            background-color: var(--primary-hover);
            transform: translateY(-1px);
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn-secondary {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
        }

        .btn-secondary:hover:not(:disabled) {
            background-color: var(--bg-tertiary);
        }

        .btn-danger {
            background-color: var(--error-color);
        }

        .btn-danger:hover:not(:disabled) {
            background-color: #d32f2f;
        }

        .btn-small {
            padding: 6px 12px;
            font-size: 12px;
        }

        .loading-spinner {
            width: 16px;
            height: 16px;
            border: 2px solid transparent;
            border-top: 2px solid currentColor;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .response-container {
            background-color: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            overflow: hidden;
        }

        .response-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            background-color: var(--bg-tertiary);
            border-bottom: 1px solid var(--border-color);
            flex-wrap: wrap;
            gap: 10px;
        }

        .response-stats {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }

        .stat-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
        }

        .stat-label {
            font-size: 12px;
            color: var(--text-secondary);
            text-transform: uppercase;
        }

        .stat-value {
            font-weight: bold;
            font-size: 14px;
        }

        .response-content {
            padding: 15px;
            max-height: 60vh;
            overflow-y: auto;
        }

        .response-output {
            background-color: var(--bg-primary);
            padding: 15px;
            border-radius: 4px;
            white-space: pre-wrap;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            line-height: 1.4;
            overflow-x: auto;
        }

        .json-key { color: var(--json-key); }
        .json-string { color: var(--json-string); }
        .json-number { color: var(--json-number); }
        .json-boolean { color: var(--json-boolean); }
        .json-null { color: var(--json-null); }

        .status-success { color: var(--success-color); }
        .status-error { color: var(--error-color); }
        .status-warning { color: var(--warning-color); }

        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 30px;
            align-items: start;
        }

        .request-panel, .response-panel {
            background-color: var(--bg-secondary);
            padding: 20px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .panel-title {
            color: var(--primary-color);
            margin: 0 0 20px 0;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .history-section {
            margin-top: 30px;
            background-color: var(--bg-secondary);
            padding: 20px;
            border-radius: 8px;
            border: 1px solid var(--border-color);
        }

        .history-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }

        .history-table th,
        .history-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        .history-table th {
            background-color: var(--bg-tertiary);
            color: var(--primary-color);
            font-weight: 600;
            position: sticky;
            top: 0;
        }

        .history-table tr:hover {
            background-color: var(--bg-tertiary);
        }

        .history-table td {
            font-size: 13px;
        }

        .url-cell {
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }

        .modal-content {
            background-color: var(--bg-secondary);
            padding: 30px;
            border-radius: 8px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            border: 1px solid var(--border-color);
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .modal-header h2 {
            margin: 0;
            color: var(--primary-color);
        }

        .close-btn {
            background: none;
            border: none;
            color: var(--text-primary);
            font-size: 24px;
            cursor: pointer;
            padding: 5px;
            border-radius: 4px;
        }

        .close-btn:hover {
            background-color: var(--bg-tertiary);
        }

        .cookie-item {
            margin-bottom: 15px;
            padding: 10px;
            background-color: var(--bg-primary);
            border-radius: 4px;
            word-break: break-all;
        }

        .cookie-domain {
            color: var(--primary-color);
            font-weight: bold;
            margin-bottom: 5px;
        }

        .headers-container {
            margin-bottom: 20px;
        }

        .header-row {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            align-items: center;
        }

        .header-row input {
            flex: 1;
        }

        .remove-header-btn {
            padding: 8px;
            background-color: var(--error-color);
            min-width: auto;
        }

        .add-header-btn {
            background-color: var(--success-color);
        }

        .add-header-btn:hover {
            background-color: #45a049;
        }

        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 6px;
            color: white;
            font-weight: 600;
            z-index: 1001;
            transform: translateX(400px);
            transition: transform 0.3s ease;
        }

        .notification.show {
            transform: translateX(0);
        }

        .notification.success {
            background-color: var(--success-color);
        }

        .notification.error {
            background-color: var(--error-color);
        }

        .notification.info {
            background-color: var(--primary-color);
        }

        @media (max-width: 1024px) {
            .main-content {
                grid-template-columns: 1fr;
                gap: 20px;
            }
            
            .header {
                flex-direction: column;
                align-items: stretch;
            }
            
            .header-actions {
                justify-content: center;
            }
        }

        @media (max-width: 768px) {
            body {
                padding: 15px;
            }
            
            .request-panel,
            .response-panel,
            .history-section {
                padding: 15px;
            }
            
            .response-stats {
                justify-content: center;
            }
            
            .history-table {
                font-size: 12px;
            }
            
            .history-table th,
            .history-table td {
                padding: 8px 6px;
            }
            
            .modal-content {
                padding: 20px;
                width: 95%;
            }
        }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🚀 API Tester Pro</h1>
            <div class="header-actions">
                <button id="showCookies" class="btn-secondary">🍪 Cookies</button>
                <button id="clearHistory" class="btn-secondary">🗑️ Clear History</button>
                <button id="clearCookies" class="btn-danger btn-small">Clear Cookies</button>
            </div>
        </div>

        <div class="main-content">
            <div class="request-panel">
                <h2 class="panel-title">📤 Request</h2>
                
                <div class="form-group">
                    <label for="method">HTTP Method</label>
                    <select id="method">
                        <option value="GET">GET</option>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="DELETE">DELETE</option>
                        <option value="PATCH">PATCH</option>
                        <option value="HEAD">HEAD</option>
                        <option value="OPTIONS">OPTIONS</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="url">URL</label>
                    <input type="text" id="url" placeholder="https://api.example.com/endpoint">
                </div>

                <div class="form-group">
                    <label for="timeout">Timeout (ms)</label>
                    <input type="number" id="timeout" value="30000" min="1000" max="300000">
                </div>

                <div class="form-group">
                    <label>Custom Headers</label>
                    <div class="headers-container" id="headersContainer">
                        <div class="header-row">
                            <input type="text" placeholder="Header Name" class="header-key">
                            <input type="text" placeholder="Header Value" class="header-value">
                            <button type="button" class="remove-header-btn btn-small">✕</button>
                        </div>
                    </div>
                    <button type="button" id="addHeader" class="add-header-btn btn-small">+ Add Header</button>
                </div>

                <div class="form-group">
                    <label for="authType">Authentication</label>
                    <select id="authType">
                        <option value="None">No Auth</option>
                        <option value="Bearer">Bearer Token</option>
                        <option value="Basic">Basic Auth</option>
                    </select>
                </div>

                <div id="authFields"></div>

                <div class="form-group">
                    <label for="body">Request Body</label>
                    <div style="position: relative;">
                        <div style="position: absolute; top: 10px; right: 10px; z-index: 10; display: flex; gap: 5px;">
                            <button id="convertToJson" class="btn-small" title="Convert to JSON">🔄 To JSON</button>
                            <button id="beautifyJson" class="btn-small" title="Format JSON/XML">✨ Format</button>
                            <button id="validateData" class="btn-small" title="Validate JSON/XML">✅ Validate</button>
                        </div>
                        <textarea id="body" rows="8" placeholder='{"key": "value"}'></textarea>
                    </div>
                </div>

                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button id="sendRequest">
                        <span class="button-text">🚀 Send Request</span>
                        <div class="loading-spinner" style="display: none;"></div>
                    </button>
                    <button id="cancelRequest" class="btn-danger" style="display: none;">⏹️ Cancel</button>
                </div>
            </div>

            <div class="response-panel">
                <h2 class="panel-title">📥 Response</h2>
                
                <div class="response-container">
                    <div class="response-header">
                        <div class="response-stats">
                            <div class="stat-item">
                                <div class="stat-label">Status</div>
                                <div class="stat-value" id="statusCode">-</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Time</div>
                                <div class="stat-value" id="responseTime">-</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Size</div>
                                <div class="stat-value" id="responseSize">-</div>
                            </div>
                        </div>
                    </div>
                    <div class="response-content">
                        <div class="response-output" id="responseOutput">
                            <div style="text-align: center; color: var(--text-secondary); padding: 40px;">
                                📡 Ready to send your first request
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="history-section">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h2 class="panel-title">📊 Request History</h2>
                <span style="color: var(--text-secondary); font-size: 14px;">Last 10 requests</span>
            </div>
            <div style="overflow-x: auto;">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Method</th>
                            <th>URL</th>
                            <th>Status</th>
                            <th>Time</th>
                            <th>Size</th>
                            <th>Timestamp</th>
                        </tr>
                    </thead>
                    <tbody id="historyTableBody">
                        ${history.map(item => `
                            <tr>
                                <td><span style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 11px;">${item.method}</span></td>
                                <td class="url-cell" title="${item.url}">${item.url}</td>
                                <td class="${getStatusClass(item.status)}">${item.status || '-'}</td>
                                <td>${item.responseTime ? item.responseTime + 'ms' : '-'}</td>
                                <td>${item.size ? formatBytes(item.size) : '-'}</td>
                                <td>${new Date(item.timestamp).toLocaleString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Cookie Modal -->
        <div id="cookieModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>🍪 Stored Cookies</h2>
                    <button class="close-btn" id="closeModal">×</button>
                </div>
                <div id="cookieList"></div>
                <button id="copyCookies" class="btn-secondary" style="width: 100%; margin-top: 20px;">📋 Copy to Clipboard</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let isRequestInProgress = false;

            // Utility functions
            function showNotification(message, type = 'info') {
                const notification = document.createElement('div');
                notification.className = \`notification \${type}\`;
                notification.textContent = message;
                document.body.appendChild(notification);
                
                setTimeout(() => notification.classList.add('show'), 100);
                setTimeout(() => {
                    notification.classList.remove('show');
                    setTimeout(() => document.body.removeChild(notification), 300);
                }, 3000);
            }

            function getStatusClass(status) {
                if (!status) return '';
                if (status >= 200 && status < 300) return 'status-success';
                if (status >= 400 && status < 500) return 'status-error';
                if (status >= 500) return 'status-error';
                return 'status-warning';
            }

            function syntaxHighlight(json) {
                if (typeof json !== 'string') {
                    json = JSON.stringify(json, null, 2);
                }
                json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return json.replace(/("(\\\\u[a-zA-Z0-9]{4}|\\\\[^u]|[^\\\\"])*"(\\s*:)?|\\b(true|false|null)\\b|-?\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)/g, (match) => {
                    let cls = 'json-value';
                    if (/^"/.test(match)) {
                        if (/:$/.test(match)) {
                            cls = 'json-key';
                        } else {
                            cls = 'json-string';
                        }
                    } else if (/true|false/.test(match)) {
                        cls = 'json-boolean';
                    } else if (/null/.test(match)) {
                        cls = 'json-null';
                    } else if (!isNaN(match)) {
                        cls = 'json-number';
                    }
                    return '<span class="' + cls + '">' + match + '</span>';
                });
            }

            function updateRequestState(inProgress) {
                isRequestInProgress = inProgress;
                const sendBtn = document.getElementById('sendRequest');
                const cancelBtn = document.getElementById('cancelRequest');
                const spinner = sendBtn.querySelector('.loading-spinner');
                const buttonText = sendBtn.querySelector('.button-text');

                if (inProgress) {
                    sendBtn.disabled = true;
                    cancelBtn.style.display = 'inline-flex';
                    spinner.style.display = 'block';
                    buttonText.textContent = '⏳ Sending...';
                } else {
                    sendBtn.disabled = false;
                    cancelBtn.style.display = 'none';
                    spinner.style.display = 'none';
                    buttonText.textContent = '🚀 Send Request';
                }
            }

            function updateAuthFields() {
                const authType = document.getElementById('authType').value;
                const authFields = document.getElementById('authFields');
                let fieldsHTML = '';

                switch (authType) {
                    case 'Bearer':
                        fieldsHTML = \`
                            <div class="form-group">
                                <label for="authToken">Bearer Token</label>
                                <input type="password" id="authToken" placeholder="Enter your bearer token">
                            </div>
                        \`;
                        break;
                    case 'Basic':
                        fieldsHTML = \`
                            <div class="form-group">
                                <label for="username">Username</label>
                                <input type="text" id="username" placeholder="Enter username">
                            </div>
                            <div class="form-group">
                                <label for="password">Password</label>
                                <input type="password" id="password" placeholder="Enter password">
                            </div>
                        \`;
                        break;
                }

                authFields.innerHTML = fieldsHTML;
            }

            function collectHeaders() {
                const headers = {};
                const headerRows = document.querySelectorAll('.header-row');
                
                headerRows.forEach(row => {
                    const key = row.querySelector('.header-key').value.trim();
                    const value = row.querySelector('.header-value').value.trim();
                    if (key && value) {
                        headers[key] = value;
                    }
                });
                
                return headers;
            }

            function addHeaderRow() {
                const container = document.getElementById('headersContainer');
                const row = document.createElement('div');
                row.className = 'header-row';
                row.innerHTML = \`
                    <input type="text" placeholder="Header Name" class="header-key">
                    <input type="text" placeholder="Header Value" class="header-value">
                    <button type="button" class="remove-header-btn btn-small">✕</button>
                \`;
                
                row.querySelector('.remove-header-btn').addEventListener('click', () => {
                    container.removeChild(row);
                });
                
                container.appendChild(row);
            }

            function updateHistoryTable(history) {
                const tbody = document.getElementById('historyTableBody');
                tbody.innerHTML = history.map(item => \`
                    <tr>
                        <td><span style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 11px;">\${item.method}</span></td>
                        <td class="url-cell" title="\${item.url}">\${item.url}</td>
                        <td class="\${getStatusClass(item.status)}">\${item.status || '-'}</td>
                        <td>\${item.responseTime ? item.responseTime + 'ms' : '-'}</td>
                        <td>\${item.size ? item.size : '-'}</td>
                        <td>\${new Date(item.timestamp).toLocaleString()}</td>
                    </tr>
                \`).join('');
            }

            // Helper functions for JSON/XML conversion and formatting
            function convertToJson(content) {
                // Remove leading/trailing whitespace
                content = content.trim();
                
                // Try to parse as JSON first
                try {
                    return JSON.parse(content);
                } catch (e) {
                    // Not valid JSON, try other formats
                }
                
                // Try to parse as XML and convert to JSON
                if (content.startsWith('<') && content.endsWith('>')) {
                    try {
                        return xmlToJson(content);
                    } catch (e) {
                        throw new Error('Invalid XML format');
                    }
                }
                
                // Try to parse as query string
                if (content.includes('=') && !content.includes('{') && !content.includes('<')) {
                    try {
                        return queryStringToJson(content);
                    } catch (e) {
                        throw new Error('Invalid query string format');
                    }
                }
                
                // Try to parse as key-value pairs (one per line)
                if (content.includes('\\n') && content.includes(':')) {
                    try {
                        return keyValueToJson(content);
                    } catch (e) {
                        throw new Error('Invalid key-value format');
                    }
                }
                
                // Try to fix common JSON syntax errors
                try {
                    return fixAndParseJson(content);
                } catch (e) {
                    throw new Error('Could not convert to valid JSON format');
                }
            }
            
            function xmlToJson(xml) {
                // Simple XML to JSON converter
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xml, 'text/xml');
                
                if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
                    throw new Error('Invalid XML');
                }
                
                function xmlNodeToJson(node) {
                    const result = {};
                    
                    // Handle attributes
                    if (node.attributes && node.attributes.length > 0) {
                        result['@attributes'] = {};
                        for (let i = 0; i < node.attributes.length; i++) {
                            const attr = node.attributes[i];
                            result['@attributes'][attr.name] = attr.value;
                        }
                    }
                    
                    // Handle child nodes
                    if (node.childNodes && node.childNodes.length > 0) {
                        for (let i = 0; i < node.childNodes.length; i++) {
                            const child = node.childNodes[i];
                            
                            if (child.nodeType === 3) { // Text node
                                const text = child.textContent.trim();
                                if (text) {
                                    if (Object.keys(result).length === 0) {
                                        return text;
                                    } else {
                                        result['#text'] = text;
                                    }
                                }
                            } else if (child.nodeType === 1) { // Element node
                                const childJson = xmlNodeToJson(child);
                                if (result[child.nodeName]) {
                                    if (!Array.isArray(result[child.nodeName])) {
                                        result[child.nodeName] = [result[child.nodeName]];
                                    }
                                    result[child.nodeName].push(childJson);
                                } else {
                                    result[child.nodeName] = childJson;
                                }
                            }
                        }
                    }
                    
                    return result;
                }
                
                return xmlNodeToJson(xmlDoc.documentElement);
            }
            
            function queryStringToJson(queryString) {
                const result = {};
                const pairs = queryString.split('&');
                
                for (const pair of pairs) {
                    const [key, value] = pair.split('=');
                    if (key) {
                        result[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
                    }
                }
                
                return result;
            }
            
            function keyValueToJson(content) {
                const result = {};
                const lines = content.split('\\n');
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed && trimmed.includes(':')) {
                        const colonIndex = trimmed.indexOf(':');
                        const key = trimmed.substring(0, colonIndex).trim();
                        const value = trimmed.substring(colonIndex + 1).trim();
                        
                        if (key) {
                            // Try to parse value as JSON
                            try {
                                result[key] = JSON.parse(value);
                            } catch (e) {
                                result[key] = value;
                            }
                        }
                    }
                }
                
                return result;
            }
            
            function fixAndParseJson(content) {
                // Common JSON fixes
                let fixed = content
                    // Fix single quotes to double quotes
                    .replace(/'/g, '"')
                    // Fix unquoted keys
                    .replace(/([{,]\\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\\s*:)/g, '$1"$2"$3')
                    // Fix trailing commas
                    .replace(/,\\s*([}\\]])/g, '$1')
                    // Fix missing commas between objects/arrays
                    .replace(/}\\s*{/g, '},{')
                    .replace(/]\\s*\\[/g, '],[');
                
                return JSON.parse(fixed);
            }
            
            function formatXml(xml) {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xml, 'text/xml');
                
                if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
                    throw new Error('Invalid XML');
                }
                
                const serializer = new XMLSerializer();
                let formatted = serializer.serializeToString(xmlDoc);
                
                // Simple XML formatting
                formatted = formatted
                    .replace(/></g, '>\\n<')
                    .replace(/^\\s*\\n/gm, '');
                
                // Add indentation
                const lines = formatted.split('\\n');
                let indent = 0;
                const indentSize = 2;
                
                return lines.map(line => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith('</')) {
                        indent -= indentSize;
                    }
                    
                    const result = ' '.repeat(Math.max(0, indent)) + trimmed;
                    
                    if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>')) {
                        indent += indentSize;
                    }
                    
                    return result;
                }).join('\\n');
            }
            
            function validateContent(content) {
                // Try JSON validation
                try {
                    JSON.parse(content);
                    return { isValid: true, type: 'JSON', error: null };
                } catch (jsonError) {
                    // Try XML validation
                    try {
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(content, 'text/xml');
                        
                        if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
                            throw new Error('Invalid XML');
                        }
                        
                        return { isValid: true, type: 'XML', error: null };
                    } catch (xmlError) {
                        return { 
                            isValid: false, 
                            type: 'JSON/XML', 
                            error: \`JSON: \${jsonError.message}, XML: \${xmlError.message}\`
                        };
                    }
                }
            }

            // Event listeners
            document.getElementById('authType').addEventListener('change', updateAuthFields);
            
            document.getElementById('addHeader').addEventListener('click', addHeaderRow);
            
            // Initial header row remove functionality
            document.querySelector('.remove-header-btn').addEventListener('click', function() {
                if (document.querySelectorAll('.header-row').length > 1) {
                    this.parentElement.remove();
                }
            });

            // Smart JSON/XML conversion functionality
            document.getElementById('convertToJson').addEventListener('click', () => {
                const bodyTextarea = document.getElementById('body');
                const content = bodyTextarea.value.trim();
                
                if (!content) {
                    showNotification('No content to convert', 'warning');
                    return;
                }

                try {
                    // Try to convert various formats to JSON
                    let result = convertToJson(content);
                    bodyTextarea.value = JSON.stringify(result, null, 2);
                    showNotification('Successfully converted to JSON!', 'success');
                } catch (error) {
                    showNotification('Could not convert to JSON: ' + error.message, 'error');
                }
            });

            document.getElementById('beautifyJson').addEventListener('click', () => {
                const bodyTextarea = document.getElementById('body');
                const content = bodyTextarea.value.trim();
                
                if (!content) {
                    showNotification('No content to format', 'warning');
                    return;
                }

                try {
                    // Try JSON first
                    const parsed = JSON.parse(content);
                    bodyTextarea.value = JSON.stringify(parsed, null, 2);
                    showNotification('JSON formatted successfully!', 'success');
                } catch (jsonError) {
                    try {
                        // Try XML formatting
                        const formatted = formatXml(content);
                        bodyTextarea.value = formatted;
                        showNotification('XML formatted successfully!', 'success');
                    } catch (xmlError) {
                        showNotification('Invalid JSON/XML format', 'error');
                    }
                }
            });

            document.getElementById('validateData').addEventListener('click', () => {
                const bodyTextarea = document.getElementById('body');
                const content = bodyTextarea.value.trim();
                
                if (!content) {
                    showNotification('No content to validate', 'warning');
                    return;
                }

                const validation = validateContent(content);
                if (validation.isValid) {
                    showNotification(\`Valid \${validation.type}!\`, 'success');
                } else {
                    showNotification(\`Invalid \${validation.type}: \${validation.error}\`, 'error');
                }
            });

            document.getElementById('sendRequest').addEventListener('click', () => {
                if (isRequestInProgress) return;

                const method = document.getElementById('method').value;
                const url = document.getElementById('url').value.trim();
                const body = document.getElementById('body').value.trim();
                const timeout = parseInt(document.getElementById('timeout').value) || 30000;
                const authType = document.getElementById('authType').value;
                const authToken = document.getElementById('authToken')?.value;
                const username = document.getElementById('username')?.value;
                const password = document.getElementById('password')?.value;
                const headers = collectHeaders();

                if (!url) {
                    showNotification('Please enter a URL', 'error');
                    return;
                }

                if (!/^https?:\\/\\//i.test(url)) {
                    showNotification('URL must start with http:// or https://', 'error');
                    return;
                }

                vscode.postMessage({
                    command: 'testAPI',
                    method,
                    url,
                    data: body,
                    headers,
                    authType,
                    authToken,
                    username,
                    password,
                    timeout
                });
            });

            document.getElementById('cancelRequest').addEventListener('click', () => {
                vscode.postMessage({ command: 'cancelRequest' });
            });

            document.getElementById('showCookies').addEventListener('click', () => {
                vscode.postMessage({ command: 'getCookies' });
            });

            document.getElementById('clearHistory').addEventListener('click', () => {
                if (confirm('Are you sure you want to clear the request history?')) {
                    vscode.postMessage({ command: 'clearHistory' });
                }
            });

            document.getElementById('clearCookies').addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all stored cookies?')) {
                    vscode.postMessage({ command: 'clearCookies' });
                }
            });

            document.getElementById('closeModal').addEventListener('click', () => {
                document.getElementById('cookieModal').style.display = 'none';
            });

            document.getElementById('copyCookies').addEventListener('click', () => {
                const cookieText = document.getElementById('cookieList').innerText;
                navigator.clipboard.writeText(cookieText).then(() => {
                    showNotification('Cookies copied to clipboard!', 'success');
                });
            });

            // Initialize
            updateAuthFields();

            // Message handling
            window.addEventListener('message', (event) => {
                const data = event.data;

                switch (data.command) {
                    case 'requestStarted':
                        updateRequestState(true);
                        document.getElementById('responseOutput').innerHTML = 
                            '<div style="text-align: center; color: var(--text-secondary); padding: 40px;">⏳ Sending request...</div>';
                        break;

                    case 'apiResponse':
                        updateRequestState(false);
                        document.getElementById('statusCode').textContent = data.status;
                        document.getElementById('statusCode').className = 'stat-value ' + getStatusClass(data.status);
                        document.getElementById('responseTime').textContent = data.responseTime + 'ms';
                        document.getElementById('responseSize').textContent = data.size;
                        document.getElementById('responseOutput').innerHTML = syntaxHighlight(data.data);
                        updateHistoryTable(data.history);
                        showNotification('Request completed successfully!', 'success');
                        break;

                    case 'apiError':
                        updateRequestState(false);
                        document.getElementById('statusCode').textContent = data.status || 'Error';
                        document.getElementById('statusCode').className = 'stat-value status-error';
                        document.getElementById('responseTime').textContent = data.responseTime ? data.responseTime + 'ms' : '-';
                        document.getElementById('responseSize').textContent = '-';
                        
                        let errorContent = 'Error: ' + data.error;
                        if (data.response) {
                            errorContent += '\\n\\n' + syntaxHighlight(data.response);
                        }
                        document.getElementById('responseOutput').innerHTML = errorContent;
                        showNotification('Request failed: ' + data.error, 'error');
                        break;

                    case 'requestCancelled':
                        updateRequestState(false);
                        document.getElementById('responseOutput').innerHTML = 
                            '<div style="text-align: center; color: var(--warning-color); padding: 40px;">⚠️ Request was cancelled</div>';
                        showNotification('Request cancelled', 'info');
                        break;

                    case 'showCookies':
                        const cookieList = document.getElementById('cookieList');
                        cookieList.innerHTML = '';

                        if (Object.keys(data.cookies).length === 0) {
                            cookieList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px;">No cookies stored</div>';
                        } else {
                            for (const [domain, cookies] of Object.entries(data.cookies)) {
                                const domainDiv = document.createElement('div');
                                domainDiv.className = 'cookie-item';
                                domainDiv.innerHTML = \`
                                    <div class="cookie-domain">\${domain}</div>
                                    \${cookies.map(cookie => \`<div style="margin-left: 10px; font-family: monospace; font-size: 12px;">\${cookie}</div>\`).join('')}
                                \`;
                                cookieList.appendChild(domainDiv);
                            }
                        }

                        document.getElementById('cookieModal').style.display = 'flex';
                        break;

                    case 'historyCleared':
                        updateHistoryTable([]);
                        showNotification('History cleared successfully!', 'success');
                        break;

                    case 'cookiesCleared':
                        showNotification('Cookies cleared successfully!', 'success');
                        break;

                    case 'error':
                        showNotification('Error: ' + data.message, 'error');
                        break;
                }
            });
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

export function deactivate() {}
