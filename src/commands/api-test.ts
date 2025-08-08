import * as vscode from "vscode";
import axios from "axios";
import * as path from "path";

interface ApiHistoryItem {
  url: string;
  method: string;
  timestamp: number;
  status?: number;
}

export function apiTest(context: vscode.ExtensionContext) {
  let history: ApiHistoryItem[] = [];
  let cookies: { [domain: string]: string[] } = {};

  // Load cookies and history from global state when the extension is activated
  const storedCookies = context.globalState.get<{ [domain: string]: string[] }>(
    "cookies",
    {}
  );
  cookies = storedCookies;

  const storedHistory = context.globalState.get<ApiHistoryItem[]>(
    "apiHistory",
    []
  );
  history = storedHistory;

  let disposable = vscode.commands.registerCommand(
    "sayaib.hue-console.openGUI",
    () => {
      const panel = vscode.window.createWebviewPanel(
        "apiTester",
        "API Tester",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        }
      );
      const iconPath = path.resolve(context.extensionPath, "logo.png");
      panel.iconPath = vscode.Uri.file(iconPath);
      panel.webview.html = getWebviewContent(history);

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case "testAPI":
              try {
                const startTime = Date.now();
                const config: any = {
                  method: message.method,
                  url: message.url,
                  validateStatus: () => true, // Ensure we get all responses including error statuses
                };

                // Only include data for POST, PUT, PATCH methods
                if (["POST", "PUT", "PATCH"].includes(message.method)) {
                  try {
                    // Try to parse as JSON if possible
                    config.data = JSON.parse(message.data);
                  } catch {
                    // If not valid JSON, send as raw data
                    config.data = message.data;
                  }
                }

                // Remove all previous cookies before making the request
                cookies = {}; // Clear the entire cookies object
                context.globalState.update("cookies", cookies);

                // Handle authentication based on the selected type
                if (message.authType) {
                  switch (message.authType) {
                    case "Bearer":
                      config.headers = {
                        ...config.headers,
                        Authorization: `Bearer ${message.authToken}`,
                      };
                      break;
                    case "Basic":
                      config.auth = {
                        username: message.username,
                        password: message.password,
                      };
                      break;
                    default:
                      // No Auth
                      break;
                  }
                }

                // Add cookies to the request if they exist for the domain
                const domain = new URL(message.url).hostname;
                if (cookies[domain]) {
                  config.headers = {
                    ...config.headers,
                    Cookie: cookies[domain].join("; "),
                  };
                }

                // Set Content-Type header for POST/PUT requests with data
                if (
                  ["POST", "PUT", "PATCH"].includes(message.method) &&
                  message.data
                ) {
                  config.headers = {
                    ...config.headers,
                    "Content-Type": "application/json",
                  };
                }

                const response = await axios(config);
                const endTime = Date.now();
                const responseTime = endTime - startTime;

                // Store cookies from the response
                if (response.headers["set-cookie"]) {
                  const domain = new URL(message.url).hostname;
                  cookies[domain] = response.headers["set-cookie"];
                  context.globalState.update("cookies", cookies);
                }

                // Add to history with proper status code
                const historyItem: ApiHistoryItem = {
                  url: message.url,
                  method: message.method,
                  timestamp: Date.now(),
                  status: response.status, // This will now include all status codes
                };

                history.unshift(historyItem);
                if (history.length > 10) {
                  history.pop();
                }
                context.globalState.update("apiHistory", history);

                panel.webview.postMessage({
                  command: "apiResponse",
                  status: response.status,
                  headers: response.headers,
                  data: response.data,
                  history: history,
                  responseTime: responseTime,
                });
              } catch (error: any) {
                const errorStatus = error.response?.status || 0;
                const errorData = error.response?.data || error.message;

                panel.webview.postMessage({
                  command: "apiError",
                  error: error.message,
                  status: errorStatus,
                  response: errorData,
                });
              }
              break;

            case "getCookies":
              panel.webview.postMessage({
                command: "showCookies",
                cookies: cookies,
              });
              break;
          }
        },
        undefined,
        context.subscriptions
      );
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
        <title>API Tester</title>
        <style>
        body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    padding: 20px;
    background-color: #1e1e1e;
    color: #ffffff;
    line-height: 1.6;
    margin: 0;
}

h1 {
    color: #007acc;
    margin-bottom: 20px;
}

.form-group {
    margin-bottom: 20px;
    position: relative;
}

label {
    display: block;
    margin-bottom: 8px;
    color: #cccccc;
    font-weight: 600;
}

input, select, textarea {
    width: 100%;
    padding: 10px;
    box-sizing: border-box;
    background-color: #2d2d2d;
    color: #ffffff;
    border: 1px solid #444;
    border-radius: 4px;
    font-size: 14px;
}

input:focus, select:focus, textarea:focus {
    border-color: #007acc;
    outline: none;
}

button {
    padding: 12px 24px;
    background-color: #007acc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: background-color 0.3s ease;
    margin-right: 10px;
    margin-bottom: 10px;
}

button:hover {
    background-color: #005f99;
}

.response {
    padding: 10px;
    background-color: #252526;
    border: 1px solid #444;
    border-radius: 4px;
    white-space: pre-wrap;
    color: #ffffff;
    max-height: 70vh;
    overflow-y: auto;
}

.response-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
    font-weight: bold;
    color:rgb(31, 140, 212);
    flex-wrap: wrap;
    gap: 10px;
}

.json-key {
    color: #9cdcfe;
}

.json-value {
    color: #ce9178;
}

.json-string {
    color: #ce9178;
}

.json-number {
    color: #b5cea8;
}

.json-boolean {
    color: #569cd6;
}

.json-null {
    color: #569cd6;
}

.history {
    margin-top: 20px;
}

.history h2 {
    color: #007acc;
    margin-bottom: 15px;
}

.history-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 20px;
    overflow-x: auto;
    display: block;
}

.history-table th, .history-table td {
    padding: 10px;
    border: 1px solid #444;
    text-align: left;
    white-space: nowrap;
}

.history-table th {
    background-color: #252526;
    color: #007acc;
}

.history-table tr:nth-child(even) {
    background-color: #252526;
}

.history-table tr:hover {
    background-color: #2d2d2d;
}

.body-api {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

@media (min-width: 768px) {
    .body-api {
        flex-direction: row;
    }
    
    .body-api > div {
        flex: 1;
    }
    
    .body-api > div:first-child {
        max-width: 40%;
    }
    
    .body-api > div:last-child {
        max-width: 58%;
    }
}

#responseOutput {
    background-color: #1e1e1e;
    padding: 10px;
    border-radius: 4px;
}

.beautify-btn {
    position: absolute;
    right: 0;
    top: 0;
    padding: 5px 10px;
    background-color: #007acc;
    color: white;
    border: none;
    border-radius: 0 4px 0 0;
    cursor: pointer;
    font-size: 12px;
}

/* Status code colors */
.status-success {
    color: #4CAF50;
}

.status-error {
    color: #F44336;
}

.status-warning {
    color: #FFC107;
}

/* Popup Modal Styles */
.modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal-content {
    background-color: #252526;
    padding: 20px;
    border-radius: 8px;
    width: 90%;
    max-width: 800px;
    max-height: 80vh;
    overflow-y: auto;
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}

.modal-header h2 {
    margin: 0;
    color: #007acc;
}

.modal-header button {
    background: none;
    border: none;
    color: #ffffff;
    font-size: 20px;
    cursor: pointer;
    padding: 5px;
}

.modal-body {
    color: #ffffff;
}

.cookie-item {
    margin-bottom: 10px;
    word-break: break-all;
}

.cookie-item strong {
    color: #9cdcfe;
}

.copy-button {
    margin-top: 20px;
    padding: 10px 20px;
    background-color: #007acc;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    width: 100%;
}

.copy-button:hover {
    background-color: #005f99;
}

/* Responsive adjustments */
@media (max-width: 600px) {
    body {
        padding: 10px;
    }
    
    button {
        width: 100%;
        margin-right: 0;
    }
    
    .history-table {
        font-size: 14px;
    }
    
    .history-table th, 
    .history-table td {
        padding: 8px 5px;
    }
    
    .modal-content {
        width: 95%;
        padding: 15px;
    }
}
        </style>
    </head>
    <body>
        <h1>Rest API</h1>
        <div class="body-api">
          <div>
            <div class="form-group">
                <label for="method">HTTP Method:</label>
                <select id="method">
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                    <option value="PATCH">PATCH</option>
                </select>
            </div>
            <div class="form-group">
                <label for="url">URL:</label>
                <input type="text" id="url" placeholder="https://example.com/api">
            </div>
            <div class="form-group">
                <label for="authType">Authentication Type:</label>
                <select id="authType">
                    <option value="None">No Auth</option>
                    <option value="Bearer">Bearer Token</option>
                    <option value="Basic">Basic Auth</option>
                </select>
            </div>
            <div id="authFields">
                <!-- Dynamic fields for authentication will be injected here -->
            </div>
            <div class="form-group">
                <label for="body">Body (JSON):</label>
                <button id="beautifyJson" class="beautify-btn">Beautify JSON</button>
                <textarea id="body" rows="5" placeholder='{"key": "value"}'></textarea>
            </div>
            <button id="sendRequest">Send Request</button>
            <button id="showCookies">Show Cookies</button>
            <div class="history">
                <h2>History (Last 10)</h2>
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Method</th>
                            <th>URL</th>
                            <th>Status</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody id="historyTableBody">
                        ${history
                          .map(
                            (item) => `
                            <tr>
                                <td>${item.method}</td>
                                <td>${item.url}</td>
                                <td class="${getStatusClass(item.status)}">${
                              item.status || "-"
                            }</td>
                                <td>${new Date(
                                  item.timestamp
                                ).toLocaleTimeString()}</td>
                            </tr>
                        `
                          )
                          .join("")}
                    </tbody>
                </table>
            </div>
          </div>
          <div>
            <div class="response-header">
                <span>Status: <span id="statusCode" class="${getStatusClass()}">-</span></span>
                <span>Time: <span id="responseTime">-</span> ms</span>
            </div>
            <div class="response">
                <pre id="responseOutput"></pre>
            </div>
          </div>
        </div>

        <!-- Popup Modal for Cookies -->
        <div id="cookieModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Stored Cookies</h2>
                    <button id="closeModal">&times;</button>
                </div>
                <div class="modal-body" id="cookieList">
                    <!-- Cookies will be dynamically inserted here -->
                </div>
                <button id="copyCookies" class="copy-button">Copy to Clipboard</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();

            // Function to determine status class
            function getStatusClass(status) {
                if (!status) return '';
                if (status >= 200 && status < 300) return 'status-success';
                if (status >= 400 && status < 500) return 'status-error';
                if (status >= 500) return 'status-error';
                return 'status-warning';
            }

            // Function to syntax highlight JSON
            function syntaxHighlight(json) {
                if (typeof json !== 'string') {
                    json = JSON.stringify(json, null, 2);
                }
                json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (match) => {
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

            // Function to beautify JSON
            function beautifyJson() {
                const bodyTextarea = document.getElementById('body');
                try {
                    const parsedJson = JSON.parse(bodyTextarea.value);
                    bodyTextarea.value = JSON.stringify(parsedJson, null, 2);
                } catch (e) {
                    alert('Invalid JSON: ' + e.message);
                }
            }

            // Function to update authentication fields based on selected type
            function updateAuthFields() {
                const authType = document.getElementById('authType').value;
                const authFields = document.getElementById('authFields');
                let fieldsHTML = '';

                switch (authType) {
                    case 'Bearer':
                        fieldsHTML = \`
                            <div class="form-group">
                                <label for="authToken">Bearer Token:</label>
                                <input type="text" id="authToken" placeholder="Enter Bearer Token">
                            </div>
                        \`;
                        break;
                    case 'Basic':
                        fieldsHTML = \`
                            <div class="form-group">
                                <label for="username">Username:</label>
                                <input type="text" id="username" placeholder="Enter Username">
                            </div>
                            <div class="form-group">
                                <label for="password">Password:</label>
                                <input type="password" id="password" placeholder="Enter Password">
                            </div>
                        \`;
                        break;
                    default:
                        fieldsHTML = '';
                        break;
                }

                authFields.innerHTML = fieldsHTML;
            }

            // Update auth fields when the authentication type changes
            document.getElementById('authType').addEventListener('change', updateAuthFields);

            // Initial call to set up auth fields
            updateAuthFields();

            // Handle Beautify JSON button click
            document.getElementById('beautifyJson').addEventListener('click', beautifyJson);

            // Handle Send Request button click
            document.getElementById('sendRequest').addEventListener('click', () => {
                const method = document.getElementById('method').value;
                const url = document.getElementById('url').value;
                const body = document.getElementById('body').value;
                const authType = document.getElementById('authType').value;
                const authToken = document.getElementById('authToken')?.value;
                const username = document.getElementById('username')?.value;
                const password = document.getElementById('password')?.value;

                if (!url) {
                    alert('Please enter a URL');
                    return;
                }

                vscode.postMessage({
                    command: 'testAPI',
                    method,
                    url,
                    data: body,
                    authType,
                    authToken,
                    username,
                    password,
                });
            });

            // Handle Show Cookies button click
            document.getElementById('showCookies').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'getCookies',
                });
            });

            // Handle Close Modal button click
            document.getElementById('closeModal').addEventListener('click', () => {
                document.getElementById('cookieModal').style.display = 'none';
            });

            // Handle Copy to Clipboard button click
            document.getElementById('copyCookies').addEventListener('click', () => {
                const cookieText = document.getElementById('cookieList').innerText;
                navigator.clipboard.writeText(cookieText).then(() => {
                    alert('Cookies copied to clipboard!');
                });
            });

            // Listen for messages from the extension
            window.addEventListener('message', (event) => {
                const responseOutput = document.getElementById('responseOutput');
                const statusCode = document.getElementById('statusCode');
                const responseTime = document.getElementById('responseTime');

                if (event.data.command === 'apiResponse') {
                    // Update status with proper styling
                    statusCode.textContent = event.data.status;
                    statusCode.className = getStatusClass(event.data.status);
                    
                    // Update response time
                    responseTime.textContent = event.data.responseTime;
                    
                    // Update response output
                    responseOutput.innerHTML = syntaxHighlight(event.data.data);

                    // Update history table
                    const historyTableBody = document.getElementById('historyTableBody');
                    historyTableBody.innerHTML = event.data.history.map(item => \`
                        <tr>
                            <td>\${item.method}</td>
                            <td>\${item.url}</td>
                            <td class="\${getStatusClass(item.status)}">\${item.status || '-'}</td>
                            <td>\${new Date(item.timestamp).toLocaleTimeString()}</td>
                        </tr>
                    \`).join('');
                } else if (event.data.command === 'apiError') {
                    // Update status with error styling
                    statusCode.textContent = event.data.status || 'Error';
                    statusCode.className = 'status-error';
                    responseTime.textContent = '-';
                    
                    let errorContent = 'Error: ' + event.data.error;
                    if (event.data.response) {
                        errorContent += '\\n\\n' + syntaxHighlight(event.data.response);
                    }
                    responseOutput.innerHTML = errorContent;
                } else if (event.data.command === 'showCookies') {
                    const cookieList = document.getElementById('cookieList');
                    cookieList.innerHTML = '';

                    for (const [domain, cookies] of Object.entries(event.data.cookies)) {
                        const domainHeader = document.createElement('h3');
                        domainHeader.textContent = domain;
                        cookieList.appendChild(domainHeader);

                        cookies.forEach(cookie => {
                            const cookieItem = document.createElement('div');
                            cookieItem.className = 'cookie-item';
                            cookieItem.innerHTML = \`<strong>Cookie:</strong> \${cookie}\`;
                            cookieList.appendChild(cookieItem);
                        });
                    }

                    document.getElementById('cookieModal').style.display = 'flex';
                }
            });
        </script>
    </body>
    </html>
    `;

  // Helper function to determine status class
  function getStatusClass(status?: number): string {
    if (!status) return "";
    if (status >= 200 && status < 300) return "status-success";
    if (status >= 400 && status < 500) return "status-error";
    if (status >= 500) return "status-error";
    return "status-warning";
  }
}

export function deactivate() {}
