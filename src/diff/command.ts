import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";

/** Kept from the old Diff Checker, so keybindings, usage history and quests carry over. */
export const CODE_DIFF_COMMAND = `${COMMAND_PREFIX}textDiff`;

/** The panel steals focus, so "From editor" uses the editor the user was last working in. */
let lastEditor: vscode.TextEditor | undefined;

export function lastTextEditor(): vscode.TextEditor | undefined {
  if (lastEditor && !lastEditor.document.isClosed) return lastEditor;
  return vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
}

/**
 * Registers the Code Diff Checker. Only editor tracking runs at activation;
 * the panel and its page load on first use.
 *
 * The command accepts what VS Code passes from the explorer (a Uri, plus the
 * whole selection when two files are selected) or `{ left, right }` text.
 */
export function registerCodeDiffCommand(context: vscode.ExtensionContext): void {
  lastEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) lastEditor = editor; }),
    registerTrackedCommand(CODE_DIFF_COMMAND, async (arg?: unknown, all?: unknown) => {
      (await import("./panel")).openCodeDiff(context, arg, all);
    })
  );
}
