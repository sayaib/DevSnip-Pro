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
exports.registerCreateSnippetCommand = void 0;
const vscode = __importStar(require("vscode"));
const snippet_utils_1 = require("../utils/snippet-utils");
function registerCreateSnippetCommand(context) {
    const command = vscode.commands.registerCommand("sayaib.hue-console.createCustomSnippet", async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor)
                throw new Error("No active editor!");
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            if (!selectedText)
                throw new Error("No code selected!");
            const language = (0, snippet_utils_1.getLanguageFromFileName)(editor.document.fileName);
            const snippetPrefix = await vscode.window.showInputBox({
                prompt: "Enter the trigger prefix for your snippet.",
                validateInput: (value) => value.trim() ? null : "Prefix cannot be empty",
            });
            if (!snippetPrefix)
                return;
            const snippetName = await vscode.window.showInputBox({
                prompt: "Enter a name for your snippet",
                validateInput: (value) => value.trim() ? null : "Name cannot be empty",
            });
            if (!snippetName)
                return;
            const description = await vscode.window.showInputBox({
                prompt: "Enter a description for your snippet (optional)",
            });
            const snippetsPath = await (0, snippet_utils_1.getLanguageSnippetsPath)(context, language);
            const existingSnippets = await (0, snippet_utils_1.readExistingSnippets)(snippetsPath);
            existingSnippets[snippetName] = {
                prefix: snippetPrefix,
                body: selectedText.split("\n"),
                description: description || "",
            };
            await (0, snippet_utils_1.saveSnippets)(snippetsPath, existingSnippets);
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
    });
    context.subscriptions.push(command);
}
exports.registerCreateSnippetCommand = registerCreateSnippetCommand;
//# sourceMappingURL=createSnippetCommand.js.map