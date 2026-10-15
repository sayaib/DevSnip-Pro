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
exports.registerListAndRemoveConsoleLogsCommand = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const service_1 = require("../theme/service");
const find_logs_1 = require("../debug/find-logs");
const syntax_1 = require("../debug/syntax");
const SEARCH_PATTERN = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,py,java,kt,kts,cs,dart,swift,html,htm,vue,svelte,php}";
const EXCLUDE_PATTERN = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/coverage/**,**/temp/**,**/.next/**,**/.nuxt/**,**/.svelte-kit/**," +
    "**/bin/**,**/obj/**,**/target/**,**/.gradle/**,**/.dart_tool/**,**/Pods/**,**/.build/**,**/DerivedData/**," +
    "**/__pycache__/**,**/.venv/**,**/venv/**,**/site-packages/**,**/vendor/**,**/*.min.js,**/*.g.dart,**/*.freezed.dart,**/*.d.ts}";
const READ_BATCH_SIZE = 40;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
function registerListAndRemoveConsoleLogsCommand(context) {
    const command = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.listAndRemoveConsoleLogs", async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            vscode.window.showErrorMessage("Open a folder first: the debug log cleaner scans the workspace.");
            return;
        }
        const { panel, created } = (0, webview_ui_1.openToolPanel)("listConsoleLogs", "Debug Log Cleaner", { enableScripts: true });
        if (!created)
            return;
        panel.iconPath = vscode.Uri.file(path.resolve(context.extensionPath, "logo.png"));
        (0, service_1.setWebviewHtml)(panel.webview, statusPage("Scanning JavaScript, TypeScript, Python, Java, Kotlin, C#, Dart and Swift files…", true));
        let findings = await scanWorkspace(folder);
        const render = () => (0, service_1.setWebviewHtml)(panel.webview, findings.length ? resultsPage(findings) : statusPage("No debug output statements were found.", false));
        render();
        let busy = false;
        const subscription = panel.webview.onDidReceiveMessage(async (message) => {
            if (message?.command === "open") {
                const finding = findings[Number(message.index)];
                if (finding)
                    await revealFinding(finding);
                return;
            }
            if (busy)
                return;
            busy = true;
            try {
                if (message?.command === "refresh") {
                    findings = await scanWorkspace(folder);
                }
                else if (message?.command === "remove" || message?.command === "removeVisible") {
                    // Indexes from the webview are only used to pick from what this scan found;
                    // the text at each range is checked again before anything is deleted.
                    const selected = pick(findings, message.indexes).filter(finding => finding.removable);
                    if (!selected.length)
                        return;
                    if (message.command === "removeVisible") {
                        const confirm = vscode.workspace.getConfiguration("devsnip").get("consoleLogCleanup.confirmBeforeDelete", true);
                        const files = new Set(selected.map(finding => finding.filePath)).size;
                        if (confirm && !(await (0, webview_ui_1.confirmAction)(`Remove ${selected.length} debug statement${selected.length === 1 ? "" : "s"} from ${files} file${files === 1 ? "" : "s"}?`, "Remove")))
                            return;
                    }
                    const result = await removeFindings(selected);
                    const parts = [`Removed ${result.removed} debug statement${result.removed === 1 ? "" : "s"}.`];
                    if (result.skipped)
                        parts.push(`${result.skipped} changed since the scan and were left alone.`);
                    if (result.unsaved)
                        parts.push(`${result.unsaved} file${result.unsaved === 1 ? " has" : "s have"} unsaved changes, so ${result.unsaved === 1 ? "it was" : "they were"} edited but not saved.`);
                    vscode.window.showInformationMessage(parts.join(" "));
                    findings = await scanWorkspace(folder);
                }
            }
            catch (error) {
                vscode.window.showErrorMessage(`Debug log cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
                busy = false;
                render();
            }
        });
        panel.onDidDispose(() => subscription.dispose());
    });
    context.subscriptions.push(command);
}
exports.registerListAndRemoveConsoleLogsCommand = registerListAndRemoveConsoleLogsCommand;
function pick(findings, indexes) {
    if (!Array.isArray(indexes))
        return [];
    const valid = new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < findings.length));
    return [...valid].map(index => findings[index]);
}
async function scanWorkspace(folder) {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SEARCH_PATTERN), EXCLUDE_PATTERN);
    // Unsaved editors are scanned as they are, so a removal matches what the user sees.
    const open = new Map(vscode.workspace.textDocuments.filter(document => document.isDirty).map(document => [document.uri.toString(), document]));
    const results = [];
    for (let index = 0; index < files.length; index += READ_BATCH_SIZE) {
        const batch = files.slice(index, index + READ_BATCH_SIZE);
        const scans = await Promise.all(batch.map(async (file) => {
            try {
                const document = open.get(file.toString());
                let text;
                if (document) {
                    text = document.getText();
                }
                else {
                    const bytes = await vscode.workspace.fs.readFile(file);
                    if (bytes.byteLength > MAX_FILE_BYTES)
                        return [];
                    text = Buffer.from(bytes).toString("utf8");
                }
                return (0, find_logs_1.findDebugStatementsInFile)(text, file.fsPath).map(statement => ({ ...statement, filePath: file.fsPath }));
            }
            catch (error) {
                console.error(`DevSnip Pro: could not scan ${file.fsPath}.`, error);
                return [];
            }
        }));
        results.push(...scans.flat());
    }
    return results.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.startOffset - b.startOffset);
}
async function removeFindings(selected) {
    const byFile = new Map();
    for (const finding of selected)
        byFile.set(finding.filePath, [...(byFile.get(finding.filePath) ?? []), finding]);
    const edit = new vscode.WorkspaceEdit();
    const toSave = [];
    let removed = 0, skipped = 0, unsaved = 0;
    for (const [filePath, statements] of byFile) {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
        const plan = (0, find_logs_1.planRemovals)(document.getText(), statements);
        skipped += plan.skipped.length;
        if (!plan.edits.length)
            continue;
        for (const change of plan.edits) {
            edit.replace(document.uri, new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text);
        }
        removed += plan.edits.length;
        // Never save someone's unrelated unsaved work along with the cleanup.
        if (document.isDirty)
            unsaved++;
        else
            toSave.push(document);
    }
    if (removed && !(await vscode.workspace.applyEdit(edit)))
        throw new Error("VS Code could not apply the edit.");
    await Promise.all(toSave.map(document => document.save()));
    return { removed, skipped, unsaved };
}
async function revealFinding(finding) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(finding.filePath));
    const start = document.positionAt(finding.startOffset);
    const end = document.positionAt(finding.endOffset);
    await vscode.window.showTextDocument(document, { selection: new vscode.Range(start, end), preview: false, viewColumn: vscode.ViewColumn.Beside });
}
function statusPage(message, scanning) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
    ${webview_ui_1.THEME_TOKENS}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:13px var(--font)}.card{width:min(520px,100%);padding:28px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.eyebrow{color:var(--accent);font-weight:700;letter-spacing:.1em;text-transform:uppercase;font-size:11px}h1{margin:8px 0;color:var(--text);font-size:24px}p{margin:0;color:var(--muted);line-height:1.5}.progress{height:4px;margin-top:24px;overflow:hidden;border-radius:10px;background:var(--panel-2)}.progress i{display:block;width:40%;height:100%;border-radius:inherit;background:var(--accent);animation:scan 1.3s ease-in-out infinite}@keyframes scan{0%{transform:translateX(-120%)}100%{transform:translateX(350%)}}@media (prefers-reduced-motion:reduce){.progress i{animation:none}}
  </style></head><body><section class="card"><div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Debug log cleaner</h1><p>${(0, webview_ui_1.escapeHtml)(message)}</p>${scanning ? '<div class="progress"><i></i></div>' : ""}</section></body></html>`;
}
function resultsPage(findings) {
    const nonce = (0, webview_ui_1.getNonce)();
    const fileCount = new Set(findings.map(finding => finding.filePath)).size;
    const removable = findings.filter(finding => finding.removable).length;
    const languages = [...new Set(findings.map(finding => finding.language))];
    const rows = findings.map((finding, index) => `<tr data-language="${finding.language}" data-removable="${finding.removable}">
      <td class="check">${finding.removable ? `<input class="row-check" type="checkbox" data-index="${index}" aria-label="Select line ${finding.line} of ${(0, webview_ui_1.escapeHtml)(path.basename(finding.filePath))}">` : ""}</td>
      <td class="file"><button class="link open" data-index="${index}" title="${(0, webview_ui_1.escapeHtml)(finding.filePath)}">${(0, webview_ui_1.escapeHtml)(vscode.workspace.asRelativePath(finding.filePath))}:${finding.line}</button></td>
      <td><span class="kind">${(0, webview_ui_1.escapeHtml)(finding.kind)}</span></td>
      <td><pre>${(0, webview_ui_1.escapeHtml)(finding.text)}</pre>${finding.reason ? `<small class="reason">Review by hand: ${(0, webview_ui_1.escapeHtml)(finding.reason)}</small>` : ""}</td>
      <td>${finding.removable ? `<button class="remove danger" data-index="${index}" type="button">Remove</button>` : `<button class="open" data-index="${index}" type="button">Open</button>`}</td></tr>`).join("");
    return `<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Debug Log Cleaner</title>
  <style>
    ${webview_ui_1.THEME_TOKENS}
    * { box-sizing:border-box; } body { margin:0; padding:32px clamp(18px,4vw,56px); background:var(--bg); color:var(--text); font:13px var(--font); }
    .shell { max-width:1280px; margin:auto; } .eyebrow { color:var(--accent); font-weight:700; letter-spacing:.11em; text-transform:uppercase; font-size:11px; }
    h1 { margin:8px 0 6px; font-size:clamp(25px,4vw,38px); letter-spacing:-.035em; } .intro { margin:0; color:var(--muted); max-width:760px; line-height:1.55; }
    .summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:26px 0 20px; } .stat,.toolbar,.table-wrap { background:color-mix(in srgb,var(--panel) 93%,transparent); border:1px solid var(--line); border-radius:12px; }
    .stat { padding:15px 17px; } .stat strong { display:block; font-size:25px; margin-bottom:3px; } .stat span { color:var(--muted); }
    .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:12px; margin-bottom:14px; } .search { flex:1; min-width:220px; }
    input[type=search],select { width:100%; padding:9px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel-2); color:var(--text); outline:none; font:inherit; } select { width:auto; }
    input:focus,select:focus { border-color:var(--focus); } label.toggle { display:flex; gap:6px; align-items:center; color:var(--muted); white-space:nowrap; }
    button { border:1px solid transparent; border-radius:8px; padding:9px 13px; color:var(--text); background:var(--panel-2); cursor:pointer; font-weight:650; font:inherit; } button:hover { border-color:var(--accent); } button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--accent); outline-offset:2px; } button:disabled { opacity:.5; cursor:not-allowed; }
    button.link { padding:0; background:none; border:0; color:var(--text); font-family:var(--mono); font-size:12px; text-align:left; } button.link:hover { color:var(--accent); text-decoration:underline; }
    .danger { color:var(--danger); } .danger:hover { border-color:var(--danger); } .table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; min-width:760px; } th,td { text-align:left; padding:12px 14px; border-bottom:1px solid var(--line); vertical-align:top; } th { color:var(--muted); font-size:11px; letter-spacing:.08em; text-transform:uppercase; background:var(--panel); position:sticky; top:0; } tbody tr:hover { background:var(--panel-2); } tbody tr:last-child td { border-bottom:0; }
    .kind { display:inline-block; padding:2px 8px; border-radius:999px; background:var(--panel-2); color:var(--muted); font:11px var(--mono); white-space:nowrap; }
    pre { margin:0; max-width:620px; white-space:pre-wrap; overflow-wrap:anywhere; color:var(--text); font:12px/1.5 var(--mono); } .reason { display:block; margin-top:6px; color:var(--warning, var(--muted)); }
    .check { width:42px; } input[type=checkbox] { width:15px; height:15px; accent-color:var(--accent); } .selected { background:var(--panel-2); }
    @media (max-width:650px) { body { padding:22px 14px; } .summary { grid-template-columns:1fr 1fr; } }
  </style>
</head><body><main class="shell">
  <div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Debug log cleaner</h1>
  <p class="intro">Debug output found in your code: <code>console.log</code>, <code>print</code>, <code>System.out.println</code>, <code>Console.WriteLine</code>, <code>debugPrint</code>, <code>Log.d</code>, <code>debugger</code> and more. Comments and strings are ignored. A statement is only removed when it stands on its own lines; one that shares a line or is the body of an <code>if</code> without braces is listed for you to review. <code>console.error</code>, <code>console.warn</code> and logger calls are never touched.</p>
  <section class="summary" aria-label="Scan summary">
    <div class="stat"><strong>${findings.length}</strong><span>statements found</span></div>
    <div class="stat"><strong>${removable}</strong><span>safe to remove</span></div>
    <div class="stat"><strong>${findings.length - removable}</strong><span>to review by hand</span></div>
    <div class="stat"><strong>${fileCount}</strong><span>files</span></div>
  </section>
  <div class="toolbar">
    <input id="search" class="search" type="search" placeholder="Filter by file, call or text…" aria-label="Filter">
    <select id="language" aria-label="Language"><option value="">All languages</option>${languages.map(language => `<option value="${language}">${(0, webview_ui_1.escapeHtml)(syntax_1.LANGUAGE_LABELS[language])}</option>`).join("")}</select>
    <label class="toggle"><input id="removableOnly" type="checkbox"> Safe to remove only</label>
    <span id="count" class="kind"></span>
    <button id="refresh" type="button">Refresh</button>
    <button id="removeSelected" class="danger" type="button" disabled>Remove selected</button>
    <button id="removeVisible" class="danger" type="button">Remove all shown</button>
  </div>
  <div class="table-wrap"><table><thead><tr><th class="check"><input id="selectAll" type="checkbox" aria-label="Select all shown"></th><th>Location</th><th>Call</th><th>Statement</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>
</main><script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const total = ${(0, webview_ui_1.embedJson)(findings.length)};
  const rows = [...document.querySelectorAll('tbody tr')];
  const checks = [...document.querySelectorAll('.row-check')];
  const search = document.getElementById('search'), language = document.getElementById('language'), removableOnly = document.getElementById('removableOnly');
  const selectAll = document.getElementById('selectAll'), removeSelected = document.getElementById('removeSelected'), removeVisible = document.getElementById('removeVisible'), count = document.getElementById('count');
  const state = vscode.getState() || {};
  search.value = state.search || ''; language.value = state.language || ''; removableOnly.checked = !!state.removableOnly;
  const visibleChecks = () => checks.filter(check => !check.closest('tr').hidden);
  const selected = () => checks.filter(check => check.checked && !check.closest('tr').hidden).map(check => Number(check.dataset.index));
  function update() {
    const n = selected().length, shown = visibleChecks();
    removeSelected.disabled = !n; removeSelected.textContent = n ? 'Remove selected (' + n + ')' : 'Remove selected';
    removeVisible.disabled = !shown.length; removeVisible.textContent = 'Remove all shown (' + shown.length + ')';
    selectAll.checked = shown.length > 0 && shown.every(check => check.checked); selectAll.indeterminate = shown.some(check => check.checked) && !selectAll.checked;
    checks.forEach(check => check.closest('tr').classList.toggle('selected', check.checked));
  }
  function filter() {
    const query = search.value.trim().toLowerCase(); let shown = 0;
    rows.forEach(row => { const match = (!query || row.textContent.toLowerCase().includes(query)) && (!language.value || row.dataset.language === language.value) && (!removableOnly.checked || row.dataset.removable === 'true'); row.hidden = !match; if (match) shown++; });
    count.textContent = shown + ' of ' + total + ' shown';
    vscode.setState({ search: search.value, language: language.value, removableOnly: removableOnly.checked });
    update();
  }
  [search, language, removableOnly].forEach(control => control.addEventListener('input', filter)); language.addEventListener('change', filter); removableOnly.addEventListener('change', filter); filter();
  checks.forEach(check => check.addEventListener('change', update));
  selectAll.addEventListener('change', () => { visibleChecks().forEach(check => { check.checked = selectAll.checked; }); update(); });
  removeSelected.addEventListener('click', () => { const indexes = selected(); if (indexes.length) vscode.postMessage({ command: 'remove', indexes }); });
  removeVisible.addEventListener('click', () => vscode.postMessage({ command: 'removeVisible', indexes: visibleChecks().map(check => Number(check.dataset.index)) }));
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));
  document.querySelectorAll('button.remove').forEach(button => button.addEventListener('click', () => { button.disabled = true; vscode.postMessage({ command: 'remove', indexes: [Number(button.dataset.index)] }); }));
  document.querySelectorAll('button.open').forEach(button => button.addEventListener('click', () => vscode.postMessage({ command: 'open', index: Number(button.dataset.index) })));
</script></body></html>`;
}
//# sourceMappingURL=listAndRemoveConsoleLogsCommand.js.map