import * as vscode from "vscode";
import * as path from "path";
import { embedJson, escapeHtml, getNonce } from "../utils/webview-ui";
import { executeQueuedCommand } from "../utils/command-dispatch";
import { LEVELS, getCurrentLevel, getNextLevel, getUserStats } from "../commands/milestoneTracker";
import { MILESTONE_COMMAND, SEARCH_COMMAND, SIDEBAR_GROUPS, sidebarCommands } from "./tool-groups";
import { currentThemeId, setTheme, setWebviewHtml, ThemeChoice, themeChoices } from "../theme/service";
import { dismissGuide, dismissWhatsNew, GuideStep, guideSteps, guideVisible, onDidChangeActivation, whatsNew } from "../onboarding/activation";
import { track } from "../analytics";
import { isKnownCommand } from "../utils/command-registry";

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

/** What the sidebar's onboarding cards show; null hides a card. */
export interface SidebarOnboarding {
  guide: GuideStep[] | null;
  whatsNew: { version: string; items: Array<{ title: string; command?: string }> } | null;
}

export function renderToolsSidebar(options: {
  cspSource: string;
  scriptUri: string;
  codiconsUri: string;
  status: SidebarStatus;
  expanded: string[];
  favorites?: string[];
  usage?: ToolUsage;
  theme?: { current: string; choices: ThemeChoice[] };
  onboarding?: SidebarOnboarding;
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
    milestoneCommand: MILESTONE_COMMAND,
    theme: options.theme ?? { current: "system", choices: [] },
    onboarding: options.onboarding ?? { guide: null, whatsNew: null }
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
<div class="appearance" id="appearance">
  <button type="button" class="theme-btn" id="themeBtn" aria-haspopup="listbox" aria-expanded="false" aria-controls="themePanel" title="Change how DevSnip Pro looks">
    <span class="codicon codicon-symbol-color theme-icon" aria-hidden="true"></span>
    <span class="theme-label">Theme</span>
    <span class="theme-name" id="themeName"></span>
    <span class="theme-dots" id="themeDots" aria-hidden="true"></span>
    <span class="codicon codicon-chevron-down theme-chev" aria-hidden="true"></span>
  </button>
  <div class="theme-panel" id="themePanel" role="listbox" aria-label="DevSnip Pro theme" hidden></div>
</div>

<div id="onboarding"></div>

<section class="rank" id="rank" aria-label="Your rank">
  <button type="button" class="rank-open" id="status" aria-label="Your rank. Open Milestones &amp; rewards" title="Open Milestones &amp; rewards: see milestones, rewards and how to earn points">
    <span class="medal" id="statusBadge" aria-hidden="true"></span>
    <span class="rank-body">
      <span class="rank-line">
        <span class="rank-name" id="statusLevel"></span>
        <span class="rank-points"><span class="gain" id="statusGain" aria-hidden="true"></span><span id="statusPoints"></span></span>
      </span>
      <span class="meter" id="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to the next rank"><span class="meter-fill" id="statusFill"></span></span>
      <span class="rank-line rank-sub">
        <span id="statusNext"></span>
        <span class="rank-pct" id="statusPct"></span>
      </span>
    </span>
  </button>
  <div class="rank-foot">
    <button type="button" class="rank-info" id="rankInfo" aria-controls="rankTip" aria-expanded="false"><span class="codicon codicon-info" aria-hidden="true"></span><span class="rank-foot-label">How ranks work</span></button>
    <!-- A labelled copy of the card's own action for the mouse; keyboard and screen readers use the card. -->
    <button type="button" class="rank-cta" id="rankCta" tabindex="-1" aria-hidden="true"><span>Milestones<span class="rank-foot-label"> &amp; rewards</span></span><span class="codicon codicon-arrow-right" aria-hidden="true"></span></button>
  </div>
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

  private get version(): string {
    return String(this.context.extension?.packageJSON?.version ?? "0.0.0");
  }

  private onboarding(): SidebarOnboarding {
    return { guide: guideVisible() ? guideSteps() : null, whatsNew: whatsNew(this.version) };
  }

  /** Handles the onboarding cards' messages. Commands are checked against this extension's own. */
  private async onOnboardingMessage(message: { type?: unknown; command?: unknown; step?: unknown }): Promise<boolean> {
    switch (message?.type) {
      case "guideStep":
        if (!isKnownCommand(message.command)) return true;
        track("onboarding_action", { action: "step_opened", step: typeof message.step === "string" && /^[a-z_]{1,40}$/.test(message.step) ? message.step : undefined });
        await executeQueuedCommand(message.command);
        return true;
      case "dismissGuide":
        await dismissGuide();
        return true;
      case "openWalkthrough":
        await executeQueuedCommand("sayaib.hue-console.getStarted");
        return true;
      case "whatsNewOpen":
        await dismissWhatsNew(this.version, true);
        await executeQueuedCommand(isKnownCommand(message.command) ? message.command : "sayaib.hue-console.whatsNew");
        return true;
      case "dismissWhatsNew":
        await dismissWhatsNew(this.version, false);
        return true;
      default:
        return false;
    }
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
    setWebviewHtml(view.webview, renderToolsSidebar({
      cspSource: view.webview.cspSource,
      scriptUri: view.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "tools-sidebar.js")).toString(),
      codiconsUri: view.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
      status: sidebarStatus(this.context),
      expanded: this.context.globalState.get<string[]>(EXPANDED_KEY, []),
      favorites: this.favorites,
      theme: { current: currentThemeId(), choices: themeChoices() },
      onboarding: this.onboarding(),
      usage: this.usage
    }), "sidebar");

    const groupNames = new Set(SIDEBAR_GROUPS.map(group => group.name));
    const themeIds = new Set(themeChoices().map(choice => choice.id));
    const activationSubscription = onDidChangeActivation(() => this.post({ type: "onboarding", onboarding: this.onboarding() }));
    const subscription = view.webview.onDidReceiveMessage(async message => {
      if (message?.type === "setTheme" && typeof message.id === "string" && themeIds.has(message.id)) {
        await setTheme(message.id);
        return;
      }
      if (await this.onOnboardingMessage(message)) return;
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
      activationSubscription.dispose();
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
.icon-btn:focus-visible, .link:focus-visible, .btn:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.rank-open:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
.link { padding: 0; border: 0; background: none; cursor: pointer; color: var(--accent-fg); font-size: 12px; }
.link:hover { text-decoration: underline; }
.btn {
  height: 26px; padding: 0 var(--s3); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px;
  border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-secondaryBackground, var(--surface-2));
  color: var(--vscode-button-secondaryForeground, var(--fg));
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--hover)); }

/* ------------------------------------------------------------- appearance */
.appearance { position: relative; margin: var(--s2) var(--s2) 0; }
.theme-btn {
  display: flex; align-items: center; gap: 7px; width: 100%;
  height: 30px; padding: 0 var(--s2);
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); color: var(--fg); cursor: pointer; text-align: left;
  transition: background-color .12s ease, border-color .12s ease;
}
.theme-btn:hover { background: var(--surface-2); border-color: var(--border-strong); }
.theme-btn:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.theme-btn[aria-expanded="true"] { border-color: var(--accent); }
.theme-icon { color: var(--accent-fg); font-size: 14px !important; }
.theme-label { flex: none; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.theme-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
.theme-dots { flex: none; display: inline-flex; padding-left: 3px; }
.theme-dots i { width: 10px; height: 10px; margin-left: -3px; border-radius: 50%; box-shadow: 0 0 0 1.5px var(--surface); }
.theme-dots i.system { background: linear-gradient(135deg, #1f1f1f 50%, #f3f3f3 50%); }
.theme-chev { flex: none; color: var(--muted); font-size: 14px !important; transition: transform .15s ease; }
.theme-btn[aria-expanded="true"] .theme-chev { transform: rotate(180deg); }
/* Narrow sidebars: the theme name matters more than the label. */
@media (max-width: 240px) { .theme-label { display: none; } }
@media (max-width: 170px) { .theme-dots { display: none; } }
.theme-panel {
  position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 45;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(98px, 1fr)); gap: 4px;
  max-height: min(70vh, 460px); overflow-y: auto; padding: 6px;
  background: var(--vscode-menu-background, var(--surface-2));
  color: var(--vscode-menu-foreground, var(--fg));
  border: 1px solid var(--vscode-menu-border, var(--border-strong));
  border-radius: var(--radius);
  box-shadow: 0 10px 28px var(--shadow);
  animation: pop .12s var(--ease);
}
.theme-head { grid-column: 1 / -1; display: flex; align-items: baseline; justify-content: space-between; gap: var(--s2); padding: 2px 4px 4px; }
.theme-head b { font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.theme-head .link { font-size: 11px; }
.theme-opt {
  display: flex; flex-direction: column; gap: 5px; min-width: 0;
  padding: 5px; border: 1px solid transparent; border-radius: var(--radius);
  background: transparent; color: inherit; cursor: pointer; text-align: left;
}
.theme-opt:hover { background: var(--hover); }
.theme-opt:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.theme-opt[aria-selected="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.tp { position: relative; display: flex; height: 42px; border-radius: 4px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(127, 127, 127, .28); }
.tp-side { width: 24%; display: flex; flex-direction: column; gap: 3px; padding: 6px 3px; }
.tp-side i { height: 3px; border-radius: 2px; opacity: .55; }
.tp-main { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 6px; }
.tp-line { height: 4px; border-radius: 2px; }
.tp-row { display: flex; gap: 4px; margin-top: auto; }
.tp-btn { width: 42%; height: 8px; border-radius: 2px; }
.tp-chip { width: 16%; height: 8px; border-radius: 2px; }
.tp.system { background: linear-gradient(135deg, #1f1f1f 50%, #f3f3f3 50%); align-items: center; justify-content: center; }
.tp.system .codicon { font-size: 18px !important; color: #8a8a8a; }
.theme-opt .opt-name { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 11.5px; line-height: 1.2; }
.theme-opt .opt-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.theme-opt .opt-name .codicon { flex: none; font-size: 13px !important; color: var(--accent-fg); visibility: hidden; }
.theme-opt[aria-selected="true"] .opt-name .codicon { visibility: visible; }
.theme-opt[aria-selected="true"] .opt-name span { font-weight: 600; }

/* ------------------------------------------------------------- onboarding cards */
.ob { margin: var(--s2) var(--s2) 0; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.ob.news { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 7%, var(--surface)); }
.ob-head { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 4px 0 var(--s2); }
.ob-head .ob-icon { color: var(--accent-fg); font-size: 14px !important; }
.ob-title { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ob-count { flex: none; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.ob-count-short { display: none; }
.ob-head .icon-btn { width: 22px; height: 22px; }
.ob-head .icon-btn .codicon { font-size: 14px !important; }
.ob-toggle .codicon { transition: transform .15s ease; }
.ob.collapsed .ob-toggle .codicon { transform: rotate(-90deg); }
.ob-progress { height: 3px; margin: 0 var(--s2) 4px; border-radius: 2px; background: color-mix(in srgb, var(--fg) 10%, transparent); overflow: hidden; }
.ob-progress span { display: block; height: 100%; background: var(--accent); border-radius: 2px; transition: width .4s var(--ease); }
.ob.collapsed .ob-body { display: none; }
.ob-body { padding: 0 4px 6px; }
.ob-step {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 26px; padding: 3px 6px;
  border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--fg); cursor: pointer; text-align: left; font-size: 12px;
}
.ob-step:hover, .ob-step:focus-visible { outline: none; background: var(--hover); }
.ob-step .ob-check { flex: none; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--muted); display: grid; place-items: center; }
.ob-step.done { color: var(--muted); }
.ob-step.done .ob-check { border-color: var(--vscode-testing-iconPassed, #73c991); background: var(--vscode-testing-iconPassed, #73c991); }
.ob-step.done .ob-check::after { content: ""; width: 6px; height: 3px; margin-top: -2px; border: solid var(--bg); border-width: 0 0 1.5px 1.5px; transform: rotate(-45deg); }
.ob-step .ob-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ob-step .ob-go { flex: none; font-size: 13px !important; color: var(--muted); opacity: 0; transition: opacity .12s ease, transform .12s ease; }
.ob-step:hover .ob-go, .ob-step:focus-visible .ob-go { opacity: 1; transform: translateX(1px); }
.ob-step.done .ob-go { display: none; }
.ob-foot { padding: 2px 10px 4px; }
.ob-foot .link { font-size: 11.5px; }
.ob-item .ob-dot { flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--accent-fg); }

/* ------------------------------------------------------------- rank card */
.rank {
  position: relative;
  margin: var(--s2) var(--s2) 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.rank { transition: border-color .12s ease, background-color .12s ease; }
.rank-open {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: var(--s2);
  border: 0; border-radius: var(--radius) var(--radius) 0 0; background: transparent; cursor: pointer; text-align: left;
  transition: background-color .12s ease;
}
/* The card and its "Milestones & rewards" action light up together, so it reads as one clickable target. */
.rank:has(.rank-open:hover), .rank:has(.rank-cta:hover) { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.rank-open:hover, .rank:has(.rank-cta:hover) .rank-open { background: var(--surface-2); }
.rank-open:active, .rank:has(.rank-cta:active) .rank-open { background: color-mix(in srgb, var(--fg) 12%, var(--bg)); }
.rank-foot {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s1);
  padding: 2px var(--s1); border-top: 1px solid var(--border);
}
.rank-info, .rank-cta {
  display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 6px;
  border: 0; border-radius: var(--radius-sm); background: transparent; cursor: pointer;
  font-size: 11.5px; color: var(--muted); white-space: nowrap;
  transition: background-color .12s ease, color .12s ease;
}
.rank-info .codicon, .rank-cta .codicon { font-size: 13px !important; }
.rank-info:hover, .rank-info[aria-expanded="true"] { color: var(--fg); background: var(--surface-2); }
.rank-cta { color: var(--accent-fg); font-weight: 600; }
.rank-cta .codicon { transition: transform .15s var(--ease); }
.rank:has(.rank-open:hover) .rank-cta, .rank-cta:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.rank:has(.rank-open:hover) .rank-cta .codicon, .rank-cta:hover .codicon { transform: translateX(2px); }
.rank-info:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
/* Points just earned float up beside the total. */
.gain { display: inline-block; margin-right: 5px; padding: 0 4px; border-radius: 6px; font-size: 10.5px; color: var(--bg); background: var(--gold); opacity: 0; transform: translateY(3px); }
.gain.show { animation: gain 1.6s var(--ease) forwards; }
@keyframes gain { 15% { opacity: 1; transform: none; } 75% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translateY(-3px); } }
.rank-sub .close-call { color: var(--gold); font-weight: 600; }
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
  .rank-pct, .kbd, .rank-foot-label, .ob-count-full { display: none; }
  .ob-count-short { display: inline; }
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
