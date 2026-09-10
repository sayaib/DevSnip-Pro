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

    context.subscriptions.push(
        hubCmd, schemaViewerCmd, sparkSqlFormatterCmd, dataQualityCheckerCmd,
        schemaDiffCmd, partitionCalcCmd
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
        <span class="subtitle">5 built-in utilities for data engineering workflows</span>
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
            { cmd: 'sayaib.hue-console.partitionCalc', icon: '\\u{1F4CA}', title: 'Partition Calculator', desc: 'Calculate optimal Hadoop/Hive partitions, Spark config, and partition key strategies.', tag: 'Compute' }
        ];
        var grid = document.getElementById('grid');
        var groups = {};
        var order = ['Schema & Quality', 'Querying', 'Storage & Performance'];
        tools.forEach(function(t) {
            var section = t.tag === 'SQL' ? 'Querying' : (t.tag === 'Compute' ? 'Storage & Performance' : 'Schema & Quality');
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
            var type = schema.type || 'unknown';
            var html = '<div class="field" style="padding-left:' + (depth * 24) + 'px;">' +
                '<span class="fname">' + escapeHtml(name || 'root') + '</span>' +
                '<span class="ftype type-' + type + '">' + escapeHtml(type) + '</span>';
            if (type === 'array' && schema.items) {
                html += '<span style="font-size:11px;color:var(--fg-2);">of</span> ' +
                    '<span class="ftype type-' + (schema.items.type || 'unknown') + '">' + escapeHtml(schema.items.type || 'unknown') + '</span>';
            }
            if (required) html += '<span class="required-badge">required</span>';
            html += '</div>';

            var children = type === 'object' ? schema.properties || {} :
                (type === 'array' && schema.items && schema.items.type === 'object' ? { '[item]': schema.items } : {});
            if (Object.keys(children).length) {
                html += '<div class="nested">';
                Object.keys(children).forEach(function(key) {
                    var requiredChild = (schema.required || []).indexOf(key) !== -1;
                    html += renderNode(children[key], key, requiredChild, depth + 1);
                });
                html += '</div>';
            }
            return html;
        }

        function inferSchema(value) {
            if (value === null) return { type: 'null' };
            if (Array.isArray(value)) {
                var itemSchemas = value.map(inferSchema);
                var mergedItems = itemSchemas[0] || { type: 'unknown' };
                itemSchemas.slice(1).forEach(function(item) { mergedItems = mergeSchemas(mergedItems, item); });
                return { type: 'array', items: mergedItems };
            }
            if (typeof value === 'object') {
                var objectKeys = Object.keys(value);
                if (objectKeys.length === 1 && Object.prototype.hasOwnProperty.call(value, '$date')) return { type: 'date' };
                var properties = {};
                objectKeys.forEach(function(key) { properties[key] = inferSchema(value[key]); });
                return { type: 'object', properties: properties, required: objectKeys.slice() };
            }
            return { type: typeof value === 'number' ? 'number' : typeof value };
        }

        function mergeSchemas(left, right) {
            if (left.type === right.type) {
                if (left.type === 'object') {
                    var merged = {};
                    Object.keys(left.properties || {}).forEach(function(k) { merged[k] = left.properties[k]; });
                    Object.keys(right.properties || {}).forEach(function(k) { merged[k] = merged[k] ? mergeSchemas(merged[k], right.properties[k]) : right.properties[k]; });
                    var leftRequired = left.required || Object.keys(left.properties || {});
                    var rightRequired = right.required || Object.keys(right.properties || {});
                    return { type: 'object', properties: merged, required: leftRequired.filter(function(k) { return rightRequired.indexOf(k) !== -1; }) };
                }
                if (left.type === 'array') return { type: 'array', items: mergeSchemas(left.items || { type: 'unknown' }, right.items || { type: 'unknown' }) };
                return left;
            }
            if (left.type === 'null') return right;
            if (right.type === 'null') return left;
            return { type: 'mixed' };
        }

        function countStats(schema) {
            var fields = 0;
            var required = 0;
            var maxDepth = 0;

            function walk(obj, depth) {
                if (obj.type === 'object' && obj.properties) {
                    Object.keys(obj.properties).forEach(function(k) {
                        fields++;
                        if (obj.required && obj.required.indexOf(k) !== -1) required++;
                        var child = obj.properties[k];
                        if (child.type === 'object' || child.type === 'array') {
                            var d = walk(child, depth + 1);
                            if (d > maxDepth) maxDepth = d;
                        }
                    });
                } else if (obj.type === 'array' && obj.items) {
                    return walk(obj.items, depth + 1);
                }
                return depth;
            }

            var d = walk(schema, 0);
            if (d > maxDepth) maxDepth = d;
            return { fields: fields, required: required, maxDepth: maxDepth };
        }

        document.getElementById('parseBtn').addEventListener('click', function() {
            var input = document.getElementById('schemaInput').value.trim();
            if (!input) { _toast('Paste a schema first', 'error'); return; }

            var schema;
            try {
                schema = JSON.parse(input);
            } catch (e) {
                _toast('Invalid JSON: ' + e.message, 'error');
                return;
            }

            var isJsonSchema = schema && typeof schema === 'object' && typeof schema.type === 'string' &&
                (schema.type === 'object' || schema.type === 'array' || schema.type === 'string' || schema.type === 'number');
            var inferredSchema = isJsonSchema ? schema : inferSchema(schema);
            formattedSchema = JSON.stringify(inferredSchema, null, 2);
            var stats = countStats(inferredSchema);
            document.getElementById('fieldCount').textContent = stats.fields;
            document.getElementById('depthCount').textContent = stats.maxDepth;
            document.getElementById('requiredCount').textContent = stats.required;
            document.getElementById('stats').style.display = 'flex';

            var treeHtml = renderNode(inferredSchema, null, false, 0);
            document.getElementById('schemaTree').innerHTML = treeHtml;
            document.getElementById('treeSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!formattedSchema) { _toast('Parse a schema first', 'error'); return; }
            navigator.clipboard.writeText(formattedSchema).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
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
    <title>Spark SQL / Presto / Trino Formatter</title>
    <style>
        ${SHARED_CSS}
        .formatted-output {
            background: var(--bg-3);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            font-family: var(--mono);
            font-size: 13px;
            line-height: 1.7;
            white-space: pre-wrap;
            max-height: 500px;
            overflow-y: auto;
        }
        .keyword { color: #2196f3; font-weight: 700; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Spark SQL / Presto / Trino Formatter</h1>
        <span class="subtitle">Format SQL queries with proper indentation</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Raw SQL Input</label>
            <textarea id="sqlInput" rows="10" placeholder="Paste your Spark SQL, Presto, or Trino query here..."></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="formatBtn">Format</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Formatted SQL</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Formatted Output</div>
            <div class="formatted-output" id="output"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var formatted = '';

        function formatSql(sql) {
            sql = sql.replace(/\\s+/g, ' ').trim();
            var topKeywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'UNION', 'INSERT', 'CREATE', 'ALTER', 'DROP', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'LATERAL VIEW', 'LATERAL VIEW OUTER', 'ON', 'SET', 'VALUES', 'INTO', 'PARTITION BY', 'DISTRIBUTE BY', 'SORT BY', 'CLUSTER BY', 'TABLESAMPLE', 'PIVOT', 'UNPIVOT', 'EXPLAIN'];

            var formatted = sql;
            topKeywords.forEach(function(kw) {
                var regex = new RegExp('\\\\b' + kw.replace(/ /g, '\\\\s+') + '\\\\b', 'gi');
                formatted = formatted.replace(regex, '\\n' + kw);
            });

            var lines = formatted.split('\\n').filter(function(l) { return l.trim(); });
            var result = [];
            var indent = 0;
            var subKeywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'ON', 'SET', 'VALUES', 'INTO'];

            lines.forEach(function(line) {
                line = line.trim();
                if (!line) return;

                var upperLine = line.toUpperCase();
                var isClosing = false;
                var openCount = (line.match(/\\(/g) || []).length;
                var closeCount = (line.match(/\\)/g) || []).length;

                if (closeCount > openCount) {
                    indent = Math.max(0, indent - (closeCount - openCount));
                }

                result.push('    '.repeat(indent) + line);

                if (openCount > closeCount) {
                    indent += (openCount - closeCount);
                }
            });

            return result.join('\\n');
        }

        function uppercaseKeywords(sql) {
            var keywords = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'ON', 'AS', 'IS', 'NULL', 'TRUE', 'FALSE',
                'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'INNER', 'OUTER',
                'UNION', 'ALL', 'DISTINCT', 'INSERT', 'INTO', 'VALUES', 'CREATE', 'TABLE', 'ALTER', 'DROP',
                'SET', 'PARTITION BY', 'DISTRIBUTE BY', 'SORT BY', 'CLUSTER BY', 'LATERAL', 'VIEW', 'EXPLAIN',
                'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'BETWEEN', 'LIKE', 'EXISTS', 'OVER', 'PARTITION',
                'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE',
                'COALESCE', 'NVL', 'IF', 'CAST', 'TRY_CAST', 'STRUCT', 'ARRAY', 'MAP',
                'PIVOT', 'UNPIVOT', 'TABLESAMPLE', 'CLUSTER', 'REPLACE', 'CACHE', 'UNCACHE',
                'WITH', 'RECURSIVE', 'FETCH', 'OFFSET', 'ROWS', 'ONLY', 'FIRST', 'NEXT'];

            var result = sql;
            keywords.forEach(function(kw) {
                var regex = new RegExp('\\\\b' + kw.replace(/ /g, '\\\\s+') + '\\\\b', 'g');
                result = result.replace(regex, kw);
            });
            return result;
        }

        document.getElementById('formatBtn').addEventListener('click', function() {
            var input = document.getElementById('sqlInput').value.trim();
            if (!input) { _toast('Enter SQL first', 'error'); return; }

            formatted = formatSql(input);
            formatted = uppercaseKeywords(formatted);
            document.getElementById('output').textContent = formatted;
            document.getElementById('resultSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!formatted) { _toast('Format SQL first', 'error'); return; }
            navigator.clipboard.writeText(formatted).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('sqlInput').value = '';
            document.getElementById('resultSection').style.display = 'none';
            formatted = '';
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
    <title>CSV/JSON Data Quality Checker</title>
    <style>
        ${SHARED_CSS}
        .quality-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-top: 12px;
        }
        .quality-table th {
            background: var(--bg-2);
            padding: 8px 10px;
            text-align: left;
            border: 1px solid var(--border);
            font-weight: 700;
        }
        .quality-table td {
            padding: 6px 10px;
            border: 1px solid var(--border);
            font-family: var(--mono);
            font-size: 11px;
        }
        .quality-table tr:hover td { background: rgba(0,122,204,0.05); }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 12px;
            margin-top: 14px;
        }
        .summary-card {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            text-align: center;
        }
        .summary-card .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .summary-card .value { font-size: 20px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>CSV/JSON Data Quality Checker</h1>
        <span class="subtitle">Analyze datasets for quality issues</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end;">
                <div><label>Paste CSV or JSON Data</label>
                    <textarea id="dataInput" rows="10" placeholder='CSV: id,name,age\\n1,Alice,30\\n2,Bob,25\\n\\nJSON: [{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]'></textarea>
                </div>
                <div><label>Format</label>
                    <select id="formatSelect">
                        <option value="csv">CSV</option>
                        <option value="json">JSON</option>
                    </select>
                </div>
                <div><label>Nested path filter</label><input id="qualityFilter" type="text" placeholder="e.g. rawRow or calDate.year"></div>
            </div>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="checkBtn">Check Quality</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Summary</div>
            <div class="summary-grid" id="summaryGrid"></div>
        </div>
        <div class="section" id="detailSection" style="display:none;">
            <div class="section-title">Column Analysis</div>
            <div style="overflow-x:auto;">
                <table class="quality-table" id="qualityTable"></table>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function parseCsv(text) {
            var lines = text.trim().split('\\n').filter(function(l) { return l.trim(); });
            if (!lines.length) return { headers: [], rows: [] };
            var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
            var rows = [];
            for (var i = 1; i < lines.length; i++) {
                var vals = lines[i].split(',').map(function(v) { return v.trim().replace(/^"|"$/g, ''); });
                rows.push(vals);
            }
            return { headers: headers, rows: rows };
        }

        function flattenNested(value, path, out) {
            if (value === null || typeof value !== 'object') {
                out[path || '$'] = value === null ? '' : String(value);
                return;
            }
            if (Array.isArray(value)) {
                if (!value.length) { out[path || '$'] = '[]'; return; }
                value.forEach(function(item, index) { flattenNested(item, (path ? path + '.' : '') + '[' + index + ']', out); });
                return;
            }
            var keys = Object.keys(value);
            if (!keys.length) { out[path || '$'] = '{}'; return; }
            keys.forEach(function(key) { flattenNested(value[key], path ? path + '.' + key : key, out); });
        }

        function parseJsonData(text) {
            var data = JSON.parse(text);
            if (!Array.isArray(data)) data = [data];
            var flattened = data.map(function(row) { var out = {}; flattenNested(row, '', out); return out; });
            var headers = [];
            flattened.forEach(function(row) { Object.keys(row).forEach(function(k) { if (headers.indexOf(k) === -1) headers.push(k); }); });
            var rows = flattened.map(function(row) { return headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; }); });
            return { headers: headers, rows: rows };
        }

        function detectType(values) {
            var nums = 0, bools = 0, dates = 0, strings = 0;
            var nonEmpty = values.filter(function(v) { return v !== ''; });
            if (!nonEmpty.length) return 'empty';
            nonEmpty.forEach(function(v) {
                if (v === 'true' || v === 'false' || v === 'True' || v === 'False') { bools++; return; }
                if (!isNaN(Number(v))) { nums++; return; }
                if (/^\\d{4}-\\d{2}-\\d{2}/.test(v) || /^\\d{2}\\/\\d{2}\\/\\d{4}/.test(v)) { dates++; return; }
                strings++;
            });
            var total = nonEmpty.length;
            if (nums / total > 0.8) return 'number';
            if (bools / total > 0.8) return 'boolean';
            if (dates / total > 0.8) return 'date';
            return 'string';
        }

        document.getElementById('checkBtn').addEventListener('click', function() {
            var input = document.getElementById('dataInput').value.trim();
            if (!input) { _toast('Paste data first', 'error'); return; }
            var format = document.getElementById('formatSelect').value;
            var parsed;

            try {
                if (format === 'csv') {
                    parsed = parseCsv(input);
                } else {
                    parsed = parseJsonData(input);
                }
            } catch (e) {
                _toast('Parse error: ' + e.message, 'error');
                return;
            }

            var totalRows = parsed.rows.length;
            var totalCols = parsed.headers.length;

            var fieldFilter = document.getElementById('qualityFilter').value.trim().toLowerCase();
            if (fieldFilter) {
                var selectedHeaders = parsed.headers.filter(function(h, ci) {
                    return h.toLowerCase().indexOf(fieldFilter) !== -1 || parsed.rows.some(function(row) {
                        return String(row[ci] || '').toLowerCase().indexOf(fieldFilter) !== -1;
                    });
                });
                parsed = {
                    headers: selectedHeaders,
                    rows: parsed.rows.map(function(row) {
                        return selectedHeaders.map(function(h) { return row[parsed.headers.indexOf(h)] || ''; });
                    })
                };
                totalCols = parsed.headers.length;
            }

            var missingPerCol = {};
            var uniquePerCol = {};
            var typePerCol = {};
            var numericStats = {};

            parsed.headers.forEach(function(h, ci) {
                var vals = parsed.rows.map(function(r) { return r[ci] || ''; });
                var missing = vals.filter(function(v) { return v === ''; }).length;
                var unique = {};
                vals.forEach(function(v) { unique[v] = true; });
                var uniqueCount = Object.keys(unique).length;
                var type = detectType(vals);

                missingPerCol[h] = missing;
                uniquePerCol[h] = uniqueCount;
                typePerCol[h] = type;

                if (type === 'number') {
                    var nums = vals.filter(function(v) { return v !== '' && !isNaN(Number(v)); }).map(Number);
                    if (nums.length) {
                        var sum = nums.reduce(function(a, b) { return a + b; }, 0);
                        numericStats[h] = {
                            min: Math.min.apply(null, nums),
                            max: Math.max.apply(null, nums),
                            avg: (sum / nums.length).toFixed(2)
                        };
                    }
                }
            });

            var duplicateRows = 0;
            var seen = {};
            parsed.rows.forEach(function(r) {
                var key = r.join('|||');
                if (seen[key]) { duplicateRows++; } else { seen[key] = true; }
            });

            var totalMissing = 0;
            Object.values(missingPerCol).forEach(function(v) { totalMissing += v; });

            var summaryHtml = '<div class="summary-card"><div class="label">Total Rows</div><div class="value">' + totalRows + '</div></div>' +
                '<div class="summary-card"><div class="label">Columns</div><div class="value">' + totalCols + '</div></div>' +
                '<div class="summary-card"><div class="label">Duplicate Rows</div><div class="value" style="color:' + (duplicateRows > 0 ? 'var(--error)' : 'var(--success)') + ';">' + duplicateRows + '</div></div>' +
                '<div class="summary-card"><div class="label">Missing Values</div><div class="value" style="color:' + (totalMissing > 0 ? 'var(--error)' : 'var(--success)') + ';">' + totalMissing + '</div></div>';
            document.getElementById('summaryGrid').innerHTML = summaryHtml;
            document.getElementById('resultSection').style.display = 'block';

            var tableHtml = '<thead><tr><th>Column</th><th>Type</th><th>Missing</th><th>Unique</th><th>Min</th><th>Max</th><th>Avg</th></tr></thead><tbody>';
            parsed.headers.forEach(function(h) {
                var stats = numericStats[h] || {};
                tableHtml += '<tr><td style="font-weight:700;">' + h + '</td>' +
                    '<td>' + typePerCol[h] + '</td>' +
                    '<td style="color:' + (missingPerCol[h] > 0 ? 'var(--error)' : 'var(--fg-2)') + ';">' + missingPerCol[h] + '</td>' +
                    '<td>' + uniquePerCol[h] + '</td>' +
                    '<td>' + (stats.min !== undefined ? stats.min : '-') + '</td>' +
                    '<td>' + (stats.max !== undefined ? stats.max : '-') + '</td>' +
                    '<td>' + (stats.avg !== undefined ? stats.avg : '-') + '</td></tr>';
            });
            tableHtml += '</tbody>';
            document.getElementById('qualityTable').innerHTML = tableHtml;
            document.getElementById('detailSection').style.display = 'block';
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('dataInput').value = '';
            document.getElementById('resultSection').style.display = 'none';
            document.getElementById('detailSection').style.display = 'none';
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
        .diff-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            margin-top: 12px;
        }
        .diff-table th {
            background: var(--bg-2);
            padding: 8px 10px;
            text-align: left;
            border: 1px solid var(--border);
            font-weight: 700;
        }
        .diff-table td {
            padding: 6px 10px;
            border: 1px solid var(--border);
            font-family: var(--mono);
            font-size: 11px;
        }
        .diff-only-a { background: rgba(244,67,54,0.12); }
        .diff-only-b { background: rgba(76,175,80,0.12); }
        .diff-changed { background: rgba(255,152,0,0.12); }
        .diff-identical { color: var(--fg-2); }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px;
        }
        .summary-card {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            text-align: center;
        }
        .summary-card .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .summary-card .value { font-size: 20px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Schema Diff Tool</h1>
        <span class="subtitle">Compare two JSON schemas side by side</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <div class="panel-label">Schema A</div>
                    <textarea id="schemaA" rows="12" placeholder='Paste first schema...\n{\n  "type": "object",\n  "properties": {\n    "id": { "type": "integer" },\n    "name": { "type": "string" }\n  }\n}'></textarea>
                </div>
                <div>
                    <div class="panel-label">Schema B</div>
                    <textarea id="schemaB" rows="12" placeholder='Paste second schema...\n{\n  "type": "object",\n  "properties": {\n    "id": { "type": "integer" },\n    "email": { "type": "string" }\n  }\n}'></textarea>
                </div>
            </div>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="compareBtn">Compare Schemas</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="summarySection" style="display:none;">
            <div class="section-title">Summary</div>
            <div class="summary-grid" id="summaryGrid"></div>
        </div>
        <div class="section" id="diffSection" style="display:none;">
            <div class="section-title">Differences</div>
            <div style="overflow-x:auto;">
                <table class="diff-table" id="diffTable"></table>
            </div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        function inferDataSchema(value) {
            if (value === null) return { type: 'null' };
            if (Array.isArray(value)) {
                var item = value.length ? inferDataSchema(value[0]) : { type: 'unknown' };
                for (var i = 1; i < value.length; i++) item = mergeDataSchemas(item, inferDataSchema(value[i]));
                return { type: 'array', items: item };
            }
            if (typeof value === 'object') {
                var keys = Object.keys(value);
                if (keys.length === 1 && Object.prototype.hasOwnProperty.call(value, '$date')) return { type: 'date' };
                var properties = {};
                keys.forEach(function(key) { properties[key] = inferDataSchema(value[key]); });
                return { type: 'object', properties: properties };
            }
            return { type: typeof value === 'number' ? 'number' : typeof value };
        }

        function mergeDataSchemas(left, right) {
            if (left.type === right.type) {
                if (left.type === 'object') {
                    var properties = {};
                    Object.keys(left.properties || {}).forEach(function(key) { properties[key] = left.properties[key]; });
                    Object.keys(right.properties || {}).forEach(function(key) { properties[key] = properties[key] ? mergeDataSchemas(properties[key], right.properties[key]) : right.properties[key]; });
                    return { type: 'object', properties: properties };
                }
                if (left.type === 'array') return { type: 'array', items: mergeDataSchemas(left.items || { type: 'unknown' }, right.items || { type: 'unknown' }) };
                return left;
            }
            if (left.type === 'null') return right;
            if (right.type === 'null') return left;
            return { type: 'mixed' };
        }

        function isFormalSchema(value) {
            return value && typeof value === 'object' && typeof value.type === 'string' &&
                (value.properties || value.items || value.$schema || Object.keys(value).every(function(key) {
                    return ['type', 'title', 'description', 'required', 'enum', 'default', 'additionalProperties'].indexOf(key) !== -1;
                }));
        }

        function flattenSchema(obj, prefix) {
            prefix = prefix || '';
            var result = {};
            var path = prefix || 'root';
            result[path] = obj.type || 'unknown';
            if (obj.type === 'object' && obj.properties) {
                Object.keys(obj.properties).forEach(function(key) {
                    var childPath = prefix ? prefix + '.' + key : key;
                    Object.assign(result, flattenSchema(obj.properties[key], childPath));
                });
            } else if (obj.type === 'array' && obj.items) {
                Object.assign(result, flattenSchema(obj.items, prefix ? prefix + '[]' : '[]'));
            }
            return result;
        }

        document.getElementById('compareBtn').addEventListener('click', function() {
            var inputA = document.getElementById('schemaA').value.trim();
            var inputB = document.getElementById('schemaB').value.trim();
            if (!inputA || !inputB) { _toast('Paste both schemas', 'error'); return; }

            var schemaA, schemaB;
            try { schemaA = JSON.parse(inputA); } catch (e) { _toast('Schema A: invalid JSON - ' + e.message, 'error'); return; }
            try { schemaB = JSON.parse(inputB); } catch (e) { _toast('Schema B: invalid JSON - ' + e.message, 'error'); return; }

            var normalizedA = isFormalSchema(schemaA) ? schemaA : inferDataSchema(schemaA);
            var normalizedB = isFormalSchema(schemaB) ? schemaB : inferDataSchema(schemaB);
            var flatA = flattenSchema(normalizedA);
            var flatB = flattenSchema(normalizedB);
            var allKeys = {};
            Object.keys(flatA).forEach(function(k) { allKeys[k] = true; });
            Object.keys(flatB).forEach(function(k) { allKeys[k] = true; });

            var onlyA = [], onlyB = [], changed = [], identical = [];
            Object.keys(allKeys).forEach(function(key) {
                var inA = flatA.hasOwnProperty(key);
                var inB = flatB.hasOwnProperty(key);
                if (inA && !inB) { onlyA.push({ field: key, typeA: flatA[key] }); }
                else if (!inA && inB) { onlyB.push({ field: key, typeB: flatB[key] }); }
                else if (flatA[key] !== flatB[key]) { changed.push({ field: key, typeA: flatA[key], typeB: flatB[key] }); }
                else { identical.push({ field: key, type: flatA[key] }); }
            });

            var summaryHtml = '<div class="summary-card"><div class="label">Only in A</div><div class="value" style="color:var(--error);">' + onlyA.length + '</div></div>' +
                '<div class="summary-card"><div class="label">Only in B</div><div class="value" style="color:var(--success);">' + onlyB.length + '</div></div>' +
                '<div class="summary-card"><div class="label">Type Changed</div><div class="value" style="color:var(--warning);">' + changed.length + '</div></div>' +
                '<div class="summary-card"><div class="label">Identical</div><div class="value" style="color:var(--fg-2);">' + identical.length + '</div></div>';
            document.getElementById('summaryGrid').innerHTML = summaryHtml;
            document.getElementById('summarySection').style.display = 'block';

            var tableHtml = '<thead><tr><th>Field</th><th>Status</th><th>Schema A</th><th>Schema B</th></tr></thead><tbody>';
            onlyA.forEach(function(item) {
                tableHtml += '<tr class="diff-only-a"><td style="font-weight:700;">' + item.field + '</td><td style="color:var(--error);">Only in A</td><td>' + item.typeA + '</td><td>-</td></tr>';
            });
            onlyB.forEach(function(item) {
                tableHtml += '<tr class="diff-only-b"><td style="font-weight:700;">' + item.field + '</td><td style="color:var(--success);">Only in B</td><td>-</td><td>' + item.typeB + '</td></tr>';
            });
            changed.forEach(function(item) {
                tableHtml += '<tr class="diff-changed"><td style="font-weight:700;">' + item.field + '</td><td style="color:var(--warning);">Type Changed</td><td>' + item.typeA + '</td><td>' + item.typeB + '</td></tr>';
            });
            identical.forEach(function(item) {
                tableHtml += '<tr class="diff-identical"><td>' + item.field + '</td><td>Identical</td><td>' + item.type + '</td><td>' + item.type + '</td></tr>';
            });
            tableHtml += '</tbody>';
            document.getElementById('diffTable').innerHTML = tableHtml;
            document.getElementById('diffSection').style.display = 'block';
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('schemaA').value = '';
            document.getElementById('schemaB').value = '';
            document.getElementById('summarySection').style.display = 'none';
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
        .result-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
        }
        .result-card {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 14px;
            text-align: center;
        }
        .result-card .label { font-size: 11px; color: var(--fg-1); text-transform: uppercase; }
        .result-card .value { font-size: 18px; font-weight: 700; font-family: var(--mono); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Data Partition Calculator</h1>
        <span class="subtitle">Calculate optimal partitions for Hadoop/Hive/Spark</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="section-title">Input Parameters</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div><label>Total Records</label><input type="number" id="totalRecords" value="100000000" min="1"></div>
                <div><label>Avg Record Size (bytes)</label><input type="number" id="recordSize" value="512" min="1"></div>
                <div><label>Target Partition Size (MB)</label><input type="number" id="partitionSize" value="128" min="1"></div>
                <div><label>Replication Factor</label><input type="number" id="replicationFactor" value="3" min="1"></div>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="calcBtn">Calculate</button>
                <button class="btn btn-ghost" id="copyBtn">Copy Config</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Results</div>
            <div class="result-grid" id="resultGrid"></div>
        </div>
        <div class="section" id="strategySection" style="display:none;">
            <div class="section-title">Partition Key Strategy</div>
            <div class="result-block" id="strategyText"></div>
        </div>
        <div class="section" id="pathSection" style="display:none;">
            <div class="section-title">Hadoop/Hive Partition Path Example</div>
            <div class="result-block" id="pathExample"></div>
        </div>
        <div class="section" id="sparkSection" style="display:none;">
            <div class="section-title">Spark Configuration</div>
            <div class="result-block" id="sparkConfig"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        var sparkConfigText = '';

        document.getElementById('calcBtn').addEventListener('click', function() {
            var totalRecords = parseInt(document.getElementById('totalRecords').value) || 100000000;
            var recordSize = parseInt(document.getElementById('recordSize').value) || 512;
            var partitionSizeMB = parseInt(document.getElementById('partitionSize').value) || 128;
            var replication = parseInt(document.getElementById('replicationFactor').value) || 3;

            var totalDataGB = (totalRecords * recordSize) / (1024 * 1024 * 1024);
            var partitionSizeBytes = partitionSizeMB * 1024 * 1024;
            var totalBytes = totalRecords * recordSize;
            var numPartitions = Math.ceil(totalBytes / partitionSizeBytes);
            var recordsPerPartition = Math.floor(totalRecords / numPartitions);
            var totalStorageGB = totalDataGB * replication;

            var resultHtml = '<div class="result-card"><div class="label">Total Data Size</div><div class="value">' + totalDataGB.toFixed(2) + ' GB</div></div>' +
                '<div class="result-card"><div class="label">Num Partitions</div><div class="value">' + numPartitions.toLocaleString() + '</div></div>' +
                '<div class="result-card"><div class="label">Records/Partition</div><div class="value">' + recordsPerPartition.toLocaleString() + '</div></div>' +
                '<div class="result-card"><div class="label">Total Storage (w/ repl.)</div><div class="value">' + totalStorageGB.toFixed(2) + ' GB</div></div>';
            document.getElementById('resultGrid').innerHTML = resultHtml;
            document.getElementById('resultSection').style.display = 'block';

            var strategy = '';
            if (numPartitions <= 100) {
                strategy = 'Small dataset: Consider partitioning by a low-cardinality column like date, region, or category.\\n' +
                    'Recommended: date-based partitioning (e.g., year=YYYY/month=MM/day=DD)\\n' +
                    'Alternative: hash partitioning on a high-cardinality key for even distribution.';
            } else if (numPartitions <= 1000) {
                strategy = 'Medium dataset: Partition by a moderate-cardinality column.\\n' +
                    'Recommended: date + category composite partitioning\\n' +
                    'Use bucketing on additional columns for efficient joins.';
            } else {
                strategy = 'Large dataset: Use date-based partitioning with bucketing for joins.\\n' +
                    'Partition by: year/month/day for time-series data\\n' +
                    'Bucket by: user_id, transaction_id, or other join keys\\n' +
                    'Consider dynamic partition pruning for query optimization.';
            }
            document.getElementById('strategyText').textContent = strategy;
            document.getElementById('strategySection').style.display = 'block';

            var path = '/data/events/year=2024/month=01/day=15/\\n' +
                '  part-00000.parquet\\n' +
                '  part-00001.parquet\\n' +
                '  ...\\n' +
                '\\nHive table definition:\\n' +
                'CREATE TABLE events (\\n' +
                '    event_id BIGINT,\\n' +
                '    user_id BIGINT,\\n' +
                '    event_type STRING,\\n' +
                '    payload STRING\\n' +
                ') PARTITIONED BY (\\n' +
                '    year INT,\\n' +
                '    month INT,\\n' +
                '    day INT\\n' +
                ') STORED AS PARQUET;';
            document.getElementById('pathExample').textContent = path;
            document.getElementById('pathSection').style.display = 'block';

            sparkConfigText = '// Spark SQL session config\\n' +
                'spark.sql.shuffle.partitions = ' + Math.min(numPartitions, 200) + '\\n' +
                'spark.sql.files.maxPartitionBytes = ' + (partitionSizeMB * 1024 * 1024) + '\\n' +
                'spark.sql.sources.partitionOverwriteMode = dynamic\\n' +
                'spark.sql.adaptive.enabled = true\\n' +
                'spark.sql.adaptive.coalescePartitions.enabled = true\\n' +
                'spark.sql.adaptive.skewJoin.enabled = true\\n\\n' +
                '// Repartition before write\\n' +
                'df.repartition(' + Math.min(numPartitions, 200) + ')\\n' +
                '  .write\\n' +
                '  .partitionBy("year", "month", "day")\\n' +
                '  .mode("overwrite")\\n' +
                '  .parquet("/data/events/")\\n\\n' +
                '// Or use bucketing for join-heavy workloads\\n' +
                'df.write\\n' +
                '  .partitionBy("year", "month")\\n' +
                '  .bucketBy(' + Math.min(32, numPartitions) + ', "user_id")\\n' +
                '  .sortBy("user_id")\\n' +
                '  .saveAsTable("events_bucketed")';
            document.getElementById('sparkConfig').textContent = sparkConfigText;
            document.getElementById('sparkSection').style.display = 'block';
        });

        document.getElementById('copyBtn').addEventListener('click', function() {
            if (!sparkConfigText) { _toast('Calculate first', 'error'); return; }
            navigator.clipboard.writeText(sparkConfigText).then(function() { _toast('Copied!', 'success'); }).catch(function() { _toast('Copy failed', 'error'); });
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('resultSection').style.display = 'none';
            document.getElementById('strategySection').style.display = 'none';
            document.getElementById('pathSection').style.display = 'none';
            document.getElementById('sparkSection').style.display = 'none';
            sparkConfigText = '';
        });
    </script>
</body>
</html>`;
}
