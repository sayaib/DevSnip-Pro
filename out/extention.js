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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const createSnippetCommand_1 = require("./commands/createSnippetCommand");
const showSnippetsCommand_1 = require("./commands/showSnippetsCommand");
const listAndRemoveConsoleLogsCommand_1 = require("./commands/listAndRemoveConsoleLogsCommand");
const take_code_snip_1 = require("./commands/take-code-snip");
const api_test_1 = require("./commands/api-test");
function registerCommand(context, commandId, callback) {
    const disposable = vscode.commands.registerCommand(commandId, async (...args) => {
        await callback(context, ...args);
    });
    context.subscriptions.push(disposable);
}
function activate(context) {
    const snippetsFolderPath = path.join(__dirname, "../custom");
    const myTreeView = new MyTreeDataProvider();
    vscode.window.registerTreeDataProvider("myView", myTreeView);
    (0, createSnippetCommand_1.registerCreateSnippetCommand)(context);
    (0, showSnippetsCommand_1.registerShowSnippetsCommand)(context, snippetsFolderPath);
    (0, listAndRemoveConsoleLogsCommand_1.registerListAndRemoveConsoleLogsCommand)(context);
    (0, api_test_1.apiTest)(context);
    (0, take_code_snip_1.codeSnapShot)(context);
}
exports.activate = activate;
class MyTreeDataProvider {
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        return [
            this.createCommandButton("Open REST API Client", "sayaib.hue-console.openGUI", "cloud", new vscode.ThemeColor("terminal.ansiBrightCyan")),
            this.createCommandButton("Capture Code Snapshot", "sayaib.hue-console.captureCode", "code", new vscode.ThemeColor("terminal.ansiBrightYellow")),
            this.createCommandButton("Analyze and Remove Console Logs", "sayaib.hue-console.listAndRemoveConsoleLogs", "trash", new vscode.ThemeColor("terminal.ansiBrightRed")),
            this.createCommandButton("Create Custom Code Snippet", "sayaib.hue-console.createCustomSnippet", "edit", new vscode.ThemeColor("terminal.ansiBrightBlue")),
            this.createCommandButton("View Saved Code Snippets", "sayaib.hue-console.showSnippets", "file-code", new vscode.ThemeColor("terminal.ansiBrightMagenta")),
        ];
    }
    createCommandButton(label, command, iconId, color) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.iconPath = new vscode.ThemeIcon(iconId, color);
        return item;
    }
}
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extention.js.map