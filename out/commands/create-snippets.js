"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCustomSnippet = void 0;
const vscode = require("vscode");
const snippet_generator_1 = require("../utils/snippet-generator");
const fs = require("fs");
const path = require("path");
function createCustomSnippet() {
    return __awaiter(this, void 0, void 0, function* () {
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
            const prefix = yield vscode.window.showInputBox({
                prompt: "Enter snippet prefix (trigger text)",
                placeHolder: "e.g., myComponent",
            });
            if (!prefix)
                return;
            const description = yield vscode.window.showInputBox({
                prompt: "Enter snippet description",
                placeHolder: "e.g., Creates a React component",
            });
            if (!description)
                return;
            const scope = yield vscode.window.showInputBox({
                prompt: "Enter scope (optional, e.g., typescript,javascript)",
                placeHolder: "Leave empty for all languages",
            });
            // Generate the snippet
            const snippet = snippet_generator_1.SnippetGenerator.createSnippet(selectedText, prefix, description || "", scope || undefined);
            // Save the snippet
            const snippetName = prefix.replace(/[^a-zA-Z0-9]/g, "");
            const snippetContent = snippet_generator_1.SnippetGenerator.saveSnippet(snippetName, snippet);
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
            vscode.window.showInformationMessage(`Snippet "${snippetName}" created successfully!`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error creating snippet: ${error}`);
        }
    });
}
exports.createCustomSnippet = createCustomSnippet;
//# sourceMappingURL=create-snippets.js.map