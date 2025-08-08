"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeSnapShot = void 0;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const VIEW_TYPE = "devsnip pro";
const WEB_VIEW_TITLE = "DevSnip Pro Code Snapshot";
let panel;
const init = (context) => {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor) {
        // Check if panel is already created, if not, create a new panel
        if (!panel) {
            panel = createPanel(context);
            // Dispose panel and clean up when closed
            panel.onDidDispose(() => {
                panel = undefined;
                vscode.window.showInformationMessage("Bye !!");
            });
        }
        // If there is text selected, update the panel
        if (hasTextSelected(activeTextEditor.selection)) {
            update(panel);
        }
    }
    else {
        //@desc Handle no text selection
        vscode.window.showErrorMessage("Go to your code editor then run this feature, no code selected");
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
        if (message.type === "updateCode") {
            update(panel);
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
        let assetsPath = panel.webview.asWebviewUri(vscode.Uri.file(path.resolve(htmlTemplatePath, "..", src)));
        return `${match}="${assetsPath}"`;
    });
};
const update = (panel) => {
    vscode.commands.executeCommand("editor.action.clipboardCopyAction");
    // Send a message to the webview to trigger the code update
    panel.webview.postMessage({
        type: "updateCode",
    });
};
const hasTextSelected = (selection) => !!selection && !selection.isEmpty;
const codeSnapShot = (context) => {
    return context.subscriptions.push(
    // Register the extension command to capture devsnip pro
    vscode.commands.registerCommand("sayaib.hue-console.captureCode", () => init(context)));
};
exports.codeSnapShot = codeSnapShot;
//# sourceMappingURL=take-code-snip.js.map