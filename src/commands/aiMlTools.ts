import * as vscode from 'vscode';
import * as path from 'path';

function getNonce(): string {
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

function toastScript(): string {
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

export function registerAiMlToolsCommands(context: vscode.ExtensionContext) {
    const hubCmd = vscode.commands.registerCommand('sayaib.hue-console.aiMlHub', () => {
        const panel = vscode.window.createWebviewPanel(
            'aiMlHub',
            'DevSnip Pro - AI/ML & LLM Tools',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getAiMlHubHtml(getNonce());
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openTool':
                        vscode.commands.executeCommand(message.toolCommand);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    });

    const tokenCounterCmd = vscode.commands.registerCommand('sayaib.hue-console.tokenCounter', () => {
        const panel = vscode.window.createWebviewPanel(
            'tokenCounter',
            'Token Counter & Cost Calculator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getTokenCounterHtml(getNonce());
    });

    const promptTemplateCmd = vscode.commands.registerCommand('sayaib.hue-console.promptTemplate', () => {
        const panel = vscode.window.createWebviewPanel(
            'promptTemplate',
            'Prompt Template Manager',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getPromptTemplateHtml(getNonce());
    });

    const mlCodeGenCmd = vscode.commands.registerCommand('sayaib.hue-console.mlCodeGen', () => {
        const panel = vscode.window.createWebviewPanel(
            'mlCodeGen',
            'Python ML Code Generator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getMlCodeGenHtml(getNonce());
    });

    const llmApiTesterCmd = vscode.commands.registerCommand('sayaib.hue-console.llmApiTester', () => {
        const panel = vscode.window.createWebviewPanel(
            'llmApiTester',
            'LLM API Tester',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getLlmApiTesterHtml(getNonce());
    });

    const datasetSplitCmd = vscode.commands.registerCommand('sayaib.hue-console.datasetSplit', () => {
        const panel = vscode.window.createWebviewPanel(
            'datasetSplit',
            'Dataset Split Calculator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getDatasetSplitHtml(getNonce());
    });

    const gpuVramCmd = vscode.commands.registerCommand('sayaib.hue-console.gpuVram', () => {
        const panel = vscode.window.createWebviewPanel(
            'gpuVram',
            'GPU VRAM Calculator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getGpuVramHtml(getNonce());
    });

    const experimentLoggerCmd = vscode.commands.registerCommand('sayaib.hue-console.experimentLogger', () => {
        const panel = vscode.window.createWebviewPanel(
            'experimentLogger',
            'Experiment Logger',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getExperimentLoggerHtml(getNonce());
    });

    const modelCardCmd = vscode.commands.registerCommand('sayaib.hue-console.modelCard', () => {
        const panel = vscode.window.createWebviewPanel(
            'modelCard',
            'Model Card Generator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getModelCardHtml(getNonce());
    });

    const jsonlViewerCmd = vscode.commands.registerCommand('sayaib.hue-console.jsonlViewer', () => {
        const panel = vscode.window.createWebviewPanel(
            'jsonlViewer',
            'JSONL Viewer',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getJsonlViewerHtml(getNonce());
    });

    const mdTableCmd = vscode.commands.registerCommand('sayaib.hue-console.mdTableGen', () => {
        const panel = vscode.window.createWebviewPanel(
            'mdTableGen',
            'Markdown Table Generator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getMdTableGenHtml(getNonce());
    });

    context.subscriptions.push(
        hubCmd, tokenCounterCmd, promptTemplateCmd, mlCodeGenCmd, llmApiTesterCmd,
        datasetSplitCmd, gpuVramCmd, experimentLoggerCmd, modelCardCmd, jsonlViewerCmd, mdTableCmd
    );
}

/* ================================================================
   HUB
   ================================================================ */
function getAiMlHubHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI/ML & LLM Tools</title>
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
        <h1>AI/ML & LLM Developer Tools</h1>
        <span class="subtitle">10 built-in utilities for AI/ML workflows</span>
    </div>
    <div class="tool-body">
        <div class="hub-grid" id="grid"></div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}
        var tools = [
            { cmd: 'sayaib.hue-console.tokenCounter', icon: '\\u{1F4B0}', title: 'Token Counter & Cost Calculator', desc: 'Count tokens for GPT-4, Claude, Gemini models and estimate API costs.', tag: 'LLM' },
            { cmd: 'sayaib.hue-console.promptTemplate', icon: '\\u{1F4DD}', title: 'Prompt Template Manager', desc: 'Create, save, and manage prompt templates with variable substitution.', tag: 'Prompt' },
            { cmd: 'sayaib.hue-console.mlCodeGen', icon: '\\u{1F40D}', title: 'Python ML Code Generator', desc: 'Generate PyTorch, TensorFlow, HuggingFace, and LangChain boilerplate code.', tag: 'Code' },
            { cmd: 'sayaib.hue-console.llmApiTester', icon: '\\u{1F4E1}', title: 'LLM API Tester', desc: 'Test OpenAI, Anthropic, and Gemini API endpoints with streaming support.', tag: 'API' },
            { cmd: 'sayaib.hue-console.datasetSplit', icon: '\\u{1F4CA}', title: 'Dataset Split Calculator', desc: 'Calculate train/val/test splits with stratification and random seed control.', tag: 'Data' },
            { cmd: 'sayaib.hue-console.gpuVram', icon: '\\u{1F5A5}', title: 'GPU VRAM Calculator', desc: 'Estimate VRAM requirements based on model parameters and precision format.', tag: 'Compute' },
            { cmd: 'sayaib.hue-console.experimentLogger', icon: '\\u{1F4D6}', title: 'Experiment Logger', desc: 'Log hyperparameters, metrics, and results in a structured format.', tag: 'MLOps' },
            { cmd: 'sayaib.hue-console.modelCard', icon: '\\u{1F4C4}', title: 'Model Card Generator', desc: 'Generate standardized model cards in HuggingFace format for documentation.', tag: 'Docs' },
            { cmd: 'sayaib.hue-console.jsonlViewer', icon: '\\u{1F4CB}', title: 'JSONL Viewer', desc: 'Parse and inspect JSONL training data files in a readable table format.', tag: 'Data' },
            { cmd: 'sayaib.hue-console.mdTableGen', icon: '\\u{1F4D1}', title: 'Markdown Table Generator', desc: 'Quickly generate markdown tables for experiment results and documentation.', tag: 'Docs' }
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
   1. TOKEN COUNTER & COST CALCULATOR
   ================================================================ */
function getTokenCounterHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Counter & Cost Calculator</title>
    <style>
        ${SHARED_CSS}
        .model-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 12px; }
        .model-card {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 12px;
            cursor: pointer;
            transition: all var(--transition);
        }
        .model-card:hover, .model-card.active { border-color: var(--accent); background: rgba(0,122,204,0.08); }
        .model-card .name { font-weight: 700; font-size: 13px; }
        .model-card .provider { font-size: 11px; color: var(--fg-1); }
        .model-card .pricing { font-size: 11px; color: var(--fg-2); margin-top: 4px; font-family: var(--mono); }
        .stat-row { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 14px; }
        .stat-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px 20px;
            flex: 1;
            min-width: 140px;
        }
        .stat-box .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; letter-spacing: 0.3px; }
        .stat-box .value { font-size: 22px; font-weight: 700; margin-top: 4px; font-family: var(--mono); }
        .stat-box .value.cost { color: var(--success); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Token Counter & Cost Calculator</h1>
        <span class="subtitle">Estimate tokens and API costs</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Select Model</label>
            <div class="model-grid" id="modelGrid"></div>
        </div>
        <div class="section">
            <label>Input Text</label>
            <textarea id="textInput" rows="8" placeholder="Paste your text here to count tokens..."></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="countBtn">Count Tokens</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="stat-row" id="stats" style="display:none;">
            <div class="stat-box">
                <div class="label">Tokens</div>
                <div class="value" id="tokenCount">0</div>
            </div>
            <div class="stat-box">
                <div class="label">Characters</div>
                <div class="value" id="charCount">0</div>
            </div>
            <div class="stat-box">
                <div class="label">Words (est.)</div>
                <div class="value" id="wordCount">0</div>
            </div>
            <div class="stat-box">
                <div class="label">Est. Cost (Input)</div>
                <div class="value cost" id="inputCost">$0.00</div>
            </div>
            <div class="stat-box">
                <div class="label">Est. Cost (Output x2)</div>
                <div class="value cost" id="outputCost">$0.00</div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var models = [
            { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', inRate: 2.50, outRate: 10.00, ratio: 0.35 },
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', inRate: 0.15, outRate: 0.60, ratio: 0.35 },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI', inRate: 10.00, outRate: 30.00, ratio: 0.35 },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'OpenAI', inRate: 0.50, outRate: 1.50, ratio: 0.35 },
            { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'Anthropic', inRate: 3.00, outRate: 15.00, ratio: 0.40 },
            { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic', inRate: 0.80, outRate: 4.00, ratio: 0.40 },
            { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic', inRate: 15.00, outRate: 75.00, ratio: 0.40 },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'Google', inRate: 0.10, outRate: 0.40, ratio: 0.30 },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', inRate: 1.25, outRate: 5.00, ratio: 0.30 },
            { id: 'llama-3.1-70b', name: 'Llama 3.1 70B', provider: 'Together/Open', inRate: 0.88, outRate: 0.88, ratio: 0.35 },
            { id: 'mistral-large', name: 'Mistral Large', provider: 'Mistral', inRate: 2.00, outRate: 6.00, ratio: 0.35 }
        ];

        var selected = models[0];
        var grid = document.getElementById('modelGrid');

        models.forEach(function(m) {
            var card = document.createElement('div');
            card.className = 'model-card' + (m.id === selected.id ? ' active' : '');
            card.setAttribute('data-model', m.id);
            card.innerHTML = '<div class="name">' + m.name + '</div>' +
                '<div class="provider">' + m.provider + '</div>' +
                '<div class="pricing">$' + m.inRate.toFixed(2) + ' / $' + m.outRate.toFixed(2) + ' per 1M</div>';
            card.addEventListener('click', function() {
                document.querySelectorAll('.model-card').forEach(function(c) { c.classList.remove('active'); });
                card.classList.add('active');
                selected = m;
                if (document.getElementById('textInput').value) doCount();
            });
            grid.appendChild(card);
        });

        function estimateTokens(text) {
            var words = text.trim().split(/\\s+/).filter(function(w) { return w.length > 0; });
            var tokens = 0;
            words.forEach(function(w) {
                if (w.length <= 3) tokens += 1;
                else if (w.length <= 6) tokens += Math.ceil(w.length / 3);
                else tokens += Math.ceil(w.length / 3.5);
            });
            tokens += Math.ceil(text.length / 200);
            return Math.max(1, tokens);
        }

        function doCount() {
            var text = document.getElementById('textInput').value;
            if (!text.trim()) { _toast('Enter some text', 'error'); return; }
            var chars = text.length;
            var words = text.trim().split(/\\s+/).length;
            var tokens = estimateTokens(text);
            var inputCost = (tokens / 1000000) * selected.inRate;
            var outputTokens = Math.round(tokens * selected.ratio);
            var outputCost = (outputTokens / 1000000) * selected.outRate;
            document.getElementById('tokenCount').textContent = tokens.toLocaleString();
            document.getElementById('charCount').textContent = chars.toLocaleString();
            document.getElementById('wordCount').textContent = words.toLocaleString();
            document.getElementById('inputCost').textContent = '$' + inputCost.toFixed(6);
            document.getElementById('outputCost').textContent = '$' + (inputCost + outputCost).toFixed(6);
            document.getElementById('stats').style.display = 'flex';
        }

        document.getElementById('countBtn').addEventListener('click', doCount);
        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('textInput').value = '';
            document.getElementById('stats').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   2. PROMPT TEMPLATE MANAGER
   ================================================================ */
function getPromptTemplateHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompt Template Manager</title>
    <style>
        ${SHARED_CSS}
        .template-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
        .template-item {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 12px;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: all var(--transition);
            font-size: 13px;
        }
        .template-item:hover, .template-item.active { border-color: var(--accent); }
        .template-item .tname { flex: 1; font-weight: 600; }
        .template-item .tcat { font-size: 11px; color: var(--fg-2); }
        .var-tag {
            display: inline-block;
            background: rgba(0,122,204,0.15);
            color: var(--accent);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-family: var(--mono);
            margin: 2px;
        }
        .rendered-output {
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            font-family: var(--mono);
            font-size: 13px;
            line-height: 1.7;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Prompt Template Manager</h1>
        <span class="subtitle">Create, save, and render prompt templates</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Saved Templates</div>
            <div class="template-list" id="templateList"></div>
            <div class="btn-row" style="margin-top: 10px;">
                <button class="btn btn-ghost" id="addTemplateBtn">+ New Template</button>
                <button class="btn btn-ghost btn-danger" id="deleteTemplateBtn">Delete</button>
            </div>
        </div>
        <div class="section" id="editorSection" style="display:none;">
            <div class="section-title">Template Editor</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <div><label>Name</label><input type="text" id="tplName" placeholder="e.g. Summarize Text"></div>
                <div><label>Category</label><input type="text" id="tplCat" placeholder="e.g. summarization"></div>
            </div>
            <label>Template <span style="font-weight:400;color:var(--fg-2);">(use {{variable}} for placeholders)</span></label>
            <textarea id="tplBody" rows="8" placeholder="e.g. Summarize the following text in {{style}} style:\\n\\n{{text}}"></textarea>
            <div style="margin-top:8px;">
                <label>Detected Variables</label>
                <div id="varTags"></div>
            </div>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="saveTemplateBtn">Save Template</button>
            </div>
        </div>
        <div class="section" id="renderSection" style="display:none;">
            <div class="section-title">Render Template</div>
            <div id="renderVars"></div>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="renderBtn">Render</button>
                <button class="btn btn-ghost" id="copyRenderBtn">Copy Output</button>
            </div>
            <div class="rendered-output" id="renderedOutput" style="margin-top:12px;display:none;"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var templates = JSON.parse(localStorage.getItem('aiMlPromptTemplates') || '[]');
        if (!templates.length) {
            templates = [
                { name: 'Summarize Text', cat: 'summarization', body: 'Summarize the following text in {{style}} style ({{length}} sentences):\\n\\n{{text}}' },
                { name: 'Code Review', cat: 'coding', body: 'Review the following {{language}} code for bugs, performance issues, and best practices. Provide specific suggestions:\\n\\n{{code}}' },
                { name: 'Explain Concept', cat: 'education', body: 'Explain {{concept}} to a {{audience}}. Use {{examples}} examples and keep it {{tone}}.' },
                { name: 'Data Analysis', cat: 'analysis', body: 'Analyze the following {{dataType}} data and provide insights on {{focus}}:\\n\\n{{data}}' }
            ];
        }
        var selectedIdx = -1;

        function save() { localStorage.setItem('aiMlPromptTemplates', JSON.stringify(templates)); }

        function renderList() {
            var list = document.getElementById('templateList');
            list.innerHTML = '';
            templates.forEach(function(t, i) {
                var el = document.createElement('div');
                el.className = 'template-item' + (i === selectedIdx ? ' active' : '');
                el.innerHTML = '<span class="tname">' + (t.name || 'Untitled') + '</span><span class="tcat">' + (t.cat || '') + '</span>';
                el.addEventListener('click', function() { selectTemplate(i); });
                list.appendChild(el);
            });
        }

        function selectTemplate(i) {
            selectedIdx = i;
            var t = templates[i];
            document.getElementById('tplName').value = t.name;
            document.getElementById('tplCat').value = t.cat;
            document.getElementById('tplBody').value = t.body;
            document.getElementById('editorSection').style.display = 'block';
            document.getElementById('renderSection').style.display = 'block';
            updateVars();
            renderList();
            renderTemplate();
        }

        function updateVars() {
            var body = document.getElementById('tplBody').value;
            var vars = [];
            var re = /\\{\\{(\\w+)\\}\\}/g;
            var m;
            while ((m = re.exec(body)) !== null) { if (vars.indexOf(m[1]) === -1) vars.push(m[1]); }
            var container = document.getElementById('varTags');
            container.innerHTML = '';
            vars.forEach(function(v) {
                var tag = document.createElement('span');
                tag.className = 'var-tag';
                tag.textContent = '{{' + v + '}}';
                container.appendChild(tag);
            });
            var renderDiv = document.getElementById('renderVars');
            renderDiv.innerHTML = '';
            vars.forEach(function(v) {
                var row = document.createElement('div');
                row.style.marginBottom = '8px';
                row.innerHTML = '<label>' + v + '</label><input type="text" class="tpl-var" data-var="' + v + '" placeholder="Value for ' + v + '">';
                renderDiv.appendChild(row);
            });
        }

        function renderTemplate() {
            if (selectedIdx < 0) return;
            var body = templates[selectedIdx].body;
            document.querySelectorAll('.tpl-var').forEach(function(el) {
                var val = el.value || '';
                body = body.replace(new RegExp('\\{\\{' + el.getAttribute('data-var') + '\\}\\}', 'g'), val);
            });
            var out = document.getElementById('renderedOutput');
            out.textContent = body;
            out.style.display = 'block';
        }

        document.getElementById('addTemplateBtn').addEventListener('click', function() {
            templates.push({ name: 'New Template', cat: '', body: '' });
            save();
            renderList();
            selectTemplate(templates.length - 1);
        });

        document.getElementById('deleteTemplateBtn').addEventListener('click', function() {
            if (selectedIdx < 0) { _toast('Select a template first', 'error'); return; }
            templates.splice(selectedIdx, 1);
            selectedIdx = -1;
            save();
            renderList();
            document.getElementById('editorSection').style.display = 'none';
            document.getElementById('renderSection').style.display = 'none';
            _toast('Deleted', 'success');
        });

        document.getElementById('saveTemplateBtn').addEventListener('click', function() {
            if (selectedIdx < 0) return;
            templates[selectedIdx].name = document.getElementById('tplName').value;
            templates[selectedIdx].cat = document.getElementById('tplCat').value;
            templates[selectedIdx].body = document.getElementById('tplBody').value;
            save();
            renderList();
            updateVars();
            _toast('Template saved', 'success');
        });

        document.getElementById('tplBody').addEventListener('input', updateVars);

        document.getElementById('renderBtn').addEventListener('click', renderTemplate);

        document.getElementById('copyRenderBtn').addEventListener('click', function() {
            var text = document.getElementById('renderedOutput').textContent;
            if (!text) { _toast('Nothing to copy', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        renderList();
    </script>
</body>
</html>`;
}

/* ================================================================
   3. PYTHON ML CODE GENERATOR
   ================================================================ */
function getMlCodeGenHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Python ML Code Generator</title>
    <style>
        ${SHARED_CSS}
        .codegen-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .category-label { font-size: 11px; font-weight: 700; color: var(--fg-2); text-transform: uppercase; margin: 12px 0 6px; letter-spacing: 0.5px; }
        .snippet-btn {
            display: block; width: 100%;
            text-align: left;
            padding: 8px 12px;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            color: var(--fg-0);
            font-size: 12px;
            cursor: pointer;
            transition: all var(--transition);
        }
        .snippet-btn:hover { border-color: var(--accent); background: rgba(0,122,204,0.06); }
        .snippet-btn .sname { font-weight: 600; }
        .snippet-btn .sdesc { color: var(--fg-2); font-size: 11px; }
        @media (max-width: 768px) { .codegen-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Python ML Code Generator</h1>
        <span class="subtitle">PyTorch, TensorFlow, HuggingFace, LangChain</span>
    </div>
    <div class="tool-body">
        <div class="codegen-grid">
            <div>
                <div class="category-label">PyTorch</div>
                <div id="pytorchBtns"></div>
                <div class="category-label">TensorFlow / Keras</div>
                <div id="tfBtns"></div>
            </div>
            <div>
                <div class="category-label">HuggingFace</div>
                <div id="hfBtns"></div>
                <div class="category-label">LangChain</div>
                <div id="lcBtns"></div>
            </div>
        </div>
        <div class="section" style="margin-top:16px;">
            <div class="btn-row" style="margin-bottom:10px;">
                <button class="btn" id="copyCodeBtn">Copy Code</button>
                <button class="btn btn-ghost" id="insertCodeBtn">Insert at Cursor</button>
            </div>
            <div class="result-block" id="codeOutput" style="min-height:200px;white-space:pre;">Select a template above to generate code...</div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var snippets = {
            pytorch: [
                { name: 'Training Loop', desc: 'Basic training loop with loss tracking', code: 'import torch\\nimport torch.nn as nn\\nimport torch.optim as optim\\nfrom torch.utils.data import DataLoader\\n\\n# Model\\nclass MyModel(nn.Module):\\n    def __init__(self, input_dim, hidden_dim, output_dim):\\n        super().__init__()\\n        self.layers = nn.Sequential(\\n            nn.Linear(input_dim, hidden_dim),\\n            nn.ReLU(),\\n            nn.Linear(hidden_dim, output_dim)\\n        )\\n\\n    def forward(self, x):\\n        return self.layers(x)\\n\\n# Training\\nmodel = MyModel(784, 256, 10).to(device)\\ncriterion = nn.CrossEntropyLoss()\\noptimizer = optim.Adam(model.parameters(), lr=1e-3)\\n\\nfor epoch in range(num_epochs):\\n    model.train()\\n    for batch_x, batch_y in train_loader:\\n        batch_x, batch_y = batch_x.to(device), batch_y.to(device)\\n        optimizer.zero_grad()\\n        output = model(batch_x)\\n        loss = criterion(output, batch_y)\\n        loss.backward()\\n        optimizer.step()\\n    print(f"Epoch {epoch+1}, Loss: {loss.item():.4f}")' },
                { name: 'CNN Image Classifier', desc: 'Convolutional network for images', code: 'import torch\\nimport torch.nn as nn\\n\\nclass CNNClassifier(nn.Module):\\n    def __init__(self, num_classes=10):\\n        super().__init__()\\n        self.features = nn.Sequential(\\n            nn.Conv2d(3, 32, 3, padding=1),\\n            nn.BatchNorm2d(32),\\n            nn.ReLU(),\\n            nn.MaxPool2d(2),\\n            nn.Conv2d(32, 64, 3, padding=1),\\n            nn.BatchNorm2d(64),\\n            nn.ReLU(),\\n            nn.MaxPool2d(2),\\n            nn.Conv2d(64, 128, 3, padding=1),\\n            nn.BatchNorm2d(128),\\n            nn.ReLU(),\\n            nn.AdaptiveAvgPool2d(1)\\n        )\\n        self.classifier = nn.Linear(128, num_classes)\\n\\n    def forward(self, x):\\n        x = self.features(x)\\n        x = x.view(x.size(0), -1)\\n        return self.classifier(x)' },
                { name: 'DataLoader Setup', desc: 'Dataset and DataLoader boilerplate', code: 'import torch\\nfrom torch.utils.data import Dataset, DataLoader\\nfrom sklearn.model_selection import train_test_split\\n\\nclass CustomDataset(Dataset):\\n    def __init__(self, features, labels):\\n        self.features = torch.tensor(features, dtype=torch.float32)\\n        self.labels = torch.tensor(labels, dtype=torch.long)\\n\\n    def __len__(self):\\n        return len(self.labels)\\n\\n    def __getitem__(self, idx):\\n        return self.features[idx], self.labels[idx]\\n\\n# Split data\\nX_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)\\n\\ntrain_dataset = CustomDataset(X_train, y_train)\\nval_dataset = CustomDataset(X_val, y_val)\\n\\ntrain_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)\\nval_loader = DataLoader(val_dataset, batch_size=64, shuffle=False)' },
                { name: 'Transfer Learning', desc: 'Fine-tune pretrained ResNet', code: 'import torch\\nimport torch.nn as nn\\nfrom torchvision import models\\n\\nmodel = models.resnet50(pretrained=True)\\n\\n# Freeze all layers\\nfor param in model.parameters():\\n    param.requires_grad = False\\n\\n# Replace classifier\\nnum_features = model.fc.in_features\\nmodel.fc = nn.Sequential(\\n    nn.Linear(num_features, 256),\\n    nn.ReLU(),\\n    nn.Dropout(0.3),\\n    nn.Linear(256, num_classes)\\n)\\n\\nmodel = model.to(device)' }
            ],
            tensorflow: [
                { name: 'Sequential Model', desc: 'Keras sequential API', code: 'import tensorflow as tf\\nfrom tensorflow import keras\\nfrom tensorflow.keras import layers\\n\\nmodel = keras.Sequential([\\n    layers.Dense(128, activation="relu", input_shape=(input_dim,)),\\n    layers.BatchNormalization(),\\n    layers.Dropout(0.3),\\n    layers.Dense(64, activation="relu"),\\n    layers.Dropout(0.2),\\n    layers.Dense(num_classes, activation="softmax")\\n])\\n\\nmodel.compile(\\n    optimizer=keras.optimizers.Adam(learning_rate=1e-3),\\n    loss="sparse_categorical_crossentropy",\\n    metrics=["accuracy"]\\n)\\n\\nhistory = model.fit(\\n    train_ds,\\n    validation_data=val_ds,\\n    epochs=50,\\n    callbacks=[\\n        keras.callbacks.EarlyStopping(patience=5, restore_best_weights=True),\\n        keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=3)\\n    ]\\n)' },
                { name: 'CNN Model', desc: 'Convolutional neural network', code: 'import tensorflow as tf\\nfrom tensorflow.keras import layers\\n\\nmodel = tf.keras.Sequential([\\n    layers.Conv2D(32, (3,3), activation="relu", input_shape=(28,28,1)),\\n    layers.MaxPooling2D((2,2)),\\n    layers.Conv2D(64, (3,3), activation="relu"),\\n    layers.MaxPooling2D((2,2)),\\n    layers.Conv2D(128, (3,3), activation="relu"),\\n    layers.GlobalAveragePooling2D(),\\n    layers.Dense(128, activation="relu"),\\n    layers.Dropout(0.5),\\n    layers.Dense(10, activation="softmax")\\n])' },
                { name: 'Data Pipeline', desc: 'tf.data pipeline with augmentation', code: 'import tensorflow as tf\\n\\ndef augment(image, label):\\n    image = tf.image.random_flip_left_right(image)\\n    image = tf.image.random_brightness(image, 0.2)\\n    image = tf.image.random_contrast(image, 0.8, 1.2)\\n    return image, label\\n\\ntrain_ds = tf.data.Dataset.from_tensor_slices((X_train, y_train))\\ntrain_ds = train_ds.map(augment, num_parallel_calls=tf.data.AUTOTUNE)\\ntrain_ds = train_ds.batch(32).prefetch(tf.data.AUTOTUNE)\\n\\nval_ds = tf.data.Dataset.from_tensor_slices((X_val, y_val))\\nval_ds = val_ds.batch(32).prefetch(tf.data.AUTOTUNE)' }
            ],
            huggingface: [
                { name: 'Text Classification', desc: 'Fine-tune BERT for classification', code: 'from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer, TrainingArguments\\n\\nmodel_name = "bert-base-uncased"\\ntokenizer = AutoTokenizer.from_pretrained(model_name)\\nmodel = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=num_labels)\\n\\ntraining_args = TrainingArguments(\\n    output_dir="./results",\\n    num_train_epochs=3,\\n    per_device_train_batch_size=16,\\n    per_device_eval_batch_size=32,\\n    warmup_steps=500,\\n    weight_decay=0.01,\\n    logging_dir="./logs",\\n    logging_steps=100,\\n    eval_strategy="epoch",\\n    save_strategy="epoch",\\n    load_best_model_at_end=True,\\n)\\n\\ntrainer = Trainer(\\n    model=model,\\n    args=training_args,\\n    train_dataset=train_dataset,\\n    eval_dataset=val_dataset,\\n)\\n\\ntrainer.train()' },
                { name: 'Text Generation', desc: 'Generate text with any model', code: 'from transformers import AutoTokenizer, AutoModelForCausalLM\\nimport torch\\n\\nmodel_name = "microsoft/DialoGPT-medium"\\ntokenizer = AutoTokenizer.from_pretrained(model_name)\\nmodel = AutoModelForCausalLM.from_pretrained(model_name)\\n\\ndef generate(prompt, max_new_tokens=100, temperature=0.7, top_p=0.9):\\n    inputs = tokenizer.encode(prompt, return_tensors="pt")\\n    with torch.no_grad():\\n        outputs = model.generate(\\n            inputs,\\n            max_new_tokens=max_new_tokens,\\n            temperature=temperature,\\n            top_p=top_p,\\n            do_sample=True,\\n            pad_token_id=tokenizer.eos_token_id\\n        )\\n    return tokenizer.decode(outputs[0], skip_special_tokens=True)\\n\\nresponse = generate("Hello, how are you?")\\nprint(response)' },
                { name: 'Embeddings Pipeline', desc: 'Compute sentence embeddings', code: 'from sentence_transformers import SentenceTransformer\\nimport numpy as np\\n\\nmodel = SentenceTransformer("all-MiniLM-L6-v2")\\n\\nsentences = [\\n    "This is a sample sentence.",\\n    "Each sentence is converted to a vector.",\\n    "These vectors can be used for similarity search."\\n]\\n\\nembeddings = model.encode(sentences)\\nprint(f"Shape: {embeddings.shape}")  # (3, 384)\\n\\n# Cosine similarity\\nfrom sklearn.metrics.pairwise import cosine_similarity\\nsim_matrix = cosine_similarity(embeddings)\\nprint(sim_matrix)' }
            ],
            langchain: [
                { name: 'RAG Chain', desc: 'Retrieval-augmented generation', code: 'from langchain_openai import ChatOpenAI, OpenAIEmbeddings\\nfrom langchain_community.vectorstores import FAISS\\nfrom langchain.text_splitter import RecursiveCharacterTextSplitter\\nfrom langchain.chains import RetrievalQA\\nfrom langchain_community.document_loaders import DirectoryLoader, TextLoader\\n\\n# Load and split docs\\nloader = DirectoryLoader("./docs", glob="**/*.txt", loader_cls=TextLoader)\\ndocs = loader.load()\\n\\ntext_splitter = RecursiveCharacterTextSplitter(\\n    chunk_size=1000,\\n    chunk_overlap=200,\\n    separators=["\\\\n\\\\n", "\\\\n", " ", ""]\\n)\\nchunks = text_splitter.split_documents(docs)\\n\\n# Create vector store\\nembeddings = OpenAIEmbeddings()\\nvectorstore = FAISS.from_documents(chunks, embeddings)\\n\\n# Create chain\\nllm = ChatOpenAI(model="gpt-4o", temperature=0)\\nqa_chain = RetrievalQA.from_chain_type(\\n    llm=llm,\\n    chain_type="stuff",\\n    retriever=vectorstore.as_retriever(search_kwargs={"k": 3}),\\n    return_source_documents=True\\n)\\n\\nresult = qa_chain.invoke({"query": "What is the main topic?"})\\nprint(result["result"])' },
                { name: 'Agent with Tools', desc: 'LLM agent with custom tools', code: 'from langchain_openai import ChatOpenAI\\nfrom langchain.agents import create_tool_calling_agent, AgentExecutor\\nfrom langchain_core.prompts import ChatPromptTemplate\\nfrom langchain_core.tools import tool\\n\\n@tool\\ndef calculator(expression: str) -> str:\\n    """Evaluate a mathematical expression."""\\n    return str(eval(expression))\\n\\n@tool\\ndef get_word_count(text: str) -> int:\\n    """Count words in text."""\\n    return len(text.split())\\n\\nllm = ChatOpenAI(model="gpt-4o", temperature=0)\\nprompt = ChatPromptTemplate.from_messages([\\n    ("system", "You are a helpful assistant. Use the provided tools."),\\n    ("human", "{input}"),\\n    ("placeholder", "{agent_scratchpad}")\\n])\\n\\nagent = create_tool_calling_agent(llm, [calculator, get_word_count], prompt)\\nexecutor = AgentExecutor(agent=agent, tools=[calculator, get_word_count], verbose=True)\\n\\nresult = executor.invoke({"input": "What is 42 * 17 + the word count of \\"hello world\\"?"})\\nprint(result["output"])' }
            ]
        };

        var currentCode = '';

        function renderButtons(category, containerId) {
            var container = document.getElementById(containerId);
            snippets[category].forEach(function(s) {
                var btn = document.createElement('button');
                btn.className = 'snippet-btn';
                btn.innerHTML = '<div class="sname">' + s.name + '</div><div class="sdesc">' + s.desc + '</div>';
                btn.addEventListener('click', function() {
                    currentCode = s.code;
                    document.getElementById('codeOutput').textContent = s.code;
                });
                container.appendChild(btn);
            });
        }

        renderButtons('pytorch', 'pytorchBtns');
        renderButtons('tensorflow', 'tfBtns');
        renderButtons('huggingface', 'hfBtns');
        renderButtons('langchain', 'lcBtns');

        document.getElementById('copyCodeBtn').addEventListener('click', function() {
            if (!currentCode) { _toast('Select a template first', 'error'); return; }
            navigator.clipboard.writeText(currentCode).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('insertCodeBtn').addEventListener('click', function() {
            if (!currentCode) { _toast('Select a template first', 'error'); return; }
            var vscode = acquireVsCodeApi();
            vscode.postMessage({ command: 'insertCode', code: currentCode });
            _toast('Inserted at cursor', 'success');
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   4. LLM API TESTER
   ================================================================ */
function getLlmApiTesterHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLM API Tester</title>
    <style>
        ${SHARED_CSS}
        .provider-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
        .provider-tab {
            padding: 6px 14px;
            border-radius: var(--radius-sm);
            font-size: 12px; font-weight: 600;
            cursor: pointer;
            background: var(--bg-2);
            border: 1px solid var(--border);
            color: var(--fg-1);
            transition: all var(--transition);
        }
        .provider-tab.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
        .response-area {
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            font-family: var(--mono);
            font-size: 13px;
            line-height: 1.7;
            white-space: pre-wrap;
            max-height: 400px;
            overflow-y: auto;
            min-height: 100px;
        }
        .response-meta { font-size: 11px; color: var(--fg-2); margin-top: 8px; display: flex; gap: 16px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>LLM API Tester</h1>
        <span class="subtitle">Test OpenAI, Anthropic, Gemini endpoints</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="provider-tabs" id="providerTabs">
                <div class="provider-tab active" data-provider="openai">OpenAI</div>
                <div class="provider-tab" data-provider="anthropic">Anthropic</div>
                <div class="provider-tab" data-provider="gemini">Gemini</div>
                <div class="provider-tab" data-provider="ollama">Ollama</div>
            </div>
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;">
                <div><label>API Endpoint</label><input type="text" id="endpoint" value="https://api.openai.com/v1/chat/completions"></div>
                <div><label>API Key</label><input type="password" id="apiKey" placeholder="sk-..."></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
                <div><label>Model</label><input type="text" id="model" value="gpt-4o"></div>
                <div><label>Temperature</label><input type="number" id="temperature" value="0.7" min="0" max="2" step="0.1"></div>
            </div>
        </div>
        <div class="section">
            <label>System Prompt</label>
            <textarea id="systemPrompt" rows="3" placeholder="You are a helpful assistant."></textarea>
        </div>
        <div class="section">
            <label>User Message</label>
            <textarea id="userMessage" rows="4" placeholder="Enter your message..."></textarea>
            <div class="btn-row" style="margin-top:12px;">
                <button class="btn" id="sendBtn">Send Request</button>
                <button class="btn btn-ghost" id="clearResponseBtn">Clear Response</button>
            </div>
        </div>
        <div class="section">
            <label>Response</label>
            <div class="response-area" id="responseArea">Response will appear here...</div>
            <div class="response-meta" id="responseMeta" style="display:none;">
                <span id="metaTokens">Tokens: -</span>
                <span id="metaTime">Time: -</span>
                <span id="metaModel">Model: -</span>
            </div>
            <div class="btn-row" style="margin-top:8px;">
                <button class="btn btn-ghost" id="copyResponseBtn">Copy Response</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var providers = {
            openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', headerKey: 'Authorization', headerPrefix: 'Bearer ' },
            anthropic: { endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514', headerKey: 'x-api-key', headerPrefix: '' },
            gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/', model: 'gemini-2.0-flash', headerKey: 'x-goog-api-key', headerPrefix: '' },
            ollama: { endpoint: 'http://localhost:11434/api/chat', model: 'llama3.1', headerKey: '', headerPrefix: '' }
        };
        var currentProvider = 'openai';

        document.querySelectorAll('.provider-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.provider-tab').forEach(function(t) { t.classList.remove('active'); });
                tab.classList.add('active');
                currentProvider = tab.getAttribute('data-provider');
                var p = providers[currentProvider];
                document.getElementById('endpoint').value = p.endpoint;
                document.getElementById('model').value = p.model;
            });
        });

        document.getElementById('sendBtn').addEventListener('click', async function() {
            var apiKey = document.getElementById('apiKey').value;
            var model = document.getElementById('model').value;
            var sysPrompt = document.getElementById('systemPrompt').value;
            var userMsg = document.getElementById('userMessage').value;
            var temp = parseFloat(document.getElementById('temperature').value);
            var endpoint = document.getElementById('endpoint').value;

            if (!userMsg) { _toast('Enter a message', 'error'); return; }

            var responseArea = document.getElementById('responseArea');
            responseArea.textContent = 'Loading...';
            document.getElementById('responseMeta').style.display = 'none';
            var startTime = Date.now();

            try {
                var headers = { 'Content-Type': 'application/json' };
                var body = {};

                if (currentProvider === 'openai' || currentProvider === 'ollama') {
                    headers[providers[currentProvider].headerKey] = providers[currentProvider].headerPrefix + apiKey;
                    var messages = [];
                    if (sysPrompt) messages.push({ role: 'system', content: sysPrompt });
                    messages.push({ role: 'user', content: userMsg });
                    body = { model: model, messages: messages, temperature: temp, max_tokens: 2048 };
                } else if (currentProvider === 'anthropic') {
                    headers[providers[currentProvider].headerKey] = apiKey;
                    headers['anthropic-version'] = '2023-06-01';
                    body = { model: model, max_tokens: 2048, temperature: temp, messages: [{ role: 'user', content: userMsg }] };
                    if (sysPrompt) body.system = sysPrompt;
                } else if (currentProvider === 'gemini') {
                    endpoint = endpoint + model + ':generateContent?key=' + apiKey;
                    var contents = [];
                    if (sysPrompt) contents.push({ role: 'user', parts: [{ text: sysPrompt }] });
                    contents.push({ role: 'user', parts: [{ text: userMsg }] });
                    body = { contents: contents, generationConfig: { temperature: temp, maxOutputTokens: 2048 } };
                }

                var resp = await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(body) });
                var elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

                if (!resp.ok) {
                    var errText = await resp.text();
                    responseArea.textContent = 'Error ' + resp.status + ': ' + errText;
                    return;
                }

                var data = await resp.json();
                var content = '';
                var tokens = '-';

                if (currentProvider === 'openai' || currentProvider === 'ollama') {
                    content = data.choices && data.choices[0] ? data.choices[0].message.content : JSON.stringify(data, null, 2);
                    if (data.usage) tokens = data.usage.total_tokens;
                } else if (currentProvider === 'anthropic') {
                    content = data.content && data.content[0] ? data.content[0].text : JSON.stringify(data, null, 2);
                    if (data.usage) tokens = data.usage.input_tokens + ' in / ' + data.usage.output_tokens + ' out';
                } else if (currentProvider === 'gemini') {
                    content = data.candidates && data.candidates[0] ? data.candidates[0].content.parts[0].text : JSON.stringify(data, null, 2);
                    if (data.usageMetadata) tokens = data.usageMetadata.totalTokenCount;
                }

                responseArea.textContent = content;
                document.getElementById('metaTokens').textContent = 'Tokens: ' + tokens;
                document.getElementById('metaTime').textContent = 'Time: ' + elapsed + 's';
                document.getElementById('metaModel').textContent = 'Model: ' + model;
                document.getElementById('responseMeta').style.display = 'flex';
            } catch (e) {
                responseArea.textContent = 'Error: ' + e.message;
            }
        });

        document.getElementById('clearResponseBtn').addEventListener('click', function() {
            document.getElementById('responseArea').textContent = 'Response will appear here...';
            document.getElementById('responseMeta').style.display = 'none';
        });

        document.getElementById('copyResponseBtn').addEventListener('click', function() {
            var text = document.getElementById('responseArea').textContent;
            if (!text || text === 'Response will appear here...') { _toast('Nothing to copy', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   5. DATASET SPLIT CALCULATOR
   ================================================================ */
function getDatasetSplitHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dataset Split Calculator</title>
    <style>
        ${SHARED_CSS}
        .split-bar { display: flex; height: 40px; border-radius: var(--radius-sm); overflow: hidden; margin-top: 12px; }
        .split-bar div { display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: #fff; }
        .train-bar { background: #2196f3; }
        .val-bar { background: #ff9800; }
        .test-bar { background: #4caf50; }
        .split-legend { display: flex; gap: 20px; margin-top: 10px; font-size: 12px; }
        .split-legend span { display: flex; align-items: center; gap: 6px; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        .result-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 14px; }
        .result-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; text-align: center; }
        .result-card .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .result-card .value { font-size: 20px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Dataset Split Calculator</h1>
        <span class="subtitle">Calculate train/val/test splits</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                <div><label>Total Samples</label><input type="number" id="totalSamples" value="10000" min="1"></div>
                <div><label>Train %</label><input type="number" id="trainPct" value="70" min="0" max="100"></div>
                <div><label>Val %</label><input type="number" id="valPct" value="15" min="0" max="100"></div>
            </div>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                <div><label>Test %</label><input type="number" id="testPct" value="15" min="0" max="100" readonly></div>
                <div><label>Random Seed</label><input type="number" id="seed" value="42"></div>
                <div><label>Stratify</label><select id="stratify"><option value="no">No</option><option value="yes">Yes</option></select></div>
            </div>
            <div class="btn-row" style="margin-top:14px;">
                <button class="btn" id="calcBtn">Calculate Split</button>
                <button class="btn btn-ghost" id="copySplitBtn">Copy Config</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="split-bar" id="splitBar"></div>
            <div class="split-legend">
                <span><span class="legend-dot" style="background:#2196f3;"></span> Train</span>
                <span><span class="legend-dot" style="background:#ff9800;"></span> Validation</span>
                <span><span class="legend-dot" style="background:#4caf50;"></span> Test</span>
            </div>
            <div class="result-grid" id="resultGrid"></div>
            <div class="section" style="margin-top:14px;">
                <label>Python Code</label>
                <div class="result-block" id="splitCode"></div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('trainPct').addEventListener('input', function() {
            var train = parseInt(this.value) || 0;
            var val = parseInt(document.getElementById('valPct').value) || 0;
            document.getElementById('testPct').value = Math.max(0, 100 - train - val);
        });
        document.getElementById('valPct').addEventListener('input', function() {
            var train = parseInt(document.getElementById('trainPct').value) || 0;
            var val = parseInt(this.value) || 0;
            document.getElementById('testPct').value = Math.max(0, 100 - train - val);
        });

        document.getElementById('calcBtn').addEventListener('click', function() {
            var total = parseInt(document.getElementById('totalSamples').value) || 10000;
            var trainPct = parseInt(document.getElementById('trainPct').value) || 70;
            var valPct = parseInt(document.getElementById('valPct').value) || 15;
            var testPct = 100 - trainPct - valPct;
            var seed = parseInt(document.getElementById('seed').value) || 42;
            var stratify = document.getElementById('stratify').value === 'yes';

            var trainCount = Math.round(total * trainPct / 100);
            var valCount = Math.round(total * valPct / 100);
            var testCount = total - trainCount - valCount;

            var bar = document.getElementById('splitBar');
            bar.innerHTML = '<div class="train-bar" style="width:' + trainPct + '%">' + trainPct + '%</div>' +
                '<div class="val-bar" style="width:' + valPct + '%">' + valPct + '%</div>' +
                '<div class="test-bar" style="width:' + testPct + '%">' + testPct + '%</div>';

            var grid = document.getElementById('resultGrid');
            grid.innerHTML = '<div class="result-card"><div class="label">Train</div><div class="value" style="color:#2196f3;">' + trainCount.toLocaleString() + '</div></div>' +
                '<div class="result-card"><div class="label">Validation</div><div class="value" style="color:#ff9800;">' + valCount.toLocaleString() + '</div></div>' +
                '<div class="result-card"><div class="label">Test</div><div class="value" style="color:#4caf50;">' + testCount.toLocaleString() + '</div></div>';

            var stratParam = stratify ? ', stratify=y' : '';
            var code = 'from sklearn.model_selection import train_test_split\\n\\nX_train, X_temp, y_train, y_temp = train_test_split(\\n    X, y,\\n    test_size=' + ((valPct + testPct) / 100).toFixed(2) + ',\\n    random_state=' + seed + stratParam + '\\n)\\n\\nX_val, X_test, y_val, y_test = train_test_split(\\n    X_temp, y_temp,\\n    test_size=' + (testPct / (valPct + testPct)).toFixed(2) + ',\\n    random_state=' + seed + stratParam + '\\n)\\n\\nprint(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")';
            document.getElementById('splitCode').textContent = code;
            document.getElementById('resultSection').style.display = 'block';
        });

        document.getElementById('copySplitBtn').addEventListener('click', function() {
            var code = document.getElementById('splitCode').textContent;
            if (!code) { _toast('Calculate first', 'error'); return; }
            navigator.clipboard.writeText(code).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   6. GPU VRAM CALCULATOR
   ================================================================ */
function getGpuVramHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GPU VRAM Calculator</title>
    <style>
        ${SHARED_CSS}
        .vram-result { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-top: 14px; }
        .vram-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; text-align: center; }
        .vram-card .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .vram-card .value { font-size: 18px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
        .gpu-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; margin-top: 12px; }
        .gpu-item {
            padding: 10px 12px;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            cursor: pointer;
            transition: all var(--transition);
            font-size: 12px;
        }
        .gpu-item:hover, .gpu-item.active { border-color: var(--accent); }
        .gpu-item .gname { font-weight: 700; }
        .gpu-item .gmem { color: var(--fg-2); font-family: var(--mono); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>GPU VRAM Calculator</h1>
        <span class="subtitle">Estimate memory requirements for models</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Quick Select GPU</div>
            <div class="gpu-list" id="gpuList"></div>
        </div>
        <div class="section">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
                <div><label>Model Parameters (B)</label><input type="number" id="modelParams" value="7" min="0.01" step="0.1"></div>
                <div><label>Precision</label>
                    <select id="precision">
                        <option value="fp32">FP32 (32-bit)</option>
                        <option value="fp16" selected>FP16 (16-bit)</option>
                        <option value="bf16">BF16 (16-bit)</option>
                        <option value="int8">INT8 (8-bit)</option>
                        <option value="int4">INT4 (4-bit)</option>
                    </select>
                </div>
                <div><label>GPU Memory (GB)</label><input type="number" id="gpuMemory" value="24" min="1"></div>
            </div>
            <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>Batch Size</label><input type="number" id="batchSize" value="1" min="1"></div>
                <div><label>Sequence Length</label><input type="number" id="seqLen" value="2048" min="1"></div>
            </div>
            <div class="btn-row" style="margin-top:14px;">
                <button class="btn" id="calcBtn">Calculate VRAM</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="vram-result" id="vramResult"></div>
            <div class="section" style="margin-top:14px;">
                <label>Details</label>
                <div class="result-block" id="vramDetails"></div>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var gpus = [
            { name: 'RTX 4090', mem: 24 }, { name: 'RTX 4080', mem: 16 },
            { name: 'RTX 3090', mem: 24 }, { name: 'RTX 3080', mem: 10 },
            { name: 'A100 80GB', mem: 80 }, { name: 'A100 40GB', mem: 40 },
            { name: 'H100', mem: 80 }, { name: 'L40S', mem: 48 },
            { name: 'V100', mem: 16 }, { name: 'T4', mem: 16 },
            { name: 'M1 Ultra', mem: 128 }, { name: 'M2 Max', mem: 96 }
        ];

        var gpuList = document.getElementById('gpuList');
        gpus.forEach(function(g) {
            var el = document.createElement('div');
            el.className = 'gpu-item';
            el.innerHTML = '<div class="gname">' + g.name + '</div><div class="gmem">' + g.mem + ' GB</div>';
            el.addEventListener('click', function() {
                document.querySelectorAll('.gpu-item').forEach(function(e) { e.classList.remove('active'); });
                el.classList.add('active');
                document.getElementById('gpuMemory').value = g.mem;
            });
            gpuList.appendChild(el);
        });

        document.getElementById('calcBtn').addEventListener('click', function() {
            var params = parseFloat(document.getElementById('modelParams').value) || 7;
            var precision = document.getElementById('precision').value;
            var gpuMem = parseInt(document.getElementById('gpuMemory').value) || 24;
            var batchSize = parseInt(document.getElementById('batchSize').value) || 1;
            var seqLen = parseInt(document.getElementById('seqLen').value) || 2048;

            var bytesPerParam = { fp32: 4, fp16: 2, bf16: 2, int8: 1, int4: 0.5 };
            var bp = bytesPerParam[precision];

            var modelGB = (params * 1e9 * bp) / (1024 ** 3);
            var optimizerGB = modelGB * 2;
            var gradGB = modelGB;
            var activationGB = (batchSize * seqLen * 4 * 1024) / (1024 ** 3) * 0.5;
            var totalGB = modelGB + optimizerGB + gradGB + activationGB;
            var totalTrainGB = totalGB * 1.2;
            var fits = gpuMem >= totalTrainGB;
            var maxBatch = Math.max(1, Math.floor((gpuMem - modelGB * 1.2) / (modelGB * 0.5 + activationGB / batchSize)));

            var resultDiv = document.getElementById('vramResult');
            resultDiv.innerHTML = '<div class="vram-card"><div class="label">Model Weights</div><div class="value">' + modelGB.toFixed(2) + ' GB</div></div>' +
                '<div class="vram-card"><div class="label">Optimizer (Adam)</div><div class="value">' + optimizerGB.toFixed(2) + ' GB</div></div>' +
                '<div class="vram-card"><div class="label">Gradients</div><div class="value">' + gradGB.toFixed(2) + ' GB</div></div>' +
                '<div class="vram-card"><div class="label">Activations</div><div class="value">' + activationGB.toFixed(2) + ' GB</div></div>' +
                '<div class="vram-card"><div class="label">Total Est.</div><div class="value" style="color:' + (fits ? 'var(--success)' : 'var(--error)') + ';">' + totalTrainGB.toFixed(2) + ' GB</div></div>' +
                '<div class="vram-card"><div class="label">Fits on GPU?</div><div class="value" style="color:' + (fits ? 'var(--success)' : 'var(--error)') + ';">' + (fits ? 'YES' : 'NO') + '</div></div>' +
                '<div class="vram-card"><div class="label">Max Batch Size</div><div class="value">' + maxBatch + '</div></div>';

            var details = 'Parameters: ' + params + 'B\\nPrecision: ' + precision.toUpperCase() + ' (' + bp + ' bytes/param)\\n' +
                'Model weights: ' + modelGB.toFixed(2) + ' GB\\nOptimizer state (Adam): ' + optimizerGB.toFixed(2) + ' GB\\n' +
                'Gradients: ' + gradGB.toFixed(2) + ' GB\\nActivations (batch=' + batchSize + ', seq=' + seqLen + '): ' + activationGB.toFixed(2) + ' GB\\n' +
                'Total estimated: ' + totalTrainGB.toFixed(2) + ' GB\\nGPU available: ' + gpuMem + ' GB\\n' +
                'Headroom: ' + (gpuMem - totalTrainGB).toFixed(2) + ' GB';
            document.getElementById('vramDetails').textContent = details;
            document.getElementById('resultSection').style.display = 'block';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   7. EXPERIMENT LOGGER
   ================================================================ */
function getExperimentLoggerHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Experiment Logger</title>
    <style>
        ${SHARED_CSS}
        .log-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .metric-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
        .metric-row input { flex: 1; }
        .log-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
        .log-table th { background: var(--bg-2); padding: 8px; text-align: left; border: 1px solid var(--border); font-weight: 600; }
        .log-table td { padding: 8px; border: 1px solid var(--border); font-family: var(--mono); font-size: 11px; }
        @media (max-width: 768px) { .log-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Experiment Logger</h1>
        <span class="subtitle">Track hyperparameters and metrics</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Experiment Info</div>
            <div class="log-grid">
                <div><label>Experiment Name</label><input type="text" id="expName" placeholder="e.g. BERT fine-tune v2"></div>
                <div><label>Date</label><input type="text" id="expDate"></div>
                <div><label>Model</label><input type="text" id="expModel" placeholder="e.g. bert-base-uncased"></div>
                <div><label>Dataset</label><input type="text" id="expDataset" placeholder="e.g. IMDB Reviews"></div>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Hyperparameters</div>
            <div id="hyperParams"></div>
            <button class="btn btn-ghost" id="addHyperBtn" style="margin-top:8px;">+ Add Parameter</button>
        </div>
        <div class="section">
            <div class="section-title">Metrics</div>
            <div id="metricsList"></div>
            <button class="btn btn-ghost" id="addMetricBtn" style="margin-top:8px;">+ Add Metric</button>
        </div>
        <div class="section">
            <label>Notes</label>
            <textarea id="expNotes" rows="3" placeholder="Observations, issues, ideas..."></textarea>
        </div>
        <div class="btn-row">
            <button class="btn" id="logBtn">Log Experiment</button>
            <button class="btn btn-ghost" id="exportBtn">Export as Markdown</button>
            <button class="btn btn-ghost" id="clearLogBtn">Clear</button>
        </div>
        <div class="section" id="logSection" style="display:none;margin-top:16px;">
            <div class="section-title">Logged Experiments</div>
            <div id="logOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var hyperCount = 0;
        var metricCount = 0;

        document.getElementById('expDate').value = new Date().toISOString().split('T')[0];

        function addHyperRow(key, val) {
            var div = document.createElement('div');
            div.className = 'metric-row';
            div.innerHTML = '<input type="text" placeholder="Parameter" class="hyper-key" value="' + (key || '') + '">' +
                '<input type="text" placeholder="Value" class="hyper-val" value="' + (val || '') + '">' +
                '<button class="btn btn-ghost btn-danger" style="padding:4px 8px;font-size:11px;">x</button>';
            div.querySelector('button').addEventListener('click', function() { div.remove(); });
            document.getElementById('hyperParams').appendChild(div);
        }

        function addMetricRow(key, val) {
            var div = document.createElement('div');
            div.className = 'metric-row';
            div.innerHTML = '<input type="text" placeholder="Metric" class="metric-key" value="' + (key || '') + '">' +
                '<input type="text" placeholder="Value" class="metric-val" value="' + (val || '') + '">' +
                '<button class="btn btn-ghost btn-danger" style="padding:4px 8px;font-size:11px;">x</button>';
            div.querySelector('button').addEventListener('click', function() { div.remove(); });
            document.getElementById('metricsList').appendChild(div);
        }

        addHyperRow('learning_rate', '2e-5');
        addHyperRow('batch_size', '16');
        addHyperRow('epochs', '3');
        addMetricRow('accuracy', '');
        addMetricRow('f1_score', '');
        addMetricRow('loss', '');

        document.getElementById('addHyperBtn').addEventListener('click', function() { addHyperRow(); });
        document.getElementById('addMetricBtn').addEventListener('click', function() { addMetricRow(); });

        document.getElementById('logBtn').addEventListener('click', function() {
            var name = document.getElementById('expName').value || 'Untitled';
            var date = document.getElementById('expDate').value;
            var model = document.getElementById('expModel').value;
            var dataset = document.getElementById('expDataset').value;
            var notes = document.getElementById('expNotes').value;

            var hypers = {};
            document.querySelectorAll('.hyper-key').forEach(function(el, i) {
                var k = el.value;
                var v = document.querySelectorAll('.hyper-val')[i].value;
                if (k) hypers[k] = v;
            });
            var metrics = {};
            document.querySelectorAll('.metric-key').forEach(function(el, i) {
                var k = el.value;
                var v = document.querySelectorAll('.metric-val')[i].value;
                if (k) metrics[k] = v;
            });

            var html = '<table class="log-table"><tr><th colspan="2">' + name + ' (' + date + ')</th></tr>' +
                '<tr><td>Model</td><td>' + model + '</td></tr>' +
                '<tr><td>Dataset</td><td>' + dataset + '</td></tr>';
            Object.keys(hypers).forEach(function(k) { html += '<tr><td>' + k + '</td><td>' + hypers[k] + '</td></tr>'; });
            Object.keys(metrics).forEach(function(k) { html += '<tr><td>' + k + '</td><td>' + metrics[k] || 'pending' + '</td></tr>'; });
            if (notes) html += '<tr><td>Notes</td><td>' + notes + '</td></tr>';
            html += '</table>';

            document.getElementById('logOutput').innerHTML += html;
            document.getElementById('logSection').style.display = 'block';
            _toast('Experiment logged', 'success');
        });

        document.getElementById('exportBtn').addEventListener('click', function() {
            var md = '# ' + (document.getElementById('expName').value || 'Experiment') + '\\n\\n';
            md += '- **Date:** ' + document.getElementById('expDate').value + '\\n';
            md += '- **Model:** ' + document.getElementById('expModel').value + '\\n';
            md += '- **Dataset:** ' + document.getElementById('expDataset').value + '\\n\\n';
            md += '## Hyperparameters\\n\\n| Param | Value |\\n|---|---|\\n';
            document.querySelectorAll('.hyper-key').forEach(function(el, i) {
                var k = el.value;
                var v = document.querySelectorAll('.hyper-val')[i].value;
                if (k) md += '| ' + k + ' | ' + v + ' |\\n';
            });
            md += '\\n## Metrics\\n\\n| Metric | Value |\\n|---|---|\\n';
            document.querySelectorAll('.metric-key').forEach(function(el, i) {
                var k = el.value;
                var v = document.querySelectorAll('.metric-val')[i].value;
                if (k) md += '| ' + k + ' | ' + (v || 'pending') + ' |\\n';
            });
            var notes = document.getElementById('expNotes').value;
            if (notes) md += '\\n## Notes\\n\\n' + notes + '\\n';
            navigator.clipboard.writeText(md).then(function() { _toast('Copied as Markdown!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearLogBtn').addEventListener('click', function() {
            document.getElementById('logOutput').innerHTML = '';
            document.getElementById('logSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   8. MODEL CARD GENERATOR
   ================================================================ */
function getModelCardHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Model Card Generator</title>
    <style>
        ${SHARED_CSS}
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .preview-area {
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 16px;
            font-family: var(--mono);
            font-size: 12px;
            line-height: 1.7;
            white-space: pre-wrap;
            max-height: 500px;
            overflow-y: auto;
        }
        @media (max-width: 768px) { .form-grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Model Card Generator</h1>
        <span class="subtitle">HuggingFace-format model documentation</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Model Details</div>
            <div class="form-grid">
                <div><label>Model Name</label><input type="text" id="mcName" placeholder="e.g. MyBERT-v2"></div>
                <div><label>Version</label><input type="text" id="mcVersion" value="1.0"></div>
                <div><label>Architecture</label><input type="text" id="mcArch" placeholder="e.g. BERT, GPT-2, ResNet"></div>
                <div><label>Task</label><input type="text" id="mcTask" placeholder="e.g. Text Classification"></div>
                <div><label>Language</label><input type="text" id="mcLang" value="English"></div>
                <div><label>License</label><input type="text" id="mcLicense" value="Apache 2.0"></div>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Training Data</div>
            <div class="form-grid">
                <div><label>Dataset Name</label><input type="text" id="mcDataset" placeholder="e.g. IMDB Reviews"></div>
                <div><label>Size</label><input type="text" id="mcDataSize" placeholder="e.g. 50,000 samples"></div>
            </div>
            <div style="margin-top:12px;"><label>Preprocessing Steps</label><textarea id="mcPreprocess" rows="2" placeholder="Tokenization, lowercasing, etc."></textarea></div>
        </div>
        <div class="section">
            <div class="section-title">Training Procedure</div>
            <div class="form-grid">
                <div><label>Optimizer</label><input type="text" id="mcOptimizer" value="AdamW"></div>
                <div><label>Learning Rate</label><input type="text" id="mcLR" value="2e-5"></div>
                <div><label>Batch Size</label><input type="text" id="mcBatch" value="16"></div>
                <div><label>Epochs</label><input type="text" id="mcEpochs" value="3"></div>
                <div><label>Hardware</label><input type="text" id="mcHardware" placeholder="e.g. 1x A100 80GB"></div>
                <div><label>Training Time</label><input type="text" id="mcTime" placeholder="e.g. 2 hours"></div>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Evaluation Results</div>
            <div id="evalMetrics"></div>
            <button class="btn btn-ghost" id="addEvalBtn" style="margin-top:8px;">+ Add Metric</button>
        </div>
        <div class="section">
            <div class="section-title">Intended Use & Limitations</div>
            <div style="margin-bottom:12px;"><label>Intended Use</label><textarea id="mcUse" rows="2" placeholder="What the model is designed for..."></textarea></div>
            <div style="margin-bottom:12px;"><label>Out-of-Scope Use</label><textarea id="mcOOS" rows="2" placeholder="What the model should NOT be used for..."></textarea></div>
            <div><label>Limitations & Biases</label><textarea id="mcLimit" rows="2" placeholder="Known limitations, biases, edge cases..."></textarea></div>
        </div>
        <div class="btn-row">
            <button class="btn" id="generateBtn">Generate Model Card</button>
            <button class="btn btn-ghost" id="copyCardBtn">Copy to Clipboard</button>
        </div>
        <div class="section" id="previewSection" style="display:none;margin-top:16px;">
            <div class="section-title">Preview</div>
            <div class="preview-area" id="preview"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function addEvalRow(metric, value) {
            var div = document.createElement('div');
            div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
            div.innerHTML = '<input type="text" placeholder="Metric name" class="eval-metric" value="' + (metric || '') + '">' +
                '<input type="text" placeholder="Value" class="eval-value" value="' + (value || '') + '">' +
                '<button class="btn btn-ghost btn-danger" style="padding:4px 8px;font-size:11px;">x</button>';
            div.querySelector('button').addEventListener('click', function() { div.remove(); });
            document.getElementById('evalMetrics').appendChild(div);
        }

        addEvalRow('Accuracy', '');
        addEvalRow('F1 Score', '');
        addEvalRow('Precision', '');
        addEvalRow('Recall', '');

        document.getElementById('addEvalBtn').addEventListener('click', function() { addEvalRow(); });

        document.getElementById('generateBtn').addEventListener('click', function() {
            var v = function(id) { return document.getElementById(id).value; };
            var card = '# Model Card\\n\\n';
            card += '## Model Details\\n\\n';
            card += '- **Model Name:** ' + v('mcName') + '\\n';
            card += '- **Version:** ' + v('mcVersion') + '\\n';
            card += '- **Architecture:** ' + v('mcArch') + '\\n';
            card += '- **Task:** ' + v('mcTask') + '\\n';
            card += '- **Language:** ' + v('mcLang') + '\\n';
            card += '- **License:** ' + v('mcLicense') + '\\n\\n';
            card += '## Training Data\\n\\n';
            card += '- **Dataset:** ' + v('mcDataset') + '\\n';
            card += '- **Size:** ' + v('mcDataSize') + '\\n';
            card += '- **Preprocessing:** ' + v('mcPreprocess') + '\\n\\n';
            card += '## Training Procedure\\n\\n';
            card += '| Hyperparameter | Value |\\n|---|---|\\n';
            card += '| Optimizer | ' + v('mcOptimizer') + ' |\\n';
            card += '| Learning Rate | ' + v('mcLR') + ' |\\n';
            card += '| Batch Size | ' + v('mcBatch') + ' |\\n';
            card += '| Epochs | ' + v('mcEpochs') + ' |\\n';
            card += '| Hardware | ' + v('mcHardware') + ' |\\n';
            card += '| Training Time | ' + v('mcTime') + ' |\\n\\n';
            card += '## Evaluation Results\\n\\n';
            card += '| Metric | Value |\\n|---|---|\\n';
            document.querySelectorAll('.eval-metric').forEach(function(el, i) {
                var m = el.value;
                var val = document.querySelectorAll('.eval-value')[i].value;
                if (m) card += '| ' + m + ' | ' + val + ' |\\n';
            });
            card += '\\n## Intended Use\\n\\n' + v('mcUse') + '\\n\\n';
            card += '## Out-of-Scope Use\\n\\n' + v('mcOOS') + '\\n\\n';
            card += '## Limitations & Biases\\n\\n' + v('mcLimit') + '\\n';
            document.getElementById('preview').textContent = card;
            document.getElementById('previewSection').style.display = 'block';
        });

        document.getElementById('copyCardBtn').addEventListener('click', function() {
            var text = document.getElementById('preview').textContent;
            if (!text) { _toast('Generate first', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   9. JSONL VIEWER
   ================================================================ */
function getJsonlViewerHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSONL Viewer</title>
    <style>
        ${SHARED_CSS}
        .jsonl-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .jsonl-table th { background: var(--bg-2); padding: 8px 10px; text-align: left; border: 1px solid var(--border); font-weight: 700; position: sticky; top: 0; }
        .jsonl-table td { padding: 6px 10px; border: 1px solid var(--border); font-family: var(--mono); font-size: 11px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: top; }
        .jsonl-table tr:hover td { background: rgba(0,122,204,0.05); }
        .table-scroll { max-height: 500px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); }
        .stats-bar { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--fg-1); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>JSONL Viewer</h1>
        <span class="subtitle">Inspect JSONL training data files</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Paste JSONL Data (one JSON object per line)</label>
            <textarea id="jsonlInput" rows="8" placeholder='{"text": "Hello", "label": 0}\n{"text": "World", "label": 1}'></textarea>
            <div class="btn-row" style="margin-top:10px;">
                <button class="btn" id="parseBtn">Parse JSONL</button>
                <button class="btn btn-ghost" id="loadSampleBtn">Load Sample</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="stats-bar" id="statsBar"></div>
            <div class="table-scroll" id="tableContainer" style="margin-top:10px;"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('loadSampleBtn').addEventListener('click', function() {
            var sample = '{"id": 1, "text": "The movie was fantastic!", "label": "positive", "score": 0.95}\\n' +
                '{"id": 2, "text": "Terrible experience, would not recommend.", "label": "negative", "score": 0.87}\\n' +
                '{"id": 3, "text": "It was okay, nothing special.", "label": "neutral", "score": 0.62}\\n' +
                '{"id": 4, "text": "Absolutely loved every minute!", "label": "positive", "score": 0.98}\\n' +
                '{"id": 5, "text": "Waste of time and money.", "label": "negative", "score": 0.91}\\n' +
                '{"id": 6, "text": "Average at best.", "label": "neutral", "score": 0.55}\\n' +
                '{"id": 7, "text": "Brilliant acting and storyline.", "label": "positive", "score": 0.93}\\n' +
                '{"id": 8, "text": "I fell asleep halfway through.", "label": "negative", "score": 0.78}';
            document.getElementById('jsonlInput').value = sample;
        });

        document.getElementById('parseBtn').addEventListener('click', function() {
            var input = document.getElementById('jsonlInput').value.trim();
            if (!input) { _toast('Paste JSONL data first', 'error'); return; }

            var lines = input.split('\\n').filter(function(l) { return l.trim(); });
            var objects = [];
            var errors = [];
            lines.forEach(function(line, i) {
                try {
                    objects.push(JSON.parse(line));
                } catch (e) {
                    errors.push('Line ' + (i + 1) + ': ' + e.message);
                }
            });

            if (errors.length) {
                _toast(errors.length + ' parse errors', 'error');
            }

            if (!objects.length) return;

            // Collect all keys
            var keys = [];
            objects.forEach(function(obj) {
                Object.keys(obj).forEach(function(k) { if (keys.indexOf(k) === -1) keys.push(k); });
            });

            // Stats
            var stats = document.getElementById('statsBar');
            stats.innerHTML = '<span>Rows: ' + objects.length + '</span>' +
                '<span>Columns: ' + keys.length + '</span>' +
                '<span>Errors: ' + errors.length + '</span>';

            // Build table
            var html = '<table class="jsonl-table"><thead><tr><th>#</th>';
            keys.forEach(function(k) { html += '<th>' + k + '</th>'; });
            html += '</tr></thead><tbody>';
            objects.forEach(function(obj, i) {
                html += '<tr><td>' + (i + 1) + '</td>';
                keys.forEach(function(k) {
                    var val = obj[k] !== undefined ? JSON.stringify(obj[k]) : '';
                    html += '<td title="' + val.replace(/"/g, '&quot;') + '">' + val + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody></table>';
            document.getElementById('tableContainer').innerHTML = html;
            document.getElementById('resultSection').style.display = 'block';
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('jsonlInput').value = '';
            document.getElementById('resultSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   10. MARKDOWN TABLE GENERATOR
   ================================================================ */
function getMdTableGenHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Table Generator</title>
    <style>
        ${SHARED_CSS}
        .table-input { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .table-input td, .table-input th { padding: 2px; }
        .table-input input {
            width: 100%;
            padding: 6px 8px;
            background: var(--bg-2);
            color: var(--fg-0);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            font-family: var(--mono);
            font-size: 12px;
            outline: none;
        }
        .table-input input:focus { border-color: var(--border-focus); }
        .table-input th input { font-weight: 700; background: var(--bg-3); }
        .preview-area {
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            font-family: var(--mono);
            font-size: 12px;
            line-height: 1.7;
            white-space: pre-wrap;
            max-height: 400px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Markdown Table Generator</h1>
        <span class="subtitle">Quick table creation for docs and reports</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="btn-row" style="margin-bottom: 10px;">
                <button class="btn btn-ghost" id="addColBtn">+ Column</button>
                <button class="btn btn-ghost" id="addRowBtn">+ Row</button>
                <button class="btn btn-ghost btn-danger" id="removeColBtn">- Column</button>
                <button class="btn btn-ghost btn-danger" id="removeRowBtn">- Row</button>
                <span style="flex:1;"></span>
                <button class="btn" id="generateBtn">Generate</button>
                <button class="btn btn-ghost" id="copyBtn">Copy</button>
            </div>
            <div style="overflow-x:auto;">
                <table class="table-input" id="tableInput"></table>
            </div>
        </div>
        <div class="section" id="previewSection" style="display:none;">
            <div class="section-title">Markdown Output</div>
            <div class="preview-area" id="preview"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var rows = 3;
        var cols = 3;

        function renderTable() {
            var table = document.getElementById('tableInput');
            var html = '<tr>';
            for (var c = 0; c < cols; c++) {
                html += '<th><input type="text" class="cell" data-r="0" data-c="' + c + '" placeholder="Header ' + (c + 1) + '"></th>';
            }
            html += '</tr>';
            for (var r = 1; r < rows; r++) {
                html += '<tr>';
                for (var c = 0; c < cols; c++) {
                    html += '<td><input type="text" class="cell" data-r="' + r + '" data-c="' + c + '" placeholder="Cell"></td>';
                }
                html += '</tr>';
            }
            table.innerHTML = html;
        }

        renderTable();

        document.getElementById('addColBtn').addEventListener('click', function() { cols++; renderTable(); });
        document.getElementById('addRowBtn').addEventListener('click', function() { rows++; renderTable(); });
        document.getElementById('removeColBtn').addEventListener('click', function() { if (cols > 1) { cols--; renderTable(); } });
        document.getElementById('removeRowBtn').addEventListener('click', function() { if (rows > 2) { rows--; renderTable(); } });

        document.getElementById('generateBtn').addEventListener('click', function() {
            var data = [];
            var maxR = rows;
            var maxC = cols;
            for (var r = 0; r < maxR; r++) {
                data[r] = [];
                for (var c = 0; c < maxC; c++) {
                    var input = document.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
                    data[r][c] = input ? input.value : '';
                }
            }

            var widths = [];
            for (var c = 0; c < maxC; c++) {
                widths[c] = 3;
                for (var r = 0; r < maxR; r++) {
                    widths[c] = Math.max(widths[c], (data[r][c] || '').length);
                }
            }

            function pad(s, w) { return (s || '').padEnd(w); }

            var md = '| ';
            for (var c = 0; c < maxC; c++) { md += pad(data[0][c], widths[c]) + ' | '; }
            md += '\\n| ';
            for (var c = 0; c < maxC; c++) { md += '-'.repeat(widths[c]) + ' | '; }
            md += '\\n';
            for (var r = 1; r < maxR; r++) {
                md += '| ';
                for (var c = 0; c < maxC; c++) { md += pad(data[r][c], widths[c]) + ' | '; }
                md += '\\n';
            }

            document.getElementById('preview').textContent = md;
            document.getElementById('previewSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = document.getElementById('preview').textContent;
            if (!text) { _toast('Generate first', 'error'); return; }
            navigator.clipboard.writeText(text).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
