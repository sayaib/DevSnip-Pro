import * as vscode from "vscode";
import * as path from "path";
import { embedJson, escapeHtml, getNonce } from "../utils/webview-ui";
import { executeQueuedCommand } from "../utils/command-dispatch";
import { LEVELS, getCurrentLevel, getNextLevel, getUserStats } from "../commands/milestoneTracker";
import { MILESTONE_COMMAND, SEARCH_COMMAND, SIDEBAR_GROUPS, sidebarCommands } from "./tool-groups";

/**
 * The Tools view in the DevSnip Pro activity bar.
 *
 * A webview rather than a native tree so the navigation can have a search
 * box with filters, favorites, recently used tools, a rank card and hover
 * cards. It runs the same commands the tree did; the page behaviour lives in
 * media/tools-sidebar.js.
 */

export const TOOLS_VIEW_ID = "myView";
const EXPANDED_KEY = "devsnip.sidebar.expanded";
const FAVORITES_KEY = "devsnip.sidebar.favorites";
const USAGE_KEY = "devsnip.sidebar.usage";

export interface SidebarStatus {
  badge: string;
  level: string;
  points: number;
  lifetimePoints: number;
  nextLevel: string | null;
  /** Lifetime points still needed for the next level. */
  toNext: number;
  /** 0..1 progress through the current level. */
  progress: number;
}

/** How often and how recently each sidebar tool was opened, from any entry point. */
export type ToolUsage = Record<string, { count: number; last: number }>;

export function sidebarStatus(context: vscode.ExtensionContext): SidebarStatus {
  const stats = getUserStats(context);
  // The level follows lifetime points so spending never demotes it; the number is the spendable balance.
  const level = getCurrentLevel(stats.lifetimePoints);
  const next = getNextLevel(stats.lifetimePoints);
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

/** Maps a theme colour id (terminal.ansiBrightYellow) to its webview CSS variable. */
export function themeColorVar(colorId: string): string {
  return `--vscode-${colorId.replace(/\./g, "-")}`;
}

/** Keeps only well-formed entries for tools that are in the sidebar. */
export function cleanUsage(value: unknown): ToolUsage {
  const known = sidebarCommands();
  const out: ToolUsage = {};
  if (!value || typeof value !== "object") return out;
  for (const [command, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(command) || !entry || typeof entry !== "object") continue;
    const { count, last } = entry as { count?: unknown; last?: unknown };
    if (typeof count === "number" && typeof last === "number" && Number.isFinite(count) && Number.isFinite(last) && count > 0) {
      out[command] = { count: Math.floor(count), last };
    }
  }
  return out;
}

export function renderToolsSidebar(options: {
  cspSource: string;
  scriptUri: string;
  codiconsUri: string;
  status: SidebarStatus;
  expanded: string[];
  favorites?: string[];
  usage?: ToolUsage;
}): string {
  const nonce = getNonce();
  const known = sidebarCommands();
  const data = {
    groups: SIDEBAR_GROUPS.map(group => ({ ...group, colorVar: themeColorVar(group.color) })),
    status: options.status,
    levels: LEVELS.map(level => ({ name: level.name, badge: level.badge, minPoints: level.minPoints })),
    expanded: options.expanded.filter(name => SIDEBAR_GROUPS.some(group => group.name === name)),
    favorites: (options.favorites ?? []).filter(command => known.has(command)),
    usage: cleanUsage(options.usage),
    milestoneCommand: MILESTONE_COMMAND
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${options.cspSource}; style-src ${options.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeHtml(options.codiconsUri)}">
<style nonce="${nonce}">${SIDEBAR_CSS}</style>
<title>Tools</title>
</head>
<body>
<section class="rank" id="rank" aria-label="Your rank">
  <button type="button" class="rank-open" id="status" title="Open the Milestone &amp; Points Tracker">
    <span class="medal" id="statusBadge" aria-hidden="true"></span>
    <span class="rank-body">
      <span class="rank-line">
        <span class="rank-name" id="statusLevel"></span>
        <span class="rank-points" id="statusPoints"></span>
      </span>
      <span class="meter" id="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to the next rank"><span class="meter-fill" id="statusFill"></span></span>
      <span class="rank-line rank-sub">
        <span id="statusNext"></span>
        <span class="rank-pct" id="statusPct"></span>
      </span>
    </span>
  </button>
  <button type="button" class="rank-info icon-btn" id="rankInfo" aria-label="How ranks work" aria-controls="rankTip" aria-expanded="false"><span class="codicon codicon-info" aria-hidden="true"></span></button>
  <div class="popover" id="rankTip" role="tooltip" hidden></div>
</section>

<div class="toolbar" role="search">
  <div class="search" id="searchBox">
    <span class="codicon codicon-search" aria-hidden="true"></span>
    <input id="search" type="search" autocomplete="off" spellcheck="false" placeholder="Search tools" aria-label="Search tools" aria-controls="tree" aria-keyshortcuts="Control+K Meta+K /">
    <kbd class="kbd" id="searchKbd" aria-hidden="true"></kbd>
    <button type="button" class="icon-btn clear" id="clearSearch" title="Clear search (Esc)" aria-label="Clear search" hidden><span class="codicon codicon-close" aria-hidden="true"></span></button>
  </div>
  <div class="menu-wrap">
    <button type="button" class="icon-btn filter-btn" id="filterBtn" aria-haspopup="menu" aria-expanded="false" aria-controls="filterMenu" title="Filter tools" aria-label="Filter tools"><span class="codicon codicon-filter" aria-hidden="true"></span><span class="filter-dot" aria-hidden="true"></span></button>
    <div class="menu" id="filterMenu" role="menu" aria-label="Filter tools" hidden></div>
  </div>
</div>
<div class="filter-bar" id="filterBar" hidden>
  <span class="codicon codicon-filter" aria-hidden="true"></span>
  <span class="filter-label" id="filterLabel"></span>
  <button type="button" class="link" id="filterReset">Show all</button>
</div>

<div class="tree" id="tree" role="tree" aria-label="DevSnip Pro tools"></div>

<div class="empty" id="empty" hidden>
  <span class="codicon codicon-search empty-icon" id="emptyIcon" aria-hidden="true"></span>
  <p class="empty-title" id="emptyTitle"></p>
  <p class="empty-text" id="emptyText"></p>
  <div class="empty-actions" id="emptyActions"></div>
</div>

<div class="hovercard" id="hovercard" role="tooltip" hidden></div>
<p class="sr-only" id="announce" role="status" aria-live="polite"></p>

<script type="application/json" id="sidebar-data">${embedJson(data)}</script>
<script nonce="${nonce}" src="${escapeHtml(options.scriptUri)}"></script>
</body>
</html>`;
}

export class ToolsSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly known = sidebarCommands();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private post(message: unknown): void {
    if (!this.view) return;
    void this.view.webview.postMessage(message).then(undefined, () => undefined);
  }

  private get usage(): ToolUsage {
    return cleanUsage(this.context.globalState.get(USAGE_KEY));
  }

  private get favorites(): string[] {
    return this.context.globalState.get<string[]>(FAVORITES_KEY, []).filter(command => this.known.has(command));
  }

  /** Pushes the latest points and level to the page. */
  refresh(): void {
    this.post({ type: "status", status: sidebarStatus(this.context) });
  }

  /**
   * Called for every DevSnip Pro command run, from the sidebar, a hub or the
   * command palette, so "Recently used" and "Most used" reflect real use.
   */
  recordUsage(command: string): void {
    if (!this.known.has(command) || command === MILESTONE_COMMAND || command === SEARCH_COMMAND) return;
    const usage = this.usage;
    const entry = usage[command] ?? { count: 0, last: 0 };
    usage[command] = { count: entry.count + 1, last: Date.now() };
    void this.context.globalState.update(USAGE_KEY, usage);
    this.post({ type: "usage", usage });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const mediaRoot = vscode.Uri.file(path.join(this.context.extensionPath, "media"));
    const codiconsRoot = vscode.Uri.file(path.join(this.context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
    view.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot, codiconsRoot] };
    view.webview.html = renderToolsSidebar({
      cspSource: view.webview.cspSource,
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "tools-sidebar.js")).toString(),
      codiconsUri: view.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
      status: sidebarStatus(this.context),
      expanded: this.context.globalState.get<string[]>(EXPANDED_KEY, []),
      favorites: this.favorites,
      usage: this.usage
    });

    const groupNames = new Set(SIDEBAR_GROUPS.map(group => group.name));
    const subscription = view.webview.onDidReceiveMessage(async message => {
      if (message?.type === "run" && typeof message.command === "string" && this.known.has(message.command)) {
        // executeQueuedCommand also checks the id against this extension's commands.
        void executeQueuedCommand(message.command);
      } else if (message?.type === "searchAll") {
        void executeQueuedCommand(SEARCH_COMMAND);
      } else if (message?.type === "expanded" && Array.isArray(message.groups)) {
        const expanded = message.groups.filter((name: unknown): name is string => typeof name === "string" && groupNames.has(name));
        await this.context.globalState.update(EXPANDED_KEY, expanded);
      } else if (message?.type === "favorites" && Array.isArray(message.favorites)) {
        const favorites = message.favorites
          .filter((command: unknown): command is string => typeof command === "string" && this.known.has(command))
          .slice(0, 100);
        await this.context.globalState.update(FAVORITES_KEY, Array.from(new Set(favorites)));
      }
    });
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); });
    view.onDidDispose(() => {
      subscription.dispose();
      if (this.view === view) this.view = undefined;
    });
  }
}

const SIDEBAR_CSS = `
:root {
  /* Spacing: an 8px system with a 4px half-step. */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --radius: 6px;
  --radius-sm: 4px;
  --row: 26px;
  --icon: 16px;
  --twistie: 16px;
  --inset: 6px;
  /* Where a category's icon sits inside its row; tools and the guide line align to it. */
  --cat-icon-x: calc(2px + var(--twistie) + 6px);

  /* Colour roles, all from the VS Code theme. */
  --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground, #cccccc));
  --fg-strong: var(--vscode-list-activeSelectionForeground, var(--fg));
  --muted: var(--vscode-descriptionForeground, rgba(204,204,204,0.7));
  --bg: var(--vscode-sideBar-background, #181818);
  --surface: color-mix(in srgb, var(--fg) 4%, var(--bg));
  --surface-2: color-mix(in srgb, var(--fg) 8%, var(--bg));
  --border: color-mix(in srgb, var(--fg) 10%, transparent);
  --border-strong: color-mix(in srgb, var(--fg) 17%, transparent);
  --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12));
  --accent: var(--vscode-focusBorder, #0078d4);
  --accent-fg: var(--vscode-textLink-foreground, #4daafc);
  --selected: color-mix(in srgb, var(--accent) 15%, transparent);
  --selected-focus: color-mix(in srgb, var(--accent) 24%, transparent);
  --guide: var(--vscode-tree-indentGuidesStroke, rgba(128,128,128,0.4));
  --highlight: var(--vscode-list-highlightForeground, #2aaaff);
  --gold: var(--vscode-terminal-ansiBrightYellow, #e5c07b);
  --shadow: var(--vscode-widget-shadow, rgba(0,0,0,0.36));
  --ease: cubic-bezier(.2, .7, .3, 1);
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
  padding-bottom: var(--s4);
}
button { font: inherit; color: inherit; }
[hidden] { display: none !important; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.codicon { font-size: var(--icon) !important; line-height: 1; }
.icon-btn {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0;
  border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); cursor: pointer;
  transition: background-color .1s ease, color .1s ease;
}
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, var(--hover)); color: var(--fg); }
.icon-btn:focus-visible, .link:focus-visible, .rank-open:focus-visible, .btn:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.link { padding: 0; border: 0; background: none; cursor: pointer; color: var(--accent-fg); font-size: 12px; }
.link:hover { text-decoration: underline; }
.btn {
  height: 26px; padding: 0 var(--s3); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px;
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground, var(--surface-2));
  color: var(--vscode-button-secondaryForeground, var(--fg));
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--hover)); }

/* ------------------------------------------------------------- rank card */
.rank {
  position: relative;
  margin: var(--s2) var(--s2) 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.rank-open {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: var(--s2) 30px var(--s2) var(--s2);
  border: 0; border-radius: var(--radius); background: transparent; cursor: pointer; text-align: left;
  transition: background-color .12s ease;
}
.rank-open:hover { background: var(--surface-2); }
.medal {
  flex: none; display: grid; place-items: center;
  width: 30px; height: 30px; border-radius: 50%;
  font-size: 16px; line-height: 1;
  background: color-mix(in srgb, var(--gold) 13%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gold) 32%, transparent);
}
.rank-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.rank-line { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s2); min-width: 0; }
.rank-name { font-weight: 600; font-size: 13px; color: var(--fg-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank-points { flex: none; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--gold); }
.rank-sub { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.rank-sub > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-pct { flex: none; }
.meter { position: relative; display: block; height: 4px; border-radius: 2px; overflow: hidden; background: color-mix(in srgb, var(--fg) 10%, transparent); }
.meter-fill {
  display: block; height: 100%; width: 0; border-radius: 2px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--gold) 70%, transparent), var(--gold));
  transition: width .8s var(--ease);
}
.rank-info { position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; }
.rank-info .codicon { font-size: 14px !important; }
.rank-info[aria-expanded="true"] { color: var(--fg); background: var(--surface-2); }

/* Popovers (rank explainer) and hover cards share one surface. */
.popover, .hovercard {
  position: fixed; z-index: 40;
  width: max-content;
  max-width: min(280px, calc(100vw - 16px));
  padding: var(--s2) 10px;
  background: var(--vscode-editorHoverWidget-background, var(--surface-2));
  color: var(--vscode-editorHoverWidget-foreground, var(--fg));
  border: 1px solid var(--vscode-editorHoverWidget-border, var(--border-strong));
  border-radius: var(--radius);
  box-shadow: 0 6px 18px var(--shadow);
  font-size: 12px; line-height: 1.5;
  white-space: normal;
  pointer-events: none;
  animation: pop .12s var(--ease);
}
@keyframes pop { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
.pop-title, .hc-title { margin: 0 0 2px; font-weight: 600; color: var(--fg-strong); }
.pop-text, .hc-text { margin: 0; color: var(--fg); }
.hc-meta { margin: 6px 0 0; color: var(--muted); font-size: 11px; display: flex; flex-wrap: wrap; gap: 2px 10px; }
.levels { margin: var(--s2) 0 0; padding: 0; list-style: none; display: grid; gap: 1px; }
.levels li { display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 6px; padding: 1px 6px; border-radius: var(--radius-sm); font-variant-numeric: tabular-nums; }
.levels .pts { color: var(--muted); }
.levels li.reached .pts::after { content: ' ✓'; color: var(--vscode-testing-iconPassed, #73c991); }
.levels li.current { background: color-mix(in srgb, var(--gold) 13%, transparent); font-weight: 600; }

/* ------------------------------------------------------------- toolbar */
.toolbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: var(--s1);
  padding: var(--s2);
  background: var(--bg);
}
.search {
  flex: 1 1 auto; min-width: 0;
  display: flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 var(--s1) 0 var(--s2);
  background: var(--vscode-input-background, var(--surface));
  border: 1px solid var(--vscode-input-border, var(--border));
  border-radius: var(--radius);
  color: var(--vscode-input-foreground, var(--fg));
  transition: border-color .12s ease, box-shadow .12s ease;
}
.search:hover { border-color: var(--border-strong); }
.search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.search > .codicon { color: var(--muted); font-size: 14px !important; }
.search:focus-within > .codicon { color: var(--fg); }
.search input {
  flex: 1 1 auto; min-width: 0; height: 100%; padding: 0;
  border: 0; outline: none; background: transparent; color: inherit; font: inherit;
}
.search input::placeholder { color: var(--vscode-input-placeholderForeground, var(--muted)); }
.search input::-webkit-search-cancel-button { display: none; }
.kbd {
  flex: none; margin-right: 2px; padding: 0 5px; border-radius: var(--radius-sm);
  font: 10.5px/16px var(--vscode-font-family, sans-serif); color: var(--muted);
  border: 1px solid var(--border-strong); background: var(--surface);
}
.search:focus-within .kbd, .search.has-value .kbd { display: none; }
.clear { width: 20px; height: 20px; }
.clear .codicon { font-size: 14px !important; }
.menu-wrap { position: relative; flex: none; }
.filter-btn { width: 28px; height: 28px; position: relative; border-radius: var(--radius); }
.filter-btn[aria-expanded="true"] { background: var(--surface-2); color: var(--fg); }
.filter-btn.active { color: var(--accent-fg); background: color-mix(in srgb, var(--accent) 15%, transparent); }
.filter-dot { display: none; position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent-fg); box-shadow: 0 0 0 2px var(--bg); }
.filter-btn.active .filter-dot { display: block; }
.menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 30;
  min-width: 200px; max-height: 70vh; overflow-y: auto; padding: var(--s1);
  background: var(--vscode-menu-background, var(--surface-2));
  color: var(--vscode-menu-foreground, var(--fg));
  border: 1px solid var(--vscode-menu-border, var(--border-strong));
  border-radius: var(--radius);
  box-shadow: 0 8px 22px var(--shadow);
  animation: pop .12s var(--ease);
}
.menu-label { padding: 6px 8px 2px; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.menu-item {
  display: flex; align-items: center; gap: var(--s2); width: 100%;
  height: 26px; padding: 0 var(--s2); border: 0; border-radius: var(--radius-sm);
  background: transparent; cursor: pointer; text-align: left; font-size: 12.5px; white-space: nowrap;
}
.menu-item:hover, .menu-item:focus-visible { outline: none; background: var(--vscode-menu-selectionBackground, var(--hover)); color: var(--vscode-menu-selectionForeground, inherit); }
.menu-item .check { width: 14px; flex: none; font-size: 14px !important; color: var(--accent-fg); visibility: hidden; }
.menu-item[aria-checked="true"] .check { visibility: visible; }
.menu-item .item-icon { color: var(--muted); }
.menu-item .menu-count { margin-left: auto; padding-left: var(--s3); color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.menu-sep { height: 1px; margin: var(--s1) 2px; background: var(--border); }
.filter-bar {
  display: flex; align-items: center; gap: 6px;
  margin: 0 var(--s2) var(--s1); padding: 0 var(--s2); height: 24px;
  border-radius: var(--radius-sm); font-size: 11.5px; color: var(--muted);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.filter-bar .codicon { font-size: 12px !important; color: var(--accent-fg); }
.filter-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); }
.filter-bar .link { font-size: 11.5px; flex: none; }

/* ------------------------------------------------------------- tree */
.tree { outline: none; }
.section-label {
  display: flex; align-items: center; gap: var(--s2);
  margin: var(--s3) 0 var(--s1); padding: 0 var(--s2) 0 calc(var(--inset) + var(--s2));
  font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--muted);
}
.section-label:first-child { margin-top: var(--s1); }
.section-label::after { content: ''; flex: 1 1 auto; height: 1px; background: var(--border); }
.row {
  position: relative;
  display: flex; align-items: center; gap: var(--s2);
  height: var(--row);
  margin: 0 var(--inset);
  padding-right: var(--s1);
  border-radius: var(--radius-sm);
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  transition: background-color .08s ease;
}
.row:hover { background: var(--hover); }
.row:focus-visible, .tree:focus-within .row.focused { box-shadow: inset 0 0 0 1px var(--accent); }
.row .label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.row .hl { color: var(--highlight); font-weight: 600; }
.row .meta { flex: none; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }

/* Category rows */
.cat { padding-left: 2px; gap: 6px; font-weight: 600; font-size: 12.5px; letter-spacing: .005em; padding-right: 6px; }
.cat .label { color: var(--fg-strong); }
.group + .group { margin-top: 2px; }
.twistie { width: var(--twistie); flex: none; display: inline-flex; justify-content: center; color: var(--muted); transition: transform .16s var(--ease); }
.twistie.codicon { font-size: 14px !important; }
.group.open > .cat .twistie { transform: rotate(90deg); }
.cat-icon { flex: none; color: var(--cat); }
.count {
  flex: none; min-width: 20px; height: 16px; padding: 0 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 600; border-radius: 8px;
  color: var(--muted); background: color-mix(in srgb, var(--fg) 8%, transparent);
  font-variant-numeric: tabular-nums;
}
.count.matched { color: var(--accent-fg); background: color-mix(in srgb, var(--accent) 16%, transparent); }
/* A collapsed category that holds the selected tool says so with a dot. */
.holds { display: none; width: 6px; height: 6px; border-radius: 50%; background: var(--accent-fg); flex: none; }
.group.current:not(.open) > .cat .holds { display: block; }

/* Smooth expand and collapse without measuring heights. */
.children {
  display: grid; grid-template-rows: 0fr;
  transition: grid-template-rows .18s var(--ease);
}
.group.open > .children { grid-template-rows: 1fr; }
.children-inner {
  position: relative; min-height: 0; overflow: hidden;
  visibility: hidden; transition: visibility 0s linear .18s;
}
.group.open > .children > .children-inner { visibility: visible; transition-delay: 0s; }
.children-inner > :first-child { margin-top: 1px; }
.children-inner > :last-child { margin-bottom: var(--s1); }
.children-inner::before {
  content: ''; position: absolute; top: 2px; bottom: 6px;
  left: calc(var(--inset) + var(--cat-icon-x) + var(--icon) / 2 - .5px);
  width: 1px; background: var(--guide); opacity: .4; transition: opacity .12s ease;
}
.group:hover .children-inner::before, .group.current .children-inner::before { opacity: .85; }
.tool { padding-left: calc(var(--cat-icon-x) + var(--icon) + 4px); }
.flat .tool { padding-left: var(--s2); }
.tool > .tool-icon { flex: none; color: var(--vscode-icon-foreground, var(--fg)); opacity: .78; transition: opacity .08s ease; }
.tool:hover > .tool-icon { opacity: 1; }
.tool .label { color: var(--fg); }

/* Selection: a tinted surface and an accent icon instead of a side bar. */
.tool.selected { background: var(--selected); }
.tool.selected .label { color: var(--fg-strong); font-weight: 500; }
.tool.selected > .tool-icon { color: var(--accent-fg); opacity: 1; }
.tree:focus-within .tool.selected { background: var(--selected-focus); }

/* Favorite star: overlays the end of the row on hover or focus (like VS Code's
   row actions), and keeps its own space once set, so names are not cut short
   by an invisible button. */
.star {
  position: absolute; right: 3px; top: 3px;
  display: none; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: var(--radius-sm);
  color: var(--muted); cursor: pointer;
}
.star .codicon { font-size: 14px !important; }
.row:hover .star, .tree:focus-within .row.focused .star, .star.on { display: inline-flex; }
.tool:hover > .label, .tree:focus-within .tool.focused > .label, .tool.fav > .label { margin-right: 22px; }
.tool.has-meta:hover > .label, .tree:focus-within .tool.has-meta.focused > .label, .tool.has-meta.fav > .label { margin-right: 0; }
.tool.has-meta:hover > .meta, .tree:focus-within .tool.has-meta.focused > .meta, .tool.has-meta.fav > .meta { margin-right: 22px; }
.star:hover { background: var(--surface-2); color: var(--fg); }
.star.on { color: var(--gold); }

/* Security keeps the shared layout, with its own colour on the header and tools. */
.group.security > .cat { background: color-mix(in srgb, var(--cat) 8%, transparent); }
.group.security > .cat:hover { background: color-mix(in srgb, var(--cat) 13%, transparent); }
.group.security .tool > .tool-icon { color: var(--cat); opacity: .85; }
.group.security .tool.selected > .tool-icon { color: var(--accent-fg); opacity: 1; }
.group.security .children-inner::before { background: var(--cat); opacity: .35; }

/* ------------------------------------------------------------- empty state */
.empty { margin: var(--s2) var(--s2) 0; padding: var(--s4) var(--s3); text-align: center; color: var(--muted); border: 1px dashed var(--border-strong); border-radius: var(--radius); }
.empty-icon { font-size: 20px !important; opacity: .7; }
.empty-title { margin: var(--s2) 0 var(--s1); color: var(--fg); font-weight: 600; overflow-wrap: anywhere; user-select: text; }
.empty-text { margin: 0 0 var(--s3); font-size: 12px; line-height: 1.5; }
.empty-actions { display: flex; flex-direction: column; align-items: center; gap: var(--s2); }

/* ------------------------------------------------------------- narrow widths */
@media (max-width: 240px) {
  :root { --inset: 4px; --twistie: 14px; }
  .row { gap: 6px; }
  .tool { padding-left: calc(var(--cat-icon-x) + var(--icon) - 2px); }
  .rank-pct, .kbd { display: none; }
  .row .meta { display: none; }
}
@media (max-width: 190px) {
  .medal { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before { transition-duration: 0s !important; transition-delay: 0s !important; animation: none !important; }
}
@media (forced-colors: active) {
  .tool.selected, .tree:focus-within .tool.selected { outline: 1px solid Highlight; }
  .meter-fill { background: Highlight; }
}
`;
