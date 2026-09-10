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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRemoveUnusedImportsCommand = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const SEARCH_PATTERN = "**/*.{ts,tsx,js,jsx,mjs,cjs,java,py}";
const EXCLUDE_PATTERN = "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/coverage/**,**/out/**,**/.next/**,**/__pycache__/**,**/.venv/**}";
function nonce() { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"; return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); }
function escapeHtml(value) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function registerRemoveUnusedImportsCommand(context) {
    context.subscriptions.push(vscode.commands.registerCommand("sayaib.hue-console.removeUnusedImports", () => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const folder = (_a = vscode.workspace.workspaceFolders) === null || _a === void 0 ? void 0 : _a[0];
        if (!folder) {
            vscode.window.showErrorMessage("Open a workspace before checking imports.");
            return;
        }
        const panel = vscode.window.createWebviewPanel("removeUnusedImports", "Unused Import Cleaner", vscode.ViewColumn.One, { enableScripts: true });
        panel.iconPath = vscode.Uri.file(path.resolve(context.extensionPath, "logo.png"));
        panel.webview.html = loadingPage("Checking JavaScript, Java, and Python imports…");
        let imports = yield findUnusedImports(folder);
        const render = () => { panel.webview.html = imports.length ? resultsPage(imports) : loadingPage("No clearly unused whole import statements were found."); };
        render();
        let busy = false;
        panel.webview.onDidReceiveMessage((message) => __awaiter(this, void 0, void 0, function* () {
            if (busy)
                return;
            busy = true;
            try {
                if (message.command === "refreshImports")
                    imports = yield findUnusedImports(folder);
                if (message.command === "removeSelectedImports" || message.command === "removeAllImports") {
                    const indexes = message.command === "removeAllImports" ? imports.map((_, index) => index) : message.indexes;
                    const selected = selectImports(imports, indexes);
                    if (selected.length) {
                        yield removeImports(selected);
                        imports = yield findUnusedImports(folder);
                        vscode.window.showInformationMessage(`Removed ${selected.length} unused import statement${selected.length === 1 ? "" : "s"}.`);
                    }
                }
                render();
            }
            finally {
                busy = false;
            }
        }), undefined, context.subscriptions);
    })));
}
exports.registerRemoveUnusedImportsCommand = registerRemoveUnusedImportsCommand;
function selectImports(imports, indexes) {
    if (!Array.isArray(indexes))
        return [];
    const valid = new Set(indexes.filter((index) => Number.isInteger(index) && index >= 0 && index < imports.length));
    return [...valid].map(index => imports[index]);
}
function findUnusedImports(folder) {
    return __awaiter(this, void 0, void 0, function* () {
        const files = yield vscode.workspace.findFiles(new vscode.RelativePattern(folder, SEARCH_PATTERN), EXCLUDE_PATTERN);
        const scans = yield Promise.all(files.map((file) => __awaiter(this, void 0, void 0, function* () { try {
            return analyzeFileImports(yield fs.readFile(file.fsPath, "utf8"), file.fsPath);
        }
        catch (error) {
            console.error(`Unable to read ${file.fsPath}:`, error);
            return [];
        } })));
        return scans.flat();
    });
}
function analyzeFileImports(content, filePath) {
    const language = path.extname(filePath).toLowerCase();
    const lines = content.split(/\r?\n/);
    const candidates = lines.map((line, index) => ({ line, index, symbols: importedSymbols(line, language) })).filter(item => item.symbols.length);
    const masked = maskNonCode(lines.filter((_, index) => !candidates.some(candidate => candidate.index === index)).join("\n"), language);
    return candidates.filter(item => item.symbols.every(symbol => !new RegExp(`(^|[^\\w$])${escapeRegExp(symbol)}(?=$|[^\\w$])`).test(masked))).map(item => ({ filePath, lineNumber: item.index + 1, importStatement: item.line.trim(), importedSymbols: item.symbols }));
}
function importedSymbols(line, language) {
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(language))
        return javaScriptImports(line);
    if (language === ".java") {
        const match = line.match(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;\s*$/);
        const symbol = match === null || match === void 0 ? void 0 : match[1].split(".").pop();
        return symbol && !(match === null || match === void 0 ? void 0 : match[1].endsWith(".*")) ? [symbol] : [];
    }
    if (language === ".py")
        return pythonImports(line);
    return [];
}
function javaScriptImports(line) {
    const match = line.match(/^\s*import\s+(.+?)\s+from\s+['"][^'"]+['"]\s*;?\s*$/);
    if (!match)
        return [];
    const clause = match[1].replace(/^type\s+/, "").trim();
    const symbols = [];
    const named = clause.match(/\{([^}]*)\}/);
    if (named)
        named[1].split(",").forEach(part => addLocalSymbol(part, symbols));
    const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (namespace)
        symbols.push(namespace[1]);
    const defaultPart = clause.split(",")[0].trim();
    if (!defaultPart.startsWith("{") && !defaultPart.startsWith("*"))
        addLocalSymbol(defaultPart, symbols);
    return [...new Set(symbols)];
}
function pythonImports(line) {
    const from = line.match(/^\s*from\s+[\w.]+\s+import\s+(.+?)\s*(?:#.*)?$/);
    const plain = line.match(/^\s*import\s+(.+?)\s*(?:#.*)?$/);
    const parts = from ? (from[1].trim() === "*" ? [] : from[1].split(",")) : (plain ? plain[1].split(",") : []);
    return [...new Set(parts.map(part => { const trimmed = part.trim(); const alias = trimmed.match(/\s+as\s+([A-Za-z_][\w]*)$/); const local = alias ? alias[1] : trimmed.split(".")[0]; return /^[A-Za-z_][\w]*$/.test(local) ? local : undefined; }).filter((symbol) => Boolean(symbol)))];
}
function addLocalSymbol(value, symbols) { const local = value.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop(); if (local && /^[A-Za-z_$][\w$]*$/.test(local))
    symbols.push(local); }
function maskNonCode(content, language) { return content.replace(language === ".py" ? /#.*$/gm : /\/\/.*$|\/\*[\s\S]*?\*\//gm, " ").replace(/(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, " "); }
function removeImports(imports) {
    return __awaiter(this, void 0, void 0, function* () {
        const edit = new vscode.WorkspaceEdit();
        const documents = new Map();
        for (const item of imports) {
            const document = documents.get(item.filePath) || (yield vscode.workspace.openTextDocument(vscode.Uri.file(item.filePath)));
            documents.set(item.filePath, document);
            edit.delete(document.uri, document.lineAt(item.lineNumber - 1).rangeIncludingLineBreak);
        }
        if (!(yield vscode.workspace.applyEdit(edit)))
            throw new Error("VS Code could not apply the import cleanup.");
        yield Promise.all([...documents.values()].map(document => document.save()));
    });
}
function loadingPage(message) { return `<!doctype html><html><head><style>body{display:grid;min-height:100vh;place-items:center;margin:0;background:#0d1117;color:#e6edf3;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.card{max-width:460px;padding:30px;border:1px solid #2b3948;border-radius:14px;background:#161d26;box-shadow:0 18px 50px #0006}.eyebrow{color:#41d9c5;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:10px 0 8px;font-size:24px}p{margin:0;color:#8b9aaa;line-height:1.55}</style></head><body><main class="card"><div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Unused import cleaner</h1><p>${escapeHtml(message)}</p></main></body></html>`; }
function resultsPage(imports) {
    const id = nonce(), files = new Set(imports.map(item => item.filePath)).size;
    const rows = imports.map((item, index) => `<tr><td><input class="check" data-index="${index}" type="checkbox" aria-label="Select import"></td><td title="${escapeHtml(item.filePath)}">${escapeHtml(vscode.workspace.asRelativePath(item.filePath))}</td><td>${item.lineNumber}</td><td><code>${escapeHtml(item.importStatement)}</code><small>${escapeHtml(item.importedSymbols.join(", "))}</small></td></tr>`).join("");
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${id}'"><style>:root{color-scheme:dark}*{box-sizing:border-box}body{max-width:1180px;margin:0 auto;padding:30px 20px;background:#0d1117;color:#e6edf3;font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.eyebrow{color:#41d9c5;font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}h1{margin:8px 0;font-size:28px}.intro{margin:0 0 20px;color:#8b9aaa}.stats,.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.stat{min-width:130px;padding:12px 14px;border:1px solid #2b3948;border-radius:10px;background:#161d26}.stat strong{display:block;font-size:19px}.stat span,small{color:#8b9aaa}.toolbar{justify-content:flex-end;margin:18px 0}button{padding:8px 12px;border:1px solid #2b3948;border-radius:7px;background:#1d2732;color:#e6edf3;font-weight:600;cursor:pointer}button:hover{border-color:#41d9c5}button.danger{border-color:#823142;background:#48232c}button:disabled{opacity:.5;cursor:not-allowed}.table{overflow:auto;border:1px solid #2b3948;border-radius:10px}table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #24303c;vertical-align:top}th{color:#8b9aaa;font-size:11px;text-transform:uppercase;letter-spacing:.07em}tr:last-child td{border:0}code{display:block;white-space:pre-wrap;color:#d2b98c;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}small{display:block;margin-top:5px}input{accent-color:#41d9c5}</style></head><body><div class="eyebrow">DevSnip Pro · Workspace hygiene</div><h1>Unused import cleaner</h1><p class="intro">Only whole import statements that are not referenced outside their own import line are listed. Review before removal.</p><section class="stats"><div class="stat"><strong>${imports.length}</strong><span>imports found</span></div><div class="stat"><strong>${files}</strong><span>files affected</span></div><div class="stat"><strong>JS · Java · Python</strong><span>languages scanned</span></div></section><div class="toolbar"><button id="refresh">Refresh</button><button id="remove" class="danger" disabled>Remove selected</button><button id="all" class="danger">Remove all</button></div><div class="table"><table><thead><tr><th><input id="selectAll" type="checkbox" aria-label="Select all"></th><th>File</th><th>Line</th><th>Import statement <small>symbols considered unused</small></th></tr></thead><tbody>${rows}</tbody></table></div><script nonce="${id}">const vscode=acquireVsCodeApi(),checks=[...document.querySelectorAll('.check')],remove=document.querySelector('#remove'),selectAll=document.querySelector('#selectAll');function selected(){return checks.filter(c=>c.checked).map(c=>Number(c.dataset.index))}function update(){const n=selected().length;remove.disabled=!n;remove.textContent=n?'Remove selected ('+n+')':'Remove selected';selectAll.checked=checks.length>0&&checks.every(c=>c.checked);selectAll.indeterminate=checks.some(c=>c.checked)&&!selectAll.checked}checks.forEach(c=>c.addEventListener('change',update));selectAll.addEventListener('change',()=>{checks.forEach(c=>c.checked=selectAll.checked);update()});remove.addEventListener('click',()=>vscode.postMessage({command:'removeSelectedImports',indexes:selected()}));document.querySelector('#all').addEventListener('click',()=>{if(confirm('Remove all listed imports?'))vscode.postMessage({command:'removeAllImports'})});document.querySelector('#refresh').addEventListener('click',()=>vscode.postMessage({command:'refreshImports'}));</script></body></html>`;
}
//# sourceMappingURL=removeUnusedImportsCommand.js.map