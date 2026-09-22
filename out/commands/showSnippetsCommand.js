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
exports.registerShowSnippetsCommand = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const snippet_utils_1 = require("../utils/snippet-utils");
/** Reads every contributed snippet file; a broken file is reported, not fatal. */
async function loadSnippets(snippetsFolderPath) {
    const files = [];
    const errors = [];
    let entries;
    try {
        entries = fs.readdirSync(snippetsFolderPath).filter(file => file.endsWith(".json"));
    }
    catch (error) {
        return { files, errors: [`Could not read the snippets folder: ${error instanceof Error ? error.message : String(error)}`] };
    }
    for (const file of entries.sort()) {
        const language = file.replace(/^custom_/, "").replace(/\.json$/, "");
        try {
            files.push({ language, snippets: await (0, snippet_utils_1.readExistingSnippets)(path.join(snippetsFolderPath, file)) });
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return { files, errors };
}
function bodyToText(body) {
    return Array.isArray(body) ? body.join("\n") : String(body ?? "");
}
function registerShowSnippetsCommand(context, snippetsFolderPath) {
    let activePanel;
    const command = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.showSnippets", async () => {
        if (activePanel) {
            activePanel.reveal(vscode.ViewColumn.One);
            return;
        }
        const panel = vscode.window.createWebviewPanel("showSnippets", "DevSnip Pro - Custom Snippets", vscode.ViewColumn.One, { enableScripts: true });
        activePanel = panel;
        panel.iconPath = vscode.Uri.file(path.join(context.extensionPath, "logo.png"));
        let loaded = await loadSnippets(snippetsFolderPath);
        const render = (status) => {
            panel.webview.html = generateWebviewContent(loaded, status);
        };
        render();
        const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
            try {
                if (message?.command === "refresh") {
                    loaded = await loadSnippets(snippetsFolderPath);
                    render("Snippet list refreshed.");
                    return;
                }
                if (message?.command !== "deleteSnippet")
                    return;
                const { language, snippetKey } = message;
                const file = loaded.files.find(entry => entry.language === language);
                if (!language || !snippetKey || !file || !file.snippets[snippetKey]) {
                    loaded = await loadSnippets(snippetsFolderPath);
                    render("That snippet no longer exists. The list has been refreshed.");
                    return;
                }
                // The webview sandbox blocks confirm(), so confirm in the extension host.
                if (!(await (0, webview_ui_1.confirmAction)(`Delete the ${language} snippet "${snippetKey}"?`, "Delete snippet")))
                    return;
                delete file.snippets[snippetKey];
                await (0, snippet_utils_1.saveSnippets)(path.join(snippetsFolderPath, `custom_${language}.json`), file.snippets);
                render(`Deleted "${snippetKey}". Reload the window to remove it from IntelliSense.`);
                const action = await vscode.window.showInformationMessage(`Deleted snippet "${snippetKey}".`, "Reload Window", "Later");
                if (action === "Reload Window") {
                    await vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Snippet action failed: ${detail}`);
                (0, webview_ui_1.safePostMessage)(panel, { command: "error", message: detail });
            }
        });
        panel.onDidDispose(() => {
            messageSubscription.dispose();
            if (activePanel === panel)
                activePanel = undefined;
        });
    });
    context.subscriptions.push(command);
}
exports.registerShowSnippetsCommand = registerShowSnippetsCommand;
function generateWebviewContent(loaded, status) {
    const nonce = (0, webview_ui_1.getNonce)();
    const groups = loaded.files.filter(file => Object.keys(file.snippets).length > 0);
    const total = groups.reduce((count, group) => count + Object.keys(group.snippets).length, 0);
    const errorBanner = loaded.errors.length
        ? `<div class="banner fail">${loaded.errors.map(webview_ui_1.escapeHtml).join("<br>")}</div>`
        : "";
    const statusBanner = status ? `<div class="banner ok">${(0, webview_ui_1.escapeHtml)(status)}</div>` : "";
    const body = groups.length
        ? groups
            .map(group => `
        <section class="group">
          <h2>${(0, webview_ui_1.escapeHtml)(group.language)} <span class="count">${Object.keys(group.snippets).length}</span></h2>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Prefix</th><th>Name</th><th>Description</th><th>Body</th><th>Action</th></tr></thead>
              <tbody>
                ${Object.entries(group.snippets)
            .map(([key, snippet]) => `
                  <tr>
                    <td><code>${(0, webview_ui_1.escapeHtml)(snippet?.prefix ?? "")}</code></td>
                    <td>${(0, webview_ui_1.escapeHtml)(key)}</td>
                    <td>${(0, webview_ui_1.escapeHtml)(snippet?.description ?? "")}</td>
                    <td><pre>${(0, webview_ui_1.escapeHtml)(bodyToText(snippet?.body))}</pre></td>
                    <td><button class="danger delete-btn" type="button" data-language="${(0, webview_ui_1.escapeHtml)(group.language)}" data-key="${(0, webview_ui_1.escapeHtml)(key)}">Delete</button></td>
                  </tr>`)
            .join("")}
              </tbody>
            </table>
          </div>
        </section>`)
            .join("")
        : `<section class="empty">
         <h2>No custom snippets yet</h2>
         <p>Select code in an editor and run <strong>DevSnip Pro: Create Your Own Perfect Code Snippet</strong> from the Command Palette. Saved snippets appear here, and in IntelliSense after a window reload.</p>
       </section>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Custom Snippets</title>
  <style>
    ${webview_ui_1.THEME_TOKENS}
    * { box-sizing: border-box; }
    body { margin: 0; padding: clamp(16px, 4vw, 32px); background: var(--bg); color: var(--text); font: 13px var(--font); }
    .shell { max-width: 1180px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .intro { color: var(--muted); margin: 0 0 18px; }
    .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    input[type="search"] { flex: 1; min-width: 220px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); color: var(--text); font: inherit; }
    input[type="search"]:focus { outline: 2px solid var(--focus); outline-offset: 1px; }
    button { padding: 8px 14px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { border-color: var(--focus); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    button.danger { color: var(--danger); }
    .banner { padding: 10px 13px; border-radius: 7px; border: 1px solid var(--line); margin-bottom: 14px; }
    .banner.ok { border-color: var(--success); }
    .banner.fail { border-color: var(--danger); }
    .group { margin-bottom: 26px; }
    .group h2 { font-size: 15px; margin: 0 0 10px; text-transform: capitalize; display: flex; align-items: center; gap: 8px; }
    .count { font-size: 11px; font-weight: 600; color: var(--muted); border: 1px solid var(--line); border-radius: 10px; padding: 1px 8px; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; min-width: 720px; }
    th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); background: var(--panel); }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover { background: var(--panel-2); }
    code, pre { font-family: var(--mono); font-size: 12px; }
    pre { margin: 0; max-width: 420px; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
    .empty { border: 1px solid var(--line); border-radius: 10px; padding: 44px 24px; text-align: center; background: var(--panel); }
    .empty h2 { margin: 0 0 8px; font-size: 17px; }
    .empty p { margin: 0 auto; max-width: 540px; color: var(--muted); line-height: 1.6; }
    .no-results { display: none; padding: 20px; color: var(--muted); }
  </style>
</head>
<body>
  <main class="shell">
    <h1>Custom snippets</h1>
    <p class="intro">${total} snippet${total === 1 ? "" : "s"} across ${groups.length} language${groups.length === 1 ? "" : "s"}. Snippets are stored with the extension and loaded by VS Code at startup.</p>
    ${errorBanner}
    ${statusBanner}
    <div class="toolbar">
      <input id="searchInput" type="search" placeholder="Filter by prefix, name, description or body..." aria-label="Filter snippets">
      <span id="resultCount" class="count"></span>
      <button id="refreshBtn" type="button">Refresh</button>
    </div>
    ${body}
    <div id="noResults" class="no-results">No snippets match that filter.</div>
  </main>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const input = document.getElementById('searchInput');
      const rows = Array.prototype.slice.call(document.querySelectorAll('tbody tr'));
      const groups = Array.prototype.slice.call(document.querySelectorAll('.group'));
      const count = document.getElementById('resultCount');
      const noResults = document.getElementById('noResults');

      function filter() {
        const query = input.value.trim().toLowerCase();
        let visible = 0;
        rows.forEach(function (row) {
          const match = !query || row.textContent.toLowerCase().indexOf(query) !== -1;
          row.hidden = !match;
          if (match) visible++;
        });
        groups.forEach(function (group) {
          const anyVisible = Array.prototype.slice.call(group.querySelectorAll('tbody tr')).some(function (row) { return !row.hidden; });
          group.hidden = !anyVisible;
        });
        count.textContent = visible + ' shown';
        noResults.style.display = rows.length && !visible ? 'block' : 'none';
      }

      if (input) { input.addEventListener('input', filter); filter(); }
      document.getElementById('refreshBtn').addEventListener('click', function () { vscode.postMessage({ command: 'refresh' }); });
      document.querySelectorAll('.delete-btn').forEach(function (button) {
        button.addEventListener('click', function () {
          vscode.postMessage({
            command: 'deleteSnippet',
            language: button.getAttribute('data-language'),
            snippetKey: button.getAttribute('data-key')
          });
        });
      });
    })();
  </script>
</body>
</html>`;
}
//# sourceMappingURL=showSnippetsCommand.js.map