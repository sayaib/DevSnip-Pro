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
exports.registerSpreadsheetViewer = exports.OPEN_IN_VIEWER_COMMAND = exports.EXCEL_VIEWER_COMMAND = exports.CSV_VIEWER_COMMAND = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
exports.CSV_VIEWER_COMMAND = `${command_registry_1.COMMAND_PREFIX}csvViewer`;
exports.EXCEL_VIEWER_COMMAND = `${command_registry_1.COMMAND_PREFIX}excelViewer`;
/** Explorer and editor-title entry; not shown in the command palette. */
exports.OPEN_IN_VIEWER_COMMAND = `${command_registry_1.COMMAND_PREFIX}openInSpreadsheetViewer`;
/** Must match customEditors[].viewType in package.json: Excel opens here by default, CSV only on request. */
const VIEW_TYPES = ["devsnip.spreadsheetViewer", "devsnip.csvViewer"];
/**
 * Registers the CSV & Excel viewer: its commands and the custom editor
 * behind "Open With…" (read-only until Edit is pressed). The parsers and the page load on first use, so
 * activation stays light.
 */
function registerSpreadsheetViewer(context) {
    const viewer = () => Promise.resolve().then(() => __importStar(require("./viewer")));
    // The editor's undo stack: VS Code listens to this event before the real provider has loaded.
    const edits = new vscode.EventEmitter();
    let real;
    const load = () => (real ?? (real = viewer().then(m => m.createEditorProvider(context, edits))));
    const provider = {
        onDidChangeCustomDocument: edits.event,
        openCustomDocument: async (uri, openContext, token) => (await load()).openCustomDocument(uri, openContext, token),
        resolveCustomEditor: async (document, panel, token) => (await load()).resolveCustomEditor(document, panel, token),
        saveCustomDocument: async (document, token) => (await load()).saveCustomDocument(document, token),
        saveCustomDocumentAs: async (document, destination, token) => (await load()).saveCustomDocumentAs(document, destination, token),
        revertCustomDocument: async (document, token) => (await load()).revertCustomDocument(document, token),
        backupCustomDocument: async (document, backupContext, token) => (await load()).backupCustomDocument(document, backupContext, token)
    };
    context.subscriptions.push((0, command_registry_1.registerTrackedCommand)(exports.CSV_VIEWER_COMMAND, async (target) => (await viewer()).openSpreadsheetViewer(context, "csv", target)), (0, command_registry_1.registerTrackedCommand)(exports.EXCEL_VIEWER_COMMAND, async (target) => (await viewer()).openSpreadsheetViewer(context, "xlsx", target)), vscode.commands.registerCommand(exports.OPEN_IN_VIEWER_COMMAND, async (target) => {
        const uri = target instanceof vscode.Uri ? target : vscode.window.activeTextEditor?.document.uri;
        // Runs through the tool commands, so usage and quests count it like the sidebar entry.
        await vscode.commands.executeCommand(uri && /\.xlsm?$/i.test(uri.path) ? exports.EXCEL_VIEWER_COMMAND : exports.CSV_VIEWER_COMMAND, uri);
    }), edits, ...VIEW_TYPES.map(viewType => vscode.window.registerCustomEditorProvider(viewType, provider, {
        webviewOptions: { retainContextWhenHidden: true },
        // One grid per file: edits live in the document, and a second grid would need syncing.
        supportsMultipleEditorsPerDocument: false
    })));
}
exports.registerSpreadsheetViewer = registerSpreadsheetViewer;
//# sourceMappingURL=command.js.map