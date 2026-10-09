"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderToolPage = void 0;
const webview_ui_1 = require("../utils/webview-ui");
const tool_hub_1 = require("../utils/tool-hub");
/** The HTML shell of a tool panel. media/toolkit.js renders everything inside it. */
function renderToolPage(o) {
    const data = {
        tool: o.tool,
        section: o.section,
        examples: o.examples,
        initial: o.initial,
        mac: o.platform === "darwin",
        icons: { tool: tool_hub_1.HUB_ICONS[o.tool.icon] ?? tool_hub_1.HUB_ICONS.code, ...UI_ICONS }
    };
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${o.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${(0, webview_ui_1.escapeHtml)(o.tool.title)}</title>
<style>${webview_ui_1.THEME_TOKENS}${TOOLKIT_CSS}</style>
</head>
<body>
<div id="app" class="app" aria-busy="true"></div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="tool-data">${(0, webview_ui_1.embedJson)(data)}</script>
<script src="${(0, webview_ui_1.escapeHtml)(o.scriptUri)}"></script>
</body>
</html>`;
}
exports.renderToolPage = renderToolPage;
const UI_ICONS = {
    play: '<path d="M7 4v16l13-8z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    insert: '<path d="M12 5v10M8 11l4 4 4-4M5 19h14"/>',
    open: '<path d="M14 3h7v7M10 14L21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    editor: '<path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M4 13l3 3-3 3M9 19h3"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5h.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>'
};
const TOOLKIT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
:root {
  --card-bg: color-mix(in srgb, var(--text) 3%, var(--bg));
  --card-line: color-mix(in srgb, var(--text) 12%, transparent);
  --soft: color-mix(in srgb, var(--text) 6%, transparent);
  --ease: cubic-bezier(.2, .7, .3, 1);
  --ok: var(--vscode-testing-iconPassed, #3fb950);
  --warnc: var(--vscode-editorWarning-foreground, #cca700);
  --err: var(--vscode-errorForeground, #f14c4c);
  --infoc: var(--vscode-editorInfo-foreground, #3794ff);
}
svg.i { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
.app { max-width: 1400px; margin: 0 auto; padding: 22px 26px 60px; }

/* Header */
.head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; }
.head-icon { flex: none; width: 42px; height: 42px; border-radius: 10px; display: grid; place-items: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 26%, transparent); }
.head-icon svg { width: 22px; height: 22px; }
.crumb { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }
.head h1 { margin: 2px 0 4px; font-size: 18px; font-weight: 650; letter-spacing: -.01em; }
.summary { margin: 0; color: var(--muted); max-width: 820px; }
.badges { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--soft); color: var(--muted); }
.badge svg.i { width: 12px; height: 12px; }
.badge.net { color: var(--warnc); background: color-mix(in srgb, var(--warnc) 12%, transparent); }
details.guide { margin: 0 0 16px; max-width: 900px; border: 1px solid var(--card-line); border-radius: 8px; background: var(--card-bg); }
details.guide summary { cursor: pointer; padding: 8px 12px; color: var(--muted); font-size: 12px; list-style: none; display: flex; align-items: center; gap: 6px; }
details.guide summary::-webkit-details-marker { display: none; }
details.guide summary svg.i { width: 14px; height: 14px; transition: transform .15s var(--ease); }
details.guide[open] summary svg.i { transform: rotate(90deg); }
details.guide p { margin: 0; padding: 0 12px 12px 32px; color: var(--text); white-space: pre-wrap; }

/* Layout: form beside results on wide panels */
.layout { display: grid; grid-template-columns: 1fr; gap: 18px; align-items: start; }
@media (min-width: 1080px) { .layout.split { grid-template-columns: minmax(380px, 5fr) 7fr; } .layout.split .results { position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow: auto; } }
.panel { background: var(--card-bg); border: 1px solid var(--card-line); border-radius: 10px; }

/* Form */
.form { padding: 16px; }
.toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.toolbar .grow { flex: 1; }
.fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 12px 14px; }
.group-heading { grid-column: 1 / -1; margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--card-line); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.group-heading[hidden] { display: none; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; grid-column: 1 / -1; }
.field.narrow { grid-column: auto; }
.field.narrow.span2 { grid-column: span 2; }
.field[hidden] { display: none; }
.label-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
label.lbl { font-size: 12px; font-weight: 600; color: var(--text); }
label.lbl .req { color: var(--err); margin-left: 2px; }
.help { font-size: 11.5px; color: var(--muted); }
input[type=text], input[type=password], input[type=number], select, textarea {
  width: 100%; font: inherit; color: var(--vscode-input-foreground, var(--text));
  background: var(--vscode-input-background, var(--panel-2));
  border: 1px solid var(--vscode-input-border, var(--card-line)); border-radius: 6px;
  padding: 6px 9px; min-height: 30px;
}
textarea { resize: vertical; line-height: 1.5; }
textarea.code { font-family: var(--mono); font-size: 12.5px; tab-size: 2; white-space: pre; }
select { padding-right: 24px; }
input:focus, select:focus, textarea:focus { outline: 1px solid var(--focus); outline-offset: -1px; border-color: var(--focus); }
input.invalid, textarea.invalid { border-color: var(--err); }
.toggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12.5px; min-height: 30px; user-select: none; }
.toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.switch { width: 30px; height: 17px; border-radius: 999px; background: var(--card-line); position: relative; transition: background .15s var(--ease); flex: none; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--vscode-editor-background, #fff); box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .15s var(--ease); }
.toggle input:checked + .switch { background: var(--accent-strong); }
.toggle input:checked + .switch::after { transform: translateX(13px); }
.toggle input:focus-visible + .switch { outline: 2px solid var(--focus); outline-offset: 2px; }
.run-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
.hint { color: var(--muted); font-size: 11.5px; }
kbd { font-family: var(--mono); font-size: 10.5px; padding: 1px 5px; border: 1px solid var(--card-line); border-radius: 4px; }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 6px; border: 1px solid transparent; font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; white-space: nowrap; background: var(--accent-strong); color: var(--accent-fg); }
.btn:hover { background: var(--vscode-button-hoverBackground, var(--accent-strong)); }
.btn.secondary { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--text)); border-color: var(--card-line); }
.btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--soft)); }
.btn.ghost { background: transparent; color: var(--muted); height: 24px; padding: 0 7px; font-size: 11.5px; border-radius: 5px; }
.btn.ghost:hover { background: var(--soft); color: var(--text); }
.btn.ghost svg.i { width: 13px; height: 13px; }
.btn:disabled { opacity: .55; cursor: default; }
.btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.spinner { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Results */
.results { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.results.stale > * { opacity: .55; transition: opacity .2s; }
.empty { padding: 36px 20px; text-align: center; color: var(--muted); border: 1px dashed var(--card-line); border-radius: 10px; }
.empty svg.i { width: 26px; height: 26px; opacity: .7; margin-bottom: 8px; }
.empty .t { font-weight: 600; color: var(--text); margin-bottom: 4px; }
.status { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--muted); min-height: 16px; }
.stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.stat { padding: 10px 12px; border-radius: 8px; background: var(--card-bg); border: 1px solid var(--card-line); border-left: 3px solid var(--card-line); min-width: 0; }
.stat .v { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.stat .l { font-size: 11px; color: var(--muted); margin-top: 2px; }
.stat.good { border-left-color: var(--ok); } .stat.warn { border-left-color: var(--warnc); } .stat.bad { border-left-color: var(--err); }
.stat.wide { grid-column: 1 / -1; } .stat.wide .v { font-size: 13.5px; font-weight: 600; }
.msgs { display: flex; flex-direction: column; gap: 6px; }
.msg { display: flex; gap: 9px; align-items: flex-start; padding: 8px 11px; border-radius: 8px; font-size: 12.5px; background: var(--soft); overflow-wrap: anywhere; }
.msg svg.i { margin-top: 1px; }
.msg.success { background: color-mix(in srgb, var(--ok) 11%, transparent); } .msg.success svg.i { color: var(--ok); }
.msg.warning { background: color-mix(in srgb, var(--warnc) 11%, transparent); } .msg.warning svg.i { color: var(--warnc); }
.msg.error { background: color-mix(in srgb, var(--err) 11%, transparent); } .msg.error svg.i { color: var(--err); }
.msg.info svg.i { color: var(--infoc); }
.more { align-self: flex-start; }
.out { overflow: hidden; }
.out-head { display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 12px; border-bottom: 1px solid var(--card-line); min-height: 38px; }
.out-title { font-weight: 600; font-size: 12.5px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.out-title .sub { font-weight: 400; color: var(--muted); margin-left: 6px; font-family: var(--mono); font-size: 11.5px; }
.out-actions { display: flex; gap: 2px; flex-wrap: wrap; justify-content: flex-end; }
pre.code { margin: 0; padding: 12px 14px; font-family: var(--mono); font-size: 12.5px; line-height: 1.55; overflow: auto; max-height: 520px; white-space: pre; tab-size: 2; background: var(--vscode-textCodeBlock-background, transparent); }
.textout { padding: 12px 14px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 520px; overflow: auto; }
.truncated { padding: 6px 14px; font-size: 11.5px; color: var(--muted); border-top: 1px solid var(--card-line); }
.tablewrap { overflow: auto; max-height: 520px; }
table { border-collapse: collapse; width: 100%; font-size: 12.5px; }
th, td { text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--card-line); vertical-align: top; }
th { position: sticky; top: 0; background: var(--card-bg); font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
td { overflow-wrap: anywhere; max-width: 520px; white-space: pre-wrap; }
td.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
tr:hover td { background: var(--soft); }
.files { display: flex; flex-direction: column; }
.file { border-bottom: 1px solid var(--card-line); }
.file:last-child { border-bottom: 0; }
.file summary { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; cursor: pointer; list-style: none; }
.file summary::-webkit-details-marker { display: none; }
.file summary .chev { transition: transform .15s var(--ease); color: var(--muted); }
.file[open] summary .chev { transform: rotate(90deg); }
.file .path { font-family: var(--mono); font-size: 12px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file .meta { color: var(--muted); font-size: 11px; }
.file pre.code { border-top: 1px solid var(--card-line); max-height: 420px; }
.chart { padding: 10px 12px 12px; }
.chart svg { width: 100%; height: 260px; display: block; }
.chart .axis { stroke: var(--card-line); }
.chart .grid { stroke: var(--card-line); stroke-dasharray: 2 4; }
.chart text { fill: var(--muted); font-size: 10.5px; font-family: var(--font); }
.chart .line { fill: none; stroke: var(--accent); stroke-width: 2; }
.chart .area { fill: color-mix(in srgb, var(--accent) 12%, transparent); stroke: none; }

/* Toast */
.toast { position: fixed; bottom: 16px; left: 50%; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; padding: 8px 14px; border-radius: 8px; font-size: 12.5px; background: var(--vscode-notifications-background, var(--panel)); color: var(--vscode-notifications-foreground, var(--text)); border: 1px solid var(--card-line); box-shadow: 0 6px 20px rgba(0,0,0,.25); transition: opacity .2s var(--ease), transform .2s var(--ease); max-width: 90vw; z-index: 10; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.error { border-color: var(--err); } .toast.warning { border-color: var(--warnc); } .toast.success { border-color: var(--ok); }

@media (max-width: 640px) {
  .app { padding: 14px 12px 40px; }
  .fields { grid-template-columns: 1fr 1fr; }
  .head h1 { font-size: 16px; }
  .head-icon { width: 36px; height: 36px; }
}
body.vscode-high-contrast .panel, body.vscode-high-contrast .stat { border-color: var(--vscode-contrastBorder, currentColor); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;
//# sourceMappingURL=page.js.map