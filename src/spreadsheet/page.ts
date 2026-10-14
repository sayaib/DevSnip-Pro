import { escapeHtml, getNonce, THEME_TOKENS } from "../utils/webview-ui";

/** The HTML shell of the CSV & Excel Viewer. media/spreadsheet-viewer.js renders everything inside it. */
export function renderSpreadsheetPage(o: { cspSource: string; scriptUri: string; editingUri: string; codiconsUri: string; platform: string }): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${o.cspSource}; style-src ${o.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSV &amp; Excel Viewer</title>
<link rel="stylesheet" href="${escapeHtml(o.codiconsUri)}">
<style nonce="${nonce}">${THEME_TOKENS}${SHEET_CSS}</style>
</head>
<body data-platform="${escapeHtml(o.platform)}">
<div id="app" class="app" aria-busy="true">
  <div class="boot"><span class="codicon codicon-loading codicon-modifier-spin"></span> Opening…</div>
</div>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
<script nonce="${nonce}" src="${escapeHtml(o.editingUri)}"></script>
<script nonce="${nonce}" src="${escapeHtml(o.scriptUri)}"></script>
</body>
</html>`;
}

export const SHEET_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.4;
  -webkit-font-smoothing: antialiased; overflow: hidden;
}
:root {
  --surface: color-mix(in srgb, var(--text) 3%, var(--bg));
  --surface-2: color-mix(in srgb, var(--text) 6%, var(--bg));
  --surface-3: color-mix(in srgb, var(--text) 10%, var(--bg));
  --hairline: color-mix(in srgb, var(--text) 11%, transparent);
  --gridline: color-mix(in srgb, var(--text) 8%, transparent);
  --hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--text) 7%, transparent));
  --sel-fill: color-mix(in srgb, var(--focus) 16%, transparent);
  --sel-head: color-mix(in srgb, var(--focus) 22%, var(--surface-2));
  --input-bg: var(--vscode-input-background, var(--surface-2));
  --input-fg: var(--vscode-input-foreground, var(--text));
  --input-border: var(--vscode-input-border, var(--hairline));
  --btn-bg: var(--vscode-button-background, #0e639c);
  --btn-fg: var(--vscode-button-foreground, #fff);
  --btn-hover: var(--vscode-button-hoverBackground, color-mix(in srgb, var(--btn-bg) 85%, white));
  --btn2-bg: var(--vscode-button-secondaryBackground, var(--surface-3));
  --btn2-fg: var(--vscode-button-secondaryForeground, var(--text));
  --btn2-hover: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--text) 16%, var(--bg)));
  --num: var(--vscode-debugTokenExpression-number, #b5cea8);
  --bool: var(--vscode-debugTokenExpression-boolean, #569cd6);
  --mark: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, .33));
  --radius: 6px;
  --ease: cubic-bezier(.2, .7, .3, 1);
}
.codicon { font-size: 16px; line-height: 1; }
button { font: inherit; color: inherit; }
input, select, textarea { font: inherit; color: var(--input-fg); }
:focus-visible { outline: 1px solid var(--focus); outline-offset: -1px; }
.boot { display: flex; gap: 8px; align-items: center; justify-content: center; height: 100vh; color: var(--muted); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.muted { color: var(--muted); }
.small { font-size: 11.5px; }
.mono { font-family: var(--mono); }
.grow { flex: 1; min-width: 0; }
.hidden { display: none !important; }
.app { height: 100vh; width: 100vw; overflow: hidden; }

/* Buttons and inputs */
.btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 4px; border: 1px solid transparent; background: var(--btn2-bg); color: var(--btn2-fg); cursor: pointer; white-space: nowrap; font-size: 12.5px; transition: background .12s; }
.btn:hover:not(:disabled) { background: var(--btn2-hover); }
.btn.primary { background: var(--btn-bg); color: var(--btn-fg); }
.btn.primary:hover:not(:disabled) { background: var(--btn-hover); }
.btn:disabled { opacity: .5; cursor: default; }
.btn .codicon { font-size: 14px; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 4px; background: transparent; color: var(--text); cursor: pointer; flex: none; }
.icon-btn:hover { background: var(--hover); }
.select { height: 28px; padding: 0 6px; border-radius: 4px; border: 1px solid var(--input-border); background: var(--input-bg); max-width: 180px; }
.toggle { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; font-size: 12.5px; user-select: none; }
.toggle:hover { background: var(--hover); }
.toggle input { margin: 0; accent-color: var(--btn-bg); }

/* Welcome */
.welcome { height: 100vh; overflow: auto; padding: 40px 24px 32px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.welcome > * { width: 100%; max-width: 720px; }
.hero { text-align: center; padding: 8px 0 12px; }
.hero-icon { width: 56px; height: 56px; margin: 0 auto 12px; border-radius: 14px; display: grid; place-items: center; background: color-mix(in srgb, var(--success) 16%, transparent); color: var(--success); }
.hero-icon .codicon { font-size: 30px; }
.hero h1 { font-size: 22px; font-weight: 600; margin: 0 0 6px; }
.hero p { margin: 0 auto 16px; max-width: 520px; }
.hero-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.card { background: var(--surface); border: 1px solid var(--hairline); border-radius: var(--radius); padding: 14px 16px; }
.card h2 { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin: 0 0 10px; }
.error-card { max-width: 560px; margin: 0 auto; }
.error-card h2 .codicon { color: var(--danger); }
.recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.recent li { display: flex; align-items: center; gap: 4px; border-radius: 4px; }
.recent li:hover { background: var(--hover); }
.recent li .icon-btn { visibility: hidden; }
.recent li:hover .icon-btn, .recent li:focus-within .icon-btn { visibility: visible; }
.recent-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 8px; border: 0; background: transparent; cursor: pointer; text-align: left; }
.recent-open > .grow { display: flex; flex-direction: column; }
.recent-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.paste-area { width: 100%; min-height: 120px; resize: vertical; padding: 8px 10px; border-radius: 4px; border: 1px solid var(--input-border); background: var(--input-bg); font-size: 12px; line-height: 1.5; }
.row-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 10px; flex-wrap: wrap; }
.row-actions > .muted { margin-right: auto; }
.tips { display: flex; flex-direction: column; gap: 6px; font-size: 12px; padding: 0 4px; }
.tips > div { display: flex; gap: 8px; align-items: flex-start; }
.tips .codicon { font-size: 14px; margin-top: 1px; color: var(--warning); }

/* Viewer */
.viewer { display: flex; flex-direction: column; height: 100vh; }
.toolbar { display: flex; align-items: center; gap: 12px; padding: 6px 10px; border-bottom: 1px solid var(--hairline); background: var(--surface); flex-wrap: wrap; min-height: 41px; }
.file-meta { min-width: 0; flex: 1 1 200px; }
.file-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.file-icon { color: var(--success); align-self: center; }
.file-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-title .muted { white-space: nowrap; }
.tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.search { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 2px 0 8px; border-radius: 4px; border: 1px solid var(--input-border); background: var(--input-bg); }
.search:focus-within { border-color: var(--focus); }
.search > .codicon { font-size: 14px; color: var(--muted); }
.search-input { width: 180px; border: 0; background: transparent; outline: none; height: 26px; }
.search .scope { border: 0; border-left: 1px solid var(--hairline); border-radius: 0; height: 22px; max-width: 150px; background: transparent; }
.match-count { white-space: nowrap; }
.banner { display: flex; flex-direction: column; gap: 2px; padding: 6px 12px; font-size: 12px; background: color-mix(in srgb, var(--warning) 12%, var(--bg)); border-bottom: 1px solid var(--hairline); }
.banner > div { display: flex; gap: 8px; align-items: center; }
.banner .codicon { font-size: 14px; color: var(--warning); }

/* Editing */
.editbar { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-bottom: 1px solid var(--hairline); background: color-mix(in srgb, var(--focus) 8%, var(--surface)); flex-wrap: wrap; }
.editbar .btn { height: 26px; padding: 0 9px; }
.editbar .btn:disabled .codicon { opacity: .6; }
.editbar .sep { width: 1px; height: 18px; background: var(--hairline); margin: 0 4px; }
.edit-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; color: var(--focus); margin-right: 4px; }
.edit-badge .codicon { font-size: 14px; }
.edit-badge.dirty { color: var(--warning); }
.edit-badge.dirty::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--warning); }
.edit-hint { flex: 1; min-width: 0; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn.edit-toggle:not(.primary):not(:disabled) { border-color: color-mix(in srgb, var(--focus) 55%, transparent); }
.btn.edit-toggle:not(.primary):not(:disabled) .codicon { color: var(--focus); }
.legend { display: inline-flex; align-items: center; gap: 4px; margin-right: 10px; }
.legend .codicon { font-size: 12px; }
.legend-edit .codicon { color: var(--focus); }
.legend-locked .codicon { color: var(--warning); }
.legend-changed i { display: inline-block; width: 3px; height: 12px; border-radius: 1px; background: var(--warning); }
.editor-chip { position: fixed; z-index: 51; display: flex; align-items: center; gap: 6px; max-width: calc(100vw - 8px); padding: 2px 8px; border: 1px solid var(--focus); border-bottom: 0; border-radius: 4px 4px 0 0; background: var(--vscode-editorWidget-background, var(--surface-2)); color: var(--muted); font-size: 11px; white-space: nowrap; pointer-events: none; }
.editor-chip .codicon { font-size: 12px; color: var(--focus); }
.editor-chip b { color: var(--text); font-weight: 600; }

/* Editable and read-only cells: cursor, hover, and a pencil or lock on the cell under the pointer */
.rn, .corner { cursor: pointer; }
.corner::before { content: "\\ea75"; font: 13px/1 codicon; position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); opacity: .7; }
body.editing .corner::before { content: "\\ea73"; color: var(--focus); opacity: 1; }
body.editing .head { border-bottom-color: color-mix(in srgb, var(--focus) 60%, transparent); }
body.editing .cell { cursor: text; }
body.editing .cell:not(.ro):hover { background-color: color-mix(in srgb, var(--focus) 9%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--focus) 50%, transparent); }
body.editing .cell:not(.ro):hover::before, body.editing .cell.active:not(.ro)::before,
body.editing .cell.ro:hover::before, body.editing .cell.ro.active::before {
  content: "\\ea73"; font: 12px/1 codicon; position: absolute; right: 3px; top: 50%; transform: translateY(-50%); padding: 2px; border-radius: 3px;
  background: var(--bg); color: var(--focus); pointer-events: none; z-index: 1;
}
body.editing .cell.ro:hover::before, body.editing .cell.ro.active::before { content: "\\ea75"; color: var(--warning); }
/* Right-aligned numbers move left of the pencil instead of hiding under it */
body.editing .cell.num:hover, body.editing .cell.num.active { padding-right: 24px; }
body.editing .cell.active:not(.ro) { box-shadow: inset 0 0 0 2px var(--focus), inset 0 0 0 3px color-mix(in srgb, var(--focus) 30%, transparent); }
body.editing .cell.ro { cursor: not-allowed; color: var(--muted); background-image: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--text) 6%, transparent) 5px 6px); }
body.editing .cell.ro.active { box-shadow: none; outline: 2px dashed color-mix(in srgb, var(--warning) 80%, transparent); outline-offset: -2px; }
.cell.changed { background-image: linear-gradient(90deg, var(--warning) 0 3px, transparent 3px); }
.cell.refused { animation: refuse .32s var(--ease); }
@keyframes refuse { 20%, 60% { transform: translateX(-3px); } 40%, 80% { transform: translateX(3px); } }
body.editing .hcell.renamable .name { cursor: text; border-radius: 3px; margin: 0 -3px; padding: 0 3px; }
body.editing .hcell.renamable:hover .name { background: color-mix(in srgb, var(--focus) 14%, transparent); }
body.editing .hcell.renamable:hover .name::after { content: " \\ea73"; font: 11px/1 codicon; color: var(--focus); }
body.editing .hcell.ro .name { color: var(--muted); }
.hcell.changed { background-image: linear-gradient(0deg, var(--warning) 0 2px, transparent 2px); }

/* What the active cell allows, in the status bar */
.access { display: inline-flex; align-items: center; gap: 4px; flex: none; padding: 1px 8px; border: 1px solid transparent; border-radius: 10px; font: inherit; font-size: 11px; white-space: nowrap; }
.access .codicon { font-size: 12px; }
.access.ok { color: var(--success); background: color-mix(in srgb, var(--success) 14%, transparent); }
.access.locked { color: var(--warning); background: color-mix(in srgb, var(--warning) 14%, transparent); }
.access.view, .access.file, .access.sheet { color: var(--muted); background: var(--surface-3); }
button.access.view { cursor: pointer; }
button.access.view:hover { color: var(--text); border-color: var(--focus); }
.access-action { color: var(--accent); }

/* The card that explains a refused edit, under the cell */
.cell-hint { position: fixed; z-index: 65; max-width: 320px; padding: 10px 12px; border-radius: 6px; background: var(--vscode-editorWidget-background, var(--surface-2)); border: 1px solid var(--hairline); box-shadow: 0 6px 24px var(--vscode-widget-shadow, rgba(0,0,0,.35)); font-size: 12px; animation: pop .14s var(--ease); }
.cell-hint-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.cell-hint-head .codicon { font-size: 14px; color: var(--warning); }
.cell-hint-text { color: var(--muted); line-height: 1.45; }
.cell-hint-actions { display: flex; gap: 6px; margin-top: 8px; }
.cell-hint .btn { height: 24px; padding: 0 8px; font-size: 12px; }
/* The cell editor: the cell's own font and text position, so nothing jumps when editing starts, and a steady caret */
.cell-editor { position: fixed; z-index: 50; margin: 0; padding: 0 5px; border: 2px solid var(--focus); border-radius: 0; background: var(--input-bg); color: var(--input-fg); font-family: var(--font); font-size: 13px; line-height: 20px; resize: none; overflow: hidden; outline: none; box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0,0,0,.35)); white-space: pre-wrap; overflow-wrap: anywhere; caret-color: var(--input-fg); }
.cell-editor::selection { background: var(--vscode-editor-selectionBackground, color-mix(in srgb, var(--focus) 40%, transparent)); }
.cell-editor.head-editor { font-weight: 600; background: var(--vscode-editorWidget-background, var(--surface-2)); }
.cell-editor.head-editor::placeholder { color: var(--muted); font-weight: 400; }
.cell-editor.invalid { border-color: var(--danger); }
.editor-error { position: fixed; z-index: 52; padding: 6px 9px; border: 1px solid var(--danger); border-top: 0; border-radius: 0 0 4px 4px; background: color-mix(in srgb, var(--danger) 18%, var(--bg)); color: var(--text); font-size: 12px; line-height: 1.4; }
.editor-chip .chip-mode { padding: 0 5px; border-radius: 3px; background: color-mix(in srgb, var(--focus) 18%, transparent); color: var(--text); }
.editor-chip .chip-keys { overflow: hidden; text-overflow: ellipsis; }

/* Grid */
.grid { position: relative; flex: 1; min-height: 0; }
.scroller { position: absolute; inset: 0; overflow: auto; outline: none; }
.scroller.busy { pointer-events: none; opacity: .55; transition: opacity .15s .15s; }
.scroller:focus-visible { box-shadow: inset 0 0 0 1px var(--focus); }
.sizer { position: relative; }
.head { position: sticky; top: 0; z-index: 3; background: var(--surface-2); border-bottom: 1px solid var(--hairline); }
.corner { position: sticky; left: 0; z-index: 4; background: var(--surface-2); border-right: 1px solid var(--hairline); cursor: pointer; }
.corner:hover { background: var(--surface-3); }
.hcell { position: absolute; top: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 18px 0 8px; border-right: 1px solid var(--gridline); cursor: pointer; user-select: none; overflow: hidden; }
.hcell:hover { background: var(--surface-3); }
.hcell.sel { background: var(--sel-head); }
.hcell.active { box-shadow: inset 0 0 0 2px var(--focus); background: var(--sel-head); z-index: 1; }
.hcell.active .name { color: var(--text); }
.hcell .letter { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--muted); letter-spacing: .02em; }
.hcell .kind { font-size: 9.5px; padding: 0 4px; border-radius: 3px; background: var(--surface-3); font-family: var(--mono); }
.hcell .kind-number { color: var(--num); }
.hcell .kind-bool { color: var(--bool); }
.hcell .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hcell .sort { position: absolute; right: 6px; top: 50%; margin-top: -7px; font-size: 13px; color: var(--accent); }
.grip { position: absolute; right: -3px; top: 0; bottom: 0; width: 7px; cursor: col-resize; z-index: 2; }
.grip:hover, .grip.dragging { background: var(--focus); }
.body { position: absolute; left: 0; }
.row { position: absolute; left: 0; height: 24px; }
.row.odd { background: color-mix(in srgb, var(--text) 2.5%, transparent); }
.row:hover { background: var(--hover); }
.row.current { background: color-mix(in srgb, var(--focus) 7%, transparent); }
.row.current > .rn { color: var(--text); font-weight: 600; box-shadow: inset -2px 0 0 var(--focus); }
.rn { position: sticky; left: 0; z-index: 2; height: 24px; line-height: 24px; padding-right: 8px; text-align: right; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; background: var(--surface-2); border-right: 1px solid var(--hairline); border-bottom: 1px solid var(--gridline); cursor: pointer; user-select: none; }
.rn.sel { background: var(--sel-head); color: var(--text); }
.cell { position: absolute; top: 0; height: 24px; line-height: 23px; padding: 0 7px; white-space: pre; overflow: hidden; text-overflow: ellipsis; border-right: 1px solid var(--gridline); border-bottom: 1px solid var(--gridline); cursor: cell; user-select: none; }
.cell.num { text-align: right; font-variant-numeric: tabular-nums; }
.cell.bool { color: var(--bool); font-size: 12px; text-align: center; }
.cell.err { color: var(--danger); }
.cell.formula::after { content: ""; position: absolute; left: 0; top: 0; border-top: 5px solid var(--success); border-right: 5px solid transparent; opacity: .7; }
.cell.pending { color: var(--muted); font-style: italic; }
.cell.in-sel { background: var(--sel-fill); }
.cell.active { box-shadow: inset 0 0 0 2px var(--focus); z-index: 1; }
.cell mark { background: var(--mark); color: inherit; border-radius: 2px; }
.grid-empty { position: absolute; inset: 60px 16px auto; display: flex; justify-content: center; pointer-events: none; }
.grid-empty .card { pointer-events: auto; }
.empty-note { display: flex; gap: 8px; align-items: center; }
.loading { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 6; display: flex; gap: 8px; align-items: center; padding: 8px 14px; border-radius: 6px; background: var(--vscode-editorWidget-background, var(--surface-2)); border: 1px solid var(--hairline); box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0,0,0,.3)); font-size: 12.5px; }

/* Sheet tabs and status bar */
.tabs { display: flex; gap: 2px; padding: 0 8px; border-top: 1px solid var(--hairline); background: var(--surface); overflow-x: auto; flex: none; scrollbar-width: thin; }
.tab { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent; background: transparent; cursor: pointer; white-space: nowrap; color: var(--muted); font-size: 12.5px; }
.tab:hover { color: var(--text); background: var(--hover); }
.tab.active { color: var(--text); border-bottom-color: var(--success); font-weight: 600; background: var(--bg); }
.tab.hidden-sheet { font-style: italic; }
.tab .codicon { font-size: 13px; }
.status { display: flex; align-items: center; gap: 16px; padding: 0 12px; height: 28px; flex: none; border-top: 1px solid var(--hairline); background: var(--surface-2); font-size: 12px; overflow: hidden; white-space: nowrap; }
.status-cell { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1 1 30%; overflow: hidden; }
.status-cell .addr { font-weight: 600; padding: 1px 6px; border-radius: 3px; background: var(--surface-3); }
.status-cell .fx { color: var(--success); overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
.status-cell .fx i { font-style: italic; font-weight: 600; margin-right: 2px; }
.status-cell .value { overflow: hidden; text-overflow: ellipsis; }
.status-stats { display: flex; gap: 12px; align-items: center; overflow: hidden; flex: 0 1 auto; }
.stat-col { font-weight: 600; }
.status-size { flex: none; margin-left: auto; }

/* Menus, dialogs, toasts */
.menu { position: fixed; z-index: 70; min-width: 220px; padding: 4px; border-radius: 6px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--surface-2))); color: var(--vscode-menu-foreground, var(--text)); border: 1px solid var(--vscode-menu-border, var(--hairline)); box-shadow: 0 6px 24px var(--vscode-widget-shadow, rgba(0,0,0,.35)); animation: pop .12s var(--ease); }
.menu-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 26px; padding: 0 8px; border: 0; border-radius: 4px; background: transparent; cursor: pointer; text-align: left; font-size: 12.5px; }
.menu-item .codicon { font-size: 14px; }
.menu-item:hover:not(:disabled), .menu-item:focus { background: var(--vscode-menu-selectionBackground, var(--hover)); color: var(--vscode-menu-selectionForeground, inherit); outline: none; }
.menu-item:disabled { opacity: .45; cursor: default; }
.menu-sep { height: 1px; margin: 4px 6px; background: var(--hairline); }
.overlay { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, .35); animation: fade .12s; }
.dialog { width: min(640px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 8px; background: var(--vscode-editorWidget-background, var(--surface-2)); border: 1px solid var(--hairline); box-shadow: 0 10px 40px var(--vscode-widget-shadow, rgba(0,0,0,.4)); }
.dialog-head { display: flex; align-items: center; gap: 10px; }
.dialog-head .addr { font-weight: 600; padding: 1px 6px; border-radius: 3px; background: var(--surface-3); }
.dialog-row { display: grid; grid-template-columns: 80px 1fr; gap: 8px; font-size: 12.5px; }
.dialog-row code { white-space: pre-wrap; word-break: break-all; }
.dialog-value { margin: 0; padding: 10px; border-radius: 4px; background: var(--input-bg); border: 1px solid var(--input-border); white-space: pre-wrap; word-break: break-word; overflow: auto; max-height: 50vh; font-size: 12.5px; }
.toasts { position: fixed; right: 16px; bottom: 40px; z-index: 80; display: flex; flex-direction: column; gap: 8px; pointer-events: none; max-width: min(420px, calc(100vw - 32px)); }
.toast { pointer-events: auto; display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: 6px; font-size: 12.5px; line-height: 1.4; background: var(--vscode-notifications-background, var(--surface-2)); color: var(--vscode-notifications-foreground, var(--text)); border: 1px solid var(--vscode-notifications-border, var(--hairline)); box-shadow: 0 6px 20px rgba(0,0,0,.35); animation: pop .16s var(--ease); }
.toast .codicon { font-size: 15px; margin-top: 1px; }
.toast.success .codicon { color: var(--success); }
.toast.error .codicon { color: var(--danger); }
.toast.info .codicon { color: var(--accent); }
.toast .hint { display: block; color: var(--muted); font-size: 11.5px; margin-top: 2px; }
.toast.out { opacity: 0; transform: translateY(6px); transition: all .2s; }
@keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.98); } }
@keyframes fade { from { opacity: 0; } }

@media (max-width: 720px) {
  .search-input { width: 120px; }
  .status-stats { display: none; }
  .edit-hint { display: none; }
}
/* Narrow sidebars: the edit bar wraps (its buttons keep their labels) and the editor label is short */
@media (max-width: 480px) {
  .editor-chip .chip-keys { display: none; }
  .editbar .btn { padding: 0 7px; }
  .editbar .sep { display: none; }
  .toolbar { gap: 6px; }
  .search-input { width: 90px; }
}
`;
