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
exports.registerCodeDiffCommand = exports.lastTextEditor = exports.CODE_DIFF_COMMAND = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
/** Kept from the old Diff Checker, so keybindings, usage history and quests carry over. */
exports.CODE_DIFF_COMMAND = `${command_registry_1.COMMAND_PREFIX}textDiff`;
/** The panel steals focus, so "From editor" uses the editor the user was last working in. */
let lastEditor;
function lastTextEditor() {
    if (lastEditor && !lastEditor.document.isClosed)
        return lastEditor;
    return vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors[0];
}
exports.lastTextEditor = lastTextEditor;
/**
 * Registers the Code Diff Checker. Only editor tracking runs at activation;
 * the panel and its page load on first use.
 *
 * The command accepts what VS Code passes from the explorer (a Uri, plus the
 * whole selection when two files are selected) or `{ left, right }` text.
 */
function registerCodeDiffCommand(context) {
    lastEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor)
        lastEditor = editor; }), (0, command_registry_1.registerTrackedCommand)(exports.CODE_DIFF_COMMAND, async (arg, all) => {
        (await Promise.resolve().then(() => __importStar(require("./panel")))).openCodeDiff(context, arg, all);
    }));
}
exports.registerCodeDiffCommand = registerCodeDiffCommand;
//# sourceMappingURL=command.js.map