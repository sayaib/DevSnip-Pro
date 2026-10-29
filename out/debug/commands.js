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
exports.registerDebugLogCommands = void 0;
const workspace_1 = require("../platform/workspace");
const vscode = __importStar(require("vscode"));
const environment_1 = require("../platform/environment");
const command_registry_1 = require("../utils/command-registry");
const find_logs_1 = require("./find-logs");
const insert_log_1 = require("./insert-log");
const syntax_1 = require("./syntax");
const SUPPORTED = "JavaScript, TypeScript, Python, Java, Kotlin, C#, Dart and Swift";
/** Insert Debug Log and Remove Debug Logs in This File: the editor side of debug logging. */
function registerDebugLogCommands(context) {
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.insertDebugLog", insertDebugLog), (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.removeDebugLogsInFile", removeDebugLogsInFile));
}
exports.registerDebugLogCommands = registerDebugLogCommands;
async function editableEditor() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || (0, workspace_1.canWriteResource)(editor.document.uri))
        return editor;
    const document = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: editor.document.getText() });
    const copy = await vscode.window.showTextDocument(document, { preview: false });
    copy.selections = editor.selections;
    return copy;
}
async function insertDebugLog() {
    const editor = await editableEditor();
    if (!editor)
        return;
    const document = editor.document;
    if (!(0, insert_log_1.isSupportedLanguage)(document.languageId)) {
        vscode.window.showInformationMessage(`Insert Debug Log works in ${SUPPORTED} files.`);
        return;
    }
    const text = document.getText();
    const indentUnit = editor.options.insertSpaces === false ? "\t" : " ".repeat(Number(editor.options.tabSize) || 4);
    const fileName = (0, environment_1.resourceName)(document.uri);
    const plans = [];
    for (const selection of editor.selections) {
        let expression = document.getText(selection).trim();
        let anchor = selection.start;
        if (!expression) {
            const word = (0, insert_log_1.expressionAt)(document.lineAt(selection.active.line).text, selection.active.character);
            if (!word)
                continue;
            expression = word.text;
            anchor = new vscode.Position(selection.active.line, word.start);
        }
        const plan = (0, insert_log_1.planDebugLog)({ languageId: document.languageId, text, line: anchor.line, column: anchor.character, expression, fileName, indentUnit });
        if (plan)
            plans.push(plan);
    }
    if (!plans.length) {
        vscode.window.showInformationMessage("Select a variable or expression in code (not in a comment or string), or put the cursor on one, to log it.");
        return;
    }
    const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const ok = await editor.edit(builder => {
        for (const plan of plans) {
            if (plan.line >= document.lineCount)
                builder.insert(document.lineAt(document.lineCount - 1).range.end, eol + plan.text);
            else
                builder.insert(new vscode.Position(plan.line, 0), plan.text + eol);
        }
    });
    if (!ok)
        vscode.window.showErrorMessage("The debug log could not be inserted (the file changed while inserting).");
}
async function removeDebugLogsInFile() {
    const editor = await editableEditor();
    if (!editor)
        return;
    const document = editor.document;
    const text = document.getText();
    const language = syntax_1.LANGUAGE_IDS[document.languageId];
    const statements = language ? (0, find_logs_1.findDebugStatements)(text, language) : (0, find_logs_1.findDebugStatementsInFile)(text, document.fileName);
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
    const choice = await vscode.window.showInformationMessage(`Remove ${removable.length} debug statement${removable.length === 1 ? "" : "s"} (${kinds}) from ${(0, environment_1.resourceName)(document.uri)}?`, { modal: true, detail: review ? `${review} more need a manual review and are left in place.` : "You can undo this with Undo." }, "Remove");
    if (choice !== "Remove")
        return;
    const plan = (0, find_logs_1.planRemovals)(text, removable);
    const ok = await editor.edit(builder => {
        for (const change of plan.edits)
            builder.replace(new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text);
    });
    if (!ok)
        vscode.window.showErrorMessage("The file changed while removing debug statements; nothing was removed.");
    else
        vscode.window.showInformationMessage(`Removed ${plan.edits.length} debug statement${plan.edits.length === 1 ? "" : "s"}.`);
}
//# sourceMappingURL=commands.js.map