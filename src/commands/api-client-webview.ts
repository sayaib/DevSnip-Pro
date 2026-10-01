/**
 * Styles, markup and the request-builder script for the REST API Client webview.
 *
 * `getWebviewContent` in api-test.ts stitches these together with the premium
 * tool browser. Every colour comes from a VS Code theme variable (with a
 * fallback), so the panel follows dark, light and high-contrast themes.
 *
 * The scripts are written with String.raw so backslashes in regular
 * expressions reach the browser unchanged. They must not contain backticks or
 * a dollar sign directly followed by an opening brace.
 */

/** 16x16 stroke icons, drawn with currentColor. */
const ICON_PATHS: Record<string, string> = {
  plus: "M8 3v10M3 8h10",
  close: "M4 4l8 8M12 4l-8 8",
  save: "M3 2.5h8l2.5 2.5v8.5h-10.5z M5.5 2.5v3.5h4.5v-3.5 M5 13.5v-4h6v4",
  copy: "M5.5 5.5h7v7h-7z M3.5 10.5v-7h7",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  send: "M2.5 8h9M8 4l4 4-4 4",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.5 10.5l3 3",
  cookie: "M8 2a6 6 0 1 0 6 6 2 2 0 0 1-2.5-2.5A2 2 0 0 1 8 2z M6 7h.01M9.5 10h.01M5.5 10.5h.01",
  keyboard: "M1.5 4.5h13v7h-13z M4.5 9.5h7 M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9",
  eye: "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z M8 9.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z",
  download: "M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10",
  wrap: "M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H8.5M10 10.5L8.5 12 10 13.5M2.5 12h3",
  up: "M4 10l4-4 4 4",
  down: "M4 6l4 4 4-4",
  menu: "M2.5 4h11M2.5 8h11M2.5 12h11",
  edit: "M10.5 2.5l3 3-8 8h-3v-3z",
  terminal: "M2.5 3.5h11v9h-11z M5 6.5l2 1.5-2 1.5 M8.5 10h2.5",
  alert: "M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.5h.01",
  globe: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M2 8h12 M8 2c2 2 2 10 0 12 M8 2c-2 2-2 10 0 12",
  retry: "M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3",
  check: "M3 8.5l3 3 7-7",
  stop: "M4.5 4.5h7v7h-7z"
};

function ic(name: string, extraClass = ""): string {
  const cls = extraClass ? `ic ${extraClass}` : "ic";
  return `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"/></svg>`;
}

export const API_CLIENT_STYLES = `
:root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --bg-raised: var(--vscode-sideBar-background, var(--vscode-editor-background, #252526));
    --bg-sunken: var(--vscode-input-background, rgba(127,127,127,0.10));
    --bg-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.12));
    --bg-active: var(--vscode-list-activeSelectionBackground, rgba(127,127,127,0.20));
    --fg-0: var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc));
    --fg-1: var(--vscode-foreground, #cccccc);
    --fg-2: var(--vscode-descriptionForeground, rgba(127,127,127,0.95));
    --border: var(--vscode-panel-border, var(--vscode-input-border, rgba(127,127,127,0.30)));
    --border-strong: var(--vscode-contrastBorder, var(--vscode-panel-border, rgba(127,127,127,0.45)));
    --primary: var(--vscode-button-background, #0e639c);
    --primary-fg: var(--vscode-button-foreground, #ffffff);
    --primary-hover: var(--vscode-button-hoverBackground, #1177bb);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --focus: var(--vscode-focusBorder, #007fd4);
    --success: var(--vscode-testing-iconPassed, #3fb950);
    --warning: var(--vscode-editorWarning-foreground, #cca700);
    --error: var(--vscode-errorForeground, #f14c4c);
    --m-get: var(--vscode-charts-green, var(--success));
    --m-post: var(--vscode-charts-yellow, var(--warning));
    --m-put: var(--vscode-charts-blue, var(--accent));
    --m-patch: var(--vscode-charts-purple, var(--accent));
    --m-delete: var(--vscode-charts-red, var(--error));
    --m-other: var(--fg-2);
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    --font-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    --radius: 5px;
    --radius-lg: 8px;
    --sidebar-w: 240px;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
    margin: 0;
    background: var(--bg);
    color: var(--fg-0);
    font-family: var(--font);
    font-size: 13px;
    line-height: 1.5;
    overflow: hidden;
}
button, input, select, textarea { font: inherit; color: inherit; }
[hidden] { display: none !important; }
code { font-family: var(--font-mono); font-size: .95em; }

/* Visible focus everywhere, never removed for looks. */
:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; border-radius: 3px; }
.sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.ic { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ic-dots { stroke-width: 2.6; }
.mono { font-family: var(--font-mono) !important; }
.kbd {
    display: inline-block; min-width: 18px; padding: 0 5px; text-align: center;
    font-family: var(--font-mono); font-size: 10.5px; line-height: 17px;
    border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px;
    background: var(--bg-sunken); color: var(--fg-1);
}

/* Method colours, shared by the selector, tabs and sidebar badges. */
.m-GET { color: var(--m-get); }
.m-POST { color: var(--m-post); }
.m-PUT { color: var(--m-put); }
.m-PATCH { color: var(--m-patch); }
.m-DELETE { color: var(--m-delete); }
.m-HEAD, .m-OPTIONS { color: var(--m-other); }

/* ---------------------------------------------------- shell */
.app {
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
    grid-template-areas: "topbar topbar" "sidebar main";
    height: 100vh;
}
.app.sidebar-collapsed { grid-template-columns: 0 minmax(0, 1fr); }

/* ---------------------------------------------------- topbar */
.topbar {
    grid-area: topbar;
    display: flex; align-items: center; gap: 8px;
    padding: 0 10px; height: 40px;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
}
.topbar-brand { font-weight: 600; font-size: 13px; white-space: nowrap; display: flex; align-items: center; gap: 7px; }
.topbar-brand .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex: none; }
.topbar-spacer { flex: 1 1 auto; min-width: 8px; }
.topbar-env {
    display: flex; align-items: center; gap: 4px; min-width: 0;
    padding: 0 2px 0 8px; height: 28px;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-sunken);
}
.topbar-env > .ic { color: var(--fg-2); }
.env-select {
    border: 0 !important; background: transparent !important; padding: 0 4px !important;
    min-width: 120px; max-width: 200px; height: 24px; cursor: pointer;
}
.topbar-env.active > .ic { color: var(--success); }
.topbar-actions { display: flex; align-items: center; gap: 2px; }
.icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 26px; padding: 0;
    border: 1px solid transparent; border-radius: var(--radius);
    background: transparent; color: var(--fg-1); cursor: pointer; font-size: 13px;
}
.icon-btn:hover { background: var(--bg-hover); border-color: var(--border); }
.icon-btn[aria-pressed="true"] { color: var(--accent); }
.points-badge {
    display: inline-flex; align-items: center; gap: 5px; flex: none;
    padding: 3px 9px; margin-left: 4px; border-radius: 999px;
    border: 1px solid var(--accent); background: transparent; color: var(--accent);
    font: inherit; font-size: 11px; font-weight: 700; cursor: pointer;
}
.points-badge .unit { font-weight: 600; opacity: .8; }
.points-badge:hover { border-color: var(--focus); }

/* ---------------------------------------------------- sidebar */
.sidebar {
    grid-area: sidebar;
    background: var(--bg-raised);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column;
    min-width: 0; overflow: hidden;
}
.app.sidebar-collapsed .sidebar { display: none; }
.sidebar-top { padding: 10px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border); }
.sidebar-top .btn { width: 100%; }
.search-wrap { position: relative; display: flex; }
.search-wrap .search-icon { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); color: var(--fg-2); width: 12px; height: 12px; pointer-events: none; }
.search-wrap .input { padding-left: 26px; }
.sidebar-scroll { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; padding-bottom: 12px; }

.nav-section { border-bottom: 1px solid var(--border); }
.nav-section-bar { display: flex; align-items: center; }
.nav-section-bar .nav-section-head { flex: 1 1 auto; min-width: 0; }
.section-actions { display: flex; gap: 1px; padding-right: 6px; }
.nav-section-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 7px 10px; background: transparent; border: 0; cursor: pointer;
    color: var(--fg-2); font: inherit; font-size: 10.5px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase; text-align: left;
}
.nav-section-head:hover { color: var(--fg-0); background: var(--bg-hover); }
.nav-section-head .chev { transition: transform .15s ease; flex: none; font-size: 9px; }
.nav-section[data-collapsed="true"] .chev { transform: rotate(-90deg); }
.nav-section[data-collapsed="true"] .nav-section-body { display: none; }
.nav-section-head .count { margin-left: auto; font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 10px; }
.nav-section-body { padding: 0 6px 8px; }

.nav-item {
    display: flex; align-items: center; gap: 7px; width: 100%;
    padding: 5px 8px; border: 1px solid transparent; border-radius: var(--radius);
    background: transparent; color: var(--fg-1); cursor: pointer;
    font: inherit; font-size: 12px; text-align: left;
}
.nav-item:hover { background: var(--bg-hover); }
.nav-item.active { background: var(--bg-active); color: var(--fg-0); font-weight: 600; }
.nav-item .nav-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-item .lock { flex: none; font-size: 10px; color: var(--fg-2); }
.nav-item .cost-tag, .feature-cost {
    flex: none; font-size: 9.5px; font-weight: 700; letter-spacing: .02em;
    padding: 1px 6px; border-radius: 999px; white-space: nowrap;
    border: 1px solid var(--accent); color: var(--accent);
}
.nav-item .cost-tag.short, .feature-cost.short { border-color: var(--warning); color: var(--warning); }

.nav-group { margin-bottom: 2px; }
.nav-group-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 4px 8px; background: transparent; border: 0; cursor: pointer;
    color: var(--fg-2); font: inherit; font-size: 11px; font-weight: 600; text-align: left;
}
.nav-group-head:hover { color: var(--fg-0); }
.nav-group-head .chev { font-size: 9px; transition: transform .15s ease; flex: none; }
.nav-group[data-collapsed="true"] .chev { transform: rotate(-90deg); }
.nav-group[data-collapsed="true"] .nav-group-body { display: none; }
.nav-group-body { padding-left: 10px; }

.tier-tag {
    flex: none; font-size: 8.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase;
    padding: 1px 5px; border-radius: 3px; border: 1px solid var(--warning); color: var(--warning);
}

/* Sidebar history and collection rows */
.hist-row, .coll-row {
    display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 6px;
    width: 100%; padding: 4px 6px 4px 8px; border: 1px solid transparent; border-radius: var(--radius);
    background: transparent; color: var(--fg-1); cursor: pointer; font: inherit; font-size: 11.5px; text-align: left;
}
.hist-row:hover, .coll-row:hover { background: var(--bg-hover); }
.coll-row { cursor: default; }
.coll-row.open { background: var(--bg-active); }
.hist-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; }
.coll-name {
    background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hist-meta { font-size: 10px; color: var(--fg-2); white-space: nowrap; display: flex; gap: 6px; }
.hist-meta .ok { color: var(--success); } .hist-meta .warn { color: var(--warning); } .hist-meta .bad { color: var(--error); }
.hist-day { padding: 8px 8px 2px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-2); }
.row-actions { display: flex; gap: 1px; opacity: 0; transition: opacity .1s ease; }
.coll-row:hover .row-actions, .coll-row:focus-within .row-actions { opacity: 1; }
.empty-hint { padding: 10px 10px 4px; color: var(--fg-2); font-size: 11.5px; line-height: 1.6; }

.mini-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    min-width: 22px; height: 22px; padding: 0 3px;
    border: 1px solid transparent; border-radius: 4px;
    background: transparent; color: var(--fg-2); cursor: pointer; font-size: 11px;
}
.mini-btn .ic { width: 13px; height: 13px; }
.mini-btn:hover { background: var(--bg-hover); color: var(--fg-0); border-color: var(--border); }
.mini-btn[aria-pressed="true"] { color: var(--accent); border-color: var(--border); }
.mini-btn.armed { color: var(--error); border-color: var(--error); padding: 0 6px; }

.method-badge {
    display: inline-block; min-width: 40px; text-align: center;
    padding: 0 4px; border-radius: 3px; border: 1px solid currentColor;
    font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .03em; line-height: 15px;
}

/* ---------------------------------------------------- main */
.main { grid-area: main; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.view { display: none; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.view.active { display: flex; }

/* ---------------------------------------------------- request tabs */
.req-tabs-bar {
    display: flex; align-items: stretch; flex: none; height: 34px;
    background: var(--bg-raised); border-bottom: 1px solid var(--border);
}
.req-tabs { display: flex; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.req-tabs::-webkit-scrollbar { display: none; }
.req-tab {
    position: relative; display: flex; align-items: center; flex: none;
    min-width: 120px; max-width: 220px; border-right: 1px solid var(--border); color: var(--fg-2);
}
.req-tab:hover { background: var(--bg-hover); }
.req-tab.active { background: var(--bg); color: var(--fg-0); }
.req-tab.active::after { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--focus); }
.req-tab-main {
    flex: 1 1 auto; min-width: 0; height: 100%; display: flex; align-items: center; gap: 6px;
    padding: 0 2px 0 10px; background: none; border: 0; color: inherit; cursor: pointer; text-align: left; font-size: 12px;
}
.req-tab-method { font-family: var(--font-mono); font-size: 9.5px; font-weight: 700; flex: none; }
.req-tab-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.req-tab-dirty { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-1); flex: none; }
.req-tab-busy { width: 9px; height: 9px; border-width: 1.5px !important; }
.req-tab-close {
    flex: none; width: 20px; height: 20px; margin-right: 5px; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; border-radius: 4px; background: transparent; color: var(--fg-2); cursor: pointer; opacity: 0;
}
.req-tab-close .ic { width: 12px; height: 12px; }
.req-tab:hover .req-tab-close, .req-tab.active .req-tab-close, .req-tab-close:focus-visible { opacity: 1; }
.req-tab-close:hover { background: var(--bg-hover); color: var(--fg-0); }
.new-tab-btn { flex: none; width: 34px; height: 100%; border-radius: 0; }

/* ---------------------------------------------------- request header */
.req-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 14px 0; flex: none; }
.req-title { display: flex; align-items: center; gap: 4px; min-width: 0; flex: 1 1 240px; }
.req-folder { font-size: 12px; color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40%; }
.req-folder:not(:empty)::after { content: ' /'; }
.req-name-input {
    flex: 1 1 auto; min-width: 80px; padding: 3px 6px;
    background: transparent; border: 1px solid transparent; border-radius: var(--radius);
    font-size: 13.5px; font-weight: 600; color: var(--fg-0);
}
.req-name-input:hover { border-color: var(--border); }
.req-name-input:focus { outline: none; border-color: var(--focus); background: var(--bg-sunken); }
.req-name-input::placeholder { color: var(--fg-2); font-weight: 500; }
.dirty-pill { font-size: 10.5px; color: var(--fg-2); white-space: nowrap; }
.req-actions { display: flex; align-items: center; gap: 6px; }

.segmented {
    display: inline-flex; gap: 2px; padding: 2px;
    border: 1px solid var(--border); border-radius: 6px; background: var(--bg-sunken);
}
.seg-btn {
    padding: 2px 10px; border: 0; border-radius: 4px; background: transparent;
    color: var(--fg-2); cursor: pointer; font-size: 11.5px; font-weight: 600; white-space: nowrap;
}
.seg-btn:hover { color: var(--fg-0); }
.seg-btn.active, .seg-btn[aria-pressed="true"] { background: var(--primary); color: var(--primary-fg); }

/* ---------------------------------------------------- menu */
.menu-wrap { position: relative; }
.menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 60; min-width: 230px; padding: 4px;
    background: var(--vscode-menu-background, var(--bg-raised)); color: var(--vscode-menu-foreground, var(--fg-0));
    border: 1px solid var(--border-strong); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
.menu-item {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px;
    border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; text-align: left; font-size: 12px;
}
.menu-item:hover, .menu-item:focus-visible { outline: none; background: var(--vscode-menu-selectionBackground, var(--bg-active)); color: var(--vscode-menu-selectionForeground, inherit); }
.menu-item .kbd { margin-left: auto; }
.menu-sep { height: 1px; margin: 4px 2px; background: var(--border); }

/* ---------------------------------------------------- url bar */
.url-bar { padding: 8px 14px 10px; flex: none; }
.url-row { display: flex; align-items: stretch; gap: 8px; }
.url-group {
    flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-sunken);
}
.url-group:focus-within { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus); }
.url-group.invalid { border-color: var(--error); }
.method-select {
    flex: none; width: 96px; height: 32px; padding: 0 6px 0 10px;
    border: 0; border-right: 1px solid var(--border); border-radius: var(--radius) 0 0 var(--radius);
    background: transparent; cursor: pointer;
    font-family: var(--font-mono); font-size: 12px; font-weight: 700; letter-spacing: .02em;
}
.method-select option { color: var(--fg-0); background: var(--vscode-dropdown-background, var(--bg-raised)); }
.url-input {
    flex: 1 1 auto; min-width: 0; height: 32px; padding: 0 10px;
    border: 0; background: transparent; color: var(--fg-0);
    font-family: var(--font-mono); font-size: 12.5px;
}
.url-input:focus, .url-input:focus-visible { outline: none; }
.send-btn {
    flex: 0 0 auto; min-width: 92px; height: 34px; padding: 0 16px;
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    background: var(--primary); color: var(--primary-fg);
    border: 1px solid transparent; border-radius: var(--radius);
    font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.send-btn:hover:not(:disabled) { background: var(--primary-hover); }
.send-btn:disabled { opacity: .65; cursor: progress; }
.cancel-btn {
    display: none; flex: 0 0 auto; height: 34px; padding: 0 14px; gap: 6px;
    background: transparent; color: var(--error);
    border: 1px solid var(--error); border-radius: var(--radius);
    font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.cancel-btn.visible { display: inline-flex; align-items: center; }
.spinner {
    width: 13px; height: 13px; border: 2px solid currentColor; border-top-color: transparent;
    border-radius: 50%; animation: spin .7s linear infinite; flex: none;
}
.spinner.hidden { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2.4s; } .chev { transition: none !important; } }

.url-hints { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; }
.url-hints:empty, .url-error:empty { display: none; }
.hint-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11.5px; color: var(--fg-2); line-height: 1.5; }
.hint-line .ic { width: 12px; height: 12px; }
.hint-line.error { color: var(--error); }
.hint-line.warn { color: var(--warning); }
.url-preview { font-family: var(--font-mono); color: var(--fg-1); word-break: break-all; }
.var-chip {
    font-family: var(--font-mono); font-size: 11px; padding: 0 7px; line-height: 17px;
    border: 1px solid var(--warning); border-radius: 999px; background: transparent; color: var(--warning); cursor: pointer;
}
.var-chip:hover { background: var(--bg-hover); }
.link-btn { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }

/* ---------------------------------------------------- split workspace */
.workspace {
    flex: 1 1 auto; min-height: 0; display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(110px, var(--split, 50%)) 5px minmax(110px, 1fr);
    border-top: 1px solid var(--border);
}
.workspace.side {
    grid-template-rows: minmax(0, 1fr);
    grid-template-columns: minmax(280px, var(--split, 50%)) 5px minmax(280px, 1fr);
}
.splitter { position: relative; cursor: row-resize; touch-action: none; }
.splitter::before { content: ''; position: absolute; left: 0; right: 0; top: 2px; height: 1px; background: var(--border); }
.workspace.side .splitter { cursor: col-resize; }
.workspace.side .splitter::before { left: 2px; right: auto; top: 0; bottom: 0; width: 1px; height: auto; }
.splitter:hover::before, .splitter.dragging::before, .splitter:focus-visible::before { background: var(--focus); }
.workspace.side .splitter:hover::before, .workspace.side .splitter.dragging::before { width: 2px; }
.splitter:focus-visible { outline: none; }
.pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
.pane-head {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 0 12px; min-height: 34px; border-bottom: 1px solid var(--border); background: var(--bg-raised);
}
.pane-title { font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--fg-2); }
.pane-body { flex: 1 1 auto; min-height: 0; overflow: auto; }

/* ---------------------------------------------------- config tabs */
.config-tabs, .resp-tabs { display: flex; gap: 1px; overflow-x: auto; scrollbar-width: thin; }
.config-tab, .resp-tab {
    position: relative; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px;
    padding: 8px 10px; border: 0; border-bottom: 2px solid transparent;
    background: transparent; color: var(--fg-2); cursor: pointer; font: inherit; font-size: 12px;
}
.config-tab:hover, .resp-tab:hover { color: var(--fg-0); }
.config-tab.active, .resp-tab.active { color: var(--fg-0); border-bottom-color: var(--focus); font-weight: 600; }
.badge {
    display: inline-block; padding: 0 5px; border-radius: 999px; line-height: 15px;
    background: var(--bg-sunken); border: 1px solid var(--border); color: var(--fg-2); font-size: 10px; font-weight: 600;
}
.dot-badge { width: 6px; height: 6px; border-radius: 50%; background: var(--success); display: inline-block; }
.config-content { display: none; padding: 12px 14px 16px; }
.config-content.active { display: block; }
.section-note { margin: 0 0 10px; font-size: 11.5px; color: var(--fg-2); line-height: 1.55; }

/* ---------------------------------------------------- forms */
.form-label { display: block; margin-bottom: 4px; font-size: 11.5px; color: var(--fg-2); }
.input, .select, .textarea {
    width: 100%; padding: 6px 9px;
    background: var(--bg-sunken); color: var(--fg-0);
    border: 1px solid var(--border); border-radius: var(--radius);
    font-family: var(--font); font-size: 12px;
}
.textarea { font-family: var(--font-mono); resize: vertical; min-height: 90px; line-height: 1.55; tab-size: 2; }
.input:focus, .select:focus, .textarea:focus { outline: none; border-color: var(--focus); }
.input.invalid, .textarea.invalid { border-color: var(--error); }
.input::placeholder, .textarea::placeholder { color: var(--fg-2); opacity: .8; }
.form-row { margin-bottom: 12px; }
.field-note { margin-top: 4px; font-size: 11px; color: var(--fg-2); }
.field-note:empty { display: none; }
.field-note.error { color: var(--error); }
.field-note.ok { color: var(--success); }
.check-row { display: flex; align-items: center; gap: 7px; font-size: 12px; margin-bottom: 10px; cursor: pointer; }
.check-row input { accent-color: var(--primary); margin: 0; }
.check-row .sub { color: var(--fg-2); font-size: 11px; }

.btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 6px 12px; border: 1px solid transparent; border-radius: var(--radius);
    background: var(--primary); color: var(--primary-fg);
    font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--primary-hover); }
.btn-ghost { background: transparent; color: var(--fg-1); border-color: var(--border); }
.btn-ghost:hover { background: var(--bg-hover); color: var(--fg-0); }
.btn-danger { background: transparent; color: var(--error); border-color: var(--error); }
.btn-danger:hover, .btn-danger.armed { background: var(--error); color: var(--bg); }
.btn-sm { padding: 4px 9px; font-size: 11.5px; }
.btn-sm .ic { width: 13px; height: 13px; }
.btn:disabled { opacity: .55; cursor: not-allowed; }

/* ---------------------------------------------------- key/value editor */
.kv-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; font-size: 11.5px; color: var(--fg-2); }
.kv-head, .kv-row { display: grid; grid-template-columns: 22px minmax(0,1fr) minmax(0,1.4fr) 26px; gap: 6px; align-items: center; }
.kv-head { padding: 0 2px 4px; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-2); }
.kv-row { margin-bottom: 4px; }
.kv-row.disabled .kv-key, .kv-row.disabled .kv-value { opacity: .5; text-decoration: line-through; }
.kv-row.placeholder .kv-toggle, .kv-row.placeholder .kv-icon { visibility: hidden; }
.kv-list.no-toggle .kv-toggle { visibility: hidden; }
.kv-toggle { width: 14px; height: 14px; margin: 0 auto; accent-color: var(--primary); cursor: pointer; }
.kv-row .input { font-family: var(--font-mono); font-size: 11.5px; padding: 5px 8px; }
.kv-icon {
    width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 1px solid transparent; border-radius: var(--radius);
    color: var(--fg-2); cursor: pointer;
}
.kv-icon .ic { width: 12px; height: 12px; }
.kv-icon:hover { background: var(--bg-hover); color: var(--error); border-color: var(--border); }
.kv-add {
    margin-top: 6px; padding: 5px 11px;
    background: transparent; border: 1px dashed var(--border); border-radius: var(--radius);
    color: var(--fg-1); cursor: pointer; font: inherit; font-size: 11.5px;
}
.kv-add:hover { border-color: var(--focus); color: var(--fg-0); }
.bulk-area { min-height: 160px; }

/* ---------------------------------------------------- body + auth + settings */
.body-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.body-actions { display: flex; gap: 6px; margin-left: auto; }
.code-area { min-height: 200px; }
.body-foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.notice-line {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-bottom: 8px; padding: 6px 10px; font-size: 11.5px;
    border: 1px solid var(--border); border-left: 3px solid var(--warning); border-radius: 4px; color: var(--fg-1);
}
.auth-grid { max-width: 560px; }
.secret-field { display: flex; gap: 4px; align-items: center; }
.auth-preview {
    margin: 4px 0 12px; padding: 7px 10px; font-family: var(--font-mono); font-size: 11.5px; word-break: break-all;
    border: 1px dashed var(--border); border-radius: var(--radius); color: var(--fg-1);
}
.auth-preview::before { content: 'Sends  '; color: var(--fg-2); font-family: var(--font); }
.auth-help { margin: 0 0 10px; font-size: 11.5px; color: var(--fg-2); line-height: 1.6; }
.settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
.settings-card { padding: 10px 12px 2px; border: 1px solid var(--border); border-radius: 6px; }
.settings-card h4 { margin: 0 0 10px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-2); }
.inline-fields { display: flex; gap: 8px; }
.inline-fields .form-row { flex: 1 1 0; min-width: 0; }

/* ---------------------------------------------------- response */
.resp-head { justify-content: space-between; }
.status-strip { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 4px 0; }
.status-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 1px 10px; border-radius: 999px;
    border: 1px solid var(--border); background: var(--bg-sunken);
    font-size: 11.5px; font-weight: 700; white-space: nowrap;
}
/* Status is conveyed by icon and text, not colour alone. */
.status-pill.s2xx { border-color: var(--success); color: var(--success); }
.status-pill.s3xx { border-color: var(--accent); color: var(--accent); }
.status-pill.s4xx { border-color: var(--warning); color: var(--warning); }
.status-pill.s5xx, .status-pill.s0xx { border-color: var(--error); color: var(--error); }
.status-metric { display: inline-flex; align-items: baseline; gap: 5px; font-size: 11.5px; }
.status-metric .label { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.status-metric .value { font-family: var(--font-mono); color: var(--fg-0); }
.resp-hint {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 6px 12px; font-size: 11.5px; color: var(--fg-1);
    border-bottom: 1px solid var(--border); border-left: 3px solid var(--warning);
}
.resp-hint.error { border-left-color: var(--error); }
.resp-hint strong { color: var(--fg-0); }
.resp-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 5px 12px; border-bottom: 1px solid var(--border); }
.kind-chip { font-size: 10.5px; color: var(--fg-2); font-family: var(--font-mono); }
.find-box {
    display: flex; align-items: center; gap: 2px; margin-left: auto; height: 26px; padding: 0 2px 0 7px;
    flex: 0 1 260px; min-width: 150px;
    border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-sunken); color: var(--fg-2);
}
.find-box:focus-within { border-color: var(--focus); }
.find-box input { flex: 1 1 auto; width: 60px; min-width: 0; border: 0; background: transparent; color: var(--fg-0); font-size: 11.5px; outline: none; padding: 0 4px; }
.find-count { min-width: 44px; text-align: right; font-size: 10.5px; }
.response-output {
    margin: 0; padding: 12px 14px;
    font-family: var(--font-mono); font-size: 12px; line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--fg-0); tab-size: 2;
}
.response-output.nowrap { white-space: pre; word-break: normal; }
.response-notice { margin: 0 0 10px; padding: 8px 10px; border: 1px solid var(--border); border-left: 3px solid var(--warning); border-radius: 4px; color: var(--fg-1); font-family: var(--font); font-size: 11.5px; line-height: 1.5; white-space: normal; }
.response-notice + .response-notice, .plain-response + .response-notice { margin: 10px 0 0; }
.plain-response { white-space: pre-wrap; word-break: break-word; }
.response-output mark { background: var(--vscode-editor-findMatchHighlightBackground, rgba(234,92,0,.33)); color: inherit; border-radius: 2px; }
.response-output mark.current { background: var(--vscode-editor-findMatchBackground, rgba(234,92,0,.6)); outline: 1px solid var(--warning); }
.resp-view { display: none; }
.resp-view.active { display: block; }

/* Syntax colours: theme token colours where available. */
.json-key { color: var(--vscode-symbolIcon-propertyForeground, var(--accent)); }
.json-string { color: var(--vscode-debugTokenExpression-string, #ce9178); }
.json-number { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
.json-boolean { color: var(--vscode-debugTokenExpression-boolean, #569cd6); }
.json-null { color: var(--fg-2); }
.xml-tag { color: var(--vscode-debugTokenExpression-name, var(--accent)); }
.xml-attr { color: var(--vscode-symbolIcon-propertyForeground, var(--accent)); }

.resp-table-host { padding: 6px 0; }
.resp-table-tools { display: flex; justify-content: flex-end; padding: 2px 12px 6px; }
.kv-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.kv-table th { text-align: left; padding: 4px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--fg-2); border-bottom: 1px solid var(--border); }
.kv-table td { padding: 5px 12px; border-bottom: 1px solid var(--border); vertical-align: top; font-family: var(--font-mono); word-break: break-all; }
.kv-table td.k { font-weight: 600; white-space: nowrap; width: 1%; color: var(--fg-1); word-break: normal; }
.kv-table td.attrs { color: var(--fg-2); }

/* ---------------------------------------------------- response states */
.empty-state {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 36px 22px; text-align: center; color: var(--fg-2); min-height: 160px;
}
.empty-state .glyph { font-size: 22px; opacity: .8; }
.empty-state h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--fg-0); }
.empty-state p { margin: 0; font-size: 12px; max-width: 46ch; line-height: 1.6; }
.tips { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; text-align: left; font-size: 11.5px; }
.tips li { display: flex; align-items: center; gap: 8px; }
.loading-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 44px 20px; color: var(--fg-2); text-align: center; }
.loading-state .spinner { width: 22px; height: 22px; color: var(--accent); }
.loading-state .target { font-family: var(--font-mono); font-size: 12px; color: var(--fg-1); word-break: break-all; max-width: 60ch; }
.loading-state .elapsed { font-family: var(--font-mono); font-size: 11.5px; }
.state-card {
    max-width: 580px; margin: 24px auto; padding: 16px 18px;
    border: 1px solid var(--border); border-left: 3px solid var(--error);
    border-radius: var(--radius-lg); background: var(--bg-raised);
}
.state-card.neutral { border-left-color: var(--border-strong); }
.state-card h3 { margin: 0 0 6px; display: flex; align-items: center; gap: 8px; font-size: 14px; }
.state-card h3 .ic { width: 16px; height: 16px; color: var(--error); }
.state-card.neutral h3 .ic { color: var(--fg-2); }
.state-card p { margin: 0 0 10px; font-size: 12.5px; color: var(--fg-1); line-height: 1.6; }
.state-card .raw {
    margin: 0 0 12px; padding: 6px 9px; border-radius: 4px; background: var(--bg-sunken);
    font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-2); word-break: break-all; white-space: pre-wrap;
}
.state-card .actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* ---------------------------------------------------- tool view */
.tool-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap;
    padding: 14px; border-bottom: 1px solid var(--border); background: var(--bg-raised);
}
.tool-title { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
.tool-sub { margin: 0; font-size: 12px; color: var(--fg-2); max-width: 64ch; line-height: 1.55; }
.tool-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.tool-actions-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 4px; }
.tool-actions-row .btn { min-width: 104px; justify-content: center; }
.tier-pill {
    font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
    padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-2);
}
.tier-pill.premium { border-color: var(--warning); color: var(--warning); }
.tier-pill.warn { border-color: var(--error); color: var(--error); }
.tool-body { padding: 14px; }
.feature-meta, .feature-desc { font-size: 12px; color: var(--fg-2); line-height: 1.55; }
.feature-desc { margin-bottom: 8px; }
.locked-card {
    max-width: 460px; margin: 26px auto; padding: 22px;
    border: 1px dashed var(--border); border-radius: var(--radius-lg);
    background: var(--bg-raised); text-align: center;
}
.locked-card .glyph { font-size: 22px; }
.locked-card h3 { margin: 8px 0 6px; font-size: 14px; }
.locked-card p { margin: 0 0 8px; font-size: 12px; color: var(--fg-2); line-height: 1.6; }
.locked-card .why { font-size: 11.5px; color: var(--fg-2); margin-bottom: 14px; }
.feature-output {
    margin-top: 12px; padding: 12px;
    background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--radius);
    font-family: var(--font-mono); font-size: 11.5px; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto;
}
.feature-output.error { border-color: var(--error); color: var(--error); }
.feature-table { width: 100%; border-collapse: collapse; font-size: 11.5px; font-family: var(--font); }
.feature-table th, .feature-table td { text-align: left; padding: 6px 9px; border-bottom: 1px solid var(--border); vertical-align: top; }
.feature-table th { color: var(--fg-2); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.pass { color: var(--success); } .fail { color: var(--error); }
.tool-form .form-row { display: grid; grid-template-columns: 148px minmax(0,1fr); gap: 9px; align-items: center; margin-bottom: 9px; }
.tool-form .form-row > label { font-size: 11.5px; color: var(--fg-2); }
.tool-form .hint { margin: -4px 0 10px 157px; font-size: 11px; color: var(--fg-2); line-height: 1.5; }
.tool-form textarea { min-height: 78px; }

/* ---------------------------------------------------- points */
.points-bar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 7px 10px; margin-bottom: 12px; font-size: 11.5px;
    border: 1px solid var(--border); border-radius: 6px; color: var(--fg-1);
}
.points-bar strong { color: var(--fg-0); }
.points-bar .spacer { margin-left: auto; }
.points-summary { margin-bottom: 20px; }
.points-heading { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); margin: 0 0 8px; }
.points-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.points-row {
    display: flex; align-items: center; gap: 8px; padding: 8px 11px;
    border: 1px solid var(--border); border-radius: 6px; font-size: 12px;
}
.points-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.points-row .price { flex: none; font-weight: 700; font-size: 11px; color: var(--accent); }
.points-row.short .price { color: var(--warning); }
.points-row .gap { flex: none; font-size: 11px; color: var(--fg-2); }
.points-earn { margin: 0; padding-left: 18px; font-size: 12px; color: var(--fg-1); line-height: 1.8; }
.points-note { font-size: 11.5px; color: var(--fg-2); margin: 8px 0 0; }
.points-empty { font-size: 12px; color: var(--fg-2); }

/* ---------------------------------------------------- modals */
.modal-overlay {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,.55); z-index: 100; padding: 20px;
}
.modal-overlay.open { display: flex; }
.modal {
    width: min(560px, 100%); max-height: 86vh; display: flex; flex-direction: column;
    background: var(--bg-raised); border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg); box-shadow: 0 12px 40px rgba(0,0,0,.4);
}
.modal.wide { width: min(780px, 100%); }
.modal-header {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.modal-title { font-size: 13px; font-weight: 600; }
.modal-close {
    width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: var(--radius); color: var(--fg-2); cursor: pointer;
}
.modal-close:hover { background: var(--bg-hover); color: var(--fg-0); }
.modal-body { padding: 16px; overflow: auto; }
.modal-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.modal-footer .grow { margin-right: auto; }
.env-layout { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 16px; }
.env-list { display: flex; flex-direction: column; gap: 2px; padding-right: 12px; border-right: 1px solid var(--border); }
.env-item {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px;
    border: 1px solid transparent; border-radius: var(--radius); background: transparent;
    color: var(--fg-1); cursor: pointer; text-align: left; font-size: 12px;
}
.env-item:hover { background: var(--bg-hover); }
.env-item.selected { background: var(--bg-active); color: var(--fg-0); font-weight: 600; }
.env-item .env-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.env-item .on { font-size: 9.5px; font-weight: 700; color: var(--success); text-transform: uppercase; letter-spacing: .04em; }
.cookie-domain { margin: 0 0 4px; font-size: 11.5px; font-weight: 600; color: var(--fg-1); }
.cookie-item {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
    padding: 6px 10px; margin-bottom: 4px; text-align: left; cursor: pointer;
    background: var(--bg-sunken); border: 1px solid var(--border); border-radius: var(--radius);
    font-family: var(--font-mono); font-size: 11.5px; word-break: break-all; color: var(--fg-0);
}
.cookie-item:hover { border-color: var(--focus); }
.shortcut-list { display: grid; grid-template-columns: 1fr auto; gap: 8px 18px; align-items: center; font-size: 12px; }
.shortcut-list .keys { display: flex; gap: 3px; justify-content: flex-end; }

/* ---------------------------------------------------- toasts */
.toast-container { position: fixed; bottom: 14px; right: 14px; z-index: 200; display: flex; flex-direction: column; gap: 8px; }
.toast {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 12px; min-width: 200px; max-width: 360px;
    background: var(--vscode-notifications-background, var(--bg-raised)); color: var(--vscode-notifications-foreground, var(--fg-0));
    border: 1px solid var(--border); border-left-width: 3px; border-radius: var(--radius);
    box-shadow: 0 6px 20px rgba(0,0,0,.35); font-size: 12px;
    animation: toast-in .18s ease;
}
.toast.success { border-left-color: var(--success); }
.toast.error { border-left-color: var(--error); }
.toast.warning { border-left-color: var(--warning); }
.toast.info { border-left-color: var(--accent); }
.toast-action { margin-left: auto; padding: 0 0 0 10px; background: none; border: 0; color: var(--accent); font-weight: 600; cursor: pointer; }
@keyframes toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ---------------------------------------------------- responsive */
@media (max-width: 900px) {
    :root { --sidebar-w: 200px; }
    .env-select { min-width: 90px; max-width: 130px; }
}
@media (max-width: 720px) {
    .app { grid-template-columns: 1fr; grid-template-areas: "topbar" "main"; }
    .sidebar { display: none; }
    .app.sidebar-open { grid-template-columns: var(--sidebar-w) minmax(0,1fr); grid-template-areas: "topbar topbar" "sidebar main"; }
    .app.sidebar-open .sidebar { display: flex; }
    .topbar-brand { display: none; }
    .send-btn { min-width: 72px; padding: 0 12px; }
    .config-content, .tool-body { padding: 11px; }
    .env-layout { grid-template-columns: 1fr; }
    .env-list { border-right: 0; padding-right: 0; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    .tool-form .form-row { grid-template-columns: 1fr; }
    .tool-form .hint { margin-left: 0; }
}
@media (max-width: 560px) {
    .kv-head { display: none; }
    .find-box { min-width: 120px; }
    .kv-row { grid-template-columns: 22px minmax(0,1fr) 26px; grid-template-areas: "t k a" ". v v"; }
    .kv-row .kv-key { grid-area: k; } .kv-row .kv-value { grid-area: v; }
    .kv-row .kv-toggle { grid-area: t; } .kv-row .kv-icon { grid-area: a; }
    .method-select { width: 82px; }
}
`;

const HEADER_NAMES = [
  "Accept", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Connection",
  "Content-Type", "Cookie", "If-Match", "If-None-Match", "Idempotency-Key", "Origin", "Referer",
  "User-Agent", "X-API-Key", "X-Correlation-ID", "X-Forwarded-For", "X-Request-ID", "X-Requested-With"
];
const MIME_TYPES = [
  "application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain",
  "text/html", "application/xml", "text/xml", "application/graphql", "application/octet-stream", "*/*"
];

function options(values: string[]): string {
  return values.map(value => `<option value="${value}"></option>`).join("");
}

/** The page body: top bar, sidebar, request view, tool views and dialogs. */
export function apiClientMarkup(): string {
  return `
<div class="app" id="appShell">

    <!-- ============================ TOP BAR ============================ -->
    <header class="topbar">
        <button class="icon-btn" id="toggleSidebar" type="button" title="Toggle the sidebar" aria-label="Toggle the sidebar" aria-expanded="true">${ic("menu")}</button>
        <div class="topbar-brand"><span class="dot" aria-hidden="true"></span>REST API Client</div>
        <div class="topbar-spacer"></div>
        <div class="topbar-env" id="envPicker" title="Variables written as {{name}} are replaced with values from the active environment">
            ${ic("globe")}
            <label class="sr-only" for="envSelect">Active environment</label>
            <select id="envSelect" class="select env-select">
                <option value="-1">No environment</option>
            </select>
            <button id="manageEnvBtn" class="icon-btn" type="button" title="Edit environments and variables" aria-label="Edit environments and variables">${ic("edit")}</button>
        </div>
        <div class="topbar-actions">
            <button id="showCookies" class="icon-btn" type="button" title="Stored cookies" aria-label="Stored cookies">${ic("cookie")}</button>
            <button id="shortcutsBtn" class="icon-btn" type="button" title="Keyboard shortcuts" aria-label="Keyboard shortcuts">${ic("keyboard")}</button>
        </div>
        <button id="pointsBadge" class="points-badge" type="button"
                title="Your DevSnip Pro points. Premium tools are unlocked by spending them."
                aria-label="Points balance">
            <span aria-hidden="true">◆</span><span id="userPointsBadge">0</span><span class="unit">pts</span>
        </button>
    </header>

    <!-- ============================ SIDEBAR ============================ -->
    <nav class="sidebar" id="sidebar" aria-label="Workspace">
        <div class="sidebar-top">
            <button class="btn btn-sm" id="newRequestBtn" type="button" title="Open a new request tab">${ic("plus")}<span>New request</span></button>
            <div class="search-wrap">
                ${ic("search", "search-icon")}
                <label class="sr-only" for="sidebarSearch">Search saved requests, history and tools</label>
                <input type="search" id="sidebarSearch" class="input" placeholder="Search requests and tools" autocomplete="off">
            </div>
        </div>

        <div class="sidebar-scroll">
            <section class="nav-section" data-section="collections">
                <div class="nav-section-bar">
                    <button class="nav-section-head" type="button" aria-expanded="true" aria-controls="collectionsBody">
                        <span class="chev" aria-hidden="true">&#9660;</span><span>Saved requests</span>
                        <span class="count" id="collectionsCount"></span>
                    </button>
                </div>
                <div class="nav-section-body" id="collectionsBody">
                    <div id="collectionsTree"></div>
                    <button class="kv-add" id="saveToCollectionBtn" type="button" style="width:100%;margin-top:4px;">+ Save current request</button>
                </div>
            </section>

            <section class="nav-section" data-section="history">
                <div class="nav-section-bar">
                    <button class="nav-section-head" type="button" aria-expanded="true" aria-controls="historyBody">
                        <span class="chev" aria-hidden="true">&#9660;</span><span>History</span>
                        <span class="count" id="historyCount"></span>
                    </button>
                    <div class="section-actions">
                        <button class="mini-btn" id="exportHistoryBtn" type="button" title="Export history to a JSON file" aria-label="Export history">${ic("download")}</button>
                        <button class="mini-btn" id="clearHistory" type="button" title="Clear history" aria-label="Clear history">${ic("trash")}</button>
                    </div>
                </div>
                <div class="nav-section-body" id="historyBody">
                    <div id="historyTableBody"></div>
                </div>
            </section>

            <!-- AI / ML and Developer Tools are rendered from the feature
                 catalog the extension host sends, so the sidebar always
                 matches the user's real entitlement. -->
            <div id="toolNav"></div>
        </div>
    </nav>

    <!-- ============================= MAIN ============================== -->
    <main class="main">

        <!-- ------------------------- REQUEST VIEW ------------------------- -->
        <section class="view active" id="view-request" aria-label="Request builder">
            <div class="req-tabs-bar">
                <div class="req-tabs" id="reqTabs" role="tablist" aria-label="Open requests"></div>
                <button class="icon-btn new-tab-btn" id="newTabBtn" type="button" title="New request tab" aria-label="New request tab">${ic("plus")}</button>
            </div>

            <div class="req-head">
                <div class="req-title">
                    <span class="req-folder" id="reqFolder"></span>
                    <label class="sr-only" for="reqName">Request name</label>
                    <input type="text" id="reqName" class="req-name-input" placeholder="Untitled request" autocomplete="off" spellcheck="false">
                    <span class="dirty-pill" id="reqDirty" hidden>● Unsaved</span>
                </div>
                <div class="segmented" role="tablist" aria-label="Request protocol">
                    <button class="seg-btn type-tab active" data-type="rest" type="button" role="tab" aria-selected="true">HTTP</button>
                    <button class="seg-btn type-tab" data-type="graphql" type="button" role="tab" aria-selected="false">GraphQL</button>
                </div>
                <div class="req-actions">
                    <button id="saveRequestBtn" class="btn btn-ghost btn-sm" type="button" title="Save to a collection (Ctrl/Cmd+S)">${ic("save")}<span id="saveRequestLabel">Save</span></button>
                    <div class="menu-wrap">
                        <button id="moreMenuBtn" class="btn btn-ghost btn-sm" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="moreMenu" title="More actions" aria-label="More actions">${ic("more", "ic-dots")}</button>
                        <div class="menu" id="moreMenu" role="menu" aria-label="Request actions" hidden>
                            <button class="menu-item" role="menuitem" type="button" data-action="save-as">${ic("save")}Save as new request…<span class="kbd">Ctrl/⌘ ⇧ S</span></button>
                            <button class="menu-item" role="menuitem" type="button" data-action="duplicate">${ic("copy")}Duplicate in a new tab</button>
                            <div class="menu-sep" role="separator"></div>
                            <button class="menu-item" role="menuitem" type="button" data-action="copy-curl">${ic("terminal")}Copy as cURL</button>
                            <button class="menu-item" role="menuitem" type="button" data-action="import-curl">${ic("download")}Import from cURL…</button>
                            <div class="menu-sep" role="separator"></div>
                            <button class="menu-item" role="menuitem" type="button" data-action="reset">${ic("trash")}Clear this request</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="url-bar">
                <div class="url-row">
                    <div class="url-group" id="urlGroup">
                        <label class="sr-only" for="method">HTTP method</label>
                        <select id="method" class="method-select m-GET" title="HTTP method">
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                            <option value="DELETE">DELETE</option>
                            <option value="HEAD">HEAD</option>
                            <option value="OPTIONS">OPTIONS</option>
                        </select>
                        <label class="sr-only" for="url">Request URL</label>
                        <input type="text" id="url" class="url-input" placeholder="https://api.example.com/users  or  {{baseUrl}}/users  or paste a cURL command" autocomplete="off" spellcheck="false">
                    </div>
                    <button id="sendRequest" class="send-btn" type="button" title="Send the request (Enter in the URL, or Ctrl/Cmd+Enter anywhere)">
                        <span class="btn-label">Send</span>
                        <span class="spinner hidden" aria-hidden="true"></span>
                    </button>
                    <button id="cancelRequest" class="cancel-btn" type="button" title="Stop waiting for this request">${ic("stop")}Cancel</button>
                </div>
                <div class="url-hints" id="urlHints">
                    <span class="url-error hint-line" id="urlError" aria-live="polite"></span>
                    <div class="hint-line warn" id="urlVars" hidden></div>
                    <div class="hint-line" id="urlPreviewLine" hidden>${ic("send")}<span>Resolves to</span><span class="url-preview" id="urlPreview"></span></div>
                </div>
            </div>

            <div class="workspace" id="workspace">
                <!-- Request configuration -->
                <div class="pane" id="requestPane">
                    <div class="pane-head">
                        <div class="config-tabs" role="tablist" aria-label="Request configuration">
                            <button class="config-tab active" data-tab="params" type="button" role="tab" aria-selected="true" title="Query parameters, kept in sync with the URL">Params <span class="badge" id="paramCount">0</span></button>
                            <button class="config-tab" data-tab="headers" type="button" role="tab" aria-selected="false">Headers <span class="badge" id="headerCount">0</span></button>
                            <button class="config-tab" data-tab="body" id="bodyTabBtn" type="button" role="tab" aria-selected="false">Body <span class="dot-badge" id="bodyDot" hidden></span></button>
                            <button class="config-tab" data-tab="graphql" id="graphqlTab" type="button" role="tab" aria-selected="false" hidden>Query <span class="dot-badge" id="graphqlDot" hidden></span></button>
                            <button class="config-tab" data-tab="auth" type="button" role="tab" aria-selected="false">Auth <span class="dot-badge" id="authDot" hidden></span></button>
                            <button class="config-tab" data-tab="settings" type="button" role="tab" aria-selected="false">Settings <span class="dot-badge" id="settingsDot" hidden></span></button>
                        </div>
                    </div>
                    <div class="pane-body">
                        <!-- PARAMS -->
                        <div class="config-content active" id="tab-params">
                            <div class="kv-toolbar">
                                <span>Query parameters. Edits here and in the URL stay in sync.</span>
                                <button class="link-btn" type="button" data-bulk="paramsContainer">Bulk edit</button>
                            </div>
                            <div class="kv-head" aria-hidden="true"><span></span><span>Key</span><span>Value</span><span></span></div>
                            <div id="paramsContainer" class="kv-list"></div>
                            <label class="sr-only" for="paramsBulk">Parameters, one "key: value" per line</label>
                            <textarea id="paramsBulk" class="textarea code-area bulk-area" spellcheck="false" hidden placeholder="page: 1&#10;limit: 20&#10;// sort: name   (lines starting with // are disabled)"></textarea>
                        </div>

                        <!-- HEADERS -->
                        <div class="config-content" id="tab-headers">
                            <div class="kv-toolbar">
                                <span>Use <code>{{name}}</code> to insert an environment variable.</span>
                                <button class="link-btn" type="button" data-bulk="headersContainer">Bulk edit</button>
                            </div>
                            <div class="kv-head" aria-hidden="true"><span></span><span>Header</span><span>Value</span><span></span></div>
                            <div id="headersContainer" class="kv-list"></div>
                            <label class="sr-only" for="headersBulk">Headers, one "Name: value" per line</label>
                            <textarea id="headersBulk" class="textarea code-area bulk-area" spellcheck="false" hidden placeholder="Accept: application/json&#10;// X-Debug: 1   (lines starting with // are disabled)"></textarea>
                        </div>

                        <!-- BODY -->
                        <div class="config-content" id="tab-body">
                            <div class="body-toolbar">
                                <div class="segmented" role="group" aria-label="Body type">
                                    <button class="seg-btn body-type-btn" data-body-type="none" type="button" aria-pressed="false">None</button>
                                    <button class="seg-btn body-type-btn" data-body-type="json" type="button" aria-pressed="true">JSON</button>
                                    <button class="seg-btn body-type-btn" data-body-type="text" type="button" aria-pressed="false">Text</button>
                                    <button class="seg-btn body-type-btn" data-body-type="form-urlencoded" type="button" aria-pressed="false" title="application/x-www-form-urlencoded">Form</button>
                                </div>
                                <div class="body-actions" id="bodyActions">
                                    <button class="btn btn-ghost btn-sm" id="beautifyJson" type="button" title="Pretty-print JSON or XML">Format</button>
                                    <button class="btn btn-ghost btn-sm" id="minifyJson" type="button" title="Remove whitespace from JSON">Minify</button>
                                    <button class="btn btn-ghost btn-sm" id="convertToJson" type="button" title="Convert XML or form data to JSON">To JSON</button>
                                </div>
                            </div>
                            <div class="notice-line" id="bodyWarn" hidden></div>
                            <div id="bodyEditor">
                                <label class="sr-only" for="body">Request body</label>
                                <textarea id="body" class="textarea code-area" rows="12" spellcheck="false" aria-describedby="bodyNote" placeholder='{ "key": "value" }'></textarea>
                                <div class="body-foot">
                                    <div class="field-note" id="bodyNote" aria-live="polite"></div>
                                    <div class="field-note" id="bodyCtNote"></div>
                                </div>
                            </div>
                            <div class="empty-hint" id="bodyNone" hidden>This request is sent without a body. Choose JSON, Text or Form to add one.</div>
                        </div>

                        <!-- GRAPHQL -->
                        <div class="config-content" id="tab-graphql">
                            <div class="graphql-section" id="graphqlSection">
                                <div class="notice-line" id="graphqlWarn" hidden></div>
                                <div class="form-row">
                                    <label class="form-label" for="graphqlQuery">Query</label>
                                    <textarea id="graphqlQuery" class="textarea code-area" rows="10" spellcheck="false" placeholder="query GetUsers {&#10;  users {&#10;    id&#10;    name&#10;  }&#10;}"></textarea>
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="graphqlVariables">Variables (JSON)</label>
                                    <textarea id="graphqlVariables" class="textarea code-area" rows="4" spellcheck="false" placeholder='{ "id": 1 }' style="min-height:90px" aria-describedby="graphqlNote"></textarea>
                                    <div class="field-note" id="graphqlNote" aria-live="polite"></div>
                                </div>
                                <div class="form-row">
                                    <label class="form-label" for="graphqlOperationName">Operation name <span class="sub">(optional)</span></label>
                                    <input type="text" id="graphqlOperationName" class="input" placeholder="GetUsers" style="max-width:320px">
                                </div>
                            </div>
                        </div>

                        <!-- AUTH -->
                        <div class="config-content" id="tab-auth">
                            <div class="auth-grid">
                                <div class="form-row">
                                    <label class="form-label" for="authType">Authentication type</label>
                                    <select id="authType" class="select" style="max-width:280px">
                                        <option value="">No auth</option>
                                        <option value="Bearer">Bearer token</option>
                                        <option value="Basic">Basic auth (username and password)</option>
                                        <option value="ApiKey">API key</option>
                                    </select>
                                </div>
                                <p class="auth-help" id="authNone">This request is sent without credentials.</p>
                                <div id="authBearer" hidden>
                                    <div class="form-row">
                                        <label class="form-label" for="authToken">Token</label>
                                        <div class="secret-field">
                                            <input type="password" id="authToken" class="input mono" placeholder="eyJhbGciOi…  or  {{token}}" autocomplete="off" spellcheck="false">
                                            <button class="icon-btn reveal-btn" type="button" data-target="authToken" aria-pressed="false" title="Show the token" aria-label="Show the token">${ic("eye")}</button>
                                        </div>
                                    </div>
                                </div>
                                <div id="authBasic" hidden>
                                    <div class="inline-fields">
                                        <div class="form-row">
                                            <label class="form-label" for="username">Username</label>
                                            <input type="text" id="username" class="input" autocomplete="off" spellcheck="false">
                                        </div>
                                        <div class="form-row">
                                            <label class="form-label" for="password">Password</label>
                                            <div class="secret-field">
                                                <input type="password" id="password" class="input" autocomplete="off">
                                                <button class="icon-btn reveal-btn" type="button" data-target="password" aria-pressed="false" title="Show the password" aria-label="Show the password">${ic("eye")}</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div id="authApiKey" hidden>
                                    <div class="inline-fields">
                                        <div class="form-row">
                                            <label class="form-label" for="apiKeyName">Key name</label>
                                            <input type="text" id="apiKeyName" class="input mono" placeholder="X-API-Key" autocomplete="off" spellcheck="false">
                                        </div>
                                        <div class="form-row">
                                            <label class="form-label" for="apiKeyLocation">Send in</label>
                                            <select id="apiKeyLocation" class="select">
                                                <option value="header">Header</option>
                                                <option value="query">Query parameter</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="form-row">
                                        <label class="form-label" for="apiKeyValue">Key value</label>
                                        <div class="secret-field">
                                            <input type="password" id="apiKeyValue" class="input mono" placeholder="Your API key  or  {{apiKey}}" autocomplete="off" spellcheck="false">
                                            <button class="icon-btn reveal-btn" type="button" data-target="apiKeyValue" aria-pressed="false" title="Show the key" aria-label="Show the key">${ic("eye")}</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="auth-preview" id="authPreview" hidden></div>
                                <p class="auth-help">Tip: keep secrets in an environment variable and enter <code>{{token}}</code> here. Variable references are saved with the request; typed secrets are not.</p>
                            </div>
                        </div>

                        <!-- SETTINGS -->
                        <div class="config-content" id="tab-settings">
                            <div class="settings-grid">
                                <div class="settings-card">
                                    <h4>Timeout and retries</h4>
                                    <div class="form-row">
                                        <label class="form-label" for="timeout">Timeout (ms)</label>
                                        <input type="number" id="timeout" class="input" min="1000" max="300000" step="1000" placeholder="Default from the devsnip.apiTimeout setting">
                                    </div>
                                    <div class="inline-fields">
                                        <div class="form-row">
                                            <label class="form-label" for="retries">Retries</label>
                                            <input type="number" id="retries" class="input" value="0" min="0" max="5">
                                        </div>
                                        <div class="form-row">
                                            <label class="form-label" for="retryDelay">First delay (ms)</label>
                                            <input type="number" id="retryDelay" class="input" value="500" min="0" max="10000">
                                        </div>
                                    </div>
                                    <div class="form-row">
                                        <label class="form-label" for="retryStatusCodes">Retry on status codes</label>
                                        <input type="text" id="retryStatusCodes" class="input" value="429,502,503,504" placeholder="429,502,503,504">
                                        <div class="field-note">Network errors are always retried. The delay doubles on each attempt.</div>
                                    </div>
                                </div>
                                <div class="settings-card">
                                    <h4>Redirects and TLS</h4>
                                    <label class="check-row"><input type="checkbox" id="followRedirects" checked> Follow redirects</label>
                                    <div class="form-row">
                                        <label class="form-label" for="maxRedirects">Maximum redirects</label>
                                        <input type="number" id="maxRedirects" class="input" value="5" min="0" max="20" style="max-width:120px">
                                    </div>
                                    <label class="check-row"><input type="checkbox" id="sslVerify" checked> Verify SSL/TLS certificates</label>
                                    <div class="field-note" style="margin:-4px 0 12px">Turn off only for local servers with self-signed certificates.</div>
                                </div>
                                <div class="settings-card">
                                    <h4>Proxy</h4>
                                    <div class="inline-fields">
                                        <div class="form-row" style="flex:2">
                                            <label class="form-label" for="proxyHost">Host</label>
                                            <input type="text" id="proxyHost" class="input" placeholder="127.0.0.1" autocomplete="off">
                                        </div>
                                        <div class="form-row">
                                            <label class="form-label" for="proxyPort">Port</label>
                                            <input type="number" id="proxyPort" class="input" placeholder="8080">
                                        </div>
                                    </div>
                                    <div class="inline-fields">
                                        <div class="form-row">
                                            <label class="form-label" for="proxyUsername">Username</label>
                                            <input type="text" id="proxyUsername" class="input" autocomplete="off">
                                        </div>
                                        <div class="form-row">
                                            <label class="form-label" for="proxyPassword">Password</label>
                                            <input type="password" id="proxyPassword" class="input" autocomplete="off">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="splitter" id="splitter" role="separator" tabindex="0" aria-label="Resize the request and response panes" title="Drag to resize. Double-click to reset."></div>

                <!-- Response -->
                <div class="pane" id="responsePane">
                    <div class="pane-head resp-head">
                        <div class="status-strip" id="statusStrip">
                            <span class="pane-title">Response</span>
                            <span class="status-pill" id="statusCode" role="status" aria-live="polite">Idle</span>
                            <span class="status-metric"><span class="label">Time</span><span class="value" id="responseTime">-</span></span>
                            <span class="status-metric"><span class="label">Size</span><span class="value" id="responseSize">-</span></span>
                            <span class="status-metric" id="metricAttempts" hidden><span class="label">Attempts</span><span class="value" id="responseAttempts">1</span></span>
                        </div>
                        <div class="resp-tabs" role="tablist" aria-label="Response view">
                            <button class="resp-tab active" data-resp="body" type="button" role="tab" aria-selected="true">Body</button>
                            <button class="resp-tab" data-resp="headers" type="button" role="tab" aria-selected="false">Headers <span class="badge" id="respHeaderCount">0</span></button>
                            <button class="resp-tab" data-resp="cookies" type="button" role="tab" aria-selected="false">Cookies <span class="badge" id="respCookieCount">0</span></button>
                        </div>
                    </div>
                    <div class="resp-hint" id="respHint" hidden></div>
                    <div class="resp-toolbar" id="respToolbar" hidden>
                        <div class="segmented" role="tablist" aria-label="Body format">
                            <button class="seg-btn body-mode active" data-mode="pretty" type="button" role="tab" aria-selected="true">Pretty</button>
                            <button class="seg-btn body-mode" data-mode="raw" type="button" role="tab" aria-selected="false">Raw</button>
                        </div>
                        <span class="kind-chip" id="bodyKind"></span>
                        <button class="mini-btn" id="wrapToggle" type="button" aria-pressed="true" title="Wrap long lines" aria-label="Wrap long lines">${ic("wrap")}</button>
                        <div class="find-box">
                            ${ic("search")}
                            <label class="sr-only" for="responseSearch">Find in the response</label>
                            <input type="search" id="responseSearch" placeholder="Find (Ctrl/Cmd+F)" autocomplete="off" spellcheck="false">
                            <span class="find-count" id="findCount" aria-live="polite"></span>
                            <button class="mini-btn" id="findPrev" type="button" title="Previous match (Shift+Enter)" aria-label="Previous match">${ic("up")}</button>
                            <button class="mini-btn" id="findNext" type="button" title="Next match (Enter)" aria-label="Next match">${ic("down")}</button>
                        </div>
                        <button class="mini-btn" id="copyResponseBtn" type="button" title="Copy the response body" aria-label="Copy the response body">${ic("copy")}</button>
                        <button class="mini-btn" id="downloadResponseBtn" type="button" title="Save the response body to a file" aria-label="Save the response body to a file">${ic("download")}</button>
                    </div>
                    <div class="pane-body" id="responseScroll">
                        <div class="resp-view active" id="resp-body">
                            <div id="responseState">
                                <div class="empty-state">
                                    <div class="glyph" aria-hidden="true">&#9679;</div>
                                    <h3>No response yet</h3>
                                    <p>Configure your request and select Send to see the response here.</p>
                                </div>
                            </div>
                            <pre class="response-output" id="responseOutput" hidden></pre>
                            <pre class="response-output" id="responseRaw" hidden></pre>
                        </div>
                        <div class="resp-view" id="resp-headers"><div id="responseHeaders" class="resp-table-host"></div></div>
                        <div class="resp-view" id="resp-cookies"><div id="responseCookies" class="resp-table-host"></div></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- --------------------------- TOOL VIEW --------------------------- -->
        <section class="view" id="view-tool" aria-label="Tool">
            <div class="tool-head">
                <div>
                    <h2 class="tool-title" id="toolTitle">Tools</h2>
                    <p class="tool-sub" id="toolSub"></p>
                </div>
                <div class="tool-actions">
                    <span class="tier-pill" id="featureTierPill">Free</span>
                    <button class="btn btn-ghost btn-sm" id="featureRefreshBtn" type="button">Refresh</button>
                    <button class="btn btn-sm" id="featureUpgradeBtn" type="button">Earn points</button>
                    <button class="btn btn-ghost btn-sm" id="backToRequest" type="button">Back to request</button>
                </div>
            </div>
            <div class="pane-body">
                <div class="tool-body">
                    <div id="toolFormHost" class="tool-form"></div>
                    <div class="feature-output" id="featureOutput" hidden></div>
                </div>
            </div>
        </section>

        <!-- --------------------------- POINTS VIEW --------------------------- -->
        <section class="view" id="view-points" aria-label="Points">
            <div class="tool-head">
                <div>
                    <h2 class="tool-title">Your points</h2>
                    <p class="tool-sub">Premium tools are unlocked by spending points you earn using DevSnip Pro.</p>
                </div>
                <div class="tool-actions">
                    <span class="tier-pill"><span id="currentPointsDisplay">0</span> pts</span>
                    <button class="btn btn-ghost btn-sm" id="openPointsTracker" type="button">Open tracker</button>
                    <button class="btn btn-ghost btn-sm" id="backToRequestFromPoints" type="button">Back to request</button>
                </div>
            </div>
            <div class="pane-body">
                <div class="tool-body">
                    <section class="points-summary" aria-labelledby="pointsUnlockedHeading">
                        <h3 id="pointsUnlockedHeading" class="points-heading">Unlocked at this balance</h3>
                        <div id="pointsUnlockedList" class="points-list"></div>
                    </section>
                    <section class="points-summary" aria-labelledby="pointsLockedHeading">
                        <h3 id="pointsLockedHeading" class="points-heading">Needs more points</h3>
                        <div id="pointsLockedList" class="points-list"></div>
                    </section>
                    <section class="points-summary" aria-labelledby="pointsEarnHeading">
                        <h3 id="pointsEarnHeading" class="points-heading">How to earn points</h3>
                        <ul class="points-earn">
                            <li>Run any DevSnip Pro tool: <strong>+3</strong> (+1 after 5 runs of the same tool in a day)</li>
                            <li>Create a custom snippet: <strong>+10</strong></li>
                            <li>Run a security or cloud audit: <strong>+8</strong></li>
                            <li>Run an AI, RAG or prompt tool: <strong>+5</strong></li>
                            <li>Daily login <strong>+5</strong>, daily bonus <strong>+10</strong></li>
                            <li>Milestones: <strong>+10 to +500</strong></li>
                        </ul>
                        <p class="points-note">Up to 120 points a day can be earned from tool use, plus one-time milestone bonuses.</p>
                    </section>
                </div>
            </div>
        </section>
    </main>
</div>

<!-- ============================== DIALOGS ============================== -->
<div id="envModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="envModalTitle">
    <div class="modal wide">
        <div class="modal-header">
            <span class="modal-title" id="envModalTitle">Environments</span>
            <button class="modal-close" data-close="envModal" type="button" aria-label="Close">${ic("close")}</button>
        </div>
        <div class="modal-body">
            <div class="env-layout">
                <div class="env-list">
                    <div id="envList"></div>
                    <button class="kv-add" id="newEnvBtn" type="button">+ New environment</button>
                </div>
                <div>
                    <div class="form-row">
                        <label class="form-label" for="envName">Name</label>
                        <input type="text" id="envName" class="input" placeholder="Development, Staging, Production" autocomplete="off">
                        <div class="field-note error" id="envNameNote"></div>
                    </div>
                    <p class="section-note">Reference a variable as <code>{{name}}</code> in the URL, params, headers, body or auth. Example: <code>{{baseUrl}}/users</code></p>
                    <div class="kv-head" aria-hidden="true"><span></span><span>Variable</span><span>Value</span><span></span></div>
                    <div id="envVarsContainer" class="kv-list no-toggle"></div>
                    <label class="check-row" style="margin-top:10px"><input type="checkbox" id="envActivate"> Use this environment for requests</label>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button id="deleteEnvBtn" class="btn btn-danger btn-sm grow" type="button">Delete environment</button>
            <button class="btn btn-ghost" data-close="envModal" type="button">Cancel</button>
            <button id="saveEnvBtn" class="btn" type="button" data-primary>Save</button>
        </div>
    </div>
</div>

<div id="cookieModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cookieModalTitle">
    <div class="modal">
        <div class="modal-header">
            <span class="modal-title" id="cookieModalTitle">Stored cookies</span>
            <button class="modal-close" data-close="cookieModal" type="button" aria-label="Close">${ic("close")}</button>
        </div>
        <div class="modal-body">
            <p class="section-note">Cookies set by responses are stored per domain and sent with later requests to that domain. Select one to copy it.</p>
            <div id="cookieList"></div>
        </div>
        <div class="modal-footer">
            <button id="clearCookies" class="btn btn-danger btn-sm grow" type="button">Clear all cookies</button>
            <button id="copyCookies" class="btn btn-ghost" type="button">Copy all</button>
        </div>
    </div>
</div>

<div id="saveRequestModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="saveRequestTitle">
    <div class="modal">
        <div class="modal-header">
            <span class="modal-title" id="saveRequestTitle">Save request</span>
            <button class="modal-close" data-close="saveRequestModal" type="button" aria-label="Close">${ic("close")}</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <label class="form-label" for="saveRequestName">Name</label>
                <input type="text" id="saveRequestName" class="input" placeholder="Get users" autocomplete="off">
            </div>
            <div class="form-row">
                <label class="form-label" for="saveRequestFolder">Collection</label>
                <input type="text" id="saveRequestFolder" class="input" list="collectionFolders" placeholder="Default" autocomplete="off">
                <datalist id="collectionFolders"></datalist>
                <div class="field-note">Pick an existing collection or type a new name.</div>
            </div>
            <div class="field-note" id="saveRequestNote"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-ghost" data-close="saveRequestModal" type="button">Cancel</button>
            <button id="confirmSaveRequest" class="btn" type="button" data-primary>Save</button>
        </div>
    </div>
</div>

<div id="curlModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="curlModalTitle">
    <div class="modal">
        <div class="modal-header">
            <span class="modal-title" id="curlModalTitle">Import from cURL</span>
            <button class="modal-close" data-close="curlModal" type="button" aria-label="Close">${ic("close")}</button>
        </div>
        <div class="modal-body">
            <label class="form-label" for="curlInput">Paste a cURL command, for example from your browser's "Copy as cURL"</label>
            <textarea id="curlInput" class="textarea" rows="8" spellcheck="false" placeholder="curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{&quot;name&quot;:&quot;Ada&quot;}'"></textarea>
            <div class="field-note">It opens in a new tab. You can also paste a cURL command straight into the URL bar.</div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-ghost" data-close="curlModal" type="button">Cancel</button>
            <button id="confirmCurlImport" class="btn" type="button" data-primary>Import</button>
        </div>
    </div>
</div>

<div id="shortcutsModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="shortcutsTitle">
    <div class="modal">
        <div class="modal-header">
            <span class="modal-title" id="shortcutsTitle">Keyboard shortcuts</span>
            <button class="modal-close" data-close="shortcutsModal" type="button" aria-label="Close">${ic("close")}</button>
        </div>
        <div class="modal-body">
            <div class="shortcut-list">
                <span>Send the request</span><span class="keys"><span class="kbd">Ctrl/⌘</span><span class="kbd">Enter</span></span>
                <span>Send from the URL bar</span><span class="keys"><span class="kbd">Enter</span></span>
                <span>Save the request</span><span class="keys"><span class="kbd">Ctrl/⌘</span><span class="kbd">S</span></span>
                <span>Save as a new request</span><span class="keys"><span class="kbd">Ctrl/⌘</span><span class="kbd">Shift</span><span class="kbd">S</span></span>
                <span>Focus the URL bar</span><span class="keys"><span class="kbd">Ctrl/⌘</span><span class="kbd">L</span></span>
                <span>Find in the response</span><span class="keys"><span class="kbd">Ctrl/⌘</span><span class="kbd">F</span></span>
                <span>Next / previous match</span><span class="keys"><span class="kbd">Enter</span><span class="kbd">Shift</span><span class="kbd">Enter</span></span>
                <span>Indent in a body editor</span><span class="keys"><span class="kbd">Tab</span></span>
                <span>Leave a body editor with the keyboard</span><span class="keys"><span class="kbd">Esc</span><span class="kbd">Tab</span></span>
                <span>Close a dialog or menu</span><span class="keys"><span class="kbd">Esc</span></span>
                <span>Close a request tab</span><span class="keys"><span class="kbd">Middle-click</span></span>
            </div>
        </div>
    </div>
</div>

<datalist id="dlHeaderNames">${options(HEADER_NAMES)}</datalist>
<datalist id="dlMime">${options(MIME_TYPES)}</datalist>
<datalist id="dlCacheControl">${options(["no-cache", "no-store", "max-age=0", "max-age=3600", "must-revalidate"])}</datalist>
<datalist id="dlAuthorization">${options(["Bearer {{token}}", "Basic "])}</datalist>

<div class="toast-container" id="toastContainer" role="status" aria-live="polite"></div>
`;
}

/**
 * Request builder: request tabs, the URL and parameter editors, sending,
 * response rendering, environments, history and saved requests.
 *
 * Runs before the premium tool browser in the same script element, so the
 * tool code can call into it (toast, showView, buildRequestPayload, ...).
 */
export const API_CLIENT_SCRIPT = String.raw`
/* ===================== CONSTANTS AND STATE ===================== */
var ICONS = ${JSON.stringify(ICON_PATHS)};
var HIGHLIGHT_CHAR_BUDGET = 120000;
var PERSIST_RESPONSE_LIMIT = 200000;
var BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
var STATUS_HINTS = {
    400: ['Bad request', 'The server could not process the request. Check the body, query parameters and Content-Type.', 'body'],
    401: ['Unauthorized', 'Credentials are missing, wrong or expired. Check the Auth tab and the token.', 'auth'],
    403: ['Forbidden', 'The credentials were accepted but do not allow this. Check the token scopes or the key permissions.', 'auth'],
    404: ['Not found', 'Nothing exists at this path. Check the URL, path parameters and the environment base URL.', ''],
    405: ['Method not allowed', 'This endpoint does not accept this method. Try another one, for example GET or POST.', ''],
    406: ['Not acceptable', 'The server cannot produce the format asked for. Check the Accept header.', 'headers'],
    408: ['Request timeout', 'The server gave up waiting for the request. Try again, or send a smaller body.', ''],
    409: ['Conflict', 'The request conflicts with the current state of the resource, for example a duplicate.', ''],
    413: ['Payload too large', 'The body is bigger than the server accepts.', 'body'],
    415: ['Unsupported media type', 'The server does not accept this body format. Check the Content-Type header and the body type.', 'body'],
    422: ['Validation failed', 'The body was understood but some values are invalid. The response body usually names the fields.', 'body'],
    429: ['Too many requests', 'You are being rate limited. Wait a moment, or turn on automatic retries in Settings.', 'settings'],
    500: ['Internal server error', 'The server failed while handling the request. The response body or the server logs may say why.', ''],
    502: ['Bad gateway', 'A proxy or gateway got a bad answer from the upstream server. Retrying often helps.', 'settings'],
    503: ['Service unavailable', 'The server is down or overloaded. Retrying with a delay often helps.', 'settings'],
    504: ['Gateway timeout', 'An upstream server took too long to answer. Retrying often helps.', 'settings']
};
var ACTION_LABELS = { auth: 'Open Auth', body: 'Open Body', headers: 'Open Headers', settings: 'Open Settings', env: 'Edit environments', url: 'Edit URL' };

var isRequestInProgress = false;
var inflightTabId = null;
var currentView = 'request';
var lastHistory = [];
var savedRequests = [];
var sidebarQuery = '';
var collapsedSections = {};
var collapsedGroups = {};
var environments = [];
var activeEnvIndex = -1;
var currentRequestType = 'rest';
var currentBodyType = 'json';
var activeRespTab = 'body';
var tabs = [];
var activeTabId = null;
var tabSeq = 0;
var pendingSaveTabId = null;
var pendingSaveBaseline = null;
var pendingDeleteId = null;
var pendingCurlTarget = 'current';
var pendingEnvActivate = null;
var envEditing = -1;
var bulkMode = { paramsContainer: false, headersContainer: false };
var fullResponseText = '';
var fullResponseKind = 'text';
var responseIsTruncated = false;
var searchMarks = [];
var searchIndex = -1;
var elapsedTimer = null;
var lastFocusBeforeModal = null;
var methodSelect = document.getElementById('method');

var restoredState = null;
try { restoredState = vscode.getState() || null; } catch (error) { restoredState = null; }
var prefs = { wrap: true, bodyMode: 'pretty', split: 0.5 };
if (restoredState && restoredState.prefs) {
    Object.keys(prefs).forEach(function (key) {
        if (restoredState.prefs[key] !== undefined) prefs[key] = restoredState.prefs[key];
    });
}

/* ===================== SMALL HELPERS ===================== */
function $(id) { return document.getElementById(id); }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function debounce(fn, ms) {
    var timer = null;
    return function () {
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
}
function iconSvg(name, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="' + (ICONS[name] || '') + '"/></svg>';
}
function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}
function makeButton(className, label, onClick, icon) {
    var button = make('button', className);
    button.type = 'button';
    if (icon) button.innerHTML = iconSvg(icon);
    if (label) button.appendChild(document.createTextNode(label));
    if (onClick) button.addEventListener('click', onClick);
    return button;
}

/* Copies text, falling back to execCommand where the clipboard API is blocked. */
function copyText(text, message) {
    function fallback() {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
        area.remove();
        toast(ok ? message : 'The clipboard is not available here', ok ? 'success' : 'error');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast(message, 'success'); }, fallback);
    } else {
        fallback();
    }
}

/* Two-step confirmation for destructive buttons: the first click arms it. */
function confirmClick(button, run, armedLabel) {
    if (button.dataset.armed === '1') {
        clearTimeout(Number(button.dataset.timer));
        disarm(button);
        run();
        return;
    }
    button.dataset.armed = '1';
    button.dataset.originalHtml = button.innerHTML;
    button.dataset.originalTitle = button.title || '';
    button.classList.add('armed');
    button.textContent = armedLabel || 'Confirm?';
    button.title = 'Click again to confirm';
    button.dataset.timer = String(setTimeout(function () { disarm(button); }, 3500));
}
function disarm(button) {
    if (button.dataset.armed !== '1') return;
    button.dataset.armed = '';
    button.classList.remove('armed');
    button.innerHTML = button.dataset.originalHtml || '';
    button.title = button.dataset.originalTitle || '';
}

function relativeTime(timestamp) {
    var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 45) return 'now';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + 'h';
    var days = Math.round(hours / 24);
    if (days < 30) return days + 'd';
    return new Date(timestamp).toLocaleDateString();
}
function dayLabel(timestamp) {
    var date = new Date(timestamp);
    var today = new Date();
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (timestamp >= start) return 'Today';
    if (timestamp >= start - 86400000) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatMs(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '-';
    return ms >= 10000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms';
}

/* ===================== TOASTS ===================== */
function toast(msg, type, action) {
    var host = $('toastContainer') || document.body;
    var el = make('div', 'toast ' + (type || 'info'));
    // Icon plus text, so the meaning does not rely on colour alone.
    var glyph = type === 'error' ? '✗' : type === 'warning' ? '⚠' : type === 'success' ? '✓' : 'ℹ';
    var icon = make('span', '', glyph);
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);
    el.appendChild(make('span', '', msg));
    if (action) {
        el.appendChild(makeButton('toast-action', action.label, function () { el.remove(); action.run(); }));
    }
    host.appendChild(el);
    while (host.children.length > 4) host.firstChild.remove();
    setTimeout(function () { el.remove(); }, action ? 6000 : 3400);
}

/* ===================== ENVIRONMENT VARIABLES ===================== */
function activeEnv() { return activeEnvIndex >= 0 ? environments[activeEnvIndex] || null : null; }

/* Mirrors the host's substitution so previews match what is sent. */
function resolveVars(text) {
    var env = activeEnv();
    var missing = [];
    var out = String(text || '').replace(/\{\{(\w+)\}\}/g, function (match, name) {
        if (env && env.variables && env.variables[name] !== undefined) return env.variables[name];
        if (missing.indexOf(name) === -1) missing.push(name);
        return match;
    });
    return { text: out, missing: missing };
}

/* ===================== URL HELPERS ===================== */
function hasScheme(url) { return /^[a-z][a-z0-9+.-]*:\/\//i.test(url); }

/* Adds http:// for local hosts and https:// for anything that looks like a domain. */
function withScheme(raw) {
    if (!raw || hasScheme(raw) || /^\{\{/.test(raw)) return raw;
    if (/^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])(:\d+)?([\/?#]|$)/i.test(raw)) return 'http://' + raw;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([\/?#]|$)/i.test(raw) || /^[a-z0-9-]+:\d+([\/?#]|$)/i.test(raw)) return 'https://' + raw;
    return raw;
}

function splitUrl(url) {
    url = String(url || '');
    var hashIndex = url.indexOf('#');
    var hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    var rest = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    var queryIndex = rest.indexOf('?');
    return {
        base: queryIndex >= 0 ? rest.slice(0, queryIndex) : rest,
        query: queryIndex >= 0 ? rest.slice(queryIndex + 1) : null,
        hash: hash
    };
}

function parseQueryString(query) {
    if (!query) return [];
    return query.split('&').filter(Boolean).map(function (pair) {
        var eq = pair.indexOf('=');
        return { key: eq >= 0 ? pair.slice(0, eq) : pair, value: eq >= 0 ? pair.slice(eq + 1) : '', enabled: true };
    });
}

/* Only the characters that would break the query structure are encoded,
   so what the user typed (including {{variables}}) stays readable. */
function encodeQueryPart(text, isKey) {
    return String(text).replace(isKey ? /[&#=\s]/g : /[&#\s]/g, function (c) { return encodeURIComponent(c); });
}

function buildQuery(rows) {
    return rows
        .filter(function (row) { return row.enabled !== false && (String(row.key).trim() || String(row.value).trim()); })
        .map(function (row) { return encodeQueryPart(row.key, true) + (row.value !== '' ? '=' + encodeQueryPart(row.value, false) : ''); })
        .join('&');
}

function urlWithQuery(url, rows) {
    var parts = splitUrl(url);
    var query = buildQuery(rows);
    return parts.base + (query ? '?' + query : '') + parts.hash;
}

/* Inspects the URL as typed: variables, scheme and syntax. */
function analyseUrl(raw) {
    var result = { level: '', message: '', missing: [], resolved: '', hasVars: false };
    if (!raw) return result;
    if (/^curl\s/i.test(raw)) {
        result.level = 'info';
        result.message = 'This looks like a cURL command. Press Enter to import it.';
        return result;
    }
    var resolved = resolveVars(raw);
    result.hasVars = /\{\{\w+\}\}/.test(raw);
    result.missing = resolved.missing;
    result.resolved = resolved.text;
    if (resolved.missing.length) return result;

    var candidate = resolved.text;
    if (!hasScheme(candidate)) {
        var fixed = withScheme(candidate);
        if (fixed !== candidate && !/^\{\{/.test(raw)) {
            result.level = 'info';
            result.message = 'No scheme given, so ' + fixed.split('://')[0] + ':// will be added when you send.';
            candidate = fixed;
        } else if (/^\{\{/.test(raw)) {
            result.level = 'error';
            result.message = 'The variable at the start resolves to "' + candidate.slice(0, 60) + '", which has no http:// or https:// scheme.';
            return result;
        } else {
            result.level = 'error';
            result.message = 'Include the scheme, for example https://api.example.com/users';
            return result;
        }
    }
    try {
        var parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            result.level = 'error';
            result.message = 'Only http:// and https:// URLs can be sent.';
        }
    } catch (error) {
        result.level = 'error';
        result.message = 'This URL could not be parsed. Check for spaces or stray characters.';
    }
    return result;
}

/* Inline and non-blocking: it explains the problem without preventing typing. */
function validateUrlField() {
    var input = $('url');
    var note = $('urlError');
    if (!input || !note) return true;
    var raw = input.value.trim();
    var analysis = analyseUrl(raw);
    var invalid = analysis.level === 'error';

    $('urlGroup').classList.toggle('invalid', invalid);
    // Announce validity to assistive tech, not just with a colour.
    if (invalid) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'urlError');
    } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
    }
    note.textContent = analysis.message;
    note.className = 'url-error hint-line' + (invalid ? ' error' : '');

    var vars = $('urlVars');
    vars.innerHTML = '';
    if (analysis.missing.length) {
        vars.innerHTML = iconSvg('alert');
        var env = activeEnv();
        vars.appendChild(make('span', '', env ? 'Not defined in "' + env.name + '":' : 'No environment is selected, so these are not replaced:'));
        analysis.missing.forEach(function (name) {
            var chip = makeButton('var-chip', '{{' + name + '}}', function () { openEnvModal({ addVar: name }); });
            chip.title = 'Define ' + name;
            vars.appendChild(chip);
        });
        vars.hidden = false;
    } else {
        vars.hidden = true;
    }

    var showPreview = analysis.hasVars && !analysis.missing.length && !invalid;
    $('urlPreviewLine').hidden = !showPreview;
    if (showPreview) $('urlPreview').textContent = analysis.resolved;
    return Boolean(raw) && !invalid && !analysis.missing.length;
}

/* ===================== REQUEST MODEL ===================== */
function blankRequest() {
    return {
        method: 'GET', url: '', requestType: 'rest',
        params: [], headers: [],
        bodyType: 'json', body: '',
        auth: { type: '', token: '', username: '', password: '', keyName: '', keyValue: '', keyLocation: 'header' },
        graphql: { query: '', variables: '', operationName: '' },
        settings: {
            timeout: '', retries: '0', retryDelay: '500', retryStatusCodes: '429,502,503,504',
            followRedirects: true, maxRedirects: '5', sslVerify: true,
            proxyHost: '', proxyPort: '', proxyUsername: '', proxyPassword: ''
        }
    };
}

function mergeRequest(base, partial) {
    var out = clone(base);
    if (!partial) return out;
    Object.keys(partial).forEach(function (key) {
        var value = partial[key];
        if (value === undefined || value === null) return;
        if ((key === 'auth' || key === 'graphql' || key === 'settings') && typeof value === 'object') {
            Object.keys(value).forEach(function (inner) { if (value[inner] !== undefined) out[key][inner] = value[inner]; });
        } else {
            out[key] = clone(value);
        }
    });
    return out;
}

function guessBodyType(body) {
    var text = String(body || '').trim();
    if (!text) return 'json';
    try { JSON.parse(text); return 'json'; } catch (error) { /* not JSON */ }
    if (/^[^{<\s][^\s]*=[^\s]*(&[^\s]*=[^\s]*)*$/.test(text)) return 'form-urlencoded';
    return 'text';
}

function rowsFromObject(object) {
    return Object.keys(object || {}).map(function (key) { return { key: key, value: String(object[key]), enabled: true }; });
}

function enabledObject(rows) {
    var out = {};
    (rows || []).forEach(function (row) {
        if (row.enabled !== false && String(row.key).trim()) out[String(row.key).trim()] = String(row.value).trim();
    });
    return out;
}

/* ===================== TABS ===================== */
function createTab(init) {
    init = init || {};
    var tab = {
        id: 'tab' + (++tabSeq) + '-' + Date.now().toString(36),
        name: init.name || '',
        savedId: init.savedId || null,
        folder: init.folder || '',
        req: mergeRequest(blankRequest(), init.req),
        response: init.response || null,
        configTab: init.configTab || 'params',
        baseline: null
    };
    tab.baseline = init.dirty ? null : signature(tab);
    return tab;
}

function signature(tab) {
    var r = tab.req;
    return JSON.stringify([tab.name, r.method, r.url, r.requestType, r.params, r.headers, r.bodyType, r.body, r.graphql, r.auth && r.auth.type]);
}
var BLANK_SIGNATURE = null;
function isDirty(tab) { return tab.baseline === null || signature(tab) !== tab.baseline; }
function isPristine(tab) {
    if (!BLANK_SIGNATURE) BLANK_SIGNATURE = signature({ name: '', req: blankRequest() });
    return !tab.savedId && !tab.response && signature(tab) === BLANK_SIGNATURE;
}

function activeTab() {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeTabId) return tabs[i];
    return null;
}
function tabById(id) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
    return null;
}

function pathOf(url) {
    var resolved = resolveVars(url).text;
    try {
        var parsed = new URL(withScheme(resolved));
        return parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : parsed.host;
    } catch (error) {
        var stripped = splitUrl(String(url).replace(/^\{\{\w+\}\}/, '')).base;
        return stripped || String(url);
    }
}
function derivedName(req) {
    if (!req.url || !req.url.trim()) return 'Untitled request';
    return pathOf(req.url.trim());
}
function displayName(tab) { return tab.name || derivedName(tab.req); }

/* Copies the form into the active tab's model. */
function commitActive() {
    var tab = activeTab();
    if (tab) tab.req = readForm();
    return tab;
}

function switchTab(id) {
    commitActive();
    var tab = tabById(id);
    if (!tab) return;
    activeTabId = id;
    writeForm(tab.req);
    setConfigTab(tab.configTab || 'params');
    clearSearch();
    renderReqHead();
    renderTabs();
    var activeEl = $('reqTabs').querySelector('.req-tab.active');
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    renderResponse();
    persist();
}

function openInTab(init) {
    if (init.savedId) {
        var existing = tabs.filter(function (t) { return t.savedId === init.savedId; })[0];
        if (existing) { switchTab(existing.id); return existing; }
    }
    commitActive();
    var current = activeTab();
    var tab = createTab(init);
    if (current && isPristine(current) && current.id !== inflightTabId) {
        tabs[tabs.indexOf(current)] = tab;
    } else {
        tabs.push(tab);
    }
    switchTab(tab.id);
    return tab;
}

function newTab() {
    commitActive();
    var tab = createTab();
    tabs.push(tab);
    switchTab(tab.id);
    showView('request');
    $('url').focus();
}

function duplicateActive() {
    var source = commitActive();
    if (!source) return;
    var tab = createTab({ req: clone(source.req), name: (displayName(source) + ' copy'), folder: '', dirty: true });
    tabs.splice(tabs.indexOf(source) + 1, 0, tab);
    switchTab(tab.id);
    toast('Duplicated into a new tab', 'success');
}

function closeTab(id) {
    var index = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) index = i;
    if (index < 0) return;
    if (id === activeTabId) commitActive();
    var tab = tabs[index];
    if (id === inflightTabId && isRequestInProgress) vscode.postMessage({ command: 'cancelRequest' });

    tabs.splice(index, 1);
    var replacement = null;
    if (!tabs.length) { replacement = createTab(); tabs.push(replacement); }
    if (id === activeTabId) {
        activeTabId = null;
        switchTab(tabs[Math.min(index, tabs.length - 1)].id);
    } else {
        renderTabs();
        persist();
    }

    if (isDirty(tab) && !isPristine(tab)) {
        toast('Closed "' + displayName(tab) + '"', 'info', {
            label: 'Undo',
            run: function () {
                if (replacement && tabs.length === 1 && isPristine(tabs[0])) tabs = [];
                tabs.splice(Math.min(index, tabs.length), 0, tab);
                switchTab(tab.id);
            }
        });
    }
}

function renderTabs() {
    var host = $('reqTabs');
    host.innerHTML = '';
    tabs.forEach(function (tab) {
        var wrap = make('div', 'req-tab' + (tab.id === activeTabId ? ' active' : ''));
        var main = make('button', 'req-tab-main');
        main.type = 'button';
        main.setAttribute('role', 'tab');
        main.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false');
        main.tabIndex = tab.id === activeTabId ? 0 : -1;
        main.dataset.id = tab.id;
        var name = displayName(tab);
        main.title = (tab.folder ? tab.folder + ' / ' : '') + name + (tab.req.url ? '\n' + tab.req.method + ' ' + tab.req.url : '');

        if (tab.id === inflightTabId && isRequestInProgress) {
            var busy = make('span', 'spinner req-tab-busy');
            busy.setAttribute('aria-label', 'Sending');
            main.appendChild(busy);
        }
        var method = tab.req.requestType === 'graphql' ? 'GQL' : tab.req.method;
        main.appendChild(make('span', 'req-tab-method m-' + (tab.req.requestType === 'graphql' ? 'PATCH' : tab.req.method), method));
        main.appendChild(make('span', 'req-tab-name', name));
        if (isDirty(tab) && !isPristine(tab)) {
            var dot = make('span', 'req-tab-dirty');
            dot.title = 'Unsaved changes';
            main.appendChild(dot);
        }
        main.addEventListener('click', function () { if (tab.id !== activeTabId) switchTab(tab.id); showView('request'); });
        wrap.addEventListener('auxclick', function (event) { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } });

        var close = makeButton('req-tab-close', '', function () { closeTab(tab.id); }, 'close');
        close.title = 'Close tab';
        close.setAttribute('aria-label', 'Close ' + name);
        close.tabIndex = -1;

        wrap.appendChild(main);
        wrap.appendChild(close);
        host.appendChild(wrap);
    });
}

function renderReqHead() {
    var tab = activeTab();
    if (!tab) return;
    var nameInput = $('reqName');
    if (document.activeElement !== nameInput) nameInput.value = tab.name;
    nameInput.placeholder = derivedName(tab.req);
    $('reqFolder').textContent = tab.savedId ? (tab.folder || 'Default') : '';
    var dirty = isDirty(tab) && !isPristine(tab);
    $('reqDirty').hidden = !dirty || !tab.savedId;
    $('saveRequestLabel').textContent = tab.savedId ? (dirty ? 'Save' : 'Saved') : 'Save';
    $('saveRequestBtn').title = tab.savedId
        ? 'Save changes to "' + (tab.folder || 'Default') + ' / ' + displayName(tab) + '" (Ctrl/Cmd+S)'
        : 'Save to a collection (Ctrl/Cmd+S)';
}

var persist = debounce(function () {
    try {
        commitActive();
        vscode.setState({
            v: 1,
            activeTabId: activeTabId,
            prefs: prefs,
            tabs: tabs.map(function (tab) {
                return {
                    id: tab.id, name: tab.name, savedId: tab.savedId, folder: tab.folder,
                    req: tab.req, configTab: tab.configTab, baseline: tab.baseline,
                    response: compactResponse(tab.response)
                };
            })
        });
    } catch (error) {
        /* State persistence is a convenience; never break the page over it. */
    }
}, 300);

function compactResponse(response) {
    if (!response || response.state === 'pending') return null;
    if (response.state !== 'ok') return response;
    var text = typeof response.data === 'string' ? response.data : (JSON.stringify(response.data) || '');
    if (text.length <= PERSIST_RESPONSE_LIMIT) return response;
    var copy = {};
    Object.keys(response).forEach(function (key) { copy[key] = response[key]; });
    copy.data = null;
    copy.dropped = true;
    return copy;
}

/* Called after any edit: updates badges, the tab strip and saved state. */
var refreshAfterEdit = debounce(function () {
    commitActive();
    renderReqHead();
    renderTabs();
    persist();
}, 120);
function markChanged() {
    updateCounts();
    refreshAfterEdit();
}

/* ===================== FORM <-> MODEL ===================== */
function readForm() {
    return {
        method: methodSelect.value,
        url: $('url').value,
        requestType: currentRequestType,
        params: kvRead('paramsContainer'),
        headers: kvRead('headersContainer'),
        bodyType: currentBodyType,
        body: $('body').value,
        auth: {
            type: $('authType').value,
            token: $('authToken').value,
            username: $('username').value,
            password: $('password').value,
            keyName: $('apiKeyName').value,
            keyValue: $('apiKeyValue').value,
            keyLocation: $('apiKeyLocation').value
        },
        graphql: {
            query: $('graphqlQuery').value,
            variables: $('graphqlVariables').value,
            operationName: $('graphqlOperationName').value
        },
        settings: {
            timeout: $('timeout').value,
            retries: $('retries').value,
            retryDelay: $('retryDelay').value,
            retryStatusCodes: $('retryStatusCodes').value,
            followRedirects: $('followRedirects').checked,
            maxRedirects: $('maxRedirects').value,
            sslVerify: $('sslVerify').checked,
            proxyHost: $('proxyHost').value,
            proxyPort: $('proxyPort').value,
            proxyUsername: $('proxyUsername').value,
            proxyPassword: $('proxyPassword').value
        }
    };
}

function writeForm(req) {
    req = mergeRequest(blankRequest(), req);
    methodSelect.value = req.method || 'GET';
    if (!methodSelect.value) methodSelect.value = 'GET';
    updateMethodColor();
    $('url').value = req.url || '';
    setRequestType(req.requestType || 'rest', true);

    Object.keys(bulkMode).forEach(function (id) { if (bulkMode[id]) setBulk(id, false, true); });
    kvRender('paramsContainer', req.params);
    kvRender('headersContainer', req.headers);

    setBodyType(req.bodyType || 'json', true);
    $('body').value = req.body || '';

    var auth = req.auth;
    $('authType').value = auth.type || '';
    $('authToken').value = auth.token || '';
    $('username').value = auth.username || '';
    $('password').value = auth.password || '';
    $('apiKeyName').value = auth.keyName || '';
    $('apiKeyValue').value = auth.keyValue || '';
    $('apiKeyLocation').value = auth.keyLocation || 'header';
    updateAuthFields();

    $('graphqlQuery').value = req.graphql.query || '';
    $('graphqlVariables').value = req.graphql.variables || '';
    $('graphqlOperationName').value = req.graphql.operationName || '';

    var s = req.settings;
    $('timeout').value = s.timeout || '';
    $('retries').value = s.retries === undefined ? '0' : s.retries;
    $('retryDelay').value = s.retryDelay === undefined ? '500' : s.retryDelay;
    $('retryStatusCodes').value = s.retryStatusCodes === undefined ? '429,502,503,504' : s.retryStatusCodes;
    $('followRedirects').checked = s.followRedirects !== false;
    $('maxRedirects').value = s.maxRedirects === undefined ? '5' : s.maxRedirects;
    $('sslVerify').checked = s.sslVerify !== false;
    $('proxyHost').value = s.proxyHost || '';
    $('proxyPort').value = s.proxyPort || '';
    $('proxyUsername').value = s.proxyUsername || '';
    $('proxyPassword').value = s.proxyPassword || '';

    updateCounts();
    validateUrlField();
    validateBody();
    validateGraphqlVariables();
    updateBodyHints();
}

/* The message the host's testAPI / generateCurl handlers expect. */
function buildRequestPayload(req) {
    req = req || readForm();
    var s = req.settings || {};
    var auth = req.auth || {};
    var gql = req.graphql || {};
    var timeout = parseInt(s.timeout, 10);
    var retryDelay = parseInt(s.retryDelay, 10);
    var proxyHost = String(s.proxyHost || '').trim();
    var isGraphql = req.requestType === 'graphql';
    return {
        method: req.method,
        url: withScheme(String(req.url || '').trim()),
        data: isGraphql || req.bodyType === 'none' ? '' : String(req.body || '').trim(),
        // Query parameters live in the URL itself, kept in sync with the Params tab.
        params: {},
        headers: enabledObject(req.headers),
        authType: auth.type || '',
        authToken: auth.token,
        username: auth.username,
        password: auth.password,
        apiKeyName: auth.keyName,
        apiKeyValue: auth.keyValue,
        apiKeyLocation: auth.keyLocation || 'header',
        // Empty means "use the devsnip.apiTimeout setting".
        timeout: timeout > 0 ? timeout : undefined,
        requestType: isGraphql ? 'graphql' : 'rest',
        graphqlQuery: String(gql.query || '').trim(),
        graphqlVariables: String(gql.variables || '').trim(),
        graphqlOperationName: String(gql.operationName || '').trim(),
        bodyType: req.bodyType === 'none' ? 'json' : req.bodyType,
        retries: parseInt(s.retries, 10) || 0,
        retryDelay: isNaN(retryDelay) ? 500 : retryDelay,
        retryStatusCodes: String(s.retryStatusCodes || '').split(',')
            .map(function (part) { return parseInt(part.trim(), 10); })
            .filter(function (n) { return !isNaN(n); }),
        followRedirects: s.followRedirects !== false,
        maxRedirects: isNaN(parseInt(s.maxRedirects, 10)) ? 5 : parseInt(s.maxRedirects, 10),
        rejectUnauthorized: s.sslVerify !== false,
        proxy: proxyHost ? {
            host: proxyHost,
            port: parseInt(s.proxyPort, 10) || 8080,
            auth: s.proxyUsername ? { username: s.proxyUsername, password: s.proxyPassword || '' } : undefined
        } : undefined
    };
}

/* ===================== KEY / VALUE EDITOR ===================== */
var HEADER_VALUE_LISTS = { 'content-type': 'dlMime', 'accept': 'dlMime', 'cache-control': 'dlCacheControl', 'authorization': 'dlAuthorization' };

function kvAddRow(containerId, key, value, enabled) {
    var host = $(containerId);
    if (!host) return null;
    var rowEl = make('div', 'kv-row');

    var toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'kv-toggle';
    toggle.checked = enabled !== false;
    toggle.title = 'Include this entry in the request';
    toggle.setAttribute('aria-label', 'Include this entry in the request');

    var keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'input kv-key';
    keyInput.placeholder = containerId === 'headersContainer' ? 'Header' : containerId === 'envVarsContainer' ? 'variable' : 'Key';
    keyInput.value = key || '';
    keyInput.spellcheck = false;
    keyInput.setAttribute('aria-label', containerId === 'envVarsContainer' ? 'Variable name' : 'Key');
    if (containerId === 'headersContainer') keyInput.setAttribute('list', 'dlHeaderNames');

    var valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'input kv-value';
    valueInput.placeholder = 'Value';
    valueInput.value = value || '';
    valueInput.spellcheck = false;
    valueInput.setAttribute('aria-label', 'Value');

    var remove = makeButton('kv-icon', '', null, 'close');
    remove.title = 'Remove this entry';
    remove.setAttribute('aria-label', 'Remove this entry');
    remove.addEventListener('click', function () {
        var next = rowEl.nextElementSibling;
        rowEl.remove();
        kvChanged(containerId);
        var focusTarget = next && next.querySelector('.kv-key');
        if (focusTarget) focusTarget.focus();
    });

    function syncRow() {
        rowEl.classList.toggle('disabled', !toggle.checked);
        rowEl.classList.toggle('placeholder', !keyInput.value && !valueInput.value);
        if (containerId === 'headersContainer') {
            var list = HEADER_VALUE_LISTS[keyInput.value.trim().toLowerCase()];
            if (list) valueInput.setAttribute('list', list); else valueInput.removeAttribute('list');
        }
    }
    toggle.addEventListener('change', function () { syncRow(); kvChanged(containerId); });
    keyInput.addEventListener('input', function () { syncRow(); kvChanged(containerId); });
    valueInput.addEventListener('input', function () { syncRow(); kvChanged(containerId); });

    rowEl.appendChild(toggle);
    rowEl.appendChild(keyInput);
    rowEl.appendChild(valueInput);
    rowEl.appendChild(remove);
    host.appendChild(rowEl);
    syncRow();
    return rowEl;
}

/* There is always one empty row at the end, so adding an entry is just typing. */
function ensureTrailingRow(containerId) {
    var host = $(containerId);
    if (!host) return;
    var last = host.lastElementChild;
    if (!last || last.querySelector('.kv-key').value || last.querySelector('.kv-value').value) {
        kvAddRow(containerId);
    }
}

function kvRender(containerId, rows) {
    var host = $(containerId);
    if (!host) return;
    host.innerHTML = '';
    (rows || []).forEach(function (row) { kvAddRow(containerId, row.key, row.value, row.enabled); });
    ensureTrailingRow(containerId);
}

function kvRead(containerId) {
    if (bulkMode[containerId]) return parseBulk($(bulkAreaId(containerId)).value);
    var out = [];
    document.querySelectorAll('#' + containerId + ' .kv-row').forEach(function (rowEl) {
        var key = rowEl.querySelector('.kv-key').value;
        var value = rowEl.querySelector('.kv-value').value;
        if (!key.trim() && !value.trim()) return;
        out.push({ key: key, value: value, enabled: rowEl.querySelector('.kv-toggle').checked });
    });
    return out;
}

/* Enabled entries with a key, as a plain object. */
function collectKV(containerId) { return enabledObject(kvRead(containerId)); }

function kvChanged(containerId) {
    ensureTrailingRow(containerId);
    if (containerId === 'paramsContainer') syncUrlFromParams();
    if (containerId === 'headersContainer') updateBodyHints();
    if (containerId === 'envVarsContainer') return;
    markChanged();
}

function bulkAreaId(containerId) { return containerId === 'paramsContainer' ? 'paramsBulk' : 'headersBulk'; }
function kvToBulk(rows) {
    return rows.map(function (row) { return (row.enabled === false ? '// ' : '') + row.key + ': ' + row.value; }).join('\n');
}
function parseBulk(text) {
    var rows = [];
    String(text || '').split('\n').forEach(function (line) {
        var trimmed = line.trim();
        if (!trimmed) return;
        var enabled = true;
        if (trimmed.indexOf('//') === 0) { enabled = false; trimmed = trimmed.slice(2).trim(); }
        var colon = trimmed.indexOf(':');
        var eq = trimmed.indexOf('=');
        var at = colon >= 0 ? colon : eq;
        rows.push(at >= 0
            ? { key: trimmed.slice(0, at).trim(), value: trimmed.slice(at + 1).trim(), enabled: enabled }
            : { key: trimmed, value: '', enabled: enabled });
    });
    return rows;
}
function setBulk(containerId, on, silent) {
    var area = $(bulkAreaId(containerId));
    var button = document.querySelector('[data-bulk="' + containerId + '"]');
    if (on === bulkMode[containerId]) return;
    if (on) {
        area.value = kvToBulk(kvRead(containerId));
        bulkMode[containerId] = true;
    } else {
        var rows = parseBulk(area.value);
        bulkMode[containerId] = false;
        kvRender(containerId, rows);
    }
    $(containerId).hidden = on;
    area.hidden = !on;
    var head = $(containerId).previousElementSibling;
    if (head && head.classList.contains('kv-head')) head.hidden = on;
    if (button) button.textContent = on ? 'Key-value edit' : 'Bulk edit';
    if (!silent && on) area.focus();
}

/* ===================== PARAMS <-> URL ===================== */
function syncParamsFromUrl() {
    var parsed = parseQueryString(splitUrl($('url').value).query);
    // Disabled rows only exist in the table, so they survive URL edits.
    var disabled = kvRead('paramsContainer').filter(function (row) { return row.enabled === false; });
    var rows = parsed.concat(disabled);
    if (bulkMode.paramsContainer) $('paramsBulk').value = kvToBulk(rows);
    else kvRender('paramsContainer', rows);
    updateCounts();
}
function syncUrlFromParams() {
    var input = $('url');
    var next = urlWithQuery(input.value, kvRead('paramsContainer'));
    if (next !== input.value) {
        input.value = next;
        validateUrlField();
    }
}

/* ===================== COUNTS AND DOTS ===================== */
function updateCounts() {
    var params = kvRead('paramsContainer').filter(function (r) { return r.enabled !== false && r.key.trim(); }).length;
    var headers = kvRead('headersContainer').filter(function (r) { return r.enabled !== false && r.key.trim(); }).length;
    $('paramCount').textContent = params;
    $('headerCount').textContent = headers;
    $('bodyDot').hidden = currentBodyType === 'none' || !$('body').value.trim();
    $('graphqlDot').hidden = !$('graphqlQuery').value.trim();
    $('authDot').hidden = !$('authType').value;
    var s = readForm().settings;
    var custom = Boolean(s.timeout) || (parseInt(s.retries, 10) || 0) > 0 || !s.followRedirects || !s.sslVerify || Boolean(String(s.proxyHost).trim());
    $('settingsDot').hidden = !custom;
}

/* ===================== METHOD + PROTOCOL ===================== */
function updateMethodColor() {
    methodSelect.className = 'method-select m-' + methodSelect.value;
}

function setRequestType(type, silent) {
    currentRequestType = type === 'graphql' ? 'graphql' : 'rest';
    document.querySelectorAll('.type-tab').forEach(function (tab) {
        var on = tab.dataset.type === currentRequestType;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    });
    var isGraphql = currentRequestType === 'graphql';
    $('graphqlTab').hidden = !isGraphql;
    $('bodyTabBtn').hidden = isGraphql;
    var tab = activeTab();
    var current = tab ? tab.configTab : 'params';
    if (isGraphql && current === 'body') setConfigTab('graphql');
    if (!isGraphql && current === 'graphql') setConfigTab('body');
    if (!silent) {
        if (isGraphql && (methodSelect.value === 'GET' || methodSelect.value === 'HEAD')) {
            methodSelect.value = 'POST';
            updateMethodColor();
            toast('GraphQL queries are sent as a POST body, so the method was set to POST', 'info');
        }
        if (isGraphql) setConfigTab('graphql');
        markChanged();
    }
    updateBodyHints();
}

function setConfigTab(name) {
    var button = document.querySelector('.config-tab[data-tab="' + name + '"]');
    if (!button || button.hidden) {
        name = 'params';
        button = document.querySelector('.config-tab[data-tab="params"]');
    }
    setTabSelected(document.querySelectorAll('.config-tab'), button);
    document.querySelectorAll('.config-content').forEach(function (content) {
        content.classList.toggle('active', content.id === 'tab-' + name);
    });
    var tab = activeTab();
    if (tab) tab.configTab = name;
}

/* Keeps the visual state and the accessible state in step. */
function setTabSelected(tabList, active) {
    Array.prototype.forEach.call(tabList, function (t) {
        var isActive = t === active;
        t.classList.toggle('active', isActive);
        if (t.getAttribute('role') === 'tab') {
            t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            t.tabIndex = isActive ? 0 : -1;
        }
    });
}

/* ===================== BODY ===================== */
var BODY_PLACEHOLDERS = {
    json: '{ "key": "value" }',
    text: 'Plain text body',
    'form-urlencoded': 'name=Ada&role=admin   (or a JSON object, which is encoded for you)'
};

function setBodyType(type, silent) {
    currentBodyType = ['none', 'json', 'text', 'form-urlencoded'].indexOf(type) >= 0 ? type : 'json';
    document.querySelectorAll('.body-type-btn').forEach(function (button) {
        var on = button.dataset.bodyType === currentBodyType;
        button.classList.toggle('active', on);
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('bodyEditor').hidden = currentBodyType === 'none';
    $('bodyNone').hidden = currentBodyType !== 'none';
    $('bodyActions').hidden = currentBodyType === 'none';
    $('minifyJson').hidden = currentBodyType !== 'json';
    $('body').placeholder = BODY_PLACEHOLDERS[currentBodyType] || '';
    validateBody();
    updateBodyHints();
    if (!silent) markChanged();
}

/* Offset of the first syntax error in a JSON text, or -1. Browsers do not
   always include a position in JSON.parse errors, so this finds it. */
function jsonErrorOffset(text) {
    var i = 0;
    var n = text.length;
    function ws() { while (i < n && ' \t\n\r'.indexOf(text[i]) >= 0) i++; }
    function fail() { throw i; }
    function str() {
        i++;
        while (i < n) {
            var ch = text[i];
            if (ch === '\\') { i += 2; continue; }
            if (ch === '"') { i++; return; }
            if (ch < ' ') fail();
            i++;
        }
        fail();
    }
    function value() {
        ws();
        var c = text[i];
        if (c === '{') {
            i++; ws();
            if (text[i] === '}') { i++; return; }
            for (;;) {
                ws();
                if (text[i] !== '"') fail();
                str(); ws();
                if (text[i] !== ':') fail();
                i++;
                value(); ws();
                if (text[i] === ',') { i++; continue; }
                if (text[i] === '}') { i++; return; }
                fail();
            }
        }
        if (c === '[') {
            i++; ws();
            if (text[i] === ']') { i++; return; }
            for (;;) {
                value(); ws();
                if (text[i] === ',') { i++; continue; }
                if (text[i] === ']') { i++; return; }
                fail();
            }
        }
        if (c === '"') { str(); return; }
        var number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
        if (number && number[0]) { i += number[0].length; return; }
        if (text.substr(i, 4) === 'true' || text.substr(i, 4) === 'null') { i += 4; return; }
        if (text.substr(i, 5) === 'false') { i += 5; return; }
        fail();
    }
    try {
        value(); ws();
        if (i < n) fail();
        return -1;
    } catch (position) {
        return typeof position === 'number' ? position : -1;
    }
}

/* Turns a JSON.parse error into "Line 3, column 7: Unexpected token '}'". */
function jsonErrorLocation(error, text) {
    var message = String((error && error.message) || 'Invalid JSON');
    var clean = message
        .replace(/\s*\(line \d+ column \d+\)/, '')
        .replace(/ in JSON at position \d+/, '')
        .replace(/,\s*"[\s\S]*" is not valid JSON$/, '')
        .replace(/^JSON\.parse: /, '');
    var lineCol = /line (\d+) column (\d+)/.exec(message);
    if (lineCol) return 'Line ' + lineCol[1] + ', column ' + lineCol[2] + ': ' + clean;
    var position = /position (\d+)/.exec(message);
    var offset = position ? Number(position[1]) : jsonErrorOffset(text);
    if (offset < 0) return clean;
    var before = text.slice(0, offset);
    var line = before.split('\n').length;
    var column = before.length - before.lastIndexOf('\n');
    return 'Line ' + line + ', column ' + column + ': ' + clean;
}

/* Variables are replaced first, so {{id}} in a number position is not an error. */
function substituteForValidation(text) {
    var env = activeEnv();
    return String(text).replace(/\{\{(\w+)\}\}/g, function (match, name) {
        return env && env.variables && env.variables[name] !== undefined ? env.variables[name] : '0';
    });
}

function validateBody() {
    var field = $('body');
    var note = $('bodyNote');
    var text = field.value;
    if (currentBodyType !== 'json' || !text.trim()) {
        note.textContent = '';
        note.className = 'field-note';
        field.classList.remove('invalid');
        return true;
    }
    var candidate = substituteForValidation(text);
    try {
        JSON.parse(candidate);
        note.className = 'field-note ok';
        note.textContent = '✓ Valid JSON';
        field.classList.remove('invalid');
        return true;
    } catch (error) {
        note.className = 'field-note error';
        note.textContent = '✗ ' + jsonErrorLocation(error, candidate);
        field.classList.add('invalid');
        return false;
    }
}

function validateGraphqlVariables() {
    var field = $('graphqlVariables');
    var note = $('graphqlNote');
    if (!field.value.trim()) { note.textContent = ''; field.classList.remove('invalid'); return true; }
    var candidate = substituteForValidation(field.value);
    try {
        JSON.parse(candidate);
        note.className = 'field-note ok';
        note.textContent = '✓ Valid JSON';
        field.classList.remove('invalid');
        return true;
    } catch (error) {
        note.className = 'field-note error';
        note.textContent = '✗ ' + jsonErrorLocation(error, candidate);
        field.classList.add('invalid');
        return false;
    }
}

/* Explains what the host will do with the body for this method and type. */
function updateBodyHints() {
    var method = methodSelect.value;
    var warn = $('bodyWarn');
    warn.innerHTML = '';
    var hasBody = currentBodyType !== 'none' && $('body').value.trim();
    if (currentRequestType === 'rest' && hasBody && BODY_METHODS.indexOf(method) === -1) {
        warn.appendChild(make('span', '', method + ' requests are sent without a body, so this body will be ignored.'));
        warn.appendChild(makeButton('link-btn', 'Switch to POST', function () {
            methodSelect.value = 'POST';
            updateMethodColor();
            updateBodyHints();
            markChanged();
        }));
        warn.hidden = false;
    } else {
        warn.hidden = true;
    }

    var gqlWarn = $('graphqlWarn');
    gqlWarn.innerHTML = '';
    if (currentRequestType === 'graphql' && BODY_METHODS.indexOf(method) === -1) {
        gqlWarn.appendChild(make('span', '', 'GraphQL queries are sent in a POST body. With ' + method + ' the query is not sent.'));
        gqlWarn.appendChild(makeButton('link-btn', 'Use POST', function () {
            methodSelect.value = 'POST';
            updateMethodColor();
            updateBodyHints();
            markChanged();
        }));
        gqlWarn.hidden = false;
    } else {
        gqlWarn.hidden = true;
    }

    var ctNote = $('bodyCtNote');
    var hasContentType = kvRead('headersContainer').some(function (row) {
        return row.enabled !== false && row.key.trim().toLowerCase() === 'content-type';
    });
    var implied = { json: 'application/json', text: 'text/plain', 'form-urlencoded': 'application/x-www-form-urlencoded' }[currentBodyType];
    ctNote.textContent = implied && !hasContentType && hasBody ? 'Content-Type: ' + implied + ' is added automatically' : '';
}

/* Editor conveniences for the code textareas: Tab indents, Enter keeps the
   indentation, and Esc then Tab leaves the field for keyboard users. */
function wireCodeArea(area) {
    var escaped = false;
    area.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { escaped = true; return; }
        var plain = !event.ctrlKey && !event.metaKey && !event.altKey;
        if (event.key === 'Tab' && plain && !escaped) {
            event.preventDefault();
            var start = area.selectionStart, end = area.selectionEnd, value = area.value;
            if (event.shiftKey) {
                var lineStart = value.lastIndexOf('\n', start - 1) + 1;
                if (value.substr(lineStart, 2) === '  ') {
                    area.value = value.slice(0, lineStart) + value.slice(lineStart + 2);
                    area.selectionStart = area.selectionEnd = Math.max(lineStart, start - 2);
                }
            } else {
                area.value = value.slice(0, start) + '  ' + value.slice(end);
                area.selectionStart = area.selectionEnd = start + 2;
            }
            area.dispatchEvent(new Event('input'));
            return;
        }
        if (event.key === 'Enter' && plain && !event.shiftKey) {
            var pos = area.selectionStart;
            var text = area.value;
            var currentLine = text.slice(text.lastIndexOf('\n', pos - 1) + 1, pos);
            var indent = (/^\s*/.exec(currentLine) || [''])[0];
            var previous = text.slice(0, pos).replace(/\s+$/, '').slice(-1);
            if (previous === '{' || previous === '[') indent += '  ';
            if (indent) {
                event.preventDefault();
                area.value = text.slice(0, pos) + '\n' + indent + text.slice(area.selectionEnd);
                area.selectionStart = area.selectionEnd = pos + 1 + indent.length;
                area.dispatchEvent(new Event('input'));
            }
        }
        escaped = false;
    });
}

/* ===================== JSON / XML HELPERS ===================== */
function convertToJson(c) {
    c = c.trim();
    try { return JSON.parse(c); } catch (error) { /* try other formats */ }
    if (c.charAt(0) === '<' && c.charAt(c.length - 1) === '>') {
        var doc = new DOMParser().parseFromString(c, 'text/xml');
        if (!doc.getElementsByTagName('parsererror').length) {
            var nodeToJson = function (node) {
                var result = {};
                if (node.attributes && node.attributes.length) {
                    result['@attributes'] = {};
                    for (var a = 0; a < node.attributes.length; a++) result['@attributes'][node.attributes[a].name] = node.attributes[a].value;
                }
                for (var i = 0; i < node.childNodes.length; i++) {
                    var child = node.childNodes[i];
                    if (child.nodeType === 3) {
                        var t = child.textContent.trim();
                        if (t) { if (!Object.keys(result).length) return t; result['#text'] = t; }
                    } else if (child.nodeType === 1) {
                        var converted = nodeToJson(child);
                        if (result[child.nodeName]) {
                            if (!Array.isArray(result[child.nodeName])) result[child.nodeName] = [result[child.nodeName]];
                            result[child.nodeName].push(converted);
                        } else {
                            result[child.nodeName] = converted;
                        }
                    }
                }
                return result;
            };
            return nodeToJson(doc.documentElement);
        }
        throw new Error('the XML is not well formed');
    }
    if (c.indexOf('=') !== -1 && c.indexOf('{') === -1 && c.indexOf('<') === -1) {
        var out = {};
        c.split('&').forEach(function (pair) {
            var at = pair.indexOf('=');
            var k = at >= 0 ? pair.slice(0, at) : pair;
            var v = at >= 0 ? pair.slice(at + 1) : '';
            if (k) out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '));
        });
        return out;
    }
    throw new Error('it is not JSON, XML or form data');
}

function formatXml(xml) {
    var doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid XML');
    var serialized = new XMLSerializer().serializeToString(doc).replace(/>\s*</g, '>\n<');
    var depth = 0;
    return serialized.split('\n').map(function (line) {
        var t = line.trim();
        if (/^<\//.test(t)) depth--;
        var out = '  '.repeat(Math.max(0, depth)) + t;
        if (/^<[^!?\/]/.test(t) && !/\/>$/.test(t) && !/^<([\w:.-]+)[^>]*>.*<\/\1>$/.test(t)) depth++;
        return out;
    }).join('\n');
}

/* ===================== AUTH ===================== */
function maskSecret(value) {
    value = String(value || '');
    if (/^\{\{\w+\}\}$/.test(value.trim())) return value.trim();
    if (!value) return '';
    return value.length <= 4 ? '••••' : '••••' + value.slice(-4);
}

function updateAuthFields() {
    var type = $('authType').value;
    $('authNone').hidden = type !== '';
    $('authBearer').hidden = type !== 'Bearer';
    $('authBasic').hidden = type !== 'Basic';
    $('authApiKey').hidden = type !== 'ApiKey';
    updateAuthPreview();
}

function updateAuthPreview() {
    var type = $('authType').value;
    var preview = $('authPreview');
    var text = '';
    if (type === 'Bearer') {
        var token = $('authToken').value.trim();
        text = token ? 'Authorization: Bearer ' + maskSecret(token) : '';
    } else if (type === 'Basic') {
        var user = $('username').value;
        text = user ? 'Authorization: Basic base64(' + user + ':' + maskSecret($('password').value) + ')' : '';
    } else if (type === 'ApiKey') {
        var keyName = $('apiKeyName').value.trim();
        var keyValue = maskSecret($('apiKeyValue').value.trim());
        if (keyName) text = $('apiKeyLocation').value === 'query' ? '?' + keyName + '=' + keyValue : keyName + ': ' + keyValue;
    }
    preview.textContent = text;
    preview.hidden = !text;
}

/* ===================== SENDING ===================== */
function setRequestState(active) {
    isRequestInProgress = active;
    var sendBtn = $('sendRequest');
    var cancelBtn = $('cancelRequest');
    // Only Send is disabled, so the rest of the panel stays usable in flight.
    sendBtn.disabled = active;
    sendBtn.setAttribute('aria-busy', active ? 'true' : 'false');
    cancelBtn.classList.toggle('visible', active);
    sendBtn.querySelector('.spinner').classList.toggle('hidden', !active);
    sendBtn.querySelector('.btn-label').textContent = active ? 'Sending' : 'Send';
    if (!active) inflightTabId = null;
    renderTabs();
}

/* Variables outside the URL are sent literally when undefined; say so. */
function unresolvedOutsideUrl(req) {
    var texts = [];
    (req.headers || []).forEach(function (row) { if (row.enabled !== false) texts.push(row.key, row.value); });
    if (req.requestType === 'graphql') texts.push(req.graphql.query, req.graphql.variables);
    else if (req.bodyType !== 'none') texts.push(req.body);
    var a = req.auth || {};
    if (a.type === 'Bearer') texts.push(a.token);
    if (a.type === 'Basic') texts.push(a.username, a.password);
    if (a.type === 'ApiKey') texts.push(a.keyName, a.keyValue);
    var missing = [];
    texts.forEach(function (text) {
        resolveVars(text).missing.forEach(function (name) { if (missing.indexOf(name) === -1) missing.push(name); });
    });
    return missing;
}

function sendCurrentRequest() {
    if (isRequestInProgress) {
        toast('A request is already running. Cancel it or wait for it to finish.', 'warning');
        return;
    }
    showView('request');
    var urlInput = $('url');
    var raw = urlInput.value.trim();
    if (!raw) {
        $('urlError').textContent = 'Enter a URL to send, for example https://api.example.com/users';
        $('urlError').className = 'url-error hint-line error';
        urlInput.focus();
        return;
    }
    if (/^curl\s/i.test(raw)) { importCurl(raw, 'current'); return; }

    var analysis = analyseUrl(raw);
    if (analysis.missing.length || analysis.level === 'error') {
        validateUrlField();
        if (analysis.missing.length) {
            toast('Define ' + analysis.missing.map(function (n) { return '{{' + n + '}}'; }).join(', ') + ' before sending', 'warning', {
                label: 'Define', run: function () { openEnvModal({ addVar: analysis.missing[0] }); }
            });
        }
        urlInput.focus();
        return;
    }
    var fixed = withScheme(raw);
    if (fixed !== raw) {
        urlInput.value = fixed;
        validateUrlField();
    }
    if (currentRequestType === 'graphql' && !$('graphqlQuery').value.trim()) {
        setConfigTab('graphql');
        toast('Write a GraphQL query first', 'warning');
        $('graphqlQuery').focus();
        return;
    }

    var tab = commitActive();
    var missing = unresolvedOutsideUrl(tab.req);
    if (missing.length) {
        toast(missing.map(function (n) { return '{{' + n + '}}'; }).join(', ') + ' is not defined and will be sent as typed', 'warning');
    }

    inflightTabId = tab.id;
    tab.response = { state: 'pending', startedAt: Date.now(), method: tab.req.method, url: fixed };
    setRequestState(true);
    renderResponse();
    vscode.postMessage(Object.assign({ command: 'testAPI' }, buildRequestPayload(tab.req)));
}

function cancelCurrentRequest() {
    if (!isRequestInProgress) return;
    vscode.postMessage({ command: 'cancelRequest' });
}

/* ===================== RESPONSE: STATUS ===================== */
/* Conveys state with an icon and words as well as colour. */
function setStatus(kind, status, statusText) {
    var pill = $('statusCode');
    if (!pill) return;
    if (kind === 'idle') { pill.className = 'status-pill'; pill.textContent = 'Idle'; return; }
    if (kind === 'pending') { pill.className = 'status-pill'; pill.textContent = '○ Sending'; return; }
    if (kind === 'cancelled') { pill.className = 'status-pill'; pill.textContent = '■ Cancelled'; return; }
    if (kind === 'error') {
        pill.className = 'status-pill s0xx';
        pill.textContent = '✗ ' + (statusText || 'Request failed');
        return;
    }
    var family = Math.floor((status || 0) / 100);
    var glyph = family === 2 ? '✓' : family === 3 ? '↻' : family === 4 ? '⚠' : '✗';
    pill.className = 'status-pill s' + (family || 0) + 'xx';
    pill.textContent = glyph + ' ' + status + (statusText ? ' ' + statusText : '');
}

function setMetrics(time, size, attempts) {
    $('responseTime').textContent = time;
    $('responseSize').textContent = size;
    $('metricAttempts').hidden = !(attempts > 1);
    $('responseAttempts').textContent = attempts || 1;
}

function runAction(action) {
    if (action === 'env') { openEnvModal({}); return; }
    if (action === 'url') { $('url').focus(); return; }
    if (action) { showView('request'); setConfigTab(action); }
}

function renderStatusHint(response) {
    var hint = $('respHint');
    hint.innerHTML = '';
    var entry = STATUS_HINTS[response.status];
    if (!entry && response.status >= 400) {
        entry = response.status >= 500
            ? ['Server error', 'The server failed while handling the request.', '']
            : ['Client error', 'The server rejected the request. The response body may say why.', ''];
    }
    if (!entry) { hint.hidden = true; return; }
    hint.className = 'resp-hint' + (response.status >= 500 ? ' error' : '');
    hint.appendChild(make('strong', '', entry[0] + '.'));
    hint.appendChild(make('span', '', entry[1]));
    if (entry[2]) hint.appendChild(makeButton('link-btn', ACTION_LABELS[entry[2]], function () { runAction(entry[2]); }));
    hint.hidden = false;
}

/* ===================== RESPONSE: BODY ===================== */
function headerValue(headers, name) {
    if (!headers) return '';
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === name) {
            var value = headers[keys[i]];
            return Array.isArray(value) ? value.join(', ') : String(value);
        }
    }
    return '';
}

/* Picks how to show the body: JSON, markup or plain text. */
function analyseBody(response) {
    var data = response.data;
    var contentType = headerValue(response.headers, 'content-type').toLowerCase();
    if (data === undefined || data === null || data === '') return { kind: 'empty', text: '' };
    if (typeof data !== 'string') return { kind: 'json', text: JSON.stringify(data, null, 2), label: 'JSON' };
    var trimmed = data.trim();
    if (/json/.test(contentType) || /^[\[{]/.test(trimmed)) {
        try { return { kind: 'json', text: JSON.stringify(JSON.parse(trimmed), null, 2), label: 'JSON' }; } catch (error) { /* not JSON */ }
    }
    if (/xml|html/.test(contentType) || /^</.test(trimmed)) {
        var isHtml = /html/.test(contentType) || /^<!doctype html|^<html/i.test(trimmed);
        var text = data;
        if (!isHtml) { try { text = formatXml(trimmed); } catch (error) { text = data; } }
        return { kind: 'markup', text: text, label: isHtml ? 'HTML' : 'XML' };
    }
    return { kind: 'text', text: data, label: contentType ? contentType.split(';')[0] : 'Text' };
}

function highlightJson(json) {
    var out = '';
    var i = 0;
    var len = json.length;
    while (i < len) {
        var ch = json[i];
        if (ch === '"') {
            var start = i;
            i++;
            while (i < len && json[i] !== '"') {
                if (json[i] === '\\') i++;
                i++;
            }
            i++;
            var j = i;
            while (j < len && (json[j] === ' ' || json[j] === '\t')) j++;
            out += '<span class="' + (json[j] === ':' ? 'json-key' : 'json-string') + '">' + escapeHtml(json.slice(start, i)) + '</span>';
        } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
            var numStart = i;
            i++;
            while (i < len && /[0-9eE.+\-]/.test(json[i])) i++;
            out += '<span class="json-number">' + json.slice(numStart, i) + '</span>';
        } else if (json.substr(i, 4) === 'true') {
            out += '<span class="json-boolean">true</span>'; i += 4;
        } else if (json.substr(i, 5) === 'false') {
            out += '<span class="json-boolean">false</span>'; i += 5;
        } else if (json.substr(i, 4) === 'null') {
            out += '<span class="json-null">null</span>'; i += 4;
        } else {
            var plainStart = i;
            while (i < len && '"-0123456789tfn'.indexOf(json[i]) === -1) i++;
            if (i === plainStart) i++;
            out += escapeHtml(json.slice(plainStart, i));
        }
    }
    return out;
}

function highlightMarkup(text) {
    return escapeHtml(text).replace(/(&lt;\/?)([\w:.-]+)([\s\S]*?)(\/?&gt;)/g, function (match, open, name, attrs, close) {
        var coloured = attrs.replace(/([\w:.-]+)=(&quot;[\s\S]*?&quot;)/g, '<span class="xml-attr">$1</span>=<span class="json-string">$2</span>');
        return '<span class="xml-tag">' + open + name + '</span>' + coloured + '<span class="xml-tag">' + close + '</span>';
    });
}

/* Beyond HIGHLIGHT_CHAR_BUDGET characters the payload is shown as plain text.
   Highlighting wraps every token in a span, so a multi-MB response would
   otherwise create tens of thousands of DOM nodes and make scrolling,
   searching and selection crawl. */
function highlight(text, options) {
    var kind = (options && options.kind) || 'json';
    if (typeof text !== 'string') text = JSON.stringify(text, null, 2);
    fullResponseText = text;
    fullResponseKind = kind;
    responseIsTruncated = false;

    if (!(options && options.force) && text.length > HIGHLIGHT_CHAR_BUDGET) {
        responseIsTruncated = true;
        var shown = text.slice(0, HIGHLIGHT_CHAR_BUDGET);
        var remaining = text.length - shown.length;
        return '<div class="response-notice" role="status">' +
            'Showing the first ' + Math.round(HIGHLIGHT_CHAR_BUDGET / 1000) + ' KB of a ' +
            (Math.round(text.length / 1000)).toLocaleString() + ' KB response as plain text, so the panel stays responsive. ' +
            '<button type="button" class="link-btn" id="renderFullResponse">Show the whole response</button>' +
            '</div><span class="plain-response">' + escapeHtml(shown) +
            '</span><div class="response-notice">' + remaining.toLocaleString() +
            ' more characters. Use Copy or Save to get the full payload.</div>';
    }
    if (kind === 'json') return highlightJson(text);
    if (kind === 'markup') return highlightMarkup(text);
    return escapeHtml(text);
}

/* The opt-in escape hatch for a payload above the render budget. */
function wireFullResponseButton() {
    var button = $('renderFullResponse');
    if (!button) return;
    button.addEventListener('click', function () {
        button.disabled = true;
        button.textContent = 'Rendering...';
        // Let the disabled state paint before the expensive work.
        setTimeout(function () {
            $('responseOutput').innerHTML = highlight(fullResponseText, { force: true, kind: fullResponseKind });
            applyResponseSearch();
        }, 16);
    });
}

function renderBody(response) {
    var output = $('responseOutput');
    var raw = $('responseRaw');
    var info = analyseBody(response);
    window.__lastResponseText = info.text;
    $('bodyKind').textContent = info.label || '';

    if (response.dropped) {
        output.innerHTML = '<div class="response-notice">This response was too large to keep after the panel reloaded. Send the request again to see it.</div>';
        raw.textContent = '';
    } else if (info.kind === 'empty') {
        output.innerHTML = '<div class="response-notice">The response has no body.</div>';
        raw.textContent = '';
    } else {
        output.innerHTML = (response.truncated
            ? '<div class="response-notice">The response was larger than 2 MB and was cut short. Save keeps what was received.</div>'
            : '') + highlight(info.text, { kind: info.kind });
        wireFullResponseButton();
        raw.textContent = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    }
    showBodyMode(prefs.bodyMode, true);
}

function showBodyMode(mode, silent) {
    prefs.bodyMode = mode === 'raw' ? 'raw' : 'pretty';
    document.querySelectorAll('.body-mode').forEach(function (button) {
        var on = button.dataset.mode === prefs.bodyMode;
        button.classList.toggle('active', on);
        button.setAttribute('aria-selected', on ? 'true' : 'false');
        button.tabIndex = on ? 0 : -1;
    });
    var tab = activeTab();
    var hasBody = tab && tab.response && tab.response.state === 'ok';
    $('responseOutput').hidden = !hasBody || prefs.bodyMode !== 'pretty';
    $('responseRaw').hidden = !hasBody || prefs.bodyMode !== 'raw';
    $('responseOutput').classList.toggle('nowrap', !prefs.wrap);
    $('responseRaw').classList.toggle('nowrap', !prefs.wrap);
    $('wrapToggle').setAttribute('aria-pressed', prefs.wrap ? 'true' : 'false');
    if (!silent) { applyResponseSearch(); persist(); }
}

/* ===================== RESPONSE: HEADERS + COOKIES ===================== */
function tableFrom(rows, columns) {
    var table = make('table', 'kv-table');
    var head = make('tr');
    columns.forEach(function (column) { head.appendChild(make('th', '', column)); });
    var thead = make('thead');
    thead.appendChild(head);
    table.appendChild(thead);
    var body = make('tbody');
    rows.forEach(function (cells) {
        var tr = make('tr');
        cells.forEach(function (cell, index) { tr.appendChild(make('td', index === 0 ? 'k' : (index === 2 ? 'attrs' : ''), cell)); });
        body.appendChild(tr);
    });
    table.appendChild(body);
    return table;
}

function renderResponseViews(response) {
    var headers = (response && response.headers) || {};
    var keys = Object.keys(headers).sort();
    $('respHeaderCount').textContent = keys.length;
    var headerHost = $('responseHeaders');
    headerHost.innerHTML = '';
    if (!keys.length) {
        headerHost.appendChild(make('div', 'empty-hint', response && response.state === 'ok' ? 'This response carried no headers.' : 'No response headers yet.'));
    } else {
        var tools = make('div', 'resp-table-tools');
        tools.appendChild(makeButton('btn btn-ghost btn-sm', 'Copy headers', function () {
            copyText(keys.map(function (key) { return key + ': ' + headerValue(headers, key.toLowerCase()); }).join('\n'), 'Headers copied');
        }, 'copy'));
        headerHost.appendChild(tools);
        headerHost.appendChild(tableFrom(keys.map(function (key) { return [key, headerValue(headers, key.toLowerCase())]; }), ['Name', 'Value']));
    }

    var raw = headers['set-cookie'] || headers['Set-Cookie'];
    var cookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    $('respCookieCount').textContent = cookies.length;
    var cookieHost = $('responseCookies');
    cookieHost.innerHTML = '';
    if (!cookies.length) {
        cookieHost.appendChild(make('div', 'empty-hint', 'This response did not set any cookies.'));
    } else {
        cookieHost.appendChild(tableFrom(cookies.map(function (cookie) {
            var parts = String(cookie).split(';');
            var first = parts.shift() || '';
            var eq = first.indexOf('=');
            return [eq >= 0 ? first.slice(0, eq).trim() : first.trim(), eq >= 0 ? first.slice(eq + 1).trim() : '', parts.map(function (p) { return p.trim(); }).join('; ')];
        }), ['Name', 'Value', 'Attributes']));
    }
}

function showRespTab(name) {
    activeRespTab = name;
    document.querySelectorAll('.resp-tab').forEach(function (tab) {
        var on = tab.dataset.resp === name;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.tabIndex = on ? 0 : -1;
    });
    ['body', 'headers', 'cookies'].forEach(function (view) {
        var el = $('resp-' + view);
        if (el) el.classList.toggle('active', view === name);
    });
    var tab = activeTab();
    $('respToolbar').hidden = name !== 'body' || !(tab && tab.response && tab.response.state === 'ok');
}

/* ===================== RESPONSE: STATES ===================== */
function emptyResponseState() {
    var wrap = make('div', 'empty-state');
    var glyph = make('div', 'glyph', '●');
    glyph.setAttribute('aria-hidden', 'true');
    wrap.appendChild(glyph);
    wrap.appendChild(make('h3', '', 'No response yet'));
    wrap.appendChild(make('p', '', 'Configure your request and select Send to see the response here.'));
    var tips = make('ul', 'tips');
    [
        ['Enter', ' in the URL bar, or Ctrl/Cmd+Enter anywhere, sends the request'],
        ['{{name}}', ' inserts a value from the active environment'],
        ['curl …', ' pasted into the URL bar is imported automatically']
    ].forEach(function (tip) {
        var li = make('li');
        li.appendChild(make('span', 'kbd', tip[0]));
        li.appendChild(make('span', '', tip[1]));
        tips.appendChild(li);
    });
    wrap.appendChild(tips);
    return wrap;
}

function stopElapsedTimer() {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function loadingState(response) {
    var wrap = make('div', 'loading-state');
    wrap.appendChild(make('div', 'spinner'));
    wrap.appendChild(make('div', 'target', response.method + ' ' + response.url));
    var elapsed = make('div', 'elapsed', '0.0 s');
    wrap.appendChild(elapsed);
    wrap.appendChild(makeButton('btn btn-ghost btn-sm', 'Cancel', cancelCurrentRequest, 'stop'));
    elapsedTimer = setInterval(function () {
        elapsed.textContent = ((Date.now() - response.startedAt) / 1000).toFixed(1) + ' s';
    }, 100);
    return wrap;
}

function stateCard(options) {
    var card = make('div', 'state-card' + (options.neutral ? ' neutral' : ''));
    var title = make('h3');
    title.innerHTML = iconSvg(options.icon || 'alert');
    title.appendChild(document.createTextNode(options.title));
    card.appendChild(title);
    if (options.hint) card.appendChild(make('p', '', options.hint));
    if (options.raw) card.appendChild(make('div', 'raw', options.raw));
    var actions = make('div', 'actions');
    (options.actions || []).forEach(function (action) {
        actions.appendChild(makeButton(action.primary ? 'btn btn-sm' : 'btn btn-ghost btn-sm', action.label, action.run, action.icon));
    });
    card.appendChild(actions);
    return card;
}

function renderResponse() {
    var tab = activeTab();
    var response = tab && tab.response;
    var stateHost = $('responseState');
    stopElapsedTimer();
    $('respHint').hidden = true;
    stateHost.innerHTML = '';
    stateHost.hidden = false;

    if (!response) {
        setStatus('idle');
        setMetrics('-', '-', 1);
        stateHost.appendChild(emptyResponseState());
    } else if (response.state === 'pending') {
        setStatus('pending');
        setMetrics('-', '-', 1);
        stateHost.appendChild(loadingState(response));
    } else if (response.state === 'cancelled') {
        setStatus('cancelled');
        setMetrics('-', '-', 1);
        stateHost.appendChild(stateCard({
            neutral: true, icon: 'stop', title: 'Request cancelled',
            hint: 'Nothing was received. Send again when you are ready.',
            actions: [{ label: 'Send again', primary: true, icon: 'retry', run: sendCurrentRequest }]
        }));
    } else if (response.state === 'error') {
        if (response.status) setStatus('http', response.status); else setStatus('error', 0, response.title || 'Request failed');
        setMetrics(response.responseTime ? formatMs(response.responseTime) : '-', '-', response.attempts);
        var actions = [{ label: 'Try again', primary: true, icon: 'retry', run: sendCurrentRequest }];
        if (response.action && ACTION_LABELS[response.action]) {
            actions.push({ label: ACTION_LABELS[response.action], run: function () { runAction(response.action); } });
        }
        var raw = response.error && response.error !== response.title ? response.error + (response.code ? '  (' + response.code + ')' : '') : '';
        stateHost.appendChild(stateCard({ title: response.title || 'Request failed', hint: response.hint, raw: raw, actions: actions }));
        if (response.data) {
            var extra = make('pre', 'response-output');
            extra.textContent = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
            stateHost.appendChild(extra);
        }
    } else {
        stateHost.hidden = true;
        setStatus('http', response.status, response.statusText);
        setMetrics(formatMs(response.responseTime), response.size || '-', response.attempts);
        renderStatusHint(response);
        renderBody(response);
    }

    if (!response || response.state !== 'ok') {
        $('responseOutput').hidden = true;
        $('responseRaw').hidden = true;
        window.__lastResponseText = response && response.state === 'error' && response.data
            ? (typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2))
            : (window.__lastResponseText || '');
    }
    renderResponseViews(response && response.state === 'ok' ? response : null);
    showRespTab(activeRespTab);
    if ($('responseSearch').value) applyResponseSearch();
}

/* ===================== RESPONSE SEARCH ===================== */
function searchTarget() { return prefs.bodyMode === 'raw' ? $('responseRaw') : $('responseOutput'); }

function clearMarks() {
    [$('responseOutput'), $('responseRaw')].forEach(function (host) {
        if (!host) return;
        var marks = host.querySelectorAll('mark');
        if (!marks.length) return;
        marks.forEach(function (mark) { mark.replaceWith(document.createTextNode(mark.textContent)); });
        host.normalize();
    });
    searchMarks = [];
    searchIndex = -1;
}

function clearSearch() {
    $('responseSearch').value = '';
    clearMarks();
    $('findCount').textContent = '';
}

function applyResponseSearch() {
    clearMarks();
    var term = $('responseSearch').value;
    var counter = $('findCount');
    var tab = activeTab();
    if (!term || !tab || !tab.response || tab.response.state !== 'ok') { counter.textContent = ''; return; }

    var host = searchTarget();
    var safe = term.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    var pattern = new RegExp(safe, 'gi');
    var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
        var text = node.nodeValue;
        pattern.lastIndex = 0;
        if (!pattern.test(text)) return;
        pattern.lastIndex = 0;
        var fragment = document.createDocumentFragment();
        var last = 0;
        var match;
        while ((match = pattern.exec(text)) !== null) {
            if (match.index > last) fragment.appendChild(document.createTextNode(text.slice(last, match.index)));
            var mark = document.createElement('mark');
            mark.textContent = match[0];
            fragment.appendChild(mark);
            searchMarks.push(mark);
            last = match.index + match[0].length;
            if (match[0].length === 0) pattern.lastIndex++;
        }
        if (last < text.length) fragment.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(fragment, node);
    });

    if (searchMarks.length) {
        gotoMatch(0);
    } else {
        counter.textContent = 'No results';
    }

    // The rendered view may be capped, so report against the whole payload.
    if (responseIsTruncated && prefs.bodyMode === 'pretty') {
        var total = 0;
        var all = new RegExp(safe, 'gi');
        while (all.exec(fullResponseText) !== null) total++;
        if (total > searchMarks.length) {
            counter.textContent = (searchMarks.length ? (searchIndex + 1) + '/' + searchMarks.length : '0') + ' of ' + total;
            counter.title = 'Only part of the response is shown. Use "Show the whole response" to search all of it.';
        }
    }
}

function gotoMatch(index) {
    if (!searchMarks.length) return;
    if (searchIndex >= 0 && searchMarks[searchIndex]) searchMarks[searchIndex].classList.remove('current');
    searchIndex = (index + searchMarks.length) % searchMarks.length;
    var mark = searchMarks[searchIndex];
    mark.classList.add('current');
    mark.scrollIntoView({ block: 'center', inline: 'nearest' });
    $('findCount').textContent = (searchIndex + 1) + '/' + searchMarks.length;
    $('findCount').title = '';
}

/* ===================== ENVIRONMENTS ===================== */
function updateEnvSelect() {
    var select = $('envSelect');
    select.innerHTML = '';
    var none = make('option', '', 'No environment');
    none.value = '-1';
    select.appendChild(none);
    environments.forEach(function (env, index) {
        var option = make('option', '', env.name);
        option.value = String(index);
        select.appendChild(option);
    });
    select.value = String(activeEnvIndex);
    var env = activeEnv();
    $('envPicker').classList.toggle('active', Boolean(env));
    $('envPicker').title = env
        ? '"' + env.name + '" is active: ' + Object.keys(env.variables || {}).length + ' variables. {{name}} in a request is replaced with its value.'
        : 'No environment is active. Create one to use {{variables}} in requests.';
}

function openEnvModal(options) {
    options = options || {};
    var index = typeof options.index === 'number' ? options.index : (activeEnvIndex >= 0 ? activeEnvIndex : (environments.length ? 0 : -1));
    loadEnvEditor(index);
    var focusTarget = environments[index] ? null : $('envName');
    if (options.addVar) {
        var existing = Array.prototype.filter.call(document.querySelectorAll('#envVarsContainer .kv-key'), function (input) { return input.value === options.addVar; })[0];
        if (existing) {
            focusTarget = existing.parentNode.querySelector('.kv-value');
        } else {
            var host = $('envVarsContainer');
            var last = host.lastElementChild;
            if (last && !last.querySelector('.kv-key').value && !last.querySelector('.kv-value').value) last.remove();
            var rowEl = kvAddRow('envVarsContainer', options.addVar, '', true);
            ensureTrailingRow('envVarsContainer');
            if (!environments.length) $('envName').value = 'Development';
            if (rowEl) focusTarget = rowEl.querySelector('.kv-value');
        }
    }
    openModal('envModal', focusTarget || $('envName'));
}

function loadEnvEditor(index) {
    envEditing = index;
    var env = environments[index];
    $('envName').value = env ? env.name : '';
    $('envNameNote').textContent = '';
    kvRender('envVarsContainer', env ? rowsFromObject(env.variables) : []);
    $('deleteEnvBtn').hidden = !env;
    disarm($('deleteEnvBtn'));
    $('envActivate').checked = env ? index === activeEnvIndex : true;
    renderEnvList();
}

function renderEnvList() {
    var host = $('envList');
    host.innerHTML = '';
    if (!environments.length && envEditing < 0) {
        host.appendChild(make('div', 'empty-hint', 'No environments yet. Fill in the form to create your first one.'));
    }
    environments.forEach(function (env, index) {
        var item = makeButton('env-item' + (index === envEditing ? ' selected' : ''), '', function () { loadEnvEditor(index); });
        item.appendChild(make('span', 'env-name', env.name));
        if (index === activeEnvIndex) item.appendChild(make('span', 'on', 'active'));
        host.appendChild(item);
    });
    if (envEditing < 0 && environments.length) {
        var draft = makeButton('env-item selected', '', null);
        draft.appendChild(make('span', 'env-name', 'New environment'));
        host.appendChild(draft);
    }
}

function saveEnvironmentFromModal() {
    var name = $('envName').value.trim();
    var note = $('envNameNote');
    if (!name) { note.textContent = 'Give the environment a name.'; $('envName').focus(); return; }
    var clash = environments.some(function (env, index) { return env.name === name && index !== envEditing; });
    if (clash) { note.textContent = 'Another environment is already called "' + name + '".'; $('envName').focus(); return; }
    var previous = environments[envEditing];
    pendingEnvActivate = $('envActivate').checked ? name : (previous && envEditing === activeEnvIndex ? '' : null);
    vscode.postMessage({
        command: 'saveEnvironment',
        environment: { name: name, variables: collectKV('envVarsContainer') },
        previousName: previous ? previous.name : undefined
    });
}

function onEnvironmentsChanged() {
    updateEnvSelect();
    validateUrlField();
    validateBody();
    validateGraphqlVariables();
    renderReqHead();
    renderTabs();
}

/* ===================== MODALS AND MENU ===================== */
function openModal(id, focusTarget) {
    lastFocusBeforeModal = document.activeElement;
    var modal = $(id);
    modal.classList.add('open');
    var target = focusTarget || modal.querySelector('input, textarea, select, button');
    if (target) setTimeout(function () { target.focus(); }, 0);
}
function closeModal(id) {
    var modal = $(id);
    if (!modal || !modal.classList.contains('open')) return;
    modal.classList.remove('open');
    if (lastFocusBeforeModal && lastFocusBeforeModal.focus) lastFocusBeforeModal.focus();
}
function openModalElement() { return document.querySelector('.modal-overlay.open'); }

function toggleMenu(open) {
    var menu = $('moreMenu');
    var button = $('moreMenuBtn');
    var show = open === undefined ? menu.hidden : open;
    menu.hidden = !show;
    button.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) { var first = menu.querySelector('.menu-item'); if (first) first.focus(); }
}

/* ===================== SAVING ===================== */
/* Only variable references are kept from auth fields, never typed secrets. */
function authTemplates(auth) {
    var out = { keyName: auth.keyName || '', keyLocation: auth.keyLocation || 'header', username: auth.username || '' };
    ['token', 'password', 'keyValue'].forEach(function (key) {
        var value = String(auth[key] || '').trim();
        if (/^\{\{\w+\}\}$/.test(value)) out[key] = value;
    });
    return out;
}

function postSave(tab, id) {
    if (tab.id === activeTabId) commitActive();
    var req = tab.req;
    var request = {
        name: tab.name || derivedName(req),
        folder: tab.folder || 'Default',
        method: req.method,
        url: withScheme(String(req.url || '').trim()),
        headers: enabledObject(req.headers),
        params: {},
        body: req.requestType === 'graphql' || req.bodyType === 'none' ? '' : req.body,
        bodyType: req.bodyType,
        authType: req.auth.type || undefined,
        auth: authTemplates(req.auth),
        requestType: req.requestType,
        graphql: req.requestType === 'graphql' ? req.graphql : undefined
    };
    if (id) request.id = id;
    tab.name = request.name;
    pendingSaveTabId = tab.id;
    pendingSaveBaseline = signature(tab);
    vscode.postMessage({ command: 'feature:saveRequest', featureId: 'collections-basic', request: request });
}

function saveActive(asNew) {
    var tab = commitActive();
    if (!tab) return;
    if (!String(tab.req.url || '').trim()) {
        toast('Enter a URL before saving the request', 'warning');
        $('url').focus();
        return;
    }
    if (tab.savedId && !asNew) { postSave(tab, tab.savedId); return; }
    openSaveModal(tab, asNew);
}

function openSaveModal(tab, asNew) {
    $('saveRequestTitle').textContent = asNew && tab.savedId ? 'Save as a new request' : 'Save request';
    $('saveRequestName').value = tab.name || (tab.req.method + ' ' + derivedName(tab.req));
    var folders = [];
    savedRequests.forEach(function (request) { if (folders.indexOf(request.folder) === -1) folders.push(request.folder); });
    $('saveRequestFolder').value = tab.folder || folders[0] || 'Default';
    $('saveRequestNote').textContent = '';
    $('saveRequestNote').className = 'field-note';
    var list = $('collectionFolders');
    list.innerHTML = '';
    folders.forEach(function (folder) { var option = make('option'); option.value = folder; list.appendChild(option); });
    $('saveRequestModal').dataset.tabId = tab.id;
    $('saveRequestModal').dataset.asNew = asNew ? '1' : '';
    openModal('saveRequestModal', $('saveRequestName'));
    $('saveRequestName').select();
}

function confirmSaveModal() {
    var modal = $('saveRequestModal');
    var tab = tabById(modal.dataset.tabId) || activeTab();
    if (!tab) return;
    var name = $('saveRequestName').value.trim();
    if (!name) { $('saveRequestNote').className = 'field-note error'; $('saveRequestNote').textContent = 'Give the request a name.'; return; }
    tab.name = name;
    tab.folder = $('saveRequestFolder').value.trim() || 'Default';
    if (tab.id === activeTabId) $('reqName').value = tab.name;
    postSave(tab, modal.dataset.asNew ? undefined : tab.savedId);
}

function onRequestSaved(saved) {
    closeModal('saveRequestModal');
    var tab = tabById(pendingSaveTabId);
    if (tab) {
        tab.savedId = saved.id;
        tab.name = saved.name;
        tab.folder = saved.folder;
        tab.baseline = pendingSaveBaseline || signature(tab);
        if (tab.id === activeTabId) $('reqName').value = tab.name;
    }
    pendingSaveTabId = null;
    pendingSaveBaseline = null;
    renderReqHead();
    renderTabs();
    persist();
    toast('Saved "' + saved.name + '" to ' + saved.folder, 'success');
    refreshCollections();
}

/* ===================== LOADING REQUESTS ===================== */
function requestFromSaved(saved) {
    var req = blankRequest();
    req.method = saved.method || 'GET';
    var parts = splitUrl(saved.url || '');
    var inUrl = parseQueryString(parts.query);
    var extra = Object.keys(saved.params || {})
        .filter(function (key) { return !inUrl.some(function (row) { return row.key === key; }); })
        .map(function (key) { return { key: key, value: saved.params[key], enabled: true }; });
    req.params = inUrl.concat(extra);
    req.url = extra.length ? urlWithQuery(saved.url || '', req.params) : (saved.url || '');
    req.headers = rowsFromObject(saved.headers);
    req.body = saved.body || '';
    req.bodyType = saved.bodyType || guessBodyType(req.body);
    req.requestType = saved.requestType === 'graphql' ? 'graphql' : 'rest';
    if (saved.graphql) req.graphql = { query: saved.graphql.query || '', variables: saved.graphql.variables || '', operationName: saved.graphql.operationName || '' };
    req.auth.type = saved.authType || '';
    var auth = saved.auth || {};
    ['token', 'username', 'password', 'keyName', 'keyValue', 'keyLocation'].forEach(function (key) { if (auth[key]) req.auth[key] = auth[key]; });
    return req;
}

function loadSavedRequest(saved) {
    openInTab({ req: requestFromSaved(saved), savedId: saved.id, name: saved.name, folder: saved.folder });
    showView('request');
}

function requestFromHistory(entry) {
    var snap = entry.request || {};
    var req = blankRequest();
    req.method = entry.method || 'GET';
    req.url = snap.url || entry.url || '';
    req.params = parseQueryString(splitUrl(req.url).query);
    req.headers = rowsFromObject(snap.headers);
    req.body = snap.data || '';
    req.bodyType = snap.bodyType || guessBodyType(req.body);
    req.requestType = snap.requestType === 'graphql' ? 'graphql' : 'rest';
    req.graphql = { query: snap.graphqlQuery || '', variables: snap.graphqlVariables || '', operationName: snap.graphqlOperationName || '' };
    req.auth.type = snap.authType || '';
    return req;
}

/* ===================== cURL ===================== */
function importCurl(text, target) {
    pendingCurlTarget = target || 'current';
    vscode.postMessage({ command: 'parseCurl', curl: text });
}

function applyParsedCurl(parsed) {
    var req = blankRequest();
    req.method = parsed.method || 'GET';
    req.url = parsed.url || '';
    req.params = parseQueryString(splitUrl(req.url).query);
    req.headers = rowsFromObject(parsed.headers);
    if (parsed.data !== undefined) {
        req.body = parsed.data;
        var contentType = (enabledObject(req.headers)['Content-Type'] || enabledObject(req.headers)['content-type'] || '').toLowerCase();
        req.bodyType = /x-www-form-urlencoded/.test(contentType) ? 'form-urlencoded' : guessBodyType(parsed.data);
        if (req.bodyType === 'json') { try { req.body = JSON.stringify(JSON.parse(parsed.data), null, 2); } catch (error) { /* keep as typed */ } }
    }
    if (parsed.authType === 'Basic') {
        req.auth.type = 'Basic';
        req.auth.username = parsed.username || '';
        req.auth.password = parsed.password || '';
    }
    if (parsed.rejectUnauthorized === false) req.settings.sslVerify = false;
    if (parsed.followRedirects) req.settings.followRedirects = true;
    if (parsed.proxy) {
        req.settings.proxyHost = parsed.proxy.host || '';
        req.settings.proxyPort = parsed.proxy.port ? String(parsed.proxy.port) : '';
        if (parsed.proxy.auth) {
            req.settings.proxyUsername = parsed.proxy.auth.username || '';
            req.settings.proxyPassword = parsed.proxy.auth.password || '';
        }
    }

    if (pendingCurlTarget === 'new') {
        openInTab({ req: req, dirty: true });
    } else {
        var tab = activeTab();
        tab.req = req;
        writeForm(req);
        if (req.body) setConfigTab(req.requestType === 'graphql' ? 'graphql' : 'body');
        markChanged();
    }
    closeModal('curlModal');
    showView('request');
    toast('Imported ' + req.method + ' ' + derivedName(req) + ' from cURL', 'success');
}

/* ===================== SIDEBAR: HISTORY ===================== */
function updateHistoryTable(history) {
    lastHistory = Array.isArray(history) ? history : [];
    $('historyCount').textContent = lastHistory.length ? String(lastHistory.length) : '';
    renderHistoryList();
}

/* Compact, scannable history rows, grouped by day. */
function renderHistoryList() {
    var host = $('historyTableBody');
    if (!host) return;
    var query = (sidebarQuery || '').toLowerCase();
    var rows = lastHistory.filter(function (entry) {
        return !query || (entry.url + ' ' + entry.method + ' ' + (entry.status || '')).toLowerCase().indexOf(query) !== -1;
    });

    host.innerHTML = '';
    if (!rows.length) {
        host.appendChild(make('div', 'empty-hint', lastHistory.length
            ? 'No request matches that search.'
            : 'Requests you send appear here. Select one to open it again.'));
        return;
    }

    var currentDay = '';
    rows.forEach(function (entry) {
        var day = dayLabel(entry.timestamp);
        if (day !== currentDay) {
            currentDay = day;
            host.appendChild(make('div', 'hist-day', day));
        }
        var family = Math.floor((entry.status || 0) / 100);
        var row = make('button', 'hist-row');
        row.type = 'button';
        row.title = entry.method + ' ' + entry.url +
            (entry.status ? '\nStatus ' + entry.status : '\nNo response') +
            (entry.responseTime ? ' in ' + entry.responseTime + ' ms' : '') +
            '\n' + new Date(entry.timestamp).toLocaleString();

        row.appendChild(make('span', 'method-badge m-' + entry.method, entry.method));
        row.appendChild(make('span', 'hist-path', pathOf(entry.url)));
        var meta = make('span', 'hist-meta');
        var glyph = family === 2 ? '✓' : family === 3 ? '↻' : family === 4 ? '⚠' : '✗';
        meta.appendChild(make('span', family === 2 || family === 3 ? 'ok' : family === 4 ? 'warn' : 'bad', entry.status ? glyph + ' ' + entry.status : '✗ failed'));
        meta.appendChild(make('span', '', relativeTime(entry.timestamp)));
        row.appendChild(meta);
        row.addEventListener('click', function () {
            openInTab({ req: requestFromHistory(entry) });
            showView('request');
        });
        host.appendChild(row);
    });
}

/* ===================== SIDEBAR: SAVED REQUESTS ===================== */
function renderCollections() {
    var host = $('collectionsTree');
    var counter = $('collectionsCount');
    if (!host) return;
    var query = (sidebarQuery || '').toLowerCase();
    var matching = savedRequests.filter(function (request) {
        return !query || (request.name + ' ' + request.url + ' ' + request.folder + ' ' + request.method).toLowerCase().indexOf(query) !== -1;
    });
    if (counter) counter.textContent = savedRequests.length ? String(savedRequests.length) : '';

    host.innerHTML = '';
    if (!matching.length) {
        host.appendChild(make('div', 'empty-hint', savedRequests.length
            ? 'No saved request matches that search.'
            : 'Save a request (Ctrl/Cmd+S) to keep it here, organised into collections.'));
        return;
    }

    var folders = {};
    matching.forEach(function (request) {
        var folder = request.folder || 'Default';
        (folders[folder] = folders[folder] || []).push(request);
    });
    var openIds = tabs.map(function (tab) { return tab.savedId; });

    Object.keys(folders).sort().forEach(function (folder) {
        var group = make('div', 'nav-group');
        var key = 'collection/' + folder;
        if (collapsedGroups[key] && !query) group.setAttribute('data-collapsed', 'true');

        var head = make('button', 'nav-group-head');
        head.type = 'button';
        head.setAttribute('aria-expanded', group.getAttribute('data-collapsed') ? 'false' : 'true');
        head.innerHTML = '<span class="chev" aria-hidden="true">&#9660;</span>';
        head.appendChild(make('span', '', folder + ' (' + folders[folder].length + ')'));
        head.addEventListener('click', function () {
            var collapsed = group.getAttribute('data-collapsed') === 'true';
            collapsedGroups[key] = !collapsed;
            if (collapsed) group.removeAttribute('data-collapsed'); else group.setAttribute('data-collapsed', 'true');
            head.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
        });

        var body = make('div', 'nav-group-body');
        folders[folder].forEach(function (request) {
            var row = make('div', 'coll-row' + (openIds.indexOf(request.id) >= 0 ? ' open' : ''));
            row.appendChild(make('span', 'method-badge m-' + (request.requestType === 'graphql' ? 'PATCH' : request.method), request.requestType === 'graphql' ? 'GQL' : request.method));

            var open = makeButton('coll-name', request.name, function () { loadSavedRequest(request); });
            open.title = request.method + ' ' + request.url + '\nSelect to open';
            row.appendChild(open);

            var actions = make('div', 'row-actions');
            var copy = makeButton('mini-btn', '', function () {
                var req = requestFromSaved(request);
                openInTab({ req: req, name: request.name + ' copy', dirty: true });
                showView('request');
            }, 'copy');
            copy.title = 'Open a copy in a new tab';
            copy.setAttribute('aria-label', 'Open a copy of ' + request.name);
            var remove = makeButton('mini-btn', '', null, 'trash');
            remove.title = 'Delete "' + request.name + '"';
            remove.setAttribute('aria-label', 'Delete ' + request.name);
            remove.addEventListener('click', function () {
                confirmClick(remove, function () {
                    pendingDeleteId = request.id;
                    vscode.postMessage({ command: 'feature:deleteRequest', featureId: 'collections-basic', id: request.id });
                }, 'Delete?');
            });
            actions.appendChild(copy);
            actions.appendChild(remove);
            row.appendChild(actions);
            body.appendChild(row);
        });

        group.appendChild(head);
        group.appendChild(body);
        host.appendChild(group);
    });
}

function refreshCollections() {
    vscode.postMessage({ command: 'feature:listCollections', featureId: 'collections-basic' });
}

/* ===================== VIEWS ===================== */
function showView(name) {
    currentView = name;
    ['request', 'tool', 'points'].forEach(function (view) {
        var el = $('view-' + view);
        if (el) el.classList.toggle('active', view === name);
    });
    if (name !== 'tool') {
        activeFeature = null;
        if (typeof renderToolNav === 'function') renderToolNav();
    }
}

/* ===================== LAYOUT ===================== */
function applyLayout() {
    var workspace = $('workspace');
    if (!workspace) return;
    var side = workspace.clientWidth >= 900;
    workspace.classList.toggle('side', side);
    workspace.style.setProperty('--split', Math.round(prefs.split * 1000) / 10 + '%');
    $('splitter').setAttribute('aria-orientation', side ? 'vertical' : 'horizontal');
}

function setSplit(ratio) {
    prefs.split = Math.min(0.8, Math.max(0.2, ratio));
    applyLayout();
}
`;

/**
 * Event wiring and start-up. Runs after the premium tool browser so every
 * function the handlers call is defined.
 */
export const API_CLIENT_INIT_SCRIPT = String.raw`
/* ===================== TAB KEYBOARD NAVIGATION =====================
   Elements with role="tab" behave like a tab list: arrow keys move between
   visible tabs and only the active tab is in the page's tab order, so Tab
   steps past the whole group instead of through every tab in it. */
function wireTabList(list) {
    list.addEventListener('keydown', function (event) {
        var tabsInList = Array.prototype.filter.call(list.querySelectorAll('[role="tab"]'), function (tab) {
            return !tab.hidden && tab.offsetParent !== null;
        });
        var current = tabsInList.indexOf(document.activeElement);
        if (current === -1) return;
        var next = -1;
        switch (event.key) {
            case 'ArrowRight':
            case 'ArrowDown': next = current + 1; break;
            case 'ArrowLeft':
            case 'ArrowUp': next = current - 1; break;
            case 'Home': next = 0; break;
            case 'End': next = tabsInList.length - 1; break;
            default: return;
        }
        event.preventDefault();
        var target = tabsInList[(next + tabsInList.length) % tabsInList.length];
        target.focus();
        target.click();
    });
}
document.querySelectorAll('[role="tablist"]').forEach(wireTabList);

/* ---- request tabs ---- */
$('newTabBtn').addEventListener('click', newTab);
$('newRequestBtn').addEventListener('click', newTab);

/* ---- request header ---- */
$('reqName').addEventListener('input', function () {
    var tab = activeTab();
    if (!tab) return;
    tab.name = this.value.trim();
    markChanged();
});
$('reqName').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); $('url').focus(); }
});
document.querySelectorAll('.type-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
        if (tab.dataset.type !== currentRequestType) setRequestType(tab.dataset.type);
    });
});
$('saveRequestBtn').addEventListener('click', function () { saveActive(false); });
$('moreMenuBtn').addEventListener('click', function (event) { event.stopPropagation(); toggleMenu(); });
$('moreMenu').addEventListener('click', function (event) {
    var item = event.target.closest('.menu-item');
    if (!item) return;
    toggleMenu(false);
    switch (item.dataset.action) {
        case 'save-as': saveActive(true); break;
        case 'duplicate': duplicateActive(); break;
        case 'copy-curl': {
            var url = $('url').value.trim();
            if (!url) { toast('Enter a URL first', 'warning'); return; }
            vscode.postMessage(Object.assign({ command: 'generateCurl' }, buildRequestPayload()));
            break;
        }
        case 'import-curl':
            $('curlInput').value = '';
            openModal('curlModal', $('curlInput'));
            break;
        case 'reset': {
            var tab = activeTab();
            var previous = clone(tab.req);
            tab.req = blankRequest();
            writeForm(tab.req);
            markChanged();
            toast('Request cleared', 'info', { label: 'Undo', run: function () { tab.req = previous; if (tab.id === activeTabId) writeForm(previous); markChanged(); } });
            break;
        }
    }
});
$('moreMenu').addEventListener('keydown', function (event) {
    var items = Array.prototype.slice.call($('moreMenu').querySelectorAll('.menu-item'));
    var index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
    if (event.key === 'Tab') toggleMenu(false);
});
document.addEventListener('click', function (event) {
    if (!$('moreMenu').hidden && !event.target.closest('.menu-wrap')) toggleMenu(false);
});

/* ---- URL bar ---- */
methodSelect.addEventListener('change', function () { updateMethodColor(); updateBodyHints(); markChanged(); });
$('url').addEventListener('input', function () {
    syncParamsFromUrl();
    validateUrlField();
    markChanged();
});
$('url').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        sendCurrentRequest();
    }
});
$('url').addEventListener('paste', function (event) {
    var text = (event.clipboardData || window.clipboardData).getData('text');
    if (text && /^\s*curl\s/i.test(text)) {
        event.preventDefault();
        importCurl(text, 'current');
    }
});
$('url').addEventListener('blur', validateUrlField);
$('sendRequest').addEventListener('click', sendCurrentRequest);
$('cancelRequest').addEventListener('click', cancelCurrentRequest);

/* ---- config tabs ---- */
document.querySelectorAll('.config-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setConfigTab(tab.dataset.tab); persist(); });
});
document.querySelectorAll('[data-bulk]').forEach(function (button) {
    button.addEventListener('click', function () {
        var id = button.dataset.bulk;
        setBulk(id, !bulkMode[id]);
        if (!bulkMode[id] && id === 'paramsContainer') syncUrlFromParams();
        markChanged();
    });
});
$('paramsBulk').addEventListener('input', debounce(function () { syncUrlFromParams(); markChanged(); }, 200));
$('headersBulk').addEventListener('input', function () { updateBodyHints(); markChanged(); });

/* ---- body ---- */
document.querySelectorAll('.body-type-btn').forEach(function (button) {
    button.addEventListener('click', function () { setBodyType(button.dataset.bodyType); });
});
var validateBodySoon = debounce(validateBody, 250);
$('body').addEventListener('input', function () { validateBodySoon(); updateBodyHints(); markChanged(); });
$('graphqlQuery').addEventListener('input', markChanged);
$('graphqlVariables').addEventListener('input', debounce(function () { validateGraphqlVariables(); markChanged(); }, 250));
$('graphqlOperationName').addEventListener('input', markChanged);
document.querySelectorAll('.code-area').forEach(wireCodeArea);

$('beautifyJson').addEventListener('click', function () {
    var field = $('body');
    var content = field.value.trim();
    if (!content) { toast('There is nothing to format yet', 'warning'); return; }
    try {
        field.value = JSON.stringify(JSON.parse(content), null, 2);
    } catch (error) {
        try { field.value = formatXml(content); }
        catch (xmlError) { validateBody(); toast('Could not format: the body is not valid JSON or XML', 'error'); return; }
    }
    validateBody();
    markChanged();
});
$('minifyJson').addEventListener('click', function () {
    var field = $('body');
    try {
        field.value = JSON.stringify(JSON.parse(field.value));
        validateBody();
        markChanged();
    } catch (error) {
        validateBody();
        toast('Could not minify: the body is not valid JSON', 'error');
    }
});
$('convertToJson').addEventListener('click', function () {
    var field = $('body');
    var content = field.value.trim();
    if (!content) { toast('There is nothing to convert yet', 'warning'); return; }
    try {
        field.value = JSON.stringify(convertToJson(content), null, 2);
        setBodyType('json');
        toast('Converted to JSON', 'success');
    } catch (error) {
        toast('Could not convert: ' + error.message, 'error');
    }
});

/* ---- auth ---- */
$('authType').addEventListener('change', function () { updateAuthFields(); markChanged(); });
['authToken', 'username', 'password', 'apiKeyName', 'apiKeyValue'].forEach(function (id) {
    $(id).addEventListener('input', function () { updateAuthPreview(); markChanged(); });
});
$('apiKeyLocation').addEventListener('change', function () { updateAuthPreview(); markChanged(); });
document.querySelectorAll('.reveal-btn').forEach(function (button) {
    button.addEventListener('click', function () {
        var field = $(button.dataset.target);
        var show = field.type === 'password';
        field.type = show ? 'text' : 'password';
        button.setAttribute('aria-pressed', show ? 'true' : 'false');
        var noun = button.dataset.target === 'password' ? 'password' : button.dataset.target === 'authToken' ? 'token' : 'key';
        button.title = (show ? 'Hide the ' : 'Show the ') + noun;
        button.setAttribute('aria-label', button.title);
    });
});

/* ---- settings ---- */
['timeout', 'retries', 'retryDelay', 'retryStatusCodes', 'maxRedirects', 'proxyHost', 'proxyPort', 'proxyUsername', 'proxyPassword'].forEach(function (id) {
    $(id).addEventListener('input', markChanged);
});
['followRedirects', 'sslVerify'].forEach(function (id) { $(id).addEventListener('change', markChanged); });

/* ---- response ---- */
document.querySelectorAll('.resp-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { showRespTab(tab.dataset.resp); });
});
document.querySelectorAll('.body-mode').forEach(function (button) {
    button.addEventListener('click', function () { showBodyMode(button.dataset.mode); });
});
$('wrapToggle').addEventListener('click', function () { prefs.wrap = !prefs.wrap; showBodyMode(prefs.bodyMode); });
$('responseSearch').addEventListener('input', debounce(applyResponseSearch, 150));
$('responseSearch').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); gotoMatch(searchIndex + (event.shiftKey ? -1 : 1)); }
    if (event.key === 'Escape') { event.stopPropagation(); clearSearch(); }
});
$('findNext').addEventListener('click', function () { gotoMatch(searchIndex + 1); });
$('findPrev').addEventListener('click', function () { gotoMatch(searchIndex - 1); });
$('copyResponseBtn').addEventListener('click', function () {
    var text = prefs.bodyMode === 'raw' ? $('responseRaw').textContent : window.__lastResponseText;
    if (!text) { toast('There is no response body to copy yet', 'warning'); return; }
    copyText(text, 'Response copied to the clipboard');
});
$('downloadResponseBtn').addEventListener('click', function () {
    if (!window.__lastResponseText) { toast('There is no response body to save yet', 'warning'); return; }
    vscode.postMessage({ command: 'saveResponse', body: window.__lastResponseText });
});

/* ---- splitter ---- */
(function () {
    var splitter = $('splitter');
    var workspace = $('workspace');
    var dragging = false;
    splitter.addEventListener('pointerdown', function (event) {
        dragging = true;
        splitter.classList.add('dragging');
        splitter.setPointerCapture(event.pointerId);
        event.preventDefault();
    });
    splitter.addEventListener('pointermove', function (event) {
        if (!dragging) return;
        var rect = workspace.getBoundingClientRect();
        var side = workspace.classList.contains('side');
        setSplit(side ? (event.clientX - rect.left) / rect.width : (event.clientY - rect.top) / rect.height);
    });
    function stop() {
        if (!dragging) return;
        dragging = false;
        splitter.classList.remove('dragging');
        persist();
    }
    splitter.addEventListener('pointerup', stop);
    splitter.addEventListener('pointercancel', stop);
    splitter.addEventListener('dblclick', function () { setSplit(0.5); persist(); });
    splitter.addEventListener('keydown', function (event) {
        var step = event.shiftKey ? 0.1 : 0.03;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSplit(prefs.split - step); persist(); }
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSplit(prefs.split + step); persist(); }
    });
    if (window.ResizeObserver) new ResizeObserver(applyLayout).observe(workspace);
    else window.addEventListener('resize', applyLayout);
})();

/* ---- sidebar ---- */
document.querySelectorAll('.sidebar .nav-section[data-section]').forEach(function (section) {
    var head = section.querySelector('.nav-section-head');
    if (!head) return;
    head.addEventListener('click', function () {
        var collapsed = section.getAttribute('data-collapsed') === 'true';
        if (collapsed) section.removeAttribute('data-collapsed');
        else section.setAttribute('data-collapsed', 'true');
        head.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    });
});
$('toggleSidebar').addEventListener('click', function () {
    var shell = $('appShell');
    var narrow = window.matchMedia('(max-width: 720px)').matches;
    var cls = narrow ? 'sidebar-open' : 'sidebar-collapsed';
    shell.classList.toggle(cls);
    var open = narrow ? shell.classList.contains('sidebar-open') : !shell.classList.contains('sidebar-collapsed');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
    setTimeout(applyLayout, 0);
});
$('sidebarSearch').addEventListener('input', function () {
    sidebarQuery = this.value.trim();
    renderHistoryList();
    renderCollections();
    if (typeof renderToolNav === 'function') renderToolNav();
});
$('saveToCollectionBtn').addEventListener('click', function () { saveActive(false); });
$('exportHistoryBtn').addEventListener('click', function () { vscode.postMessage({ command: 'exportHistory', format: 'json' }); });
$('clearHistory').addEventListener('click', function () {
    if (!lastHistory.length) { toast('History is already empty', 'info'); return; }
    confirmClick(this, function () { vscode.postMessage({ command: 'clearHistory' }); }, 'Clear?');
});

/* ---- top bar ---- */
$('envSelect').addEventListener('change', function () {
    vscode.postMessage({ command: 'setActiveEnvironment', index: parseInt(this.value, 10) });
});
$('manageEnvBtn').addEventListener('click', function () { openEnvModal({}); });
$('showCookies').addEventListener('click', function () { vscode.postMessage({ command: 'getCookies' }); });
$('shortcutsBtn').addEventListener('click', function () { openModal('shortcutsModal'); });
$('pointsBadge').addEventListener('click', function () { showView('points'); });

/* ---- dialogs ---- */
document.querySelectorAll('[data-close]').forEach(function (button) {
    button.addEventListener('click', function () { closeModal(button.dataset.close); });
});
document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('mousedown', function (event) { if (event.target === overlay) closeModal(overlay.id); });
    // Keep keyboard focus inside the open dialog.
    overlay.addEventListener('keydown', function (event) {
        if (event.key !== 'Tab') return;
        var focusable = Array.prototype.filter.call(overlay.querySelectorAll('button, input, select, textarea'), function (el) {
            return !el.disabled && el.offsetParent !== null;
        });
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
});
$('saveRequestName').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); confirmSaveModal(); } });
$('saveRequestFolder').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); confirmSaveModal(); } });
$('confirmSaveRequest').addEventListener('click', confirmSaveModal);
$('confirmCurlImport').addEventListener('click', function () {
    var text = $('curlInput').value.trim();
    if (!/^curl\s/i.test(text)) { toast('That does not start with "curl"', 'warning'); return; }
    importCurl(text, 'new');
});
$('newEnvBtn').addEventListener('click', function () { loadEnvEditor(-1); $('envName').focus(); });
$('envName').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); saveEnvironmentFromModal(); } });
$('saveEnvBtn').addEventListener('click', saveEnvironmentFromModal);
$('deleteEnvBtn').addEventListener('click', function () {
    var env = environments[envEditing];
    if (!env) return;
    confirmClick(this, function () { vscode.postMessage({ command: 'deleteEnvironment', name: env.name }); }, 'Click again to delete "' + env.name + '"');
});
$('cookieList').addEventListener('click', function (event) {
    var item = event.target.closest('.cookie-item');
    if (item && item.dataset.cookie) copyText(item.dataset.cookie, 'Cookie copied');
});
$('copyCookies').addEventListener('click', function () {
    var text = Array.prototype.map.call(document.querySelectorAll('#cookieList .cookie-item'), function (item) { return item.dataset.cookie; }).join('\n');
    if (!text) { toast('There are no cookies to copy', 'info'); return; }
    copyText(text, 'Cookies copied');
});
$('clearCookies').addEventListener('click', function () {
    confirmClick(this, function () { vscode.postMessage({ command: 'clearCookies' }); }, 'Click again to clear all cookies');
});

$('backToRequest').addEventListener('click', function () { showView('request'); });
$('backToRequestFromPoints').addEventListener('click', function () { showView('request'); });
$('openPointsTracker').addEventListener('click', function () { vscode.postMessage({ command: 'feature:openPointsTracker' }); });

/* ---- global keyboard shortcuts ---- */
document.addEventListener('keydown', function (event) {
    var mod = event.ctrlKey || event.metaKey;
    var key = event.key.toLowerCase();
    var modal = openModalElement();
    if (mod && event.key === 'Enter') {
        event.preventDefault();
        if (modal) { var primary = modal.querySelector('[data-primary]'); if (primary) primary.click(); return; }
        sendCurrentRequest();
        return;
    }
    if (mod && key === 's') {
        event.preventDefault();
        if (!modal) saveActive(event.shiftKey);
        return;
    }
    if (mod && key === 'l' && !event.shiftKey && !modal) {
        event.preventDefault();
        showView('request');
        $('url').focus();
        $('url').select();
        return;
    }
    if (mod && key === 'f' && !modal) {
        var tab = activeTab();
        if (tab && tab.response && tab.response.state === 'ok') {
            event.preventDefault();
            showView('request');
            showRespTab('body');
            $('responseSearch').focus();
            $('responseSearch').select();
        }
        return;
    }
    if (event.key === 'Escape') {
        if (!$('moreMenu').hidden) { toggleMenu(false); $('moreMenuBtn').focus(); return; }
        if (modal) closeModal(modal.id);
    }
});

/* ===================== MESSAGES FROM THE EXTENSION ===================== */
window.addEventListener('message', function (e) {
    var d = e.data || {};
    switch (d.command) {
        case 'requestStarted':
            break;

        case 'apiResponse': {
            var okTab = tabById(inflightTabId) || activeTab();
            var okResponse = {
                state: 'ok', status: d.status, statusText: d.statusText, headers: d.headers || {}, data: d.data,
                responseTime: d.responseTime, size: d.size, truncated: d.truncated, attempts: d.attempts
            };
            if (okTab) okTab.response = okResponse;
            // Kept so the assertion, diff and JSON tools can work against
            // the response the user just received.
            window.__lastResponse = { status: d.status, headers: d.headers, data: d.data, responseTime: d.responseTime };
            window.__lastResponseText = typeof d.data === 'string' ? d.data : JSON.stringify(d.data, null, 2);
            setRequestState(false);
            if (Array.isArray(d.history)) updateHistoryTable(d.history);
            if (okTab && okTab.id === activeTabId) renderResponse();
            else if (okTab) toast(displayName(okTab) + ': ' + d.status + (d.statusText ? ' ' + d.statusText : ''), d.status < 400 ? 'success' : 'warning');
            if (d.attempts && d.attempts > 1) toast('Succeeded after ' + d.attempts + ' attempts', 'info');
            persist();
            break;
        }

        case 'apiError': {
            var errorTab = tabById(inflightTabId) || activeTab();
            if (errorTab) {
                errorTab.response = {
                    state: 'error', error: d.error, title: d.title, hint: d.hint, action: d.action, code: d.code,
                    status: d.status || 0, data: d.response, responseTime: d.responseTime, attempts: d.attempts
                };
            }
            window.__lastResponse = { status: d.status || 0, headers: {}, data: d.response, responseTime: d.responseTime };
            setRequestState(false);
            if (Array.isArray(d.history)) updateHistoryTable(d.history);
            if (errorTab && errorTab.id === activeTabId) renderResponse();
            else toast((d.title || 'Request failed') + (errorTab ? ' (' + displayName(errorTab) + ')' : ''), 'error');
            persist();
            break;
        }

        case 'requestCancelled': {
            var cancelledTab = tabById(inflightTabId);
            if (cancelledTab && cancelledTab.response && cancelledTab.response.state === 'pending') {
                cancelledTab.response = { state: 'cancelled' };
            }
            setRequestState(false);
            if (!cancelledTab || cancelledTab.id === activeTabId) renderResponse();
            break;
        }

        case 'historyLoaded':
            updateHistoryTable(d.history);
            break;

        case 'showCookies': {
            var list = $('cookieList');
            list.innerHTML = '';
            var domains = Object.keys(d.cookies || {});
            if (!domains.length) {
                list.appendChild(make('div', 'empty-hint', 'No cookies are stored yet.'));
            }
            domains.forEach(function (domain) {
                var group = make('div', 'form-row');
                group.appendChild(make('div', 'cookie-domain', domain));
                d.cookies[domain].forEach(function (cookie) {
                    var item = makeButton('cookie-item', cookie, null);
                    item.dataset.cookie = cookie;
                    item.title = 'Copy this cookie';
                    group.appendChild(item);
                });
                list.appendChild(group);
            });
            disarm($('clearCookies'));
            openModal('cookieModal');
            break;
        }

        case 'historyCleared': updateHistoryTable([]); toast('History cleared', 'success'); break;
        case 'cookiesCleared':
            toast('Cookies cleared', 'success');
            if ($('cookieModal').classList.contains('open')) vscode.postMessage({ command: 'getCookies' });
            break;

        case 'showEnvironments':
        case 'environmentSaved':
        case 'environmentDeleted':
        case 'environmentActivated':
            environments = d.environments || [];
            activeEnvIndex = typeof d.activeIndex === 'number' ? d.activeIndex : -1;
            if (d.command === 'environmentSaved') {
                var savedName = $('envName').value.trim();
                if (pendingEnvActivate !== null) {
                    var target = pendingEnvActivate === '' ? -1 : environments.map(function (env) { return env.name; }).indexOf(pendingEnvActivate);
                    if (target !== activeEnvIndex) vscode.postMessage({ command: 'setActiveEnvironment', index: target });
                }
                pendingEnvActivate = null;
                closeModal('envModal');
                toast('Saved environment "' + savedName + '"', 'success');
            }
            if (d.command === 'environmentDeleted') {
                if ($('envModal').classList.contains('open')) loadEnvEditor(activeEnvIndex >= 0 ? activeEnvIndex : (environments.length ? 0 : -1));
                toast('Environment deleted', 'success');
            }
            if (d.command === 'environmentActivated') {
                var activeNow = activeEnv();
                toast(activeNow ? 'Using "' + activeNow.name + '"' : 'No environment active', 'info');
            }
            onEnvironmentsChanged();
            break;

        case 'environmentError':
            $('envNameNote').textContent = d.error || 'The environment could not be saved.';
            break;

        case 'showPoints':
            $('currentPointsDisplay').textContent = d.points;
            $('userPointsBadge').textContent = d.points;
            break;

        case 'responseSaved':
            toast(d.success ? 'Response saved to ' + d.path : (d.error || 'Could not save the response'), d.success ? 'success' : 'error');
            break;

        case 'featureCatalog':
            featureCatalog = d;
            renderCatalog();
            break;

        case 'featureResult':
            if (typeof d.remainingPoints === 'number') syncPointBalance(d.remainingPoints);
            if (d.pointsCharged) {
                toast('−' + d.pointsCharged + ' points · balance ' + d.remainingPoints, 'info');
            }
            if (d.featureId === 'websocket-client' && d.result && d.result.granted && window.__wsConnect) {
                window.__wsConnect();
                break;
            }
            // Collection changes are reflected in the sidebar tree.
            if (d.result && Array.isArray(d.result.requests)) {
                savedRequests = d.result.requests;
                renderCollections();
            }
            if (d.featureId === 'collections-basic' && d.result && d.result.saved) {
                onRequestSaved(d.result.saved);
                break;
            }
            if (d.featureId === 'collections-basic' && d.result && typeof d.result.total === 'number' && !d.result.saved) {
                if (pendingDeleteId) {
                    tabs.forEach(function (tab) {
                        if (tab.savedId === pendingDeleteId) { tab.savedId = null; tab.folder = ''; tab.baseline = null; }
                    });
                    pendingDeleteId = null;
                    renderReqHead();
                    renderTabs();
                }
                toast('Request deleted', 'success');
                refreshCollections();
                break;
            }
            if (d.featureId === 'oauth2-helper' && d.result && d.result.authType === 'Bearer' && d.result.authToken) {
                var oauthTab = activeTab();
                if (oauthTab) {
                    oauthTab.req = readForm();
                    oauthTab.req.auth.type = 'Bearer';
                    oauthTab.req.auth.token = d.result.authToken;
                    writeForm(oauthTab.req);
                    markChanged();
                }
                featureOutput('The access token was applied to the Auth tab of "' + (oauthTab ? displayName(oauthTab) : 'the request') + '" as a Bearer token.', false);
                toast('Token applied to the request', 'success');
                break;
            }
            if (currentView !== 'tool') break;
            renderFeatureResult(d.featureId, d.result);
            break;

        case 'featureError': {
            var saveModal = $('saveRequestModal');
            if (d.featureId === 'collections-basic' && pendingSaveTabId) {
                pendingSaveTabId = null;
                if (saveModal.classList.contains('open')) {
                    var note = $('saveRequestNote');
                    note.className = 'field-note error';
                    note.textContent = d.error || 'That request could not be saved.';
                } else {
                    toast(d.error || 'That request could not be saved', 'error');
                }
                break;
            }
            if (typeof d.remainingPoints === 'number') syncPointBalance(d.remainingPoints);
            if (currentView !== 'tool') { toast(d.error || 'That action failed', 'error'); break; }
            featureOutput(d.error || 'That action failed.', true);
            if (d.denial === 'insufficient-points') {
                // Running out of points is recoverable, so show the way to
                // earn more rather than leaving a dead end.
                toast('Not enough points · ' + (d.pointsShort || 0) + ' more needed', 'warning');
                showEarnPoints();
            } else if (d.upgradeable) {
                toast('Premium is required for this tool', 'warning');
            }
            break;
        }

        case 'featureStreamStart':
            window.__streamBuffer = '';
            featureOutput('', false);
            break;
        case 'featureStreamDelta':
            window.__streamBuffer = (window.__streamBuffer || '') + d.text;
            featureOutput(window.__streamBuffer, false);
            break;
        case 'featureStreamError':
            featureOutput(d.error || 'The stream failed.', true);
            break;
        case 'featureStreamDone': {
            window.__lastAiText = d.text || window.__streamBuffer || '';
            var diag = d.diagnostics || {};
            var summary = '\n\n---\ntotal: ' + (diag.totalMs || 0) + 'ms, ' + (diag.characters || 0) + ' characters';
            if (diag.timeToFirstTokenMs !== undefined) {
                summary += '\ntime to first token: ' + diag.timeToFirstTokenMs + 'ms' +
                    '\nchunks: ' + diag.chunks +
                    '\ninter-chunk p50/p90/p99: ' + diag.interTokenMs.p50 + '/' + diag.interTokenMs.p90 + '/' + diag.interTokenMs.p99 + 'ms' +
                    '\nthroughput: ' + diag.charactersPerSecond + ' chars/s';
            }
            featureOutput((window.__streamBuffer || d.text || '') + summary, Boolean(d.error));
            break;
        }

        case 'curlGenerated':
            if (d.error) { toast('Could not build the cURL command: ' + d.error, 'error'); break; }
            copyText(d.curl, 'cURL command copied to the clipboard');
            break;

        case 'curlParsed':
            if (d.error) {
                if ($('curlModal').classList.contains('open')) toast('Could not import: ' + d.error, 'error');
                else toast('Could not import the cURL command: ' + d.error, 'error');
                break;
            }
            applyParsedCurl(d.request || {});
            break;

        case 'historyExported':
            if (d.success) toast('History exported', 'success');
            else if (d.error) toast('Export failed: ' + d.error, 'error');
            break;

        case 'error': toast('Error: ' + d.message, 'error'); break;
    }
});

/* ===================== START-UP ===================== */
(function restoreTabs() {
    if (restoredState && Array.isArray(restoredState.tabs) && restoredState.tabs.length) {
        tabs = restoredState.tabs.map(function (saved) {
            var tab = createTab({ req: saved.req, name: saved.name, savedId: saved.savedId, folder: saved.folder, configTab: saved.configTab, response: saved.response });
            tab.id = saved.id || tab.id;
            tab.baseline = saved.baseline === undefined ? signature(tab) : saved.baseline;
            return tab;
        });
        activeTabId = tabs.some(function (tab) { return tab.id === restoredState.activeTabId; }) ? restoredState.activeTabId : tabs[0].id;
    } else {
        var first = createTab();
        tabs = [first];
        activeTabId = first.id;
    }
    var tab = activeTab();
    writeForm(tab.req);
    setConfigTab(tab.configTab);
    renderReqHead();
    renderTabs();
    renderResponse();
    applyLayout();
})();

refreshCollections();
vscode.postMessage({ command: 'feature:getCatalog' });
vscode.postMessage({ command: 'getEnvironments' });
vscode.postMessage({ command: 'getHistory' });
vscode.postMessage({ command: 'getPoints' });
`;
