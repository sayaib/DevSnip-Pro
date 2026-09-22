import * as vscode from 'vscode';
import { registerTrackedCommand } from "../utils/command-registry";
import { openToolPanel } from "../utils/webview-ui";
import { TOOL_CSS, getNonce, toastScript } from "../utils/webview-ui";
import { executeQueuedCommand } from '../utils/command-dispatch';

/** Shared panel styling lives in utils/webview-ui so every tool page stays consistent. */
const SHARED_CSS = TOOL_CSS;


export function registerRagToolsCommands(context: vscode.ExtensionContext) {
    const hubCmd = registerTrackedCommand('sayaib.hue-console.ragHub', () => {
        const { panel, created } = openToolPanel('ragHub', 'DevSnip Pro - RAG & Vector Pipeline Tools', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getRagHubHtml(getNonce());
        // executeQueuedCommand validates the id against the commands this
        // extension registered, so a hub can only open DevSnip Pro tools.
        const messageSubscription = panel.webview.onDidReceiveMessage(message => {
            if (message?.command === 'openTool') {
                void executeQueuedCommand(message.toolCommand);
            }
        });
        panel.onDidDispose(() => messageSubscription.dispose());
    });

    const chunkingTesterCmd = registerTrackedCommand('sayaib.hue-console.chunkingTester', () => {
        const { panel, created } = openToolPanel('chunkingTester', 'Chunking Strategy Tester', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getChunkingTesterHtml(getNonce());
    });

    const embeddingCostCmd = registerTrackedCommand('sayaib.hue-console.embeddingCost', () => {
        const { panel, created } = openToolPanel('embeddingCost', 'Embedding & Vector DB Cost Calculator', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getEmbeddingCostHtml(getNonce());
    });

    const contextWindowCmd = registerTrackedCommand('sayaib.hue-console.contextWindow', () => {
        const { panel, created } = openToolPanel('contextWindow', 'RAG Context Window & Token Budget Calculator', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getContextWindowHtml(getNonce());
    });

    const semanticDedupCmd = registerTrackedCommand('sayaib.hue-console.semanticDedup', () => {
        const { panel, created } = openToolPanel('semanticDedup', 'Semantic Dedup & Quality Checker', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getSemanticDedupHtml(getNonce());
    });

    const ragEvalCmd = registerTrackedCommand('sayaib.hue-console.ragEvalScores', () => {
        const { panel, created } = openToolPanel('ragEvalScores', 'RAG Eval Calculator', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getRagEvalHtml(getNonce());
    });

    const hybridSearchRrfCmd = registerTrackedCommand('sayaib.hue-console.hybridSearchRrf', () => {
        const { panel, created } = openToolPanel('hybridSearchRrf', 'Hybrid Search & RRF Simulator', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getHybridSearchRrfHtml(getNonce());
    });

    const ragHallucinationAnalyzerCmd = registerTrackedCommand('sayaib.hue-console.ragHallucinationAnalyzer', () => {
        const { panel, created } = openToolPanel('ragHallucinationAnalyzer', 'RAG Hallucination & Attribution Analyzer', { enableScripts: true });
        if (!created) return;
        panel.webview.html = getRagHallucinationAnalyzerHtml(getNonce());
    });

    context.subscriptions.push(
        hubCmd, chunkingTesterCmd, embeddingCostCmd, contextWindowCmd, semanticDedupCmd, ragEvalCmd, hybridSearchRrfCmd, ragHallucinationAnalyzerCmd
    );
}

/* ================================================================
   HUB
   ================================================================ */
function getRagHubHtml(nonce: string): string {
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
        .hub-section { display: contents; }
        .hub-section-title { grid-column: 1 / -1; font-size: 12px; font-weight: 700; color: var(--fg-1); text-transform: uppercase; letter-spacing: .6px; margin: 10px 0 0 2px; }
        .hub-section .hub-grid { display: contents; }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>RAG & Vector Pipeline Developer Tools</h1>
        <span class="subtitle">7 built-in utilities for ingestion, retrieval & evaluation</span>
    </div>
    <div class="tool-body">
        <div class="hub-grid" id="grid"></div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}
        var tools = [
            { cmd: 'sayaib.hue-console.chunkingTester', icon: '\\u{2702}', title: 'Chunking Strategy Tester', desc: 'Test text splitting, token overlap, sentence boundaries, and markdown chunking.', tag: 'Ingestion' },
            { cmd: 'sayaib.hue-console.embeddingCost', icon: '\\u{1F4B0}', title: 'Embedding & Vector Cost Calculator', desc: 'Calculate API token costs for OpenAI, Cohere, and vector database RAM/storage.', tag: 'Infrastructure' },
            { cmd: 'sayaib.hue-console.contextWindow', icon: '\\u{1FA9F}', title: 'Context Window & Token Budget', desc: 'Budget token limits across system prompt, retrieved chunks, history, and max tokens.', tag: 'Retrieval' },
            { cmd: 'sayaib.hue-console.semanticDedup', icon: '\\u{1F504}', title: 'Semantic Dedup & Quality Checker', desc: 'Filter redundant passages, low-information snippets, and boilerplate text.', tag: 'Quality' },
            { cmd: 'sayaib.hue-console.ragEvalScores', icon: '\\u{1F4C8}', title: 'RAG Eval Calculator', desc: 'Compute faithfulness, answer relevance, context precision, and recall scores.', tag: 'Evaluation' },
            { cmd: 'sayaib.hue-console.hybridSearchRrf', icon: '\\u{1F50D}', title: 'Hybrid Search & RRF Simulator', desc: 'Combine BM25 keyword search and vector semantic search using Reciprocal Rank Fusion.', tag: 'Retrieval' },
            { cmd: 'sayaib.hue-console.ragHallucinationAnalyzer', icon: '\\u{1F6E1}', title: 'RAG Hallucination Analyzer', desc: 'Analyze query, retrieved context, and generated answer to estimate hallucination risk.', tag: 'Evaluation' }
        ];
        var grid = document.getElementById('grid');
        var groups = {};
        var order = ['Ingestion & Quality', 'Retrieval & Infrastructure', 'Evaluation & Guardrails'];
        tools.forEach(function(t) {
            var section = t.tag === 'Ingestion' || t.tag === 'Quality' ? 'Ingestion & Quality' : (t.tag === 'Retrieval' || t.tag === 'Infrastructure' ? 'Retrieval & Infrastructure' : 'Evaluation & Guardrails');
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
   1. CHUNKING STRATEGY TESTER
   ================================================================ */
function getChunkingTesterHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chunking Strategy Tester</title>
    <style>
        ${SHARED_CSS}
        .chunk-box {
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 12px;
            margin-bottom: 10px;
            font-family: var(--mono);
            font-size: 12px;
            white-space: pre-wrap;
            position: relative;
        }
        .chunk-meta {
            font-size: 11px;
            color: var(--fg-1);
            margin-bottom: 6px;
            font-family: var(--sans);
            display: flex;
            justify-content: space-between;
        }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Chunking Strategy Tester</h1>
        <span class="subtitle">Test text chunking and overlap configurations for RAG ingestion</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Sample Document Text</label>
            <textarea id="docInput" rows="6" placeholder="Enter long text to test chunking splits..."></textarea>
            <div class="panels" style="margin-top: 14px;">
                <div>
                    <label>Chunk Size (Characters)</label>
                    <input type="number" id="chunkSize" value="300" min="50" />
                </div>
                <div>
                    <label>Chunk Overlap (Characters)</label>
                    <input type="number" id="chunkOverlap" value="50" min="0" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="splitBtn">Generate Chunks</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="outputSection" style="display:none;">
            <div class="section-title" id="outputTitle">Generated Chunks</div>
            <div id="chunksList"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('splitBtn').addEventListener('click', function() {
            var text = document.getElementById('docInput').value.trim();
            if (!text) { _toast('Please enter sample text', 'error'); return; }
            var size = parseInt(document.getElementById('chunkSize').value) || 300;
            var overlap = parseInt(document.getElementById('chunkOverlap').value) || 50;

            if (overlap >= size) { _toast('Overlap must be less than chunk size', 'error'); return; }

            var chunks = [];
            var start = 0;
            while (start < text.length) {
                var end = Math.min(start + size, text.length);
                chunks.push(text.substring(start, end));
                if (end === text.length) break;
                start += (size - overlap);
            }

            var listDiv = document.getElementById('chunksList');
            listDiv.innerHTML = '';
            document.getElementById('outputTitle').textContent = 'Generated Chunks (' + chunks.length + ' total)';

            chunks.forEach(function(c, i) {
                var box = document.createElement('div');
                box.className = 'chunk-box';
                box.innerHTML = '<div class="chunk-meta"><span>Chunk #' + (i + 1) + '</span><span>Length: ' + c.length + ' chars</span></div>' + escapeHtml(c);
                listDiv.appendChild(box);
            });

            document.getElementById('outputSection').style.display = 'block';
            _toast('Generated ' + chunks.length + ' chunks!', 'success');
        });

        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('docInput').value = '';
            document.getElementById('outputSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   2. EMBEDDING & VECTOR DB COST CALCULATOR
   ================================================================ */
function getEmbeddingCostHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Embedding & Vector Cost Calculator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Embedding & Vector Cost Calculator</h1>
        <span class="subtitle">Calculate API costs for embedding generation and vector DB storage</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>Total Documents / Chunks</label>
                    <input type="number" id="docCount" value="100000" min="100" />
                </div>
                <div>
                    <label>Average Tokens Per Chunk</label>
                    <input type="number" id="tokensPerDoc" value="250" min="10" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Embedding Model</label>
                    <select id="modelSelect">
                        <option value="0.0001">OpenAI text-embedding-3-small ($0.02 / 1M tokens)</option>
                        <option value="0.0013">OpenAI text-embedding-3-large ($0.13 / 1M tokens)</option>
                        <option value="0.0001">Cohere Embed v3 ($0.10 / 1M tokens)</option>
                    </select>
                </div>
                <div>
                    <label>Vector Dimension</label>
                    <input type="number" id="dimSelect" value="1536" min="384" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="calcBtn">Calculate Embedding & Storage Costs</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Cost Estimation Report</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('calcBtn').addEventListener('click', function() {
            var docs = parseFloat(document.getElementById('docCount').value) || 100000;
            var tokens = parseFloat(document.getElementById('tokensPerDoc').value) || 250;
            var costPerThousand = parseFloat(document.getElementById('modelSelect').value) || 0.0001;
            var dim = parseInt(document.getElementById('dimSelect').value) || 1536;

            var totalTokens = docs * tokens;
            var apiCost = (totalTokens / 1000.0) * costPerThousand;

            // Vector DB Storage estimation (float32 = 4 bytes per dimension)
            var bytesPerVector = dim * 4;
            var totalVectorBytes = docs * bytesPerVector;
            var totalVectorMB = totalVectorBytes / (1024 * 1024);

            var report = 'RAG INFRASTRUCTURE & EMBEDDING COST ESTIMATE\\n' + '='.repeat(45) + '\\n';
            report += 'Total Documents: ' + docs.toLocaleString() + '\\n';
            report += 'Total Tokens: ' + totalTokens.toLocaleString() + '\\n';
            report += 'One-time Embedding API Cost: $' + apiCost.toFixed(2) + '\\n\\n';
            report += 'Vector Storage Footprint:\\n';
            report += '  - Dimension: ' + dim + ' (Float32)\\n';
            report += '  - Raw Vector Size: ' + totalVectorMB.toFixed(2) + ' MB (excluding metadata/indexes)\\n';
            report += '  - Recommended Vector DB RAM: ~' + (totalVectorMB * 1.5).toFixed(2) + ' MB with HNSW index\\n';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Cost calculation complete!', 'success');
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   3. RAG CONTEXT WINDOW & TOKEN BUDGET CALCULATOR
   ================================================================ */
function getContextWindowHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RAG Context Window Calculator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>RAG Context Window & Token Budget</h1>
        <span class="subtitle">Budget token allocations across prompt, retrieved context, and output</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>LLM Total Context Window</label>
                    <select id="totalContext">
                        <option value="8192">GPT-4o / Claude 3 (8,192 tokens)</option>
                        <option value="128000" selected>GPT-4o / Claude 3.5 Sonnet (128,000 tokens)</option>
                        <option value="200000">Claude 3 Opus (200,000 tokens)</option>
                    </select>
                </div>
                <div>
                    <label>System Prompt Tokens</label>
                    <input type="number" id="systemTokens" value="500" min="50" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>User Query Tokens</label>
                    <input type="number" id="queryTokens" value="100" min="10" />
                </div>
                <div>
                    <label>Max Reserved Output Tokens</label>
                    <input type="number" id="outputTokens" value="1024" min="100" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>Average Tokens Per Retrieved Chunk</label>
                    <input type="number" id="chunkTokens" value="250" min="50" />
                </div>
                <div>
                    <label>Number of Retrieved Chunks (Top-K)</label>
                    <input type="number" id="topK" value="5" min="1" max="50" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="calcBtn">Analyze Token Budget</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Token Budget Analysis</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('calcBtn').addEventListener('click', function() {
            var total = parseInt(document.getElementById('totalContext').value) || 128000;
            var sys = parseInt(document.getElementById('systemTokens').value) || 500;
            var q = parseInt(document.getElementById('queryTokens').value) || 100;
            var out = parseInt(document.getElementById('outputTokens').value) || 1024;
            var cTokens = parseInt(document.getElementById('chunkTokens').value) || 250;
            var k = parseInt(document.getElementById('topK').value) || 5;

            var contextTotal = cTokens * k;
            var used = sys + q + out + contextTotal;
            var remaining = total - used;
            var isOver = remaining < 0;

            var report = 'RAG CONTEXT WINDOW BUDGET\\n' + '='.repeat(35) + '\\n';
            report += 'Total Capacity: ' + total.toLocaleString() + ' tokens\\n\\n';
            report += 'Allocation Breakdown:\\n';
            report += '  - System Prompt: ' + sys + ' tokens\\n';
            report += '  - User Query: ' + q + ' tokens\\n';
            report += '  - Retrieved Chunks (Top-' + k + '): ' + contextTotal + ' tokens (' + cTokens + ' x ' + k + ')\\n';
            report += '  - Reserved Output: ' + out + ' tokens\\n\\n';
            report += 'Summary:\\n';
            report += '  - Total Used: ' + used.toLocaleString() + ' tokens (' + ((used / total) * 100).toFixed(1) + '%)\\n';
            report += '  - Remaining Budget: ' + remaining.toLocaleString() + ' tokens\\n';
            report += isOver ? '\\n[WARNING] Context window exceeded by ' + Math.abs(remaining) + ' tokens!' : '\\n[OK] Fits comfortably within context window.';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Token budget calculated!', 'success');
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   4. SEMANTIC DEDUP & QUALITY CHECKER
   ================================================================ */
function getSemanticDedupHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Semantic Dedup Checker</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Semantic Dedup & Quality Checker</h1>
        <span class="subtitle">Identify redundant passages and boilerplate text in retrieved chunks</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Paste Retrieved Chunks (one per line or JSON array)</label>
            <textarea id="chunksInput" rows="8" placeholder="Enter text passages separated by blank lines..."></textarea>
            <div class="btn-row" style="margin-top: 12px;">
                <button class="btn" id="checkBtn">Run Dedup Check</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="reportSection" style="display:none;">
            <div class="section-title">Dedup Analysis Report</div>
            <div class="result-block" id="reportOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('checkBtn').addEventListener('click', function() {
            var raw = document.getElementById('chunksInput').value.trim();
            if (!raw) { _toast('Please enter text passages', 'error'); return; }
            var passages = raw.split(/\\n\\s*\\n/).map(function(p) { return p.trim(); }).filter(Boolean);
            if (passages.length === 0) { _toast('No valid passages found', 'error'); return; }

            var unique = [];
            var duplicates = 0;
            passages.forEach(function(p) {
                var exists = unique.some(function(u) {
                    // Simple Jaccard word overlap simulation
                    var wordsU = u.toLowerCase().split(/\\s+/);
                    var wordsP = p.toLowerCase().split(/\\s+/);
                    var intersection = wordsU.filter(function(w) { return wordsP.indexOf(w) !== -1; });
                    var union = Array.from(new Set(wordsU.concat(wordsP)));
                    var jaccard = intersection.length / union.length;
                    return jaccard > 0.75;
                });
                if (exists) duplicates++;
                else unique.push(p);
            });

            var report = 'SEMANTIC DEDUP & QUALITY REPORT\\n' + '='.repeat(35) + '\\n';
            report += 'Total Passages Analyzed: ' + passages.length + '\\n';
            report += 'Unique Passages Retained: ' + unique.length + '\\n';
            report += 'Redundant / Duplicate Passages Filtered: ' + duplicates + '\\n\\n';
            report += 'Deduplication Efficiency: ' + ((duplicates / passages.length) * 100).toFixed(1) + '% reduction\\n';

            document.getElementById('reportOutput').textContent = report;
            document.getElementById('reportSection').style.display = 'block';
            _toast('Dedup check completed!', 'success');
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('chunksInput').value = '';
            document.getElementById('reportSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   5. RAG EVAL CALCULATOR
   ================================================================ */
function getRagEvalHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RAG Eval Calculator</title>
    <style>
        ${SHARED_CSS}
        .slider-row { display: grid; grid-template-columns: 180px 1fr 60px; gap: 12px; align-items: center; margin-bottom: 12px; }
        .score-display { font-size: 28px; font-weight: 800; font-family: var(--mono); color: var(--accent); }
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>RAG Eval Calculator</h1>
        <span class="subtitle">Compute faithfulness, answer relevance, and context precision</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="slider-row">
                <label>Faithfulness</label>
                <input type="range" id="faith" min="0" max="1" step="0.05" value="0.9" />
                <span id="faithVal" style="font-family:var(--mono);">0.90</span>
            </div>
            <div class="slider-row">
                <label>Answer Relevance</label>
                <input type="range" id="relev" min="0" max="1" step="0.05" value="0.85" />
                <span id="relevVal" style="font-family:var(--mono);">0.85</span>
            </div>
            <div class="slider-row">
                <label>Context Precision</label>
                <input type="range" id="prec" min="0" max="1" step="0.05" value="0.80" />
                <span id="precVal" style="font-family:var(--mono);">0.80</span>
            </div>
            <div class="slider-row">
                <label>Context Recall</label>
                <input type="range" id="rec" min="0" max="1" step="0.05" value="0.95" />
                <span id="recVal" style="font-family:var(--mono);">0.95</span>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="evalBtn">Compute Overall RAG Score</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Evaluation Summary</div>
            <div class="score-display" id="overallScore">0.00</div>
            <div class="result-block" id="resultOutput" style="margin-top: 10px;"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        ['faith', 'relev', 'prec', 'rec'].forEach(function(id) {
            var slider = document.getElementById(id);
            slider.addEventListener('input', function() {
                document.getElementById(id + 'Val').textContent = parseFloat(slider.value).toFixed(2);
            });
        });

        document.getElementById('evalBtn').addEventListener('click', function() {
            var f = parseFloat(document.getElementById('faith').value);
            var r = parseFloat(document.getElementById('relev').value);
            var p = parseFloat(document.getElementById('prec').value);
            var rc = parseFloat(document.getElementById('rec').value);

            var overall = (f * 0.3) + (r * 0.3) + (p * 0.2) + (rc * 0.2);

            document.getElementById('overallScore').textContent = overall.toFixed(2);

            var report = 'RAG TRIAD EVALUATION REPORT\\n' + '='.repeat(30) + '\\n';
            report += 'Faithfulness: ' + f.toFixed(2) + ' (' + (f >= 0.8 ? 'Good' : 'Needs tuning') + ')\\n';
            report += 'Answer Relevance: ' + r.toFixed(2) + ' (' + (r >= 0.8 ? 'Good' : 'Needs tuning') + ')\\n';
            report += 'Context Precision: ' + p.toFixed(2) + ' (' + (p >= 0.8 ? 'Good' : 'Needs tuning') + ')\\n';
            report += 'Context Recall: ' + rc.toFixed(2) + ' (' + (rc >= 0.8 ? 'Good' : 'Needs tuning') + ')\\n\\n';
            report += 'Overall RAG Composite Score: ' + overall.toFixed(2) + ' / 1.00';

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('Evaluation computed!', 'success');
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   6. HYBRID SEARCH & RRF SIMULATOR
   ================================================================ */
function getHybridSearchRrfHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hybrid Search & RRF Simulator</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>Hybrid Search & RRF Simulator</h1>
        <span class="subtitle">Simulate Reciprocal Rank Fusion combining BM25 and Vector Search</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <div class="panels">
                <div>
                    <label>BM25 Keyword Results (comma-separated doc IDs)</label>
                    <input type="text" id="bm25List" value="doc_3, doc_1, doc_5, doc_2, doc_4" />
                </div>
                <div>
                    <label>Vector Semantic Results (comma-separated doc IDs)</label>
                    <input type="text" id="vectorList" value="doc_1, doc_2, doc_3, doc_6, doc_7" />
                </div>
            </div>
            <div style="margin-top: 14px;" class="panels">
                <div>
                    <label>RRF Constant k (typically 60)</label>
                    <input type="number" id="rrfK" value="60" min="1" />
                </div>
                <div>
                    <label>Top-K Output Limit</label>
                    <input type="number" id="topK" value="5" min="1" max="20" />
                </div>
            </div>
            <div class="btn-row" style="margin-top: 16px;">
                <button class="btn" id="simBtn">Run RRF Fusion</button>
            </div>
        </div>
        <div class="section" id="resultSection" style="display:none;">
            <div class="section-title">Re-ranked Hybrid Results</div>
            <div class="result-block" id="resultOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('simBtn').addEventListener('click', function() {
            var bm25 = document.getElementById('bm25List').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            var vec = document.getElementById('vectorList').value.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
            var k = parseFloat(document.getElementById('rrfK').value) || 60;
            var limit = parseInt(document.getElementById('topK').value) || 5;

            var scores = {};

            bm25.forEach(function(doc, idx) {
                var rank = idx + 1;
                scores[doc] = (scores[doc] || 0) + (1.0 / (k + rank));
            });

            vec.forEach(function(doc, idx) {
                var rank = idx + 1;
                scores[doc] = (scores[doc] || 0) + (1.0 / (k + rank));
            });

            var sortedDocs = Object.keys(scores).sort(function(a, b) {
                return scores[b] - scores[a];
            }).slice(0, limit);

            var report = 'RECIPROCAL RANK FUSION (RRF) RESULTS\\n' + '='.repeat(40) + '\\n';
            report += 'RRF Constant k = ' + k + '\\n\\n';
            sortedDocs.forEach(function(doc, idx) {
                report += 'Rank #' + (idx + 1) + ': ' + doc + ' (RRF Score: ' + scores[doc].toFixed(4) + ')\\n';
            });

            document.getElementById('resultOutput').textContent = report;
            document.getElementById('resultSection').style.display = 'block';
            _toast('RRF fusion computed!', 'success');
        });
    </script>
</body>
</html>`;
}

/* ================================================================
   7. RAG HALLUCINATION & ATTRIBUTION ANALYZER
   ================================================================ */
function getRagHallucinationAnalyzerHtml(nonce: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RAG Hallucination Analyzer</title>
    <style>
        ${SHARED_CSS}
    </style>
</head>
<body>
    <div class="tool-header">
        <h1>RAG Hallucination Analyzer</h1>
        <span class="subtitle">Analyze source attribution and hallucination risk in LLM answers</span>
    </div>
    <div class="tool-body">
        <div class="section">
            <label>Retrieved Context Passages</label>
            <textarea id="contextInput" rows="5" placeholder="Paste retrieved chunks/documents here..."></textarea>
            <div style="margin-top: 14px;">
                <label>Generated LLM Answer</label>
                <textarea id="answerInput" rows="5" placeholder="Paste generated answer here..."></textarea>
            </div>
            <div class="btn-row" style="margin-top: 14px;">
                <button class="btn" id="analyzeBtn">Analyze Attribution & Risk</button>
                <button class="btn btn-ghost" id="clearBtn">Clear</button>
            </div>
        </div>
        <div class="section" id="reportSection" style="display:none;">
            <div class="section-title">Attribution & Hallucination Report</div>
            <div class="result-block" id="reportOutput"></div>
        </div>
    </div>
    <script nonce="${nonce}">
        ${toastScript()}

        document.getElementById('analyzeBtn').addEventListener('click', function() {
            var context = document.getElementById('contextInput').value.trim();
            var answer = document.getElementById('answerInput').value.trim();
            if (!context || !answer) { _toast('Provide both context and answer', 'error'); return; }

            var contextWords = new Set(context.toLowerCase().match(/\\b[a-z]{3,}\\b/g) || []);
            var answerWords = answer.toLowerCase().match(/\\b[a-z]{3,}\\b/g) || [];

            if (answerWords.length === 0) { _toast('Answer has no valid words', 'error'); return; }

            var matched = 0;
            answerWords.forEach(function(w) {
                if (contextWords.has(w)) matched++;
            });

            var overlapRatio = matched / answerWords.length;
            var riskLevel = overlapRatio > 0.6 ? 'Low (Well Supported)' : (overlapRatio > 0.3 ? 'Medium (Partial Support)' : 'High (Potential Hallucination)');

            var report = 'RAG HALLUCINATION & ATTRIBUTION REPORT\\n' + '='.repeat(45) + '\\n';
            report += 'Vocabulary Overlap Ratio: ' + (overlapRatio * 100).toFixed(1) + '%\\n';
            report += 'Estimated Risk Level: ' + riskLevel + '\\n\\n';
            report += 'Recommendations:\\n';
            if (overlapRatio < 0.4) {
                report += '  - The generated answer contains many terms not found in the retrieved context.\\n';
                report += '  - Consider strengthening system prompt instructions to strictly adhere to context.\\n';
            } else {
                report += '  - Answer shows strong lexical grounding in the provided context passages.\\n';
            }

            document.getElementById('reportOutput').textContent = report;
            document.getElementById('reportSection').style.display = 'block';
            _toast('Hallucination analysis complete!', 'success');
        });

        document.getElementById('clearBtn').addEventListener('click', function() {
            document.getElementById('contextInput').value = '';
            document.getElementById('answerInput').value = '';
            document.getElementById('reportSection').style.display = 'none';
        });
    </script>
</body>
</html>`;
}
