"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdvancedToolsCommands = void 0;
const vscode = require("vscode");
function registerAdvancedToolsCommands(context) {
    // Register Advanced Tools Hub
    const advancedToolsHubCommand = vscode.commands.registerCommand('sayaib.hue-console.advancedToolsHub', () => {
        const panel = vscode.window.createWebviewPanel('advancedToolsHub', '🧰 Advanced Developer Tools', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getAdvancedToolsHubHtml();
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'openTool':
                    vscode.commands.executeCommand(message.toolCommand);
                    break;
            }
        }, undefined, context.subscriptions);
    });
    // Register Regex Builder
    const regexBuilderCommand = vscode.commands.registerCommand('sayaib.hue-console.regexBuilder', () => {
        const panel = vscode.window.createWebviewPanel('regexBuilder', '🔍 Regex Builder & Tester', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getRegexBuilderHtml();
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'testRegex':
                    // Handle regex testing logic here
                    break;
            }
        }, undefined, context.subscriptions);
    });
    // Register JSON Formatter
    const jsonFormatterCommand = vscode.commands.registerCommand('sayaib.hue-console.jsonFormatter', () => {
        const panel = vscode.window.createWebviewPanel('jsonFormatter', '📝 JSON/XML Formatter', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getJsonFormatterHtml();
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'formatJson':
                    // Handle JSON formatting logic here
                    break;
            }
        }, undefined, context.subscriptions);
    });
    // Register Hash Generator
    const hashGeneratorCommand = vscode.commands.registerCommand('sayaib.hue-console.hashGenerator', () => {
        const panel = vscode.window.createWebviewPanel('hashGenerator', '🔐 Hash Generator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getHashGeneratorHtml();
    });
    // Register Base64 Encoder
    const base64EncoderCommand = vscode.commands.registerCommand('sayaib.hue-console.base64Encoder', () => {
        const panel = vscode.window.createWebviewPanel('base64Encoder', '🔤 Base64 Encoder/Decoder', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getBase64EncoderHtml();
    });
    // Register URL Encoder
    const urlEncoderCommand = vscode.commands.registerCommand('sayaib.hue-console.urlEncoder', () => {
        const panel = vscode.window.createWebviewPanel('urlEncoder', '🔗 URL Encoder/Decoder', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getUrlEncoderHtml();
    });
    // Register Timestamp Converter
    const timestampConverterCommand = vscode.commands.registerCommand('sayaib.hue-console.timestampConverter', () => {
        const panel = vscode.window.createWebviewPanel('timestampConverter', '⏰ Timestamp Converter', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getTimestampConverterHtml();
    });
    // Add all commands to subscriptions
    context.subscriptions.push(advancedToolsHubCommand, regexBuilderCommand, jsonFormatterCommand, hashGeneratorCommand, base64EncoderCommand, urlEncoderCommand, timestampConverterCommand);
}
exports.registerAdvancedToolsCommands = registerAdvancedToolsCommands;
function getAdvancedToolsHubHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Advanced Developer Tools</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    margin: 0;
                    padding: 20px;
                }
                .container {
                    max-width: 1000px;
                    margin: 0 auto;
                }
                .tools-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 20px;
                    margin-top: 20px;
                }
                .tool-card {
                    background: var(--vscode-sideBar-background);
                    border: 1px solid var(--vscode-sideBar-border);
                    border-radius: 8px;
                    padding: 20px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .tool-card:hover {
                    background: var(--vscode-list-hoverBackground);
                    transform: translateY(-2px);
                }
                .tool-icon {
                    font-size: 2em;
                    margin-bottom: 10px;
                }
                .tool-title {
                    font-size: 1.2em;
                    font-weight: bold;
                    margin-bottom: 8px;
                }
                .tool-description {
                    color: var(--vscode-descriptionForeground);
                    font-size: 0.9em;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🧰 Advanced Developer Tools</h1>
                <p>A comprehensive suite of developer utilities to boost your productivity.</p>
                
                <div class="tools-grid">
                    <div class="tool-card" onclick="openTool('sayaib.hue-console.regexBuilder')">
                        <div class="tool-icon">🔍</div>
                        <div class="tool-title">Regex Builder & Tester</div>
                        <div class="tool-description">Build and test regular expressions with real-time matching and explanations.</div>
                    </div>
                    
                    <div class="tool-card" onclick="openTool('sayaib.hue-console.jsonFormatter')">
                        <div class="tool-icon">📝</div>
                        <div class="tool-title">JSON/XML Formatter</div>
                        <div class="tool-description">Format, validate, and minify JSON and XML documents with syntax highlighting.</div>
                    </div>
                    
                    <div class="tool-card" onclick="openTool('sayaib.hue-console.hashGenerator')">
                        <div class="tool-icon">🔐</div>
                        <div class="tool-title">Hash Generator</div>
                        <div class="tool-description">Generate MD5, SHA-1, SHA-256, and other cryptographic hashes.</div>
                    </div>
                    
                    <div class="tool-card" onclick="openTool('sayaib.hue-console.base64Encoder')">
                        <div class="tool-icon">🔤</div>
                        <div class="tool-title">Base64 Encoder/Decoder</div>
                        <div class="tool-description">Encode and decode Base64 strings with support for files and text.</div>
                    </div>
                    
                    <div class="tool-card" onclick="openTool('sayaib.hue-console.urlEncoder')">
                        <div class="tool-icon">🔗</div>
                        <div class="tool-title">URL Encoder/Decoder</div>
                        <div class="tool-description">Encode and decode URLs with support for query parameters.</div>
                    </div>
                    
                    <div class="tool-card" onclick="openTool('sayaib.hue-console.timestampConverter')">
                        <div class="tool-icon">⏰</div>
                        <div class="tool-title">Timestamp Converter</div>
                        <div class="tool-description">Convert between Unix timestamps and human-readable dates.</div>
                    </div>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                function openTool(toolCommand) {
                    vscode.postMessage({
                        command: 'openTool',
                        toolCommand: toolCommand
                    });
                }
            </script>
        </body>
        </html>
    `;
}
function getRegexBuilderHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Regex Builder & Tester</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                .input-group { margin-bottom: 15px; }
                label { display: block; margin-bottom: 5px; font-weight: bold; }
                input, textarea { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; margin-right: 10px; }
                .output { margin-top: 20px; padding: 10px; background: var(--vscode-textCodeBlock-background); border-radius: 3px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔍 Regex Builder & Tester</h1>
                <div class="input-group">
                    <label for="pattern">Regular Expression Pattern:</label>
                    <input type="text" id="pattern" placeholder="Enter your regex pattern...">
                </div>
                <div class="input-group">
                    <label for="testString">Test String:</label>
                    <textarea id="testString" placeholder="Enter text to test against..."></textarea>
                </div>
                <button onclick="testRegex()">Test Regex</button>
                <button onclick="clearAll()">Clear</button>
                <div id="output" class="output"></div>
            </div>
            <script>
                function testRegex() {
                    const pattern = document.getElementById('pattern').value;
                    const testString = document.getElementById('testString').value;
                    const output = document.getElementById('output');
                    
                    try {
                        const regex = new RegExp(pattern, 'g');
                        const matches = [...testString.matchAll(regex)];
                        
                        if (matches.length > 0) {
                            output.innerHTML = '<h3>Matches found:</h3>' + matches.map((match, i) => 
                                '<div><strong>Match ' + (i+1) + ':</strong> "' + match[0] + '" at position ' + match.index + '</div>'
                            ).join('');
                        } else {
                            output.innerHTML = '<h3>No matches found</h3>';
                        }
                    } catch (e) {
                        output.innerHTML = '<h3>Error:</h3><div style="color: var(--vscode-errorForeground);">' + e.message + '</div>';
                    }
                }
                
                function clearAll() {
                    document.getElementById('pattern').value = '';
                    document.getElementById('testString').value = '';
                    document.getElementById('output').innerHTML = '';
                }
            </script>
        </body>
        </html>
    `;
}
function getJsonFormatterHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>JSON/XML Formatter</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
                .container { max-width: 1000px; margin: 0 auto; }
                .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                textarea { width: 100%; height: 300px; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; font-family: monospace; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; margin: 5px; }
                .controls { text-align: center; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📝 JSON/XML Formatter</h1>
                <div class="controls">
                    <button onclick="formatJson()">Format JSON</button>
                    <button onclick="minifyJson()">Minify JSON</button>
                    <button onclick="validateJson()">Validate</button>
                    <button onclick="clearAll()">Clear</button>
                </div>
                <div class="panels">
                    <div>
                        <h3>Input</h3>
                        <textarea id="input" placeholder="Paste your JSON or XML here..."></textarea>
                    </div>
                    <div>
                        <h3>Output</h3>
                        <textarea id="output" readonly></textarea>
                    </div>
                </div>
            </div>
            <script>
                function formatJson() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        const parsed = JSON.parse(input);
                        output.value = JSON.stringify(parsed, null, 2);
                    } catch (e) {
                        output.value = 'Error: ' + e.message;
                    }
                }
                
                function minifyJson() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        const parsed = JSON.parse(input);
                        output.value = JSON.stringify(parsed);
                    } catch (e) {
                        output.value = 'Error: ' + e.message;
                    }
                }
                
                function validateJson() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        JSON.parse(input);
                        output.value = '✅ Valid JSON';
                    } catch (e) {
                        output.value = '❌ Invalid JSON: ' + e.message;
                    }
                }
                
                function clearAll() {
                    document.getElementById('input').value = '';
                    document.getElementById('output').value = '';
                }
            </script>
        </body>
        </html>
    `;
}
function getHashGeneratorHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Hash Generator</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                textarea, input { width: 100%; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; margin: 10px 0; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; margin: 5px; }
                .hash-result { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 3px; margin: 10px 0; font-family: monospace; word-break: break-all; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔐 Hash Generator</h1>
                <div>
                    <label>Input Text:</label>
                    <textarea id="inputText" placeholder="Enter text to hash..."></textarea>
                </div>
                <div>
                    <button onclick="generateHash('MD5')">MD5</button>
                    <button onclick="generateHash('SHA-1')">SHA-1</button>
                    <button onclick="generateHash('SHA-256')">SHA-256</button>
                    <button onclick="clearAll()">Clear</button>
                </div>
                <div id="results"></div>
            </div>
            <script>
                async function generateHash(algorithm) {
                    const text = document.getElementById('inputText').value;
                    if (!text) return;
                    
                    const encoder = new TextEncoder();
                    const data = encoder.encode(text);
                    
                    let hashBuffer;
                    if (algorithm === 'MD5') {
                        // Note: MD5 is not available in Web Crypto API, showing placeholder
                        document.getElementById('results').innerHTML += '<div class="hash-result"><strong>MD5:</strong> (MD5 not available in browser)</div>';
                        return;
                    }
                    
                    const algoMap = {
                        'SHA-1': 'SHA-1',
                        'SHA-256': 'SHA-256'
                    };
                    
                    try {
                        hashBuffer = await crypto.subtle.digest(algoMap[algorithm], data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        
                        document.getElementById('results').innerHTML += '<div class="hash-result"><strong>' + algorithm + ':</strong> ' + hashHex + '</div>';
                    } catch (e) {
                        document.getElementById('results').innerHTML += '<div class="hash-result">Error generating ' + algorithm + ' hash</div>';
                    }
                }
                
                function clearAll() {
                    document.getElementById('inputText').value = '';
                    document.getElementById('results').innerHTML = '';
                }
            </script>
        </body>
        </html>
    `;
}
function getBase64EncoderHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Base64 Encoder/Decoder</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                textarea { width: 100%; height: 200px; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; margin: 5px; }
                .controls { text-align: center; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔤 Base64 Encoder/Decoder</h1>
                <div class="controls">
                    <button onclick="encode()">Encode to Base64</button>
                    <button onclick="decode()">Decode from Base64</button>
                    <button onclick="clearAll()">Clear</button>
                </div>
                <div class="panels">
                    <div>
                        <h3>Input</h3>
                        <textarea id="input" placeholder="Enter text to encode/decode..."></textarea>
                    </div>
                    <div>
                        <h3>Output</h3>
                        <textarea id="output" readonly></textarea>
                    </div>
                </div>
            </div>
            <script>
                function encode() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        output.value = btoa(input);
                    } catch (e) {
                        output.value = 'Error encoding: ' + e.message;
                    }
                }
                
                function decode() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        output.value = atob(input);
                    } catch (e) {
                        output.value = 'Error decoding: ' + e.message;
                    }
                }
                
                function clearAll() {
                    document.getElementById('input').value = '';
                    document.getElementById('output').value = '';
                }
            </script>
        </body>
        </html>
    `;
}
function getUrlEncoderHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>URL Encoder/Decoder</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                textarea { width: 100%; height: 200px; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; margin: 5px; }
                .controls { text-align: center; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🔗 URL Encoder/Decoder</h1>
                <div class="controls">
                    <button onclick="encodeUrl()">Encode URL</button>
                    <button onclick="decodeUrl()">Decode URL</button>
                    <button onclick="clearAll()">Clear</button>
                </div>
                <div class="panels">
                    <div>
                        <h3>Input</h3>
                        <textarea id="input" placeholder="Enter URL to encode/decode..."></textarea>
                    </div>
                    <div>
                        <h3>Output</h3>
                        <textarea id="output" readonly></textarea>
                    </div>
                </div>
            </div>
            <script>
                function encodeUrl() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        output.value = encodeURIComponent(input);
                    } catch (e) {
                        output.value = 'Error encoding: ' + e.message;
                    }
                }
                
                function decodeUrl() {
                    const input = document.getElementById('input').value;
                    const output = document.getElementById('output');
                    try {
                        output.value = decodeURIComponent(input);
                    } catch (e) {
                        output.value = 'Error decoding: ' + e.message;
                    }
                }
                
                function clearAll() {
                    document.getElementById('input').value = '';
                    document.getElementById('output').value = '';
                }
            </script>
        </body>
        </html>
    `;
}
function getTimestampConverterHtml() {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Timestamp Converter</title>
            <style>
                body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
                .container { max-width: 800px; margin: 0 auto; }
                .converter-section { background: var(--vscode-sideBar-background); padding: 20px; border-radius: 8px; margin: 20px 0; }
                input { width: 100%; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; margin: 10px 0; }
                button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; border-radius: 3px; cursor: pointer; margin: 5px; }
                .result { background: var(--vscode-textCodeBlock-background); padding: 10px; border-radius: 3px; margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>⏰ Timestamp Converter</h1>
                
                <div class="converter-section">
                    <h3>Unix Timestamp to Date</h3>
                    <input type="number" id="unixInput" placeholder="Enter Unix timestamp...">
                    <button onclick="convertFromUnix()">Convert to Date</button>
                    <div id="unixResult" class="result"></div>
                </div>
                
                <div class="converter-section">
                    <h3>Date to Unix Timestamp</h3>
                    <input type="datetime-local" id="dateInput">
                    <button onclick="convertToUnix()">Convert to Unix</button>
                    <div id="dateResult" class="result"></div>
                </div>
                
                <div class="converter-section">
                    <h3>Current Timestamp</h3>
                    <button onclick="getCurrentTimestamp()">Get Current Timestamp</button>
                    <div id="currentResult" class="result"></div>
                </div>
            </div>
            <script>
                function convertFromUnix() {
                    const timestamp = document.getElementById('unixInput').value;
                    const result = document.getElementById('unixResult');
                    
                    if (!timestamp) {
                        result.innerHTML = 'Please enter a timestamp';
                        return;
                    }
                    
                    const date = new Date(parseInt(timestamp) * 1000);
                    result.innerHTML = 
                        '<strong>Date:</strong> ' + date.toLocaleString() + '<br>' +
                        '<strong>ISO:</strong> ' + date.toISOString() + '<br>' +
                        '<strong>UTC:</strong> ' + date.toUTCString();
                }
                
                function convertToUnix() {
                    const dateInput = document.getElementById('dateInput').value;
                    const result = document.getElementById('dateResult');
                    
                    if (!dateInput) {
                        result.innerHTML = 'Please select a date';
                        return;
                    }
                    
                    const timestamp = Math.floor(new Date(dateInput).getTime() / 1000);
                    result.innerHTML = 
                        '<strong>Unix Timestamp:</strong> ' + timestamp + '<br>' +
                        '<strong>Milliseconds:</strong> ' + (timestamp * 1000);
                }
                
                function getCurrentTimestamp() {
                    const now = new Date();
                    const timestamp = Math.floor(now.getTime() / 1000);
                    const result = document.getElementById('currentResult');
                    
                    result.innerHTML = 
                        '<strong>Current Date:</strong> ' + now.toLocaleString() + '<br>' +
                        '<strong>Unix Timestamp:</strong> ' + timestamp + '<br>' +
                        '<strong>Milliseconds:</strong> ' + now.getTime() + '<br>' +
                        '<strong>ISO:</strong> ' + now.toISOString();
                }
                
                // Set current date as default
                document.getElementById('dateInput').value = new Date().toISOString().slice(0, 16);
            </script>
        </body>
        </html>
    `;
}
//# sourceMappingURL=advancedTools.js.map