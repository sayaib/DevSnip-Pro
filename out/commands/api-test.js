"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.apiTest = void 0;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const path = __importStar(require("path"));
function apiTest(context) {
    let _history = null;
    let _cookies = null;
    let _savedRequests = null;
    const getHistory = () => {
        if (_history === null) {
            _history = context.globalState.get("apiHistory", []);
        }
        return _history;
    };
    const getCookies = () => {
        if (_cookies === null) {
            _cookies = context.globalState.get("cookies", {});
        }
        return _cookies;
    };
    const getSavedRequests = () => {
        if (_savedRequests === null) {
            _savedRequests = context.globalState.get("savedApiRequests", []);
        }
        return _savedRequests;
    };
    let disposable = vscode.commands.registerCommand("sayaib.hue-console.openGUI", () => {
        const panel = vscode.window.createWebviewPanel("apiTester", "API Tester", vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        const iconPath = path.resolve(context.extensionPath, "logo.png");
        panel.iconPath = vscode.Uri.file(iconPath);
        panel.webview.html = getWebviewContent(getHistory());
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "testAPI":
                    try {
                        const startTime = Date.now();
                        const config = {
                            method: message.method,
                            url: message.url,
                            validateStatus: () => true,
                        };
                        if (["POST", "PUT", "PATCH"].includes(message.method)) {
                            try {
                                config.data = JSON.parse(message.data);
                            }
                            catch {
                                config.data = message.data;
                            }
                        }
                        _cookies = {};
                        context.globalState.update("cookies", _cookies);
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
                                    break;
                            }
                        }
                        const domain = new URL(message.url).hostname;
                        const currentCookies = getCookies();
                        if (currentCookies[domain]) {
                            config.headers = {
                                ...config.headers,
                                Cookie: currentCookies[domain].join("; "),
                            };
                        }
                        if (message.headers) {
                            try {
                                const customHeaders = JSON.parse(message.headers);
                                config.headers = {
                                    ...config.headers,
                                    ...customHeaders
                                };
                            }
                            catch (error) {
                                console.error('Invalid headers JSON:', error);
                                if (["POST", "PUT", "PATCH"].includes(message.method) &&
                                    message.data) {
                                    config.headers = {
                                        ...config.headers,
                                        "Content-Type": "application/json",
                                    };
                                }
                            }
                        }
                        else {
                            if (["POST", "PUT", "PATCH"].includes(message.method) &&
                                message.data) {
                                config.headers = {
                                    ...config.headers,
                                    "Content-Type": "application/json",
                                };
                            }
                        }
                        const response = await (0, axios_1.default)(config);
                        const endTime = Date.now();
                        const responseTime = endTime - startTime;
                        if (response.headers["set-cookie"]) {
                            const domain = new URL(message.url).hostname;
                            const currentCookies = getCookies();
                            currentCookies[domain] = response.headers["set-cookie"];
                            context.globalState.update("cookies", currentCookies);
                        }
                        const historyItem = {
                            url: message.url,
                            method: message.method,
                            timestamp: Date.now(),
                            status: response.status,
                            name: message.requestName || "",
                            duration: responseTime
                        };
                        const currentHistory = getHistory();
                        currentHistory.unshift(historyItem);
                        if (currentHistory.length > 10) {
                            currentHistory.pop();
                        }
                        context.globalState.update("apiHistory", currentHistory);
                        panel.webview.postMessage({
                            command: "apiResponse",
                            status: response.status,
                            headers: response.headers,
                            data: response.data,
                            history: getHistory(),
                            responseTime: responseTime,
                        });
                    }
                    catch (error) {
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
                        cookies: getCookies(),
                    });
                    break;
                case "getSavedRequests":
                    panel.webview.postMessage({
                        command: "showSavedRequests",
                        requests: getSavedRequests(),
                    });
                    break;
                case "saveRequest":
                    const currentSavedRequests = getSavedRequests();
                    currentSavedRequests.push(message.request);
                    context.globalState.update("savedApiRequests", currentSavedRequests);
                    panel.webview.postMessage({
                        command: "showSavedRequests",
                        requests: currentSavedRequests,
                    });
                    break;
                case "deleteRequest":
                    const savedRequestsList = getSavedRequests();
                    if (message.index >= 0 && message.index < savedRequestsList.length) {
                        savedRequestsList.splice(message.index, 1);
                        context.globalState.update("savedApiRequests", savedRequestsList);
                        panel.webview.postMessage({
                            command: "showSavedRequests",
                            requests: savedRequestsList,
                        });
                    }
                    break;
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(disposable);
}
exports.apiTest = apiTest;
function getWebviewContent(history) {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Tester</title>
        <style>
        :root {
    --primary-color: #007acc;
    --primary-hover: #005f99;
    --background-color: #1e1e1e;
    --card-background: #252526;
    --input-background: #2d2d2d;
    --border-color: #444;
    --text-color: #ffffff;
    --text-secondary: #cccccc;
    --success-color: #4CAF50;
    --error-color: #F44336;
    --warning-color: #FFC107;
    --post-color: #FF9800;
    --put-color: #2196F3;
    --delete-color: #F44336;
    --patch-color: #9C27B0;
    --transition-speed: 0.2s;
    --border-radius: 6px;
    --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

@font-face {
    font-family: 'Cascadia Code';
    src: url('https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@4.2.1/files/cascadia-code-latin-400-normal.woff2') format('woff2');
    font-display: swap;
}

body {
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Roboto', sans-serif;
    padding: 20px;
    background-color: var(--background-color);
    color: var(--text-color);
    line-height: 1.6;
    margin: 0;
    transition: background-color var(--transition-speed) ease;
    background-image: linear-gradient(to bottom right, rgba(0, 122, 204, 0.05), rgba(30, 30, 30, 0.1));
    background-attachment: fixed;
}

h1 {
    color: var(--primary-color);
    margin-bottom: 20px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 10px;
}

h1::before {
    content: '';
    display: inline-block;
    width: 24px;
    height: 24px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23007acc'%3E%3Cpath d='M17 16.5v-1.5h-5v-5h5v-1.5l3 4-3 4zm-8-1.5v1.5l-3-4 3-4v1.5h5v5h-5z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
}

.form-group {
    margin-bottom: 20px;
    position: relative;
    transition: all var(--transition-speed) ease;
    border-radius: var(--border-radius);
    padding: 2px;
}

.form-group:focus-within {
    transform: translateY(-2px);
    box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.1);
    background: linear-gradient(to right, rgba(0, 122, 204, 0.05), transparent);
}

label {
    display: block;
    margin-bottom: 8px;
    color: var(--text-secondary);
    font-weight: 500;
    font-size: 14px;
}

input, select, textarea {
    width: 100%;
    padding: 12px;
    box-sizing: border-box;
    background-color: var(--input-background);
    color: var(--text-color);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    font-size: 14px;
    transition: all var(--transition-speed) ease;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.1);
    position: relative;
    overflow: hidden;
}

input::after, select::after, textarea::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    width: 0;
    height: 2px;
    background-color: var(--primary-color);
    transition: width 0.3s ease;
}

textarea {
    font-family: 'Cascadia Code', monospace;
    resize: vertical;
    min-height: 80px;
    line-height: 1.5;
}

input:focus, select:focus, textarea:focus {
    border-color: var(--primary-color);
    outline: none;
    box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.25);
    background-color: rgba(45, 45, 45, 0.95);
}

input:focus::after, select:focus::after, textarea:focus::after {
    width: 100%;
}

button {
    padding: 12px 24px;
    background-color: var(--primary-color);
    color: white;
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: all var(--transition-speed) ease;
    margin-right: 10px;
    margin-bottom: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: var(--shadow);
    position: relative;
    overflow: hidden;
}

button::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
    transition: all 0.6s ease;
}

button:hover {
    background-color: var(--primary-hover);
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.2);
}

button:hover::before {
    left: 100%;
}

button:active {
    transform: translateY(0);
    box-shadow: var(--shadow);
}

.button-group {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 20px;
}

.button-icon {
    width: 16px;
    height: 16px;
    display: inline-block;
}

.response {
    padding: 16px;
    background-color: var(--card-background);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    white-space: pre-wrap;
    color: var(--text-color);
    max-height: 70vh;
    overflow-y: auto;
    box-shadow: var(--shadow);
    transition: all var(--transition-speed) ease;
    font-family: 'Cascadia Code', monospace;
    font-size: 14px;
    line-height: 1.5;
    background-image: linear-gradient(to bottom, rgba(0, 122, 204, 0.03), rgba(0, 0, 0, 0));
    backdrop-filter: blur(5px);
}

.response-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 16px;
    font-weight: 600;
    color: var(--primary-color);
    flex-wrap: wrap;
    gap: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--border-color);
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
    margin-top: 30px;
    background-color: var(--card-background);
    border-radius: var(--border-radius);
    padding: 20px;
    box-shadow: var(--shadow);
    border-top: 3px solid var(--primary-color);
    position: relative;
    overflow: hidden;
}

.history::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image: linear-gradient(to bottom right, rgba(0, 122, 204, 0.03), transparent);
    pointer-events: none;
}

.history h2 {
    color: var(--primary-color);
    margin-top: 0;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
}

.history h2::before {
    content: '';
    display: inline-block;
    width: 20px;
    height: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23007acc'%3E%3Cpath d='M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
}

.history-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin-bottom: 20px;
    overflow-x: auto;
    display: block;
    border-radius: var(--border-radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    scrollbar-width: thin;
    scrollbar-color: var(--primary-color) var(--card-background);
}

.history-table::-webkit-scrollbar {
    width: 8px;
    height: 8px;
}

.history-table::-webkit-scrollbar-track {
    background: var(--card-background);
    border-radius: 4px;
}

.history-table::-webkit-scrollbar-thumb {
    background-color: var(--primary-color);
    border-radius: 4px;
    border: 2px solid var(--card-background);
}

.history-table th, .history-table td {
    padding: 12px;
    text-align: left;
    white-space: nowrap;
    border-bottom: 1px solid var(--border-color);
}

.history-table th {
    background-color: var(--card-background);
    color: var(--primary-color);
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 10;
    box-shadow: 0 1px 0 var(--border-color);
    text-transform: uppercase;
    font-size: 12px;
    letter-spacing: 0.5px;
}

.history-table tr:nth-child(even) {
    background-color: rgba(37, 37, 38, 0.5);
}

.history-table tr {
    transition: all var(--transition-speed) ease;
    border-left: 2px solid transparent;
}

.history-table tr:hover {
    background-color: var(--input-background);
    border-left: 2px solid var(--primary-color);
    transform: translateX(2px);
}

.body-api {
    display: flex;
    flex-direction: column;
    gap: 24px;
}

@media (min-width: 768px) {
    .body-api {
        flex-direction: row;
    }
    
    .body-api > div {
        flex: 1;
        transition: all var(--transition-speed) ease;
    }
    
    .body-api > div:first-child {
        max-width: 40%;
    }
    
    .body-api > div:last-child {
        max-width: 58%;
    }
}

#responseOutput {
    background-color: var(--background-color);
    padding: 16px;
    border-radius: var(--border-radius);
    position: relative;
    min-height: 100px;
}

.beautify-btn {
    position: absolute;
    right: 8px;
    top: 8px;
    padding: 6px 12px;
    background-color: var(--primary-color);
    color: white;
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;
    font-size: 12px;
    opacity: 0.8;
    transition: all var(--transition-speed) ease;
    z-index: 5;
    box-shadow: var(--shadow);
}

.beautify-btn:hover {
    opacity: 1;
    transform: translateY(-2px);
}

/* Loading indicator */
.loading {
    position: relative;
}

.loading::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(30, 30, 30, 0.8);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 100;
    border-radius: var(--border-radius);
    backdrop-filter: blur(3px);
    animation: pulse 1.5s infinite alternate ease-in-out;
}

@keyframes pulse {
    0% {
        background-color: rgba(30, 30, 30, 0.8);
    }
    100% {
        background-color: rgba(30, 30, 30, 0.9);
    }
}
}

.loading::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    border: 3px solid rgba(0, 122, 204, 0.3);
    border-radius: 50%;
    border-top-color: var(--primary-color);
    animation: spin 1s linear infinite;
    z-index: 101;
}

/* Loading indicator */
.loading-indicator {
    display: none;
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1000;
    background-color: rgba(0, 0, 0, 0.6);
    padding: 30px;
    border-radius: 50%;
    backdrop-filter: blur(5px);
    box-shadow: 0 0 30px rgba(0, 122, 204, 0.2);
    border: 1px solid rgba(0, 122, 204, 0.1);
}

.loading-spinner {
    width: 60px;
    height: 60px;
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
}

.loading-spinner::before,
.loading-spinner::after {
    content: '';
    position: absolute;
    border-radius: 50%;
}

.loading-spinner::before {
    width: 100%;
    height: 100%;
    border: 3px solid transparent;
    border-top-color: var(--primary-color);
    border-bottom-color: var(--primary-color);
    animation: spin 1.5s ease-in-out infinite;
}

.loading-spinner::after {
    width: 70%;
    height: 70%;
    border: 3px solid transparent;
    border-left-color: var(--primary-color);
    border-right-color: var(--primary-color);
    animation: spin 1s ease-in-out infinite reverse;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

/* Response animation */
.response-fade-in {
    animation: fadeIn 0.5s cubic-bezier(0.26, 0.86, 0.44, 0.985);
}

@keyframes fadeIn {
    from { 
        opacity: 0; 
        transform: translateY(10px);
    }
    to { 
        opacity: 1; 
        transform: translateY(0);
    }
}

/* No items message */
.no-items-message {
    text-align: center;
    padding: 30px;
    color: var(--text-secondary);
    font-style: italic;
    background-color: rgba(45, 45, 45, 0.3);
    border-radius: var(--border-radius);
    margin: 20px 0;
    border: 1px dashed var(--border-color);
    position: relative;
    transition: all var(--transition-speed) ease;
}

.no-items-message::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23666666' opacity='0.2'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-4.42 3.58-8 8-8 4.42 0 8 3.58 8 8 0 4.42-3.58 8-8 8zm-5-9h10v2H7z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
    opacity: 0.2;
    z-index: -1;
}

/* Status code colors */
.status-success {
    color: var(--success-color);
    font-weight: 600;
}

.status-error {
    color: var(--error-color);
    font-weight: 600;
}

.status-warning {
    color: var(--warning-color);
    font-weight: 600;
}

/* Popup Modal Styles */
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
    opacity: 0;
    transition: opacity var(--transition-speed) ease;
    backdrop-filter: blur(3px);
}

.modal.show {
    opacity: 1;
}

.modal-content {
    background-color: var(--card-background);
    padding: 24px;
    border-radius: var(--border-radius);
    width: 90%;
    max-width: 800px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 15px 30px rgba(0, 0, 0, 0.4);
    transform: translateY(20px);
    transition: all var(--transition-speed) ease;
    border: 1px solid var(--border-color);
    background-image: linear-gradient(to bottom, rgba(0, 122, 204, 0.03), rgba(0, 0, 0, 0));
    position: relative;
    overflow: hidden;
}

.modal-content::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 5px;
    background: linear-gradient(to right, var(--primary-color), transparent);
}

.modal.show .modal-content {
    transform: translateY(0);
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
    margin: 0;
    color: var(--primary-color);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 10px;
}

.modal-header h2::before {
    content: '';
    display: inline-block;
    width: 20px;
    height: 20px;
    background-size: contain;
    background-repeat: no-repeat;
}

#cookieModal .modal-header h2::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23007acc'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z'/%3E%3C/svg%3E");
}

#saveRequestModal .modal-header h2::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23007acc'%3E%3Cpath d='M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z'/%3E%3C/svg%3E");
}

#loadRequestModal .modal-header h2::before {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23007acc'%3E%3Cpath d='M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z'/%3E%3C/svg%3E");
}

.modal-header button {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 24px;
    cursor: pointer;
    padding: 8px;
    transition: all var(--transition-speed) ease;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    line-height: 1;
}

.modal-header button:hover {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--text-color);
    transform: rotate(90deg);
}

.modal-body {
    color: var(--text-color);
}

.cookie-item {
    margin-bottom: 16px;
    word-break: break-all;
    padding: 16px;
    background-color: var(--input-background);
    border-radius: var(--border-radius);
    border-left: 3px solid var(--primary-color);
    transition: all var(--transition-speed) ease;
    position: relative;
    overflow: hidden;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
}

.cookie-item::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(to bottom right, rgba(0, 122, 204, 0.03), transparent);
    pointer-events: none;
}

.cookie-item:hover {
    transform: translateX(4px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    background-color: rgba(45, 45, 45, 0.95);
}

.cookie-item strong {
    color: #9cdcfe;
    display: block;
    margin-bottom: 8px;
    font-size: 14px;
    letter-spacing: 0.5px;
}

.copy-button {
    margin-top: 24px;
    padding: 12px 24px;
    background-color: var(--primary-color);
    color: white;
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;
    width: 100%;
    font-weight: 600;
    transition: all var(--transition-speed) ease;
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
}

.copy-button::before {
    content: '';
    display: inline-block;
    width: 16px;
    height: 16px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
}

.copy-button:hover {
    background-color: var(--primary-hover);
    transform: translateY(-2px);
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
}

.copy-button:active {
    transform: translateY(0);
}

.saved-request-item {
    padding: 16px;
    margin-bottom: 16px;
    background-color: var(--input-background);
    border-radius: var(--border-radius);
    cursor: pointer;
    transition: all var(--transition-speed) ease;
    border: 1px solid transparent;
    position: relative;
    overflow: hidden;
    box-shadow: var(--shadow);
}

.saved-request-item:hover {
    background-color: rgba(62, 62, 62, 0.8);
    transform: translateY(-2px);
    border-color: var(--border-color);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
}

.saved-request-item::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    width: 4px;
    background-color: var(--primary-color);
    opacity: 0.7;
    transition: width var(--transition-speed) ease;
}

.saved-request-item:hover::before {
    width: 6px;
}

.saved-request-item h3 {
    margin-top: 0;
    margin-bottom: 8px;
    color: var(--primary-color);
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
    word-break: break-word;
}

.saved-request-item p {
    margin: 8px 0;
    color: var(--text-secondary);
    word-break: break-word;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
}

.saved-request-item .method {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 8px;
    border-radius: var(--border-radius);
    font-weight: 600;
    font-size: 12px;
    margin-right: 8px;
    min-width: 50px;
    text-align: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.saved-request-item .method.get {
    background-color: var(--success-color);
    color: white;
}

.saved-request-item .method.post {
    background-color: var(--post-color);
    color: white;
}

.saved-request-item .method.put {
    background-color: var(--put-color);
    color: white;
}

.saved-request-item .method.delete {
    background-color: var(--error-color);
    color: white;
}

.saved-request-item .method.patch {
    background-color: var(--patch-color);
    color: white;
}

.saved-request-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
    gap: 8px;
}

.saved-request-actions button {
    padding: 8px 16px;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: var(--border-radius);
    transition: all var(--transition-speed) ease;
    box-shadow: var(--shadow);
}

.saved-request-actions button.load-request-btn {
    background-color: var(--primary-color);
}

.saved-request-actions button.load-request-btn::before {
    content: '';
    display: inline-block;
    width: 14px;
    height: 14px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
}

.saved-request-actions button.delete-request-btn {
    background-color: rgba(244, 67, 54, 0.8);
}

.saved-request-actions button.delete-request-btn::before {
    content: '';
    display: inline-block;
    width: 14px;
    height: 14px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
}

.saved-request-actions button:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.saved-request-actions button:active {
    transform: translateY(0);
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
        <!-- Loading indicator -->
        <div class="loading-indicator" id="loadingIndicator">
            <div class="loading-spinner"></div>
        </div>
        
        <h1>REST API Client</h1>
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
                <label for="requestName">Request Name (Optional):</label>
                <input type="text" id="requestName" placeholder="My API Request">
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
                <label for="headers">Headers (JSON):</label>
                <button id="beautifyHeaders" class="beautify-btn">Beautify</button>
                <textarea id="headers" rows="3" placeholder='{"Content-Type": "application/json", "Accept": "application/json"}'></textarea>
            </div>
            <div class="form-group">
                <label for="body">Body (JSON):</label>
                <button id="beautifyJson" class="beautify-btn">Beautify</button>
                <textarea id="body" rows="5" placeholder='{"key": "value"}'></textarea>
            </div>
            <div class="button-group">
                <button id="sendRequest">
                    <span class="button-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                        </svg>
                    </span>
                    Send Request
                </button>
                <button id="saveRequest">
                    <span class="button-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white">
                            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"></path>
                        </svg>
                    </span>
                    Save Request
                </button>
                <button id="loadRequest">
                    <span class="button-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white">
                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path>
                        </svg>
                    </span>
                    Load Request
                </button>
                <button id="showCookies">
                    <span class="button-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="white">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"></path>
                        </svg>
                    </span>
                    Show Cookies
                </button>
            </div>
            <div class="history">
                <h2>History (Last 10)</h2>
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Method</th>
                            <th>URL</th>
                            <th>Status</th>
                            <th>Duration</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody id="historyTableBody">
                        ${history
        .map((item) => `
                            <tr>
                                <td>${item.name || "Unnamed"}</td>
                                <td>${item.method}</td>
                                <td>${item.url}</td>
                                <td class="${getStatusClass(item.status)}">${item.status || "-"}</td>
                                <td>${item.duration || "-"} ms</td>
                                <td>${new Date(item.timestamp).toLocaleTimeString()}</td>
                            </tr>
                        `)
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
            <div class="response" id="responseContainer">
                <pre id="responseOutput"></pre>
            </div>
          </div>
        </div>

        <!-- Popup Modal for Cookies -->
        <div id="cookieModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class="modal-icon">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"></path>
                        </svg>
                        Stored Cookies
                    </h2>
                    <button id="closeModal" class="close-button">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
                        </svg>
                    </button>
                </div>
                <div class="modal-body" id="cookieList">
                    <!-- Cookies will be dynamically inserted here -->
                </div>
                <div class="modal-footer">
                    <button id="copyCookies" class="copy-button">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="button-icon">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path>
                        </svg>
                        Copy to Clipboard
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Popup Modal for Saving Requests -->
        <div id="saveRequestModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class="modal-icon">
                            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"></path>
                        </svg>
                        Save API Request
                    </h2>
                    <button id="closeSaveModal" class="close-button">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="saveRequestName">Request Name:</label>
                        <input type="text" id="saveRequestName" placeholder="My API Request">
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="confirmSaveRequest" class="copy-button">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" class="button-icon">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path>
                        </svg>
                        Save Request
                    </button>
                </div>
            </div>
        </div>
        
        <!-- Popup Modal for Loading Requests -->
        <div id="loadRequestModal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" class="modal-icon">
                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path>
                        </svg>
                        Load Saved API Request
                    </h2>
                    <button id="closeLoadModal" class="close-button">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path>
                        </svg>
                    </button>
                </div>
                <div class="modal-body">
                    <div id="savedRequestsList">
                        <!-- Saved requests will be dynamically inserted here -->
                    </div>
                </div>
            </div>
        </div>

        <!-- Loading Indicator -->
        <div id="loadingIndicator" class="loading-indicator">
            <div class="spinner"></div>
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
            function beautifyJson(elementId) {
                const textarea = document.getElementById(elementId);
                try {
                    const parsedJson = JSON.parse(textarea.value);
                    textarea.value = JSON.stringify(parsedJson, null, 2);
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
            
            // Function to load a saved request into the form
            function loadSavedRequest(request) {
                // Set basic fields
                document.getElementById('requestName').value = request.name || '';
                document.getElementById('method').value = request.method || 'GET';
                document.getElementById('url').value = request.url || '';
                document.getElementById('headers').value = request.headers || '';
                document.getElementById('body').value = request.body || '';
                
                // Set auth type and update fields
                document.getElementById('authType').value = request.authType || 'None';
                updateAuthFields();
                
                // Set auth fields based on type
                if (request.authType === 'Bearer' && request.authToken) {
                    setTimeout(() => {
                        const authTokenField = document.getElementById('authToken');
                        if (authTokenField) {
                            authTokenField.value = request.authToken;
                        }
                    }, 100);
                } else if (request.authType === 'Basic') {
                    setTimeout(() => {
                        const usernameField = document.getElementById('username');
                        const passwordField = document.getElementById('password');
                        if (usernameField && request.username) {
                            usernameField.value = request.username;
                        }
                        if (passwordField && request.password) {
                            passwordField.value = request.password;
                        }
                    }, 100);
                }
            }

            // Update auth fields when the authentication type changes
            document.getElementById('authType').addEventListener('change', updateAuthFields);

            // Initial call to set up auth fields
            updateAuthFields();

            // Handle Beautify JSON button clicks
            document.getElementById('beautifyJson').addEventListener('click', () => beautifyJson('body'));
            document.getElementById('beautifyHeaders').addEventListener('click', () => beautifyJson('headers'));

            // Function to show loading indicator
            function showLoading() {
                document.getElementById('loadingIndicator').style.display = 'flex';
            }
            
            // Function to hide loading indicator
            function hideLoading() {
                document.getElementById('loadingIndicator').style.display = 'none';
            }
            
            // Function to send API request
            function sendApiRequest() {
                const method = document.getElementById('method').value;
                const url = document.getElementById('url').value;
                const body = document.getElementById('body').value;
                const headers = document.getElementById('headers').value;
                const requestName = document.getElementById('requestName').value;
                const authType = document.getElementById('authType').value;
                const authToken = document.getElementById('authToken')?.value;
                const username = document.getElementById('username')?.value;
                const password = document.getElementById('password')?.value;

                if (!url) {
                    alert('Please enter a URL');
                    return;
                }
                
                // Show loading indicator
                showLoading();
                
                // Clear previous response
                document.getElementById('responseOutput').innerHTML = '';
                document.getElementById('statusCode').textContent = '-';
                document.getElementById('responseTime').textContent = '-';

                vscode.postMessage({
                    command: 'testAPI',
                    method,
                    url,
                    data: body,
                    headers,
                    requestName,
                    authType,
                    authToken,
                    username,
                    password,
                });
            }
            
            // Handle Send Request button click
            document.getElementById('sendRequest').addEventListener('click', sendApiRequest);

            // Handle Show Cookies button click
            document.getElementById('showCookies').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'getCookies',
                });
            });
            
            // Handle Save Request button click
            document.getElementById('saveRequest').addEventListener('click', () => {
                const requestName = document.getElementById('requestName').value || 'Unnamed Request';
                document.getElementById('saveRequestName').value = requestName;
                document.getElementById('saveRequestModal').style.display = 'flex';
            });
            
            // Handle Load Request button click
            document.getElementById('loadRequest').addEventListener('click', () => {
                vscode.postMessage({
                    command: 'getSavedRequests',
                });
                document.getElementById('loadRequestModal').style.display = 'flex';
            });
            
            // Handle Confirm Save Request button click
            document.getElementById('confirmSaveRequest').addEventListener('click', () => {
                const name = document.getElementById('saveRequestName').value;
                if (!name) {
                    alert('Please enter a name for this request');
                    return;
                }
                
                const method = document.getElementById('method').value;
                const url = document.getElementById('url').value;
                const headers = document.getElementById('headers').value;
                const body = document.getElementById('body').value;
                const authType = document.getElementById('authType').value;
                const authToken = document.getElementById('authToken')?.value;
                const username = document.getElementById('username')?.value;
                const password = document.getElementById('password')?.value;
                
                vscode.postMessage({
                    command: 'saveRequest',
                    request: {
                        name,
                        method,
                        url,
                        headers,
                        body,
                        authType,
                        authToken,
                        username,
                        password
                    }
                });
                
                document.getElementById('saveRequestModal').style.display = 'none';
            });

            // Handle Close Modal buttons
            document.getElementById('closeModal').addEventListener('click', () => {
                document.getElementById('cookieModal').style.display = 'none';
            });
            
            document.getElementById('closeSaveModal').addEventListener('click', () => {
                document.getElementById('saveRequestModal').style.display = 'none';
            });
            
            document.getElementById('closeLoadModal').addEventListener('click', () => {
                document.getElementById('loadRequestModal').style.display = 'none';
            });

            // Handle Copy to Clipboard button click
            document.getElementById('copyCookies').addEventListener('click', () => {
                const cookieText = document.getElementById('cookieList').innerText;
                navigator.clipboard.writeText(cookieText).then(() => {
                    alert('Cookies copied to clipboard!');
                });
            });

            // Add keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                // Ctrl+Enter or Cmd+Enter to send request
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    sendApiRequest();
                }
                
                // Escape key to close modals
                if (e.key === 'Escape') {
                    document.querySelectorAll('.modal').forEach(modal => {
                        modal.style.display = 'none';
                    });
                }
                
                // Ctrl+S or Cmd+S to save request
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    document.getElementById('saveRequest').click();
                }
                
                // Ctrl+O or Cmd+O to load request
                if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
                    e.preventDefault();
                    document.getElementById('loadRequest').click();
                }
            });

            // Listen for messages from the extension
            window.addEventListener('message', (event) => {
                const responseOutput = document.getElementById('responseOutput');
                const statusCode = document.getElementById('statusCode');
                const responseTime = document.getElementById('responseTime');
                const responseContainer = document.getElementById('responseContainer');

                if (event.data.command === 'apiResponse') {
                    // Hide loading indicator
                    hideLoading();
                    
                    // Update status with proper styling
                    statusCode.textContent = event.data.status;
                    statusCode.className = getStatusClass(event.data.status);
                    
                    // Update response time
                    responseTime.textContent = event.data.responseTime;
                    
                    // Update response output with animation
                    responseContainer.classList.add('response-fade-in');
                    responseOutput.innerHTML = syntaxHighlight(event.data.data);
                    setTimeout(() => {
                        responseContainer.classList.remove('response-fade-in');
                    }, 500);

                    // Update history table with lazy loading
                    const historyTableBody = document.getElementById('historyTableBody');
                    const fragment = document.createDocumentFragment();
                    
                    event.data.history.forEach(item => {
                        const row = document.createElement('tr');
                        row.innerHTML = \`
                            <td>\${item.name || 'Unnamed'}</td>
                            <td>\${item.method}</td>
                            <td>\${item.url}</td>
                            <td class="\${getStatusClass(item.status)}">\${item.status || '-'}</td>
                            <td>\${item.duration || '-'} ms</td>
                            <td>\${new Date(item.timestamp).toLocaleTimeString()}</td>
                        \`;
                        fragment.appendChild(row);
                    });
                    
                    historyTableBody.innerHTML = '';
                    historyTableBody.appendChild(fragment);
                } else if (event.data.command === 'apiError') {
                    // Hide loading indicator
                    hideLoading();
                    
                    // Update status with error styling
                    statusCode.textContent = event.data.status || 'Error';
                    statusCode.className = 'status-error';
                    responseTime.textContent = '-';
                    
                    let errorContent = 'Error: ' + event.data.error;
                    if (event.data.response) {
                        errorContent += '\\n\\n' + syntaxHighlight(event.data.response);
                    }
                    
                    // Update response output with animation
                    responseContainer.classList.add('response-fade-in');
                    responseOutput.innerHTML = errorContent;
                    setTimeout(() => {
                        responseContainer.classList.remove('response-fade-in');
                    }, 500);
                } else if (event.data.command === 'showCookies') {
                    const cookieList = document.getElementById('cookieList');
                    cookieList.innerHTML = '';
                    
                    if (Object.keys(event.data.cookies).length === 0) {
                        cookieList.innerHTML = '<p class="no-items-message">No cookies found.</p>';
                    } else {
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
                    }

                    document.getElementById('cookieModal').style.display = 'flex';
                } else if (event.data.command === 'showSavedRequests') {
                    const savedRequestsList = document.getElementById('savedRequestsList');
                    savedRequestsList.innerHTML = '';
                    
                    if (event.data.requests.length === 0) {
                        savedRequestsList.innerHTML = '<p class="no-items-message">No saved requests found.</p>';
                    } else {
                        const fragment = document.createDocumentFragment();
                        
                        event.data.requests.forEach((request, index) => {
                            const requestItem = document.createElement('div');
                            requestItem.className = 'saved-request-item';
                            requestItem.innerHTML = \`
                                <h3>\${request.name}</h3>
                                <p>
                                    <span class="method \${request.method.toLowerCase()}">\${request.method}</span>
                                    <span>\${request.url}</span>
                                </p>
                                <div class="saved-request-actions">
                                    <button class="load-request-btn" data-index="\${index}">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"></path>
                                        </svg>
                                        Load
                                    </button>
                                    <button class="delete-request-btn" data-index="\${index}">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5l-1-1h-5l-1 1H5v2h14V4h-3.5z"></path>
                                        </svg>
                                        Delete
                                    </button>
                                </div>
                            \`;
                            fragment.appendChild(requestItem);
                        });
                        
                        savedRequestsList.appendChild(fragment);
                        
                        // Add event listeners to all load buttons
                        document.querySelectorAll('.load-request-btn').forEach((button, idx) => {
                            button.addEventListener('click', () => {
                                loadSavedRequest(event.data.requests[idx]);
                                document.getElementById('loadRequestModal').style.display = 'none';
                            });
                        });
                        
                        // Add event listeners to all delete buttons
                        document.querySelectorAll('.delete-request-btn').forEach((button, idx) => {
                            button.addEventListener('click', () => {
                                vscode.postMessage({
                                    command: 'deleteRequest',
                                    index: idx
                                });
                            });
                        });
                    }
                }
            });
        </script>
    </body>
    </html>
    `;
    function getStatusClass(status) {
        if (!status)
            return "";
        if (status >= 200 && status < 300)
            return "status-success";
        if (status >= 400 && status < 500)
            return "status-error";
        if (status >= 500)
            return "status-error";
        return "status-warning";
    }
}
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=api-test.js.map