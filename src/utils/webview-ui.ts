import * as vscode from "vscode";

/** Cryptographically-random nonce for webview CSP script tags. */
export function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** Escapes text that is interpolated into webview HTML. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Serialises a value for embedding inside an inline <script> block.
 * Plain JSON.stringify is unsafe there: a `</script>` sequence inside any
 * string would terminate the script element and inject markup into the page.
 */
export function embedJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Posts a message to a webview that may already have been disposed.
 * VS Code throws on a disposed webview, which would otherwise surface as an
 * unhandled rejection whenever a long-running task finishes after the user
 * closed the panel.
 */
export function safePostMessage(panel: vscode.WebviewPanel, message: unknown): void {
  try {
    void panel.webview.postMessage(message);
  } catch {
    /* panel disposed while work was in flight */
  }
}

/** Shared styling for the tool-hub webviews (AI/ML, Big Data, RAG). */
export const TOOL_CSS = `
:root {
    --bg-0: var(--vscode-editor-background);
    --bg-1: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --bg-2: var(--vscode-input-background, rgba(127,127,127,0.12));
    --bg-3: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.16));
    --fg-0: var(--vscode-editor-foreground, var(--vscode-foreground));
    --fg-1: var(--vscode-descriptionForeground, rgba(127,127,127,0.9));
    --fg-2: var(--vscode-disabledForeground, rgba(127,127,127,0.7));
    --border: var(--vscode-panel-border, var(--vscode-input-border, rgba(127,127,127,0.35)));
    --border-focus: var(--vscode-focusBorder);
    --accent: var(--vscode-button-background, #0e639c);
    --accent-fg: var(--vscode-button-foreground, #ffffff);
    --success: #4caf50;
    --success-bg: rgba(76, 175, 80, 0.15);
    --error: #f44336;
    --error-bg: rgba(244, 67, 54, 0.15);
    --warning: #ff9800;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --shadow: 0 2px 8px rgba(0,0,0,0.3);
    --transition: 0.2s ease;
    --mono: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--sans);
    background: var(--bg-0);
    color: var(--fg-0);
    line-height: 1.5;
    padding: 0;
    overflow-x: hidden;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--fg-2); border-radius: 3px; }

.tool-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 24px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
}
.tool-header h1 { font-size: 16px; font-weight: 700; white-space: nowrap; }
.tool-header .subtitle { font-size: 12px; color: var(--fg-1); }

.tool-body { padding: 20px 24px; max-width: 1100px; margin: 0 auto; }

.section {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 20px;
    margin-bottom: 16px;
}
.section-title {
    font-size: 13px; font-weight: 700;
    color: var(--fg-1);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 14px;
}

label {
    display: block;
    font-size: 12px; font-weight: 600;
    color: var(--fg-1);
    margin-bottom: 4px;
}
.input, input[type="text"], input[type="number"], select {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    transition: border-color var(--transition);
}
.input:focus, input:focus, textarea:focus, select:focus {
    border-color: var(--border-focus);
}
textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    resize: vertical;
    outline: none;
    transition: border-color var(--transition);
}
select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23999'%3E%3Cpath d='M6 8L1 3h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 30px;
}

.btn {
    padding: 8px 16px;
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
}
.btn:hover { opacity: 0.85; }
.btn-secondary {
    background: var(--bg-3);
    color: var(--fg-0);
}
.btn-ghost {
    background: transparent;
    color: var(--fg-1);
    border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-2); color: var(--fg-0); }
.btn-danger {
    background: var(--error);
    color: #fff;
}
.btn-row {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
}

.result-block {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 400px;
    overflow-y: auto;
    color: var(--fg-0);
}

.panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}
.panel-label {
    font-size: 12px; font-weight: 600;
    color: var(--fg-1);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
}
@media (max-width: 768px) {
    .panels { grid-template-columns: 1fr; }
    .tool-body { padding: 16px; }
    .btn-row { flex-direction: column; align-items: stretch; }
}

.toast-container {
    position: fixed; top: 12px; right: 12px; z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
}
.toast {
    padding: 10px 16px;
    border-radius: var(--radius-md);
    font-size: 13px; font-weight: 500;
    color: #fff;
    box-shadow: var(--shadow);
    transform: translateX(120%);
    transition: transform 0.3s ease;
    max-width: 320px;
}
.toast.show { transform: translateX(0); }
.toast.success { background: #2e7d32; }
.toast.error { background: #c62828; }
.toast.info { background: #1565c0; }
`;

/** Shared styling for the developer-utility webviews. */
export const UTILITY_CSS = `
:root {
    --bg-0: var(--vscode-editor-background);
    --bg-1: var(--vscode-sideBar-background, var(--vscode-editor-background));
    --bg-2: var(--vscode-input-background, rgba(127,127,127,0.12));
    --bg-3: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.16));
    --fg-0: var(--vscode-editor-foreground, var(--vscode-foreground));
    --fg-1: var(--vscode-descriptionForeground, rgba(127,127,127,0.9));
    --fg-2: var(--vscode-disabledForeground, rgba(127,127,127,0.7));
    --border: var(--vscode-panel-border, var(--vscode-input-border, rgba(127,127,127,0.35)));
    --border-focus: var(--vscode-focusBorder);
    --accent: var(--vscode-button-background, #0e639c);
    --accent-fg: var(--vscode-button-foreground, #ffffff);
    --success: #4caf50;
    --success-bg: rgba(76, 175, 80, 0.15);
    --error: #f44336;
    --error-bg: rgba(244, 67, 54, 0.15);
    --warning: #ff9800;
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --shadow: 0 2px 8px rgba(0,0,0,0.3);
    --transition: 0.2s ease;
    --mono: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--sans);
    background: var(--bg-0);
    color: var(--fg-0);
    line-height: 1.5;
    padding: 0;
    overflow-x: hidden;
}
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--fg-2); border-radius: 3px; }

.tool-header {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 24px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 50;
}
.tool-header h1 { font-size: 16px; font-weight: 700; white-space: nowrap; }
.tool-header .subtitle { font-size: 12px; color: var(--fg-1); }

.tool-body { padding: 20px 24px; max-width: 1100px; margin: 0 auto; }

.section {
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 20px;
    margin-bottom: 16px;
}
.section-title {
    font-size: 13px; font-weight: 700;
    color: var(--fg-1);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 14px;
}

label {
    display: block;
    font-size: 12px; font-weight: 600;
    color: var(--fg-1);
    margin-bottom: 4px;
}
.input, input[type="text"], input[type="number"] {
    width: 100%;
    padding: 8px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--mono);
    font-size: 13px;
    outline: none;
    transition: border-color var(--transition);
}
.input:focus, input:focus, textarea:focus, select:focus {
    border-color: var(--border-focus);
}
textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--mono);
    font-size: 13px;
    resize: vertical;
    outline: none;
    transition: border-color var(--transition);
}
select {
    padding: 8px 12px;
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 13px;
    outline: none;
}

.btn-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px;
    background: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 12px; font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    white-space: nowrap;
}
.btn:hover { opacity: 0.85; }
.btn:active { transform: scale(0.97); }
.btn-secondary {
    background: var(--bg-2);
    color: var(--fg-0);
    border: 1px solid var(--border);
}
.btn-ghost {
    background: transparent;
    color: var(--fg-1);
    border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-2); }
.btn-success { background: var(--success); color: #fff; }
.btn-danger { background: var(--error); color: #fff; }
.btn-sm { padding: 4px 10px; font-size: 11px; }

.panels { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 768px) { .panels { grid-template-columns: 1fr; } }

.panel-label {
    font-size: 11px; font-weight: 700;
    color: var(--fg-1);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
}

.result-block {
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-family: var(--mono);
    font-size: 13px;
    word-break: break-all;
    line-height: 1.6;
}

.toast-container {
    position: fixed; bottom: 16px; right: 16px;
    z-index: 9999;
    display: flex; flex-direction: column; gap: 8px;
    pointer-events: none;
}
.toast {
    padding: 10px 16px;
    border-radius: var(--radius-md);
    font-size: 12px; font-weight: 600;
    color: #fff;
    transform: translateY(20px);
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: auto;
    box-shadow: var(--shadow);
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.success { background: var(--success); }
.toast.error { background: var(--error); }
`;

/** Toast helper injected into webview scripts (`_toast(message, type)`). */
export function toastScript(): string {
  return `
        function _toast(msg, type) {
            var c = document.querySelector('.toast-container');
            if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
            var t = document.createElement('div');
            t.className = 'toast ' + (type || 'success');
            t.textContent = msg;
            c.appendChild(t);
            requestAnimationFrame(function() { requestAnimationFrame(function() { t.classList.add('show'); }); });
            setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.remove(); }, 2600); }, 2600);
        }
    `;
}

/**
 * Theme tokens mapped onto VS Code's own colour variables, so every panel
 * follows the user's light/dark/high-contrast theme instead of a fixed palette.
 * Fallbacks keep the page readable if a theme omits a colour.
 */
export const THEME_TOKENS = `
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --panel: var(--vscode-sideBar-background, var(--vscode-editor-background, #252526));
    --panel-2: var(--vscode-input-background, rgba(127,127,127,0.12));
    --line: var(--vscode-panel-border, var(--vscode-input-border, rgba(127,127,127,0.35)));
    --text: var(--vscode-editor-foreground, var(--vscode-foreground, #cccccc));
    --muted: var(--vscode-descriptionForeground, rgba(127,127,127,0.9));
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --accent-strong: var(--vscode-button-background, #0e639c);
    --accent-fg: var(--vscode-button-foreground, #ffffff);
    --danger: var(--vscode-errorForeground, #f14c4c);
    --warning: var(--vscode-editorWarning-foreground, #cca700);
    --success: var(--vscode-testing-iconPassed, #3fb950);
    --focus: var(--vscode-focusBorder, #007fd4);
    --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    --mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }
  body { color-scheme: light dark; }
`;

const openPanels = new Map<string, vscode.WebviewPanel>();

/**
 * Opens a tool panel, reusing the panel already open for that tool.
 *
 * Without this, running a command twice stacked identical panels, each with
 * its own retained webview and message listener. `created` is false when an
 * existing panel was revealed, so callers can skip re-rendering.
 */
export function openToolPanel(
  viewType: string,
  title: string,
  options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
  column: vscode.ViewColumn = vscode.ViewColumn.One
): { panel: vscode.WebviewPanel; created: boolean } {
  const existing = openPanels.get(viewType);
  if (existing) {
    existing.reveal(column);
    return { panel: existing, created: false };
  }
  const panel = vscode.window.createWebviewPanel(viewType, title, column, options);
  openPanels.set(viewType, panel);
  panel.onDidDispose(() => {
    if (openPanels.get(viewType) === panel) openPanels.delete(viewType);
  });
  return { panel, created: true };
}

/** Closes every tool panel this module opened (used on extension deactivate). */
export function disposeAllToolPanels(): void {
  for (const panel of [...openPanels.values()]) {
    panel.dispose();
  }
  openPanels.clear();
}

/**
 * Asks the user to confirm a destructive action with a native modal.
 *
 * Webviews are sandboxed without modals, so `confirm()` inside a panel silently
 * does nothing - confirmation has to happen here. The dialog call is guarded
 * because some hosts (VS Code's own test runner, for one) reject modal requests
 * outright; a rejection is treated as "not confirmed" so a failed prompt can
 * never be mistaken for approval, and never escapes as an unhandled error.
 */
export async function confirmAction(
  message: string,
  confirmLabel: string,
  kind: "warning" | "information" = "warning"
): Promise<boolean> {
  try {
    const show = kind === "warning" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const choice = await show(message, { modal: true }, confirmLabel);
    return choice === confirmLabel;
  } catch (error) {
    console.warn("DevSnip Pro: confirmation dialog unavailable.", error);
    return false;
  }
}
