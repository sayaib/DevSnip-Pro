import * as vscode from "vscode";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";

export const CSV_VIEWER_COMMAND = `${COMMAND_PREFIX}csvViewer`;
export const EXCEL_VIEWER_COMMAND = `${COMMAND_PREFIX}excelViewer`;
/** Explorer and editor-title entry; not shown in the command palette. */
export const OPEN_IN_VIEWER_COMMAND = `${COMMAND_PREFIX}openInSpreadsheetViewer`;
/** Must match customEditors[].viewType in package.json: Excel opens here by default, CSV only on request. */
const VIEW_TYPES = ["devsnip.spreadsheetViewer", "devsnip.csvViewer"];

/**
 * Registers the CSV & Excel viewer: its commands and the custom editor
 * behind "Open With…" (read-only until Edit is pressed). The parsers and the page load on first use, so
 * activation stays light.
 */
export function registerSpreadsheetViewer(context: vscode.ExtensionContext): void {
  const viewer = () => import("./viewer");
  // The editor's undo stack: VS Code listens to this event before the real provider has loaded.
  const edits = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<vscode.CustomDocument>>();
  let real: Promise<vscode.CustomEditorProvider<vscode.CustomDocument>> | undefined;
  const load = () => (real ??= viewer().then(m => m.createEditorProvider(context, edits) as unknown as vscode.CustomEditorProvider<vscode.CustomDocument>));
  const provider: vscode.CustomEditorProvider<vscode.CustomDocument> = {
    onDidChangeCustomDocument: edits.event,
    openCustomDocument: async (uri, openContext, token) => (await load()).openCustomDocument(uri, openContext, token),
    resolveCustomEditor: async (document, panel, token) => (await load()).resolveCustomEditor(document, panel, token),
    saveCustomDocument: async (document, token) => (await load()).saveCustomDocument(document, token),
    saveCustomDocumentAs: async (document, destination, token) => (await load()).saveCustomDocumentAs(document, destination, token),
    revertCustomDocument: async (document, token) => (await load()).revertCustomDocument(document, token),
    backupCustomDocument: async (document, backupContext, token) => (await load()).backupCustomDocument(document, backupContext, token)
  };
  context.subscriptions.push(
    registerTrackedCommand(CSV_VIEWER_COMMAND, async (target?: unknown) => (await viewer()).openSpreadsheetViewer(context, "csv", target)),
    registerTrackedCommand(EXCEL_VIEWER_COMMAND, async (target?: unknown) => (await viewer()).openSpreadsheetViewer(context, "xlsx", target)),
    vscode.commands.registerCommand(OPEN_IN_VIEWER_COMMAND, async (target?: unknown) => {
      const uri = target instanceof vscode.Uri ? target : vscode.window.activeTextEditor?.document.uri;
      // Runs through the tool commands, so usage and quests count it like the sidebar entry.
      await vscode.commands.executeCommand(uri && /\.xlsm?$/i.test(uri.path) ? EXCEL_VIEWER_COMMAND : CSV_VIEWER_COMMAND, uri);
    }),
    edits,
    ...VIEW_TYPES.map(viewType => vscode.window.registerCustomEditorProvider(viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      // One grid per file: edits live in the document, and a second grid would need syncing.
      supportsMultipleEditorsPerDocument: false
    }))
  );
}
