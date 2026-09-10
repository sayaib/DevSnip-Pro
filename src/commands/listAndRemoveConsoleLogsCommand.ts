import * as vscode from "vscode";
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function registerListAndRemoveConsoleLogsCommand(
  context: vscode.ExtensionContext
) {
  const command = vscode.commands.registerCommand(
    "sayaib.hue-console.listAndRemoveConsoleLogs",
    async () => {
      if (!vscode.workspace.workspaceFolders) {
        vscode.window.showErrorMessage("No workspace is open.");
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        "listConsoleLogs",
        "Console Log Cleaner",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
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

      panel.webview.onDidReceiveMessage(
        async (message) => {
          if (actionInProgress) return;
          actionInProgress = true;
          try {
            if (message.command === "removeSelectedLogs") {
              currentConsoleLogs = await removeSelectedLogs(message.selectedLogs, panel);
            } else if (message.command === "removeAllLogs") {
              currentConsoleLogs = await removeSelectedLogs(currentConsoleLogs, panel);
            } else if (message.command === "refreshLogs") {
              currentConsoleLogs = await fetchConsoleLogs();
              panel.webview.html = currentConsoleLogs.length
                ? generateWebviewContentConsole(currentConsoleLogs)
                : generateWebviewContentConsoleLoading("No console.log statements found.");
            }
          } finally {
            actionInProgress = false;
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  context.subscriptions.push(command);
}

// **Optimized Remove Function**

// async function removeSelectedLogs(
//   selectedLogs: ConsoleLog[],
//   panel: vscode.WebviewPanel
// ) {
//   const workspaceEdit = new vscode.WorkspaceEdit();

//   for (const log of selectedLogs) {
//     try {
//       const uri = vscode.Uri.file(log.filePath);
//       const document = await vscode.workspace.openTextDocument(uri);
//       const line = document.lineAt(log.lineNumber - 1); // Ensure 0-based index
//       workspaceEdit.delete(uri, line.range);
//     } catch (error) {
//       console.error(`Error processing log in file ${log.filePath}:`, error);
//     }
//   }

//   await vscode.workspace.applyEdit(workspaceEdit);

//   vscode.window.showInformationMessage(
//     `Removed ${selectedLogs.length} console.log statements.`
//   );

//   // Re-fetch the updated list of console logs
//   const updatedConsoleLogs = await fetchConsoleLogs();

//   // Update the webview content with the updated list
//   panel.webview.html = generateWebviewContentConsole(updatedConsoleLogs);
// }

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

  for (const [, logs] of logsByFile) {
    for (const log of logs.sort((a, b) => b.startOffset - a.startOffset)) {
      try {
        const uri = vscode.Uri.file(log.filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const start = document.positionAt(log.startOffset);
        const end = document.positionAt(log.endOffset);
        workspaceEdit.delete(uri, new vscode.Range(start, end));
      } catch (error) {
        console.error(`Error processing log in file ${log.filePath}:`, error);
      }
    }
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
function findConsoleLogs(content: string, filePath: string): ConsoleLog[] {
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
        const endOffset = content[end] === ";" ? end + 1 : end;
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
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0d1117;color:#e6edf3;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(520px,100%);padding:28px;border:1px solid #2b3948;border-radius:14px;background:#161d26;box-shadow:0 18px 50px #0005}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#173c3d;color:#41d9c5;font-size:22px}.eyebrow{margin-top:20px;color:#41d9c5;font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:11px}h1{margin:8px 0;color:#e6edf3;font-size:24px}p{margin:0;color:#8b9aaa;line-height:1.5}.progress{height:4px;margin-top:24px;overflow:hidden;border-radius:10px;background:#263440}.progress i{display:block;width:40%;height:100%;border-radius:inherit;background:#41d9c5;animation:scan 1.3s ease-in-out infinite}@keyframes scan{0%{transform:translateX(-120%)}100%{transform:translateX(350%)}}</style></head><body><section class="card"><div class="mark">⌕</div><div class="eyebrow">DevSnip Pro · Workspace scan</div><h1>Finding console logs</h1><p>${escapeHtml(message)}</p><div class="progress"><i></i></div></section></body></html>`;
}

function generateLegacyWebviewContentConsoleLoading(message: string): string {
  const nonce = getNonce();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Log Viewer</title>
    <style>
    @import url("https://fonts.googleapis.com/css?family=Raleway:400,400i,700");

* {
  padding: 0;
  margin: 0 auto;
  font-family: Raleway, sans-serif;
  color: white;
}

html {
  cursor: none;
  width: 100%;
  height: 100%;
}

body {
  background-color: #0C1118;
}

.container {
  display: flex;
  justify-content: center;
  align-items: center;
}

.coding-ide-ui {
  margin-top: 30vh;
  background-color: #303030;
  width: 50%;
  height: 250px;
  border-top-right-radius: 10px;
  border-top-left-radius: 10px;
  border-bottom-right-radius: 6px;
  border-bottom-left-radius: 6px;
  user-select: none;
}

.top-coding-ide-ui {
  background-color: #202020;
  width: 100%;
  height: 30px;
  border-top-right-radius: 10px;
  border-top-left-radius: 10px;
}

.top-coding-ide-ui span {
  display: flex;
  background-color: red;
  border-radius: 50%;
  width: 15px;
  height: 15px;
  content: "X";
  margin: 5px;
  margin-top: 8px;
  float: right;
}

.coding-ide-ui-lines span {
  background: rgba(189, 195, 199, 0.2);
  width: 30%;
  height: 15px;
  float: left;
  margin-left: 8px;
  margin-top: 8px;
  border-radius: 15px;
  animation: test 3s infinite ease;
}
h3{
margin-top:10px;
  font-size:0.9rem;
  text-align:center;
  color:#758694;
 
}
main h2 {
 
  display: flex;
  justify-content: center;
}

@keyframes load {
  0% {
    width: 0%;
    opacity: 0%;
    transform: translateX(-20px);
  }
  50% {
    transform: translateX(0px);
  }
  100% {
    width: 100%;
    opacity: 100%;
  }
}


    </style>
</head>
<body>
  <div id="loader">
  <div class="container">
    <div class="coding-ide-ui">
      <div class="top-coding-ide-ui">
        <span style="background: red;"></span>
        <span style="background: orange;"></span>
        <span style="background: green;"></span>
      </div>
      <div class="coding-ide-ui-lines">
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <span class="coding-ide-ui-line"></span>
          <br>
          <br>
          <h3>${escapeHtml(message)}</h3>
          <br>
      </div>
    </div>
  </div>
  <br>
 
</div>




    <script nonce="${nonce}">
  //Loader
const loader = document.querySelector("#loader");


window.onload = () => {
  loader.style.display = "block";
};

const showMain = () => {
 
};

//Random "Lines of Code" Width
var spans = document.getElementsByTagName("span");
var l = spans.length;
for (var i = 0; i < l; i++) {
  var spanClass = spans[i].getAttribute("class");
  if (spanClass === "coding-ide-ui-line") {
    var randomW = Math.floor(Math.random() * 50) + 15;
    spans[i].style.width = randomW + "%";
    spans[i].style.animation = "load 3.5s infinite ease-in-out";
    var waitTime = Math.floor(Math.random() * 10) + 5;
    setTimeout(() => {
      showMain();
    }, waitTime * 1000);
  }
}

    </script>
</body>
</html>

  `;
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
    :root { color-scheme: dark; --bg:#0d1117; --panel:#161d26; --panel-2:#1d2732; --line:#2b3948; --text:#e6edf3; --muted:#8b9aaa; --accent:#41d9c5; --danger:#ff7b72; }
    * { box-sizing:border-box; } body { margin:0; padding:32px clamp(18px,4vw,56px); background:radial-gradient(circle at 85% 0%,#16333a 0,transparent 38%),var(--bg); color:var(--text); font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .shell { max-width:1280px; margin:auto; } .eyebrow { color:var(--accent); font-weight:700; letter-spacing:.11em; text-transform:uppercase; font-size:11px; }
    h1 { margin:8px 0 6px; font-size:clamp(25px,4vw,38px); letter-spacing:-.035em; } .intro { margin:0; color:var(--muted); max-width:660px; line-height:1.55; }
    .summary { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:26px 0 20px; } .stat,.toolbar,.table-wrap { background:color-mix(in srgb,var(--panel) 93%,transparent); border:1px solid var(--line); border-radius:12px; }
    .stat { padding:15px 17px; } .stat strong { display:block; font-size:25px; margin-bottom:3px; } .stat span { color:var(--muted); }
    .toolbar { display:flex; gap:12px; align-items:center; padding:12px; margin-bottom:14px; } .search { flex:1; position:relative; } .search span { position:absolute; left:12px; top:9px; color:var(--muted); font-size:16px; }
    input { width:100%; padding:10px 12px 10px 34px; border:1px solid var(--line); border-radius:8px; background:var(--panel-2); color:var(--text); outline:none; } input:focus { border-color:var(--accent); box-shadow:0 0 0 2px #41d9c522; }
    button { border:1px solid transparent; border-radius:8px; padding:10px 14px; color:var(--text); background:var(--panel-2); cursor:pointer; font-weight:650; } button:hover { border-color:var(--accent); } button:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .danger { background:#4b2427; color:#ffb4ae; } .danger:hover { border-color:var(--danger); } .table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; min-width:760px; } th,td { text-align:left; padding:13px 15px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; background:#1b2530; position:sticky; top:0; } tbody tr:hover { background:#1b2832; } tbody tr:last-child td { border-bottom:0; }
    .file { color:var(--text); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; white-space:nowrap; } .line { color:var(--muted); white-space:nowrap; } pre { margin:0; max-width:560px; white-space:pre-wrap; overflow-wrap:anywhere; color:#c9d5df; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; } .check { width:42px; } input[type=checkbox] { width:15px; height:15px; accent-color:var(--accent); } .selected { background:#173337; } .empty { padding:38px; text-align:center; color:var(--muted); }
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
  const vscode = acquireVsCodeApi(); const logs = ${JSON.stringify(consoleLogs)}; const input = document.getElementById('searchInput'); const rows = [...document.querySelectorAll('#consoleTable tbody tr')]; const checks = [...document.querySelectorAll('.row-check')]; const selectAll = document.getElementById('selectAll'); const removeSelected = document.getElementById('removeSelectedBtn'); const count = document.getElementById('resultCount');
  function selectedLogs() { return checks.filter(check => check.checked).map(check => logs[Number(check.dataset.index)]); }
  function updateSelection() { const selected = selectedLogs().length; removeSelected.disabled = !selected; removeSelected.textContent = selected ? 'Remove selected (' + selected + ')' : 'Remove selected'; const visible = checks.filter(check => !check.closest('tr').hidden); selectAll.checked = visible.length > 0 && visible.every(check => check.checked); selectAll.indeterminate = visible.some(check => check.checked) && !selectAll.checked; checks.forEach(check => check.closest('tr').classList.toggle('selected', check.checked)); }
  function filter() { const query = input.value.trim().toLowerCase(); let visible = 0; rows.forEach(row => { const match = !query || row.textContent.toLowerCase().includes(query); row.hidden = !match; if (match) visible++; }); count.textContent = visible + ' visible'; updateSelection(); }
  input.addEventListener('input', filter); filter();
  checks.forEach(check => check.addEventListener('change', updateSelection));
  selectAll.addEventListener('change', () => { checks.forEach(check => { if (!check.closest('tr').hidden) check.checked = selectAll.checked; }); updateSelection(); });
  removeSelected.addEventListener('click', () => { const selected = selectedLogs(); if (selected.length) vscode.postMessage({command:'removeSelectedLogs', selectedLogs:selected}); });
  document.querySelectorAll('.remove-log-btn').forEach(button => button.addEventListener('click', () => { button.disabled = true; vscode.postMessage({ command:'removeSelectedLogs', selectedLogs:[logs[Number(button.dataset.index)]] }); }));
  document.getElementById('refreshBtn').addEventListener('click', () => vscode.postMessage({command:'refreshLogs'}));
  document.getElementById('removeAllLogsBtn').addEventListener('click', () => { if (confirm('Remove all ' + logs.length + ' console.log statements?')) vscode.postMessage({command:'removeAllLogs'}); });
</script></body></html>`;
}

function generateLegacyWebviewContentConsole(consoleLogs: ConsoleLog[]): string {
  const nonce = getNonce();
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Log Viewer</title>
    <style>
        /* General Styles */
        body {
            font-family: 'Arial', sans-serif;
            margin: 0;
            background-color: #0C1118;
            color: #FFFFFF;
            text-align: center;
        }

        h1 {
            margin-top: 30px;
            font-size: 2rem;
            color: #FFFFFF;
            font-weight: 600;
        }

        h1 span {
            color: #19C8D9;
        }

        /* Search Input */
        #searchInput {
            margin: 20px auto;
            width: 80%;
            max-width: 600px;
            padding: 12px;
            border-radius: 8px;
            border: 2px solid #273341;
            background-color: #1C2630;
            color: #FFFFFF;
            font-size: 1rem;
            outline: none;
            transition: border-color 0.3s;
        }

        #searchInput:focus {
            border-color: #19C8D9;
        }

        /* Table Styles */
        table {
            width: 95%;
            max-width: 1200px;
            margin: 30px auto;
            border-collapse: collapse;
            background-color: #1C2630;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
        }

        thead {
            background-color: #273341;
        }

        th, td {
            padding: 15px;
            text-align: center;
            border-bottom: 1px solid #303A45;
        }

        th {
            font-weight: 600;
            color: #19C8D9;
        }

        tbody tr:hover {
            background-color: #303A45;
            transition: background-color 0.3s;
        }

        tbody tr:last-child td {
            border-bottom: none;
        }

        /* Button Styles */
        button {
            background-color: #A61E1E;
            color: white;
            font-weight: bold;
            padding: 10px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: background-color 0.3s;
        }

        button:hover {
            background-color: #8A1A1A;
        }

        .remove-log-btn {
            background-color: #273341;
            color: #FFFFFF;
            padding: 8px 15px;
            border-radius: 5px;
            border: 1px solid #19C8D9;
            transition: background-color 0.3s;
        }

        .remove-log-btn:hover {
            background-color: #19C8D9;
            color: #0C1118;
        }




        /* Container for Actions */
        .actions {
            margin-top: 20px;
            margin-bottom: 40px;
        }
    </style>
</head>
<body>
    <h1>Active <span>Console Log Statements</span> in the Project</h1>
    <input type="text" id="searchInput" placeholder="Search logs..."/>

    <div class="container">
        <table id="consoleTable">
            <thead>
                <tr>
                    <th>Sr. No.</th>
                    <th>Action</th>
                    <th>File Path</th>
                    <th>Line Number</th>
                    <th>Log Text</th>
                </tr>
            </thead>
            <tbody>
                ${consoleLogs
                  .map(
                    (log, key) => `
                        <tr>
                            <td>${key + 1}</td>
                            <td><button class="remove-log-btn" data-index="${key}">Remove</button></td>
                            <td>${escapeHtml(log.filePath)}</td>
                            <td>${log.lineNumber}</td>
                            <td><pre>${escapeHtml(log.text)}</pre></td>
                        </tr>`
                  )
                  .join("")}
            </tbody>
        </table>

        <div class="actions">
            <button type="button" id="removeAllLogsBtn">Remove All Logs</button>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const consoleLogsData = ${JSON.stringify(consoleLogs)};

        function filterTable() {
            const searchInput = document.getElementById("searchInput").value.trim();
            const rows = document.querySelectorAll("#consoleTable tbody tr");
            let regex;
            try {
                regex = new RegExp(searchInput, "i");
            } catch {
                rows.forEach((row) => row.style.display = "none");
                return;
            }

            rows.forEach((row) => {
                const cells = Array.from(row.querySelectorAll("td"));
                const matches = cells.some((cell) => regex.test(cell.textContent));
                row.style.display = matches ? "" : "none";
            });
        }

        document.getElementById('searchInput').addEventListener('input', filterTable);

        document.querySelectorAll('.remove-log-btn').forEach(button => {
            button.addEventListener('click', function() {
                const index = parseInt(this.getAttribute('data-index'));
                const log = consoleLogsData[index];
                if (log) {
                    vscode.postMessage({
                        command: "removeSelectedLogs",
                        selectedLogs: [log]
                    });
                }
            });
        });

        function removeAllLogs() {
            vscode.postMessage({ command: "removeAllLogs" });
        }

        document.getElementById('removeAllLogsBtn').addEventListener('click', removeAllLogs);
    </script>
</body>
</html>

  `;
}

function generateWebviewContentConsoleDeleteConfirm(
  consoleLogs: ConsoleLog[]
): string {
  const nonce = getNonce();
  return `

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Success Alert Box</title>
    <style>
        body {
            display: flex;
            justify-content: center;
            flex-direction:column;
            align-items: center;
            height: 80vh;
            background-color: #121212;
            font-family: Arial, sans-serif;
        }

        .alert-box {
            background-color: #1e1e1e;
            color: #4caf50;
            padding: 15px 20px;
            border-left: 5px solid #4caf50;
            border-radius: 5px;
            box-shadow: 0 0 10px rgba(0, 255, 0, 0.2);
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .alert-icon {
            font-size: 20px;
        }

        .close-btn {
            background: none;
            border: none;
            color: #4caf50;
            font-size: 18px;
            cursor: pointer;
        }

        .close-btn:hover {
            color: #81c784;
        }
              .table-container {
              margin-top:10px;
            width: 80%;
            max-height: 65vh;
            overflow-y: auto;
            border-radius: 10px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
        }

                table {
            width: 100%;
            margin: 30px auto;
            border-collapse: collapse;
            background-color: #1C2630;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
        }
        thead {
            background-color: #273341;
            font-weight: bold;
        }
       th, td {
    padding: 15px;
    text-align: center;
font-size:10px;
}


        tbody tr:hover {
            background-color: #303A45;
        }
    </style>
</head>
<body>
    <div class="alert-box">
        <span class="alert-icon">✔</span>
        <span>Success! Your delete action was completed successfully. Console Log Deleted: ${
          consoleLogs.length
        }</span>
        <button class="close-btn" id="closeConfirmBtn">✖</button>
    </div>

    <div class="table-container">
   <table id="consoleTable">
          <thead>
              <tr>'
              <th>Sr. No.</th>
             
                  <th>File Path</th>
                  <th>Line Number</th>
                  <th>Log Text</th>
              </tr>
          </thead>
          <tbody>
              ${consoleLogs
                .map(
                  (log, key) => `
              <tr>
              <td>${key + 1}
                
                  <td>${log.filePath}</td>
                  <td>${log.lineNumber}</td>
                  <td>
                  <pre style="white-space: pre-wrap;">
                    ${escapeHtml(log.text)}
               </pre>
                  </td>
              </tr>`
                )
                .join("")}
          </tbody>
      </table>
    </div>
    <script nonce="${nonce}">
      document.getElementById('closeConfirmBtn').addEventListener('click', function() {
        this.parentElement.style.display = 'none';
      });
    </script>
</body>
</html>

  `;
}
