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
exports.createCustomSnippet = void 0;
const vscode = __importStar(require("vscode"));
const snippet_generator_1 = require("../utils/snippet-generator");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function createCustomSnippet() {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            throw new Error("No active editor");
        }
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            throw new Error("No text selected");
        }
        const prefix = await vscode.window.showInputBox({
            prompt: "Enter snippet prefix (trigger text)",
            placeHolder: "e.g., myComponent",
        });
        if (!prefix)
            return;
        const description = await vscode.window.showInputBox({
            prompt: "Enter snippet description",
            placeHolder: "e.g., Creates a React component",
        });
        if (!description)
            return;
        const scope = await vscode.window.showInputBox({
            prompt: "Enter scope (optional, e.g., typescript,javascript)",
            placeHolder: "Leave empty for all languages",
        });
        const snippet = snippet_generator_1.SnippetGenerator.createSnippet(selectedText, prefix, description || "", scope || undefined);
        const snippetName = prefix.replace(/[^a-zA-Z0-9]/g, "");
        const snippetContent = snippet_generator_1.SnippetGenerator.saveSnippet(snippetName, snippet);
        const snippetsPath = path.join(__dirname, "..", "..", "snippets");
        if (!fs.existsSync(snippetsPath)) {
            fs.mkdirSync(snippetsPath, { recursive: true });
        }
        const fileName = `${snippetName}.code-snippets`;
        const filePath = path.join(snippetsPath, fileName);
        fs.writeFileSync(filePath, snippetContent);
        vscode.window.showInformationMessage(`Snippet "${snippetName}" created successfully!`);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error creating snippet: ${error}`);
    }
}
exports.createCustomSnippet = createCustomSnippet;
//# sourceMappingURL=create-snippets.js.map