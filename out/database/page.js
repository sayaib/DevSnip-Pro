"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DB_CSS = exports.renderDatabasePage = void 0;
const webview_ui_1 = require("../utils/webview-ui");
/** The HTML shell of the Database Client. media/db-client.js renders everything inside it. */
function renderDatabasePage(o) {
    const nonce = (0, webview_ui_1.getNonce)();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${o.cspSource}; style-src ${o.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Database Client</title>
<link rel="stylesheet" href="${(0, webview_ui_1.escapeHtml)(o.codiconsUri)}">
<style nonce="${nonce}">${webview_ui_1.THEME_TOKENS}${exports.DB_CSS}</style>
</head>
<body data-platform="${(0, webview_ui_1.escapeHtml)(o.platform)}">
<div id="app" class="app" aria-busy="true">
  <div class="boot"><span class="codicon codicon-loading codicon-modifier-spin"></span> Loading Database Client…</div>
</div>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
<script nonce="${nonce}" src="${(0, webview_ui_1.escapeHtml)(o.scriptUri)}"></script>
</body>
</html>`;
}
exports.renderDatabasePage = renderDatabasePage;
exports.DB_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.4;
  -webkit-font-smoothing: antialiased; overflow: hidden;
}
:root {
  --side-bg: var(--vscode-sideBar-background, var(--bg));
  --surface: color-mix(in srgb, var(--text) 3%, var(--bg));
  --surface-2: color-mix(in srgb, var(--text) 6%, var(--bg));
  --surface-3: color-mix(in srgb, var(--text) 10%, var(--bg));
  --hairline: color-mix(in srgb, var(--text) 11%, transparent);
  --hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--text) 7%, transparent));
  --selected: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--accent) 24%, transparent));
  --selected-fg: var(--vscode-list-activeSelectionForeground, var(--text));
  --input-bg: var(--vscode-input-background, var(--surface-2));
  --input-fg: var(--vscode-input-foreground, var(--text));
  --input-border: var(--vscode-input-border, var(--hairline));
  --btn-bg: var(--vscode-button-background, #0e639c);
  --btn-fg: var(--vscode-button-foreground, #fff);
  --btn-hover: var(--vscode-button-hoverBackground, color-mix(in srgb, var(--btn-bg) 85%, white));
  --btn2-bg: var(--vscode-button-secondaryBackground, var(--surface-3));
  --btn2-fg: var(--vscode-button-secondaryForeground, var(--text));
  --btn2-hover: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--text) 16%, var(--bg)));
  --null: color-mix(in srgb, var(--muted) 75%, transparent);
  --num: var(--vscode-debugTokenExpression-number, #b5cea8);
  --str: var(--vscode-debugTokenExpression-string, #ce9178);
  --bool: var(--vscode-debugTokenExpression-boolean, #569cd6);
  --radius: 6px;
  --ease: cubic-bezier(.2, .7, .3, 1);
  --c-blue: #3794ff; --c-green: #3fb950; --c-orange: #e8912d; --c-red: #f14c4c; --c-purple: #b180d7; --c-teal: #2bb3a3; --c-gray: #8b949e;
}
.codicon { font-size: 16px; line-height: 1; }
button { font: inherit; color: inherit; }
input, select, textarea { font: inherit; color: var(--input-fg); }
:focus-visible { outline: 1px solid var(--focus); outline-offset: -1px; }
.boot { display: flex; gap: 8px; align-items: center; justify-content: center; height: 100vh; color: var(--muted); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); }
.grow { flex: 1; min-width: 0; }
.hidden { display: none !important; }

/* Layout */
.app { display: flex; height: 100vh; width: 100vw; overflow: hidden; }
.side { width: var(--side-w, 280px); min-width: 200px; max-width: 520px; flex: none; display: flex; flex-direction: column; background: var(--side-bg); border-right: 1px solid var(--hairline); }
.resizer { width: 4px; margin-left: -2px; margin-right: -2px; cursor: col-resize; flex: none; z-index: 5; }
.resizer:hover, .resizer.dragging { background: var(--focus); }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.scrim { display: none; }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 4px; border: 1px solid transparent; background: var(--btn2-bg); color: var(--btn2-fg); cursor: pointer; white-space: nowrap; font-size: 12.5px; transition: background .12s; }
.btn:hover:not(:disabled) { background: var(--btn2-hover); }
.btn.primary { background: var(--btn-bg); color: var(--btn-fg); }
.btn.primary:hover:not(:disabled) { background: var(--btn-hover); }
.btn.danger { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 20%, transparent); }
.btn.ghost { background: transparent; }
.btn.ghost:hover:not(:disabled) { background: var(--hover); }
.btn:disabled { opacity: .5; cursor: default; }
.btn .codicon { font-size: 14px; }
.btn kbd { font-family: var(--font); font-size: 10.5px; opacity: .75; margin-left: 2px; }
.icon-btn { display: inline-grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer; flex: none; }
.icon-btn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.icon-btn:disabled { opacity: .4; cursor: default; }
.icon-btn.active { color: var(--accent); }
.icon-btn .codicon { font-size: 15px; }

/* Inputs */
.input, .select, .textarea { background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 4px; height: 28px; padding: 0 8px; outline: none; min-width: 0; }
.input:focus, .select:focus, .textarea:focus { border-color: var(--focus); }
.textarea { height: auto; padding: 6px 8px; resize: vertical; font-family: var(--mono); font-size: 12.5px; line-height: 1.5; }
.select { padding-right: 4px; }
.input.invalid, .textarea.invalid { border-color: var(--danger); }
.search { position: relative; display: flex; align-items: center; }
.search .codicon { position: absolute; left: 7px; color: var(--muted); font-size: 14px; pointer-events: none; }
.search .input { padding-left: 27px; width: 100%; }

/* Sidebar */
.side-head { display: flex; align-items: center; gap: 2px; height: 35px; padding: 0 6px 0 12px; flex: none; }
.side-head h2 { margin: 0; flex: 1; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.side-filter { padding: 0 8px 8px; flex: none; }
.side-filter .input { height: 26px; font-size: 12px; }
.tree { flex: 1; overflow: auto; padding-bottom: 16px; }
.side-foot { flex: none; border-top: 1px solid var(--hairline); padding: 8px 12px; font-size: 11px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.node { display: flex; align-items: center; gap: 5px; height: 24px; padding-right: 6px; cursor: pointer; user-select: none; white-space: nowrap; position: relative; }
.node:hover { background: var(--hover); }
.node.active { background: var(--selected); color: var(--selected-fg); }
.node .twistie { width: 16px; flex: none; display: grid; place-items: center; color: var(--muted); }
.node .twistie .codicon { font-size: 14px; }
.node .label { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.node .badge { font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.node .acts { display: none; gap: 0; margin-left: 2px; }
.node:hover .acts, .node:focus-within .acts { display: inline-flex; }
.node:hover .badge { display: none; }
.node .acts .icon-btn { width: 20px; height: 20px; }
.node .acts .codicon { font-size: 13.5px; }
.node.conn { height: 30px; margin-top: 2px; }
.node.conn .label { font-weight: 600; }
.node.conn .sub { color: var(--muted); font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.node .kind-icon { width: 18px; height: 18px; border-radius: 4px; display: grid; place-items: center; flex: none; font-size: 9px; font-weight: 800; letter-spacing: -.02em; color: #fff; background: var(--conn-color, var(--c-blue)); }
.node .obj-icon { color: var(--muted); }
.node .obj-icon.view { color: var(--c-purple); }
.node .obj-icon.collection { color: var(--c-green); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--c-gray); opacity: .6; }
.dot.connected { background: var(--success); opacity: 1; box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent); }
.dot.connecting { background: var(--warning); opacity: 1; animation: pulse 1s ease-in-out infinite; }
.dot.error { background: var(--danger); opacity: 1; }
@keyframes pulse { 50% { opacity: .35; } }
.node-msg { margin: 2px 8px 6px 34px; padding: 6px 8px; border-radius: 4px; font-size: 11.5px; white-space: normal; line-height: 1.35; }
.node-msg.error { color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); }
.node-msg.info { color: var(--muted); }
.node-msg .btn { height: 22px; font-size: 11px; padding: 0 8px; margin-top: 6px; }
.lock { font-size: 12px !important; color: var(--warning); }
.empty-side { padding: 18px 16px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.empty-side .btn { margin-top: 10px; }

/* Tabs */
.tabbar { display: flex; align-items: stretch; height: 35px; flex: none; background: var(--vscode-editorGroupHeader-tabsBackground, var(--side-bg)); border-bottom: 1px solid var(--hairline); }
.tabbar .menu-toggle { display: none; align-self: center; margin: 0 4px; }
.tabs { display: flex; overflow-x: auto; overflow-y: hidden; flex: 1; scrollbar-width: none; }
.tabs::-webkit-scrollbar { display: none; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 6px 0 12px; max-width: 220px; min-width: 0; border-right: 1px solid var(--hairline); cursor: pointer; color: var(--muted); flex: none; position: relative; }
.tab:hover { color: var(--text); background: var(--hover); }
.tab.active { color: var(--text); background: var(--bg); }
.tab.active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--bg); }
.tab.active::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--tab-color, var(--accent)); }
.tab .t-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .codicon { font-size: 14px; }
.tab .icon-btn { width: 20px; height: 20px; visibility: hidden; }
.tab:hover .icon-btn, .tab.active .icon-btn { visibility: visible; }
.tabbar .new-query { align-self: center; margin: 0 6px; }
.views { flex: 1; min-height: 0; position: relative; }
.view { position: absolute; inset: 0; display: flex; flex-direction: column; }

/* View header + toolbar */
.vhead { display: flex; align-items: center; gap: 10px; padding: 10px 14px 8px; flex: none; flex-wrap: wrap; }
.crumbs { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1; font-size: 12px; color: var(--muted); overflow: hidden; }
.crumbs .sep { opacity: .55; font-size: 12px; }
.crumbs b { color: var(--text); font-size: 14px; font-weight: 600; }
.crumbs .crumb { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 10px; font-size: 11px; background: var(--surface-2); color: var(--muted); white-space: nowrap; }
.chip.warn { color: var(--warning); background: color-mix(in srgb, var(--warning) 12%, transparent); }
.chip .codicon { font-size: 12px; }
.seg { display: inline-flex; border: 1px solid var(--hairline); border-radius: 5px; overflow: hidden; flex: none; }
.seg button { border: 0; background: transparent; height: 26px; padding: 0 10px; cursor: pointer; color: var(--muted); display: inline-flex; gap: 5px; align-items: center; font-size: 12px; }
.seg button .codicon { font-size: 13px; }
.seg button.on { background: var(--surface-3); color: var(--text); }
.toolbar { display: flex; align-items: center; gap: 6px; padding: 0 14px 10px; flex: none; flex-wrap: wrap; }
.toolbar .search { width: 260px; max-width: 100%; }
.toolbar .divider { width: 1px; height: 18px; background: var(--hairline); margin: 0 2px; }
.toolbar .count-badge { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; font-size: 10px; background: var(--btn-bg); color: var(--btn-fg); }
.query-input { flex: 1; min-width: 220px; font-family: var(--mono); font-size: 12px; }

/* Filter builder */
.filters { margin: 0 14px 10px; padding: 10px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface); display: flex; flex-direction: column; gap: 6px; flex: none; }
.frule { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.frule .select { max-width: 180px; }
.frule .input { flex: 1; min-width: 140px; }
.frule .join { width: 42px; text-align: right; color: var(--muted); font-size: 11px; text-transform: uppercase; }
.filters .row-actions { display: flex; gap: 6px; padding-top: 4px; }

/* Banners */
.banner { margin: 0 14px 10px; padding: 8px 10px; border-radius: var(--radius); display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.45; flex: none; }
.banner .codicon { font-size: 15px; margin-top: 1px; }
.banner.info { background: color-mix(in srgb, var(--accent) 9%, transparent); color: var(--text); }
.banner.info .codicon { color: var(--accent); }
.banner.warn { background: color-mix(in srgb, var(--warning) 10%, transparent); }
.banner.warn .codicon { color: var(--warning); }
.banner.error { background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--text); }
.banner.error .codicon { color: var(--danger); }
.banner .hint { color: var(--muted); display: block; margin-top: 2px; }
.banner .btn { height: 24px; font-size: 11.5px; margin-left: auto; flex: none; }

/* Grid */
.grid-wrap { flex: 1; min-height: 0; overflow: auto; position: relative; border-top: 1px solid var(--hairline); }
table.grid { border-collapse: separate; border-spacing: 0; font-size: 12.5px; min-width: 100%; }
.grid th, .grid td { border-right: 1px solid var(--hairline); border-bottom: 1px solid var(--hairline); padding: 0 10px; height: 28px; max-width: 360px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.grid thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-2); font-weight: 600; height: 34px; cursor: default; user-select: none; }
.grid thead th.sortable { cursor: pointer; }
.grid thead th.sortable:hover { background: var(--surface-3); }
.grid th .h { display: flex; align-items: center; gap: 5px; }
.grid th .h .name { overflow: hidden; text-overflow: ellipsis; }
.grid th .type { font-weight: 400; font-size: 10.5px; color: var(--muted); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; }
.grid th .codicon { font-size: 12px; }
.grid th .pk { color: var(--warning); }
.grid th .sort { color: var(--accent); margin-left: auto; }
.grid td { font-family: var(--mono); font-size: 12px; }
.grid tbody tr:hover td { background: var(--hover); }
.grid tbody tr.sel td { background: color-mix(in srgb, var(--accent) 14%, transparent); }
.grid tbody tr { cursor: default; }
.grid .rn { width: 1%; color: var(--muted); text-align: right; font-size: 11px; padding: 0 6px; position: sticky; left: 0; z-index: 1; background: var(--bg); }
.grid thead .rn { z-index: 3; background: var(--surface-2); }
.grid tbody tr:hover .rn { background: var(--hover); }
.grid .ck { width: 1%; padding: 0 0 0 8px; position: sticky; left: 0; z-index: 1; background: var(--bg); }
.grid thead .ck { z-index: 3; background: var(--surface-2); }
.grid .ck input { margin: 0; vertical-align: middle; cursor: pointer; }
.grid .ra { width: 1%; padding: 0 4px; }
.grid .ra .icon-btn { width: 22px; height: 22px; opacity: 0; }
.grid tr:hover .ra .icon-btn, .grid .ra .icon-btn:focus-visible { opacity: 1; }
.v-null { color: var(--null); font-style: italic; font-family: var(--font); font-size: 11px; }
.v-num { color: var(--num); }
.v-bool { color: var(--bool); }
.v-json { color: var(--muted); }
.v-tag { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; height: 18px; border-radius: 3px; font-family: var(--font); font-size: 10.5px; background: var(--surface-3); color: var(--muted); }
.v-type { display: inline-block; padding: 0 6px; border-radius: 3px; font-family: var(--font); font-size: 10.5px; line-height: 17px; text-transform: lowercase; }
.v-type.t-string { background: color-mix(in srgb, var(--c-blue) 18%, transparent); color: var(--c-blue); }
.v-type.t-hash { background: color-mix(in srgb, var(--c-purple) 18%, transparent); color: var(--c-purple); }
.v-type.t-list { background: color-mix(in srgb, var(--c-green) 18%, transparent); color: var(--c-green); }
.v-type.t-set { background: color-mix(in srgb, var(--c-orange) 18%, transparent); color: var(--c-orange); }
.v-type.t-zset { background: color-mix(in srgb, var(--c-teal) 18%, transparent); color: var(--c-teal); }
.v-type.t-stream, .v-type.t-other { background: var(--surface-3); color: var(--muted); }
.grid-empty { padding: 48px 16px; text-align: center; color: var(--muted); }
.grid-empty > .codicon { font-size: 28px; display: block; margin: 0 auto 10px; opacity: .6; }
.loading-bar { position: absolute; left: 0; right: 0; top: 0; height: 2px; overflow: hidden; z-index: 6; pointer-events: none; }
.loading-bar::after { content: ""; position: absolute; top: 0; bottom: 0; width: 30%; background: var(--focus); animation: slide 1s var(--ease) infinite; }
@keyframes slide { from { left: -30%; } to { left: 100%; } }
.busy-veil { position: absolute; inset: 0; background: color-mix(in srgb, var(--bg) 45%, transparent); z-index: 4; }
.skeleton td span { display: block; height: 9px; border-radius: 4px; background: var(--surface-3); animation: pulse 1.2s ease-in-out infinite; }

/* Footer / pager */
.vfoot { display: flex; align-items: center; gap: 10px; padding: 6px 14px; flex: none; border-top: 1px solid var(--hairline); font-size: 12px; color: var(--muted); flex-wrap: wrap; min-height: 38px; }
.vfoot .pager { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.vfoot .pager .input { width: 56px; height: 24px; text-align: center; }
.vfoot .select { height: 24px; font-size: 12px; }

/* Structure */
.struct { flex: 1; overflow: auto; padding: 0 14px 20px; }
.struct table.grid td { font-family: var(--font); }
.struct .flag { display: inline-flex; gap: 3px; align-items: center; margin-right: 6px; font-size: 11px; color: var(--muted); }
.struct .flag.pk { color: var(--warning); }
.bar { height: 6px; width: 80px; border-radius: 3px; background: var(--surface-3); overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 6px; }
.bar i { display: block; height: 100%; background: var(--accent); }

/* Query view */
.qbar { display: flex; align-items: center; gap: 6px; padding: 8px 14px; flex: none; flex-wrap: wrap; border-bottom: 1px solid var(--hairline); }
.qbar .select { max-width: 220px; }
.qsplit { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.editor-wrap { position: relative; flex: none; height: var(--editor-h, 200px); min-height: 80px; display: flex; }
.editor { flex: 1; width: 100%; border: 0; border-radius: 0; resize: none; padding: 12px 14px; background: var(--vscode-editor-background, var(--bg)); color: var(--text); font-family: var(--mono); font-size: var(--vscode-editor-font-size, 13px); line-height: 1.55; outline: none; tab-size: 2; white-space: pre; }
.editor::placeholder { color: var(--muted); opacity: .7; }
.hsplit { height: 5px; flex: none; cursor: row-resize; background: var(--hairline); }
.hsplit:hover, .hsplit.dragging { background: var(--focus); }
.qresult { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.qstatus { display: flex; align-items: center; gap: 10px; padding: 6px 14px; font-size: 12px; color: var(--muted); flex: none; min-height: 34px; flex-wrap: wrap; }
.qstatus .ok { color: var(--success); }
.qstatus .acts { margin-left: auto; display: flex; gap: 4px; }
.qmessage { margin: 10px 14px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--hairline); font-family: var(--mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 50%; overflow: auto; flex: none; }
.qplaceholder { flex: 1; display: grid; place-items: center; color: var(--muted); text-align: center; padding: 20px; font-size: 12px; }
.qplaceholder kbd, .hint-kbd { padding: 1px 5px; border-radius: 3px; border: 1px solid var(--hairline); background: var(--surface-2); font-family: var(--font); font-size: 11px; }

/* Welcome */
.welcome { flex: 1; overflow: auto; display: flex; justify-content: center; padding: 48px 24px; }
.welcome-inner { max-width: 720px; width: 100%; }
.welcome h1 { font-size: 22px; font-weight: 650; margin: 0 0 6px; display: flex; gap: 10px; align-items: center; }
.welcome h1 .codicon { font-size: 26px; color: var(--accent); }
.welcome p.lead { color: var(--muted); margin: 0 0 22px; font-size: 13.5px; line-height: 1.55; }
.kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin: 18px 0 26px; }
.kind-card { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--hairline); cursor: pointer; text-align: left; color: var(--text); }
.kind-card:hover { border-color: var(--focus); background: var(--surface-2); }
.kind-card .kind-icon { width: 26px; height: 26px; border-radius: 6px; display: grid; place-items: center; font-size: 10px; font-weight: 800; color: #fff; flex: none; }
.kind-card small { display: block; color: var(--muted); font-size: 11px; }
.section-title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.recent { display: flex; flex-direction: column; gap: 4px; margin-bottom: 26px; }
.recent button { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius); border: 1px solid var(--hairline); background: transparent; cursor: pointer; text-align: left; color: var(--text); }
.recent button:hover { background: var(--hover); }
.tips { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
.tip { padding: 12px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--hairline); font-size: 12px; color: var(--muted); line-height: 1.5; }
.tip b { color: var(--text); display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 600; }
.tip .codicon { color: var(--accent); font-size: 14px; }

/* Overlays: modal + drawer */
.overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.42); display: flex; animation: fade .12s ease-out; }
@keyframes fade { from { opacity: 0; } }
.modal { margin: auto; width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--vscode-editorWidget-background, var(--surface-2)); color: var(--vscode-editorWidget-foreground, var(--text)); border: 1px solid var(--vscode-editorWidget-border, var(--hairline)); border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,.45); animation: pop .16s var(--ease); }
@keyframes pop { from { transform: translateY(8px) scale(.985); opacity: 0; } }
.mhead { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
.mhead h3 { margin: 0; font-size: 14px; font-weight: 650; flex: 1; }
.mbody { padding: 4px 16px 12px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
.mfoot { display: flex; gap: 8px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--hairline); flex-wrap: wrap; }
.mfoot .spacer { flex: 1; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field > label, .field .flabel { font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.field .help { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.field .input, .field .select { height: 30px; }
.with-btn { display: flex; gap: 6px; }
.with-btn .input { flex: 1; }
.examples { display: flex; flex-wrap: wrap; gap: 5px; }
.examples button { border: 1px solid var(--hairline); background: transparent; border-radius: 12px; height: 22px; padding: 0 9px; font-size: 11px; cursor: pointer; color: var(--muted); }
.examples button:hover { color: var(--text); border-color: var(--focus); }
.detect { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-radius: var(--radius); font-size: 12px; background: var(--surface); border: 1px solid var(--hairline); line-height: 1.45; }
.detect.ok { border-color: color-mix(in srgb, var(--success) 45%, transparent); }
.detect.bad { border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
.detect .codicon { margin-top: 1px; }
.detect.ok > .codicon { color: var(--success); }
.detect.bad > .codicon { color: var(--danger); }
.detect .facts { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--muted); margin-top: 3px; }
.detect .facts b { color: var(--text); font-weight: 500; }
.detect ul { margin: 6px 0 0; padding-left: 16px; color: var(--warning); }
.colors { display: flex; gap: 8px; }
.colors button { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.colors button.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--bg) inset; }
.check { display: flex; gap: 8px; align-items: flex-start; cursor: pointer; font-size: 12.5px; }
.check input { margin: 2px 0 0; }
.check small { display: block; color: var(--muted); font-size: 11.5px; }
.secure-note { display: flex; gap: 8px; font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.secure-note .codicon { color: var(--success); font-size: 14px; }
.test-result { font-size: 12px; display: flex; gap: 8px; align-items: flex-start; min-width: 0; padding: 8px 10px; border-radius: var(--radius); line-height: 1.45; }
.test-result:empty { display: none; }
.test-result.ok { background: color-mix(in srgb, var(--success) 10%, transparent); }
.test-result.bad { background: color-mix(in srgb, var(--danger) 10%, transparent); }
.test-result .hint { color: var(--muted); display: block; }
.test-result.ok { color: var(--success); }
.test-result.bad { color: var(--danger); }


.drawer-overlay { justify-content: flex-end; background: rgba(0,0,0,.28); }
.drawer { width: min(520px, 100vw); height: 100%; display: flex; flex-direction: column; background: var(--vscode-editorWidget-background, var(--side-bg)); border-left: 1px solid var(--hairline); box-shadow: -10px 0 30px rgba(0,0,0,.35); animation: slidein .18s var(--ease); }
@keyframes slidein { from { transform: translateX(24px); opacity: 0; } }
.dbody { flex: 1; overflow: auto; padding: 6px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.efield { display: flex; flex-direction: column; gap: 4px; }
.efield .ehead { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.efield .ehead b { font-weight: 600; font-family: var(--mono); font-size: 12px; }
.efield .ehead .type { color: var(--muted); font-family: var(--mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.efield .modes { margin-left: auto; display: inline-flex; border: 1px solid var(--hairline); border-radius: 4px; overflow: hidden; flex: none; }
.efield .modes button { border: 0; background: transparent; font-size: 10.5px; height: 20px; padding: 0 7px; cursor: pointer; color: var(--muted); }
.efield .modes button.on { background: var(--surface-3); color: var(--text); }
.efield .input, .efield .textarea { width: 100%; }
.efield .select { min-width: 120px; height: 30px; }
.efield .input { height: 30px; }
.efield .textarea { min-height: 30px; }
.efield .placeholder-box { height: 30px; display: flex; align-items: center; padding: 0 8px; border-radius: 4px; border: 1px dashed var(--hairline); color: var(--muted); font-size: 12px; font-style: italic; }
.efield.changed .ehead b::after { content: " •"; color: var(--accent); }
.efield .err { color: var(--danger); font-size: 11.5px; }
.doc-editor { min-height: 320px; flex: 1; }
.ferror { padding: 8px 10px; border-radius: var(--radius); background: color-mix(in srgb, var(--danger) 10%, transparent); color: var(--text); font-size: 12px; display: flex; gap: 8px; }
.ferror .codicon { color: var(--danger); }
.ferror .hint { color: var(--muted); display: block; margin-top: 2px; }

/* Menus */
.menu { position: fixed; z-index: 60; min-width: 200px; padding: 4px; border-radius: 6px; background: var(--vscode-menu-background, var(--surface-2)); color: var(--vscode-menu-foreground, var(--text)); border: 1px solid var(--vscode-menu-border, var(--hairline)); box-shadow: 0 8px 24px rgba(0,0,0,.4); animation: fade .08s; }
.menu button { display: flex; width: 100%; align-items: center; gap: 8px; height: 26px; padding: 0 10px; border: 0; background: transparent; border-radius: 4px; cursor: pointer; text-align: left; font-size: 12.5px; color: inherit; }
.menu button:hover:not(:disabled) { background: var(--vscode-menu-selectionBackground, var(--selected)); color: var(--vscode-menu-selectionForeground, inherit); }
.menu button:disabled { opacity: .45; cursor: default; }
.menu button.danger { color: var(--danger); }
.menu .codicon { font-size: 14px; width: 16px; }
.menu hr { border: 0; border-top: 1px solid var(--hairline); margin: 4px 2px; }

/* Toasts */
.toasts { position: fixed; right: 16px; bottom: 16px; z-index: 80; display: flex; flex-direction: column; gap: 8px; pointer-events: none; max-width: min(420px, calc(100vw - 32px)); }
.toast { pointer-events: auto; display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 6px; font-size: 12.5px; line-height: 1.4; background: var(--vscode-notifications-background, var(--surface-2)); color: var(--vscode-notifications-foreground, var(--text)); border: 1px solid var(--vscode-notifications-border, var(--hairline)); box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: pop .16s var(--ease); }
.toast .codicon { font-size: 15px; margin-top: 1px; }
.toast.success .codicon { color: var(--success); }
.toast.error .codicon { color: var(--danger); }
.toast.info .codicon { color: var(--accent); }
.toast .hint { display: block; color: var(--muted); font-size: 11.5px; margin-top: 2px; }
.toast.out { opacity: 0; transform: translateY(6px); transition: all .2s; }

/* Narrow panels */
@media (max-width: 760px) {
  .side { position: fixed; z-index: 40; top: 0; bottom: 0; left: 0; width: min(300px, 86vw); transform: translateX(-102%); transition: transform .18s var(--ease); box-shadow: 8px 0 24px rgba(0,0,0,.35); }
  .app.side-open .side { transform: none; }
  .app.side-open .scrim { display: block; position: fixed; inset: 0; z-index: 39; background: rgba(0,0,0,.35); }
  .resizer { display: none; }
  .tabbar .menu-toggle { display: inline-grid; }
  .toolbar .search { width: 100%; }
  .vhead, .toolbar, .qbar { padding-left: 10px; padding-right: 10px; }
  .vfoot .pager { margin-left: 0; }
  .grid th, .grid td { max-width: 220px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;
//# sourceMappingURL=page.js.map