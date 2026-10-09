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
exports.openToolHub = exports.renderToolHub = exports.validateHub = exports.HUB_ICONS = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const webview_ui_1 = require("./webview-ui");
const command_dispatch_1 = require("./command-dispatch");
const service_1 = require("../theme/service");
/**
 * The tool grid shared by every hub (Developer Tools, AI/ML, RAG, Big Data).
 *
 * One renderer keeps the hubs visually identical and fixes their shared bugs
 * in one place: each hub used to call acquireVsCodeApi() on every click, which
 * VS Code rejects after the first call, so only the first card ever opened.
 * The page behaviour lives in media/tool-hub.js; this module supplies the
 * markup, styles, icons and data, and handles messages from the page.
 */
/** Line icons (24×24, stroke = currentColor) so every card renders the same on every OS and theme. */
exports.HUB_ICONS = {
    package: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    regex: '<path d="M17 3v10M12.7 5.5l8.6 5M12.7 10.5l8.6-5"/><rect x="3" y="15" width="6" height="6" rx="1"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
    binary: '<rect x="6" y="4" width="4" height="6" rx="2"/><rect x="14" y="14" width="4" height="6" rx="2"/><path d="M14 4h2v6M14 10h4M6 14h2v6M6 20h4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    tree: '<path d="M5 3v15a2 2 0 0 0 2 2h4M5 8h6"/><rect x="13" y="5" width="8" height="6" rx="1.5"/><rect x="13" y="15" width="8" height="6" rx="1.5"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.2-4-7.6-9-7.6z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    text: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    coins: '<circle cx="9" cy="9" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.4 18.1"/><path d="M8 7h1.5v4"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
    code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    api: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/><circle cx="12" cy="12" r="2"/>',
    split: '<path d="M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.2-2.8L3 3M15 9l6-6"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
    notebook: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v20H7.5A2.5 2.5 0 0 1 5 19.5z"/><path d="M9 7h7M9 11h5"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    lineChart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    barChart: '<path d="M3 3v18h18"/><path d="M8 17v-4M13 17V8M18 17v-7"/>',
    gauge: '<path d="M3.3 19a10 10 0 1 1 17.4 0"/><path d="M12 14l4-4"/><circle cx="12" cy="14" r="1"/>',
    zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 13h6M7 16h9"/>',
    layers: '<path d="M12 2l10 5-10 5L2 7z"/><path d="M2 12l10 5 10-5M2 17l10 5 10-5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    merge: '<circle cx="6" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.3 7.2A9 9 0 0 0 15.5 12"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    diff: '<path d="M12 3v14M5 10h14M5 21h14"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    cloud: '<path d="M17.5 19H8a6 6 0 1 1 5.7-7.9A4.5 4.5 0 1 1 17.5 19z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5.6 9.6A2 2 0 0 0 6.1 21.5h11.8a2 2 0 0 0 1.7-2.9L14 9V3"/><path d="M7.5 15h9"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    container: '<path d="M3 11h18v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z"/><path d="M6 8h3v3H6zM10 8h3v3h-3zM14 8h3v3h-3zM10 4h3v4h-3z"/>',
    wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21M5.6 5.6l4.6 4.6M13.8 13.8l4.6 4.6M18.4 5.6l-4.6 4.6M10.2 13.8l-4.6 4.6"/>',
    workflow: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 7.5v9M8.5 5H13a3 3 0 0 1 3 3v1.5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/><path d="M7 12h2l1.5-2 2 4 1.5-2h3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    fingerprint: '<path d="M12 11v3a8 8 0 0 1-2 5M8 7.5A5 5 0 0 1 17 11v2a12 12 0 0 1-1 5M5 11a7 7 0 0 1 1.2-4M19 17c.6-1.9 1-3.9 1-6a8 8 0 0 0-12-6.9"/><path d="M9 11a3 3 0 0 1 6 0v2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 18h2"/>',
    type: '<path d="M4 7V5h16v2M9 20h6M12 5v15"/>',
    wand: '<path d="M15 4V2M15 10V8M11 6h-2M21 6h-2M17.8 3.2l-1.4 1.4M17.8 8.8l-1.4-1.4M3 21l10-10"/><path d="M12.2 3.2l1.4 1.4"/>',
    checklist: '<path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9"/>',
    filter: '<path d="M3 4h18l-7 8.5V20l-4-2v-5.5z"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    rocket: '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    network: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-2.5A1.5 1.5 0 0 1 6.5 13h11a1.5 1.5 0 0 1 1.5 1.5V17"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
};
const PINNED_PREFIX = "devsnip.hub.pinned.";
/** Checks a hub definition; a mistake here would silently hide a tool. */
function validateHub(config) {
    const problems = [];
    const commands = new Set();
    for (const tool of config.tools) {
        if (!config.categories.includes(tool.category))
            problems.push(`${tool.title}: unknown category "${tool.category}"`);
        if (!(tool.icon in exports.HUB_ICONS))
            problems.push(`${tool.title}: unknown icon "${tool.icon}"`);
        if (commands.has(tool.command))
            problems.push(`${tool.title}: duplicate command ${tool.command}`);
        commands.add(tool.command);
        if (!tool.description.trim() || !tool.title.trim())
            problems.push(`${tool.command}: missing title or description`);
    }
    for (const [category, steps] of Object.entries(config.journeys ?? {})) {
        if (!config.categories.includes(category))
            problems.push(`journey for unknown category "${category}"`);
        for (const step of steps)
            if (!commands.has(step.command))
                problems.push(`journey step "${step.title}" opens a command that is not in the hub`);
    }
    for (const category of config.categories) {
        if (!config.tools.some(t => t.category === category))
            problems.push(`category "${category}" has no tools`);
    }
    return problems;
}
exports.validateHub = validateHub;
function renderToolHub(config, options) {
    const data = {
        viewType: config.viewType,
        categories: config.categories,
        tools: config.tools,
        pinned: options.pinned.filter(c => config.tools.some(t => t.command === c)),
        journeys: config.journeys ?? {},
        initialCategory: options.initialCategory && config.categories.includes(options.initialCategory) ? options.initialCategory : undefined,
        icons: exports.HUB_ICONS
    };
    const categoryCount = config.categories.length;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${options.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${(0, webview_ui_1.escapeHtml)(config.heading)}</title>
<style>${webview_ui_1.THEME_TOKENS}${HUB_CSS}</style>
</head>
<body>
<div class="hub">
  <header class="hub-header">
    <div class="hub-heading">
      <h1>${(0, webview_ui_1.escapeHtml)(config.heading)}</h1>
      <p class="hub-subtitle">${(0, webview_ui_1.escapeHtml)(config.subtitle)}</p>
    </div>
    <p class="hub-count" id="hubCount">${config.tools.length} tools · ${categoryCount} categories</p>
  </header>
  <div class="hub-toolbar" role="search">
    <label class="search">
      <svg viewBox="0 0 24 24" aria-hidden="true">${exports.HUB_ICONS.search}</svg>
      <input id="search" type="search" autocomplete="off" spellcheck="false" placeholder="${(0, webview_ui_1.escapeHtml)(config.searchPlaceholder ?? "Search tools")}" aria-label="Search tools">
      <kbd aria-hidden="true">/</kbd>
    </label>
    <div class="chips" id="chips" role="group" aria-label="Filter by category"></div>
  </div>
  <p class="sr-only" id="status" role="status" aria-live="polite"></p>
  <section class="journey" id="journey" hidden aria-label="Start here"></section>
  <main id="results" class="results"></main>
  <div class="empty" id="empty" hidden>
    <svg viewBox="0 0 24 24" aria-hidden="true">${exports.HUB_ICONS.search}</svg>
    <p class="empty-title">No tools match “<span id="emptyQuery"></span>”</p>
    <p class="empty-text">Try a shorter word, or search every DevSnip Pro tool.</p>
    <div class="empty-actions">
      <button type="button" class="btn" id="clearSearch">Clear search</button>
      <button type="button" class="btn btn-secondary" id="searchAll">Search all tools</button>
    </div>
  </div>
</div>
<script type="application/json" id="hub-data">${(0, webview_ui_1.embedJson)(data)}</script>
<script src="${(0, webview_ui_1.escapeHtml)(options.scriptUri)}"></script>
</body>
</html>`;
}
exports.renderToolHub = renderToolHub;
/** Opens (or reveals) a hub panel and wires its messages. */
function openToolHub(context, config, initialCategory) {
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
    const { panel, created } = (0, webview_ui_1.openToolPanel)(config.viewType, config.panelTitle, { enableScripts: true, localResourceRoots: [mediaRoot] });
    if (!created) {
        // Already open: switch it to the requested section.
        if (initialCategory)
            void panel.webview.postMessage({ command: "showCategory", category: initialCategory });
        return;
    }
    const pinnedKey = PINNED_PREFIX + config.viewType;
    const known = new Set(config.tools.map(t => t.command));
    (0, service_1.setWebviewHtml)(panel.webview, renderToolHub(config, {
        cspSource: panel.webview.cspSource,
        scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "tool-hub.js")).toString(),
        pinned: context.globalState.get(pinnedKey, []),
        initialCategory
    }));
    const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === "openTool" && typeof message.toolCommand === "string" && known.has(message.toolCommand)) {
            // executeQueuedCommand also checks the id against this extension's commands.
            void (0, command_dispatch_1.executeQueuedCommand)(message.toolCommand);
        }
        else if (message?.command === "setPinned" && Array.isArray(message.pinned)) {
            const pinned = message.pinned.filter((c) => typeof c === "string" && known.has(c)).slice(0, 50);
            await context.globalState.update(pinnedKey, pinned);
        }
        else if (message?.command === "searchAll") {
            void (0, command_dispatch_1.executeQueuedCommand)("sayaib.hue-console.searchTools");
        }
    });
    panel.onDidDispose(() => subscription.dispose());
}
exports.openToolHub = openToolHub;
const HUB_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
:root {
  --card-bg: color-mix(in srgb, var(--text) 3%, var(--bg));
  --card-bg-hover: color-mix(in srgb, var(--text) 6%, var(--bg));
  --card-line: color-mix(in srgb, var(--text) 12%, transparent);
  --radius: 10px;
  --ease: cubic-bezier(.2, .7, .3, 1);
  --c0: var(--vscode-charts-blue, #3794ff);
  --c1: var(--vscode-charts-purple, #b180d7);
  --c2: var(--vscode-charts-green, #89d185);
  --c3: var(--vscode-charts-orange, #d18616);
  --c4: var(--vscode-charts-yellow, #cca700);
  --c5: var(--vscode-charts-red, #f14c4c);
}
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.hub { max-width: 1180px; margin: 0 auto; padding: 28px 28px 48px; }

/* Header */
.hub-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.hub-header h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -.01em; }
.hub-subtitle { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.hub-count { margin: 0; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }

/* Toolbar: sticks while the grid scrolls */
.hub-toolbar {
  position: sticky; top: 0; z-index: 5;
  display: flex; flex-direction: column; gap: 10px;
  padding: 10px 0 12px; margin-bottom: 6px;
  background: var(--bg);
  border-bottom: 1px solid var(--card-line);
}
.search {
  display: flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 10px;
  background: var(--vscode-input-background, var(--panel-2));
  border: 1px solid var(--vscode-input-border, var(--card-line));
  border-radius: 8px;
  max-width: 460px;
}
.search:focus-within { border-color: var(--focus); outline: 1px solid var(--focus); outline-offset: -1px; }
.search svg { width: 15px; height: 15px; flex: none; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--vscode-input-foreground, var(--text)); font: inherit; }
.search input::placeholder { color: var(--vscode-input-placeholderForeground, var(--muted)); }
.search input::-webkit-search-cancel-button { cursor: pointer; }
.search kbd {
  font-family: var(--mono); font-size: 11px; line-height: 1;
  padding: 3px 6px; border-radius: 4px; color: var(--muted);
  border: 1px solid var(--card-line);
}
.search:focus-within kbd { display: none; }

.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px;
  border-radius: 999px; border: 1px solid var(--card-line);
  background: transparent; color: var(--text);
  font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
  transition: background .15s var(--ease), border-color .15s var(--ease);
}
.chip:hover { background: var(--card-bg-hover); }
.chip .n { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 11px; }
.chip[aria-pressed="true"] { background: var(--accent-strong); border-color: var(--accent-strong); color: var(--accent-fg); }
.chip[aria-pressed="true"] .n { color: inherit; opacity: .8; }
.chip:focus-visible, .card:focus-visible, .pin:focus-visible, .btn:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

/* Guided path */
.journey { margin-top: 18px; padding: 14px 16px 16px; border: 1px solid var(--card-line); border-radius: var(--radius); background: color-mix(in srgb, var(--accent) 5%, var(--bg)); }
.journey-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.journey-head h2 { margin: 0; font-size: 13px; font-weight: 650; }
.journey-head p { margin: 0; color: var(--muted); font-size: 12px; }
.steps { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; counter-reset: step; list-style: none; margin: 0; padding: 0; }
.step button {
  width: 100%; height: 100%; text-align: left; font: inherit; color: inherit; cursor: pointer;
  display: flex; flex-direction: column; gap: 3px; padding: 9px 11px;
  border: 1px solid var(--card-line); border-radius: 8px; background: var(--card-bg);
  transition: border-color .15s var(--ease), background .15s var(--ease);
}
.step button:hover { border-color: var(--accent); background: var(--card-bg-hover); }
.step button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.step-title { font-weight: 600; font-size: 12.5px; }
.step-text { color: var(--muted); font-size: 11.5px; line-height: 1.4; }

/* Sections */
.group { margin-top: 22px; }
.group-title {
  display: flex; align-items: center; gap: 8px;
  margin: 0 0 10px; font-size: 11px; font-weight: 600;
  letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
}
.group-title::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: var(--cat, var(--accent)); }
.group-title .n { font-weight: 500; letter-spacing: 0; text-transform: none; opacity: .8; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }

/* Card */
.card-wrap { position: relative; }
.card {
  display: grid; grid-template-rows: auto 1fr auto; gap: 10px;
  width: 100%; height: 100%; min-height: 148px;
  padding: 16px 16px 14px;
  text-align: left; font: inherit; color: inherit; cursor: pointer;
  background: var(--card-bg);
  border: 1px solid var(--card-line);
  border-radius: var(--radius);
  transition: background .18s var(--ease), border-color .18s var(--ease), box-shadow .18s var(--ease), transform .18s var(--ease);
}
.card:hover {
  background: var(--card-bg-hover);
  border-color: color-mix(in srgb, var(--cat) 55%, var(--card-line));
  box-shadow: 0 6px 18px -10px color-mix(in srgb, var(--cat) 60%, transparent), 0 1px 2px rgba(0, 0, 0, .12);
  transform: translateY(-1px);
}
.card:active { transform: translateY(0); }
.card-head { display: flex; align-items: center; gap: 12px; padding-right: 26px; min-width: 0; }
.card-icon {
  flex: none; width: 36px; height: 36px; border-radius: 9px;
  display: grid; place-items: center;
  color: var(--cat);
  background: color-mix(in srgb, var(--cat) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--cat) 24%, transparent);
  transition: background .18s var(--ease);
}
.card:hover .card-icon { background: color-mix(in srgb, var(--cat) 22%, transparent); }
.card-icon svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.card-title { font-size: 13.5px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.card-title mark, .card-desc mark { background: color-mix(in srgb, var(--vscode-editor-findMatchHighlightBackground, #ea5c0055) 100%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
.card-desc {
  margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.card-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tag:empty { display: none; }
.tag.live { color: var(--vscode-charts-green, #89d185); background: color-mix(in srgb, var(--vscode-charts-green, #89d185) 12%, transparent); }
.tag.net { color: var(--vscode-charts-orange, #d18616); background: color-mix(in srgb, var(--vscode-charts-orange, #d18616) 12%, transparent); }
.tag {
  font-size: 11px; font-weight: 500; line-height: 1;
  padding: 4px 8px; border-radius: 999px;
  color: var(--text);
  background: color-mix(in srgb, var(--text) 7%, transparent);
}
.open {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 500; color: var(--accent);
  opacity: 0; transform: translateX(-4px);
  transition: opacity .18s var(--ease), transform .18s var(--ease);
}
.open svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.card:hover .open, .card:focus-visible .open { opacity: 1; transform: none; }

/* Pin */
.pin {
  position: absolute; top: 10px; right: 10px;
  width: 26px; height: 26px; border-radius: 6px;
  display: grid; place-items: center;
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
  opacity: 0; transition: opacity .15s var(--ease), background .15s var(--ease), color .15s var(--ease);
}
.pin svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
.card-wrap:hover .pin, .pin:focus-visible, .pin[aria-pressed="true"] { opacity: 1; }
.pin:hover { background: var(--card-bg-hover); color: var(--text); }
.pin[aria-pressed="true"] { color: var(--vscode-charts-yellow, #cca700); }
.pin[aria-pressed="true"] svg { fill: currentColor; }

/* Empty state */
.empty { text-align: center; padding: 56px 16px; color: var(--muted); }
.empty > svg { width: 32px; height: 32px; fill: none; stroke: currentColor; stroke-width: 1.6; opacity: .7; }
.empty-title { margin: 12px 0 4px; font-size: 14px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; }
.empty-text { margin: 0 0 16px; }
.empty-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.btn {
  height: 28px; padding: 0 12px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
  border: 1px solid transparent; background: var(--accent-strong); color: var(--accent-fg);
}
.btn:hover { background: var(--vscode-button-hoverBackground, var(--accent-strong)); }
.btn-secondary { background: transparent; color: var(--text); border-color: var(--card-line); }
.btn-secondary:hover { background: var(--card-bg-hover); }

/* High contrast themes: rely on borders, not tints */
body.vscode-high-contrast .card, body.vscode-high-contrast-light .card { border-color: var(--vscode-contrastBorder, currentColor); }
body.vscode-high-contrast .card:hover, body.vscode-high-contrast-light .card:hover { outline: 1px dashed var(--vscode-contrastActiveBorder, currentColor); transform: none; box-shadow: none; }

/* Narrow panels */
@media (max-width: 640px) {
  .hub { padding: 18px 14px 36px; }
  .hub-header h1 { font-size: 17px; }
  .search { max-width: none; }
  .search kbd { display: none; }
  .chips { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -14px; padding: 0 14px 2px; }
  .chips::-webkit-scrollbar { display: none; }
  .grid { grid-template-columns: 1fr; gap: 10px; }
  .card { min-height: 0; padding: 14px; }
  .card-desc { -webkit-line-clamp: 2; }
  .open { opacity: 1; transform: none; }
  .pin { opacity: 1; }
}
@media (hover: none) { .open, .pin { opacity: 1; transform: none; } .search kbd { display: none; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } .card:hover { transform: none; } }
`;
//# sourceMappingURL=tool-hub.js.map