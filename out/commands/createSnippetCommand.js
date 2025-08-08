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
exports.registerCreateSnippetCommand = void 0;
const vscode = require("vscode");
const snippet_utils_1 = require("../utils/snippet-utils");
function registerCreateSnippetCommand(context) {
    const command = vscode.commands.registerCommand("sayaib.hue-console.createCustomSnippet", () => __awaiter(this, void 0, void 0, function* () {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor)
                throw new Error("No active editor!");
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            if (!selectedText)
                throw new Error("No code selected!");
            const language = (0, snippet_utils_1.getLanguageFromFileName)(editor.document.fileName);
            const snippetPrefix = yield vscode.window.showInputBox({
                prompt: "Enter the trigger prefix for your snippet.",
                validateInput: (value) => value.trim() ? null : "Prefix cannot be empty",
            });
            if (!snippetPrefix)
                return;
            const snippetName = yield vscode.window.showInputBox({
                prompt: "Enter a name for your snippet",
                validateInput: (value) => value.trim() ? null : "Name cannot be empty",
            });
            if (!snippetName)
                return;
            const description = yield vscode.window.showInputBox({
                prompt: "Enter a description for your snippet (optional)",
            });
            const snippetsPath = yield (0, snippet_utils_1.getLanguageSnippetsPath)(context, language);
            const existingSnippets = yield (0, snippet_utils_1.readExistingSnippets)(snippetsPath);
            existingSnippets[snippetName] = {
                prefix: snippetPrefix,
                body: selectedText.split("\n"),
                description: description || "",
            };
            yield (0, snippet_utils_1.saveSnippets)(snippetsPath, existingSnippets);
            vscode.window
                .showInformationMessage(`Snippet "${snippetName}" has been created successfully. Reload the window to activate it.`, { modal: true }, "Reload Window")
                .then((selection) => {
                if (selection === "Reload Window") {
                    vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
            });
        }
        catch (error) {
            vscode.window.showErrorMessage(`Error creating snippet: ${error}`);
        }
    }));
    context.subscriptions.push(command);
}
exports.registerCreateSnippetCommand = registerCreateSnippetCommand;
//# sourceMappingURL=createSnippetCommand.js.map