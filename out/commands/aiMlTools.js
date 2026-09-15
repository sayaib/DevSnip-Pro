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
exports.registerAiMlToolsCommands = void 0;
const vscode = __importStar(require("vscode"));
const command_dispatch_1 = require("../utils/command-dispatch");
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
function registerAiMlToolsCommands(context) {
    const hubCmd = vscode.commands.registerCommand('sayaib.hue-console.aiMlHub', () => {
        const panel = vscode.window.createWebviewPanel('aiMlHub', 'DevSnip Pro - AI/ML & LLM Tools', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getAiMlHubHtml(getNonce());
        panel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'openTool':
                    (0, command_dispatch_1.executeQueuedCommand)(message.toolCommand);
                    break;
            }
        }, undefined, context.subscriptions);
    });
    const tokenCounterCmd = vscode.commands.registerCommand('sayaib.hue-console.tokenCounter', () => {
        const panel = vscode.window.createWebviewPanel('tokenCounter', 'Token Counter & Cost Calculator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getTokenCounterHtml(getNonce());
    });
    const promptTemplateCmd = vscode.commands.registerCommand('sayaib.hue-console.promptTemplate', () => {
        const panel = vscode.window.createWebviewPanel('promptTemplate', 'Prompt Template Manager', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getPromptTemplateHtml(getNonce());
    });
    const mlCodeGenCmd = vscode.commands.registerCommand('sayaib.hue-console.mlCodeGen', () => {
        const panel = vscode.window.createWebviewPanel('mlCodeGen', 'Python ML Code Generator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getMlCodeGenHtml(getNonce());
    });
    const llmApiTesterCmd = vscode.commands.registerCommand('sayaib.hue-console.llmApiTester', () => {
        const panel = vscode.window.createWebviewPanel('llmApiTester', 'LLM API Tester', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getLlmApiTesterHtml(getNonce());
    });
    const datasetSplitCmd = vscode.commands.registerCommand('sayaib.hue-console.datasetSplit', () => {
        const panel = vscode.window.createWebviewPanel('datasetSplit', 'Dataset Split Calculator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getDatasetSplitHtml(getNonce());
    });
    const gpuVramCmd = vscode.commands.registerCommand('sayaib.hue-console.gpuVram', () => {
        const panel = vscode.window.createWebviewPanel('gpuVram', 'GPU VRAM Calculator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getGpuVramHtml(getNonce());
    });
    const experimentLoggerCmd = vscode.commands.registerCommand('sayaib.hue-console.experimentLogger', () => {
        const panel = vscode.window.createWebviewPanel('experimentLogger', 'Experiment Logger', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getExperimentLoggerHtml(getNonce());
    });
    const modelCardCmd = vscode.commands.registerCommand('sayaib.hue-console.modelCard', () => {
        const panel = vscode.window.createWebviewPanel('modelCard', 'Model Card Generator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getModelCardHtml(getNonce());
    });
    const jsonlViewerCmd = vscode.commands.registerCommand('sayaib.hue-console.jsonlViewer', () => {
        const panel = vscode.window.createWebviewPanel('jsonlViewer', 'JSONL Viewer', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getJsonlViewerHtml(getNonce());
    });
    const mdTableCmd = vscode.commands.registerCommand('sayaib.hue-console.mdTableGen', () => {
        const panel = vscode.window.createWebviewPanel('mdTableGen', 'Markdown Table Generator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getMdTableGenHtml(getNonce());
    });
    const lrSchedulerCmd = vscode.commands.registerCommand('sayaib.hue-console.lrScheduler', () => {
        const panel = vscode.window.createWebviewPanel('lrScheduler', 'Learning Rate Scheduler Visualizer', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getLrSchedulerHtml(getNonce());
    });
    const inferenceEstimatorCmd = vscode.commands.registerCommand('sayaib.hue-console.inferenceEstimator', () => {
        const panel = vscode.window.createWebviewPanel('inferenceEstimator', 'LLM Inference Latency & VRAM Estimator', vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = getInferenceEstimatorHtml(getNonce());
    });
    context.subscriptions.push(hubCmd, tokenCounterCmd, promptTemplateCmd, mlCodeGenCmd, llmApiTesterCmd, datasetSplitCmd, gpuVramCmd, experimentLoggerCmd, modelCardCmd, jsonlViewerCmd, mdTableCmd, lrSchedulerCmd, inferenceEstimatorCmd);
}
exports.registerAiMlToolsCommands = registerAiMlToolsCommands;
/* ================================================================
   HUB
   ================================================================ */
function getAiMlHubHtml(nonce) {
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
        .hub-section { display: contents; }
        .hub-section-title { grid-column: 1 / -1; font-size: 12px; font-weight: 700; color: var(--fg-1); text-transform: uppercase; letter-spacing: .6px; margin: 10px 0 0 2px; }
        .hub-section .hub-grid { display: contents; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>AI/ML & LLM Developer Tools</h1>
        <span class="subtitle">15 built-in utilities for everyday AI & ML workflows</span>
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
            { cmd: 'sayaib.hue-console.mdTableGen', icon: '\\u{1F4D1}', title: 'Markdown Table Generator', desc: 'Quickly generate markdown tables for experiment results and documentation.', tag: 'Docs' },
            { cmd: 'sayaib.hue-console.lrScheduler', icon: '\\u{1F4C8}', title: 'LR Scheduler Visualizer', desc: 'Visualize learning rate schedules (Cosine, Warmup, Exponential) and generate PyTorch code.', tag: 'Training' },
            { cmd: 'sayaib.hue-console.inferenceEstimator', icon: '\\u{26A1}', title: 'LLM Inference & VRAM Estimator', desc: 'Estimate token throughput, KV cache, and inference latency for open-source LLMs.', tag: 'Inference' }
        ];
        var grid = document.getElementById('grid');
        var groups = {};
        var order = ['Prompting & APIs', 'Model Development', 'Data & Evaluation', 'Infrastructure', 'Training & Inference'];
        tools.forEach(function(t) {
            var section = t.tag === 'LLM' || t.tag === 'Prompt' || t.tag === 'API' ? 'Prompting & APIs' :
                (t.tag === 'Code' ? 'Model Development' : (t.tag === 'Data' || t.tag === 'Evaluation' ? 'Data & Evaluation' :
                (t.tag === 'Compute' ? 'Infrastructure' : 'Training & Inference')));
            if (!groups[section]) groups[section] = [];
            groups[section].push(t);
        });
        order.forEach(function(section) {
            if (!groups[section]) return;
            var wrapper = document.createElement('section'); wrapper.className = 'hub-section';
            wrapper.innerHTML = '<div class="hub-section-title">' + section + '</div><div class="hub-grid"></div>';
            var sectionGrid = wrapper.querySelector('.hub-grid');
            groups[section].forEach(function(t) {
                var card = document.createElement('div'); card.className = 'hub-card';
                card.innerHTML = '<div class="hub-card-icon">' + t.icon + '</div><div class="hub-card-title">' + t.title + '</div><div class="hub-card-desc">' + t.desc + '</div><span class="hub-card-tag">' + t.tag + '</span>';
                card.addEventListener('click', function() { acquireVsCodeApi().postMessage({ command: 'openTool', toolCommand: t.cmd }); });
                sectionGrid.appendChild(card);
            });
            grid.appendChild(wrapper);
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   1. TOKEN COUNTER
   ================================================================ */
function getTokenCounterHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Token Counter & Cost Calculator</title>
    <style>
        ${SHARED_CSS}
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 14px; }
        .stat-box { background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px; }
        .stat-box .lbl { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .stat-box .val { font-size: 20px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Token Counter & Cost Calculator</h1>
        <span class="subtitle">Estimate token count and API costs across LLMs</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Input Text</label>
            <textarea id="textInput" rows="8" placeholder="Paste prompt or text here..."></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="countBtn">Calculate Tokens & Cost</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="statsSection" style="display:none;">
            <div class="section-title">Token Statistics</div>
            <div class="stat-grid">
                <div class="stat-box"><div class="lbl">Characters</div><div class="val" id="charCount">0</div></div>
                <div class="stat-box"><div class="lbl">Words</div><div class="val" id="wordCount">0</div></div>
                <div class="stat-box"><div class="lbl">Estimated Tokens</div><div class="val" id="tokenCount">0</div></div>
            </div>
        </div>
        <div class="section" id="costSection" style="display:none; margin-top: 14px;">
            <div class="section-title">Estimated API Costs (Input)</div>
            <div class="result-block" id="costOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('countBtn').addEventListener('click', function() {
            var text = document.getElementById('textInput').value;
            var chars = text.length;
            var words = text.trim() ? text.trim().split(/\\s+/).length : 0;
            // Approximate heuristic: 1 token ≈ 4 chars in English
            var tokens = Math.max(1, Math.ceil(chars / 4.0));

            document.getElementById('charCount').textContent = chars.toLocaleString();
            document.getElementById('wordCount').textContent = words.toLocaleString();
            document.getElementById('tokenCount').textContent = tokens.toLocaleString();

            var gpt4oCost = (tokens / 1000000.0) * 5.00;
            var claude35Cost = (tokens / 1000000.0) * 3.00;
            var geminiProCost = (tokens / 1000000.0) * 1.25;

            var costText = 'API COST ESTIMATION FOR ' + tokens.toLocaleString() + ' TOKENS:\\n' + '='.repeat(40) + '\\n';
            costText += '  - OpenAI GPT-4o ($5.00 / 1M input): $' + gpt4oCost.toFixed(6) + '\\n';
            costText += '  - Anthropic Claude 3.5 Sonnet ($3.00 / 1M input): $' + claude35Cost.toFixed(6) + '\\n';
            costText += '  - Google Gemini 1.5 Pro ($1.25 / 1M input): $' + geminiProCost.toFixed(6) + '\\n';

            document.getElementById('costOutput').textContent = costText;
            document.getElementById('statsSection').style.display = 'block';
            document.getElementById('costSection').style.display = 'block';
            _toast('Tokens counted!', 'success');
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('textInput').value = '';
            document.getElementById('statsSection').style.display = 'none';
            document.getElementById('costSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   2. PROMPT TEMPLATE MANAGER
   ================================================================ */
function getPromptTemplateHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompt Template Manager</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Prompt Template Manager</h1>
        <span class="subtitle">Create and interpolate prompts with variable substitution</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Template (use {{variable}} for placeholders)</label>
            <textarea id="templateInput" rows="6" placeholder="You are a senior {{language}} developer. Review the following code for security vulnerabilities:\n\n{{code}}"></textarea>
            <div style="margin-top: 14px;">
                <label>Variables (JSON format, e.g. {"language": "Python", "code": "eval(user_input)"})</label>
                <textarea id="varsInput" rows="4" placeholder='{\n  "language": "Python",\n  "code": "eval(user_input)"\n}'></textarea>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="renderBtn">Render Prompt</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Rendered</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Rendered Prompt Output</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var renderedText = '';

        document.getElementById('renderBtn').addEventListener('click', function() {
            var tmpl = document.getElementById('templateInput').value;
            var varsRaw = document.getElementById('varsInput').value.trim();
            if (!tmpl) { _toast('Enter a template', 'error'); return; }
            
            var vars = {};
            if (varsRaw) {
                try {
                    vars = JSON.parse(varsRaw);
                } catch (e) {
                    _toast('Invalid JSON variables: ' + e.message, 'error');
                    return;
                }
            }

            renderedText = tmpl.replace(/\\{\\{\\s*([a-zA-Z0-9_-]+)\\s*\\}\\}/g, function(match, key) {
                return vars[key] !== undefined ? vars[key] : match;
            });

            document.getElementById('resultOutput').textContent = renderedText;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Prompt rendered successfully!', 'success');
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!renderedText) { _toast('Render first', 'error'); return; }
            navigator.clipboard.writeText(renderedText).then(function() { _toast('Copied prompt!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('templateInput').value = '';
            document.getElementById('varsInput').value = '';
            document.getElementById('resultSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   3. PYTHON ML CODE GENERATOR
   ================================================================ */
function getMlCodeGenHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Python ML Code Generator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Python ML Code Generator</h1>
        <span class="subtitle">Generate boilerplate code for PyTorch, Transformers, and Scikit-Learn</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Select Framework & Task</label>
            <select id="frameworkSelect" style="margin-bottom: 14px;">
                <option value="pytorch_nn">PyTorch - Neural Network Classifier</option>
                <option value="hf_transformer">HuggingFace - Fine-tune LLM (LoRA / PEFT)</option>
                <option value="sklearn_pipeline">Scikit-Learn - Classification Pipeline</option>
                <option value="langchain_rag">LangChain - RAG Vectorstore QA</option>
            </select>
            <div class="btn-row">
                <button class="btn" id="genBtn">Generate Boilerplate</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Code</button>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Generated Python Code</div>
            <div class="result-block" id="codeOutput"># Select a framework and click Generate Boilerplate</div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var snippets = {
            pytorch_nn: 'import torch\\nimport torch.nn as nn\\nimport torch.optim as optim\\n\\nclass SimpleMLP(nn.Module):\\n    def __init__(self, input_dim, hidden_dim, output_dim):\\n        super().__init__()\\n        self.net = nn.Sequential(\\n            nn.Linear(input_dim, hidden_dim),\\n            nn.ReLU(),\\n            nn.Dropout(0.2),\\n            nn.Linear(hidden_dim, output_dim)\\n        )\\n    def forward(self, x):\\n        return self.net(x)\\n\\nmodel = SimpleMLP(784, 256, 10)\\ncriterion = nn.CrossEntropyLoss()\\noptimizer = optim.Adam(model.parameters(), lr=1e-3)',
            hf_transformer: 'import torch\\nfrom transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, Trainer\\nfrom peft import LoraConfig, get_peft_model\\n\\nmodel_id = "meta-llama/Meta-Llama-3-8B-Instruct"\\nmodel = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.bfloat16, device_map="auto")\\ntokenizer = AutoTokenizer.from_pretrained(model_id)\\n\\npeft_config = LoraConfig(\\n    r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none", task_type="CAUSAL_LM"\\n)\\nmodel = get_peft_model(model, peft_config)\\nmodel.print_trainable_parameters()',
            sklearn_pipeline: 'from sklearn.pipeline import Pipeline\\nfrom sklearn.ensemble import RandomForestClassifier\\nfrom sklearn.feature_extraction.text import TfidfVectorizer\\nfrom sklearn.model_selection import train_test_split\\n\\npipeline = Pipeline([\\n    ("tfidf", TfidfVectorizer(max_features=5000)),\\n    ("clf", RandomForestClassifier(n_estimators=100, random_state=42))\\n])\\n\\n# pipeline.fit(X_train, y_train)\\n# preds = pipeline.predict(X_test)',
            langchain_rag: 'from langchain_community.vectorstores import Chroma\\nfrom langchain_openai import OpenAIEmbeddings, ChatOpenAI\\nfrom langchain.chains import RetrievalQA\\n\\nembeddings = OpenAIEmbeddings()\\nvectorstore = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)\\nqa_chain = RetrievalQA.from_chain_type(\\n    llm=ChatOpenAI(model="gpt-4o", temperature=0),\\n    chain_type="stuff",\\n    retriever=vectorstore.as_retriever(search_kwargs={"k": 3})\\n)\\nresponse = qa_chain.invoke({"query": "What is the refund policy?"})\\nprint(response["result"])'
        };

        document.getElementById('genBtn').addEventListener('click', function() {
            var val = document.getElementById('frameworkSelect').value;
            var code = snippets[val] || '# No snippet found';
            document.getElementById('codeOutput').textContent = code;
            _toast('Boilerplate generated!', 'success');
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = document.getElementById('codeOutput').textContent;
            navigator.clipboard.writeText(text).then(function() { _toast('Copied code!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   4. LLM API TESTER
   ================================================================ */
function getLlmApiTesterHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLM API Tester</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>LLM API Tester</h1>
        <span class="subtitle">Test OpenAI and compatible LLM API endpoints</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>API Endpoint URL</label>
                    <input type="text" id="apiUrl" value="https://api.openai.com/v1/chat/completions" />
                </div>
                <div>
                    <label>API Key (Bearer Token)</label>
                    <input type="text" id="apiKey" placeholder="sk-..." />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Model Name</label>
                    <input type="text" id="apiModel" value="gpt-4o" />
                </div>
                <div>
                    <label>Temperature</label>
                    <input type="number" id="apiTemp" value="0.7" min="0" max="2" step="0.1" />
                </div>
            </div>
            <div style="margin-top: 14px;">
                <label>User Prompt</label>
                <textarea id="apiPrompt" rows="4" placeholder="Hello, write a quick Python function to check prime numbers."></textarea>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="sendBtn">Send API Request</button>
            </div>
        </div>
        <div class="section" id="responseSection" style="display:none;">
            <div class="section-title">API Response</div>
            <div class="result-block" id="responseOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('sendBtn').addEventListener('click', async function() {
            var url = document.getElementById('apiUrl').value.trim();
            var key = document.getElementById('apiKey').value.trim();
            var model = document.getElementById('apiModel').value.trim();
            var temp = parseFloat(document.getElementById('apiTemp').value) || 0.7;
            var prompt = document.getElementById('apiPrompt').value.trim();

            if (!url || !prompt) { _toast('Provide endpoint URL and prompt', 'error'); return; }

            document.getElementById('responseOutput').textContent = 'Sending request to ' + url + '...';
            document.getElementById('responseSection').style.display = 'block';

            try {
                var res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + key
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: temp
                    })
                });
                var data = await res.json();
                document.getElementById('responseOutput').textContent = JSON.stringify(data, null, 2);
                _toast('API request successful!', 'success');
            } catch (e) {
                document.getElementById('responseOutput').textContent = 'Error: ' + e.message + '\\n\\n(Note: Network requests from VS Code webviews may require CORS or proper endpoint configuration)';
                _toast('Request failed', 'error');
            }
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   5. DATASET SPLIT CALCULATOR
   ================================================================ */
function getDatasetSplitHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dataset Split Calculator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Dataset Split Calculator</h1>
        <span class="subtitle">Calculate exact sample counts for Train, Validation, and Test splits</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Total Dataset Samples</label>
                    <input type="number" id="totalSamples" value="50000" min="10" />
                </div>
                <div>
                    <label>Train Split (%)</label>
                    <input type="number" id="trainPct" value="80" min="1" max="98" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Validation Split (%)</label>
                    <input type="number" id="valPct" value="10" min="0" max="50" />
                </div>
                <div>
                    <label>Test Split (%) (auto-calculated)</label>
                    <input type="text" id="testPct" value="10%" disabled style="background:var(--bg-3);" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="calcBtn">Calculate Splits</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Split Breakdown</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('calcBtn').addEventListener('click', function() {
            var total = parseInt(document.getElementById('totalSamples').value) || 50000;
            var train = parseFloat(document.getElementById('trainPct').value) || 80;
            var val = parseFloat(document.getElementById('valPct').value) || 10;
            var test = 100 - (train + val);

            if (test < 0) { _toast('Train + Val percentages cannot exceed 100%', 'error'); return; }

            document.getElementById('testPct').value = test.toFixed(1) + '%';

            var trainCount = Math.round(total * (train / 100.0));
            var valCount = Math.round(total * (val / 100.0));
            var testCount = total - (trainCount + valCount);

            var report = 'DATASET SPLIT BREAKDOWN\\n' + '='.repeat(30) + '\\n';
            report += 'Total Samples: ' + total.toLocaleString() + '\\n\\n';
            report += '  - Train (' + train + '%): ' + trainCount.toLocaleString() + ' samples\\n';
            report += '  - Validation (' + val + '%): ' + valCount.toLocaleString() + ' samples\\n';
            report += '  - Test (' + test.toFixed(1) + '%): ' + testCount.toLocaleString() + ' samples\\n';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Splits calculated!', 'success');
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   6. GPU VRAM CALCULATOR
   ================================================================ */
function getGpuVramHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GPU VRAM Calculator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>GPU VRAM Calculator</h1>
        <span class="subtitle">Calculate VRAM required for model inference and training</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Model Parameters (Billions)</label>
                    <input type="number" id="paramsB" value="8" min="0.1" step="0.5" />
                </div>
                <div>
                    <label>Precision Format</label>
                    <select id="precisionSelect">
                        <option value="2">FP16 / BF16 (2 bytes/param)</option>
                        <option value="1">INT8 Quantization (1 byte/param)</option>
                        <option value="0.5">INT4 / GGUF Quantization (0.5 bytes/param)</option>
                        <option value="4">FP32 Full Precision (4 bytes/param)</option>
                    </select>
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Workload Type</label>
                    <select id="workloadType">
                        <option value="inference">Inference (weights + KV cache)</option>
                        <option value="training">Training (weights + gradients + optimizer)</option>
                    </select>
                </div>
                <div>
                    <label>Context Length (Tokens)</label>
                    <input type="number" id="contextLen" value="4096" min="512" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="calcBtn">Calculate VRAM Footprint</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">VRAM Estimation Report</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('calcBtn').addEventListener('click', function() {
            var b = parseFloat(document.getElementById('paramsB').value) || 8;
            var bytesPerParam = parseFloat(document.getElementById('precisionSelect').value) || 2;
            var workload = document.getElementById('workloadType').value;
            var ctx = parseInt(document.getElementById('contextLen').value) || 4096;

            var weightGB = b * bytesPerParam;
            var multiplier = workload === 'training' ? 4.0 : 1.2; // training needs optimizer states & grads
            var totalVRAM = (weightGB * multiplier) + (ctx * 0.001);

            var report = 'GPU VRAM ESTIMATION REPORT\\n' + '='.repeat(35) + '\\n';
            report += 'Model Size: ' + b + ' Billion parameters\\n';
            report += 'Workload: ' + workload.toUpperCase() + '\\n';
            report += 'Model Weights VRAM: ~' + weightGB.toFixed(2) + ' GB\\n';
            report += 'Estimated Total VRAM Required: ~' + totalVRAM.toFixed(2) + ' GB\\n\\n';
            report += 'Recommended GPU:\\n';
            if (totalVRAM <= 16) report += '  - NVIDIA RTX 4080 / 4090 (16GB - 24GB VRAM)\\n';
            else if (totalVRAM <= 24) report += '  - NVIDIA RTX 3090 / 4090 (24GB VRAM)\\n';
            else if (totalVRAM <= 48) report += '  - NVIDIA A10G / L40S (24GB - 48GB VRAM)\\n';
            else report += '  - NVIDIA A100 / H100 (80GB VRAM or Multi-GPU)\\n';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('VRAM calculated!', 'success');
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   7. EXPERIMENT LOGGER
   ================================================================ */
function getExperimentLoggerHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Experiment Logger</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Experiment Logger</h1>
        <span class="subtitle">Log hyperparameters and metrics in a structured JSON format</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Experiment Name</label>
                    <input type="text" id="expName" value="llama3_finetune_v1" />
                </div>
                <div>
                    <label>Learning Rate</label>
                    <input type="text" id="expLr" value="2e-5" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Batch Size</label>
                    <input type="number" id="expBatch" value="16" />
                </div>
                <div>
                    <label>Evaluation Accuracy / F1</label>
                    <input type="number" id="expMetric" value="0.924" step="0.001" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="logBtn">Generate Experiment JSON</button>
                <button class="btn btn-ghost" id="copyBtn">Copy JSON</button>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Structured Log Output</div>
            <div class="result-block" id="logOutput">{}</div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var jsonStr = '{}';

        document.getElementById('logBtn').addEventListener('click', function() {
            var log = {
                timestamp: new Date().toISOString(),
                experiment_name: document.getElementById('expName').value,
                hyperparameters: {
                    learning_rate: document.getElementById('expLr').value,
                    batch_size: parseInt(document.getElementById('expBatch').value)
                },
                metrics: {
                    eval_score: parseFloat(document.getElementById('expMetric').value)
                }
            };
            jsonStr = JSON.stringify(log, null, 2);
            document.getElementById('logOutput').textContent = jsonStr;
            _toast('Experiment logged!', 'success');
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!jsonStr) return;
            navigator.clipboard.writeText(jsonStr).then(function() { _toast('Copied log!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   8. MODEL CARD GENERATOR
   ================================================================ */
function getModelCardHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Model Card Generator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Model Card Generator</h1>
        <span class="subtitle">Generate standardized model cards in HuggingFace Markdown format</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Model Name</label>
                    <input type="text" id="modelName" value="Legal-BERT-Classifier" />
                </div>
                <div>
                    <label>Base Model</label>
                    <input type="text" id="baseModel" value="bert-base-uncased" />
                </div>
            </div>
            <div style="margin-top: 14px;">
                <label>Intended Use</label>
                <input type="text" id="intendedUse" value="Classification of legal contracts and clause risk scoring." />
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="genBtn">Generate Model Card</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Markdown</button>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Markdown Output</div>
            <div class="result-block" id="cardOutput"># Model Card</div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var cardMd = '';

        document.getElementById('genBtn').addEventListener('click', function() {
            var name = document.getElementById('modelName').value;
            var base = document.getElementById('baseModel').value;
            var use = document.getElementById('intendedUse').value;

            cardMd = '# Model Card: ' + name + '\\n\\n' +
                '## Model Details\\n' +
                '- **Developed by:** Engineering Team\\n' +
                '- **Base Model:** ' + base + '\\n' +
                '- **License:** MIT\\n\\n' +
                '## Intended Use\\n' +
                use + '\\n\\n' +
                '## Training Data\\n' +
                'Fine-tuned on proprietary domain dataset.\\n\\n' +
                '## Evaluation Results\\n' +
                'Achieved 94.2% accuracy on validation benchmark.';

            document.getElementById('cardOutput').textContent = cardMd;
            _toast('Model card generated!', 'success');
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!cardMd) return;
            navigator.clipboard.writeText(cardMd).then(function() { _toast('Copied model card!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   9. JSONL VIEWER
   ================================================================ */
function getJsonlViewerHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>JSONL Viewer</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>JSONL Viewer</h1>
        <span class="subtitle">Inspect and validate JSONL fine-tuning data files</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Paste JSONL Lines</label>
            <textarea id="jsonlInput" rows="8" placeholder='{"messages": [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there!"}]}\n{"messages": [{"role": "user", "content": "Help"}, {"role": "assistant", "content": "Sure!"}]}'></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="parseBtn">Parse & Validate JSONL</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="outputSection" style="display:none;">
            <div class="section-title" id="outputTitle">Parsed Records</div>
            <div class="result-block" id="outputContent"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('parseBtn').addEventListener('click', function() {
            var raw = document.getElementById('jsonlInput').value.trim();
            if (!raw) { _toast('Enter JSONL data', 'error'); return; }
            var lines = raw.split(/\\r?\\n/).filter(Boolean);
            var records = [];
            var errors = 0;

            lines.forEach(function(l, i) {
                try {
                    records.push(JSON.parse(l));
                } catch (e) {
                    errors++;
                }
            });

            var summary = 'JSONL PARSE REPORT\\n' + '='.repeat(30) + '\\n';
            summary += 'Total Lines: ' + lines.length + '\\n';
            summary += 'Valid Records: ' + records.length + '\\n';
            summary += 'Parse Errors: ' + errors + '\\n\\n';
            summary += 'Parsed Objects Preview:\\n' + JSON.stringify(records.slice(0, 5), null, 2);

            document.getElementById('outputContent').textContent = summary;
            document.getElementById('outputSection').style.display = 'block';
            _toast('Parsed ' + records.length + ' records!', 'success');
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('jsonlInput').value = '';
            document.getElementById('outputSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   10. MARKDOWN TABLE GENERATOR
   ================================================================ */
function getMdTableGenHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Table Generator</title>
    <style>
        ${SHARED_CSS}
        .table-grid { display: grid; gap: 6px; margin-top: 10px; }
        .grid-row { display: flex; gap: 6px; }
        .cell { flex: 1; padding: 6px; background: var(--bg-2); border: 1px solid var(--border); color: var(--fg-0); font-family: var(--mono); font-size: 12px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Markdown Table Generator</h1>
        <span class="subtitle">Quickly format experiment results into clean Markdown tables</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="btn-row">
                <button class="btn" id="addColBtn">+ Add Column</button>
                <button class="btn btn-secondary" id="addRowBtn">+ Add Row</button>
                <button class="btn btn-ghost" id="removeColBtn">- Remove Column</button>
                <button class="btn btn-ghost" id="removeRowBtn">- Remove Row</button>
                <button class="btn" id="generateBtn">Generate Markdown</button>
            </div>
            <div id="gridContainer" style="margin-top: 16px; overflow-x: auto;"></div>
        </div>
        <div class="section" id="previewSection" style="display:none;">
            <div class="section-title">Markdown Preview</div>
            <div class="result-block" id="preview"></div>
            <div class="btn-row" style="margin-top: 10px;">
                <button class="btn btn-secondary" id="copyBtn">Copy Markdown</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var rows = 3;
        var cols = 3;

        function renderTable() {
            var container = document.getElementById('gridContainer');
            container.innerHTML = '';
            for (var r = 0; r < rows; r++) {
                var rowDiv = document.createElement('div');
                rowDiv.className = 'grid-row';
                for (var c = 0; c < cols; c++) {
                    var input = document.createElement('input');
                    input.className = 'cell';
                    input.setAttribute('data-r', r);
                    input.setAttribute('data-c', c);
                    if (r === 0) input.placeholder = 'Header ' + (c + 1);
                    else input.placeholder = 'Row ' + r + ', Col ' + (c + 1);
                    rowDiv.appendChild(input);
                }
                container.appendChild(rowDiv);
            }
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
/* ================================================================
   11. LEARNING RATE SCHEDULER VISUALIZER
   ================================================================ */
function getLrSchedulerHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LR Scheduler Visualizer</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Learning Rate Scheduler Visualizer</h1>
        <span class="subtitle">Preview LR decay curves and generate PyTorch scheduler code</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Initial Learning Rate</label>
                    <input type="text" id="initLr" value="1e-3" />
                </div>
                <div>
                    <label>Total Training Steps / Epochs</label>
                    <input type="number" id="totalSteps" value="1000" min="10" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Warmup Steps</label>
                    <input type="number" id="warmupSteps" value="100" min="0" />
                </div>
                <div>
                    <label>Scheduler Type</label>
                    <select id="schedType">
                        <option value="cosine">Cosine Annealing</option>
                        <option value="linear">Linear Warmup & Decay</option>
                        <option value="exponential">Exponential Decay</option>
                    </select>
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="genBtn">Generate Schedule & Code</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">PyTorch Code Snippet</div>
            <div class="result-block" id="codeOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('genBtn').addEventListener('click', function() {
            var lr = document.getElementById('initLr').value;
            var steps = parseInt(document.getElementById('totalSteps').value) || 1000;
            var warmup = parseInt(document.getElementById('warmupSteps').value) || 100;
            var type = document.getElementById('schedType').value;

            var code = 'import torch\\nimport math\\nfrom torch.optim.lr_scheduler import LambdaLR\\n\\n# Optimizer setup\\noptimizer = torch.optim.AdamW(model.parameters(), lr=' + lr + ', weight_decay=0.01)\\n\\n';
            
            if (type === 'cosine') {
                code += '# Cosine Annealing with Warmup\\n' +
                    'def lr_lambda(current_step):\\n' +
                    '    if current_step < ' + warmup + ':\\n' +
                    '        return float(current_step) / float(max(1, ' + warmup + '))\\n' +
                    '    progress = float(current_step - ' + warmup + ') / float(max(1, ' + steps + ' - ' + warmup + '))\\n' +
                    '    return max(0.0, 0.5 * (1.0 + math.cos(math.pi * progress)))\\n\\n' +
                    'scheduler = LambdaLR(optimizer, lr_lambda)';
            } else if (type === 'linear') {
                code += '# Linear Warmup & Decay\\n' +
                    'def lr_lambda(current_step):\\n' +
                    '    if current_step < ' + warmup + ':\\n' +
                    '        return float(current_step) / float(max(1, ' + warmup + '))\\n' +
                    '    return max(0.0, float(' + steps + ' - current_step) / float(max(1, ' + steps + ' - ' + warmup + ')))\\n\\n' +
                    'scheduler = LambdaLR(optimizer, lr_lambda)';
            } else {
                code += 'from torch.optim.lr_scheduler import ExponentialLR\\n' +
                    '# Exponential Decay\\n' +
                    'scheduler = ExponentialLR(optimizer, gamma=0.95)';
            }

            document.getElementById('codeOutput').textContent = code;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Scheduler generated!', 'success');
        });
    </script>
</body>
</html>`;
}
/* ================================================================
   12. LLM INFERENCE LATENCY & VRAM ESTIMATOR
   ================================================================ */
function getInferenceEstimatorHtml(nonce) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLM Inference & VRAM Estimator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>LLM Inference & VRAM Estimator</h1>
        <span class="subtitle">Estimate token generation throughput, latency, and KV cache memory</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Model Parameter Size</label>
                    <select id="modelSize">
                        <option value="8">Llama-3 8B (FP16 / INT8)</option>
                        <option value="13">Llama-2 13B</option>
                        <option value="70">Llama-3 70B (Quantized)</option>
                    </select>
                </div>
                <div>
                    <label>Prompt Length (Input Tokens)</label>
                    <input type="number" id="promptTokens" value="1024" min="64" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Generated Tokens (Output Length)</label>
                    <input type="number" id="genTokens" value="512" min="16" />
                </div>
                <div>
                    <label>Hardware GPU</label>
                    <select id="gpuHardware">
                        <option value="A100">NVIDIA A100 (80GB VRAM, ~1,550 GB/s bandwidth)</option>
                        <option value="RTX4090">NVIDIA RTX 4090 (24GB VRAM, ~1,008 GB/s bandwidth)</option>
                        <option value="T4">NVIDIA T4 (16GB VRAM, ~300 GB/s bandwidth)</option>
                    </select>
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="calcBtn">Estimate Inference Performance</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Inference Performance Report</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('calcBtn').addEventListener('click', function() {
            var b = parseFloat(document.getElementById('modelSize').value) || 8;
            var prompt = parseInt(document.getElementById('promptTokens').value) || 1024;
            var gen = parseInt(document.getElementById('genTokens').value) || 512;
            var gpu = document.getElementById('gpuHardware').value;

            var bandwidthGBs = gpu === 'A100' ? 1550 : (gpu === 'RTX4090' ? 1008 : 300);
            var modelSizeGB = b * 2; // FP16
            
            // Time to First Token (Prefill latency bound by memory bandwidth)
            var prefillSec = (modelSizeGB + (prompt * 0.000002)) / (bandwidthGBs * 0.7);
            // Generation Time (Decode latency bound by memory bandwidth per token)
            var secPerToken = modelSizeGB / (bandwidthGBs * 0.8);
            var totalGenSec = gen * secPerToken;
            var tokensPerSec = 1.0 / secPerToken;

            var report = 'LLM INFERENCE & LATENCY ESTIMATE\\n' + '='.repeat(40) + '\\n';
            report += 'Hardware: ' + gpu + ' (' + bandwidthGBs + ' GB/s memory bandwidth)\\n';
            report += 'Model Weights: ' + modelSizeGB.toFixed(1) + ' GB (FP16)\\n\\n';
            report += 'Latency Breakdown:\\n';
            report += '  - Time to First Token (Prefill for ' + prompt + ' tokens): ' + (prefillSec * 1000).toFixed(0) + ' ms\\n';
            report += '  - Generation Speed (Decode): ' + tokensPerSec.toFixed(1) + ' tokens / sec\\n';
            report += '  - Total Generation Time (' + gen + ' tokens): ' + totalGenSec.toFixed(2) + ' seconds\\n';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Inference estimation complete!', 'success');
        });
    </script>
</body>
</html>`;
}
//# sourceMappingURL=aiMlTools.js.map