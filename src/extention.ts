import * as vscode from "vscode";
import * as path from "path";
import { registerCreateSnippetCommand } from "./commands/createSnippetCommand";
import { registerShowSnippetsCommand } from "./commands/showSnippetsCommand";
import { registerListAndRemoveConsoleLogsCommand } from "./commands/listAndRemoveConsoleLogsCommand";

export function activate(context: vscode.ExtensionContext) {
  const snippetsFolderPath = path.join(__dirname, "../custom");

  console.log("DevSnip Pro extension is now active!");

  registerCreateSnippetCommand(context);
  registerShowSnippetsCommand(context, snippetsFolderPath);
  registerListAndRemoveConsoleLogsCommand(context);
}

export function deactivate() {}
