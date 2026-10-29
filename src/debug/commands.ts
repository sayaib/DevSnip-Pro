import { canWriteResource } from "../platform/workspace";
import * as vscode from "vscode";
import { resourceName } from "../platform/environment";
import { registerTrackedCommand } from "../utils/command-registry";
import { DebugStatement, findDebugStatements, findDebugStatementsInFile, planRemovals } from "./find-logs";
import { expressionAt, isSupportedLanguage, planDebugLog } from "./insert-log";
import { LANGUAGE_IDS } from "./syntax";

const SUPPORTED = "JavaScript, TypeScript, Python, Java, Kotlin, C#, Dart and Swift";

/** Insert Debug Log and Remove Debug Logs in This File: the editor side of debug logging. */
export function registerDebugLogCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerTrackedCommand("sayaib.hue-console.insertDebugLog", insertDebugLog),
    registerTrackedCommand("sayaib.hue-console.removeDebugLogsInFile", removeDebugLogsInFile)
  );
}

async function editableEditor(): Promise<vscode.TextEditor | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || canWriteResource(editor.document.uri)) return editor;
  const document = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: editor.document.getText() });
  const copy = await vscode.window.showTextDocument(document, { preview: false });
  copy.selections = editor.selections;
  return copy;
}

async function insertDebugLog(): Promise<void> {
  const editor = await editableEditor();
  if (!editor) return;
  const document = editor.document;
  if (!isSupportedLanguage(document.languageId)) {
    vscode.window.showInformationMessage(`Insert Debug Log works in ${SUPPORTED} files.`);
    return;
  }
  const text = document.getText();
  const indentUnit = editor.options.insertSpaces === false ? "\t" : " ".repeat(Number(editor.options.tabSize) || 4);
  const fileName = resourceName(document.uri);
  const plans: Array<{ line: number; text: string; via: string }> = [];
  for (const selection of editor.selections) {
    let expression = document.getText(selection).trim();
    let anchor = selection.start;
    if (!expression) {
      const word = expressionAt(document.lineAt(selection.active.line).text, selection.active.character);
      if (!word) continue;
      expression = word.text;
      anchor = new vscode.Position(selection.active.line, word.start);
    }
    const plan = planDebugLog({ languageId: document.languageId, text, line: anchor.line, column: anchor.character, expression, fileName, indentUnit });
    if (plan) plans.push(plan);
  }
  if (!plans.length) {
    vscode.window.showInformationMessage("Select a variable or expression in code (not in a comment or string), or put the cursor on one, to log it.");
    return;
  }
  const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const ok = await editor.edit(builder => {
    for (const plan of plans) {
      if (plan.line >= document.lineCount) builder.insert(document.lineAt(document.lineCount - 1).range.end, eol + plan.text);
      else builder.insert(new vscode.Position(plan.line, 0), plan.text + eol);
    }
  });
  if (!ok) vscode.window.showErrorMessage("The debug log could not be inserted (the file changed while inserting).");
}

async function removeDebugLogsInFile(): Promise<void> {
  const editor = await editableEditor();
  if (!editor) return;
  const document = editor.document;
  const text = document.getText();
  const language = LANGUAGE_IDS[document.languageId];
  const statements: DebugStatement[] = language ? findDebugStatements(text, language) : findDebugStatementsInFile(text, document.fileName);
  if (!language && !statements.length && !/\.(html?|vue|svelte|php)$/i.test(document.fileName)) {
    vscode.window.showInformationMessage(`Debug log cleanup works in ${SUPPORTED} files (and <script> blocks in HTML, Vue, Svelte and PHP).`);
    return;
  }
  const removable = statements.filter(statement => statement.removable);
  const review = statements.length - removable.length;
  if (!removable.length) {
    vscode.window.showInformationMessage(review
      ? `No debug statements can be removed automatically; ${review} share a line with other code or are the body of an if without braces. Use Clean Debug Logs to review them.`
      : "No debug statements found in this file.");
    return;
  }
  const kinds = [...new Set(removable.map(statement => statement.kind))].join(", ");
  const choice = await vscode.window.showInformationMessage(
    `Remove ${removable.length} debug statement${removable.length === 1 ? "" : "s"} (${kinds}) from ${resourceName(document.uri)}?`,
    { modal: true, detail: review ? `${review} more need a manual review and are left in place.` : "You can undo this with Undo." },
    "Remove"
  );
  if (choice !== "Remove") return;
  const plan = planRemovals(text, removable);
  const ok = await editor.edit(builder => {
    for (const change of plan.edits) builder.replace(new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text);
  });
  if (!ok) vscode.window.showErrorMessage("The file changed while removing debug statements; nothing was removed.");
  else vscode.window.showInformationMessage(`Removed ${plan.edits.length} debug statement${plan.edits.length === 1 ? "" : "s"}.`);
}
