import { OSV_CSS } from "../osv/page";
import { escapeHtml, getNonce, THEME_TOKENS } from "../utils/webview-ui";

/**
 * The HTML shell of the SCA Scanner. media/sca-model.js (pure filtering,
 * sorting and grouping) and media/sca-scanner.js build the page from host
 * messages with DOM nodes and textContent only. It shares the OSV Scanner's
 * styles and adds its own.
 */
export function renderScaPage(o: { cspSource: string; modelUri: string; scriptUri: string; codiconsUri: string }): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${o.cspSource}; style-src ${o.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SCA Scanner</title>
<link rel="stylesheet" href="${escapeHtml(o.codiconsUri)}">
<style nonce="${nonce}">${THEME_TOKENS}${OSV_CSS}${SCA_CSS}</style>
</head>
<body>
<div id="app" class="app" aria-busy="true">
  <div class="boot"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span> Loading…</div>
</div>
<div id="toasts" class="toasts" role="status" aria-live="polite"></div>
<script nonce="${nonce}" src="${escapeHtml(o.modelUri)}"></script>
<script nonce="${nonce}" src="${escapeHtml(o.scriptUri)}"></script>
</body>
</html>`;
}

export const SCA_CSS = `
.cards.six { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.card.info { border-top-color: var(--vscode-editorInfo-foreground, var(--accent)); }
.card.kev { border-top-color: var(--danger); } .card.kev b { color: var(--danger); }
.totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
.total { border: 1px solid var(--line); border-radius: var(--radius); padding: 8px 12px; background: var(--surface); text-align: left; cursor: pointer; }
.total:hover { background: var(--surface-2); }
.total[aria-pressed="true"] { outline: 2px solid var(--focus); outline-offset: -1px; }
.total b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.total span { font-size: 11px; color: var(--muted); }
.projects { margin-top: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.projects > summary { cursor: pointer; padding: 9px 12px; display: flex; gap: 8px; align-items: center; list-style: none; font-weight: 600; }
.projects > summary::-webkit-details-marker { display: none; }
.projects[open] > summary .chev { transform: rotate(90deg); }
.project-list { border-top: 1px solid var(--line); padding: 8px 12px 10px; display: grid; gap: 4px; max-height: 260px; overflow: auto; }
.project-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12.5px; }
.project-row input { margin: 0; }
.project-row .dir { color: var(--muted); font-family: var(--mono); font-size: 11.5px; }
.project-actions { display: flex; gap: 6px; padding: 0 12px 10px; flex-wrap: wrap; }
.badge.kev { color: var(--on-status); background: var(--danger); border-color: var(--danger); font-weight: 700; }
.badge.confirmed { color: var(--text); }
.badge.risk { color: var(--warning); border-color: var(--warning); }
.badge.boot { color: var(--success); border-color: color-mix(in srgb, var(--success) 60%, transparent); }
.provider { display: grid; grid-template-columns: 22px 1fr; gap: 2px 8px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
.provider:last-child { border-bottom: 0; }
.provider .codicon.ok { color: var(--success); } .provider .codicon.partial, .provider .codicon.stale { color: var(--warning); }
.provider .codicon.unavailable { color: var(--danger); } .provider .codicon.off, .provider .codicon.skipped { color: var(--muted); }
.provider .msg { grid-column: 2; color: var(--muted); }
.option { border: 1px solid var(--line); border-radius: 6px; padding: 9px 11px; margin: 6px 0; background: var(--bg); }
.option .head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-weight: 600; }
.option p { margin: 5px 0 0; color: var(--muted); font-size: 12.5px; }
.option .edit { font-family: var(--mono); font-size: 12px; margin-top: 6px; overflow-wrap: anywhere; }
.risk { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--hairline); color: var(--muted); }
.risk.low { color: var(--success); border-color: var(--success); } .risk.medium { color: var(--warning); border-color: var(--warning); } .risk.high { color: var(--danger); border-color: var(--danger); }
.path { font-family: var(--mono); font-size: 12px; overflow-wrap: anywhere; margin: 2px 0; }
.path .sep { color: var(--muted); margin: 0 4px; }
.kev-box { border: 1px solid var(--danger); border-left-width: 4px; border-radius: 6px; padding: 8px 10px; margin: 8px 0; font-size: 12.5px; }
@media (max-width: 760px) {
  .cards.six { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .totals { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 420px) {
  .cards.six { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;
