/**
 * The object returned for `require("vscode")` inside the unit suite.
 * Kept in its own module so the test helpers keep their own exports.
 */

type Listener = (...args: any[]) => any;

export const registeredCommands = new Map<string, Listener>();
export const shownMessages: { kind: string; message: string }[] = [];

function disposable() {
  return { dispose() { /* nothing to release in the stub */ } };
}

const api = {
  commands: {
    registerCommand(command: string, callback: Listener) {
      registeredCommands.set(command, callback);
      return disposable();
    },
    async executeCommand(command: string, ...args: any[]) {
      const handler = registeredCommands.get(command);
      return handler ? handler(...args) : undefined;
    }
  },
  window: {
    showInformationMessage(message: string) { shownMessages.push({ kind: "info", message }); return Promise.resolve(undefined); },
    showWarningMessage(message: string) { shownMessages.push({ kind: "warn", message }); return Promise.resolve(undefined); },
    showErrorMessage(message: string) { shownMessages.push({ kind: "error", message }); return Promise.resolve(undefined); },
    createWebviewPanel() { throw new Error("createWebviewPanel is not available in unit tests"); },
    createOutputChannel() { return { appendLine() {}, clear() {}, show() {}, dispose() {} }; },
    createTreeView() { return disposable(); },
    get activeTextEditor() { return undefined; }
  },
  workspace: {
    workspaceFolders: undefined as unknown[] | undefined,
    getConfiguration() { return { get: () => undefined }; },
    asRelativePath(value: any) { return String(value?.fsPath ?? value); },
    textDocuments: [] as unknown[]
  },
  env: {
    clipboard: { writeText: async () => undefined },
    openExternal: async () => true
  },
  Uri: {
    file(fsPath: string) { return { fsPath, scheme: "file", toString: () => `file://${fsPath}` }; },
    parse(value: string) { return { fsPath: value, scheme: "file", toString: () => value }; },
    joinPath(base: any, ...parts: string[]) {
      const joined = [base.fsPath, ...parts].join("/");
      return { fsPath: joined, scheme: "file", toString: () => `file://${joined}` };
    }
  },
  ViewColumn: { One: 1, Two: 2 },
  EventEmitter: class {
    event = () => disposable();
    fire() { /* no subscribers in the stub */ }
    dispose() { /* nothing to release */ }
  },
  ThemeIcon: class { constructor(public id: string) {} },
  ThemeColor: class { constructor(public id: string) {} },
  TreeItem: class { constructor(public label: string, public collapsibleState?: number) {} },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  Range: class { constructor(public start: unknown, public end: unknown) {} },
  Position: class { constructor(public line: number, public character: number) {} },
  WorkspaceEdit: class { delete() {} insert() {} },
  ProgressLocation: { Notification: 15 },
  RelativePattern: class { constructor(public base: unknown, public pattern: string) {} }
};

module.exports = Object.assign(api, { registeredCommands, shownMessages });
export default api;
