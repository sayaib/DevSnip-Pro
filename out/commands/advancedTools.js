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
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const webview_ui_2 = require("../utils/webview-ui");
const path = __importStar(require("path"));
/** Shared panel styling lives in utils/webview-ui so every tool page stays consistent. */
const SHARED_CSS = webview_ui_2.UTILITY_CSS;
function registerAdvancedToolsCommands(context) {
    const regexBuilderCommand = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.regexBuilder', () => {
        const { panel, created } = (0, webview_ui_1.openToolPanel)('regexBuilder', 'Regex Builder & Tester', { enableScripts: true });
        if (!created)
            return;
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'regex-builder.js')));
        panel.webview.html = getRegexBuilderHtml(panel.webview.cspSource, String(scriptUri));
    });
    const jsonFormatterCommand = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.jsonFormatter', () => {
        const { panel, created } = (0, webview_ui_1.openToolPanel)('jsonFormatter', 'JSON/XML Formatter', { enableScripts: true });
        if (!created)
            return;
        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media', 'json-xml-formatter.js')));
        panel.webview.html = getJsonFormatterHtml(panel.webview.cspSource, String(scriptUri));
        // Capture the selection now, but only send it once the webview script
        // has loaded: a message posted before that is dropped, which is why the
        // selection used to arrive empty.
        const editor = vscode.window.activeTextEditor;
        const text = editor ? editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection) : '';
        const readySubscription = panel.webview.onDidReceiveMessage(message => {
            if (message?.command === 'ready' && text) {
                (0, webview_ui_2.safePostMessage)(panel, { command: 'prefill', text });
            }
        });
        panel.onDidDispose(() => readySubscription.dispose());
    });
    const hashGeneratorCommand = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.hashGenerator', () => {
        const { panel, created } = (0, webview_ui_1.openToolPanel)('hashGenerator', 'Hash Generator', { enableScripts: true });
        if (!created)
            return;
        panel.webview.html = getHashGeneratorHtml(panel.webview.cspSource, (0, webview_ui_2.getNonce)());
    });
    const timestampConverterCommand = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.timestampConverter', () => {
        const { panel, created } = (0, webview_ui_1.openToolPanel)('timestampConverter', 'Timestamp Converter', { enableScripts: true });
        if (!created)
            return;
        panel.webview.html = getTimestampConverterHtml(panel.webview.cspSource, (0, webview_ui_2.getNonce)());
    });
    const colorPaletteCommand = (0, command_registry_1.registerTrackedCommand)('sayaib.hue-console.colorPalette', () => {
        const { panel, created } = (0, webview_ui_1.openToolPanel)('colorPalette', 'Color Palette', { enableScripts: true });
        if (!created)
            return;
        const nonce = (0, webview_ui_2.getNonce)();
        panel.webview.html = getColorPaletteHtml(panel.webview.cspSource, nonce);
    });
    context.subscriptions.push(regexBuilderCommand, jsonFormatterCommand, hashGeneratorCommand, timestampConverterCommand, colorPaletteCommand);
}
exports.registerAdvancedToolsCommands = registerAdvancedToolsCommands;
function getRegexBuilderHtml(cspSource, scriptSrc) {
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
        ${(0, webview_ui_2.toastScript)()}

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
        ${(0, webview_ui_2.toastScript)()}

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
        ${(0, webview_ui_2.toastScript)()}

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
//# sourceMappingURL=advancedTools.js.map