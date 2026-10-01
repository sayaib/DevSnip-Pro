import * as path from "path";
import * as vscode from "vscode";
import { DbError } from "./types";
import { DatabaseService, HostUi } from "./service";
import { ConnectionStore } from "./store";
import { renderDatabasePage } from "./page";
import { confirmAction, openToolPanel, safePostMessage } from "../utils/webview-ui";

const VIEW_TYPE = "devsnip.databaseClient";

const hostUi: HostUi = {
  confirm: async (message, detail, action) => {
    try {
      const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
      return choice === action;
    } catch {
      // Hosts that reject modals must never be read as approval.
      return confirmAction(`${message} ${detail}`, action);
    }
  },
  confirmByTyping: async (message, expected) => {
    try {
      const typed = await vscode.window.showInputBox({
        title: "Confirm a destructive action",
        prompt: `${message} Type "${expected}" to confirm.`,
        placeHolder: expected,
        ignoreFocusOut: true,
        validateInput: value => (value === expected || !value ? undefined : `Type "${expected}" exactly.`)
      });
      return typed === expected;
    } catch {
      return false;
    }
  },
  pickSqliteFile: async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Open SQLite database",
      filters: { "SQLite databases": ["db", "sqlite", "sqlite3", "db3", "s3db", "sl3"], "All files": ["*"] }
    });
    return picked?.[0]?.fsPath;
  },
  copy: text => Promise.resolve(vscode.env.clipboard.writeText(text)),
  openDocument: async (content, language) => {
    const doc = await vscode.workspace.openTextDocument({ content, language });
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  },
  baseDir: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
};

/** Opens (or reveals) the Database Client panel. */
export function openDatabaseClient(context: vscode.ExtensionContext): void {
  const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
  const codiconsRoot = vscode.Uri.file(path.join(context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
  const { panel, created } = openToolPanel(VIEW_TYPE, "Database Client", {
    enableScripts: true,
    // Open tabs, scroll positions and half-typed queries survive switching editors.
    retainContextWhenHidden: true,
    localResourceRoots: [mediaRoot, codiconsRoot]
  });
  if (!created) return;
  panel.iconPath = {
    light: vscode.Uri.joinPath(mediaRoot, "database-light.svg"),
    dark: vscode.Uri.joinPath(mediaRoot, "database-dark.svg")
  };

  const store = new ConnectionStore(context.globalState, context.secrets);
  const service: DatabaseService = new DatabaseService(store, hostUi, () => safePostMessage(panel, { type: "connections", connections: service.views() }));

  panel.webview.html = renderDatabasePage({
    cspSource: panel.webview.cspSource,
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "db-client.js")).toString(),
    codiconsUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
    platform: process.platform
  });

  const subscription = panel.webview.onDidReceiveMessage(async message => {
    if (!message || message.type !== "rpc" || typeof message.method !== "string") return;
    const id = message.id;
    try {
      const result = await service.handle(message.method, message.params ?? {});
      safePostMessage(panel, { type: "rpc", id, ok: true, result });
    } catch (error) {
      // service.handle only throws DbErrors that are already free of credentials.
      const safe = error instanceof DbError ? error : new DbError("Something went wrong.", "Try again, or reconnect.");
      safePostMessage(panel, { type: "rpc", id, ok: false, error: { message: safe.message, hint: safe.hint } });
    }
  });

  panel.onDidDispose(() => {
    subscription.dispose();
    void service.dispose();
  });
}
