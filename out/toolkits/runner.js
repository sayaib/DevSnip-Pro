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
exports.isPortFree = exports.createToolContext = exports.safeRelativePath = exports.runTool = exports.openTool = exports.registerToolkitCommands = void 0;
const vscode = __importStar(require("vscode"));
const net = __importStar(require("net"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const types_1 = require("./types");
const commands_1 = require("./commands");
const page_1 = require("./page");
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const analytics_1 = require("../analytics");
const service_1 = require("../theme/service");
const activation_1 = require("../onboarding/activation");
/**
 * Hosts the toolkit tools: one command and one panel per tool. The webview
 * (media/toolkit.js) renders the form and results; everything that touches
 * VS Code - running the tool, the clipboard, editors and files - happens here.
 */
const RUN_TIMEOUT_MS = 90000;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const SEARCH_EXCLUDE = "**/{node_modules,.git,dist,build,out,.next,.venv,venv,__pycache__,target,vendor,coverage}/**";
/** The panel steals focus, so remember the editor the user was last working in. */
let lastEditor;
function registerToolkitCommands(context) {
    lastEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor)
        lastEditor = editor; }));
    for (const entry of commands_1.TOOLKIT_COMMANDS) {
        context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(command_registry_1.COMMAND_PREFIX + entry.command, async (arg) => {
            // Tool definitions and their engines load on first use, not at activation.
            const { findTool } = await Promise.resolve().then(() => __importStar(require("./registry")));
            const tool = findTool(entry.tool);
            if (!tool)
                throw new Error(`Unknown tool ${entry.tool}`);
            // Alias presets (e.g. a mode) and the editor text when run from the context menu both apply.
            const fromEditor = initialFromInvocation(tool, arg);
            await openTool(context, tool, entry.values || fromEditor ? { ...(entry.values ?? {}), ...(fromEditor ?? {}) } : undefined);
        }));
    }
}
exports.registerToolkitCommands = registerToolkitCommands;
/**
 * Run from the editor context menu (VS Code passes the file's Uri), a tool
 * starts with the selection - or the whole file - in its main input.
 */
function initialFromInvocation(tool, arg) {
    if (!(arg instanceof vscode.Uri))
        return undefined;
    const editor = vscode.window.activeTextEditor;
    const field = tool.fields.find(f => f.fromEditor);
    if (!editor || !field)
        return undefined;
    const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
    if (text.length > MAX_READ_BYTES)
        return undefined;
    const values = { [field.id]: text };
    // A field shown only in one mode (e.g. the Dockerfile linter's input) switches the tool to that mode.
    if (field.showIf)
        values[field.showIf.field] = field.showIf.equals[0];
    return values;
}
async function openTool(context, tool, initial) {
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
    const { panel, created } = (0, webview_ui_1.openToolPanel)(`devsnip.tool.${tool.id}`, tool.title, { enableScripts: true, localResourceRoots: [mediaRoot] });
    if (!created) {
        if (initial)
            (0, webview_ui_1.safePostMessage)(panel, { type: "setValues", values: initial, run: true });
        return;
    }
    const ctx = createToolContext(context);
    const { SECTIONS } = await Promise.resolve().then(() => __importStar(require("./registry")));
    const section = SECTIONS.find(s => s.id === tool.section);
    (0, service_1.setWebviewHtml)(panel.webview, (0, page_1.renderToolPage)({
        cspSource: panel.webview.cspSource,
        scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "toolkit.js")).toString(),
        tool: (0, types_1.describe)(tool),
        section: { id: section.id, title: section.title },
        examples: await allExamples(tool, ctx),
        initial: initial ?? {},
        platform: process.platform
    }));
    let liveTracked = false;
    let latestRequest = 0;
    const feature = tool.command;
    const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message !== "object")
            return;
        try {
            await handleMessage(message);
        }
        catch (error) {
            // Insert, open and save touch the editor and the disk; a failure must reach the user, not vanish.
            console.error(`DevSnip Pro: ${tool.id} action failed.`, error);
            (0, webview_ui_1.safePostMessage)(panel, { type: "notice", kind: "error", text: `That did not work: ${error instanceof Error ? error.message : String(error)}` });
        }
    });
    async function handleMessage(message) {
        switch (message.type) {
            case "run": {
                const requestId = Number(message.requestId) || 0;
                latestRequest = Math.max(latestRequest, requestId);
                const trigger = ["run", "live", "preset", "action"].includes(message.trigger) ? message.trigger : "run";
                const action = typeof message.action === "string" && tool.actions?.some(a => a.id === message.action) ? message.action : undefined;
                const started = Date.now();
                const outcome = await runTool(tool, sanitizeValues(message.values), ctx, action);
                const durationMs = Date.now() - started;
                // A slower, older live run must not overwrite a newer result.
                if (requestId < latestRequest && trigger === "live")
                    return;
                (0, webview_ui_1.safePostMessage)(panel, { type: "result", requestId, durationMs, ...outcome });
                if (action)
                    (0, webview_ui_1.safePostMessage)(panel, { type: "examples", examples: await allExamples(tool, ctx) });
                if (trigger !== "live" || !liveTracked) {
                    if (trigger === "live")
                        liveTracked = true;
                    (0, analytics_1.track)("tool_run_completed", { feature, section: tool.section, outcome: outcome.outcome, trigger, duration_ms: durationMs });
                }
                (0, activation_1.noteToolRun)(tool.section, outcome.outcome);
                return;
            }
            case "readEditor": {
                const editor = lastEditor && !lastEditor.document.isClosed ? lastEditor : vscode.window.visibleTextEditors[0];
                if (!editor) {
                    (0, webview_ui_1.safePostMessage)(panel, { type: "notice", kind: "warning", text: "Open a file in an editor first." });
                    return;
                }
                const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
                if (text.length > MAX_READ_BYTES) {
                    (0, webview_ui_1.safePostMessage)(panel, { type: "notice", kind: "warning", text: "That file is larger than 5 MB; select the part you need first." });
                    return;
                }
                (0, webview_ui_1.safePostMessage)(panel, { type: "editorText", field: String(message.field), text, source: `${editor.selection.isEmpty ? "all of" : "selection in"} ${path.basename(editor.document.fileName)}` });
                return;
            }
            case "copy":
                await vscode.env.clipboard.writeText(String(message.text ?? ""));
                (0, webview_ui_1.safePostMessage)(panel, { type: "notice", kind: "success", text: "Copied to the clipboard." });
                (0, analytics_1.track)("tool_output_used", { feature, action: "copy" });
                return;
            case "insert": {
                await insertAtCursor(String(message.text ?? ""), typeof message.language === "string" ? message.language : undefined);
                (0, analytics_1.track)("tool_output_used", { feature, action: "insert" });
                return;
            }
            case "open": {
                const document = await vscode.workspace.openTextDocument({ content: String(message.text ?? ""), language: editorLanguage(message.language) });
                await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
                (0, analytics_1.track)("tool_output_used", { feature, action: "open" });
                return;
            }
            case "download": {
                const saved = await saveAs(String(message.text ?? ""), typeof message.language === "string" ? message.language : undefined, typeof message.fileName === "string" ? message.fileName : "");
                if (saved) {
                    (0, webview_ui_1.safePostMessage)(panel, { type: "notice", kind: "success", text: `Saved ${path.basename(saved)}.` });
                    (0, analytics_1.track)("tool_output_used", { feature, action: "save" });
                }
                return;
            }
            case "save":
            case "writeAll": {
                const files = (Array.isArray(message.files) ? message.files : []).filter((f) => !!f && typeof f.path === "string" && typeof f.content === "string");
                if (!files.length)
                    return;
                const result = await writeFiles(files);
                (0, webview_ui_1.safePostMessage)(panel, { type: "notice", kind: result.kind, text: result.text });
                if (result.written)
                    (0, analytics_1.track)("tool_output_used", { feature, action: message.type === "save" ? "save" : "write_all", file_count: result.written });
                return;
            }
        }
    }
    panel.onDidDispose(() => subscription.dispose());
}
exports.openTool = openTool;
async function allExamples(tool, ctx) {
    let dynamic = [];
    try {
        dynamic = tool.dynamicExamples ? await tool.dynamicExamples(ctx) : [];
    }
    catch (error) {
        console.warn(`DevSnip Pro: could not load presets for ${tool.id}.`, error);
    }
    return [...(tool.examples ?? []), ...dynamic];
}
/** Only plain string / number / boolean values reach a tool. */
function sanitizeValues(raw) {
    const values = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return values;
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
            values[key] = value;
    }
    return values;
}
async function runTool(tool, values, ctx, action) {
    let timer;
    try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError()), RUN_TIMEOUT_MS); });
        const result = await Promise.race([Promise.resolve().then(() => tool.run(values, ctx, action)), timeout]);
        return { outcome: "success", result };
    }
    catch (error) {
        if (error instanceof types_1.ToolInputError)
            return { outcome: "input_error", error: error.message };
        if (error instanceof TimeoutError)
            return { outcome: "timeout", error: "The tool did not finish within 90 seconds." };
        console.error(`DevSnip Pro: ${tool.id} failed.`, error);
        return { outcome: "error", error: `Something went wrong: ${error instanceof Error ? error.message : String(error)}` };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
exports.runTool = runTool;
class TimeoutError extends Error {
}
// ---------------------------------------------------------------------------
// Environment for tools
// ---------------------------------------------------------------------------
/** Accepts plain workspace-relative paths only: no absolute paths, no "..". */
function safeRelativePath(input) {
    const normalized = input.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
    if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized))
        return undefined;
    const parts = normalized.split("/");
    if (parts.some(p => p === ".." || p === ""))
        return undefined;
    return parts.join("/");
}
exports.safeRelativePath = safeRelativePath;
function workspaceRoot() {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}
function createToolContext(context) {
    const root = workspaceRoot();
    const resolve = (relative) => {
        const safe = safeRelativePath(relative);
        if (!safe || !root)
            throw new types_1.ToolInputError(`Invalid workspace path: ${relative}`);
        return vscode.Uri.joinPath(root, ...safe.split("/"));
    };
    return {
        workspace: root ? {
            name: vscode.workspace.workspaceFolders[0].name,
            async exists(relative) {
                try {
                    await vscode.workspace.fs.stat(resolve(relative));
                    return true;
                }
                catch {
                    return false;
                }
            },
            async readFile(relative) {
                try {
                    const uri = resolve(relative);
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.size > MAX_READ_BYTES)
                        return undefined;
                    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
                }
                catch {
                    return undefined;
                }
            },
            async findFiles(glob, limit) {
                const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, glob), SEARCH_EXCLUDE, limit);
                return uris.map(u => path.relative(root.fsPath, u.fsPath).split(path.sep).join("/"));
            }
        } : undefined,
        storage: {
            get: (key, fallback) => context.globalState.get(key, fallback),
            set: async (key, value) => { await context.globalState.update(key, value); }
        },
        network: { isPortFree },
        now: () => new Date()
    };
}
exports.createToolContext = createToolContext;
/** A port is in use when something accepts a connection on it (IPv4 or IPv6 loopback). */
async function isPortFree(port) {
    const listening = (host) => new Promise(resolve => {
        const socket = net.connect({ port, host });
        const done = (value) => { socket.destroy(); resolve(value); };
        socket.setTimeout(400, () => done(false));
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
    });
    const [v4, v6] = await Promise.all([listening("127.0.0.1"), listening("::1")]);
    return !v4 && !v6;
}
exports.isPortFree = isPortFree;
// ---------------------------------------------------------------------------
// Output actions
// ---------------------------------------------------------------------------
const LANGUAGE_IDS = {
    dockerfile: "dockerfile", yaml: "yaml", json: "json", jsonl: "jsonl", python: "python", typescript: "typescript", javascript: "javascript",
    shell: "shellscript", sql: "sql", markdown: "markdown", go: "go", java: "java", groovy: "groovy", nginx: "nginx", terraform: "terraform",
    dotenv: "dotenv", properties: "properties", csv: "csv", tsv: "tsv", diff: "diff", log: "log", ignore: "ignore", helm: "helm", http: "http", text: "plaintext",
    tsx: "typescriptreact", jsx: "javascriptreact", dart: "dart", kotlin: "kotlin", swift: "swift", xml: "xml", html: "html", css: "css", graphql: "graphql",
    php: "php", ruby: "ruby", prisma: "prisma"
};
function editorLanguage(language) {
    return (typeof language === "string" && LANGUAGE_IDS[language]) || "plaintext";
}
const EXTENSIONS = {
    typescript: "ts", javascript: "js", tsx: "tsx", jsx: "jsx", json: "json", jsonl: "jsonl", yaml: "yaml", python: "py", shell: "sh", sql: "sql",
    markdown: "md", go: "go", java: "java", kotlin: "kt", swift: "swift", dart: "dart", xml: "xml", html: "html", css: "css", graphql: "graphql",
    dockerfile: "Dockerfile", nginx: "conf", terraform: "tf", dotenv: "env", properties: "properties", csv: "csv", tsv: "tsv", diff: "diff",
    http: "http", php: "php", ruby: "rb", groovy: "gradle", prisma: "prisma", ignore: "gitignore", log: "log", text: "txt"
};
/** "Save as…": the user picks the location, so any path they choose is allowed. */
async function saveAs(text, language, suggested) {
    const ext = (language && EXTENSIONS[language]) || "txt";
    const base = suggested.split(/[\\/]/).pop().replace(/[^\w.@ -]+/g, " ").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "output";
    const name = /\.[A-Za-z0-9]{1,12}$/.test(base) || base === "Dockerfile" ? base : `${base}.${ext}`;
    const root = workspaceRoot();
    const target = await vscode.window.showSaveDialog({
        defaultUri: root ? vscode.Uri.joinPath(root, name) : vscode.Uri.file(path.join(os.homedir(), name)),
        saveLabel: "Save"
    });
    if (!target)
        return undefined;
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
    return target.fsPath;
}
async function insertAtCursor(text, language) {
    const editor = lastEditor && !lastEditor.document.isClosed ? lastEditor : undefined;
    if (!editor) {
        const document = await vscode.workspace.openTextDocument({ content: text, language: editorLanguage(language) });
        await vscode.window.showTextDocument(document, { preview: false });
        return;
    }
    const shown = await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
    await shown.edit(builder => { for (const selection of shown.selections)
        builder.replace(selection, text); });
}
async function writeFiles(files) {
    const root = workspaceRoot();
    if (!root)
        return { kind: "error", text: "Open a folder first: files are written into the workspace.", written: 0 };
    const targets = [];
    for (const file of files) {
        const safe = safeRelativePath(file.path);
        if (!safe)
            return { kind: "error", text: `Refused to write "${file.path}": only paths inside the workspace are allowed.`, written: 0 };
        const uri = vscode.Uri.joinPath(root, ...safe.split("/"));
        let exists = false;
        try {
            await vscode.workspace.fs.stat(uri);
            exists = true;
        }
        catch { /* new file */ }
        targets.push({ file: { ...file, path: safe }, uri, exists });
    }
    const overwrite = targets.filter(t => t.exists && t.file.mode !== "append");
    if (overwrite.length) {
        const list = overwrite.slice(0, 8).map(t => t.file.path).join("\n");
        const ok = await (0, webview_ui_1.confirmAction)(`${overwrite.length === 1 ? "This file already exists" : `${overwrite.length} files already exist`}:\n${list}${overwrite.length > 8 ? "\n…" : ""}\n\nOverwrite?`, "Overwrite");
        if (!ok)
            return { kind: "warning", text: "Nothing was written.", written: 0 };
    }
    for (const t of targets) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(t.uri, ".."));
        let content = t.file.content;
        if (t.file.mode === "append" && t.exists) {
            const existing = Buffer.from(await vscode.workspace.fs.readFile(t.uri)).toString("utf8");
            content = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + content;
        }
        await vscode.workspace.fs.writeFile(t.uri, Buffer.from(content, "utf8"));
    }
    const first = targets[0];
    await vscode.window.showTextDocument(first.uri, { preview: targets.length > 1, viewColumn: vscode.ViewColumn.Beside });
    const appended = targets.filter(t => t.file.mode === "append" && t.exists).length;
    return {
        kind: "success",
        text: targets.length === 1 ? `${appended ? "Appended to" : "Wrote"} ${first.file.path}.` : `Wrote ${targets.length} files: ${targets.map(t => t.file.path).slice(0, 6).join(", ")}${targets.length > 6 ? "…" : ""}.`,
        written: targets.length
    };
}
//# sourceMappingURL=runner.js.map