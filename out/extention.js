"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const path = require("path");
const createSnippetCommand_1 = require("./commands/createSnippetCommand");
const showSnippetsCommand_1 = require("./commands/showSnippetsCommand");
const listAndRemoveConsoleLogsCommand_1 = require("./commands/listAndRemoveConsoleLogsCommand");
const take_code_snip_1 = require("./commands/take-code-snip");
const api_test_1 = require("./commands/api-test");
const advancedTools_1 = require("./commands/advancedTools");
function activate(context) {
    const snippetsFolderPath = path.join(__dirname, "../custom");
    console.log("DevSnip Pro extension is now active!");
    const myTreeView = new MyTreeDataProvider();
    vscode.window.registerTreeDataProvider("myView", myTreeView);
    // Register existing commands
    (0, createSnippetCommand_1.registerCreateSnippetCommand)(context);
    (0, showSnippetsCommand_1.registerShowSnippetsCommand)(context, snippetsFolderPath);
    (0, listAndRemoveConsoleLogsCommand_1.registerListAndRemoveConsoleLogsCommand)(context);
    (0, api_test_1.apiTest)(context);
    (0, take_code_snip_1.codeSnapShot)(context);
    // Register advanced tools commands
    (0, advancedTools_1.registerAdvancedToolsCommands)(context);
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
            this.createCommandButton("🧰 Advanced Developer Tools", "sayaib.hue-console.advancedToolsHub", "tools", new vscode.ThemeColor("terminal.ansiBrightWhite")),
            this.createCommandButton("🔍 Regex Builder & Tester", "sayaib.hue-console.regexBuilder", "search", new vscode.ThemeColor("terminal.ansiBrightCyan")),
            this.createCommandButton("📝 JSON/XML Formatter", "sayaib.hue-console.jsonFormatter", "json", new vscode.ThemeColor("terminal.ansiBrightGreen")),
        ];
    }
    createCommandButton(label, command, iconId, color) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.iconPath = new vscode.ThemeIcon(iconId, color); // Adding color to icon
        return item;
    }
}
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extention.js.map