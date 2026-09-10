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
exports.codeSnapShot = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const VIEW_TYPE = "devsnip pro";
const WEB_VIEW_TITLE = "DevSnip Pro Code Snapshot";
let panel;
let sourceEditor;
let sourceSelection;
const init = (context) => {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor && hasTextSelected(activeTextEditor.selection)) {
        sourceEditor = activeTextEditor;
        sourceSelection = activeTextEditor.selection;
        // Check if panel is already created, if not, create a new panel
        const isNewPanel = !panel;
        if (!panel) {
            panel = createPanel(context);
            // Dispose panel and clean up when closed
            panel.onDidDispose(() => {
                panel = undefined;
                sourceEditor = undefined;
                sourceSelection = undefined;
                vscode.window.showInformationMessage("Bye !!");
            });
        }
        if (!isNewPanel)
            update(panel);
    }
    else {
        vscode.window.showErrorMessage("Select some code in an editor before creating a snapshot.");
    }
};
const createPanel = (context) => {
    const htmlTemplatePath = path.resolve(context.extensionPath, "webview/index.html");
    // Create a new webview panel
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, WEB_VIEW_TITLE, vscode.ViewColumn.Two, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(context.extensionPath)],
    });
    const iconPath = path.resolve(context.extensionPath, "logo.png");
    panel.iconPath = vscode.Uri.file(iconPath);
    // Load HTML template into the webview panel
    panel.webview.html = getTemplate(htmlTemplatePath, panel);
    // Handle messages received from the webview
    panel.webview.onDidReceiveMessage((message) => {
        if (message.type === "updateCode" || message.type === "ready") {
            if (!update(panel, message.type === "updateCode")) {
                panel.webview.postMessage({
                    type: "snapshotError",
                    message: "Select code in an editor before refreshing the snapshot.",
                });
            }
        }
        else if (message.type === "copyCode" && typeof message.code === "string") {
            vscode.env.clipboard.writeText(message.code);
            vscode.window.showInformationMessage("Snapshot code copied to clipboard.");
        }
    });
    return panel;
};
const getTemplate = (htmlTemplatePath, panel) => {
    const htmlContent = fs.readFileSync(htmlTemplatePath, "utf-8");
    // Replace placeholders in the HTML template with actual values
    return htmlContent
        .replace(/%CSP_SOURCE%/gu, panel.webview.cspSource)
        .replace(/(src|href)="([^"]*)"/gu, (_, match, src) => {
        if (/^(?:https?:|data:|#)/u.test(src))
            return `${match}="${src}"`;
        let assetsPath = panel.webview.asWebviewUri(vscode.Uri.file(path.resolve(htmlTemplatePath, "..", src)));
        return `${match}="${assetsPath}"`;
    });
};
const update = (panel, forceCurrent = false) => {
    const editor = forceCurrent ? vscode.window.activeTextEditor : (sourceEditor || vscode.window.activeTextEditor);
    const selection = forceCurrent ? editor === null || editor === void 0 ? void 0 : editor.selection : (sourceSelection || (editor === null || editor === void 0 ? void 0 : editor.selection));
    if (!editor || !selection || selection.isEmpty)
        return false;
    // When refreshing, update the stored references so subsequent calls stay current
    if (forceCurrent) {
        sourceEditor = editor;
        sourceSelection = selection;
    }
    // Send selected text directly to webview without overwriting clipboard
    const selectedText = editor.document.getText(selection);
    panel.webview.postMessage({
        type: "updateCode",
        code: selectedText,
        language: editor.document.languageId,
        lineCount: selectedText ? selectedText.split(/\r?\n/u).length : 0,
    });
    return true;
};
const hasTextSelected = (selection) => !!selection && !selection.isEmpty;
const codeSnapShot = (context) => {
    return context.subscriptions.push(
    // Register the extension command to capture devsnip pro
    vscode.commands.registerCommand("sayaib.hue-console.captureCode", () => init(context)));
};
exports.codeSnapShot = codeSnapShot;
//# sourceMappingURL=take-code-snip.js.map