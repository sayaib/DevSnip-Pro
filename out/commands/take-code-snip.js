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
let cachedTemplate = null;
const VIEW_TYPE = "devsnip pro";
const WEB_VIEW_TITLE = "DevSnip Pro Code Snapshot";
let panel;
const init = (context) => {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (activeTextEditor) {
        if (!panel) {
            panel = createPanel(context);
            panel.onDidDispose(() => {
                panel = undefined;
                vscode.window.showInformationMessage("Bye !!");
            });
        }
        if (hasTextSelected(activeTextEditor.selection)) {
            update(panel);
        }
    }
    else {
        vscode.window.showErrorMessage("Go to your code editor then run this feature, no code selected");
    }
};
const createPanel = (context) => {
    const htmlTemplatePath = path.resolve(context.extensionPath, "webview/index.html");
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, WEB_VIEW_TITLE, vscode.ViewColumn.Two, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(context.extensionPath)],
    });
    const iconPath = path.resolve(context.extensionPath, "logo.png");
    panel.iconPath = vscode.Uri.file(iconPath);
    panel.webview.html = getTemplate(htmlTemplatePath, panel);
    panel.webview.onDidReceiveMessage((message) => {
        if (message.type === "updateCode") {
            update(panel);
        }
    });
    return panel;
};
const getTemplate = (htmlTemplatePath, panel) => {
    if (!cachedTemplate) {
        cachedTemplate = fs.readFileSync(htmlTemplatePath, "utf-8");
    }
    return cachedTemplate
        .replace(/%CSP_SOURCE%/gu, panel.webview.cspSource)
        .replace(/(src|href)="([^"]*)"/gu, (_, match, src) => {
        let assetsPath = panel.webview.asWebviewUri(vscode.Uri.file(path.resolve(htmlTemplatePath, "..", src)));
        return `${match}="${assetsPath}"`;
    });
};
const update = (panel) => {
    vscode.commands.executeCommand("editor.action.clipboardCopyAction");
    panel.webview.postMessage({
        type: "updateCode",
    });
};
const hasTextSelected = (selection) => !!selection && !selection.isEmpty;
const codeSnapShot = (context) => {
    const disposable = vscode.commands.registerCommand("sayaib.hue-console.captureCode", () => init(context));
    context.subscriptions.push(disposable);
    return disposable;
};
exports.codeSnapShot = codeSnapShot;
//# sourceMappingURL=take-code-snip.js.map