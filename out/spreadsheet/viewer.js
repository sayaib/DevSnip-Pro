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
exports.openSpreadsheetViewer = exports.openWithViewer = exports.createEditorProvider = exports.SpreadsheetDocument = exports.CSV_VIEW_TYPE = exports.EXCEL_VIEW_TYPE = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const edit_1 = require("./edit");
const load_1 = require("./load");
const page_1 = require("./page");
const types_1 = require("./types");
const webview_ui_1 = require("../utils/webview-ui");
const service_1 = require("../theme/service");
const analytics_1 = require("../analytics");
/** The custom editors in package.json: Excel workbooks open in the viewer by default, CSV files on request. */
exports.EXCEL_VIEW_TYPE = "devsnip.spreadsheetViewer";
exports.CSV_VIEW_TYPE = "devsnip.csvViewer";
const WELCOME_VIEW_TYPE = "devsnip.spreadsheetWelcome";
const RECENT_KEY = "devsnip.spreadsheet.recent";
const MAX_RECENT = 8;
/**
 * A spreadsheet file opened in the custom editor. It owns the parsed data and
 * the edits, so VS Code can save, revert, back up (hot exit) and undo them
 * like any other editor; the page only mirrors it.
 */
class SpreadsheetDocument {
    constructor(uri, events) {
        this.uri = uri;
        this.events = events;
        /** mtime of the file as last read or written, to tell our own writes and outside changes apart. */
        this.mtime = 0;
        /** Ids of the edits currently applied, oldest first; compared with savedTop for the dirty state. */
        this.applied = [];
        this.savedTop = 0;
        this.nextId = 1;
        this.sessions = new Set();
    }
    static async open(uri, events, backupId) {
        const doc = new SpreadsheetDocument(uri, events);
        if (backupId) {
            // Restored after a restart with unsaved edits: the backup holds the edited file.
            await doc.read(vscode.Uri.parse(backupId));
            doc.savedTop = -1;
            try {
                doc.mtime = (await vscode.workspace.fs.stat(uri)).mtime;
            }
            catch {
                doc.mtime = 0;
            }
        }
        else {
            await doc.read(uri);
        }
        doc.watch();
        return doc;
    }
    get name() {
        return path.posix.basename(this.uri.path);
    }
    get format() {
        return (0, types_1.formatOf)(this.name) ?? "csv";
    }
    get dirty() {
        return (this.applied[this.applied.length - 1] ?? 0) !== this.savedTop;
    }
    editState() {
        if (vscode.workspace.fs.isWritableFileSystem(this.uri.scheme) === false)
            return { editable: false, readOnlyReason: "This file is on a read-only file system.", dirty: this.dirty };
        if (this.format !== "xlsx" && this.loaded.sheet(0).truncatedRows)
            return { editable: false, readOnlyReason: "This file is too large to edit here: only part of it was loaded.", dirty: this.dirty };
        return { editable: true, dirty: this.dirty };
    }
    summary() {
        return { ...this.loaded.summary, ...this.editState() };
    }
    async read(from) {
        const stat = await vscode.workspace.fs.stat(from);
        if (stat.size > types_1.MAX_FILE_BYTES) {
            throw new types_1.SpreadsheetError(`${this.name} is ${Math.round(stat.size / 1024 / 1024)} MB; the viewer opens files up to ${types_1.MAX_FILE_BYTES / 1024 / 1024} MB.`, "Split it, or open it as text.");
        }
        const bytes = await vscode.workspace.fs.readFile(from);
        const loaded = (0, load_1.loadSpreadsheet)(bytes, this.name, this.format, this.delimiter);
        this.loaded = loaded;
        this.editor = new edit_1.WorkbookEditor({ sheet: i => loaded.sheet(i), type: loaded.type, structureLock: () => loaded.structureLock() });
        if (from.toString() === this.uri.toString())
            this.mtime = stat.mtime;
    }
    /** Re-reads the file, dropping unsaved edits (VS Code's Revert, or a change on disk). */
    async reload() {
        await this.read(this.uri);
        this.applied = [];
        this.savedTop = 0;
        this.broadcast({ type: "reset" });
    }
    async setDelimiter(delimiter) {
        if (this.dirty)
            throw new types_1.SpreadsheetError("Save or undo your edits before changing the separator.");
        this.delimiter = delimiter;
        await this.read(this.uri);
        return this.summary();
    }
    attach(session) {
        this.sessions.add(session);
        return { dispose: () => this.sessions.delete(session) };
    }
    broadcast(message) {
        for (const session of this.sessions)
            session.post(message);
    }
    /** Records an applied edit and puts it on VS Code's undo stack. */
    push(edit) {
        const id = this.nextId++;
        this.applied.push(id);
        this.publish(edit.patch);
        this.events.fire({
            document: this,
            label: edit.label,
            undo: () => {
                const patch = edit.undo();
                const at = this.applied.lastIndexOf(id);
                if (at !== -1)
                    this.applied.splice(at, 1);
                this.publish(patch);
            },
            redo: () => {
                const patch = edit.redo();
                this.applied.push(id);
                this.publish(patch);
            }
        });
    }
    publish(patch) {
        this.broadcast({ type: "patch", patch });
        this.broadcast({ type: "dirty", dirty: this.dirty });
    }
    async save(target = this.uri, cancellation) {
        const { bytes, note } = this.loaded.serialize(this.editor);
        if (cancellation?.isCancellationRequested)
            return;
        const own = target.toString() === this.uri.toString();
        if (own) {
            let current;
            try {
                current = (await vscode.workspace.fs.stat(target)).mtime;
            }
            catch {
                current = undefined;
            }
            if (current !== undefined && this.mtime && current !== this.mtime) {
                const choice = await vscode.window.showWarningMessage(`${this.name} was changed on disk after you opened it.`, { modal: true, detail: "Saving replaces those changes with the sheet as it is here." }, "Overwrite");
                if (choice !== "Overwrite")
                    throw new Error(`Save cancelled: ${this.name} changed on disk. Revert the file to load the new version.`);
            }
        }
        await vscode.workspace.fs.writeFile(target, bytes);
        if (own) {
            this.mtime = (await vscode.workspace.fs.stat(target)).mtime;
            this.savedTop = this.applied[this.applied.length - 1] ?? 0;
            this.broadcast({ type: "dirty", dirty: this.dirty });
        }
        if (note)
            void vscode.window.showInformationMessage(`${this.name}: ${note}`);
    }
    async backup(destination) {
        await vscode.workspace.fs.writeFile(destination, this.loaded.serialize(this.editor).bytes);
        return {
            id: destination.toString(),
            delete: async () => { try {
                await vscode.workspace.fs.delete(destination);
            }
            catch { /* already gone */ } }
        };
    }
    /** Reloads when the file changes on disk; with unsaved edits it only warns. */
    watch() {
        const folder = vscode.Uri.joinPath(this.uri, "..");
        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, path.posix.basename(this.uri.path)), true, false, true);
        this.watcher.onDidChange(() => {
            clearTimeout(this.timer);
            this.timer = setTimeout(async () => {
                let mtime;
                try {
                    mtime = (await vscode.workspace.fs.stat(this.uri)).mtime;
                }
                catch {
                    return;
                }
                if (mtime === this.mtime)
                    return;
                if (this.dirty) {
                    this.broadcast({ type: "changedOnDisk" });
                    return;
                }
                try {
                    await this.reload();
                    this.broadcast({ type: "changed" });
                }
                catch { /* a half-written file: the next change event retries */ }
            }, 300);
        });
    }
    dispose() {
        clearTimeout(this.timer);
        this.watcher?.dispose();
        this.sessions.clear();
    }
}
exports.SpreadsheetDocument = SpreadsheetDocument;
/**
 * One open page: a file in the custom editor (backed by a SpreadsheetDocument),
 * or the welcome panel (open a file, recent files, or paste CSV text). The page
 * asks for what it needs over a small RPC; everything it sends is validated here.
 */
class ViewerSession {
    constructor(context, panel, doc) {
        this.context = context;
        this.panel = panel;
        this.doc = doc;
        this.tracked = false;
    }
    post(message) {
        (0, webview_ui_1.safePostMessage)(this.panel, message);
    }
    async handle(method, params) {
        const doc = this.doc;
        switch (method) {
            case "init":
                if (doc) {
                    this.trackOpen(doc);
                    return { file: doc.summary(), source: "file" };
                }
                return { file: this.pastedSummary(), recent: this.recent(), source: "welcome" };
            case "reload":
                return doc ? doc.summary() : this.pastedSummary();
            case "revert":
                if (!doc)
                    return undefined;
                if (doc.dirty) {
                    const choice = await vscode.window.showWarningMessage(`Discard your unsaved edits to ${doc.name}?`, { modal: true }, "Discard");
                    if (choice !== "Discard")
                        return undefined;
                    // Through VS Code, so its dirty state and undo stack are reset too.
                    await vscode.commands.executeCommand("workbench.action.files.revert");
                }
                else {
                    await doc.reload();
                }
                return doc.summary();
            case "sheet": {
                const loaded = doc ? doc.loaded : this.pasted;
                if (!loaded)
                    throw new types_1.SpreadsheetError("Open a file first.");
                const index = Number(params.index);
                if (!Number.isInteger(index) || index < 0 || index >= loaded.summary.sheets.length)
                    throw new types_1.SpreadsheetError("That sheet doesn't exist.");
                return loaded.sheet(index);
            }
            case "setDelimiter": {
                const delimiter = String(params.delimiter ?? "");
                if (delimiter && ![",", ";", "\t", "|"].includes(delimiter))
                    throw new types_1.SpreadsheetError("Pick comma, semicolon, tab or pipe.");
                if (doc)
                    return doc.setDelimiter(delimiter || undefined);
                this.delimiter = delimiter || undefined;
                if (typeof params.text === "string")
                    return this.paste(params.text);
                return this.pastedSummary();
            }
            case "edit":
                this.edit(params);
                return undefined;
            case "structureLock":
                return doc ? doc.loaded.structureLock() ?? null : null;
            case "saveFile":
                if (doc)
                    await vscode.commands.executeCommand("workbench.action.files.save");
                return doc?.dirty ?? false;
            case "undo":
            case "redo":
                if (doc)
                    await vscode.commands.executeCommand(method);
                return undefined;
            case "paste":
                return this.paste(String(params.text ?? ""));
            case "clearPaste":
                this.pasted = undefined;
                return undefined;
            case "open":
                return pickAndOpen(params.format === "xlsx" ? "xlsx" : "csv");
            case "openRecent": {
                const entry = this.recent().find(r => r.uri === params.uri);
                if (!entry)
                    throw new types_1.SpreadsheetError("That file is no longer in the recent list.");
                const uri = vscode.Uri.parse(entry.uri);
                try {
                    await vscode.workspace.fs.stat(uri);
                }
                catch {
                    await this.forget(entry.uri);
                    throw new types_1.SpreadsheetError(`${entry.name} was moved or deleted.`, "It has been removed from the recent list.");
                }
                return openWithViewer(uri);
            }
            case "forgetRecent":
                await this.forget(String(params.uri ?? ""));
                return this.recent();
            case "copy":
                await vscode.env.clipboard.writeText(String(params.text ?? ""));
                return undefined;
            case "openDocument": {
                const language = ["json", "csv", "markdown", "plaintext"].includes(String(params.language)) ? String(params.language) : "plaintext";
                const text = await vscode.workspace.openTextDocument({ content: String(params.content ?? ""), language });
                await vscode.window.showTextDocument(text, { preview: false, viewColumn: vscode.ViewColumn.Beside });
                return undefined;
            }
            case "save":
                return this.export(String(params.content ?? ""), String(params.name ?? "export.csv"));
            case "reopenAsText":
                if (doc)
                    await vscode.commands.executeCommand("vscode.openWith", doc.uri, "default");
                return undefined;
            default:
                throw new types_1.SpreadsheetError("Unknown request.");
        }
    }
    edit(params) {
        const doc = this.doc;
        if (!doc)
            throw new types_1.SpreadsheetError("Pasted data can't be edited; export it to a file first.");
        const state = doc.editState();
        if (!state.editable)
            throw new types_1.SpreadsheetError(state.readOnlyReason ?? "This file can't be edited.");
        const sheet = Number(params.sheet);
        if (!Number.isInteger(sheet) || sheet < 0 || sheet >= doc.loaded.summary.sheets.length)
            throw new types_1.SpreadsheetError("That sheet doesn't exist.");
        const numbers = (value) => (Array.isArray(value) ? value.map(Number) : []);
        const editor = doc.editor;
        let edit;
        switch (params.kind) {
            case "set": {
                const cells = Array.isArray(params.cells) ? params.cells : [];
                edit = editor.set(sheet, cells.map(cell => {
                    const c = (cell ?? {});
                    return { r: Number(c.r), c: Number(c.c), text: String(c.text ?? "") };
                }));
                break;
            }
            case "insertRows":
                edit = editor.insertRows(sheet, Number(params.at), Number(params.count ?? 1));
                break;
            case "deleteRows":
                edit = editor.deleteRows(sheet, numbers(params.rows));
                break;
            case "insertColumns": {
                const names = Array.isArray(params.names) && params.names.every(n => typeof n === "string" && n.length <= 32767) ? params.names : undefined;
                edit = editor.insertColumns(sheet, Number(params.at), Number(params.count ?? 1), names);
                break;
            }
            case "deleteColumns":
                edit = editor.deleteColumns(sheet, numbers(params.cols));
                break;
            default: throw new types_1.SpreadsheetError("Unknown edit.");
        }
        if (edit)
            doc.push(edit);
    }
    trackOpen(doc) {
        if (this.tracked)
            return;
        this.tracked = true;
        (0, analytics_1.trackToolUsed)(doc.format === "xlsx" ? "excelViewer" : "csvViewer");
        void this.remember(doc.uri, doc.name, doc.format);
    }
    pastedSummary() {
        return this.pasted ? { ...this.pasted.summary, editable: false, readOnlyReason: "Pasted data can't be edited; export it to a file first.", dirty: false } : undefined;
    }
    paste(text) {
        if (!text.trim())
            throw new types_1.SpreadsheetError("Paste some CSV or TSV text first.");
        this.pasted = (0, load_1.loadText)(text, "Pasted data", "csv", this.delimiter);
        if (!this.tracked) {
            this.tracked = true;
            (0, analytics_1.trackToolUsed)("csvViewer");
        }
        return this.pastedSummary();
    }
    async export(content, name) {
        const safeName = path.basename(name).replace(/[\\/:*?"<>|]/g, "_") || "export.csv";
        const uri = this.doc?.uri;
        const folder = uri && uri.scheme === "file" ? vscode.Uri.file(path.dirname(uri.fsPath)) : vscode.workspace.workspaceFolders?.[0]?.uri;
        const ext = path.extname(safeName).slice(1).toLowerCase();
        const target = await vscode.window.showSaveDialog({
            defaultUri: folder ? vscode.Uri.joinPath(folder, safeName) : undefined,
            saveLabel: "Export",
            filters: ext === "json" ? { JSON: ["json"] } : ext === "md" ? { Markdown: ["md"] } : ext === "tsv" ? { TSV: ["tsv"] } : { CSV: ["csv"] }
        });
        if (!target)
            return { saved: false };
        if (uri && target.toString() === uri.toString())
            throw new types_1.SpreadsheetError("Choose a different file name; use Save to write the file you are editing.");
        // A byte-order mark makes Excel read UTF-8 CSV correctly.
        const bom = ext === "csv" || ext === "tsv" ? "﻿" : "";
        await vscode.workspace.fs.writeFile(target, Buffer.from(bom + content, "utf8"));
        return { saved: true, name: path.posix.basename(target.path) };
    }
    recent() {
        const list = this.context.globalState.get(RECENT_KEY, []);
        return Array.isArray(list) ? list.filter(r => r && typeof r.uri === "string" && typeof r.name === "string").slice(0, MAX_RECENT) : [];
    }
    async remember(uri, name, format) {
        const folder = uri.scheme === "file" ? path.basename(path.dirname(uri.fsPath)) : uri.authority || uri.scheme;
        const entry = { uri: uri.toString(), name, folder, format, at: Date.now() };
        await this.context.globalState.update(RECENT_KEY, [entry, ...this.recent().filter(r => r.uri !== entry.uri)].slice(0, MAX_RECENT));
    }
    async forget(uri) {
        await this.context.globalState.update(RECENT_KEY, this.recent().filter(r => r.uri !== uri));
    }
}
function attach(context, panel, doc) {
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
    const codiconsRoot = vscode.Uri.file(path.join(context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
    panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot, codiconsRoot] };
    panel.iconPath = { light: vscode.Uri.joinPath(mediaRoot, "spreadsheet-light.svg"), dark: vscode.Uri.joinPath(mediaRoot, "spreadsheet-dark.svg") };
    const session = new ViewerSession(context, panel, doc);
    const attached = doc?.attach(session);
    (0, service_1.setWebviewHtml)(panel.webview, (0, page_1.renderSpreadsheetPage)({
        cspSource: panel.webview.cspSource,
        scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "spreadsheet-viewer.js")).toString(),
        editingUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "spreadsheet-editing.js")).toString(),
        codiconsUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
        platform: process.platform
    }));
    const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || message.type !== "rpc" || typeof message.method !== "string")
            return;
        try {
            const result = await session.handle(message.method, message.params && typeof message.params === "object" ? message.params : {});
            (0, webview_ui_1.safePostMessage)(panel, { type: "rpc", id: message.id, ok: true, result });
        }
        catch (error) {
            const known = error instanceof types_1.SpreadsheetError;
            const notFound = error?.code === "FileNotFound";
            (0, webview_ui_1.safePostMessage)(panel, {
                type: "rpc", id: message.id, ok: false,
                error: known ? { message: error.message, hint: error.hint } : notFound ? { message: "The file no longer exists.", hint: "It was moved or deleted." } : { message: "Something went wrong.", hint: error instanceof Error ? error.message : undefined }
            });
        }
    });
    panel.onDidDispose(() => {
        subscription.dispose();
        attached?.dispose();
    });
    return session;
}
/**
 * The custom editor for .csv, .tsv and .xlsx files: a grid you can view and,
 * after pressing Edit, change and save. VS Code drives saving, reverting,
 * undo and hot-exit backups through the document.
 */
function createEditorProvider(context, events) {
    return {
        onDidChangeCustomDocument: events.event,
        openCustomDocument: (uri, openContext) => SpreadsheetDocument.open(uri, events, openContext.backupId),
        resolveCustomEditor: (document, panel) => { attach(context, panel, document); },
        saveCustomDocument: (document, cancellation) => document.save(document.uri, cancellation),
        saveCustomDocumentAs: (document, destination, cancellation) => document.save(destination, cancellation),
        revertCustomDocument: document => document.reload(),
        backupCustomDocument: (document, backupContext) => document.backup(backupContext.destination)
    };
}
exports.createEditorProvider = createEditorProvider;
/** Opens a file in the viewer's custom editor. */
async function openWithViewer(uri) {
    await vscode.commands.executeCommand("vscode.openWith", uri, (0, types_1.formatOf)(uri.path) === "xlsx" ? exports.EXCEL_VIEW_TYPE : exports.CSV_VIEW_TYPE);
}
exports.openWithViewer = openWithViewer;
async function pickAndOpen(prefer) {
    const csv = { "CSV and TSV": ["csv", "tsv", "tab"] };
    const excel = { "Excel workbooks": ["xlsx", "xlsm"] };
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: "Open in viewer",
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
        filters: { "Spreadsheets": ["csv", "tsv", "tab", "xlsx", "xlsm"], ...(prefer === "xlsx" ? { ...excel, ...csv } : { ...csv, ...excel }), "All files": ["*"] }
    });
    const uri = picked?.[0];
    if (!uri)
        return false;
    if (!(0, types_1.formatOf)(uri.path)) {
        void vscode.window.showWarningMessage("The viewer opens .csv, .tsv, .xlsx and .xlsm files. For old .xls workbooks, save them as .xlsx first.");
        return false;
    }
    await openWithViewer(uri);
    return true;
}
/**
 * The CSV Viewer and Excel Viewer commands. With a file (from the Explorer or
 * an editor's title bar) they open it; with a CSV in the active editor they
 * open that; otherwise the welcome panel offers a file, recent files or paste.
 */
async function openSpreadsheetViewer(context, prefer, target) {
    const uri = target instanceof vscode.Uri ? target : undefined;
    if (uri && (0, types_1.formatOf)(uri.path))
        return openWithViewer(uri);
    const active = vscode.window.activeTextEditor?.document;
    if (!uri && prefer !== "xlsx" && active && !active.isUntitled && (0, types_1.formatOf)(active.uri.path) && (0, types_1.formatOf)(active.uri.path) !== "xlsx") {
        return openWithViewer(active.uri);
    }
    const { panel, created } = (0, webview_ui_1.openToolPanel)(WELCOME_VIEW_TYPE, "CSV & Excel Viewer", { enableScripts: true, retainContextWhenHidden: true });
    if (created)
        attach(context, panel);
}
exports.openSpreadsheetViewer = openSpreadsheetViewer;
//# sourceMappingURL=viewer.js.map