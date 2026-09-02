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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdvancedToolsCommands = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
function getNonce() {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
const SHARED_CSS = `
:root {
    --bg-0: var(--vscode-editor-background);
    --bg-1: var(--vscode-sideBar-background);
    --bg-2: var(--vscode-input-background);
    --bg-3: var(--vscode-textCodeBlock-background);
    --fg-0: var(--vscode-editor-foreground);
    --fg-1: var(--vscode-descriptionForeground);
    --fg-2: var(--vscode-disabledForeground);
    --border: var(--vscode-input-border);
    --border-focus: var(--vscode-focusBorder);
    --accent: var(--vscode-button-background);
    --accent-fg: var(--vscode-button-foreground);
    --success: #4caf50;
    --success-bg: rgba(76, 175, 80, 0.15);
    --error: #f44336;
    --error-bg: rgba(244, 67, 54, 0.15);
    --warning: #ff9800;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --shadow: 0 2px 8px rgba(0,0,0,0.3);
    --transition: 0.2s ease;
    --mono: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--sans);
    background: var(--bg-0);
    color: var(--fg-0);
    line-height: 1.5;
    padding: 0;
    overflow-x: hidden;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--fg-2); border-radius: 3px; }

.tool-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 24px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
}
.tool-header h1 { font-size: 16px; font-weight: 700; white-space: nowrap; }
.tool-header .subtitle { font-size: 12px; color: var(--fg-1); }

.tool-body { padding: 20px 24px; max-width: 1100px; margin: 0 auto; }

.section {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 20px;
    margin-bottom: 16px;
}
.section-title {
    font-size: 13px; font-weight: 700;
    color: var(--fg-1);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 14px;
}

label {
    display: block;
    font-size: 12px; font-weight: 600;
    color: var(--fg-1);
    margin-bottom: 4px;
}
.input, input[type="text"], input[type="number"] {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    transition: border-color var(--transition);
}
.input:focus, input:focus, textarea:focus, select:focus {
    border-color: var(--border-focus);
}
textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--mono);
    font-size: 13px;
    resize: vertical;
    outline: none;
    transition: border-color var(--transition);
}
select {
    padding: 8px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    outline: none;
}

.btn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px;
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px; font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
}
.btn:hover { opacity: 0.85; }
.btn:active { transform: scale(0.97); }
.btn-secondary {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
}
.btn-ghost {
    background: transparent;
    color: var(--fg-1);
    border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-2); }
.btn-success { background: var(--success); color: #fff; }
.btn-danger { background: var(--error); color: #fff; }
.btn-sm { padding: 4px 10px; font-size: 11px; }

.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 768px) { .panels { grid-template-columns: 1fr; } }

.panel-label {
    font-size: 11px; font-weight: 700;
    color: var(--fg-1);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}

.result-block {
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-family: var(--mono);
    font-size: 13px;
    word-break: break-all;
    line-height: 1.6;
}

.toast-container {
    position: fixed; bottom: 16px; right: 16px;
    z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
    pointer-events: none;
}
.toast {
    padding: 10px 16px;
    border-radius: var(--radius-md);
    font-size: 12px; font-weight: 600;
    color: #fff;
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: auto;
    box-shadow: var(--shadow);
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.success { background: var(--success); }
.toast.error { background: var(--error); }
`;
function toastScript() {
    return `
        function _toast(msg, type) {
            var c = document.querySelector('.toast-container');
            if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
            var t = document.createElement('div');
            t.className = 'toast ' + (type || 'success');
            t.textContent = msg;
            c.appendChild(t);
            requestAnimationFrame(function() { requestAnimationFrame(function() { t.classList.add('show'); }); });
            setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 300); }, 2000);
        }
    `;
}
function copyScript(targetId) {
    return `
        document.getElementById('${targetId}').addEventListener('click', function() {
            var el = document.getElementById('${targetId.replace('Copy', 'Output')}' || '${targetId.replace('Copy', 'Result')}');
            var text = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
            if (!text || !text.trim()) { _toast('Nothing to copy', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() {
                _toast('Copied!', 'success');
            }).catch(function() {
                var tmp = document.createElement('textarea');
                tmp.value = text;
                document.body.appendChild(tmp);
                tmp.select();
                document.execCommand('copy');
                document.body.removeChild(tmp);
                _toast('Copied!', 'success');
            });
        });
    `;
}
function registerAdvancedToolsCommands(context) {
    const advancedToolsHubCommand = vscode.commands.registerCommand('sayaib.hue-console.advancedToolsHub', () => {
        const panel = vscode.window.createWebviewPanel('advancedToolsHub', 'DevSnip Pro - Developer Tools', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getAdvancedToolsHubHtml();
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'openTool':
                    vscode.commands.executeCommand(message.toolCommand);
                    break;
            }
        }, undefined, context.subscriptions);
    });
    const regexBuilderCommand = vscode.commands.registerCommand('sayaib.hue-console.regexBuilder', () => {
        const panel = vscode.window.createWebviewPanel('regexBuilder', 'Regex Builder & Tester', vscode.ViewColumn.One, { enableScripts: true });
        const nonce = getNonce();
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'regex-builder.js')));
        panel.webview.html = getRegexBuilderHtml(panel.webview.cspSource, String(scriptUri), nonce);
    });
    const jsonFormatterCommand = vscode.commands.registerCommand('sayaib.hue-console.jsonFormatter', () => {
        const panel = vscode.window.createWebviewPanel('jsonFormatter', 'JSON/XML Formatter', vscode.ViewColumn.One, { enableScripts: true });
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'json-xml-formatter.js')));
        panel.webview.html = getJsonFormatterHtml(panel.webview.cspSource, String(scriptUri));
        const editor = vscode.window.activeTextEditor;
        const text = editor ? editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection) : '';
        if (text) {
            panel.webview.postMessage({ command: 'prefill', text });
        }
    });
    const hashGeneratorCommand = vscode.commands.registerCommand('sayaib.hue-console.hashGenerator', () => {
        const panel = vscode.window.createWebviewPanel('hashGenerator', 'Hash Generator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getHashGeneratorHtml(panel.webview.cspSource, getNonce());
    });
    const base64EncoderCommand = vscode.commands.registerCommand('sayaib.hue-console.base64Encoder', () => {
        const panel = vscode.window.createWebviewPanel('base64Encoder', 'Base64 Encoder/Decoder', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getBase64EncoderHtml(panel.webview.cspSource, getNonce());
    });
    const urlEncoderCommand = vscode.commands.registerCommand('sayaib.hue-console.urlEncoder', () => {
        const panel = vscode.window.createWebviewPanel('urlEncoder', 'URL Encoder/Decoder', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getUrlEncoderHtml(panel.webview.cspSource, getNonce());
    });
    const timestampConverterCommand = vscode.commands.registerCommand('sayaib.hue-console.timestampConverter', () => {
        const panel = vscode.window.createWebviewPanel('timestampConverter', 'Timestamp Converter', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getTimestampConverterHtml(panel.webview.cspSource, getNonce());
    });
    const jsonToToonCommand = vscode.commands.registerCommand('sayaib.hue-console.jsonToToon', () => {
        const panel = vscode.window.createWebviewPanel('jsonToToon', 'JSON \u2192 TOON Converter', vscode.ViewColumn.One, { enableScripts: true });
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'json-to-toon.js')));
        panel.webview.html = getJsonToToonHtml(panel.webview.cspSource, String(scriptUri));
    });
    const colorPaletteCommand = vscode.commands.registerCommand('sayaib.hue-console.colorPalette', () => {
        const panel = vscode.window.createWebviewPanel('colorPalette', 'Color Palette', vscode.ViewColumn.One, { enableScripts: true });
        const nonce = getNonce();
        panel.webview.html = getColorPaletteHtml(panel.webview.cspSource, nonce);
    });
    const loremGeneratorCommand = vscode.commands.registerCommand('sayaib.hue-console.loremGenerator', () => {
        const panel = vscode.window.createWebviewPanel('loremGenerator', 'Lorem Ipsum Generator', vscode.ViewColumn.One, { enableScripts: true });
        const nonce = getNonce();
        panel.webview.html = getLoremGeneratorHtml(panel.webview.cspSource, nonce);
    });
    context.subscriptions.push(advancedToolsHubCommand, regexBuilderCommand, jsonFormatterCommand, hashGeneratorCommand, base64EncoderCommand, urlEncoderCommand, timestampConverterCommand, jsonToToonCommand, colorPaletteCommand, loremGeneratorCommand);
}
exports.registerAdvancedToolsCommands = registerAdvancedToolsCommands;
function getAdvancedToolsHubHtml() {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Developer Tools</title>
    <style>
        ${SHARED_CSS}
        .hub-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 14px;
        }
        .hub-card {
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 20px;
            cursor: pointer;
            transition: all var(--transition);
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .hub-card:hover {
            border-color: var(--border-focus);
            background: var(--bg-2);
            transform: translateY(-2px);
            box-shadow: var(--shadow);
        }
        .hub-card-icon {
            font-size: 24px;
            width: 44px; height: 44px;
            display: flex; align-items: center; justify-content: center;
            background: var(--bg-2);
            border-radius: var(--radius-md);
        }
        .hub-card-title {
            font-size: 14px;
            font-weight: 700;
        }
        .hub-card-desc {
            font-size: 12px;
            color: var(--fg-1);
            line-height: 1.5;
        }
        .hub-card-tag {
            display: inline-block;
            font-size: 10px;
            font-weight: 600;
            color: var(--accent);
            background: rgba(0, 122, 204, 0.1);
            padding: 2px 8px;
            border-radius: 10px;
            align-self: flex-start;
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Developer Tools</h1>
        <span class="subtitle">10 built-in utilities for everyday tasks</span>
    </div>
    <div class="tool-body">
        <div class="hub-grid" id="grid"></div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}
        var tools = [
            { cmd: 'sayaib.hue-console.regexBuilder', icon: '\\u{1F50D}', title: 'Regex Builder & Tester', desc: 'Build, test, and debug regular expressions with real-time match visualization.', tag: 'Pattern' },
            { cmd: 'sayaib.hue-console.jsonFormatter', icon: '\\u{1F4DD}', title: 'JSON/XML Formatter', desc: 'Format, minify, validate, and syntax-highlight JSON and XML documents.', tag: 'Data' },
            { cmd: 'sayaib.hue-console.hashGenerator', icon: '\\u{1F510}', title: 'Hash Generator', desc: 'Generate SHA-1, SHA-256, SHA-384, and SHA-512 cryptographic hashes.', tag: 'Security' },
            { cmd: 'sayaib.hue-console.base64Encoder', icon: '\\u{1F524}', title: 'Base64 Encoder/Decoder', desc: 'Encode and decode Base64 strings with full UTF-8 Unicode support.', tag: 'Encoding' },
            { cmd: 'sayaib.hue-console.urlEncoder', icon: '\\u{1F517}', title: 'URL Encoder/Decoder', desc: 'Encode and decode URL components and full URLs with reference guide.', tag: 'Encoding' },
            { cmd: 'sayaib.hue-console.timestampConverter', icon: '\\u{23F0}', title: 'Timestamp Converter', desc: 'Convert between Unix timestamps and human-readable dates. Auto-detects seconds vs milliseconds.', tag: 'Time' },
            { cmd: 'sayaib.hue-console.jsonToToon', icon: '\\u{1F3AD}', title: 'JSON \\u2192 TOON', desc: 'Convert JSON into Tree Outline notation for quick, readable data reviews.', tag: 'Data' },
            { cmd: 'sayaib.hue-console.colorPalette', icon: '\\u{1F3A8}', title: 'Color Palette', desc: 'Pick colors, generate shade palettes, and check WCAG contrast accessibility ratios.', tag: 'Design' },
            { cmd: 'sayaib.hue-console.loremGenerator', icon: '\\u{1F4C4}', title: 'Lorem Ipsum Generator', desc: 'Generate placeholder text with configurable words, sentences, and paragraphs.', tag: 'Content' }
        ];
        var grid = document.getElementById('grid');
        tools.forEach(function(t) {
            var card = document.createElement('div');
            card.className = 'hub-card';
            card.setAttribute('data-command', t.cmd);
            card.innerHTML = '<div class="hub-card-icon">' + t.icon + '</div>' +
                '<div class="hub-card-title">' + t.title + '</div>' +
                '<div class="hub-card-desc">' + t.desc + '</div>' +
                '<span class="hub-card-tag">' + t.tag + '</span>';
            card.addEventListener('click', function() {
                var vscode = acquireVsCodeApi();
                vscode.postMessage({ command: 'openTool', toolCommand: t.cmd });
            });
            grid.appendChild(card);
        });
    </script>
</body>
</html>`;
}
function getRegexBuilderHtml(cspSource, scriptSrc, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Regex Builder & Tester</title>
    <style>
        ${SHARED_CSS}
        .pattern-row { display: grid; grid-template-columns: 1fr 140px; gap: 12px; align-items: end; }
        .match-highlight { background: rgba(255, 213, 0, 0.3); border-bottom: 2px solid var(--warning); }
        .group-label { font-size: 11px; color: var(--fg-2); margin-top: 4px; }
        @media (max-width: 768px) { .pattern-row { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Regex Builder & Tester</h1>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="pattern-row" style="margin-bottom: 14px;">
                <div>
                    <label>Pattern</label>
                    <input type="text" id="pattern" placeholder="Enter regex pattern (no slashes)...">
                </div>
                <div>
                    <label>Flags</label>
                    <input type="text" id="flags" value="g" placeholder="gim">
                </div>
            </div>
            <div style="margin-bottom: 14px;">
                <label>Test String</label>
                <textarea id="testString" rows="6" placeholder="Enter text to test against..."></textarea>
            </div>
            <div class="btn-row">
                <button class="btn" id="testBtn">Test Regex</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div id="output" class="result-block" style="display:none;"></div>
    </div>
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}
function getJsonFormatterHtml(cspSource, scriptSrc) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSON/XML Formatter</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>JSON/XML Formatter</h1>
    </div>
    <div class="tool-body">
        <div class="section" style="margin-bottom: 12px;">
            <div class="btn-row">
                <button class="btn" id="formatJsonBtn">Format JSON</button>
                <button class="btn btn-secondary" id="minifyJsonBtn">Minify JSON</button>
                <button class="btn btn-secondary" id="formatXmlBtn">Format XML</button>
                <button class="btn btn-secondary" id="minifyXmlBtn">Minify XML</button>
                <span style="width:1px;height:24px;background:var(--border);"></span>
                <button class="btn btn-ghost" id="validateJsonBtn">Validate JSON</button>
                <button class="btn btn-ghost" id="validateXmlBtn">Validate XML</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Output</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="panels">
            <div>
                <div class="panel-label">Input</div>
                <textarea id="input" rows="18" placeholder="Paste JSON or XML here..."></textarea>
            </div>
            <div>
                <div class="panel-label">Output</div>
                <textarea id="output" rows="18" readonly placeholder="Formatted output will appear here..."></textarea>
            </div>
        </div>
    </div>
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}
function getHashGeneratorHtml(cspSource, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hash Generator</title>
    <style>
        ${SHARED_CSS}
        .hash-item {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 12px 14px;
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            margin-bottom: 8px;
        }
        .hash-label {
            font-size: 11px; font-weight: 700;
            color: var(--accent);
            min-width: 70px;
            padding-top: 2px;
        }
        .hash-value {
            font-family: var(--mono);
            font-size: 12px;
            word-break: break-all;
            flex: 1;
            line-height: 1.5;
        }
        .hash-copy {
            background: none; border: none; cursor: pointer;
            color: var(--fg-1); font-size: 14px; padding: 2px 6px;
            border-radius: var(--radius-sm);
            transition: all var(--transition);
            flex-shrink: 0;
        }
        .hash-copy:hover { background: var(--bg-2); color: var(--fg-0); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Hash Generator</h1>
        <span class="subtitle">SHA-1, SHA-256, SHA-384, SHA-512</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Input Text</label>
            <textarea id="inputText" rows="4" placeholder="Enter text to hash..."></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="hashGenerateBtn">Generate All Hashes</button>
                <button class="btn btn-ghost" id="hashClearBtn">Clear</button>
            </div>
        </div>
        <div id="results"></div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var algorithms = [
            { name: 'SHA-1',   algo: 'SHA-1' },
            { name: 'SHA-256', algo: 'SHA-256' },
            { name: 'SHA-384', algo: 'SHA-384' },
            { name: 'SHA-512', algo: 'SHA-512' }
        ];

        async function generateAll() {
            var text = document.getElementById('inputText').value;
            if (!text) { _toast('Enter some text first', 'error'); return; }
            var encoder = new TextEncoder();
            var data = encoder.encode(text);
            var container = document.getElementById('results');
            container.innerHTML = '';
            for (var i = 0; i < algorithms.length; i++) {
                var a = algorithms[i];
                try {
                    var buf = await crypto.subtle.digest(a.algo, data);
                    var hex = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                    var item = document.createElement('div');
                    item.className = 'hash-item';
                    var hashId = 'hash_' + i;
                    item.innerHTML = '<div class="hash-label">' + a.name + '</div>' +
                        '<div class="hash-value" id="' + hashId + '">' + hex + '</div>' +
                        '<button class="hash-copy" title="Copy" data-copy="' + hashId + '">&#x2398;</button>';
                    item.querySelector('.hash-copy').addEventListener('click', function() {
                        _copyHash(this.getAttribute('data-copy'));
                    });
                    container.appendChild(item);
                } catch (e) {
                    var err = document.createElement('div');
                    err.className = 'hash-item';
                    err.innerHTML = '<div class="hash-label">' + a.name + '</div><div class="hash-value" style="color:var(--error);">Error: ' + e.message + '</div>';
                    container.appendChild(err);
                }
            }
            _toast('Hashes generated', 'success');
        }

        function _copyHash(id) {
            var el = document.getElementById(id);
            if (!el) return;
            navigator.clipboard.writeText(el.textContent).then(function() {
                _toast('Copied!', 'success');
            }).catch(function() {
                _toast('Copy failed', 'error');
            });
        }

        function clearAll() {
            document.getElementById('inputText').value = '';
            document.getElementById('results').innerHTML = '';
        }

        document.getElementById('hashGenerateBtn').addEventListener('click', generateAll);
        document.getElementById('hashClearBtn').addEventListener('click', clearAll);
    </script>
</body>
</html>`;
}
function getBase64EncoderHtml(cspSource, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Base64 Encoder/Decoder</title>
    <style>
        ${SHARED_CSS}
        .mode-toggle {
            display: inline-flex;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            overflow: hidden;
            margin-bottom: 14px;
        }
        .mode-toggle button {
            padding: 6px 14px;
            background: transparent;
            color: var(--fg-1);
            border: none;
            font-size: 12px; font-weight: 600;
            cursor: pointer;
            transition: all var(--transition);
        }
        .mode-toggle button.active {
            background: var(--accent);
            color: var(--accent-fg);
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Base64 Encoder/Decoder</h1>
        <span class="subtitle">Full UTF-8 support</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="btn-row">
                <button class="btn" id="encodeBtn">Encode</button>
                <button class="btn btn-secondary" id="decodeBtn">Decode</button>
                <button class="btn btn-ghost" id="swapBtn">&#x21C4; Swap</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
                <span style="flex:1;"></span>
                <button class="btn btn-ghost" id="copyBtn">Copy Output</button>
            </div>
        </div>
        <div class="panels">
            <div>
                <div class="panel-label">Input</div>
                <textarea id="input" rows="14" placeholder="Enter text to encode or decode..."></textarea>
            </div>
            <div>
                <div class="panel-label">Output</div>
                <textarea id="output" rows="14" readonly placeholder="Result will appear here..."></textarea>
            </div>
        </div>
        <div class="section" style="margin-top: 12px; padding: 14px;">
            <div style="font-size: 12px; color: var(--fg-1); line-height: 1.6;">
                <strong style="color: var(--fg-0);">Note:</strong> Uses <code style="background:var(--bg-3);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:11px;">btoa(unescape(encodeURIComponent(text)))</code> for encoding to properly handle Unicode characters (Chinese, emoji, accented letters, etc.).
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function encodeUtf8(str) {
            return btoa(unescape(encodeURIComponent(str)));
        }

        function decodeUtf8(str) {
            return decodeURIComponent(escape(atob(str)));
        }

        function doEncode() {
            var input = document.getElementById('input').value;
            if (!input) { _toast('Enter text to encode', 'error'); return; }
            try {
                document.getElementById('output').value = encodeUtf8(input);
                _toast('Encoded', 'success');
            } catch (e) {
                document.getElementById('output').value = 'Error: ' + e.message;
                _toast('Encoding failed', 'error');
            }
        }

        function doDecode() {
            var input = document.getElementById('input').value;
            if (!input) { _toast('Enter Base64 to decode', 'error'); return; }
            try {
                document.getElementById('output').value = decodeUtf8(input);
                _toast('Decoded', 'success');
            } catch (e) {
                document.getElementById('output').value = 'Error: ' + e.message;
                _toast('Invalid Base64', 'error');
            }
        }

        function doSwap() {
            var output = document.getElementById('output').value;
            document.getElementById('input').value = output;
            document.getElementById('output').value = '';
        }

        function doClear() {
            document.getElementById('input').value = '';
            document.getElementById('output').value = '';
        }

        function doCopy() {
            var text = document.getElementById('output').value;
            if (!text) { _toast('Nothing to copy', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        }

        document.getElementById('encodeBtn').addEventListener('click', doEncode);
        document.getElementById('decodeBtn').addEventListener('click', doDecode);
        document.getElementById('swapBtn').addEventListener('click', doSwap);
        document.getElementById('clearBtn').addEventListener('click', doClear);
        document.getElementById('copyBtn').addEventListener('click', doCopy);
    </script>
</body>
</html>`;
}
function getUrlEncoderHtml(cspSource, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL Encoder/Decoder</title>
    <style>
        ${SHARED_CSS}
        .mode-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
        .info-card {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 14px 16px;
            font-size: 12px;
            line-height: 1.7;
            color: var(--fg-1);
        }
        .info-card strong { color: var(--fg-0); }
        .info-card ul { margin: 6px 0 0 18px; }
        .info-card li { margin: 3px 0; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>URL Encoder/Decoder</h1>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="mode-row">
                <div class="mode-toggle" id="modeToggle">
                    <button class="active" data-mode="component" id="modeComponent">Component</button>
                    <button data-mode="full" id="modeFull">Full URL</button>
                </div>
                <div class="btn-row" style="margin-left: auto;">
                    <button class="btn" id="encodeBtn">Encode</button>
                    <button class="btn btn-secondary" id="decodeBtn">Decode</button>
                    <button class="btn btn-ghost" id="clearBtn">Clear</button>
                    <button class="btn btn-ghost" id="copyBtn">Copy</button>
                </div>
            </div>
        </div>
        <div class="panels">
            <div>
                <div class="panel-label">Input</div>
                <textarea id="input" rows="12" placeholder="Enter URL or text to encode/decode..."></textarea>
            </div>
            <div>
                <div class="panel-label">Output</div>
                <textarea id="output" rows="12" readonly placeholder="Result will appear here..."></textarea>
            </div>
        </div>
        <div class="section" style="margin-top: 12px;">
            <div class="info-card">
                <strong>Encoding Modes:</strong>
                <ul>
                    <li><strong>Component</strong> \u2014 Encodes everything (/, :, ?, #, &amp; etc). Use for query parameter values.</li>
                    <li><strong>Full URL</strong> \u2014 Preserves URL structure (:, /, ?). Use for encoding a complete URL string.</li>
                </ul>
                <strong style="margin-top:8px;display:block;">When to encode:</strong>
                <ul>
                    <li>Query parameter values, path parameters, form data</li>
                    <li>Non-ASCII characters (\u00E9, \u00FC, emoji, CJK)</li>
                    <li>Spaces and reserved characters (?, #, &amp;, /, =, :, @)</li>
                </ul>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var currentMode = 'component';

        function setMode(mode) {
            currentMode = mode;
            var btns = document.querySelectorAll('#modeToggle button');
            btns.forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
        }

        function doEncode() {
            var input = document.getElementById('input').value;
            if (!input) { _toast('Enter text to encode', 'error'); return; }
            try {
                document.getElementById('output').value = currentMode === 'component' ? encodeURIComponent(input) : encodeURI(input);
                _toast('Encoded', 'success');
            } catch (e) {
                document.getElementById('output').value = 'Error: ' + e.message;
                _toast('Encoding failed', 'error');
            }
        }

        function doDecode() {
            var input = document.getElementById('input').value;
            if (!input) { _toast('Enter text to decode', 'error'); return; }
            try {
                document.getElementById('output').value = decodeURIComponent(input);
                _toast('Decoded', 'success');
            } catch (e) {
                document.getElementById('output').value = 'Error: ' + e.message;
                _toast('Invalid encoded string', 'error');
            }
        }

        function doClear() {
            document.getElementById('input').value = '';
            document.getElementById('output').value = '';
        }

        function doCopy() {
            var text = document.getElementById('output').value;
            if (!text) { _toast('Nothing to copy', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        }

        document.getElementById('modeComponent').addEventListener('click', function() { setMode('component'); });
        document.getElementById('modeFull').addEventListener('click', function() { setMode('full'); });
        document.getElementById('encodeBtn').addEventListener('click', doEncode);
        document.getElementById('decodeBtn').addEventListener('click', doDecode);
        document.getElementById('clearBtn').addEventListener('click', doClear);
        document.getElementById('copyBtn').addEventListener('click', doCopy);
    </script>
</body>
</html>`;
}
function getTimestampConverterHtml(cspSource, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Timestamp Converter</title>
    <style>
        ${SHARED_CSS}
        .converter-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 16px;
        }
        .converter-card {
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 18px;
        }
        .converter-card h3 {
            font-size: 13px;
            font-weight: 700;
            color: var(--fg-0);
            margin-bottom: 12px;
        }
        .converter-card .input-row {
            display: flex; gap: 8px; align-items: start;
        }
        .converter-card .input-row .input { flex: 1; }
        .converter-result {
            margin-top: 10px;
            padding: 10px 12px;
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-family: var(--mono);
            font-size: 12px;
            line-height: 1.8;
            color: var(--fg-0);
        }
        .converter-result .label {
            color: var(--fg-1);
            font-size: 11px;
        }
        .converter-result .value { word-break: break-all; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Timestamp Converter</h1>
        <span class="subtitle">Unix \u2194 Date</span>
    </div>
    <div class="tool-body">
        <div class="converter-grid">
            <div class="converter-card">
                <h3>Unix \u2192 Date</h3>
                <div class="input-row">
                    <input type="text" id="unixInput" class="input" placeholder="e.g. 1700000000 or 1700000000000">
                    <button class="btn" id="unixConvertBtn">Convert</button>
                </div>
                <div style="font-size:11px;color:var(--fg-2);margin-top:6px;">Auto-detects seconds (10 digits) vs milliseconds (13 digits)</div>
                <div class="converter-result" id="unixResult"></div>
            </div>
            <div class="converter-card">
                <h3>Date \u2192 Unix</h3>
                <div class="input-row">
                    <input type="datetime-local" id="dateInput" class="input">
                    <button class="btn" id="dateConvertBtn">Convert</button>
                </div>
                <div class="converter-result" id="dateResult"></div>
            </div>
            <div class="converter-card">
                <h3>Current Time</h3>
                <button class="btn" id="currentBtn">Get Current Timestamp</button>
                <div class="converter-result" id="currentResult"></div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function autoDetectTimestamp(val) {
            var num = parseInt(val, 10);
            if (isNaN(num) || num < 0) return null;
            if (val.length >= 13) return { ms: num, sec: Math.floor(num / 1000) };
            return { ms: num * 1000, sec: num };
        }

        function formatResult(date) {
            if (isNaN(date.getTime())) return '<span style="color:var(--error);">Invalid timestamp</span>';
            return '<div><span class="label">Locale:</span> <span class="value">' + date.toLocaleString() + '</span></div>' +
                '<div><span class="label">ISO 8601:</span> <span class="value">' + date.toISOString() + '</span></div>' +
                '<div><span class="label">UTC:</span> <span class="value">' + date.toUTCString() + '</span></div>';
        }

        function unixToDate() {
            var val = document.getElementById('unixInput').value.trim();
            if (!val) { _toast('Enter a timestamp', 'error'); return; }
            var det = autoDetectTimestamp(val);
            if (!det) { document.getElementById('unixResult').innerHTML = '<span style="color:var(--error);">Invalid input</span>'; return; }
            var d = new Date(det.ms);
            var extra = det.ms !== det.sec * 1000 ?
                '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);"><span class="label">As seconds:</span> <span class="value">' + det.sec + '</span></div>' +
                '<div><span class="label">As milliseconds:</span> <span class="value">' + det.ms + '</span></div>' : '';
            document.getElementById('unixResult').innerHTML = formatResult(d) + extra;
        }

        function dateToUnix() {
            var val = document.getElementById('dateInput').value;
            if (!val) { _toast('Select a date', 'error'); return; }
            var d = new Date(val);
            var sec = Math.floor(d.getTime() / 1000);
            var ms = d.getTime();
            document.getElementById('dateResult').innerHTML =
                '<div><span class="label">Seconds:</span> <span class="value">' + sec + '</span></div>' +
                '<div><span class="label">Milliseconds:</span> <span class="value">' + ms + '</span></div>' +
                '<div><span class="label">ISO 8601:</span> <span class="value">' + d.toISOString() + '</span></div>';
        }

        function getCurrent() {
            var now = new Date();
            var sec = Math.floor(now.getTime() / 1000);
            var ms = now.getTime();
            document.getElementById('currentResult').innerHTML =
                '<div><span class="label">Date:</span> <span class="value">' + now.toLocaleString() + '</span></div>' +
                '<div><span class="label">Seconds:</span> <span class="value">' + sec + '</span></div>' +
                '<div><span class="label">Milliseconds:</span> <span class="value">' + ms + '</span></div>' +
                '<div><span class="label">ISO 8601:</span> <span class="value">' + now.toISOString() + '</span></div>';
        }

        document.getElementById('dateInput').value = new Date().toISOString().slice(0, 16);
        getCurrent();

        document.getElementById('unixConvertBtn').addEventListener('click', unixToDate);
        document.getElementById('dateConvertBtn').addEventListener('click', dateToUnix);
        document.getElementById('currentBtn').addEventListener('click', getCurrent);
    </script>
</body>
</html>`;
}
function getJsonToToonHtml(cspSource, scriptSrc) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource}; style-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSON \u2192 TOON Converter</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>JSON \u2192 TOON Converter</h1>
        <span class="subtitle">Tree Outline notation for readable JSON</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="btn-row">
                <button class="btn" id="convertBtn">Convert</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Output</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="panels">
            <div>
                <div class="panel-label">Input (JSON)</div>
                <textarea id="input" rows="18" placeholder="Paste JSON here..."></textarea>
            </div>
            <div>
                <div class="panel-label">Output (TOON)</div>
                <textarea id="output" rows="18" readonly placeholder="TOON output will appear here..."></textarea>
            </div>
        </div>
        <div class="section" style="margin-top:12px;">
            <div class="panel-label">Console</div>
            <pre id="log" style="background:var(--bg-3);padding:10px;border-radius:var(--radius-sm);height:100px;overflow:auto;font-size:12px;color:var(--fg-1);"></pre>
        </div>
    </div>
    <script src="${scriptSrc}"></script>
</body>
</html>`;
}
function getColorPaletteHtml(cspSource, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Color Palette</title>
    <style>
        ${SHARED_CSS}
        .color-input-row {
            display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
        }
        input[type="color"] {
            width: 56px; height: 40px;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            background: transparent;
            padding: 2px;
        }
        .color-preview {
            width: 80px; height: 40px;
            border-radius: var(--radius-sm);
            border: 1px solid var(--border);
            flex-shrink: 0;
        }
        .color-values {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 8px;
            margin-top: 14px;
        }
        .cv-item {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 8px 12px;
            font-family: var(--mono);
            font-size: 12px;
            cursor: pointer;
            transition: all var(--transition);
            display: flex; justify-content: space-between; align-items: center;
        }
        .cv-item:hover { border-color: var(--border-focus); }
        .cv-item .copy-icon { color: var(--fg-2); font-size: 12px; }
        .palette-row {
            display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;
        }
        .palette-swatch {
            width: 52px; height: 52px;
            border-radius: var(--radius-md);
            cursor: pointer;
            border: 2px solid transparent;
            transition: all var(--transition);
            position: relative;
        }
        .palette-swatch:hover { transform: scale(1.12); border-color: var(--fg-0); }
        .swatch-hex {
            position: absolute; bottom: -18px; left: 50%; transform: translateX(-50%);
            font-size: 9px; font-family: var(--mono);
            white-space: nowrap; color: var(--fg-1);
        }
        .contrast-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 8px;
            margin-top: 12px;
        }
        .contrast-badge {
            padding: 10px 14px;
            border-radius: var(--radius-sm);
            font-size: 12px; font-weight: 700;
            text-align: center;
        }
        .contrast-badge.pass { background: var(--success-bg); color: var(--success); }
        .contrast-badge.fail { background: var(--error-bg); color: var(--error); }
        .contrast-badge.neutral { background: var(--bg-3); color: var(--fg-0); border: 1px solid var(--border); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Color Palette</h1>
        <span class="subtitle">Picker, Generator, Contrast Checker</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Color Picker</div>
            <div class="color-input-row">
                <input type="color" id="colorPicker" value="#007acc">
                <input type="text" id="hexInput" value="#007acc" style="width:120px;" placeholder="#007acc">
                <div class="color-preview" id="colorPreview" style="background:#007acc;"></div>
            </div>
            <div class="color-values" id="colorValues"></div>
        </div>

        <div class="section">
            <div class="section-title">Palette Generator</div>
            <div class="color-input-row">
                <div style="display:flex;align-items:center;gap:8px;">
                    <label style="margin:0;">Base:</label>
                    <input type="color" id="paletteBase" value="#007acc">
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <label style="margin:0;">Shades:</label>
                    <input type="number" id="shadeCount" value="7" min="3" max="12" style="width:60px;">
                </div>
                <button class="btn" id="generatePaletteBtn">Generate</button>
            </div>
            <div class="palette-row" id="paletteOutput" style="padding-bottom:20px;"></div>
        </div>

        <div class="section">
            <div class="section-title">WCAG Contrast Checker</div>
            <div class="color-input-row">
                <div style="display:flex;align-items:center;gap:8px;">
                    <label style="margin:0;">Foreground:</label>
                    <input type="color" id="fgColor" value="#ffffff">
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                    <label style="margin:0;">Background:</label>
                    <input type="color" id="bgColor" value="#007acc">
                </div>
                <button class="btn" id="checkContrastBtn">Check Contrast</button>
            </div>
            <div class="contrast-grid" id="contrastResult"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function hexToRgb(hex) {
            var r = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex);
            return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null;
        }

        function rgbToHsl(r, g, b) {
            r /= 255; g /= 255; b /= 255;
            var max = Math.max(r, g, b), min = Math.min(r, g, b);
            var h, s, l = (max + min) / 2;
            if (max === min) { h = s = 0; } else {
                var d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                    case g: h = ((b - r) / d + 2) / 6; break;
                    case b: h = ((r - g) / d + 4) / 6; break;
                }
            }
            return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
        }

        function getLuminance(r, g, b) {
            var a = [r, g, b].map(function(c) {
                c /= 255;
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
        }

        function updateColorValues(hex) {
            var rgb = hexToRgb(hex);
            if (!rgb) return;
            var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            var items = [
                'HEX: ' + hex,
                'RGB: rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')',
                'HSL: hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)',
                'RGBA: rgba(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ', 1)'
            ];
            document.getElementById('colorValues').innerHTML = items.map(function(v) {
                return '<div class="cv-item" data-copy-color="' + v + '" title="Click to copy">' +
                    '<span>' + v + '</span><span class="copy-icon">\u2398</span></div>';
            }).join('');
            document.getElementById('colorPreview').style.background = hex;
        }

        function copyColor(text) {
            navigator.clipboard.writeText(text).then(function() { _toast('Copied: ' + text, 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        }

        document.getElementById('colorValues').addEventListener('click', function(e) {
            var item = e.target.closest('.cv-item');
            if (item) { copyColor(item.getAttribute('data-copy-color')); }
        });

        document.getElementById('colorPicker').addEventListener('input', function(e) {
            document.getElementById('hexInput').value = e.target.value;
            updateColorValues(e.target.value);
        });

        document.getElementById('hexInput').addEventListener('input', function(e) {
            var val = e.target.value;
            if (/^#[0-9a-f]{6}$/i.test(val)) {
                document.getElementById('colorPicker').value = val;
                updateColorValues(val);
            }
        });

        document.getElementById('generatePaletteBtn').addEventListener('click', function() {
            var base = document.getElementById('paletteBase').value;
            var count = parseInt(document.getElementById('shadeCount').value) || 7;
            var rgb = hexToRgb(base);
            if (!rgb) return;
            var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
            var html = '';
            var container = document.getElementById('paletteOutput');
            container.innerHTML = '';
            for (var i = 0; i < count; i++) {
                var lightness = Math.round(8 + (84 / (count - 1)) * i);
                var hslStr = 'hsl(' + hsl.h + ', ' + hsl.s + '%, ' + lightness + '%)';
                var hexVal = hslToHex(hsl.h, hsl.s, lightness);
                var swatch = document.createElement('div');
                swatch.className = 'palette-swatch';
                swatch.style.background = hslStr;
                swatch.title = hexVal;
                swatch.setAttribute('data-hex', hexVal);
                swatch.innerHTML = '<span class="swatch-hex">' + hexVal + '</span>';
                swatch.addEventListener('click', function() { copyPaletteSwatch(this, this.getAttribute('data-hex')); });
                container.appendChild(swatch);
            }
        });

        function hslToHex(h, s, l) {
            s /= 100; l /= 100;
            var c = (1 - Math.abs(2 * l - 1)) * s;
            var x = c * (1 - Math.abs((h / 60) % 2 - 1));
            var m = l - c / 2;
            var r, g, b;
            if (h < 60) { r = c; g = x; b = 0; }
            else if (h < 120) { r = x; g = c; b = 0; }
            else if (h < 180) { r = 0; g = c; b = x; }
            else if (h < 240) { r = 0; g = x; b = c; }
            else if (h < 300) { r = x; g = 0; b = c; }
            else { r = c; g = 0; b = x; }
            r = Math.round((r + m) * 255);
            g = Math.round((g + m) * 255);
            b = Math.round((b + m) * 255);
            return '#' + [r, g, b].map(function(v) { return v.toString(16).padStart(2, '0'); }).join('');
        }

        function copyPaletteSwatch(el, hex) {
            navigator.clipboard.writeText(hex).then(function() { _toast('Copied: ' + hex, 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        }

        document.getElementById('checkContrastBtn').addEventListener('click', function() {
            var fg = hexToRgb(document.getElementById('fgColor').value);
            var bg = hexToRgb(document.getElementById('bgColor').value);
            if (!fg || !bg) return;
            var l1 = getLuminance(fg.r, fg.g, fg.b);
            var l2 = getLuminance(bg.r, bg.g, bg.b);
            var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            var badges = [
                { label: 'Contrast Ratio', val: ratio.toFixed(2) + ':1', cls: 'neutral' },
                { label: 'AA Large (3:1)', val: ratio >= 3 ? 'PASS' : 'FAIL', cls: ratio >= 3 ? 'pass' : 'fail' },
                { label: 'AA Normal (4.5:1)', val: ratio >= 4.5 ? 'PASS' : 'FAIL', cls: ratio >= 4.5 ? 'pass' : 'fail' },
                { label: 'AAA Normal (7:1)', val: ratio >= 7 ? 'PASS' : 'FAIL', cls: ratio >= 7 ? 'pass' : 'fail' }
            ];
            document.getElementById('contrastResult').innerHTML = badges.map(function(b) {
                return '<div class="contrast-badge ' + b.cls + '"><div style="font-size:11px;font-weight:400;color:var(--fg-1);margin-bottom:4px;">' + b.label + '</div>' + b.val + '</div>';
            }).join('');
        });

        updateColorValues('#007acc');
    </script>
</body>
</html>`;
}
function getLoremGeneratorHtml(cspSource, nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lorem Ipsum Generator</title>
    <style>
        ${SHARED_CSS}
        .output-area {
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 20px;
            max-height: 50vh;
            overflow-y: auto;
            line-height: 1.8;
            white-space: pre-wrap;
            font-size: 14px;
            color: var(--fg-0);
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Lorem Ipsum Generator</h1>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="btn-row" style="gap: 12px;">
                <div>
                    <label>Type</label>
                    <select id="type">
                        <option value="paragraphs">Paragraphs</option>
                        <option value="sentences">Sentences</option>
                        <option value="words">Words</option>
                    </select>
                </div>
                <div>
                    <label>Count</label>
                    <input type="number" id="count" value="3" min="1" max="200" style="width:80px;">
                </div>
                <div>
                    <label>Start with Lorem</label>
                    <select id="startWithLorem">
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </div>
                <div style="align-self: flex-end;">
                    <button class="btn" id="generateBtn">Generate</button>
                </div>
            </div>
        </div>
        <div class="output-area" id="output"></div>
        <div class="btn-row" style="margin-top: 12px;">
            <button class="btn" id="copyPlainBtn">Copy to Clipboard</button>
            <button class="btn btn-secondary" id="copyMarkdownBtn">Copy as Markdown</button>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ');

        function getWord() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }

        function getSentence(len) {
            var s = [];
            for (var i = 0; i < len; i++) s.push(getWord());
            s[0] = s[0].charAt(0).toUpperCase() + s[0].slice(1);
            return s.join(' ') + '.';
        }

        function getParagraph(sc) {
            var p = [];
            for (var i = 0; i < sc; i++) p.push(getSentence(Math.floor(Math.random() * 10) + 8));
            return p.join(' ');
        }

        function generate() {
            var type = document.getElementById('type').value;
            var count = parseInt(document.getElementById('count').value) || 1;
            var startLorem = document.getElementById('startWithLorem').value === 'yes';
            var result = '';

            if (type === 'words') {
                var w = [];
                for (var i = 0; i < count; i++) w.push(getWord());
                result = w.join(' ');
                if (startLorem) result = 'Lorem ' + result;
            } else if (type === 'sentences') {
                var s = [];
                for (var i = 0; i < count; i++) s.push(getSentence(Math.floor(Math.random() * 10) + 8));
                result = s.join(' ');
                if (startLorem) result = 'Lorem ' + result;
            } else {
                var p = [];
                for (var i = 0; i < count; i++) p.push(getParagraph(Math.floor(Math.random() * 8) + 4));
                result = p.join('\\n\\n');
                if (startLorem) result = 'Lorem ipsum dolor sit amet. ' + result;
            }

            document.getElementById('output').textContent = result;
        }

        function copyPlain() {
            var text = document.getElementById('output').textContent;
            if (!text) { _toast('Generate text first', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        }

        function copyMarkdown() {
            var text = document.getElementById('output').textContent;
            if (!text) { _toast('Generate text first', 'error'); return; }
            var paragraphs = text.split(/\\n\\n/);
            var md = paragraphs.map(function(p) { return p.trim(); }).filter(function(p) { return p; }).join('\\n\\n');
            navigator.clipboard.writeText(md).then(function() { _toast('Copied as Markdown!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        }

        document.getElementById('generateBtn').addEventListener('click', generate);
        document.getElementById('copyPlainBtn').addEventListener('click', copyPlain);
        document.getElementById('copyMarkdownBtn').addEventListener('click', copyMarkdown);
        generate();
    </script>
</body>
</html>`;
}
//# sourceMappingURL=advancedTools.js.map