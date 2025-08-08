import * as vscode from "vscode";
import * as path from "path";
import { registerCreateSnippetCommand } from "./commands/createSnippetCommand";
import { registerShowSnippetsCommand } from "./commands/showSnippetsCommand";
import { registerListAndRemoveConsoleLogsCommand } from "./commands/listAndRemoveConsoleLogsCommand";
import { codeSnapShot } from "./commands/take-code-snip";
import { apiTest } from "./commands/api-test";

export function activate(context: vscode.ExtensionContext) {
  const snippetsFolderPath = path.join(__dirname, "../custom");

  console.log("DevSnip Pro extension is now active!");
  const myTreeView = new MyTreeDataProvider();
  vscode.window.registerTreeDataProvider("myView", myTreeView);

  // Register existing commands
  registerCreateSnippetCommand(context);
  registerShowSnippetsCommand(context, snippetsFolderPath);
  registerListAndRemoveConsoleLogsCommand(context);
  apiTest(context);
  codeSnapShot(context);
}

class MyTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    return [
      this.createCommandButton(
        "Open REST API Client",
        "sayaib.hue-console.openGUI",
        "cloud",
        new vscode.ThemeColor("terminal.ansiBrightCyan")
      ),

      this.createCommandButton(
        "Capture Code Snapshot",
        "sayaib.hue-console.captureCode",
        "code",
        new vscode.ThemeColor("terminal.ansiBrightYellow")
      ),
      this.createCommandButton(
        "Analyze and Remove Console Logs",
        "sayaib.hue-console.listAndRemoveConsoleLogs",
        "trash",
        new vscode.ThemeColor("terminal.ansiBrightRed")
      ),
      this.createCommandButton(
        "Create Custom Code Snippet",
        "sayaib.hue-console.createCustomSnippet",
        "edit",
        new vscode.ThemeColor("terminal.ansiBrightBlue")
      ),
      this.createCommandButton(
        "View Saved Code Snippets",
        "sayaib.hue-console.showSnippets",
        "file-code",
        new vscode.ThemeColor("terminal.ansiBrightMagenta")
      ),
    ];
  }

  private createCommandButton(
    label: string,
    command: string,
    iconId: string,
    color?: vscode.ThemeColor
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(iconId, color); // Adding color to icon
    return item;
  }
}

export function deactivate() {}
