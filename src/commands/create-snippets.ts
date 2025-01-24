import * as vscode from "vscode";
import { SnippetGenerator } from "../utils/snippet-generator";
import * as fs from "fs";
import * as path from "path";

export async function createCustomSnippet() {
  try {
    // Get the selected text
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      throw new Error("No active editor");
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection);

    if (!selectedText) {
      throw new Error("No text selected");
    }

    // Get snippet details from user
    const prefix = await vscode.window.showInputBox({
      prompt: "Enter snippet prefix (trigger text)",
      placeHolder: "e.g., myComponent",
    });

    if (!prefix) return;

    const description = await vscode.window.showInputBox({
      prompt: "Enter snippet description",
      placeHolder: "e.g., Creates a React component",
    });

    if (!description) return;

    const scope = await vscode.window.showInputBox({
      prompt: "Enter scope (optional, e.g., typescript,javascript)",
      placeHolder: "Leave empty for all languages",
    });

    // Generate the snippet
    const snippet = SnippetGenerator.createSnippet(
      selectedText,
      prefix,
      description || "",
      scope || undefined
    );

    // Save the snippet
    const snippetName = prefix.replace(/[^a-zA-Z0-9]/g, "");
    const snippetContent = SnippetGenerator.saveSnippet(snippetName, snippet);

    // Get the snippets directory path
    const snippetsPath = path.join(__dirname, "..", "..", "snippets");

    // Create snippets directory if it doesn't exist
    if (!fs.existsSync(snippetsPath)) {
      fs.mkdirSync(snippetsPath, { recursive: true });
    }

    // Save the snippet file
    const fileName = `${snippetName}.code-snippets`;
    const filePath = path.join(snippetsPath, fileName);
    fs.writeFileSync(filePath, snippetContent);

    // Show success message
    vscode.window.showInformationMessage(
      `Snippet "${snippetName}" created successfully!`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Error creating snippet: ${error}`);
  }
}
