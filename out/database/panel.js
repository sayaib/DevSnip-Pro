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
exports.openDatabaseClient = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
const service_1 = require("./service");
const store_1 = require("./store");
const page_1 = require("./page");
const webview_ui_1 = require("../utils/webview-ui");
const service_2 = require("../theme/service");
const activation_1 = require("../onboarding/activation");
const VIEW_TYPE = "devsnip.databaseClient";
const hostUi = {
    confirm: async (message, detail, action) => {
        try {
            const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, action);
            return choice === action;
        }
        catch {
            // Hosts that reject modals must never be read as approval.
            return (0, webview_ui_1.confirmAction)(`${message} ${detail}`, action);
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
        }
        catch {
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
    baseDir: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    onConnected: () => { void (0, activation_1.reach)("first_database_connection"); }
};
/** Opens (or reveals) the Database Client panel. */
function openDatabaseClient(context) {
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
    const codiconsRoot = vscode.Uri.file(path.join(context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
    const { panel, created } = (0, webview_ui_1.openToolPanel)(VIEW_TYPE, "Database Client", {
        enableScripts: true,
        // Open tabs, scroll positions and half-typed queries survive switching editors.
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot, codiconsRoot]
    });
    if (!created)
        return;
    panel.iconPath = {
        light: vscode.Uri.joinPath(mediaRoot, "database-light.svg"),
        dark: vscode.Uri.joinPath(mediaRoot, "database-dark.svg")
    };
    const store = new store_1.ConnectionStore(context.globalState, context.secrets);
    const service = new service_1.DatabaseService(store, hostUi, () => (0, webview_ui_1.safePostMessage)(panel, { type: "connections", connections: service.views() }));
    (0, service_2.setWebviewHtml)(panel.webview, (0, page_1.renderDatabasePage)({
        cspSource: panel.webview.cspSource,
        scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "db-client.js")).toString(),
        codiconsUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
        platform: process.platform
    }));
    const subscription = panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || message.type !== "rpc" || typeof message.method !== "string")
            return;
        const id = message.id;
        try {
            const result = await service.handle(message.method, message.params ?? {});
            (0, webview_ui_1.safePostMessage)(panel, { type: "rpc", id, ok: true, result });
        }
        catch (error) {
            // service.handle only throws DbErrors that are already free of credentials.
            const safe = error instanceof types_1.DbError ? error : new types_1.DbError("Something went wrong.", "Try again, or reconnect.");
            (0, webview_ui_1.safePostMessage)(panel, { type: "rpc", id, ok: false, error: { message: safe.message, hint: safe.hint } });
        }
    });
    panel.onDidDispose(() => {
        subscription.dispose();
        void service.dispose();
    });
}
exports.openDatabaseClient = openDatabaseClient;
//# sourceMappingURL=panel.js.map