"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODE_DIFF_CSS = exports.renderCodeDiffPage = exports.DIFF_EXAMPLES = exports.sanitizePrefs = exports.DEFAULT_PREFS = void 0;
const webview_ui_1 = require("../utils/webview-ui");
exports.DEFAULT_PREFS = {
    mode: "code", view: "split", wrap: false, ignoreWhitespace: false, ignoreCase: false,
    collapse: true, context: 3, syntax: true, tabSize: 4, ignoreArrayOrder: false, arrayKey: ""
};
/** Stored preferences come from the page, so every field is checked. */
function sanitizePrefs(value) {
    const v = (value && typeof value === "object" ? value : {});
    const bool = (key) => typeof v[key] === "boolean" ? v[key] : exports.DEFAULT_PREFS[key];
    return {
        mode: v.mode === "json" ? "json" : "code",
        view: v.view === "unified" ? "unified" : "split",
        wrap: bool("wrap"),
        ignoreWhitespace: bool("ignoreWhitespace"),
        ignoreCase: bool("ignoreCase"),
        collapse: bool("collapse"),
        context: [0, 1, 3, 5, 10, 25].includes(Number(v.context)) ? Number(v.context) : exports.DEFAULT_PREFS.context,
        syntax: bool("syntax"),
        tabSize: [2, 4, 8].includes(Number(v.tabSize)) ? Number(v.tabSize) : exports.DEFAULT_PREFS.tabSize,
        ignoreArrayOrder: bool("ignoreArrayOrder"),
        arrayKey: typeof v.arrayKey === "string" ? v.arrayKey.slice(0, 100) : ""
    };
}
exports.sanitizePrefs = sanitizePrefs;
exports.DIFF_EXAMPLES = [
    {
        label: "JavaScript: refactor a function", mode: "code",
        left: { name: "cart.js", text: "// Shopping cart totals\nconst TAX_RATE = 0.2;\n\nfunction total(items) {\n  let sum = 0;\n  for (let i = 0; i < items.length; i++) {\n    sum += items[i].price * items[i].qty;\n  }\n  return sum + sum * TAX_RATE;\n}\n\nfunction format(amount) {\n  return \"$\" + amount.toFixed(2);\n}\n\nmodule.exports = { total, format };\n" },
        right: { name: "cart.js", text: "// Shopping cart totals\nconst TAX_RATE = 0.21;\n\nfunction subtotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n\nfunction total(items, { discount = 0 } = {}) {\n  const sum = subtotal(items) - discount;\n  return sum + sum * TAX_RATE;\n}\n\nfunction format(amount, currency = \"USD\") {\n  return new Intl.NumberFormat(\"en-US\", { style: \"currency\", currency }).format(amount);\n}\n\nmodule.exports = { subtotal, total, format };\n" }
    },
    {
        label: "Python: fix a bug and add typing", mode: "code",
        left: { name: "users.py", text: "import json\n\n\ndef load_users(path):\n    with open(path) as f:\n        data = json.load(f)\n    users = []\n    for item in data:\n        if item[\"active\"] == True:\n            users.append(item[\"name\"])\n    return users\n\n\nif __name__ == \"__main__\":\n    print(load_users(\"users.json\"))\n" },
        right: { name: "users.py", text: "import json\nfrom pathlib import Path\n\n\ndef load_users(path: Path) -> list[str]:\n    \"\"\"Names of the active users in a JSON file.\"\"\"\n    data = json.loads(Path(path).read_text(encoding=\"utf-8\"))\n    return [item[\"name\"] for item in data if item.get(\"active\")]\n\n\nif __name__ == \"__main__\":\n    print(load_users(Path(\"users.json\")))\n" }
    },
    {
        label: "Config: two .env versions", mode: "code",
        left: { name: ".env", text: "PORT=3000\nLOG_LEVEL=info\nCACHE_TTL=60\nFEATURE_X=false" },
        right: { name: ".env", text: "PORT=3000\nLOG_LEVEL=debug\nCACHE_TTL=60\nFEATURE_X=true\nFEATURE_Y=true" }
    },
    {
        label: "JSON: API response, compared by structure", mode: "json",
        left: { name: "before.json", text: "{\n  \"id\": 7,\n  \"name\": \"Ada\",\n  \"roles\": [\"admin\"],\n  \"plan\": { \"tier\": \"pro\", \"seats\": 5 }\n}\n" },
        right: { name: "after.json", text: "{\n  \"id\": 7,\n  \"name\": \"Ada L.\",\n  \"roles\": [\"admin\", \"billing\"],\n  \"plan\": { \"tier\": \"pro\", \"seats\": \"5\" },\n  \"active\": true\n}\n" }
    }
];
function renderCodeDiffPage(o) {
    const nonce = (0, webview_ui_1.getNonce)();
    const mac = o.platform === "darwin";
    const data = { prefs: o.prefs, initial: o.initial, examples: exports.DIFF_EXAMPLES, mac, canSave: o.canSave };
    const side = (id, title, placeholder) => `
    <div class="pane" data-side="${id}">
      <div class="pane-head">
        <span class="side-tag ${id === "left" ? "del" : "add"}" aria-hidden="true">${id === "left" ? "−" : "+"}</span>
        <input class="name" id="${id}Name" type="text" spellcheck="false" autocomplete="off" placeholder="${title}" aria-label="${title} file name (used in the patch and to pick the language)">
        <span class="meta" id="${id}Meta" aria-live="off"></span>
        <div class="pane-tools" role="toolbar" aria-label="${title} actions">
          <button type="button" class="icon-btn" data-act="upload" data-side="${id}" title="Open a file" aria-label="Open a file as the ${title.toLowerCase()}"><span class="codicon codicon-folder-opened" aria-hidden="true"></span></button>
          <button type="button" class="icon-btn" data-act="editor" data-side="${id}" title="Use the active editor (or its selection)" aria-label="Use the active editor as the ${title.toLowerCase()}"><span class="codicon codicon-go-to-file" aria-hidden="true"></span></button>
          <button type="button" class="icon-btn" data-act="paste" data-side="${id}" title="Paste from the clipboard" aria-label="Paste the clipboard as the ${title.toLowerCase()}"><span class="codicon codicon-clippy" aria-hidden="true"></span></button>
          <button type="button" class="icon-btn" data-act="copy" data-side="${id}" title="Copy" aria-label="Copy the ${title.toLowerCase()}"><span class="codicon codicon-copy" aria-hidden="true"></span></button>
          <button type="button" class="icon-btn" data-act="clear" data-side="${id}" title="Clear" aria-label="Clear the ${title.toLowerCase()}"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
        </div>
      </div>
      <div class="editor" id="${id}Editor">
        <div class="gutter" aria-hidden="true"><div class="gutter-inner" id="${id}Gutter"></div></div>
        <textarea id="${id}Text" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" placeholder="${placeholder}" aria-label="${title} text"></textarea>
        <div class="drop-hint" aria-hidden="true"><span class="codicon codicon-cloud-upload"></span> Drop to load</div>
      </div>
    </div>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${o.cspSource}; style-src ${o.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; worker-src blob:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Code Diff Checker</title>
<link rel="stylesheet" href="${(0, webview_ui_1.escapeHtml)(o.codiconsUri)}">
<style nonce="${nonce}">${exports.CODE_DIFF_CSS}</style>
</head>
<body>
<main class="app" id="app">
  <header class="top">
    <div class="brand">
      <span class="brand-icon codicon codicon-diff" aria-hidden="true"></span>
      <div>
        <h1>Code Diff Checker</h1>
        <p>Compare two versions of code or text, line by line and word by word.</p>
      </div>
    </div>
    <div class="top-actions">
      <div class="seg" role="radiogroup" aria-label="Compare as" id="modeSeg">
        <button type="button" role="radio" data-mode="code"><span class="codicon codicon-code" aria-hidden="true"></span> Code &amp; text</button>
        <button type="button" role="radio" data-mode="json"><span class="codicon codicon-json" aria-hidden="true"></span> JSON structure</button>
      </div>
      <select id="exampleSel" aria-label="Load an example">
        <option value="">Load an example…</option>
      </select>
      <button type="button" class="icon-btn" id="helpBtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><span class="codicon codicon-keyboard" aria-hidden="true"></span></button>
    </div>
  </header>

  <section class="inputs" id="inputs" aria-label="Inputs">
    ${side("left", "Original", "Paste the original version, drop a file here, or open one…")}
    <div class="swap-col">
      <button type="button" class="icon-btn swap" id="swapBtn" title="Swap original and modified" aria-label="Swap original and modified"><span class="codicon codicon-arrow-swap" aria-hidden="true"></span></button>
    </div>
    ${side("right", "Modified", "Paste the modified version, drop a file here, or open one…")}
  </section>
  <div class="inputs-collapsed" id="inputsCollapsed" hidden>
    <span class="codicon codicon-files" aria-hidden="true"></span>
    <span id="collapsedNames"></span>
    <button type="button" class="btn ghost sm" id="showInputs"><span class="codicon codicon-edit" aria-hidden="true"></span> Edit inputs</button>
  </div>

  <section class="results" id="results" aria-label="Comparison">
    <div class="res-head">
      <div class="summary" id="summary"></div>
      <div class="nav code-only" id="navGroup">
        <button type="button" class="btn ghost sm" id="prevBtn" title="Previous change (Alt+↑ or P)" aria-label="Previous change"><span class="codicon codicon-arrow-up" aria-hidden="true"></span></button>
        <span class="nav-pos" id="navPos">–</span>
        <button type="button" class="btn ghost sm" id="nextBtn" title="Next change (Alt+↓ or N)" aria-label="Next change"><span class="codicon codicon-arrow-down" aria-hidden="true"></span></button>
      </div>
    </div>
    <div class="toolbar" role="toolbar" aria-label="Comparison options">
      <div class="tb code-only">
        <div class="seg" role="radiogroup" aria-label="Layout" id="viewSeg">
          <button type="button" role="radio" data-view="split" title="Side by side (V)"><span class="codicon codicon-split-horizontal" aria-hidden="true"></span> Split</button>
          <button type="button" role="radio" data-view="unified" title="Unified (V)"><span class="codicon codicon-list-flat" aria-hidden="true"></span> Unified</button>
        </div>
      </div>
      <div class="tb code-only">
        <button type="button" class="chip" id="optWs" aria-pressed="false" title="Treat lines that differ only in spaces, tabs or indentation as equal"><span class="codicon codicon-whitespace" aria-hidden="true"></span> Ignore whitespace</button>
        <button type="button" class="chip" id="optCase" aria-pressed="false" title="Treat upper and lower case as equal"><span class="codicon codicon-case-sensitive" aria-hidden="true"></span> Ignore case</button>
        <button type="button" class="chip" id="optWrap" aria-pressed="false" title="Wrap long lines (W)"><span class="codicon codicon-word-wrap" aria-hidden="true"></span> Wrap</button>
        <button type="button" class="chip" id="optCollapse" aria-pressed="false" title="Hide unchanged lines away from changes (C)"><span class="codicon codicon-fold" aria-hidden="true"></span> Collapse unchanged</button>
      </div>
      <div class="tb json-only">
        <button type="button" class="chip" id="optArrayOrder" aria-pressed="false" title="Compare arrays as sets"><span class="codicon codicon-list-unordered" aria-hidden="true"></span> Ignore array order</button>
        <label class="inline-field">Match array items by key <input type="text" id="arrayKey" placeholder="id" spellcheck="false" autocomplete="off"></label>
      </div>
      <div class="tb code-only">
        <label class="inline-field"><span class="codicon codicon-symbol-color" aria-hidden="true"></span><span class="sr-only">Language</span><select id="langSel" aria-label="Syntax highlighting language"></select></label>
        <details class="menu" id="moreMenu">
          <summary class="btn ghost sm" title="More view options" aria-label="More view options"><span class="codicon codicon-settings" aria-hidden="true"></span></summary>
          <div class="menu-body">
            <label>Context lines <select id="contextSel"><option value="0">0</option><option value="1">1</option><option value="3">3</option><option value="5">5</option><option value="10">10</option><option value="25">25</option></select></label>
            <label>Tab size <select id="tabSel"><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label>
            <label class="check"><input type="checkbox" id="optSyntax"> Syntax highlighting</label>
          </div>
        </details>
      </div>
      <div class="tb actions">
        <button type="button" class="btn ghost sm" id="copyDiff" title="Copy the result"><span class="codicon codicon-copy" aria-hidden="true"></span> Copy</button>
        <button type="button" class="btn ghost sm" id="saveDiff" title="Download the result"><span class="codicon codicon-desktop-download" aria-hidden="true"></span> Download</button>
        <button type="button" class="btn ghost sm code-only" id="openPatch" title="Open the unified diff in an editor"><span class="codicon codicon-go-to-file" aria-hidden="true"></span> Open patch</button>
        <button type="button" class="btn ghost sm" id="toggleInputs" title="Hide or show the inputs (I)" aria-pressed="false"><span class="codicon codicon-chevron-up" aria-hidden="true"></span> <span class="lbl">Hide inputs</span></button>
      </div>
    </div>
    <div class="notices" id="notices"></div>
    <div class="viewer-wrap" id="viewerWrap">
      <div class="progress" id="progress" hidden><span></span></div>
      <div class="viewer" id="viewer" tabindex="0" role="region" aria-label="Differences. Use N and P to move between changes.">
        <div class="canvas" id="canvas"></div>
      </div>
      <div class="hbar" id="hbar" aria-hidden="true"><div id="hbarInner"></div></div>
      <div class="json-view" id="jsonView" hidden tabindex="0" role="region" aria-label="Structural differences"></div>
      <div class="empty" id="empty" hidden></div>
    </div>
  </section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<div class="sr-only" id="live" aria-live="polite"></div>
<dialog id="helpDialog" aria-labelledby="helpTitle">
  <h2 id="helpTitle">Keyboard shortcuts</h2>
  <dl class="keys" id="helpKeys"></dl>
  <form method="dialog"><button type="submit" class="btn primary sm">Close</button></form>
</dialog>
<script nonce="${nonce}">window.__CODE_DIFF__ = ${(0, webview_ui_1.embedJson)(data)};</script>
<script nonce="${nonce}" src="${(0, webview_ui_1.escapeHtml)(o.engineUri)}"></script>
<script nonce="${nonce}" src="${(0, webview_ui_1.escapeHtml)(o.scriptUri)}"></script>
</body>
</html>`;
}
exports.renderCodeDiffPage = renderCodeDiffPage;
exports.CODE_DIFF_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--ds-bg); color: var(--ds-fg); font-family: var(--ds-font-sans); font-size: var(--ds-text-md, 13px);
  line-height: 1.5; -webkit-font-smoothing: antialiased;
  --mono: var(--ds-font-mono);
  --code-size: var(--vscode-editor-font-size, 12.5px);
  --rh: 20px;
  --syn-kw: var(--vscode-debugTokenExpression-name, #c586c0);
  --syn-str: var(--vscode-debugTokenExpression-string, #ce9178);
  --syn-num: var(--vscode-debugTokenExpression-number, #b5cea8);
  --syn-lit: var(--vscode-debugTokenExpression-boolean, #569cd6);
  --syn-key: var(--vscode-charts-blue, #3794ff);
  --syn-fn: var(--vscode-charts-yellow, #dcdcaa);
  --syn-type: var(--vscode-charts-green, #4ec9b0);
  --syn-attr: var(--vscode-charts-orange, #d18616);
  /* GitHub-style diff colours: translucent, so they sit well on any theme background. */
  --add-line: rgba(46, 160, 67, 0.15);
  --add-num: rgba(46, 160, 67, 0.28);
  --add-word: rgba(46, 160, 67, 0.45);
  --add-fg: #3fb950;
  --del-line: rgba(248, 81, 73, 0.13);
  --del-num: rgba(248, 81, 73, 0.26);
  --del-word: rgba(248, 81, 73, 0.45);
  --del-fg: #f85149;
  --hunk-bg: rgba(56, 139, 253, 0.12);
  --hunk-fg: color-mix(in srgb, var(--ds-fg) 70%, transparent);
  --cur: var(--ds-accent);
  --empty-cell: color-mix(in srgb, var(--ds-fg) 4%, transparent);
  --row-hover: color-mix(in srgb, var(--ds-fg) 5%, transparent);
}
body.vscode-light {
  --add-line: rgba(31, 136, 61, 0.1);
  --add-num: rgba(31, 136, 61, 0.2);
  --add-word: rgba(46, 160, 67, 0.32);
  --add-fg: #1a7f37;
  --del-line: rgba(255, 129, 130, 0.16);
  --del-num: rgba(255, 129, 130, 0.32);
  --del-word: rgba(255, 129, 130, 0.5);
  --del-fg: #cf222e;
  --hunk-bg: rgba(84, 174, 255, 0.15);
}
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --add-line: transparent; --del-line: transparent; --add-num: transparent; --del-num: transparent;
  --add-word: transparent; --del-word: transparent;
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
button, select, input, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 1px; }

.app { min-height: 100%; display: flex; flex-direction: column; gap: var(--ds-space-3, 12px); padding: var(--ds-space-4, 16px) clamp(12px, 2.4vw, 28px); }

/* Header */
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--ds-space-3, 12px); }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand-icon { font-size: 22px !important; width: 38px; height: 38px; border-radius: var(--ds-radius-md, 8px); display: grid; place-items: center; color: var(--ds-accent-fg); background: var(--ds-accent-gradient, var(--ds-accent)); flex: none; }
h1 { margin: 0; font-size: var(--ds-text-xl, 20px); letter-spacing: -0.01em; line-height: 1.2; }
.brand p { margin: 2px 0 0; color: var(--ds-muted); font-size: var(--ds-text-sm, 12px); }
.top-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
select { background: var(--vscode-dropdown-background, var(--ds-surface)); border: 1px solid var(--vscode-dropdown-border, var(--ds-border-strong)); border-radius: var(--ds-radius-sm, 4px); padding: 3px 6px; min-height: 28px; }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 12px; border-radius: var(--ds-radius-md, 6px); border: 1px solid transparent; font-weight: 600; cursor: pointer; white-space: nowrap; background: transparent; }
.btn.sm { min-height: 28px; padding: 0 10px; font-weight: 500; font-size: var(--ds-text-sm, 12px); }
.btn.primary { background: var(--ds-accent); color: var(--ds-accent-fg); }
.btn.primary:hover { background: var(--ds-accent-hover); }
.btn.ghost { border-color: var(--ds-border); color: var(--ds-fg); }
.btn.ghost:hover:not(:disabled) { background: var(--ds-surface-2); border-color: var(--ds-border-strong); }
.btn:disabled { opacity: 0.45; cursor: default; }
.icon-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: var(--ds-radius-sm, 4px); border: 1px solid transparent; background: transparent; cursor: pointer; color: var(--ds-muted); }
.icon-btn:hover:not(:disabled) { background: var(--ds-surface-2); color: var(--ds-fg); }
.icon-btn:disabled { opacity: 0.4; cursor: default; }
.seg { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md, 6px); background: var(--ds-surface); }
.seg button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; border-radius: calc(var(--ds-radius-md, 6px) - 2px); padding: 3px 10px; min-height: 24px; cursor: pointer; color: var(--ds-muted); font-size: var(--ds-text-sm, 12px); font-weight: 500; }
.seg button:hover:not(:disabled) { color: var(--ds-fg); }
.seg button[aria-checked="true"] { background: var(--ds-accent); color: var(--ds-accent-fg); }
.seg button:disabled { opacity: 0.45; cursor: not-allowed; }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; border-radius: var(--ds-radius-pill, 999px); border: 1px solid var(--ds-border); background: transparent; cursor: pointer; color: var(--ds-muted); font-size: var(--ds-text-sm, 12px); }
.chip:hover { color: var(--ds-fg); border-color: var(--ds-border-strong); }
.chip[aria-pressed="true"] { color: var(--ds-fg); border-color: var(--ds-accent); background: color-mix(in srgb, var(--ds-accent) 14%, transparent); }
.chip[aria-pressed="true"]::after { content: "\\eab2"; font-family: codicon; font-size: 12px; color: var(--ds-accent); }

/* Inputs */
.inputs { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 8px; align-items: stretch; }
.pane { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-lg, 10px); background: var(--ds-surface); overflow: hidden; box-shadow: var(--ds-shadow-sm); }
.pane:focus-within { border-color: color-mix(in srgb, var(--ds-focus) 70%, var(--ds-border)); }
.pane-head { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border-bottom: 1px solid var(--ds-border); min-width: 0; }
.side-tag { flex: none; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-family: var(--mono); font-size: 13px; line-height: 1; }
.side-tag.del { background: var(--del-num); color: var(--del-fg); }
.side-tag.add { background: var(--add-num); color: var(--add-fg); }
.name { flex: 1 1 80px; min-width: 60px; border: 1px solid transparent; background: transparent; border-radius: var(--ds-radius-sm, 4px); padding: 2px 6px; font-weight: 600; }
.name:hover { border-color: var(--ds-border); }
.name:focus { border-color: var(--ds-focus); outline: none; background: var(--vscode-input-background, var(--ds-bg)); }
.name::placeholder { color: var(--ds-fg); opacity: 0.85; }
.meta { flex: none; color: var(--ds-muted); font-size: var(--ds-text-xs, 11px); white-space: nowrap; }
.pane-tools { display: flex; gap: 1px; flex: none; }
.editor { position: relative; display: flex; height: 230px; min-height: 90px; resize: vertical; overflow: hidden; background: var(--vscode-input-background, var(--ds-bg)); }
.gutter { flex: none; width: var(--gw, 36px); overflow: hidden; position: relative; border-right: 1px solid var(--ds-border); background: var(--ds-surface); }
.gutter-inner { position: absolute; left: 0; right: 0; top: 0; padding: 8px 8px 0 0; text-align: right; white-space: pre; font-family: var(--mono); font-size: var(--code-size); line-height: var(--rh); color: var(--ds-muted); opacity: 0.75; will-change: transform; }
.editor textarea { flex: 1; min-width: 0; height: 100%; margin: 0; border: 0; resize: none; padding: 8px 10px; background: transparent; font-family: var(--mono); font-size: var(--code-size); line-height: var(--rh); white-space: pre; overflow: auto; tab-size: var(--tab, 4); outline: none; }
.editor textarea::placeholder { color: var(--ds-muted); font-family: var(--ds-font-sans); }
.drop-hint { position: absolute; inset: 6px; display: none; place-items: center; gap: 8px; border: 2px dashed var(--ds-accent); border-radius: var(--ds-radius-md, 8px); background: color-mix(in srgb, var(--ds-accent) 12%, var(--ds-bg)); color: var(--ds-fg); font-weight: 600; pointer-events: none; }
.editor.dragging .drop-hint { display: grid; }
.swap-col { display: flex; align-items: center; }
.swap { border: 1px solid var(--ds-border); border-radius: 50%; width: 32px; height: 32px; background: var(--ds-surface); color: var(--ds-fg); }
.inputs-collapsed { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-md, 8px); background: var(--ds-surface); color: var(--ds-muted); font-size: var(--ds-text-sm, 12px); }
.inputs-collapsed #collapsedNames { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ds-fg); }
[hidden] { display: none !important; }

/* Results */
.results { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 440px; border: 1px solid var(--ds-border); border-radius: var(--ds-radius-lg, 10px); background: var(--ds-surface); box-shadow: var(--ds-shadow-sm); overflow: hidden; }
.res-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px 6px; }
.summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-height: 28px; font-size: var(--ds-text-sm, 12px); color: var(--ds-muted); }
.summary .big { font-family: var(--mono); font-weight: 700; font-size: 13px; }
.summary .plus { color: var(--add-fg); }
.summary .minus { color: var(--del-fg); }
.diffstat { display: inline-flex; gap: 2px; }
.diffstat i { width: 8px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--ds-fg) 18%, transparent); }
.diffstat i.a { background: var(--add-fg); }
.diffstat i.d { background: var(--del-fg); }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: var(--ds-radius-pill, 999px); background: var(--ds-surface-2); color: var(--ds-fg); font-size: var(--ds-text-xs, 11px); white-space: nowrap; }
.badge .dot { width: 7px; height: 7px; border-radius: 50%; }
.dot.mod { background: var(--ds-warning); } .dot.add { background: var(--add-fg); } .dot.del { background: var(--del-fg); } .dot.same { background: var(--ds-muted); }
.summary .ok { color: var(--ds-success); display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.summary .busy { display: inline-flex; align-items: center; gap: 6px; }
.nav { display: flex; align-items: center; gap: 6px; }
.nav-pos { min-width: 64px; text-align: center; font-size: var(--ds-text-sm, 12px); color: var(--ds-muted); font-variant-numeric: tabular-nums; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 6px 12px 10px; border-bottom: 1px solid var(--ds-border); }
.tb { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tb.actions { margin-left: auto; }
.inline-field { display: inline-flex; align-items: center; gap: 6px; color: var(--ds-muted); font-size: var(--ds-text-sm, 12px); }
.inline-field input { width: 90px; min-height: 28px; padding: 2px 8px; border: 1px solid var(--vscode-input-border, var(--ds-border-strong)); border-radius: var(--ds-radius-sm, 4px); background: var(--vscode-input-background, var(--ds-bg)); }
.app[data-mode="json"] .code-only, .app[data-mode="code"] .json-only { display: none !important; }
.menu { position: relative; }
.menu summary { list-style: none; }
.menu summary::-webkit-details-marker { display: none; }
.menu-body { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; display: grid; gap: 10px; min-width: 200px; padding: 12px; border: 1px solid var(--ds-border-strong); border-radius: var(--ds-radius-md, 8px); background: var(--vscode-menu-background, var(--ds-surface)); box-shadow: var(--ds-shadow-md); font-size: var(--ds-text-sm, 12px); }
.menu-body label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.menu-body label.check { justify-content: flex-start; }
.notices { display: grid; gap: 6px; padding: 0 12px; }
.notices:not(:empty) { padding-top: 8px; padding-bottom: 2px; }
.notice { display: flex; align-items: flex-start; gap: 8px; padding: 7px 10px; border-radius: var(--ds-radius-md, 6px); font-size: var(--ds-text-sm, 12px); border: 1px solid; }
.notice .codicon { margin-top: 1px; }
.notice.info { border-color: color-mix(in srgb, var(--ds-info) 45%, transparent); background: color-mix(in srgb, var(--ds-info) 10%, transparent); }
.notice.info .codicon { color: var(--ds-info); }
.notice.success { border-color: color-mix(in srgb, var(--ds-success) 45%, transparent); background: color-mix(in srgb, var(--ds-success) 10%, transparent); }
.notice.success .codicon { color: var(--ds-success); }
.notice.warning { border-color: color-mix(in srgb, var(--ds-warning) 50%, transparent); background: color-mix(in srgb, var(--ds-warning) 10%, transparent); }
.notice.warning .codicon { color: var(--ds-warning); }
.notice.error { border-color: color-mix(in srgb, var(--ds-danger) 55%, transparent); background: color-mix(in srgb, var(--ds-danger) 10%, transparent); }
.notice.error .codicon { color: var(--ds-danger); }

/* Viewer */
.viewer-wrap { position: relative; flex: 1 1 auto; min-height: 320px; margin-top: 8px; border-top: 1px solid var(--ds-border); background: var(--vscode-editor-background, var(--ds-bg)); }
.viewer { position: absolute; inset: 0 0 var(--hbar-h, 0px) 0; overflow-y: auto; overflow-x: hidden; outline: none; overscroll-behavior: contain; }
.viewer:focus-visible { box-shadow: inset 0 0 0 2px var(--ds-focus); }
.canvas { position: relative; min-width: 0; }
.hbar { position: absolute; left: 0; right: 0; bottom: 0; height: var(--hbar-h, 0px); overflow-x: auto; overflow-y: hidden; }
.hbar > div { height: 1px; }
.progress { position: absolute; left: 0; right: 0; top: 0; height: 2px; overflow: hidden; z-index: 5; }
.progress span { position: absolute; top: 0; bottom: 0; width: 30%; background: var(--ds-accent); animation: slide 1.1s ease-in-out infinite; }
@keyframes slide { from { left: -30%; } to { left: 100%; } }
@media (prefers-reduced-motion: reduce) { .progress span { animation: none; left: 0; width: 100%; opacity: 0.6; } }

.blk { contain: layout style; }
.r { display: grid; font-family: var(--mono); font-size: var(--code-size); line-height: var(--rh); min-height: var(--rh); }
.u .r { grid-template-columns: var(--lnw) var(--lnw) 20px minmax(0, 1fr); }
.s .r { grid-template-columns: var(--lnw) 20px minmax(0, 1fr) var(--lnw) 20px minmax(0, 1fr); }
.r:not(.fold):hover > .cd.ctx, .r:not(.fold):hover > .ln.ctx, .r:not(.fold):hover > .mk.ctx { background: var(--row-hover); }
.ln { padding: 0 8px 0 4px; text-align: right; color: var(--ds-muted); opacity: 0.8; user-select: none; -webkit-user-select: none; font-variant-numeric: tabular-nums; }
.mk { text-align: center; user-select: none; -webkit-user-select: none; font-weight: 600; }
.cd { overflow: hidden; white-space: pre; tab-size: var(--tab, 4); padding-right: 16px; }
.cd .t { display: inline-block; min-width: 100%; transform: translateX(calc(var(--sx, 0) * -1px)); }
.wrap .cd { white-space: pre-wrap; overflow-wrap: anywhere; }
.wrap .cd .t { display: inline; transform: none; }
.s .side-r { border-left: 1px solid var(--ds-border); }
.cd.del, .mk.del { background: var(--del-line); }
.cd.add, .mk.add { background: var(--add-line); }
.ln.del { background: var(--del-num); color: var(--ds-fg); opacity: 1; }
.ln.add { background: var(--add-num); color: var(--ds-fg); opacity: 1; }
.mk.del { color: var(--del-fg); }
.mk.add { color: var(--add-fg); }
.emp { background: var(--empty-cell); }
mark.chg { color: inherit; border-radius: 2px; }
.cd.del mark.chg { background: var(--del-word); }
.cd.add mark.chg { background: var(--add-word); }
body.vscode-high-contrast .cd.del, body.vscode-high-contrast-light .cd.del { outline: 1px dashed var(--del-fg); outline-offset: -1px; }
body.vscode-high-contrast .cd.add, body.vscode-high-contrast-light .cd.add { outline: 1px dashed var(--add-fg); outline-offset: -1px; }
body.vscode-high-contrast mark.chg, body.vscode-high-contrast-light mark.chg { outline: 1px solid currentColor; }
.r.cur > .ln:first-child { box-shadow: inset 3px 0 0 var(--cur); }
.cd .noeol { display: inline-block; margin-left: 6px; color: var(--ds-muted); font-size: 12px !important; vertical-align: -2px; user-select: none; -webkit-user-select: none; }
.trunc { color: var(--ds-muted); font-style: italic; font-family: var(--ds-font-sans); user-select: none; -webkit-user-select: none; }
.s-com { color: var(--ds-muted); font-style: italic; }
.s-str { color: var(--syn-str); } .s-num { color: var(--syn-num); } .s-lit { color: var(--syn-lit); } .s-kw { color: var(--syn-kw); }
.s-key, .s-tag { color: var(--syn-key); } .s-fn { color: var(--syn-fn); } .s-type { color: var(--syn-type); } .s-attr { color: var(--syn-attr); }
.viewer[data-sel="left"] .side-r, .viewer[data-sel="right"] .side-l { user-select: none; -webkit-user-select: none; }
.r.fold { grid-template-columns: 1fr; min-height: var(--fh); line-height: var(--fh); font-family: var(--ds-font-sans); }
.fold button { display: flex; align-items: center; gap: 8px; width: 100%; height: var(--fh); padding: 0 10px; border: 0; border-top: 1px solid color-mix(in srgb, var(--ds-info) 25%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--ds-info) 25%, transparent); background: var(--hunk-bg); color: var(--hunk-fg); cursor: pointer; text-align: left; font-size: var(--ds-text-sm, 12px); }
.fold button:hover { color: var(--ds-fg); background: color-mix(in srgb, var(--ds-info) 20%, transparent); }
.fold .hunk { font-family: var(--mono); opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* JSON results */
.json-view { position: absolute; inset: 0; overflow: auto; padding: 0; outline: none; }
.jt { width: 100%; border-collapse: collapse; font-size: var(--ds-text-sm, 12px); }
.jt th { position: sticky; top: 0; z-index: 1; text-align: left; font-weight: 600; color: var(--ds-muted); background: var(--ds-surface); padding: 6px 10px; border-bottom: 1px solid var(--ds-border); }
.jt td { padding: 6px 10px; border-bottom: 1px solid color-mix(in srgb, var(--ds-border) 60%, transparent); vertical-align: top; }
.jt td.path, .jt td.val { font-family: var(--mono); word-break: break-word; }
.jt td.val.before:not(:empty) { background: var(--del-line); }
.jt td.val.after:not(:empty) { background: var(--add-line); }
.kind { display: inline-block; padding: 0 8px; border-radius: var(--ds-radius-pill, 999px); font-size: 11px; font-weight: 600; }
.kind.added { color: var(--add-fg); background: var(--add-num); }
.kind.removed { color: var(--del-fg); background: var(--del-num); }
.kind.changed { color: var(--ds-fg); background: color-mix(in srgb, var(--ds-warning) 28%, transparent); }
.kind.type { color: var(--ds-fg); background: color-mix(in srgb, var(--ds-purple) 30%, transparent); }

/* Empty, toast, dialog */
.empty { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; }
.empty .card { max-width: 440px; display: grid; justify-items: center; gap: 10px; }
.empty .big-icon { font-size: 36px !important; color: var(--ds-accent); opacity: 0.9; }
.empty h2 { margin: 0; font-size: var(--ds-text-lg, 15px); }
.empty p { margin: 0; color: var(--ds-muted); }
.empty .row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 4px; }
.empty.error .big-icon { color: var(--ds-danger); }
.empty.same .big-icon { color: var(--ds-success); }
.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 50; display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100vw - 32px)); padding: 8px 12px; border-radius: var(--ds-radius-md, 8px); background: var(--vscode-notifications-background, var(--ds-surface)); color: var(--vscode-notifications-foreground, var(--ds-fg)); border: 1px solid var(--ds-border-strong); box-shadow: var(--ds-shadow-lg); font-size: var(--ds-text-sm, 12px); }
.toast .codicon-pass { color: var(--ds-success); } .toast .codicon-error { color: var(--ds-danger); } .toast .codicon-warning { color: var(--ds-warning); } .toast .codicon-info { color: var(--ds-info); }
.toast .link { background: none; border: 0; padding: 0; color: var(--ds-link); cursor: pointer; font-weight: 600; }
dialog { border: 1px solid var(--ds-border-strong); border-radius: var(--ds-radius-lg, 10px); background: var(--ds-surface); color: var(--ds-fg); box-shadow: var(--ds-shadow-lg); padding: 18px 20px; min-width: min(420px, calc(100vw - 32px)); }
dialog::backdrop { background: rgba(0, 0, 0, 0.35); }
dialog h2 { margin: 0 0 12px; font-size: var(--ds-text-lg, 15px); }
dialog form { display: flex; justify-content: flex-end; margin-top: 14px; }
.keys { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; font-size: var(--ds-text-sm, 12px); }
.keys dt { white-space: nowrap; }
.keys dd { margin: 0; color: var(--ds-muted); }
kbd { display: inline-block; min-width: 20px; padding: 1px 6px; border: 1px solid var(--ds-border-strong); border-bottom-width: 2px; border-radius: 4px; font-family: var(--mono); font-size: 11px; text-align: center; background: var(--ds-bg); }

/* Narrow panels: stacked inputs, unified view. */
@media (max-width: 760px) {
  .inputs { grid-template-columns: minmax(0, 1fr); }
  .swap-col { justify-content: center; }
  .swap .codicon { transform: rotate(90deg); }
  .editor { height: 170px; }
  .brand p { display: none; }
  .tb.actions { margin-left: 0; }
  .toolbar { gap: 8px; }
  .chip { padding: 0 8px; }
}
@media (max-width: 480px) {
  .app { padding: 10px; }
  .btn.sm .codicon + * { display: none; }
  .pane-head { flex-wrap: wrap; }
}
`;
//# sourceMappingURL=page.js.map