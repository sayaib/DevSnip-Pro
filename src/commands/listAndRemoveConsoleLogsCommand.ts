import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { THEME_TOKENS, confirmAction, embedJson, escapeHtml, getNonce, openToolPanel } from "../utils/webview-ui";
import * as fs from "fs/promises";
import * as path from "path";

interface ConsoleLog {
  filePath: string;
  lineNumber: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

const SEARCH_PATTERN = "**/*.{ts,tsx,js,jsx,php,html}";
const EXCLUDE_PATTERN =
  "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/temp/**,**/.next/**}";

export function registerListAndRemoveConsoleLogsCommand(
  context: vscode.ExtensionContext
) {
  const command = registerTrackedCommand(
    "sayaib.hue-console.listAndRemoveConsoleLogs",
    async () => {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage("No workspace is open.");
        return;
      }

      const { panel, created } = openToolPanel("listConsoleLogs", "Console Log Cleaner", { enableScripts: true });
      if (!created) return;
      const iconPath = path.resolve(context.extensionPath, "logo.png");
      panel.iconPath = vscode.Uri.file(iconPath);

      panel.webview.html = generateWebviewContentConsoleLoading(
        "Searching for console logs. Please wait..."
      );

      const allConsoleLogs: ConsoleLog[] = [];

      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(
          vscode.workspace.workspaceFolders[0],
          SEARCH_PATTERN
        ),
        EXCLUDE_PATTERN
      );

      const scanResults = await Promise.all(files.map((file) => scanFile(file)));
      allConsoleLogs.push(...scanResults.flat());

      if (allConsoleLogs.length === 0) {
        panel.webview.html = generateWebviewContentConsoleLoading(
          "No `console.log` statements found."
        );
        vscode.window.showInformationMessage(
          "No console.log statements found."
        );
        return;
      }

      panel.webview.html = generateWebviewContentConsole(allConsoleLogs);
      let currentConsoleLogs = allConsoleLogs;
      let actionInProgress = false;

      const messageSubscription = panel.webview.onDidReceiveMessage(async (message) => {
        if (actionInProgress) return;
        actionInProgress = true;
        try {
          if (message?.command === "removeSelectedLogs") {
            const requested = matchKnownLogs(message.selectedLogs, currentConsoleLogs);
            if (!requested.length) {
              vscode.window.showWarningMessage("Those console logs are no longer available. Refresh and try again.");
              currentConsoleLogs = await refreshPanel(panel);
            } else {
              currentConsoleLogs = await removeSelectedLogs(requested, panel);
            }
          } else if (message?.command === "removeAllLogs") {
            // The webview sandbox blocks confirm(), so ask in the extension host.
            // `devsnip.consoleLogCleanup.confirmBeforeDelete` lets users skip the prompt.
            const needsConfirmation = vscode.workspace
              .getConfiguration("devsnip")
              .get<boolean>("consoleLogCleanup.confirmBeforeDelete", true);
            const confirmed = !needsConfirmation || await confirmAction(
              `Remove all ${currentConsoleLogs.length} console.log statement(s) from your workspace?`,
              "Remove all"
            );
            if (confirmed) {
              currentConsoleLogs = await removeSelectedLogs(currentConsoleLogs, panel);
            }
          } else if (message?.command === "refreshLogs") {
            currentConsoleLogs = await refreshPanel(panel);
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Console log cleanup failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          actionInProgress = false;
        }
      });

      panel.onDidDispose(() => messageSubscription.dispose());
    }
  );

  context.subscriptions.push(command);
}

/**
 * Re-renders the panel from a fresh scan.
 */
async function refreshPanel(panel: vscode.WebviewPanel): Promise<ConsoleLog[]> {
  const logs = await fetchConsoleLogs();
  panel.webview.html = logs.length
    ? generateWebviewContentConsole(logs)
    : generateWebviewContentConsoleLoading("No console.log statements found.");
  return logs;
}

/**
 * Maps a webview selection back onto the logs the extension actually scanned.
 * Offsets that arrive from a webview are never trusted directly - deleting a
 * range the extension did not produce could destroy unrelated source code.
 */
function matchKnownLogs(selection: unknown, known: ConsoleLog[]): ConsoleLog[] {
  if (!Array.isArray(selection)) return [];
  const index = new Map(known.map(log => [`${log.filePath}:${log.startOffset}:${log.endOffset}`, log]));
  const matched: ConsoleLog[] = [];
  for (const entry of selection) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<ConsoleLog>;
    const key = `${candidate.filePath}:${candidate.startOffset}:${candidate.endOffset}`;
    const log = index.get(key);
    if (log && !matched.includes(log)) matched.push(log);
  }
  return matched;
}

async function removeSelectedLogs(
  selectedLogs: ConsoleLog[],
  panel: vscode.WebviewPanel
): Promise<ConsoleLog[]> {
  if (!selectedLogs.length) return fetchConsoleLogs();

  // Group by file so one workspace edit can safely remove multiple ranges.
  const logsByFile = new Map<string, ConsoleLog[]>();
  for (const log of selectedLogs) {
    const existing = logsByFile.get(log.filePath) || [];
    existing.push(log);
    logsByFile.set(log.filePath, existing);
  }

  const workspaceEdit = new vscode.WorkspaceEdit();

  let stale = 0;
  for (const [, logs] of logsByFile) {
    for (const log of logs.sort((a, b) => b.startOffset - a.startOffset)) {
      try {
        const uri = vscode.Uri.file(log.filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const start = document.positionAt(log.startOffset);
        const end = document.positionAt(log.endOffset);
        const range = new vscode.Range(start, end);
        // The file may have changed since the scan. Only delete when the text
        // at the recorded range is still exactly the console.log that was found.
        if (document.getText(range) !== log.text) {
          stale++;
          continue;
        }
        workspaceEdit.delete(uri, range);
      } catch (error) {
        console.error(`Error processing log in file ${log.filePath}:`, error);
      }
    }
  }

  if (stale) {
    vscode.window.showWarningMessage(
      `${stale} console.log statement(s) changed on disk since the scan and were skipped. Refreshing the list.`
    );
  }

  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (!applied) {
    vscode.window.showErrorMessage("Could not update the selected files.");
    return fetchConsoleLogs();
  }

  // Save all modified files
  for (const filePath of logsByFile.keys()) {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    await document.save();
  }

  vscode.window.showInformationMessage(
    `Removed ${selectedLogs.length} console.log statements.`
  );

  const updatedConsoleLogs = await fetchConsoleLogs();
  panel.webview.html = updatedConsoleLogs.length
    ? generateWebviewContentConsole(updatedConsoleLogs)
    : generateWebviewContentConsoleLoading("All console.log statements are gone.");
  return updatedConsoleLogs;
}

async function fetchConsoleLogs(): Promise<ConsoleLog[]> {
  const allConsoleLogs: ConsoleLog[] = [];

  if (!vscode.workspace.workspaceFolders) {
    return allConsoleLogs;
  }

  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders[0],
      SEARCH_PATTERN
    ),
    EXCLUDE_PATTERN
  );

  const results = await Promise.all(files.map((file) => scanFile(file)));

  return results.flat();
}

async function scanFile(file: vscode.Uri): Promise<ConsoleLog[]> {
  try {
    return findConsoleLogs(await fs.readFile(file.fsPath, "utf8"), file.fsPath);
  } catch (error) {
    console.error(`Error reading file ${file.fsPath}:`, error);
    return [];
  }
}

/** Finds real console.log calls while ignoring comments and quoted text. */
export function findConsoleLogs(content: string, filePath: string): ConsoleLog[] {
  const logs: ConsoleLog[] = [];
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let low = 0, high = lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineStarts[mid] <= offset) low = mid + 1; else high = mid - 1;
    }
    return high + 1;
  };
  const isIdent = (value: string | undefined) => !!value && /[\w$]/.test(value);
  let i = 0;
  while (i < content.length) {
    if (content.startsWith("//", i)) { i = content.indexOf("\n", i + 2); if (i < 0) break; continue; }
    if (content.startsWith("/*", i)) { const end = content.indexOf("*/", i + 2); i = end < 0 ? content.length : end + 2; continue; }
    if (content[i] === "'" || content[i] === '"' || content[i] === "`") { i = skipString(content, i); continue; }
    if (content.startsWith("console", i) && !isIdent(content[i - 1])) {
      let cursor = i + "console".length;
      while (/\s/.test(content[cursor] || "")) cursor++;
      if (content[cursor] !== ".") { i++; continue; }
      cursor++;
      while (/\s/.test(content[cursor] || "")) cursor++;
      if (!content.startsWith("log", cursor) || isIdent(content[cursor + 3])) { i++; continue; }
      cursor += 3;
      while (/\s/.test(content[cursor] || "")) cursor++;
      if (content[cursor] !== "(") { i++; continue; }
      const end = findCallEnd(content, cursor);
      if (end > cursor) {
        // findCallEnd returns the index of the closing ')', which the slice
        // must include - otherwise removing the log left ');' behind and broke
        // the file. A trailing semicolon is taken with it.
        let endOffset = end + 1;
        if (content[endOffset] === ";") endOffset++;
        logs.push({ filePath, lineNumber: lineAt(i), text: content.slice(i, endOffset), startOffset: i, endOffset });
        i = endOffset;
        continue;
      }
    }
    i++;
  }
  return logs;
}

function skipString(content: string, start: number): number {
  const quote = content[start];
  for (let i = start + 1; i < content.length; i++) {
    if (content[i] === "\\") { i++; continue; }
    if (content[i] === quote) return i + 1;
  }
  return content.length;
}

function findCallEnd(content: string, open: number): number {
  let depth = 0;
  for (let i = open; i < content.length; i++) {
    if (content.startsWith("//", i)) { i = content.indexOf("\n", i + 2); if (i < 0) return -1; continue; }
    if (content.startsWith("/*", i)) { const end = content.indexOf("*/", i + 2); i = end < 0 ? content.length : end + 1; continue; }
    if (content[i] === "'" || content[i] === '"' || content[i] === "`") { i = skipString(content, i) - 1; continue; }
    if (content[i] === "(") depth++;
    if (content[i] === ")" && --depth === 0) return i;
  }
  return -1;
}
function generateWebviewContentConsoleLoading(message: string): string {
  const nonce = getNonce();
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><title>Console Log Cleaner</title><style>
    ${THEME_TOKENS}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:13px var(--font)}.card{width:min(520px,100%);padding:28px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:var(--panel-2);color:var(--accent);font-size:22px}.eyebrow{margin-top:20px;color:var(--accent);font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:11px}h1{margin:8px 0;color:var(--text);font-size:24px}p{margin:0;color:var(--muted);line-height:1.5}.progress{height:4px;margin-top:24px;overflow:hidden;border-radius:10px;background:var(--panel-2)}.progress i{display:block;width:40%;height:100%;border-radius:inherit;background:var(--accent);animation:scan 1.3s ease-in-out infinite}@keyframes scan{0%{transform:translateX(-120%)}100%{transform:translateX(350%)}}</style></head><body><section class="card"><div class="mark">⌕</div><div class="eyebrow">DevSnip Pro · Workspace scan</div><h1>Finding console logs</h1><p>${escapeHtml(message)}</p><div class="progress"><i></i></div></section></body></html>`;
}

function generateWebviewContentConsole(consoleLogs: ConsoleLog[]): string {
  const nonce = getNonce();
  const fileCount = new Set(consoleLogs.map((log) => log.filePath)).size;
  return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Console Log Cleaner</title>
  <style>
    ${THEME_TOKENS}
    * { box-sizing:border-box; } body { margin:0; padding:32px clamp(18px,4vw,56px); background:var(--bg); color:var(--text); font:13px var(--font); }
    .shell { max-width:1280px; margin:auto; } .eyebrow { color:var(--accent); font-weight:700; letter-spacing:.11em; text-transform:uppercase; font-size:11px; }
    h1 { margin:8px 0 6px; font-size:clamp(25px,4vw,38px); letter-spacing:-.035em; } .intro { margin:0; color:var(--muted); max-width:660px; line-height:1.55; }
    .summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:26px 0 20px; } .stat,.toolbar,.table-wrap { background:color-mix(in srgb,var(--panel) 93%,transparent); border:1px solid var(--line); border-radius:12px; }
    .stat { padding:15px 17px; } .stat strong { display:block; font-size:25px; margin-bottom:3px; } .stat span { color:var(--muted); }
    .toolbar { display:flex; gap:12px; align-items:center; padding:12px; margin-bottom:14px; } .search { flex:1; position:relative; } .search span { position:absolute; left:12px; top:9px; color:var(--muted); font-size:16px; }
    input { width:100%; padding:10px 12px 10px 34px; border:1px solid var(--line); border-radius:8px; background:var(--panel-2); color:var(--text); outline:none; } input:focus { border-color:var(--focus); }
    button { border:1px solid transparent; border-radius:8px; padding:10px 14px; color:var(--text); background:var(--panel-2); cursor:pointer; font-weight:650; } button:hover { border-color:var(--accent); } button:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .danger { background:var(--panel-2); color:var(--danger); } .danger:hover { border-color:var(--danger); } .table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; min-width:760px; } th,td { text-align:left; padding:13px 15px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; background:var(--panel); position:sticky; top:0; } tbody tr:hover { background:var(--panel-2); } tbody tr:last-child td { border-bottom:0; }
    .file { color:var(--text); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; white-space:nowrap; } .line { color:var(--muted); white-space:nowrap; } pre { margin:0; max-width:560px; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text); font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; } .check { width:42px; } input[type=checkbox] { width:15px; height:15px; accent-color:var(--accent); } .selected { background:var(--panel-2); } .empty { padding:38px; text-align:center; color:var(--muted); }
    @media (max-width:650px) { body { padding:22px 14px; } .summary { grid-template-columns:1fr; } .toolbar { flex-wrap:wrap; } .search { flex-basis:100%; } }
  </style>
</head><body><main class="shell">
  <div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Console log cleaner</h1>
  <p class="intro">Review debug output before removing it from your project. Only active <code>console.log()</code> calls are shown; comments and quoted text are ignored.</p>
  <section class="summary" aria-label="Scan summary"><div class="stat"><strong>${consoleLogs.length}</strong><span>logs found</span></div><div class="stat"><strong>${fileCount}</strong><span>files affected</span></div><div class="stat"><strong>Ready</strong><span>review before cleanup</span></div></section>
  <div class="toolbar"><label class="search"><span>⌕</span><input id="searchInput" type="search" placeholder="Filter by file, line, or log text…" aria-label="Filter console logs"></label><span id="resultCount" class="line"></span><button id="refreshBtn" type="button">Refresh</button><button id="removeSelectedBtn" class="danger" type="button" disabled>Remove selected</button><button id="removeAllLogsBtn" class="danger" type="button">Remove all</button></div>
  <div class="table-wrap"><table id="consoleTable"><thead><tr><th class="check"><input id="selectAll" type="checkbox" aria-label="Select all visible logs"></th><th>File</th><th>Line</th><th>Log statement</th><th>Action</th></tr></thead><tbody>
    ${consoleLogs.map((log, index) => `<tr><td class="check"><input class="row-check" type="checkbox" data-index="${index}" aria-label="Select log in ${escapeHtml(log.filePath)} at line ${log.lineNumber}"></td><td class="file" title="${escapeHtml(log.filePath)}">${escapeHtml(vscode.workspace.asRelativePath(log.filePath))}</td><td class="line">${log.lineNumber}</td><td><pre>${escapeHtml(log.text)}</pre></td><td><button class="remove-log-btn danger" data-index="${index}" type="button">Remove</button></td></tr>`).join("")}
  </tbody></table></div>
</main><script nonce="${nonce}">
  const vscode = acquireVsCodeApi(); const logs = ${embedJson(consoleLogs)}; const input = document.getElementById('searchInput'); const rows = [...document.querySelectorAll('#consoleTable tbody tr')]; const checks = [...document.querySelectorAll('.row-check')]; const selectAll = document.getElementById('selectAll'); const removeSelected = document.getElementById('removeSelectedBtn'); const count = document.getElementById('resultCount');
  function selectedLogs() { return checks.filter(check => check.checked).map(check => logs[Number(check.dataset.index)]); }
  function updateSelection() { const selected = selectedLogs().length; removeSelected.disabled = !selected; removeSelected.textContent = selected ? 'Remove selected (' + selected + ')' : 'Remove selected'; const visible = checks.filter(check => !check.closest('tr').hidden); selectAll.checked = visible.length > 0 && visible.every(check => check.checked); selectAll.indeterminate = visible.some(check => check.checked) && !selectAll.checked; checks.forEach(check => check.closest('tr').classList.toggle('selected', check.checked)); }
  function filter() { const query = input.value.trim().toLowerCase(); let visible = 0; rows.forEach(row => { const match = !query || row.textContent.toLowerCase().includes(query); row.hidden = !match; if (match) visible++; }); count.textContent = visible + ' visible'; updateSelection(); }
  input.addEventListener('input', filter); filter();
  checks.forEach(check => check.addEventListener('change', updateSelection));
  selectAll.addEventListener('change', () => { checks.forEach(check => { if (!check.closest('tr').hidden) check.checked = selectAll.checked; }); updateSelection(); });
  removeSelected.addEventListener('click', () => { const selected = selectedLogs(); if (selected.length) vscode.postMessage({command:'removeSelectedLogs', selectedLogs:selected}); });
  document.querySelectorAll('.remove-log-btn').forEach(button => button.addEventListener('click', () => { button.disabled = true; vscode.postMessage({ command:'removeSelectedLogs', selectedLogs:[logs[Number(button.dataset.index)]] }); }));
  document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({command:'refreshLogs'}));
  document.getElementById('removeAllLogsBtn').addEventListener('click', () => vscode.postMessage({command:'removeAllLogs'}));
</script></body></html>`;
}
