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
exports.registerFrameworkSnippetsCommand = exports.loadBundledSnippets = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const command_registry_1 = require("../utils/command-registry");
const LANGUAGE_NAMES = {
    python: "Python", java: "Java / Spring Boot", csharp: "C# / ASP.NET Core", typescript: "TypeScript / Node.js",
    typescriptreact: "React / Next.js (TSX)", dart: "Dart / Flutter", swift: "Swift / SwiftUI"
};
/**
 * The ds- snippets contributed from ./snippets, by language. VS Code already
 * offers them as completions; this list backs the picker for people who do
 * not know the prefixes yet.
 */
function loadBundledSnippets(extensionPath) {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf8"));
    const byLanguage = new Map();
    for (const entry of manifest.contributes?.snippets ?? []) {
        if (!entry.path.startsWith("./snippets/"))
            continue;
        const file = JSON.parse(fs.readFileSync(path.join(extensionPath, entry.path), "utf8"));
        const list = byLanguage.get(entry.language) ?? [];
        for (const [name, snippet] of Object.entries(file)) {
            list.push({ name: name.replace(/^DevSnip:\s*/, ""), prefix: snippet.prefix, description: snippet.description, body: snippet.body.join("\n") });
        }
        byLanguage.set(entry.language, list);
    }
    return byLanguage;
}
exports.loadBundledSnippets = loadBundledSnippets;
function registerFrameworkSnippetsCommand(context) {
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.frameworkSnippets", async () => {
        const snippets = loadBundledSnippets(context.extensionPath);
        let editor = vscode.window.activeTextEditor;
        let language = editor?.document.languageId;
        if (!editor || !language || !snippets.has(language)) {
            const choice = await vscode.window.showQuickPick([...snippets.keys()].map(id => ({ label: LANGUAGE_NAMES[id] ?? id, description: `${snippets.get(id)?.length ?? 0} snippets`, id })), { title: "Framework Snippets", placeHolder: editor ? `No framework snippets for ${editor.document.languageId}; open a new file in…` : "Open a new file in…" });
            if (!choice)
                return;
            language = choice.id;
            editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language }));
        }
        const pick = await vscode.window.showQuickPick((snippets.get(language) ?? []).map(snippet => ({ label: snippet.name, description: snippet.prefix, detail: snippet.description, snippet })), { title: `Framework Snippets: ${LANGUAGE_NAMES[language] ?? language}`, placeHolder: "Pick a snippet to insert. In the editor, type ds- to get the same list as completions.", matchOnDescription: true, matchOnDetail: true });
        if (pick)
            await editor.insertSnippet(new vscode.SnippetString(pick.snippet.body));
    }));
}
exports.registerFrameworkSnippetsCommand = registerFrameworkSnippetsCommand;
//# sourceMappingURL=frameworkSnippets.js.map