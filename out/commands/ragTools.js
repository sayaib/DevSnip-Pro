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
exports.registerRagToolsCommands = void 0;
const vscode = __importStar(require("vscode"));
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
.input, input[type="text"], input[type="number"], select {
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
    line-height: 1.6;
    resize: vertical;
    outline: none;
    transition: border-color var(--transition);
}
select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23999'%3E%3Cpath d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 30px;
}

.btn {
    padding: 8px 16px;
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
}
.btn:hover { opacity: 0.85; }
.btn-secondary {
    background: var(--bg-3);
    color: var(--fg-0);
}
.btn-ghost {
    background: transparent;
    color: var(--fg-1);
    border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-2); color: var(--fg-0); }
.btn-danger {
    background: var(--error);
    color: #fff;
}
.btn-row {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
}

.result-block {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
    color: var(--fg-0);
}

.panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}
.panel-label {
    font-size: 12px; font-weight: 600;
    color: var(--fg-1);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
@media (max-width: 768px) {
    .panels { grid-template-columns: 1fr; }
    .tool-body { padding: 16px; }
    .btn-row { flex-direction: column; align-items: stretch; }
}

.toast-container {
    position: fixed; top: 12px; right: 12px; z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
}
.toast {
    padding: 10px 16px;
    border-radius: var(--radius-md);
    font-size: 13px; font-weight: 500;
    color: #fff;
    box-shadow: var(--shadow);
    transform: translateX(120%);
    transition: transform 0.3s ease;
    max-width: 320px;
}
.toast.show { transform: translateX(0); }
.toast.success { background: #2e7d32; }
.toast.error { background: #c62828; }
.toast.info { background: #1565c0; }
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
function registerRagToolsCommands(context) {
    const hubCmd = vscode.commands.registerCommand('sayaib.hue-console.ragHub', () => {
        const panel = vscode.window.createWebviewPanel('ragHub', 'DevSnip Pro - RAG Developer Tools', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getRagHubHtml(getNonce());
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'openTool':
                    vscode.commands.executeCommand(message.toolCommand);
                    break;
            }
        }, undefined, context.subscriptions);
    });
    const chunkingTesterCmd = vscode.commands.registerCommand('sayaib.hue-console.chunkingTester', () => {
        const panel = vscode.window.createWebviewPanel('chunkingTester', 'Chunking Strategy Tester', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getChunkingTesterHtml(getNonce());
    });
    const embeddingCostCmd = vscode.commands.registerCommand('sayaib.hue-console.embeddingCost', () => {
        const panel = vscode.window.createWebviewPanel('embeddingCost', 'Embedding Cost Calculator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getEmbeddingCostHtml(getNonce());
    });
    const contextWindowCmd = vscode.commands.registerCommand('sayaib.hue-console.contextWindow', () => {
        const panel = vscode.window.createWebviewPanel('contextWindow', 'Context Window Calculator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getContextWindowHtml(getNonce());
    });
    const semanticDedupCmd = vscode.commands.registerCommand('sayaib.hue-console.semanticDedup', () => {
        const panel = vscode.window.createWebviewPanel('semanticDedup', 'Semantic Dedup Checker', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getSemanticDedupHtml(getNonce());
    });
    const ragEvalCmd = vscode.commands.registerCommand('sayaib.hue-console.ragEvalScores', () => {
        const panel = vscode.window.createWebviewPanel('ragEvalScores', 'RAG Eval Calculator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getRagEvalHtml(getNonce());
    });
    context.subscriptions.push(hubCmd, chunkingTesterCmd, embeddingCostCmd, contextWindowCmd, semanticDedupCmd, ragEvalCmd);
}
exports.registerRagToolsCommands = registerRagToolsCommands;
/* ================================================================
   HUB
   ================================================================ */
function getRagHubHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RAG Developer Tools</title>
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
        .hub-card-title { font-size: 14px; font-weight: 700; }
        .hub-card-desc { font-size: 12px; color: var(--fg-1); line-height: 1.5; }
        .hub-card-tag {
            display: inline-block;
            font-size: 10px; font-weight: 600;
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
        <h1>RAG Developer Tools</h1>
        <span class="subtitle">5 built-in utilities for RAG workflows</span>
    </div>
    <div class="tool-body">
        <div class="hub-grid" id="grid"></div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}
        var tools = [
            { cmd: 'sayaib.hue-console.chunkingTester', icon: '\\u2702\\uFE0F', title: 'Chunking Strategy Tester', desc: 'Compare chunking strategies with visual previews and side-by-side analysis.', tag: 'Chunking' },
            { cmd: 'sayaib.hue-console.embeddingCost', icon: '\\u{1F4B0}', title: 'Embedding Cost Calculator', desc: 'Calculate embedding costs across models with batch size and API call estimates.', tag: 'Cost' },
            { cmd: 'sayaib.hue-console.contextWindow', icon: '\\u{1FA9F}', title: 'Context Window Calculator', desc: 'Plan context window usage with visual utilization bars and max chunk limits.', tag: 'Context' },
            { cmd: 'sayaib.hue-console.semanticDedup', icon: '\\u{1F504}', title: 'Semantic Dedup Checker', desc: 'Find near-duplicate lines using character-level n-gram similarity.', tag: 'Dedup' },
            { cmd: 'sayaib.hue-console.ragEvalScores', icon: '\\u{1F4CA}', title: 'RAG Eval Calculator', desc: 'Evaluate RAG quality with precision, recall, MRR, faithfulness and more.', tag: 'Evaluation' }
        ];
        var grid = document.getElementById('grid');
        tools.forEach(function(t) {
            var card = document.createElement('div');
            card.className = 'hub-card';
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
/* ================================================================
   1. CHUNKING STRATEGY TESTER
   ================================================================ */
function getChunkingTesterHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chunking Strategy Tester</title>
    <style>
        ${SHARED_CSS}
        .chunk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .chunk-stats { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; }
        .chunk-stat {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 12px 16px;
            flex: 1;
            min-width: 120px;
            text-align: center;
        }
        .chunk-stat .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .chunk-stat .value { font-size: 20px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
        .chunk-block {
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 10px;
            margin-bottom: 8px;
            font-family: var(--mono);
            font-size: 12px;
            line-height: 1.5;
            position: relative;
            border-left: 4px solid var(--accent);
        }
        .chunk-block .chunk-header {
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 6px; font-weight: 700; color: var(--accent);
        }
        .chunk-block .chunk-text {
            color: var(--fg-0);
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 150px;
            overflow-y: auto;
        }
        .chunk-block .chunk-boundary {
            position: absolute;
            top: 0; right: 0;
            background: var(--accent);
            color: var(--accent-fg);
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 0 var(--radius-sm) 0 var(--radius-sm);
        }
        .panel-label { font-size: 12px; font-weight: 600; color: var(--fg-1); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.3px; }
        @media (max-width: 768px) { .chunk-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Chunking Strategy Tester</h1>
        <span class="subtitle">Compare and visualize document chunking</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Document Text</label>
            <textarea id="docInput" rows="8">RAG systems break documents into smaller chunks for embedding and retrieval. The chunking strategy affects retrieval quality significantly. Fixed-size chunking splits text at regular character intervals, which may cut mid-sentence. Sentence chunking preserves sentence boundaries, maintaining semantic coherence. Recursive chunking tries multiple separators like paragraphs, sentences, and words to find natural breaks. Overlap chunking adds surrounding context to each chunk, reducing information loss at boundaries. Choosing the right strategy depends on your document structure, embedding model, and retrieval requirements. Experiment below to see how each approach affects your chunks.</textarea>
        </div>
        <div class="section">
            <div class="chunk-grid">
                <div>
                    <label>Chunking Strategy</label>
                    <select id="strategy">
                        <option value="fixed">Fixed-size</option>
                        <option value="sentence">Sentence</option>
                        <option value="recursive" selected>Recursive</option>
                        <option value="overlap">Overlap</option>
                    </select>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                    <div><label>Chunk Size (chars)</label><input type="number" id="chunkSize" value="500" min="50"></div>
                    <div><label>Overlap Size (chars)</label><input type="number" id="overlapSize" value="50" min="0"></div>
                </div>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="chunkBtn">Chunk Document</button>
                <button class="btn btn-ghost" id="copyJsonBtn">Copy Chunks as JSON</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="chunk-stats" id="chunkStats"></div>
            <div class="panel-label" style="margin-top: 16px;">Chunking Result</div>
            <div id="chunkDisplay" style="max-height: 500px; overflow-y: auto;"></div>
            <div class="panel-label" style="margin-top: 16px;">Fixed-Size Reference</div>
            <div id="referenceDisplay" style="max-height: 300px; overflow-y: auto;"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function chunkFixed(text, size) {
            var chunks = [];
            for (var i = 0; i < text.length; i += size) {
                chunks.push(text.substring(i, i + size));
            }
            return chunks;
        }

        function chunkSentence(text, size) {
            var sentences = text.match(/[^.!?]+[.!?]+\\s*/g) || [text];
            var chunks = [];
            var current = '';
            sentences.forEach(function(s) {
                if ((current + s).length > size && current.length > 0) {
                    chunks.push(current.trim());
                    current = '';
                }
                current += s;
            });
            if (current.trim()) chunks.push(current.trim());
            return chunks.length ? chunks : [text];
        }

        function chunkRecursive(text, size, separators) {
            separators = separators || ['\\\\n\\\\n', '\\\\n', '. ', ' '];
            if (text.length <= size) return [text];
            for (var i = 0; i < separators.length; i++) {
                var sep = separators[i];
                var parts = text.split(new RegExp(sep.replace(/\\\\/g, '\\\\'), 'g'));
                if (parts.length > 1) {
                    var chunks = [];
                    var current = '';
                    parts.forEach(function(part) {
                        var candidate = current ? current + sep + part : part;
                        if (candidate.length > size && current.length > 0) {
                            chunks.push(current.trim());
                            current = part;
                        } else {
                            current = candidate;
                        }
                    });
                    if (current.trim()) chunks.push(current.trim());
                    if (chunks.length > 1) return chunks;
                }
            }
            return chunkFixed(text, size);
        }

        function chunkOverlap(text, size, overlap) {
            var chunks = [];
            var step = size - overlap;
            for (var i = 0; i < text.length; i += step) {
                chunks.push(text.substring(i, i + size));
            }
            return chunks;
        }

        function doChunk() {
            var text = document.getElementById('docInput').value;
            if (!text.trim()) { _toast('Enter some text', 'error'); return; }
            var strategy = document.getElementById('strategy').value;
            var size = parseInt(document.getElementById('chunkSize').value) || 500;
            var overlap = parseInt(document.getElementById('overlapSize').value) || 50;

            var chunks;
            switch (strategy) {
                case 'fixed': chunks = chunkFixed(text, size); break;
                case 'sentence': chunks = chunkSentence(text, size); break;
                case 'recursive': chunks = chunkRecursive(text, size); break;
                case 'overlap': chunks = chunkOverlap(text, size, overlap); break;
                default: chunks = chunkFixed(text, size);
            }

            var sizes = chunks.map(function(c) { return c.length; });
            var totalChars = sizes.reduce(function(a, b) { return a + b; }, 0);

            document.getElementById('chunkStats').innerHTML =
                '<div class="chunk-stat"><div class="label">Chunks</div><div class="value">' + chunks.length + '</div></div>' +
                '<div class="chunk-stat"><div class="label">Avg Size</div><div class="value">' + Math.round(totalChars / chunks.length) + '</div></div>' +
                '<div class="chunk-stat"><div class="label">Min Size</div><div class="value">' + Math.min.apply(null, sizes) + '</div></div>' +
                '<div class="chunk-stat"><div class="label">Max Size</div><div class="value">' + Math.max.apply(null, sizes) + '</div></div>';

            var display = document.getElementById('chunkDisplay');
            display.innerHTML = '';
            chunks.forEach(function(c, i) {
                var block = document.createElement('div');
                block.className = 'chunk-block';
                block.innerHTML = '<div class="chunk-header"><span>Chunk ' + (i + 1) + '</span><span>' + c.length + ' chars</span></div>' +
                    '<div class="chunk-text">' + c.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' +
                    '<div class="chunk-boundary">[chunk ' + (i + 1) + ']</div>';
                display.appendChild(block);
            });

            var refChunks = chunkFixed(text, size);
            var refDisplay = document.getElementById('referenceDisplay');
            refDisplay.innerHTML = '';
            refChunks.forEach(function(c, i) {
                var block = document.createElement('div');
                block.className = 'chunk-block';
                block.style.borderLeftColor = '#ff9800';
                block.innerHTML = '<div class="chunk-header" style="color:#ff9800;"><span>Ref Chunk ' + (i + 1) + '</span><span>' + c.length + ' chars</span></div>' +
                    '<div class="chunk-text">' + c.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';
                refDisplay.appendChild(block);
            });

            document.getElementById('resultSection').style.display = 'block';
        }

        document.getElementById('chunkBtn').addEventListener('click', doChunk);

        document.getElementById('copyJsonBtn').addEventListener('click', function() {
            var text = document.getElementById('docInput').value;
            if (!text.trim()) { _toast('Enter some text first', 'error'); return; }
            var strategy = document.getElementById('strategy').value;
            var size = parseInt(document.getElementById('chunkSize').value) || 500;
            var overlap = parseInt(document.getElementById('overlapSize').value) || 50;
            var chunks;
            switch (strategy) {
                case 'fixed': chunks = chunkFixed(text, size); break;
                case 'sentence': chunks = chunkSentence(text, size); break;
                case 'recursive': chunks = chunkRecursive(text, size); break;
                case 'overlap': chunks = chunkOverlap(text, size, overlap); break;
                default: chunks = chunkFixed(text, size);
            }
            var data = chunks.map(function(c, i) { return { index: i, text: c, charCount: c.length }; });
            navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   2. EMBEDDING COST CALCULATOR
   ================================================================ */
function getEmbeddingCostHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Embedding Cost Calculator</title>
    <style>
        ${SHARED_CSS}
        .cost-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            font-size: 12px;
        }
        .cost-table th {
            background: var(--bg-2);
            padding: 8px 10px;
            text-align: left;
            border: 1px solid var(--border);
            font-weight: 700;
        }
        .cost-table td {
            padding: 8px 10px;
            border: 1px solid var(--border);
            font-family: var(--mono);
            font-size: 11px;
        }
        .cost-table tr:nth-child(even) td { background: rgba(0,0,0,0.05); }
        .stat-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
        .stat-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px 20px;
            flex: 1;
            min-width: 140px;
        }
        .stat-box .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; letter-spacing: 0.3px; }
        .stat-box .value { font-size: 20px; font-weight: 700; margin-top: 4px; font-family: var(--mono); }
        .stat-box .value.free { color: var(--success); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Embedding Cost Calculator</h1>
        <span class="subtitle">Estimate embedding API costs across models</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Input Parameters</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>Total Documents</label><input type="number" id="totalDocs" value="10000" min="1"></div>
                <div><label>Avg Tokens per Document</label><input type="number" id="avgTokens" value="500" min="1"></div>
            </div>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                    <label>Embedding Model</label>
                    <select id="modelSelect">
                        <option value="text-embedding-3-small">text-embedding-3-small (OpenAI) - $0.02/1M</option>
                        <option value="text-embedding-3-large">text-embedding-3-large (OpenAI) - $0.13/1M</option>
                        <option value="text-embedding-ada-002">text-embedding-ada-002 (OpenAI) - $0.10/1M</option>
                        <option value="embed-english-v3.0">embed-english-v3.0 (Cohere) - $0.10/1M</option>
                        <option value="embed-multilingual-v3.0">embed-multilingual-v3.0 (Cohere) - $0.10/1M</option>
                        <option value="all-MiniLM-L6-v2">all-MiniLM-L6-v2 (Local/HF) - Free</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div id="customPriceDiv" style="display:none;"><label>Custom Price ($/1M tokens)</label><input type="number" id="customPrice" value="0.10" min="0" step="0.01"></div>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="calcBtn">Calculate</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Results</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="stat-row" id="statRow"></div>
            <div class="section-title" style="margin-top: 16px;">Cost Comparison Across Models</div>
            <table class="cost-table" id="costTable">
                <thead>
                    <tr><th>Model</th><th>Provider</th><th>Price/1M Tokens</th><th>Total Tokens</th><th>Est. Cost</th><th>Batch Size</th><th>API Calls</th></tr>
                </thead>
                <tbody id="costTableBody"></tbody>
            </table>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var models = [
            { id: 'text-embedding-3-small', name: 'text-embedding-3-small', provider: 'OpenAI', price: 0.02, batchSize: 2048 },
            { id: 'text-embedding-3-large', name: 'text-embedding-3-large', provider: 'OpenAI', price: 0.13, batchSize: 2048 },
            { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', provider: 'OpenAI', price: 0.10, batchSize: 2048 },
            { id: 'embed-english-v3.0', name: 'embed-english-v3.0', provider: 'Cohere', price: 0.10, batchSize: 96 },
            { id: 'embed-multilingual-v3.0', name: 'embed-multilingual-v3.0', provider: 'Cohere', price: 0.10, batchSize: 96 },
            { id: 'all-MiniLM-L6-v2', name: 'all-MiniLM-L6-v2', provider: 'Local/HF', price: 0, batchSize: 512 }
        ];

        document.getElementById('modelSelect').addEventListener('change', function() {
            document.getElementById('customPriceDiv').style.display = this.value === 'custom' ? 'block' : 'none';
        });

        document.getElementById('calcBtn').addEventListener('click', function() {
            var totalDocs = parseInt(document.getElementById('totalDocs').value) || 10000;
            var avgTokens = parseInt(document.getElementById('avgTokens').value) || 500;
            var totalTokens = totalDocs * avgTokens;

            var modelId = document.getElementById('modelSelect').value;
            var selectedPrice = modelId === 'custom' ? (parseFloat(document.getElementById('customPrice').value) || 0) : 0;
            var selectedBatch = 2048;

            var rows = [];
            models.forEach(function(m) {
                var price = m.id === modelId ? (modelId === 'custom' ? selectedPrice : m.price) : m.price;
                var batch = m.batchSize;
                var cost = (totalTokens / 1000000) * price;
                var apiCalls = Math.ceil(totalDocs / batch);
                var timeMin = totalDocs / 1000;
                rows.push({ name: m.name, provider: m.provider, price: price, cost: cost, batchSize: batch, apiCalls: apiCalls, time: timeMin });
            });
            if (modelId === 'custom') {
                rows.push({ name: 'Custom', provider: 'User', price: selectedPrice, cost: (totalTokens / 1000000) * selectedPrice, batchSize: 2048, apiCalls: Math.ceil(totalDocs / 2048), time: totalDocs / 1000 });
            }

            var selectedRow = rows.find(function(r) { return r.name === document.getElementById('modelSelect').selectedOptions[0].text.split(' ')[0]; }) || rows[0];
            document.getElementById('statRow').innerHTML =
                '<div class="stat-box"><div class="label">Total Tokens</div><div class="value">' + totalTokens.toLocaleString() + '</div></div>' +
                '<div class="stat-box"><div class="label">Total Cost</div><div class="value' + (selectedRow.cost === 0 ? ' free' : '') + '">' + (selectedRow.cost === 0 ? 'FREE' : '$' + selectedRow.cost.toFixed(4)) + '</div></div>' +
                '<div class="stat-box"><div class="label">Recommended Batch</div><div class="value">' + selectedRow.batchSize + '</div></div>' +
                '<div class="stat-box"><div class="label">API Calls Needed</div><div class="value">' + selectedRow.apiCalls.toLocaleString() + '</div></div>' +
                '<div class="stat-box"><div class="label">Est. Time</div><div class="value">' + selectedRow.time.toFixed(1) + ' min</div></div>';

            var tbody = document.getElementById('costTableBody');
            tbody.innerHTML = '';
            rows.sort(function(a, b) { return a.cost - b.cost; }).forEach(function(r) {
                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + r.name + '</td><td>' + r.provider + '</td><td>$' + r.price.toFixed(2) + '</td><td>' + totalTokens.toLocaleString() + '</td>' +
                    '<td style="color:' + (r.cost === 0 ? 'var(--success)' : 'var(--fg-0)') + ';">' + (r.cost === 0 ? 'FREE' : '$' + r.cost.toFixed(4)) + '</td><td>' + r.batchSize + '</td><td>' + r.apiCalls.toLocaleString() + '</td>';
                tbody.appendChild(tr);
            });

            document.getElementById('resultSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = document.getElementById('statRow').textContent + '\\n\\n' + document.getElementById('costTable').textContent;
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   3. CONTEXT WINDOW CALCULATOR
   ================================================================ */
function getContextWindowHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Context Window Calculator</title>
    <style>
        ${SHARED_CSS}
        .progress-container {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            height: 30px;
            overflow: hidden;
            margin-top: 14px;
            position: relative;
        }
        .progress-bar {
            height: 100%;
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            padding: 0 10px;
            font-size: 12px;
            font-weight: 700;
            color: #fff;
        }
        .progress-label {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 12px;
            font-weight: 700;
        }
        .stat-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
        .stat-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px 20px;
            flex: 1;
            min-width: 140px;
        }
        .stat-box .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; letter-spacing: 0.3px; }
        .stat-box .value { font-size: 20px; font-weight: 700; margin-top: 4px; font-family: var(--mono); }
        .warning-box {
            background: var(--error-bg);
            border: 1px solid var(--error);
            border-radius: var(--radius-sm);
            padding: 12px 16px;
            margin-top: 12px;
            font-size: 13px;
            font-weight: 600;
            color: var(--error);
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Context Window Calculator</h1>
        <span class="subtitle">Plan context window usage for LLM calls</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Model Selection</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                    <label>Model</label>
                    <select id="modelSelect">
                        <option value="128000">GPT-4o (128K)</option>
                        <option value="128000-2">GPT-4o-mini (128K)</option>
                        <option value="200000">Claude 3.5 Sonnet (200K)</option>
                        <option value="200000-2">Claude 3 Opus (200K)</option>
                        <option value="2000000">Gemini 1.5 Pro (2M)</option>
                        <option value="1000000">Gemini 2.0 Flash (1M)</option>
                        <option value="128000-3">Llama 3.1 405B (128K)</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div id="customContextDiv" style="display:none;"><label>Custom Context Window</label><input type="number" id="customContext" value="128000" min="1"></div>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Context Breakdown</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                <div><label>System Prompt Tokens</label><input type="number" id="systemTokens" value="500" min="0"></div>
                <div><label>Retrieved Chunks Count</label><input type="number" id="chunkCount" value="5" min="0"></div>
                <div><label>Avg Tokens per Chunk</label><input type="number" id="chunkTokens" value="400" min="0"></div>
            </div>
            <div style="margin-top:12px;">
                <label>Max Output Tokens</label><input type="number" id="outputTokens" value="2000" min="0">
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="calcBtn">Calculate</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Config</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="progress-container" id="progressContainer">
                <div class="progress-bar" id="progressBar"></div>
                <div class="progress-label" id="progressLabel"></div>
            </div>
            <div id="warningBox" style="display:none;"></div>
            <div class="stat-row" id="statRow"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var modelLimits = {
            '128000': 128000, '128000-2': 128000, '128000-3': 128000,
            '200000': 200000, '200000-2': 200000,
            '2000000': 2000000, '1000000': 1000000
        };

        document.getElementById('modelSelect').addEventListener('change', function() {
            document.getElementById('customContextDiv').style.display = this.value === 'custom' ? 'block' : 'none';
        });

        document.getElementById('calcBtn').addEventListener('click', function() {
            var modelVal = document.getElementById('modelSelect').value;
            var totalWindow = modelVal === 'custom' ? (parseInt(document.getElementById('customContext').value) || 128000) : modelLimits[modelVal];

            var sysTokens = parseInt(document.getElementById('systemTokens').value) || 0;
            var chunks = parseInt(document.getElementById('chunkCount').value) || 0;
            var chunkToks = parseInt(document.getElementById('chunkTokens').value) || 0;
            var outputToks = parseInt(document.getElementById('outputTokens').value) || 0;

            var usedTokens = sysTokens + (chunks * chunkToks) + outputToks;
            var remaining = Math.max(0, totalWindow - usedTokens);
            var pct = (usedTokens / totalWindow) * 100;
            var isWarning = pct > 80;

            var color = pct < 60 ? '#4caf50' : (pct <= 80 ? '#ff9800' : '#f44336');
            var bar = document.getElementById('progressBar');
            bar.style.width = Math.min(pct, 100) + '%';
            bar.style.background = color;
            document.getElementById('progressLabel').textContent = pct.toFixed(1) + '%';

            var maxSafeChunks = Math.max(0, Math.floor((totalWindow - sysTokens - outputToks) / chunkToks));

            document.getElementById('statRow').innerHTML =
                '<div class="stat-box"><div class="label">Total Context Used</div><div class="value">' + usedTokens.toLocaleString() + '</div></div>' +
                '<div class="stat-box"><div class="label">Remaining Space</div><div class="value">' + remaining.toLocaleString() + '</div></div>' +
                '<div class="stat-box"><div class="label">Utilization</div><div class="value" style="color:' + color + ';">' + pct.toFixed(1) + '%</div></div>' +
                '<div class="stat-box"><div class="label">Max Safe Chunks</div><div class="value">' + maxSafeChunks + '</div></div>';

            var warn = document.getElementById('warningBox');
            if (isWarning) {
                warn.className = 'warning-box';
                warn.textContent = 'Warning: Context utilization is over 80%. This may cause truncation or degraded performance.';
                warn.style.display = 'block';
            } else {
                warn.style.display = 'none';
            }

            document.getElementById('resultSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = 'System Tokens: ' + document.getElementById('systemTokens').value +
                '\\nChunk Count: ' + document.getElementById('chunkCount').value +
                '\\nAvg Tokens/Chunk: ' + document.getElementById('chunkTokens').value +
                '\\nMax Output: ' + document.getElementById('outputTokens').value;
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   4. SEMANTIC DEDUP CHECKER
   ================================================================ */
function getSemanticDedupHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Semantic Dedup Checker</title>
    <style>
        ${SHARED_CSS}
        .dedup-pair {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 12px;
            margin-bottom: 8px;
        }
        .dedup-pair-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .dedup-line {
            background: var(--bg-3);
            border-radius: var(--radius-sm);
            padding: 8px 10px;
            margin-bottom: 4px;
            font-family: var(--mono);
            font-size: 12px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .similarity-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 700;
            font-family: var(--mono);
        }
        .similarity-badge.green { background: rgba(76,175,80,0.2); color: #4caf50; }
        .similarity-badge.yellow { background: rgba(255,152,0,0.2); color: #ff9800; }
        .similarity-badge.red { background: rgba(244,67,54,0.2); color: #f44336; }
        .stat-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; }
        .stat-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px 20px;
            flex: 1;
            min-width: 120px;
            text-align: center;
        }
        .stat-box .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .stat-box .value { font-size: 20px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Semantic Dedup Checker</h1>
        <span class="subtitle">Find near-duplicate lines using n-gram similarity</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Input Lines (one per line)</label>
            <textarea id="lineInput" rows="10">The quick brown fox jumps over the lazy dog
A fast brown fox leaps over the lazy dog
The quick brown fox jumps over the sleepy dog
Machine learning is a subset of artificial intelligence
Deep learning is a subset of machine learning
Artificial intelligence encompasses machine learning
Natural language processing is part of AI
The weather is nice today and sunny
It is sunny and the weather is nice
Natural language processing uses deep learning models</textarea>
        </div>
        <div class="section">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:end;">
                <div>
                    <label>Similarity Threshold: <span id="thresholdValue">0.85</span></label>
                    <input type="range" id="threshold" min="0" max="1" step="0.05" value="0.85" style="width:100%;cursor:pointer;">
                </div>
                <div class="btn-row">
                    <button class="btn" id="checkBtn">Check Duplicates</button>
                    <button class="btn btn-ghost" id="copyDedupBtn">Copy Deduplicated</button>
                </div>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="stat-row" id="statRow"></div>
            <div class="section-title" style="margin-top: 16px;">Duplicate Pairs</div>
            <div id="pairDisplay" style="max-height: 400px; overflow-y: auto;"></div>
            <div class="section-title" style="margin-top: 16px;">Deduplicated Result</div>
            <div class="result-block" id="dedupOutput" style="white-space:pre-wrap;"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('threshold').addEventListener('input', function() {
            document.getElementById('thresholdValue').textContent = this.value;
        });

        function getNGrams(str, n) {
            var grams = {};
            var s = str.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\\s+/g, ' ');
            for (var i = 0; i <= s.length - n; i++) {
                var gram = s.substring(i, i + n);
                grams[gram] = (grams[gram] || 0) + 1;
            }
            return grams;
        }

        function jaccardSimilarity(a, b) {
            var n = 3;
            var gramsA = getNGrams(a, n);
            var gramsB = getNGrams(b, n);
            var allKeys = {};
            Object.keys(gramsA).forEach(function(k) { allKeys[k] = true; });
            Object.keys(gramsB).forEach(function(k) { allKeys[k] = true; });
            var intersection = 0;
            var union = 0;
            Object.keys(allKeys).forEach(function(k) {
                var inA = gramsA[k] || 0;
                var inB = gramsB[k] || 0;
                intersection += Math.min(inA, inB);
                union += Math.max(inA, inB);
            });
            return union === 0 ? 0 : intersection / union;
        }

        function truncate(str, len) {
            return str.length > len ? str.substring(0, len) + '...' : str;
        }

        function doCheck() {
            var input = document.getElementById('lineInput').value.trim();
            if (!input) { _toast('Enter some lines', 'error'); return; }
            var threshold = parseFloat(document.getElementById('threshold').value);
            var lines = input.split('\\n').filter(function(l) { return l.trim(); });
            var pairs = [];
            var dupIndices = {};

            for (var i = 0; i < lines.length; i++) {
                for (var j = i + 1; j < lines.length; j++) {
                    var sim = jaccardSimilarity(lines[i], lines[j]);
                    if (sim >= threshold) {
                        pairs.push({ a: lines[i], b: lines[j], sim: sim, idxA: i, idxB: j });
                        dupIndices[j] = true;
                    }
                }
            }

            var uniqueLines = [];
            for (var i = 0; i < lines.length; i++) {
                if (!dupIndices[i]) uniqueLines.push(lines[i]);
            }

            document.getElementById('statRow').innerHTML =
                '<div class="stat-box"><div class="label">Total Lines</div><div class="value">' + lines.length + '</div></div>' +
                '<div class="stat-box"><div class="label">Unique Lines</div><div class="value">' + uniqueLines.length + '</div></div>' +
                '<div class="stat-box"><div class="label">Near-Duplicate Pairs</div><div class="value">' + pairs.length + '</div></div>';

            var pairDiv = document.getElementById('pairDisplay');
            pairDiv.innerHTML = '';
            if (pairs.length === 0) {
                pairDiv.innerHTML = '<div style="color:var(--fg-2);font-size:13px;">No duplicates found at threshold ' + threshold + '</div>';
            } else {
                pairs.sort(function(a, b) { return b.sim - a.sim; }).forEach(function(p) {
                    var badgeClass = p.sim > 0.95 ? 'red' : (p.sim > 0.85 ? 'yellow' : 'green');
                    var block = document.createElement('div');
                    block.className = 'dedup-pair';
                    block.innerHTML = '<div class="dedup-pair-header"><span style="font-weight:700;">Pair (Lines ' + (p.idxA + 1) + ' & ' + (p.idxB + 1) + ')</span><span class="similarity-badge ' + badgeClass + '">' + p.sim.toFixed(3) + '</span></div>' +
                        '<div class="dedup-line">A: ' + truncate(p.a, 120).replace(/</g, '&lt;') + '</div>' +
                        '<div class="dedup-line">B: ' + truncate(p.b, 120).replace(/</g, '&lt;') + '</div>';
                    pairDiv.appendChild(block);
                });
            }

            document.getElementById('dedupOutput').textContent = uniqueLines.join('\\n');
            document.getElementById('resultSection').style.display = 'block';
        }

        document.getElementById('checkBtn').addEventListener('click', doCheck);

        document.getElementById('copyDedupBtn').addEventListener('click', function() {
            var text = document.getElementById('dedupOutput').textContent;
            if (!text) { _toast('Run check first', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   5. RAG EVAL CALCULATOR
   ================================================================ */
function getRagEvalHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RAG Eval Calculator</title>
    <style>
        ${SHARED_CSS}
        .metric-row {
            display: grid;
            grid-template-columns: 200px 1fr 100px;
            gap: 12px;
            align-items: center;
            margin-bottom: 10px;
        }
        .metric-bar-container {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            height: 24px;
            overflow: hidden;
            position: relative;
        }
        .metric-bar {
            height: 100%;
            transition: width 0.3s ease;
        }
        .metric-bar-label {
            position: absolute;
            top: 50%;
            right: 8px;
            transform: translateY(-50%);
            font-size: 11px;
            font-weight: 700;
            color: #fff;
        }
        .quality-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: var(--radius-sm);
            font-size: 14px;
            font-weight: 700;
        }
        .quality-badge.excellent { background: rgba(76,175,80,0.2); color: #4caf50; }
        .quality-badge.good { background: rgba(33,150,243,0.2); color: #2196f3; }
        .quality-badge.fair { background: rgba(255,152,0,0.2); color: #ff9800; }
        .quality-badge.poor { background: rgba(244,67,54,0.2); color: #f44336; }
        .suggestion-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 10px 14px;
            margin-bottom: 8px;
            font-size: 12px;
            line-height: 1.5;
        }
        .suggestion-box .metric-name { font-weight: 700; color: var(--accent); }
        .radar-section {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-top: 14px;
        }
        @media (max-width: 768px) { .radar-section { grid-template-columns: 1fr 1fr; } .metric-row { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>RAG Eval Calculator</h1>
        <span class="subtitle">Evaluate retrieval-augmented generation quality</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Metric Inputs (0 - 1)</div>
            <div class="metric-row">
                <label style="margin:0;">Precision@K</label>
                <input type="range" id="precision" min="0" max="1" step="0.05" value="0.70" style="width:100%;cursor:pointer;">
                <span id="precisionVal" style="font-family:var(--mono);font-weight:700;">0.70</span>
            </div>
            <div class="metric-row">
                <label style="margin:0;">Recall@K</label>
                <input type="range" id="recall" min="0" max="1" step="0.05" value="0.65" style="width:100%;cursor:pointer;">
                <span id="recallVal" style="font-family:var(--mono);font-weight:700;">0.65</span>
            </div>
            <div class="metric-row">
                <label style="margin:0;">MRR</label>
                <input type="range" id="mrr" min="0" max="1" step="0.05" value="0.40" style="width:100%;cursor:pointer;">
                <span id="mrrVal" style="font-family:var(--mono);font-weight:700;">0.40</span>
            </div>
            <div class="metric-row">
                <label style="margin:0;">NDCG@K</label>
                <input type="range" id="ndcg" min="0" max="1" step="0.05" value="0.75" style="width:100%;cursor:pointer;">
                <span id="ndcgVal" style="font-family:var(--mono);font-weight:700;">0.75</span>
            </div>
            <div class="metric-row">
                <label style="margin:0;">Faithfulness</label>
                <input type="range" id="faithfulness" min="0" max="1" step="0.05" value="0.55" style="width:100%;cursor:pointer;">
                <span id="faithfulnessVal" style="font-family:var(--mono);font-weight:700;">0.55</span>
            </div>
            <div class="metric-row">
                <label style="margin:0;">Answer Relevancy</label>
                <input type="range" id="relevancy" min="0" max="1" step="0.05" value="0.70" style="width:100%;cursor:pointer;">
                <span id="relevancyVal" style="font-family:var(--mono);font-weight:700;">0.70</span>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="evalBtn">Evaluate</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Report</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">
                <div><div class="section-title">Overall Quality Score</div><div id="overallScore" style="font-size:36px;font-weight:700;font-family:var(--mono);"></div></div>
                <div><div class="section-title">Rating</div><div id="qualityBadge"></div></div>
            </div>
            <div class="section-title">Metric Breakdown</div>
            <div id="metricBreakdown"></div>
            <div class="section-title" style="margin-top: 16px;">Suggestions</div>
            <div id="suggestions"></div>
            <div class="section-title" style="margin-top: 16px;">Visual Overview</div>
            <div class="radar-section" id="radarSection"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var sliderIds = ['precision', 'recall', 'mrr', 'ndcg', 'faithfulness', 'relevancy'];
        sliderIds.forEach(function(id) {
            document.getElementById(id).addEventListener('input', function() {
                document.getElementById(id + 'Val').textContent = parseFloat(this.value).toFixed(2);
            });
        });

        function getMetricInfo(id, val) {
            var info = { name: id, value: val, color: '#4caf50', suggestion: '' };
            switch (id) {
                case 'precision':
                    info.label = 'Precision@K';
                    if (val < 0.5) { info.suggestion = 'Too many irrelevant chunks retrieved. Try reducing K or using better filtering.'; info.color = '#f44336'; }
                    else if (val < 0.7) { info.suggestion = 'Some irrelevant chunks retrieved. Consider re-ranking or stricter similarity thresholds.'; info.color = '#ff9800'; }
                    break;
                case 'recall':
                    info.label = 'Recall@K';
                    if (val < 0.5) { info.suggestion = 'Missing relevant context. Increase K or improve chunking strategy.'; info.color = '#f44336'; }
                    else if (val < 0.7) { info.suggestion = 'Some relevant context missing. Consider hybrid search or query expansion.'; info.color = '#ff9800'; }
                    break;
                case 'mrr':
                    info.label = 'MRR';
                    if (val < 0.3) { info.suggestion = 'Correct answer not ranked high enough. Improve re-ranking or embed query better.'; info.color = '#f44336'; }
                    else if (val < 0.6) { info.suggestion = 'Ranking could be improved. Consider adding metadata filtering.'; info.color = '#ff9800'; }
                    break;
                case 'ndcg':
                    info.label = 'NDCG@K';
                    if (val < 0.5) { info.suggestion = 'Relevance ordering is poor. Try learning-to-rank or better chunk embeddings.'; info.color = '#f44336'; }
                    else if (val < 0.7) { info.suggestion = 'Ordering can be improved. Review chunk quality and relevance signals.'; info.color = '#ff9800'; }
                    break;
                case 'faithfulness':
                    info.label = 'Faithfulness';
                    if (val < 0.7) { info.suggestion = 'Model hallucinating beyond context. Use stronger prompts or lower temperature.'; info.color = '#f44336'; }
                    else if (val < 0.85) { info.suggestion = 'Some hallucination detected. Add "only answer from context" instructions.'; info.color = '#ff9800'; }
                    break;
                case 'relevancy':
                    info.label = 'Answer Relevancy';
                    if (val < 0.5) { info.suggestion = 'Answers not addressing the query. Improve prompt template or chunk selection.'; info.color = '#f44336'; }
                    else if (val < 0.7) { info.suggestion = 'Answers somewhat relevant. Refine retrieval to match query intent better.'; info.color = '#ff9800'; }
                    break;
            }
            if (!info.suggestion) info.suggestion = 'Performing well. No major improvements needed.';
            return info;
        }

        document.getElementById('evalBtn').addEventListener('click', function() {
            var metrics = {};
            var total = 0;
            var weights = { precision: 0.2, recall: 0.2, mrr: 0.15, ndcg: 0.15, faithfulness: 0.2, relevancy: 0.1 };
            sliderIds.forEach(function(id) {
                var val = parseFloat(document.getElementById(id).value);
                metrics[id] = val;
                total += val * weights[id];
            });

            var rating, badgeClass;
            if (total >= 0.85) { rating = 'Excellent'; badgeClass = 'excellent'; }
            else if (total >= 0.70) { rating = 'Good'; badgeClass = 'good'; }
            else if (total >= 0.50) { rating = 'Fair'; badgeClass = 'fair'; }
            else { rating = 'Poor'; badgeClass = 'poor'; }

            document.getElementById('overallScore').textContent = total.toFixed(3);
            document.getElementById('overallScore').style.color = total >= 0.7 ? 'var(--success)' : (total >= 0.5 ? 'var(--warning)' : 'var(--error)');
            document.getElementById('qualityBadge').innerHTML = '<span class="quality-badge ' + badgeClass + '">' + rating + '</span>';

            var breakdown = document.getElementById('metricBreakdown');
            breakdown.innerHTML = '';
            sliderIds.forEach(function(id) {
                var info = getMetricInfo(id, metrics[id]);
                var row = document.createElement('div');
                row.style.marginBottom = '12px';
                row.innerHTML = '<div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-size:12px;font-weight:600;">' + info.label + '</span><span style="font-family:var(--mono);font-size:12px;">' + metrics[id].toFixed(2) + '</span></div>' +
                    '<div class="metric-bar-container"><div class="metric-bar" style="width:' + (metrics[id] * 100) + '%;background:' + info.color + ';"></div></div>' +
                    '<div style="font-size:11px;color:var(--fg-1);margin-top:4px;">' + info.suggestion + '</div>';
                breakdown.appendChild(row);
            });

            var suggDiv = document.getElementById('suggestions');
            suggDiv.innerHTML = '';
            var weakMetrics = sliderIds.filter(function(id) { return metrics[id] < 0.7; });
            if (weakMetrics.length === 0) {
                suggDiv.innerHTML = '<div class="suggestion-box" style="color:var(--success);">All metrics are performing well. Keep up the good work!</div>';
            } else {
                weakMetrics.forEach(function(id) {
                    var info = getMetricInfo(id, metrics[id]);
                    var box = document.createElement('div');
                    box.className = 'suggestion-box';
                    box.innerHTML = '<span class="metric-name">' + info.label + ' (' + metrics[id].toFixed(2) + ')</span>: ' + info.suggestion;
                    suggDiv.appendChild(box);
                });
            }

            var radarDiv = document.getElementById('radarSection');
            radarDiv.innerHTML = '';
            sliderIds.forEach(function(id) {
                var info = getMetricInfo(id, metrics[id]);
                var card = document.createElement('div');
                card.style.cssText = 'background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;text-align:center;';
                card.innerHTML = '<div style="font-size:11px;color:var(--fg-1);text-transform:uppercase;margin-bottom:6px;">' + info.label + '</div>' +
                    '<div style="position:relative;height:60px;">' +
                    '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100%;height:8px;background:var(--bg-3);border-radius:4px;overflow:hidden;">' +
                    '<div style="height:100%;width:' + (metrics[id] * 100) + '%;background:' + info.color + ';border-radius:4px;"></div></div>' +
                    '</div>' +
                    '<div style="font-size:20px;font-weight:700;font-family:var(--mono);margin-top:8px;color:' + info.color + ';">' + metrics[id].toFixed(2) + '</div>';
                radarDiv.appendChild(card);
            });

            document.getElementById('resultSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = 'RAG Evaluation Report\\n' + '='.repeat(40) + '\\n\\n';
            text += 'Overall Score: ' + document.getElementById('overallScore').textContent + '\\n';
            text += 'Rating: ' + document.getElementById('qualityBadge').textContent + '\\n\\n';
            text += 'Metric Details:\\n';
            sliderIds.forEach(function(id) {
                var val = parseFloat(document.getElementById(id).value);
                var info = getMetricInfo(id, val);
                text += '  ' + info.label + ': ' + val.toFixed(2) + ' - ' + info.suggestion + '\\n';
            });
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
//# sourceMappingURL=ragTools.js.map