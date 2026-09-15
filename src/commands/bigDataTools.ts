import * as vscode from 'vscode';
import { executeQueuedCommand } from '../utils/command-dispatch';

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

export function registerBigDataToolsCommands(context: vscode.ExtensionContext) {
    const hubCmd = vscode.commands.registerCommand('sayaib.hue-console.bigDataHub', () => {
        const panel = vscode.window.createWebviewPanel(
            'bigDataHub',
            'DevSnip Pro - Big Data & Analytics Tools',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getBigDataHubHtml(getNonce());
        panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'openTool':
                        executeQueuedCommand(message.toolCommand);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    });

    const schemaViewerCmd = vscode.commands.registerCommand('sayaib.hue-console.schemaViewer', () => {
        const panel = vscode.window.createWebviewPanel(
            'schemaViewer',
            'Parquet/Avro/JSON Schema Viewer',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getSchemaViewerHtml(getNonce());
    });

    const sparkSqlFormatterCmd = vscode.commands.registerCommand('sayaib.hue-console.sparkSqlFormatter', () => {
        const panel = vscode.window.createWebviewPanel(
            'sparkSqlFormatter',
            'Spark SQL / Presto / Trino Formatter',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getSparkSqlFormatterHtml(getNonce());
    });

    const dataQualityCheckerCmd = vscode.commands.registerCommand('sayaib.hue-console.dataQualityChecker', () => {
        const panel = vscode.window.createWebviewPanel(
            'dataQualityChecker',
            'CSV/JSON Data Quality Checker',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getDataQualityCheckerHtml(getNonce());
    });

    const schemaDiffCmd = vscode.commands.registerCommand('sayaib.hue-console.schemaDiff', () => {
        const panel = vscode.window.createWebviewPanel(
            'schemaDiff',
            'Schema Diff Tool',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getSchemaDiffHtml(getNonce());
    });

    const partitionCalcCmd = vscode.commands.registerCommand('sayaib.hue-console.partitionCalc', () => {
        const panel = vscode.window.createWebviewPanel(
            'partitionCalc',
            'Data Partition Calculator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getPartitionCalcHtml(getNonce());
    });

    const deltaLakeAnalyzerCmd = vscode.commands.registerCommand('sayaib.hue-console.deltaLakeAnalyzer', () => {
        const panel = vscode.window.createWebviewPanel(
            'deltaLakeAnalyzer',
            'Delta Lake Log & Transaction Analyzer',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getDeltaLakeAnalyzerHtml(getNonce());
    });

    const sparkCostEstimatorCmd = vscode.commands.registerCommand('sayaib.hue-console.sparkCostEstimator', () => {
        const panel = vscode.window.createWebviewPanel(
            'sparkCostEstimator',
            'Spark Cluster & Cost Estimator',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        panel.webview.html = getSparkCostEstimatorHtml(getNonce());
    });

    context.subscriptions.push(
        hubCmd, schemaViewerCmd, sparkSqlFormatterCmd, dataQualityCheckerCmd,
        schemaDiffCmd, partitionCalcCmd, deltaLakeAnalyzerCmd, sparkCostEstimatorCmd
    );
}

/* ================================================================
   HUB
   ================================================================ */
function getBigDataHubHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Big Data & Analytics Tools</title>
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
        <h1>Big Data & Analytics Developer Tools</h1>
        <span class="subtitle">7 built-in utilities for data engineering & lakes</span>
    </div>
    <div class="tool-body">
        <div class="hub-grid" id="grid"></div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}
        var tools = [
            { cmd: 'sayaib.hue-console.schemaViewer', icon: '\\u{1F4CB}', title: 'Schema Viewer', desc: 'Parse and visualize Parquet, Avro, and JSON schemas as an interactive tree.', tag: 'Schema' },
            { cmd: 'sayaib.hue-console.sparkSqlFormatter', icon: '\\u{1F524}', title: 'Spark SQL Formatter', desc: 'Format Spark SQL, Presto, and Trino queries with proper indentation and keywords.', tag: 'SQL' },
            { cmd: 'sayaib.hue-console.dataQualityChecker', icon: '\\u{1F50D}', title: 'Data Quality Checker', desc: 'Analyze CSV and JSON datasets for missing values, duplicates, types, and stats.', tag: 'Quality' },
            { cmd: 'sayaib.hue-console.schemaDiff', icon: '\\u{1F500}', title: 'Schema Diff Tool', desc: 'Compare two schemas side by side and highlight added, removed, and changed fields.', tag: 'Diff' },
            { cmd: 'sayaib.hue-console.partitionCalc', icon: '\\u{1F4CA}', title: 'Partition Calculator', desc: 'Calculate optimal Hadoop/Hive partitions, Spark config, and partition key strategies.', tag: 'Compute' },
            { cmd: 'sayaib.hue-console.deltaLakeAnalyzer', icon: '\\u{1F5C4}', title: 'Delta Lake Analyzer', desc: 'Inspect Delta Lake transaction logs (_delta_log), commits, and file additions/removals.', tag: 'Lakehouse' },
            { cmd: 'sayaib.hue-console.sparkCostEstimator', icon: '\\u{1F4B0}', title: 'Spark Cost & Cluster Estimator', desc: 'Estimate recommended Spark worker nodes, memory, partitions, and monthly cloud costs.', tag: 'Cloud' }
        ];
        var grid = document.getElementById('grid');
        var groups = {};
        var order = ['Schema & Quality', 'Querying', 'Storage & Lakehouse'];
        tools.forEach(function(t) {
            var section = t.tag === 'SQL' ? 'Querying' : (t.tag === 'Compute' || t.tag === 'Lakehouse' || t.tag === 'Cloud' ? 'Storage & Lakehouse' : 'Schema & Quality');
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
   1. SCHEMA VIEWER
   ================================================================ */
function getSchemaViewerHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Schema Viewer</title>
    <style>
        ${SHARED_CSS}
        .schema-tree { font-family: var(--mono); font-size: 13px; line-height: 1.8; }
        .schema-tree .field {
            padding: 4px 0;
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }
        .schema-tree .nested { margin-left: 24px; border-left: 1px solid var(--border); padding-left: 12px; }
        .schema-tree .fname { font-weight: 600; color: var(--fg-0); }
        .schema-tree .ftype {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
        .type-string { background: rgba(33,150,243,0.15); color: #2196f3; }
        .type-number { background: rgba(76,175,80,0.15); color: #4caf50; }
        .type-boolean { background: rgba(255,152,0,0.15); color: #ff9800; }
        .type-object { background: rgba(156,39,176,0.15); color: #9c27b0; }
        .type-array { background: rgba(0,188,212,0.15); color: #00bcd4; }
        .type-null { background: rgba(158,158,158,0.15); color: #9e9e9e; }
        .required-badge {
            font-size: 10px;
            background: rgba(244,67,54,0.15);
            color: var(--error);
            padding: 1px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
        .stat-row { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 14px; }
        .stat-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px 20px;
            flex: 1;
            min-width: 120px;
        }
        .stat-box .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; letter-spacing: 0.3px; }
        .stat-box .value { font-size: 22px; font-weight: 700; margin-top: 4px; font-family: var(--mono); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Schema Viewer</h1>
        <span class="subtitle">Parse and visualize Parquet/Avro/JSON schemas</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Paste JSON Schema</label>
            <textarea id="schemaInput" rows="10" placeholder='Paste a JSON schema object, e.g.:\n{\n  "type": "object",\n  "properties": {\n    "id": { "type": "integer" },\n    "name": { "type": "string" },\n    "tags": { "type": "array", "items": { "type": "string" } },\n    "address": {\n      "type": "object",\n      "properties": {\n        "city": { "type": "string" },\n        "zip": { "type": "string" }\n      },\n      "required": ["city"]\n    }\n  },\n  "required": ["id", "name"]\n}'></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="parseBtn">Parse Schema</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Formatted</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="stat-row" id="stats" style="display:none;">
            <div class="stat-box">
                <div class="label">Fields</div>
                <div class="value" id="fieldCount">0</div>
            </div>
            <div class="stat-box">
                <div class="label">Max Depth</div>
                <div class="value" id="depthCount">0</div>
            </div>
            <div class="stat-box">
                <div class="label">Required</div>
                <div class="value" id="requiredCount">0</div>
            </div>
        </div>
        <div class="section" id="treeSection" style="display:none;">
            <div class="section-title">Schema Tree</div>
            <div class="schema-tree" id="schemaTree"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var formattedSchema = '';

        function escapeHtml(value) {
            return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function renderNode(schema, name, required, depth) {
            var html = '<div class="field" style="margin-left:' + (depth * 16) + 'px">';
            if (name) html += '<span class="fname">' + escapeHtml(name) + '</span>';
            var type = schema.type || (schema.properties ? 'object' : (schema.items ? 'array' : 'string'));
            html += '<span class="ftype type-' + type + '">' + escapeHtml(type) + '</span>';
            if (required) html += '<span class="required-badge">required</span>';
            if (schema.description) html += '<span style="color:var(--fg-1);font-size:11px;">// ' + escapeHtml(schema.description) + '</span>';
            html += '</div>';

            if (type === 'object' && schema.properties) {
                var reqList = schema.required || [];
                var keys = Object.keys(schema.properties);
                for (var i = 0; i < keys.length; i++) {
                    var k = keys[i];
                    html += renderNode(schema.properties[k], k, reqList.indexOf(k) !== -1, depth + 1);
                }
            } else if (type === 'array' && schema.items) {
                html += renderNode(schema.items, '[item]', false, depth + 1);
            }
            return html;
        }

        function countFields(schema) {
            var count = 1;
            if (schema.properties) {
                var keys = Object.keys(schema.properties);
                for (var i = 0; i < keys.length; i++) {
                    count += countFields(schema.properties[keys[i]]);
                }
            } else if (schema.items) {
                count += countFields(schema.items);
            }
            return count;
        }

        function maxDepth(schema, d) {
            d = d || 1;
            var maxD = d;
            if (schema.properties) {
                var keys = Object.keys(schema.properties);
                for (var i = 0; i < keys.length; i++) {
                    var sub = maxDepth(schema.properties[keys[i]], d + 1);
                    if (sub > maxD) maxD = sub;
                }
            } else if (schema.items) {
                var sub = maxDepth(schema.items, d + 1);
                if (sub > maxD) maxD = sub;
            }
            return maxD;
        }

        function countRequired(schema) {
            var req = (schema.required || []).length;
            if (schema.properties) {
                var keys = Object.keys(schema.properties);
                for (var i = 0; i < keys.length; i++) {
                    req += countRequired(schema.properties[keys[i]]);
                }
            }
            return req;
        }

        document.getElementById('parseBtn').addEventListener('click', function() {
            var raw = document.getElementById('schemaInput').value.trim();
            if (!raw) { _toast('Please enter a schema', 'error'); return; }
            try {
                var obj = JSON.parse(raw);
                formattedSchema = JSON.stringify(obj, null, 2);
                document.getElementById('fieldCount').textContent = countFields(obj);
                document.getElementById('depthCount').textContent = maxDepth(obj);
                document.getElementById('requiredCount').textContent = countRequired(obj);
                document.getElementById('schemaTree').innerHTML = renderNode(obj, 'root', false, 0);
                document.getElementById('stats').style.display = 'flex';
                document.getElementById('treeSection').style.display = 'block';
                _toast('Schema parsed successfully!', 'success');
            } catch (e) {
                _toast('Invalid JSON schema: ' + e.message, 'error');
            }
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!formattedSchema) { _toast('No schema parsed', 'error'); return; }
            navigator.clipboard.writeText(formattedSchema).then(function() { _toast('Copied schema!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('schemaInput').value = '';
            document.getElementById('stats').style.display = 'none';
            document.getElementById('treeSection').style.display = 'none';
            formattedSchema = '';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   2. SPARK SQL FORMATTER
   ================================================================ */
function getSparkSqlFormatterHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spark SQL Formatter</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Spark SQL / Presto / Trino Formatter</h1>
        <span class="subtitle">Format and beautify big data SQL queries</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>SQL Query</label>
            <textarea id="sqlInput" rows="8" placeholder="SELECT user_id, count(1) as cnt FROM events LATERAL VIEW explode(tags) as t WHERE dt >= '2026-01-01' GROUP BY user_id ORDER BY cnt DESC"></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="formatBtn">Format SQL</button>
                <button class="btn btn-secondary" id="upperBtn">UPPERCASE Keywords</button>
                <button class="btn btn-ghost" id="copyBtn">Copy</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section">
            <div class="section-title">Formatted Output</div>
            <div class="result-block" id="sqlOutput">-- Formatted query will appear here</div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN', 'ON', 'AS', 'LATERAL VIEW', 'EXPLODE', 'UNION', 'ALL', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'INSERT INTO', 'OVERWRITE TABLE'];

        function formatSql(text, upper) {
            var q = text.trim().replace(/\\s+/g, ' ');
            if (upper) {
                var re = new RegExp('\\\\b(' + keywords.join('|') + ')\\\\b', 'gi');
                q = q.replace(re, function(m) { return m.toUpperCase(); });
            }
            // Basic indentation for clauses
            var formatted = q
                .replace(/\\b(SELECT)\\b/gi, '\\nSELECT\\n  ')
                .replace(/\\b(FROM)\\b/gi, '\\nFROM\\n  ')
                .replace(/\\b(WHERE)\\b/gi, '\\nWHERE\\n  ')
                .replace(/\\b(GROUP BY)\\b/gi, '\\nGROUP BY\\n  ')
                .replace(/\\b(ORDER BY)\\b/gi, '\\nORDER BY\\n  ')
                .replace(/\\b(HAVING)\\b/gi, '\\nHAVING\\n  ')
                .replace(/\\b(LIMIT)\\b/gi, '\\nLIMIT\\n  ')
                .replace(/\\b(LEFT JOIN|RIGHT JOIN|INNER JOIN|JOIN)\\b/gi, '\\n\\$1\\n  ')
                .replace(/,/g, ',\\n  ');
            return formatted.trim();
        }

        document.getElementById('formatBtn').addEventListener('click', function() {
            var val = document.getElementById('sqlInput').value;
            if (!val) { _toast('Enter a SQL query', 'error'); return; }
            document.getElementById('sqlOutput').textContent = formatSql(val, true);
            _toast('SQL formatted!', 'success');
        });

        document.getElementById('upperBtn').addEventListener('click', function() {
            var val = document.getElementById('sqlInput').value;
            if (!val) { _toast('Enter a SQL query', 'error'); return; }
            document.getElementById('sqlOutput').textContent = formatSql(val, true);
            _toast('Keywords uppercased!', 'success');
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            var text = document.getElementById('sqlOutput').textContent;
            navigator.clipboard.writeText(text).then(function() { _toast('Copied SQL!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('sqlInput').value = '';
            document.getElementById('sqlOutput').textContent = '-- Formatted query will appear here';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   3. DATA QUALITY CHECKER
   ================================================================ */
function getDataQualityCheckerHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Quality Checker</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Data Quality Checker</h1>
        <span class="subtitle">Validate JSON records for missing values, nulls, and anomalies</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Paste JSON Array of Records</label>
            <textarea id="dataInput" rows="8" placeholder='[\n  { "id": 1, "name": "Alice", "score": 95, "email": "alice@example.com" },\n  { "id": 2, "name": "Bob", "score": null, "email": null },\n  { "id": 3, "name": "Alice", "score": 88, "email": "alice@example.com" }\n]'></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="checkBtn">Run Quality Audit</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="reportSection" style="display:none;">
            <div class="section-title">Data Quality Report</div>
            <div class="result-block" id="reportOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('checkBtn').addEventListener('click', function() {
            var raw = document.getElementById('dataInput').value.trim();
            if (!raw) { _toast('Please enter JSON records', 'error'); return; }
            try {
                var rows = JSON.parse(raw);
                if (!Array.isArray(rows)) { _toast('Input must be a JSON array of objects', 'error'); return; }
                if (rows.length === 0) { _toast('Array is empty', 'error'); return; }

                var totalRows = rows.length;
                var keys = Object.keys(rows[0]);
                var nullCounts = {};
                var duplicates = 0;
                var seen = {};

                keys.forEach(function(k) { nullCounts[k] = 0; });

                rows.forEach(function(r) {
                    var sig = JSON.stringify(r);
                    if (seen[sig]) duplicates++;
                    else seen[sig] = true;

                    keys.forEach(function(k) {
                        if (r[k] === null || r[k] === undefined || r[k] === '') {
                            nullCounts[k]++;
                        }
                    });
                });

                var report = 'DATA QUALITY AUDIT REPORT\\n' + '='.repeat(35) + '\\n';
                report += 'Total Records: ' + totalRows + '\\n';
                report += 'Total Columns: ' + keys.length + ' (' + keys.join(', ') + ')\\n';
                report += 'Duplicate Rows: ' + duplicates + ' (' + ((duplicates / totalRows) * 100).toFixed(1) + '%)\\n\\n';
                report += 'Missing / Null Values per Column:\\n';
                keys.forEach(function(k) {
                    var missing = nullCounts[k];
                    var pct = ((missing / totalRows) * 100).toFixed(1);
                    report += '  - ' + k + ': ' + missing + ' missing (' + pct + '%)\\n';
                });

                document.getElementById('reportOutput').textContent = report;
                document.getElementById('reportSection').style.display = 'block';
                _toast('Data quality check completed!', 'success');
            } catch (e) {
                _toast('Error parsing JSON: ' + e.message, 'error');
            }
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('dataInput').value = '';
            document.getElementById('reportSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   4. SCHEMA DIFF TOOL
   ================================================================ */
function getSchemaDiffHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Schema Diff Tool</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Schema Diff Tool</h1>
        <span class="subtitle">Compare two JSON schemas to detect breaking changes</span>
    </div>
    <div class="tool-body">
        <div class="panels">
            <div class="section" style="margin-bottom:0;">
                <label>Schema A (v1)</label>
                <textarea id="schemaA" rows="8" placeholder='{ "id": "int", "name": "string", "status": "string" }'></textarea>
            </div>
            <div class="section" style="margin-bottom:0;">
                <label>Schema B (v2)</label>
                <textarea id="schemaB" rows="8" placeholder='{ "id": "int", "name": "string", "email": "string", "status": "boolean" }'></textarea>
            </div>
        </div>
        <div style="margin-top: 16px;" class="btn-row">
            <button class="btn" id="diffBtn">Compare Schemas</button>
            <button class="btn btn-ghost" id="clearBtn">Clear</button>
        </div>
        <div class="section" id="diffSection" style="display:none; margin-top:16px;">
            <div class="section-title">Schema Comparison Results</div>
            <div class="result-block" id="diffOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('diffBtn').addEventListener('click', function() {
            var rawA = document.getElementById('schemaA').value.trim();
            var rawB = document.getElementById('schemaB').value.trim();
            if (!rawA || !rawB) { _toast('Provide both schemas', 'error'); return; }
            try {
                var objA = JSON.parse(rawA);
                var objB = JSON.parse(rawB);

                var keysA = Object.keys(objA);
                var keysB = Object.keys(objB);

                var added = keysB.filter(function(k) { return keysA.indexOf(k) === -1; });
                var removed = keysA.filter(function(k) { return keysB.indexOf(k) === -1; });
                var common = keysA.filter(function(k) { return keysB.indexOf(k) !== -1; });
                var changed = [];

                common.forEach(function(k) {
                    if (objA[k] !== objB[k]) {
                        changed.push({ field: k, from: objA[k], to: objB[k] });
                    }
                });

                var report = 'SCHEMA DIFF REPORT\\n' + '='.repeat(30) + '\\n';
                report += 'Added Fields (' + added.length + '):\\n';
                if (added.length === 0) report += '  (none)\\n';
                added.forEach(function(k) { report += '  + ' + k + ': ' + JSON.stringify(objB[k]) + '\\n'; });

                report += '\\nRemoved Fields (' + removed.length + '):\\n';
                if (removed.length === 0) report += '  (none)\\n';
                removed.forEach(function(k) { report += '  - ' + k + ': ' + JSON.stringify(objA[k]) + '\\n'; });

                report += '\\nType / Value Changes (' + changed.length + '):\\n';
                if (changed.length === 0) report += '  (none)\\n';
                changed.forEach(function(c) { report += '  ~ ' + c.field + ': ' + JSON.stringify(c.from) + ' -> ' + JSON.stringify(c.to) + '\\n'; });

                document.getElementById('diffOutput').textContent = report;
                document.getElementById('diffSection').style.display = 'block';
                _toast('Schema comparison complete!', 'success');
            } catch (e) {
                _toast('Invalid JSON: ' + e.message, 'error');
            }
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('schemaA').value = '';
            document.getElementById('schemaB').value = '';
            document.getElementById('diffSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   5. PARTITION CALCULATOR
   ================================================================ */
function getPartitionCalcHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Partition Calculator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Data Partition Calculator</h1>
        <span class="subtitle">Calculate optimal Spark shuffle partitions & file sizing</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Total Dataset Size (GB)</label>
                    <input type="number" id="dataSize" value="150" min="1" />
                </div>
                <div>
                    <label>Target Parquet File Size (MB)</label>
                    <input type="number" id="targetSize" value="128" min="16" max="512" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Average Row Size (Bytes)</label>
                    <input type="number" id="rowSize" value="500" min="10" />
                </div>
                <div>
                    <label>Cluster Cores Available</label>
                    <input type="number" id="cores" value="64" min="1" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="calcBtn">Calculate Partitions</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Partition & Tuning Recommendations</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
        <div class="section" id="sparkSection" style="display:none;">
            <div class="section-title">Recommended Spark SQL Config</div>
            <div class="result-block" id="sparkConfig"></div>
            <div class="btn-row" style="margin-top: 10px;">
                <button class="btn btn-secondary" id="copyBtn">Copy Config</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var sparkConfigText = '';

        document.getElementById('calcBtn').addEventListener('click', function() {
            var sizeGB = parseFloat(document.getElementById('dataSize').value) || 150;
            var targetMB = parseFloat(document.getElementById('targetSize').value) || 128;
            var bytesPerRow = parseFloat(document.getElementById('rowSize').value) || 500;
            var availCores = parseInt(document.getElementById('cores').value) || 64;

            var totalBytes = sizeGB * 1024 * 1024 * 1024;
            var totalRows = Math.round(totalBytes / bytesPerRow);
            var targetBytes = targetMB * 1024 * 1024;
            var numFiles = Math.max(1, Math.round(totalBytes / targetBytes));
            var numPartitions = Math.max(availCores * 3, Math.round(totalBytes / (128 * 1024 * 1024)));

            var res = 'PARTITION & PERFORMANCE ANALYSIS\\n' + '='.repeat(35) + '\\n';
            res += 'Total Dataset Size: ' + sizeGB + ' GB (' + totalBytes.toLocaleString() + ' bytes)\\n';
            res += 'Estimated Total Rows: ' + totalRows.toLocaleString() + '\\n';
            res += 'Target File Size: ' + targetMB + ' MB\\n';
            res += 'Recommended Output Files: ' + numFiles.toLocaleString() + '\\n';
            res += 'Recommended Spark Shuffle Partitions: ' + numPartitions + ' (approx 3x available cores)\\n';

            document.getElementById('resultOutput').textContent = res;
            document.getElementById('resultSection').style.display = 'block';

            sparkConfigText = '// Spark SQL optimization config\\n' +
                'spark.sql.shuffle.partitions = ' + numPartitions + '\\n' +
                'spark.sql.files.maxPartitionBytes = ' + targetBytes + '\\n' +
                'spark.sql.adaptive.enabled = true\\n' +
                'spark.sql.adaptive.coalescePartitions.enabled = true\\n\\n' +
                'df.repartition(' + numPartitions + ')\\n' +
                '  .write.mode("overwrite")\\n' +
                '  .parquet("/data/output/")';

            document.getElementById('sparkConfig').textContent = sparkConfigText;
            document.getElementById('sparkSection').style.display = 'block';
            _toast('Calculated successfully!', 'success');
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!sparkConfigText) return;
            navigator.clipboard.writeText(sparkConfigText).then(function() { _toast('Copied config!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('resultSection').style.display = 'none';
            document.getElementById('sparkSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   6. DELTA LAKE LOG ANALYZER
   ================================================================ */
function getDeltaLakeAnalyzerHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Delta Lake Log Analyzer</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Delta Lake Log Analyzer</h1>
        <span class="subtitle">Inspect _delta_log transaction commit JSON files</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Paste Delta Log JSON Commit (or newline separated commit lines)</label>
            <textarea id="logInput" rows="10" placeholder='{\n  "commitInfo": {\n    "timestamp": 1711000000000,\n    "operation": "WRITE",\n    "operationParameters": { "mode": "Append", "partitionBy": "[\"dt\"]" },\n    "engineInfo": "Apache-Spark/3.5.0 Delta-Lake/3.1.0"\n  }\n}\n{\n  "add": {\n    "path": "dt=2026-03-22/part-0000.parquet",\n    "size": 245760,\n    "modificationTime": 1711000000000\n  }\n}'></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="analyzeBtn">Analyze Delta Log</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="reportSection" style="display:none;">
            <div class="section-title">Delta Transaction Analysis</div>
            <div class="result-block" id="reportOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('analyzeBtn').addEventListener('click', function() {
            var raw = document.getElementById('logInput').value.trim();
            if (!raw) { _toast('Please paste delta log JSON', 'error'); return; }
            try {
                var lines = raw.split(/\\r?\\n/);
                var commits = 0;
                var adds = 0;
                var removes = 0;
                var totalBytesAdded = 0;
                var operations = [];
                var engine = '';

                lines.forEach(function(line) {
                    line = line.trim();
                    if (!line) return;
                    try {
                        var obj = JSON.parse(line);
                        if (obj.commitInfo) {
                            commits++;
                            if (obj.commitInfo.operation) operations.push(obj.commitInfo.operation);
                            if (obj.commitInfo.engineInfo) engine = obj.commitInfo.engineInfo;
                        }
                        if (obj.add) {
                            adds++;
                            if (obj.add.size) totalBytesAdded += obj.add.size;
                        }
                        if (obj.remove) {
                            removes++;
                        }
                    } catch (err) {
                        // ignore invalid lines
                    }
                });

                var report = 'DELTA LAKE TRANSACTION LOG REPORT\\n' + '='.repeat(40) + '\\n';
                report += 'Parsed Commit Entries: ' + commits + '\\n';
                report += 'Engine Info: ' + (engine || 'Unknown') + '\\n';
                report += 'Operations Executed: ' + (operations.length ? operations.join(', ') : 'None') + '\\n\\n';
                report += 'File Actions:\\n';
                report += '  + Files Added: ' + adds + ' (' + (totalBytesAdded / (1024 * 1024)).toFixed(2) + ' MB)\\n';
                report += '  - Files Removed: ' + removes + '\\n';
                report += 'Net File Delta: ' + (adds - removes) + '\\n';

                document.getElementById('reportOutput').textContent = report;
                document.getElementById('reportSection').style.display = 'block';
                _toast('Delta log analyzed!', 'success');
            } catch (e) {
                _toast('Analysis error: ' + e.message, 'error');
            }
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('logInput').value = '';
            document.getElementById('reportSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   7. SPARK COST & CLUSTER ESTIMATOR
   ================================================================ */
function getSparkCostEstimatorHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spark Cluster & Cost Estimator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Spark Cluster & Cost Estimator</h1>
        <span class="subtitle">Estimate cluster size and monthly cloud costs for Spark pipelines</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Daily Data Volume Processed (GB)</label>
                    <input type="number" id="dataGB" value="500" min="1" />
                </div>
                <div>
                    <label>Pipeline Runs Per Day</label>
                    <input type="number" id="runsPerDay" value="4" min="1" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Cloud Provider / Platform</label>
                    <select id="cloudProvider">
                        <option value="databricks">Databricks (AWS/Azure)</option>
                        <option value="emr">AWS EMR (Managed Spark)</option>
                        <option value="dataproc">Google Cloud Dataproc</option>
                    </select>
                </div>
                <div>
                    <label>Average Job Duration (Minutes)</label>
                    <input type="number" id="durationMin" value="45" min="1" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="estimateBtn">Estimate Cluster & Cost</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Estimation Results</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('estimateBtn').addEventListener('click', function() {
            var gb = parseFloat(document.getElementById('dataGB').value) || 500;
            var runs = parseFloat(document.getElementById('runsPerDay').value) || 4;
            var provider = document.getElementById('cloudProvider').value;
            var mins = parseFloat(document.getElementById('durationMin').value) || 45;

            var workers = Math.max(2, Math.ceil(gb / 100));
            var driverRAM = gb > 1000 ? 64 : 32;
            var workerRAM = 32;
            var workerCores = 8;

            var hourlyRatePerWorker = provider === 'databricks' ? 0.45 : (provider === 'emr' ? 0.35 : 0.30);
            var driverRate = hourlyRatePerWorker * 1.5;
            var totalHourlyRate = driverRate + (workers * hourlyRatePerWorker);

            var hoursPerDay = (runs * mins) / 60.0;
            var dailyCost = hoursPerDay * totalHourlyRate;
            var monthlyCost = dailyCost * 30;

            var report = 'SPARK CLUSTER & CLOUD COST ESTIMATE\\n' + '='.repeat(40) + '\\n';
            report += 'Platform: ' + provider.toUpperCase() + '\\n';
            report += 'Data Volume: ' + gb + ' GB / day (' + runs + ' runs/day)\\n\\n';
            report += 'Recommended Cluster Configuration:\\n';
            report += '  - Driver Node: 1x (RAM: ' + driverRAM + ' GB, Cores: 16)\\n';
            report += '  - Worker Nodes: ' + workers + 'x (RAM per worker: ' + workerRAM + ' GB, Cores: ' + workerCores + ')\\n';
            report += '  - Total Cluster Cores: ' + (16 + (workers * workerCores)) + '\\n\\n';
            report += 'Estimated Cost:\\n';
            report += '  - Runtime per Day: ' + hoursPerDay.toFixed(1) + ' hours\\n';
            report += '  - Daily Cost: $' + dailyCost.toFixed(2) + '\\n';
            report += '  - Estimated Monthly Cost: $' + monthlyCost.toFixed(2) + ' / month\\n';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Cost estimation completed!', 'success');
        });
    </script>
</body>
</html>`;
}
