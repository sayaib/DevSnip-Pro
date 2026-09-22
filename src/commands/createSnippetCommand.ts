import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { confirmAction } from "../utils/webview-ui";
import {
  getLanguageFromFileName,
  getLanguageSnippetsPath,
  getSupportedLanguages,
  isLanguageSupported,
  readExistingSnippets,
  saveSnippets
} from "../utils/snippet-utils";

export function registerCreateSnippetCommand(context: vscode.ExtensionContext) {
  const command = registerTrackedCommand(
    "sayaib.hue-console.createCustomSnippet",
    async () => {
      try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage("Open a file and select the code you want to turn into a snippet.");
          return;
        }

        const selectedText = editor.document.getText(editor.selection);
        if (!selectedText.trim()) {
          vscode.window.showErrorMessage("Select the code you want to save as a snippet first.");
          return;
        }

        // Prefer the language VS Code assigned to the document; fall back to the
        // file extension for untitled or unusual files.
        let language = editor.document.languageId || getLanguageFromFileName(editor.document.fileName);
        if (!isLanguageSupported(context, language)) {
          const supported = getSupportedLanguages(context);
          if (!supported.length) {
            vscode.window.showErrorMessage("DevSnip Pro could not find its snippet files. Reinstall the extension.");
            return;
          }
          const picked = await vscode.window.showQuickPick(supported, {
            title: `DevSnip Pro does not contribute snippets for "${language}"`,
            placeHolder: "Choose the language to save this snippet under"
          });
          if (!picked) return;
          language = picked;
        }

        const snippetPrefix = await vscode.window.showInputBox({
          title: "Snippet prefix",
          prompt: "Text you will type to insert this snippet",
          placeHolder: "e.g. myComponent",
          validateInput: value => (value.trim() ? null : "Prefix cannot be empty")
        });
        if (!snippetPrefix) return;

        const snippetsPath = await getLanguageSnippetsPath(context, language);
        const existingSnippets = await readExistingSnippets(snippetsPath);

        const snippetName = await vscode.window.showInputBox({
          title: "Snippet name",
          prompt: `Name for this ${language} snippet`,
          value: snippetPrefix.trim(),
          validateInput: value => (value.trim() ? null : "Name cannot be empty")
        });
        if (!snippetName) return;

        const name = snippetName.trim();
        if (existingSnippets[name]) {
          if (!(await confirmAction(`A ${language} snippet named "${name}" already exists. Overwrite it?`, "Overwrite"))) return;
        }

        const description = await vscode.window.showInputBox({
          title: "Snippet description (optional)",
          prompt: "Shown in the completion list",
          placeHolder: "What does this snippet do?"
        });
        if (description === undefined) return;

        existingSnippets[name] = {
          prefix: snippetPrefix.trim(),
          // Tabs break VS Code snippet indentation handling in mixed files.
          body: selectedText.replace(/\t/g, "    ").split(/\r?\n/),
          description: description.trim()
        };

        await saveSnippets(snippetsPath, existingSnippets);

        const action = await vscode.window.showInformationMessage(
          `Snippet "${name}" saved for ${language}. VS Code loads contributed snippets at startup, so reload the window to start using it.`,
          "Reload Window",
          "Later"
        );
        if (action === "Reload Window") {
          await vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Could not create the snippet: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  context.subscriptions.push(command);
}
