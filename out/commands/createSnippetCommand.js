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
const command_registry_1 = require("../utils/command-registry");
const webview_ui_1 = require("../utils/webview-ui");
const snippet_utils_1 = require("../utils/snippet-utils");
function registerCreateSnippetCommand(context) {
    const command = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.createCustomSnippet", async () => {
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
            let language = editor.document.languageId || (0, snippet_utils_1.getLanguageFromFileName)(editor.document.fileName);
            if (!(0, snippet_utils_1.isLanguageSupported)(context, language)) {
                const supported = (0, snippet_utils_1.getSupportedLanguages)(context);
                if (!supported.length) {
                    vscode.window.showErrorMessage("DevSnip Pro could not find its snippet files. Reinstall the extension.");
                    return;
                }
                const picked = await vscode.window.showQuickPick(supported, {
                    title: `DevSnip Pro does not contribute snippets for "${language}"`,
                    placeHolder: "Choose the language to save this snippet under"
                });
                if (!picked)
                    return;
                language = picked;
            }
            const snippetPrefix = await vscode.window.showInputBox({
                title: "Snippet prefix",
                prompt: "Text you will type to insert this snippet",
                placeHolder: "e.g. myComponent",
                validateInput: value => (value.trim() ? null : "Prefix cannot be empty")
            });
            if (!snippetPrefix)
                return;
            const snippetsPath = await (0, snippet_utils_1.getLanguageSnippetsPath)(context, language);
            const existingSnippets = await (0, snippet_utils_1.readExistingSnippets)(snippetsPath);
            const snippetName = await vscode.window.showInputBox({
                title: "Snippet name",
                prompt: `Name for this ${language} snippet`,
                value: snippetPrefix.trim(),
                validateInput: value => (value.trim() ? null : "Name cannot be empty")
            });
            if (!snippetName)
                return;
            const name = snippetName.trim();
            if (existingSnippets[name]) {
                if (!(await (0, webview_ui_1.confirmAction)(`A ${language} snippet named "${name}" already exists. Overwrite it?`, "Overwrite")))
                    return;
            }
            const description = await vscode.window.showInputBox({
                title: "Snippet description (optional)",
                prompt: "Shown in the completion list",
                placeHolder: "What does this snippet do?"
            });
            if (description === undefined)
                return;
            existingSnippets[name] = {
                prefix: snippetPrefix.trim(),
                // Tabs break VS Code snippet indentation handling in mixed files.
                body: selectedText.replace(/\t/g, "    ").split(/\r?\n/),
                description: description.trim()
            };
            await (0, snippet_utils_1.saveSnippets)(snippetsPath, existingSnippets);
            const action = await vscode.window.showInformationMessage(`Snippet "${name}" saved for ${language}. VS Code loads contributed snippets at startup, so reload the window to start using it.`, "Reload Window", "Later");
            if (action === "Reload Window") {
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Could not create the snippet: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    context.subscriptions.push(command);
}
exports.registerCreateSnippetCommand = registerCreateSnippetCommand;
//# sourceMappingURL=createSnippetCommand.js.map