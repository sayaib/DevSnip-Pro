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
exports.jsonDiff = exports.decodeText = exports.readSide = exports.openCodeDiff = exports.MAX_FILE_BYTES = void 0;
const vscode = __importStar(require("vscode"));
const analytics_1 = require("../analytics");
const environment_1 = require("../platform/environment");
const workspace_1 = require("../platform/workspace");
const service_1 = require("../theme/service");
const data_inspect_1 = require("../toolkits/engines/data-inspect");
const json_locate_1 = require("../toolkits/engines/json-locate");
const webview_ui_1 = require("../utils/webview-ui");
const command_1 = require("./command");
const page_1 = require("./page");
const VIEW_TYPE = "devsnip.codeDiff";
const PREFS_KEY = "devsnip.codeDiff.prefs";
/** Large enough for generated files and logs; the page stays responsive well past this. */
exports.MAX_FILE_BYTES = 25 * 1024 * 1024;
const JSON_MAX_ENTRIES = 5000;
/** Opens the Code Diff Checker (or brings it to the front) with whatever the command was given. */
async function openCodeDiff(context, arg, all) {
    const initial = await initialFromInvocation(arg, all);
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
    const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
    const { panel, created } = (0, webview_ui_1.openToolPanel)(VIEW_TYPE, "Code Diff Checker", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
    if (!created) {
        if (initial.left || initial.right)
            (0, webview_ui_1.safePostMessage)(panel, { type: "setInputs", ...initial });
        return;
    }
    const webview = panel.webview;
    const uri = (file) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, file)).toString();
    (0, service_1.setWebviewHtml)(webview, (0, page_1.renderCodeDiffPage)({
        cspSource: webview.cspSource,
        engineUri: uri("code-diff-engine.js"),
        scriptUri: uri("code-diff.js"),
        codiconsUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
        platform: (0, environment_1.hostPlatform)(),
        canSave: (0, workspace_1.outputCapabilities)().saveAs,
        prefs: (0, page_1.sanitizePrefs)(context.globalState.get(PREFS_KEY)),
        initial
    }));
    const post = (message) => (0, webview_ui_1.safePostMessage)(panel, message);
    const notice = (kind, text) => post({ type: "notice", kind, text });
    const subscription = webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message !== "object")
            return;
        try {
            await handle(message);
        }
        catch (error) {
            console.error("DevSnip Pro: Code Diff Checker action failed.", error);
            notice("error", error instanceof Error ? error.message : String(error));
        }
    });
    panel.onDidDispose(() => subscription.dispose());
    async function handle(message) {
        const side = message.side === "right" ? "right" : "left";
        switch (message.type) {
            case "pickFile": {
                const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: side === "left" ? "Use as original" : "Use as modified", title: side === "left" ? "Choose the original file" : "Choose the modified file", defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
                if (!picked?.[0])
                    return;
                post({ type: "file", side, ...(await readSide(picked[0])) });
                return;
            }
            case "readEditor": {
                const editor = (0, command_1.lastTextEditor)();
                if (!editor) {
                    notice("warning", "Open a file in an editor first, then choose From editor.");
                    return;
                }
                const selection = editor.selection;
                const text = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
                if (text.length > exports.MAX_FILE_BYTES) {
                    notice("error", "That editor is too large to compare here.");
                    return;
                }
                post({ type: "file", side, name: (0, environment_1.resourceName)(editor.document.uri), text, language: editor.document.languageId, note: selection.isEmpty ? undefined : "selection" });
                return;
            }
            case "paste": {
                const text = await vscode.env.clipboard.readText();
                if (!text) {
                    notice("warning", "The clipboard is empty.");
                    return;
                }
                post({ type: "file", side, text, keepName: true });
                return;
            }
            case "copy": {
                if (typeof message.text !== "string")
                    return;
                await vscode.env.clipboard.writeText(message.text);
                notice("success", typeof message.label === "string" ? message.label : "Copied to the clipboard.");
                return;
            }
            case "save": {
                if (typeof message.text !== "string")
                    return;
                const name = String(message.name || "changes.diff").replace(/[\\/:*?"<>|]+/g, "-");
                const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
                const target = await vscode.window.showSaveDialog({
                    defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
                    saveLabel: "Save",
                    filters: name.endsWith(".html") ? { HTML: ["html"] } : { "Diff / patch": ["diff", "patch"], "All files": ["*"] }
                });
                if (!target)
                    return;
                await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(message.text));
                notice("success", `Saved ${(0, environment_1.resourceName)(target)}.`);
                return;
            }
            case "openPatch": {
                if (typeof message.text !== "string")
                    return;
                const doc = await vscode.workspace.openTextDocument({ content: message.text, language: "diff" });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
                return;
            }
            case "jsonDiff": {
                post({ type: "jsonResult", requestId: message.requestId, ...jsonDiff(String(message.left ?? ""), String(message.right ?? ""), { ignoreArrayOrder: message.ignoreArrayOrder === true, arrayKey: typeof message.arrayKey === "string" ? message.arrayKey.trim() : "" }) });
                return;
            }
            case "prefs":
                await context.globalState.update(PREFS_KEY, (0, page_1.sanitizePrefs)(message.prefs));
                return;
            case "compared":
                // Live comparisons re-run as you type; analytics counts a tool once per few minutes.
                (0, analytics_1.trackToolUsed)("textDiff");
                return;
        }
    }
}
exports.openCodeDiff = openCodeDiff;
/** Reads a file for one side, refusing binaries and very large files with a clear reason. */
async function readSide(uri) {
    const name = (0, environment_1.resourceName)(uri);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type & vscode.FileType.Directory)
        throw new Error(`${name} is a folder. Choose a file.`);
    if (stat.size > exports.MAX_FILE_BYTES)
        throw new Error(`${name} is ${(stat.size / 1024 / 1024).toFixed(1)} MB. Files up to ${exports.MAX_FILE_BYTES / 1024 / 1024} MB can be compared.`);
    return { name, text: decodeText(await vscode.workspace.fs.readFile(uri), name) };
}
exports.readSide = readSide;
/** UTF-8 (with or without BOM) or UTF-16 with a BOM; binary content is refused. */
function decodeText(bytes, name = "The file") {
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
        return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
        return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    const probe = bytes.subarray(0, 8000);
    if (probe.includes(0))
        throw new Error(`${name} looks like a binary file. The Code Diff Checker compares text.`);
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8").decode(bytes.subarray(start));
}
exports.decodeText = decodeText;
async function initialFromInvocation(arg, all) {
    try {
        // Two files selected in the explorer: VS Code passes the clicked one and the whole selection.
        const uris = Array.isArray(all) ? all.filter((u) => u instanceof vscode.Uri) : [];
        if (uris.length >= 2) {
            const [left, right] = await Promise.all([readSide(uris[0]), readSide(uris[1])]);
            return { left, right };
        }
        if (arg instanceof vscode.Uri)
            return { left: await readSide(arg) };
        if (arg && typeof arg === "object") {
            const o = arg;
            const side = (v) => typeof v === "string" ? { name: "", text: v } : undefined;
            if (typeof o.left === "string" || typeof o.right === "string")
                return { left: side(o.left), right: side(o.right) };
        }
    }
    catch (error) {
        void vscode.window.showWarningMessage(`Code Diff Checker: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {};
}
/** Structural JSON comparison (key order and formatting ignored), as the previous Diff Checker offered. */
function jsonDiff(left, right, options) {
    if (!left.trim() && !right.trim())
        return { error: "Paste two JSON documents to compare." };
    const parse = (text, which) => {
        try {
            return JSON.parse(text.replace(/^﻿/, ""));
        }
        catch {
            throw new Error(`${which} is not valid JSON (${(0, json_locate_1.describeJsonError)(text)}).`);
        }
    };
    let a, b;
    try {
        a = parse(left, "Original");
        b = parse(right, "Modified");
    }
    catch (error) {
        return { error: error.message };
    }
    const all = (0, data_inspect_1.diffValues)(a, b, { ignoreArrayOrder: options.ignoreArrayOrder, arrayKey: options.arrayKey || undefined });
    const show = (v) => v === undefined ? "" : truncate(JSON.stringify(v), 400);
    const count = (k) => all.filter(e => e.kind === k).length;
    return {
        entries: all.slice(0, JSON_MAX_ENTRIES).map(e => ({ kind: e.kind, path: e.path, before: show(e.before), after: show(e.after) })),
        counts: { added: count("added"), removed: count("removed"), changed: count("changed"), type: count("type") },
        truncated: all.length > JSON_MAX_ENTRIES
    };
}
exports.jsonDiff = jsonDiff;
function truncate(s, max) {
    return s.length > max ? `${s.slice(0, max)}…` : s;
}
//# sourceMappingURL=panel.js.map