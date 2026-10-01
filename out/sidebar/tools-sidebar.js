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
exports.ToolsSidebarProvider = exports.renderToolsSidebar = exports.themeColorVar = exports.sidebarStatus = exports.TOOLS_VIEW_ID = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const webview_ui_1 = require("../utils/webview-ui");
const command_dispatch_1 = require("../utils/command-dispatch");
const milestoneTracker_1 = require("../commands/milestoneTracker");
const tool_groups_1 = require("./tool-groups");
/**
 * The Tools view in the DevSnip Pro activity bar.
 *
 * A webview rather than a native tree so the navigation can have a search
 * box, distinct category headers and a separated points area. It runs the same
 * commands the tree did; the page behaviour lives in media/tools-sidebar.js.
 */
exports.TOOLS_VIEW_ID = "myView";
const EXPANDED_KEY = "devsnip.sidebar.expanded";
function sidebarStatus(context) {
    const stats = (0, milestoneTracker_1.getUserStats)(context);
    // The level follows lifetime points so spending never demotes it; the number is the spendable balance.
    const level = (0, milestoneTracker_1.getCurrentLevel)(stats.lifetimePoints);
    const next = (0, milestoneTracker_1.getNextLevel)(stats.lifetimePoints);
    const span = next ? next.minPoints - level.minPoints : 0;
    return {
        badge: level.badge,
        level: level.name,
        points: stats.totalPoints,
        lifetimePoints: stats.lifetimePoints,
        nextLevel: next ? next.name : null,
        toNext: next ? Math.max(0, next.minPoints - stats.lifetimePoints) : 0,
        progress: next && span > 0 ? Math.min(1, Math.max(0, (stats.lifetimePoints - level.minPoints) / span)) : 1
    };
}
exports.sidebarStatus = sidebarStatus;
/** Maps a theme colour id (terminal.ansiBrightYellow) to its webview CSS variable. */
function themeColorVar(colorId) {
    return `--vscode-${colorId.replace(/\./g, "-")}`;
}
exports.themeColorVar = themeColorVar;
function renderToolsSidebar(options) {
    const nonce = (0, webview_ui_1.getNonce)();
    const data = {
        groups: tool_groups_1.SIDEBAR_GROUPS.map(group => ({ ...group, colorVar: themeColorVar(group.color) })),
        status: options.status,
        expanded: options.expanded.filter(name => tool_groups_1.SIDEBAR_GROUPS.some(group => group.name === name)),
        milestoneCommand: tool_groups_1.MILESTONE_COMMAND
    };
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${options.cspSource}; style-src ${options.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${(0, webview_ui_1.escapeHtml)(options.codiconsUri)}">
<style nonce="${nonce}">${SIDEBAR_CSS}</style>
<title>Tools</title>
</head>
<body>
<button type="button" class="status" id="status" title="Open the Milestone &amp; Points Tracker">
  <span class="status-icon" id="statusBadge" aria-hidden="true"></span>
  <span class="status-text">
    <span class="status-level" id="statusLevel"></span>
    <span class="status-next" id="statusNext"></span>
  </span>
  <span class="status-points" id="statusPoints"></span>
  <span class="status-bar" aria-hidden="true"><span class="status-fill" id="statusFill"></span></span>
</button>

<div class="search-area" role="search">
  <div class="search">
    <span class="codicon codicon-search" aria-hidden="true"></span>
    <input id="search" type="search" autocomplete="off" spellcheck="false" placeholder="Search tools" aria-label="Search tools" aria-controls="tree">
    <button type="button" class="icon-btn" id="clearSearch" title="Clear search (Esc)" aria-label="Clear search" hidden><span class="codicon codicon-close" aria-hidden="true"></span></button>
  </div>
  <button type="button" class="icon-btn search-all" id="searchAll" title="Search every DevSnip Pro tool, including those not listed here" aria-label="Search every DevSnip Pro tool"><span class="codicon codicon-list-filter" aria-hidden="true"></span></button>
</div>

<div class="tree" id="tree" role="tree" aria-label="DevSnip Pro tools"></div>

<div class="empty" id="empty" hidden>
  <p>No tools here match “<span id="emptyQuery"></span>”.</p>
  <button type="button" class="link" id="emptySearchAll">Search all DevSnip Pro tools</button>
</div>
<p class="sr-only" id="announce" role="status" aria-live="polite"></p>

<script type="application/json" id="sidebar-data">${(0, webview_ui_1.embedJson)(data)}</script>
<script nonce="${nonce}" src="${(0, webview_ui_1.escapeHtml)(options.scriptUri)}"></script>
</body>
</html>`;
}
exports.renderToolsSidebar = renderToolsSidebar;
class ToolsSidebarProvider {
    constructor(context) {
        this.context = context;
    }
    /** Pushes the latest points and level to the page. */
    refresh() {
        if (!this.view)
            return;
        void this.view.webview.postMessage({ type: "status", status: sidebarStatus(this.context) }).then(undefined, () => undefined);
    }
    resolveWebviewView(view) {
        this.view = view;
        const mediaRoot = vscode.Uri.file(path.join(this.context.extensionPath, "media"));
        const codiconsRoot = vscode.Uri.file(path.join(this.context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
        view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot, codiconsRoot] };
        view.webview.html = renderToolsSidebar({
            cspSource: view.webview.cspSource,
            scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "tools-sidebar.js")).toString(),
            codiconsUri: view.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
            status: sidebarStatus(this.context),
            expanded: this.context.globalState.get(EXPANDED_KEY, [])
        });
        const known = (0, tool_groups_1.sidebarCommands)();
        const groupNames = new Set(tool_groups_1.SIDEBAR_GROUPS.map(group => group.name));
        const subscription = view.webview.onDidReceiveMessage(async (message) => {
            if (message?.type === "run" && typeof message.command === "string" && known.has(message.command)) {
                // executeQueuedCommand also checks the id against this extension's commands.
                void (0, command_dispatch_1.executeQueuedCommand)(message.command);
            }
            else if (message?.type === "searchAll") {
                void (0, command_dispatch_1.executeQueuedCommand)(tool_groups_1.SEARCH_COMMAND);
            }
            else if (message?.type === "expanded" && Array.isArray(message.groups)) {
                const expanded = message.groups.filter((name) => typeof name === "string" && groupNames.has(name));
                await this.context.globalState.update(EXPANDED_KEY, expanded);
            }
        });
        view.onDidChangeVisibility(() => { if (view.visible)
            this.refresh(); });
        view.onDidDispose(() => {
            subscription.dispose();
            if (this.view === view)
                this.view = undefined;
        });
    }
}
exports.ToolsSidebarProvider = ToolsSidebarProvider;
const SIDEBAR_CSS = `
:root {
  --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground, #cccccc));
  --muted: var(--vscode-descriptionForeground, rgba(204,204,204,0.7));
  --line: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border, rgba(128,128,128,0.25)));
  --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
  --selected: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,0.2));
  --selected-focus: var(--vscode-list-activeSelectionBackground, rgba(14,99,156,0.5));
  --selected-focus-fg: var(--vscode-list-activeSelectionForeground, inherit);
  --focus: var(--vscode-list-focusOutline, var(--vscode-focusBorder, #007fd4));
  --guide: var(--vscode-tree-indentGuidesStroke, rgba(128,128,128,0.35));
  --highlight: var(--vscode-list-highlightForeground, #2aaaff);
  --gold: var(--vscode-terminal-ansiBrightYellow, #e5c07b);
  --row: 24px;
  --pad: 8px;
  --twistie: 16px;
  --icon: 16px;
  --gap: 6px;
  --child: 44px;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  color: var(--fg);
  background: transparent;
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.4;
  user-select: none;
  overflow-x: hidden;
}
button { font: inherit; color: inherit; }
[hidden] { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.codicon { font-size: var(--icon) !important; line-height: 1; }

/* ---------------------------------------------------------- points status */
.status {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 6px;
  width: calc(100% - 2 * var(--pad));
  margin: 8px var(--pad) 0;
  padding: 7px 8px 8px;
  text-align: left;
  background: color-mix(in srgb, var(--gold) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--gold) 28%, transparent);
  border-radius: 4px;
  cursor: pointer;
}
.status:hover { background: color-mix(in srgb, var(--gold) 11%, transparent); }
.status:focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }
.status-icon { font-size: 15px; line-height: 1; text-align: center; }
.status-text { display: flex; flex-direction: column; min-width: 0; }
.status-level { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status-next { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status-points {
  font-size: 11px; font-weight: 600; color: var(--gold);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.status-bar {
  grid-column: 1 / -1;
  height: 2px; border-radius: 1px; overflow: hidden;
  background: color-mix(in srgb, var(--gold) 18%, transparent);
}
.status-fill { display: block; height: 100%; background: var(--gold); width: 0; }

/* ---------------------------------------------------------- search */
.search-area {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 4px;
  padding: 10px var(--pad) 8px;
  margin-bottom: 2px;
  background: var(--vscode-sideBar-background, transparent);
  border-bottom: 1px solid var(--line);
}
.search {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 2px 0 7px;
  background: var(--vscode-input-background, rgba(128,128,128,0.12));
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  color: var(--vscode-input-foreground, var(--fg));
}
.search:focus-within { border-color: var(--vscode-focusBorder, #007fd4); }
.search > .codicon { color: var(--muted); font-size: 14px !important; }
.search input {
  flex: 1 1 auto; min-width: 0; height: 100%; padding: 0;
  border: 0; outline: none; background: transparent; color: inherit; font: inherit;
}
.search input::placeholder { color: var(--vscode-input-placeholderForeground, var(--muted)); }
.search input::-webkit-search-cancel-button { display: none; }
.icon-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer;
}
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--hover)); color: var(--fg); }
.icon-btn:focus-visible { outline: 1px solid var(--focus); outline-offset: -1px; }
.search-all { width: 26px; height: 26px; }

/* ---------------------------------------------------------- tree */
.tree { padding: 4px 0 16px; outline: none; }
.group + .group { margin-top: 1px; }
.row {
  position: relative;
  display: flex; align-items: center; gap: var(--gap);
  height: var(--row);
  padding-right: var(--pad);
  cursor: pointer;
  outline: none;
  white-space: nowrap;
}
.row:hover { background: var(--hover); }
.row:focus-visible, .tree:focus-within .row.focused { outline: 1px solid var(--focus); outline-offset: -1px; }
.row .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row .hl { color: var(--highlight); font-weight: 600; }

/* Category rows: bolder, with a count, a chevron and the category colour. */
.cat { padding-left: var(--pad); font-weight: 600; }
.cat .twistie {
  width: var(--twistie); flex: none; display: inline-flex; justify-content: center;
  color: var(--muted); transition: transform .12s ease;
}
.cat[aria-expanded="true"] .twistie { transform: rotate(90deg); }
.cat .cat-icon { color: var(--cat); flex: none; }
.cat .count {
  flex: none; min-width: 18px; padding: 0 5px; text-align: center;
  font-size: 10.5px; font-weight: 500; line-height: 16px; border-radius: 8px;
  color: var(--muted); background: color-mix(in srgb, var(--fg) 7%, transparent);
  font-variant-numeric: tabular-nums;
}
/* The category holding the selected tool is marked in its own colour. */
.cat.current::before {
  content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px;
  border-radius: 0 2px 2px 0; background: var(--cat);
}
.cat.current .label { color: var(--vscode-list-activeSelectionForeground, var(--fg)); }

/* Tool rows: indented under the category icon with a guide line. */
.children { position: relative; padding-bottom: 4px; }
.children::before {
  content: ''; position: absolute; top: 0; bottom: 4px;
  left: calc(var(--pad) + var(--twistie) + var(--gap) + var(--icon) / 2 - .5px);
  width: 1px; background: var(--guide); opacity: .55;
}
.group:hover .children::before, .group.current .children::before { opacity: 1; }
.tool { padding-left: var(--child); font-weight: 400; }
.tool .codicon { color: var(--vscode-icon-foreground, var(--fg)); opacity: .85; flex: none; }
.tool:hover .codicon { opacity: 1; }
.tool.selected { background: var(--selected); }
.tool.selected::before {
  content: ''; position: absolute; left: calc(var(--child) - 9px); top: 5px; bottom: 5px; width: 2px;
  border-radius: 1px; background: var(--cat);
}
.tree:focus-within .tool.selected { background: var(--selected-focus); color: var(--selected-focus-fg); }
.tree:focus-within .tool.selected .codicon { color: inherit; opacity: 1; }

/* ---------------------------------------------------------- empty search */
.empty { padding: 14px var(--pad) 0 calc(var(--pad) + 4px); color: var(--muted); font-size: 12px; }
.empty p { margin: 0 0 6px; overflow-wrap: anywhere; }
.link {
  padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--vscode-textLink-foreground, #3794ff);
}
.link:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground, #3794ff); }
.link:focus-visible { outline: 1px solid var(--focus); outline-offset: 2px; }

/* Narrow sidebars keep the hierarchy but give labels more room. */
@media (max-width: 220px) {
  :root { --child: 36px; --gap: 5px; }
  .tool.selected::before { left: calc(var(--child) - 7px); }
  .status-next { display: none; }
}
@media (prefers-reduced-motion: reduce) { .cat .twistie { transition: none; } }
@media (forced-colors: active) {
  .tool.selected, .tree:focus-within .tool.selected { outline: 1px solid Highlight; }
  .cat.current::before, .tool.selected::before { background: Highlight; }
}
`;
//# sourceMappingURL=tools-sidebar.js.map