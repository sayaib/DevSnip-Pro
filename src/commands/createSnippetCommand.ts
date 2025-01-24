import * as vscode from "vscode";
import {
  getLanguageSnippetsPath,
  readExistingSnippets,
  saveSnippets,
  getLanguageFromFileName,
} from "../utils/snippet-utils";

interface Snippet {
  prefix: string;
  body: string | string[];
  description?: string;
}

export function registerCreateSnippetCommand(context: vscode.ExtensionContext) {
  const command = vscode.commands.registerCommand(
    "sayaib.hue-console.createCustomSnippet",
    async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error("No active editor!");

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) throw new Error("No text selected!");

        const language = getLanguageFromFileName(editor.document.fileName);

        const snippetPrefix = await vscode.window.showInputBox({
          prompt: "Enter the trigger prefix for your snippet.",
          validateInput: (value) =>
            value.trim() ? null : "Prefix cannot be empty",
        });

        if (!snippetPrefix) return;

        const snippetName = await vscode.window.showInputBox({
          prompt: "Enter a name for your snippet",
          validateInput: (value) =>
            value.trim() ? null : "Name cannot be empty",
        });

        if (!snippetName) return;

        const description = await vscode.window.showInputBox({
          prompt: "Enter a description for your snippet (optional)",
        });

        const snippetsPath = await getLanguageSnippetsPath(context, language);
        const existingSnippets = await readExistingSnippets(snippetsPath);

        existingSnippets[snippetName] = {
          prefix: snippetPrefix,
          body: selectedText.split("\n"),
          description: description || "",
        };

        await saveSnippets(snippetsPath, existingSnippets);

        vscode.window
          .showInformationMessage(
            `Snippet "${snippetName}" has been created successfully. Reload the window to activate it.`,
            { modal: true },
            "Reload Window"
          )
          .then((selection) => {
            if (selection === "Reload Window") {
              vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
      } catch (error) {
        vscode.window.showErrorMessage(`Error creating snippet: ${error}`);
      }
    }
  );

  context.subscriptions.push(command);
}
