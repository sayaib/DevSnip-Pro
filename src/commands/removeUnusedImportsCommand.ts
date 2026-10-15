import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import * as path from "path";
import { THEME_TOKENS, confirmAction, escapeHtml, getNonce, openToolPanel } from "../utils/webview-ui";
import { setWebviewHtml } from "../theme/service";

interface UnusedImport { filePath: string; lineNumber: number; /** Last line of a multi-line import (1-based). */ endLineNumber: number; importStatement: string; importedSymbols: string[]; }

const SEARCH_PATTERN = "**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,java,kt,kts,py}";
const READ_BATCH_SIZE = 40;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const EXCLUDE_PATTERN = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/out/**,**/.next/**,**/__pycache__/**,**/.venv/**,**/venv/**,**/site-packages/**,**/target/**,**/.gradle/**,**/*.d.ts}";

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function registerRemoveUnusedImportsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerTrackedCommand("sayaib.hue-console.removeUnusedImports", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { vscode.window.showErrorMessage("Open a workspace before checking imports."); return; }
    const { panel, created } = openToolPanel("removeUnusedImports", "Unused Import Cleaner", { enableScripts: true });
    if (!created) return;
    panel.iconPath = vscode.Uri.file(path.resolve(context.extensionPath, "logo.png"));
    setWebviewHtml(panel.webview, loadingPage("Checking JavaScript, TypeScript, Java, Kotlin and Python imports…"));
    let imports = await findUnusedImports(folder);
    const render = () => { setWebviewHtml(panel.webview, imports.length ? resultsPage(imports) : loadingPage("No clearly unused whole import statements were found.")); };
    render();
    let busy = false;
    const messageSubscription = panel.webview.onDidReceiveMessage(async (message: { command?: string; indexes?: unknown }) => {
      if (busy) return;
      busy = true;
      try {
        if (message?.command === "refreshImports") imports = await findUnusedImports(folder);
        if (message?.command === "removeSelectedImports" || message?.command === "removeAllImports") {
          if (message.command === "removeAllImports") {
            // confirm() is blocked inside the webview sandbox: confirm natively.
            if (!(await confirmAction(`Remove all ${imports.length} unused import statement(s)?`, "Remove all"))) return;
          }
          const indexes = message.command === "removeAllImports" ? imports.map((_, index) => index) : message.indexes;
          const selected = selectImports(imports, indexes);
          if (selected.length) {
            await removeImports(selected);
            imports = await findUnusedImports(folder);
            vscode.window.showInformationMessage(`Removed ${selected.length} unused import statement${selected.length === 1 ? "" : "s"}.`);
          }
        }
        render();
      } catch (error) {
        vscode.window.showErrorMessage(`Unused import cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        render();
      } finally { busy = false; }
    });
    panel.onDidDispose(() => messageSubscription.dispose());
  }));
}

function selectImports(imports: UnusedImport[], indexes: unknown): UnusedImport[] {
  if (!Array.isArray(indexes)) return [];
  const valid = new Set(indexes.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < imports.length));
  return [...valid].map(index => imports[index]);
}

async function findUnusedImports(folder: vscode.WorkspaceFolder): Promise<UnusedImport[]> {
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, SEARCH_PATTERN), EXCLUDE_PATTERN);
  const results: UnusedImport[] = [];
  // Read in batches: a large workspace would otherwise open thousands of file
  // handles at once and exhaust the process limit.
  for (let index = 0; index < files.length; index += READ_BATCH_SIZE) {
    const batch = files.slice(index, index + READ_BATCH_SIZE);
    const scans = await Promise.all(batch.map(async file => {
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        if (bytes.byteLength > MAX_FILE_BYTES) return [];
        return analyzeFileImports(Buffer.from(bytes).toString("utf8"), file.fsPath);
      } catch (error) {
        console.error(`Unable to read ${file.fsPath}:`, error);
        return [];
      }
    }));
    results.push(...scans.flat());
  }
  return results;
}

export function analyzeFileImports(content: string, filePath: string): UnusedImport[] {
  const language = path.extname(filePath).toLowerCase();
  // A package's __init__.py imports names to re-export them; they are its API, not dead code.
  if (path.basename(filePath) === "__init__.py") return [];
  const lines = content.split(/\r?\n/);
  const candidates: Array<{ index: number; end: number; text: string; symbols: string[] }> = [];
  for (let index = 0; index < lines.length; index++) {
    let end = index;
    let text = lines[index];
    // import {\n  a,\n  b,\n} from "x"; spans lines: join it first.
    if (JS_EXTENSIONS.includes(language) && /^\s*import\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{[^}]*$/.test(text)) {
      while (end + 1 < lines.length && end - index < 200 && !/\}/.test(lines[end])) end++;
      text = lines.slice(index, end + 1).map(line => line.trim()).join(" ");
    }
    const symbols = importedSymbols(text, language);
    if (symbols.length) candidates.push({ index, end, text: text.trim(), symbols });
    index = end;
  }
  const inImport = new Set(candidates.flatMap(candidate => Array.from({ length: candidate.end - candidate.index + 1 }, (_, offset) => candidate.index + offset)));
  const rest = lines.filter((_, index) => !inImport.has(index)).join("\n");
  const masked = maskNonCode(rest, language);
  const keep = keptSymbols(rest, language);
  return candidates
    .filter(item => item.symbols.every(symbol => !keep.has(symbol) && !new RegExp(`(^|[^\\w$])${escapeRegExp(symbol)}(?=$|[^\\w$])`).test(masked)))
    .map(item => ({ filePath, lineNumber: item.index + 1, endLineNumber: item.end + 1, importStatement: item.text, importedSymbols: item.symbols }));
}

const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
/**
 * Kotlin calls these operator and delegate functions implicitly (`by remember { }`
 * needs getValue, `a[i]` needs get), so their imports are used without being named.
 */
const KOTLIN_IMPLICIT = new Set(["getValue", "setValue", "provideDelegate", "get", "set", "invoke", "contains", "iterator", "next", "hasNext", "compareTo", "equals", "plus", "minus", "times", "div", "rem", "mod", "rangeTo", "rangeUntil", "unaryPlus", "unaryMinus", "not", "inc", "dec", "plusAssign", "minusAssign", "timesAssign", "divAssign", "remAssign", "component1", "component2", "component3", "component4", "component5"]);

/** Names that count as used even though no code mentions them. */
function keptSymbols(code: string, language: string): Set<string> {
  const keep = new Set<string>();
  if (language === ".py") {
    // Names listed in __all__ are re-exported on purpose.
    const all = /__all__\s*(?::[^=]*)?=\s*[[(]([^\])]*)[\])]/.exec(code);
    if (all) for (const name of all[1].matchAll(/["']([A-Za-z_]\w*)["']/g)) keep.add(name[1]);
  }
  // With the classic JSX runtime every JSX element compiles to React.createElement.
  if (JS_EXTENSIONS.includes(language) && /<\/[\w.]*>|\/>/.test(code)) keep.add("React");
  if (language === ".kt" || language === ".kts") KOTLIN_IMPLICIT.forEach(name => keep.add(name));
  return keep;
}

function importedSymbols(line: string, language: string): string[] {
  if (JS_EXTENSIONS.includes(language)) return javaScriptImports(line);
  if (language === ".java") { const match = line.match(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;\s*$/); const symbol = match?.[1].split(".").pop(); return symbol && !match?.[1].endsWith(".*") ? [symbol] : []; }
  if (language === ".kt" || language === ".kts") { const match = line.match(/^\s*import\s+([\w.`]+?)(?:\s+as\s+([\w`]+))?\s*;?\s*$/); if (!match || match[1].endsWith(".*")) return []; const symbol = (match[2] ?? match[1].split(".").pop() ?? "").replace(/`/g, ""); return /^[A-Za-z_]\w*$/.test(symbol) ? [symbol] : []; }
  if (language === ".py") return pythonImports(line);
  return [];
}
function javaScriptImports(line: string): string[] {
  const match = line.match(/^\s*import\s+(.+?)\s+from\s+['"][^'"]+['"]\s*;?\s*$/); if (!match) return [];
  const clause = match[1].replace(/^type\s+/, "").trim(); const symbols: string[] = [];
  const named = clause.match(/\{([^}]*)\}/); if (named) named[1].split(",").forEach(part => addLocalSymbol(part, symbols));
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/); if (namespace) symbols.push(namespace[1]);
  const defaultPart = clause.split(",")[0].trim(); if (!defaultPart.startsWith("{") && !defaultPart.startsWith("*")) addLocalSymbol(defaultPart, symbols);
  return [...new Set(symbols)];
}
function pythonImports(line: string): string[] {
  // `from __future__ import annotations` changes how the module compiles; it is never unused.
  if (/^\s*from\s+__future__\s+import\b/.test(line)) return [];
  const from = line.match(/^\s*from\s+[\w.]+\s+import\s+(.+?)\s*(?:#.*)?$/); const plain = line.match(/^\s*import\s+(.+?)\s*(?:#.*)?$/); const parts = from ? (from[1].trim() === "*" || from[1].trim().startsWith("(") ? [] : from[1].split(",")) : (plain ? plain[1].split(",") : []);
  return [...new Set(parts.map(part => { const trimmed = part.trim(); const alias = trimmed.match(/\s+as\s+([A-Za-z_][\w]*)$/); const local = alias ? alias[1] : trimmed.split(".")[0]; return /^[A-Za-z_][\w]*$/.test(local) ? local : undefined; }).filter((symbol): symbol is string => Boolean(symbol)))];
}
function addLocalSymbol(value: string, symbols: string[]): void { const local = value.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop(); if (local && /^[A-Za-z_$][\w$]*$/.test(local)) symbols.push(local); }
/**
 * Blanks out comments and string text, in one pass so a "//" inside a URL
 * string is not taken for a comment. Interpolated code stays: `${format(x)}`,
 * Kotlin "$name" and Python f"{name}" all use the names they mention.
 */
function maskNonCode(content: string, language: string): string {
  const python = language === ".py";
  const kotlin = language === ".kt" || language === ".kts";
  const pattern = python
    ? /#[^\n]*|([A-Za-z]{0,2})("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/g
    : /\/\/[^\n]*|\/\*[\s\S]*?\*\/|()("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)/g;
  return content.replace(pattern, (_whole: string, prefix: string | undefined, literal: string | undefined) => {
    if (literal === undefined) return " ";
    const kept: string[] = [];
    if (literal.startsWith("`") || kotlin) for (const m of literal.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) kept.push(m[1]);
    if (kotlin) for (const m of literal.matchAll(/\$([A-Za-z_]\w*)/g)) kept.push(m[1]);
    if (python && /f/i.test(prefix ?? "")) for (const m of literal.replace(/\{\{|\}\}/g, "").matchAll(/\{([^{}]*)\}/g)) kept.push(m[1]);
    return ` ${prefix ?? ""} ${kept.join(" ")} `;
  });
}

async function removeImports(imports: UnusedImport[]): Promise<void> {
  const edit = new vscode.WorkspaceEdit(); const documents = new Map<string, vscode.TextDocument>();
  for (const item of imports) {
    const document = documents.get(item.filePath) || await vscode.workspace.openTextDocument(vscode.Uri.file(item.filePath));
    documents.set(item.filePath, document);
    const start = document.lineAt(item.lineNumber - 1).range.start;
    const end = document.lineAt(Math.min(item.endLineNumber, document.lineCount) - 1).rangeIncludingLineBreak.end;
    edit.delete(document.uri, new vscode.Range(start, end));
  }
  if (!await vscode.workspace.applyEdit(edit)) throw new Error("VS Code could not apply the import cleanup.");
  await Promise.all([...documents.values()].map(document => document.save()));
}

function loadingPage(message: string): string { return `<!doctype html><html><head><style>${THEME_TOKENS}body{display:grid;min-height:100vh;place-items:center;margin:0;background:var(--bg);color:var(--text);font:14px var(--font)}.card{max-width:460px;padding:30px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}.eyebrow{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:10px 0 8px;font-size:24px}p{margin:0;color:var(--muted);line-height:1.55}</style></head><body><main class="card"><div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Unused import cleaner</h1><p>${escapeHtml(message)}</p></main></body></html>`; }
function resultsPage(imports: UnusedImport[]): string {
  const id = getNonce(), files = new Set(imports.map(item => item.filePath)).size;
  const rows = imports.map((item, index) => `<tr><td><input class="check" data-index="${index}" type="checkbox" aria-label="Select import"></td><td title="${escapeHtml(item.filePath)}">${escapeHtml(vscode.workspace.asRelativePath(item.filePath))}</td><td>${item.lineNumber}</td><td><code>${escapeHtml(item.importStatement)}</code><small>${escapeHtml(item.importedSymbols.join(", "))}</small></td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${id}'"><style>${THEME_TOKENS}*{box-sizing:border-box}body{max-width:1180px;margin:0 auto;padding:30px 20px;background:var(--bg);color:var(--text);font:13px var(--font)}.eyebrow{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}h1{margin:8px 0;font-size:28px}.intro{margin:0 0 20px;color:var(--muted)}.stats,.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.stat{min-width:130px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.stat strong{display:block;font-size:19px}.stat span,small{color:var(--muted)}.toolbar{justify-content:flex-end;margin:18px 0}button{padding:8px 12px;border:1px solid var(--line);border-radius:7px;background:var(--panel-2);color:var(--text);font-weight:600;cursor:pointer}button:hover{border-color:var(--focus)}button.danger{color:var(--danger)}button:disabled{opacity:.5;cursor:not-allowed}button:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.table{overflow:auto;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.07em}tr:last-child td{border:0}code{display:block;white-space:pre-wrap;color:var(--text);font-family:var(--mono)}small{display:block;margin-top:5px}input{accent-color:var(--accent)}</style></head><body><div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Unused import cleaner</h1><p class="intro">Only whole import statements that are not referenced outside their own import line are listed. Review before removal.</p><section class="stats"><div class="stat"><strong>${imports.length}</strong><span>imports found</span></div><div class="stat"><strong>${files}</strong><span>files affected</span></div><div class="stat"><strong>JS/TS · Java · Kotlin · Python</strong><span>languages scanned</span></div></section><div class="toolbar"><button id="refresh">Refresh</button><button id="remove" class="danger" disabled>Remove selected</button><button id="all" class="danger">Remove all</button></div><div class="table"><table><thead><tr><th><input id="selectAll" type="checkbox" aria-label="Select all"></th><th>File</th><th>Line</th><th>Import statement <small>symbols considered unused</small></th></tr></thead><tbody>${rows}</tbody></table></div><script nonce="${id}">const vscode=acquireVsCodeApi(),checks=[...document.querySelectorAll('.check')],remove=document.querySelector('#remove'),selectAll=document.querySelector('#selectAll');function selected(){return checks.filter(c=>c.checked).map(c=>Number(c.dataset.index))}function update(){const n=selected().length;remove.disabled=!n;remove.textContent=n?'Remove selected ('+n+')':'Remove selected';selectAll.checked=checks.length>0&&checks.every(c=>c.checked);selectAll.indeterminate=checks.some(c=>c.checked)&&!selectAll.checked}checks.forEach(c=>c.addEventListener('change',update));selectAll.addEventListener('change',()=>{checks.forEach(c=>c.checked=selectAll.checked);update()});remove.addEventListener('click',()=>vscode.postMessage({command:'removeSelectedImports',indexes:selected()}));document.querySelector('#all').addEventListener('click',()=>vscode.postMessage({command:'removeAllImports'}));document.querySelector('#refresh').addEventListener('click',()=>vscode.postMessage({command:'refreshImports'}));</script></body></html>`;
}
