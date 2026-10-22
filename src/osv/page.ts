import { escapeHtml, getNonce, THEME_TOKENS } from "../utils/webview-ui";

/**
 * The HTML shell of the OSV Vulnerability Scanner. media/osv-scanner.js builds
 * everything inside #app from host messages, using DOM nodes and textContent
 * only (advisory text is untrusted, so nothing is assigned to innerHTML).
 */
export function renderOsvPage(o: { cspSource: string; scriptUri: string; codiconsUri: string }): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${o.cspSource}; style-src ${o.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OSV Vulnerability Scanner</title>
<link rel="stylesheet" href="${escapeHtml(o.codiconsUri)}">
<style nonce="${nonce}">${THEME_TOKENS}${OSV_CSS}</style>
</head>
<body>
<div id="app" class="app" aria-busy="true">
  <div class="boot"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span> Loading…</div>
</div>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
<script nonce="${nonce}" src="${escapeHtml(o.scriptUri)}"></script>
</body>
</html>`;
}

export const OSV_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
:root {
  --surface: color-mix(in srgb, var(--text) 3%, var(--bg));
  --surface-2: color-mix(in srgb, var(--text) 6%, var(--bg));
  --hairline: color-mix(in srgb, var(--text) 12%, transparent);
  --on-status: var(--ds-on-status, var(--bg));
  --sev-critical: var(--danger);
  --sev-high: var(--danger);
  --sev-medium: var(--warning);
  --sev-low: var(--vscode-editorInfo-foreground, var(--accent));
  --sev-unknown: var(--muted);
  --radius: 8px;
}
button, input, select { font: inherit; color: inherit; }
.codicon { font-size: 16px; line-height: 1; vertical-align: -3px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
a, .linkish { color: var(--accent); cursor: pointer; text-decoration: none; }
a:hover, .linkish:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.boot { padding: 40px; color: var(--muted); }
.app { max-width: 1180px; margin: 0 auto; padding: 18px 22px 64px; }

/* header */
.top { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; }
.title h1 { margin: 0; font-size: 19px; display: flex; gap: 8px; align-items: center; letter-spacing: -.01em; }
.title h1 .codicon { font-size: 20px; color: var(--accent); }
.title .meta { color: var(--muted); font-size: 12px; margin-top: 3px; }
.toolbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid transparent; border-radius: 6px; padding: 6px 12px; cursor: pointer;
  background: var(--vscode-button-secondaryBackground, var(--surface-2)); color: var(--vscode-button-secondaryForeground, var(--text)); font-weight: 600; font-size: 12.5px; white-space: nowrap; }
.btn:hover:not(:disabled) { filter: brightness(1.12); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.primary { background: var(--accent-strong); color: var(--accent-fg); }
.btn.ghost { background: transparent; border-color: var(--hairline); }
.btn.small { padding: 3px 8px; font-size: 12px; font-weight: 500; }
.btn .codicon { font-size: 14px; }
.menu-wrap { position: relative; }
.menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; min-width: 200px; background: var(--vscode-menu-background, var(--panel));
  color: var(--vscode-menu-foreground, var(--text)); border: 1px solid var(--line); border-radius: 6px; padding: 4px; box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0,0,0,.3)); }
.menu[hidden] { display: none; }
.menu button { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; background: none; border: 0; padding: 7px 10px; border-radius: 4px; cursor: pointer; }
.menu button:hover, .menu button:focus-visible { background: var(--vscode-list-hoverBackground, var(--surface-2)); outline: none; }
.privacy { display: flex; gap: 8px; align-items: flex-start; color: var(--muted); font-size: 12px; margin: 12px 0 0; }

/* progress and banners */
.progress { margin-top: 16px; border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; background: var(--surface); }
.progress .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
.progress .label { display: flex; gap: 8px; align-items: center; }
.bar { height: 4px; border-radius: 2px; background: var(--surface-2); overflow: hidden; margin-top: 10px; }
.bar > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .25s ease; }
.banner { margin-top: 14px; border: 1px solid var(--line); border-left: 4px solid var(--muted); border-radius: var(--radius); padding: 10px 12px; display: flex; gap: 10px; align-items: flex-start; }
.banner.error { border-left-color: var(--danger); }
.banner.warn { border-left-color: var(--warning); }
.banner.ok { border-left-color: var(--success); }
.banner .codicon { margin-top: 1px; }
.banner.error .codicon { color: var(--danger); } .banner.warn .codicon { color: var(--warning); } .banner.ok .codicon { color: var(--success); }
.banner .body { flex: 1; } .banner .body b { display: block; margin-bottom: 2px; }
.banner .actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }

/* empty states */
.empty { text-align: center; padding: 48px 20px; border: 1px dashed var(--line); border-radius: var(--radius); margin-top: 18px; }
.empty .codicon.big { font-size: 40px; color: var(--muted); }
.empty h2 { margin: 12px 0 6px; font-size: 16px; }
.empty p { color: var(--muted); max-width: 62ch; margin: 0 auto 14px; }
.empty .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.eco-list { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 14px auto 0; max-width: 720px; }
.eco-list span { border: 1px solid var(--hairline); border-radius: 999px; padding: 2px 9px; font-size: 11.5px; color: var(--muted); }

/* summary */
.cards { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.card { text-align: left; border: 1px solid var(--line); border-top: 3px solid var(--sev-unknown); border-radius: var(--radius); padding: 10px 12px; background: var(--surface); cursor: pointer; }
.card:hover { background: var(--surface-2); }
.card[aria-pressed="true"] { outline: 2px solid var(--focus); outline-offset: -1px; }
.card b { display: block; font-size: 24px; line-height: 1.2; font-variant-numeric: tabular-nums; }
.card span { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; }
.card.critical { border-top-color: var(--sev-critical); } .card.critical b { color: var(--sev-critical); }
.card.high { border-top-color: var(--sev-high); } .card.medium { border-top-color: var(--sev-medium); } .card.low { border-top-color: var(--sev-low); }
.card.zero b { color: var(--muted); }
.stats { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 12px; color: var(--muted); font-size: 12px; }
.stats b { color: var(--text); font-variant-numeric: tabular-nums; }
.stats .clickable { cursor: pointer; } .stats .clickable:hover b { text-decoration: underline; }

/* tabs */
.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); margin-top: 20px; overflow-x: auto; }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; cursor: pointer; color: var(--muted); font-weight: 600; white-space: nowrap; }
.tab:hover { color: var(--text); }
.tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.tab .count { margin-left: 5px; font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--surface-2); color: var(--muted); }
.panel[hidden] { display: none; }

/* filters */
.filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 14px 0 10px; }
.search { position: relative; flex: 1 1 240px; max-width: 360px; }
.search .codicon { position: absolute; left: 8px; top: 7px; color: var(--muted); font-size: 14px; }
.search input { width: 100%; padding: 5px 8px 5px 28px; border-radius: 6px; border: 1px solid var(--vscode-input-border, var(--hairline));
  background: var(--vscode-input-background, var(--surface-2)); color: var(--vscode-input-foreground, var(--text)); }
.search input:focus { outline: none; border-color: var(--focus); }
select.control { padding: 4px 6px; border-radius: 6px; border: 1px solid var(--vscode-dropdown-border, var(--hairline)); background: var(--vscode-dropdown-background, var(--surface-2)); color: var(--vscode-dropdown-foreground, var(--text)); }
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
.chip { border: 1px solid var(--hairline); background: transparent; border-radius: 999px; padding: 3px 10px; cursor: pointer; font-size: 12px; color: var(--muted); }
.chip[aria-pressed="true"] { background: var(--accent-strong); border-color: var(--accent-strong); color: var(--accent-fg); }
.filters .spacer { flex: 1; }
.result-count { color: var(--muted); font-size: 12px; }

/* findings */
.group { margin-top: 14px; }
.group > h3 { display: flex; gap: 8px; align-items: center; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 6px; color: var(--muted); }
.finding { border: 1px solid var(--line); border-left: 4px solid var(--sev-unknown); border-radius: var(--radius); margin-bottom: 6px; background: var(--surface); }
.finding.critical { border-left-color: var(--sev-critical); } .finding.high { border-left-color: var(--sev-high); }
.finding.medium { border-left-color: var(--sev-medium); } .finding.low { border-left-color: var(--sev-low); }
.finding > summary { list-style: none; cursor: pointer; padding: 9px 12px; display: grid; grid-template-columns: auto 1fr auto; gap: 4px 10px; align-items: center; }
.finding > summary::-webkit-details-marker { display: none; }
.finding > summary:hover { background: var(--surface-2); }
.finding > summary:focus-visible { outline-offset: -2px; }
.finding .line1 { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
.finding .pkg { font-weight: 700; }
.finding .ver, .mono { font-family: var(--mono); font-size: 12px; }
.finding .id { color: var(--muted); font-family: var(--mono); font-size: 12px; }
.finding .sum { grid-column: 2 / 4; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.finding .right { display: flex; gap: 6px; align-items: center; justify-content: flex-end; }
.finding[open] > summary .chev { transform: rotate(90deg); }
.chev { transition: transform .15s ease; color: var(--muted); }
.pill { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; white-space: nowrap; border: 1px solid transparent; }
.pill.critical { background: var(--sev-critical); color: var(--on-status); }
.pill.high { color: var(--sev-high); border-color: var(--sev-high); background: color-mix(in srgb, var(--sev-high) 12%, transparent); }
.pill.medium { color: var(--sev-medium); border-color: var(--sev-medium); background: color-mix(in srgb, var(--sev-medium) 12%, transparent); }
.pill.low { color: var(--sev-low); border-color: var(--sev-low); background: color-mix(in srgb, var(--sev-low) 12%, transparent); }
.pill.unknown { color: var(--muted); border-color: var(--hairline); }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--hairline); color: var(--muted); white-space: nowrap; }
.badge.potential { border-style: dashed; color: var(--warning); border-color: var(--warning); }
.badge.fix { color: var(--success); border-color: color-mix(in srgb, var(--success) 60%, transparent); }
.badge.nofix { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 60%, transparent); }
.badge.dev { color: var(--muted); }
.fbody { border-top: 1px solid var(--line); padding: 12px 14px 14px; }
.fbody .lead { font-weight: 600; margin: 0 0 8px; }
.kv { display: grid; grid-template-columns: 140px 1fr; gap: 5px 12px; font-size: 12.5px; margin: 10px 0; }
.kv dt { color: var(--muted); } .kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.desc { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin: 8px 0; max-height: 220px; overflow: auto; font-size: 12.5px; }
.desc.full { max-height: none; }
.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 700; margin: 14px 0 6px; }
.loc { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; margin: 3px 0; }
.loc-wrap { margin: 3px 0 6px; }
.loc-wrap .via { margin: 1px 0 0 24px; overflow-wrap: anywhere; }
.cmd { display: flex; gap: 6px; align-items: center; margin: 5px 0; flex-wrap: wrap; }
.cmd code { flex: 1 1 280px; font-family: var(--mono); font-size: 12px; background: var(--vscode-textCodeBlock-background, var(--surface-2)); border: 1px solid var(--line); border-radius: 5px; padding: 5px 8px; overflow-wrap: anywhere; }
.cmd .cwd { color: var(--muted); }
.guidance { margin: 6px 0 0; padding-left: 18px; color: var(--text); font-size: 12.5px; }
.guidance li { margin: 3px 0; }
.refs { margin: 0; padding-left: 18px; font-size: 12.5px; }
.refs li { margin: 2px 0; overflow-wrap: anywhere; }
.refs .type { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; margin-right: 6px; }
.factions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.note { color: var(--muted); font-size: 12px; }
.more { display: flex; justify-content: center; margin: 12px 0; }

/* tables */
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--radius); }
table.grid { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.grid th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); background: var(--surface); position: sticky; top: 0; }
table.grid th, table.grid td { padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
table.grid tr:last-child td { border-bottom: 0; }
table.grid th button { background: none; border: 0; padding: 0; cursor: pointer; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; }
.status { display: inline-flex; gap: 5px; align-items: center; font-weight: 600; white-space: nowrap; }
.status.vulnerable { color: var(--danger); } .status.potential { color: var(--warning); } .status.clean { color: var(--success); } .status.unanalyzed { color: var(--muted); }

/* fixes */
.fix-card { border: 1px solid var(--line); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 8px; background: var(--surface); }
.fix-card .head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.fix-card .arrow { color: var(--muted); }
.verified { color: var(--success); font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
.unverified { color: var(--warning); font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }

/* notes */
ul.notes { padding-left: 18px; } ul.notes li { margin: 5px 0; }

/* toasts */
.toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 6px; z-index: 50; }
.toast { background: var(--vscode-notifications-background, var(--panel)); color: var(--vscode-notifications-foreground, var(--text));
  border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; font-size: 12.5px; box-shadow: 0 6px 18px var(--vscode-widget-shadow, rgba(0,0,0,.3)); max-width: 380px; }
.toast.error { border-left: 3px solid var(--danger); } .toast.ok { border-left: 3px solid var(--success); }

@media (max-width: 760px) {
  .app { padding: 14px; }
  .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .kv { grid-template-columns: 1fr; } .kv dt { margin-top: 4px; }
  .finding > summary { grid-template-columns: auto 1fr; } .finding .right { grid-column: 1 / 3; justify-content: flex-start; } .finding .sum { grid-column: 1 / 3; }
}
@media (prefers-reduced-motion: reduce) { .bar > i, .chev { transition: none; } }
`;
