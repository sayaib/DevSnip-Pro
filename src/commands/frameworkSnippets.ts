import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { registerTrackedCommand } from "../utils/command-registry";

export interface BundledSnippet {
  name: string;
  prefix: string;
  description: string;
  body: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  python: "Python", java: "Java / Spring Boot", csharp: "C# / ASP.NET Core", typescript: "TypeScript / Node.js",
  typescriptreact: "React / Next.js (TSX)", dart: "Dart / Flutter", swift: "Swift / SwiftUI"
};

/**
 * The ds- snippets contributed from ./snippets, by language. VS Code already
 * offers them as completions; this list backs the picker for people who do
 * not know the prefixes yet.
 */
export function loadBundledSnippets(extensionPath: string): Map<string, BundledSnippet[]> {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "package.json"), "utf8")) as { contributes?: { snippets?: Array<{ language: string; path: string }> } };
  const byLanguage = new Map<string, BundledSnippet[]>();
  for (const entry of manifest.contributes?.snippets ?? []) {
    if (!entry.path.startsWith("./snippets/")) continue;
    const file = JSON.parse(fs.readFileSync(path.join(extensionPath, entry.path), "utf8")) as Record<string, { prefix: string; description: string; body: string[] }>;
    const list = byLanguage.get(entry.language) ?? [];
    for (const [name, snippet] of Object.entries(file)) {
      list.push({ name: name.replace(/^DevSnip:\s*/, ""), prefix: snippet.prefix, description: snippet.description, body: snippet.body.join("\n") });
    }
    byLanguage.set(entry.language, list);
  }
  return byLanguage;
}

export function registerFrameworkSnippetsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerTrackedCommand("sayaib.hue-console.frameworkSnippets", async () => {
    const snippets = loadBundledSnippets(context.extensionPath);
    let editor = vscode.window.activeTextEditor;
    let language = editor?.document.languageId;
    if (!editor || !language || !snippets.has(language)) {
      const choice = await vscode.window.showQuickPick(
        [...snippets.keys()].map(id => ({ label: LANGUAGE_NAMES[id] ?? id, description: `${snippets.get(id)?.length ?? 0} snippets`, id })),
        { title: "Framework Snippets", placeHolder: editor ? `No framework snippets for ${editor.document.languageId}; open a new file in…` : "Open a new file in…" }
      );
      if (!choice) return;
      language = choice.id;
      editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language }));
    }
    const pick = await vscode.window.showQuickPick(
      (snippets.get(language) ?? []).map(snippet => ({ label: snippet.name, description: snippet.prefix, detail: snippet.description, snippet })),
      { title: `Framework Snippets: ${LANGUAGE_NAMES[language] ?? language}`, placeHolder: "Pick a snippet to insert. In the editor, type ds- to get the same list as completions.", matchOnDescription: true, matchOnDetail: true }
    );
    if (pick) await editor.insertSnippet(new vscode.SnippetString(pick.snippet.body));
  }));
}
