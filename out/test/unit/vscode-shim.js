"use strict";
/**
 * The object returned for `require("vscode")` inside the unit suite.
 * Kept in its own module so the test helpers keep their own exports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shownMessages = exports.registeredCommands = void 0;
exports.registeredCommands = new Map();
exports.shownMessages = [];
function disposable() {
    return { dispose() { } };
}
const api = {
    commands: {
        registerCommand(command, callback) {
            exports.registeredCommands.set(command, callback);
            return disposable();
        },
        async executeCommand(command, ...args) {
            const handler = exports.registeredCommands.get(command);
            return handler ? handler(...args) : undefined;
        }
    },
    window: {
        showInformationMessage(message) { exports.shownMessages.push({ kind: "info", message }); return Promise.resolve(undefined); },
        showWarningMessage(message) { exports.shownMessages.push({ kind: "warn", message }); return Promise.resolve(undefined); },
        showErrorMessage(message) { exports.shownMessages.push({ kind: "error", message }); return Promise.resolve(undefined); },
        createWebviewPanel() { throw new Error("createWebviewPanel is not available in unit tests"); },
        createOutputChannel() { return { appendLine() { }, clear() { }, show() { }, dispose() { } }; },
        createTreeView() { return disposable(); },
        get activeTextEditor() { return undefined; }
    },
    workspace: {
        workspaceFolders: undefined,
        getConfiguration() { return { get: () => undefined }; },
        asRelativePath(value) { return String(value?.fsPath ?? value); },
        textDocuments: []
    },
    env: {
        clipboard: { writeText: async () => undefined },
        openExternal: async () => true
    },
    Uri: {
        file(fsPath) { return { fsPath, scheme: "file", toString: () => `file://${fsPath}` }; },
        parse(value) { return { fsPath: value, scheme: "file", toString: () => value }; },
        joinPath(base, ...parts) {
            const joined = [base.fsPath, ...parts].join("/");
            return { fsPath: joined, scheme: "file", toString: () => `file://${joined}` };
        }
    },
    ViewColumn: { One: 1, Two: 2 },
    EventEmitter: class {
        constructor() {
            this.event = () => disposable();
        }
        fire() { }
        dispose() { }
    },
    ThemeIcon: class {
        constructor(id) {
            this.id = id;
        }
    },
    ThemeColor: class {
        constructor(id) {
            this.id = id;
        }
    },
    TreeItem: class {
        constructor(label, collapsibleState) {
            this.label = label;
            this.collapsibleState = collapsibleState;
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    Range: class {
        constructor(start, end) {
            this.start = start;
            this.end = end;
        }
    },
    Position: class {
        constructor(line, character) {
            this.line = line;
            this.character = character;
        }
    },
    WorkspaceEdit: class {
        delete() { }
        insert() { }
    },
    ProgressLocation: { Notification: 15 },
    RelativePattern: class {
        constructor(base, pattern) {
            this.base = base;
            this.pattern = pattern;
        }
    }
};
module.exports = Object.assign(api, { registeredCommands: exports.registeredCommands, shownMessages: exports.shownMessages });
exports.default = api;
//# sourceMappingURL=vscode-shim.js.map