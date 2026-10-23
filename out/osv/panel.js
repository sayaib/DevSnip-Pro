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
exports.osvSessionForTests = exports.openOsvScanner = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const analytics_1 = require("../analytics");
const activation_1 = require("../onboarding/activation");
const service_1 = require("../theme/service");
const webview_ui_1 = require("../utils/webview-ui");
const engine_1 = require("./engine");
const page_1 = require("./page");
const parsers_1 = require("./parsers");
const report_1 = require("./report");
const types_1 = require("./types");
const workspace_1 = require("./workspace");
const host_1 = require("./maven/host");
/**
 * The OSV Vulnerability Scanner panel: one webview, one scan at a time.
 *
 * The page asks; the host scans, exports, opens files and links, and runs a
 * remediation command only after a modal confirmation, and only a command
 * that the current result actually suggested (a message cannot smuggle in its own).
 */
const VIEW_TYPE = "devsnipOsvScanner";
const TOOL_ID = "osvScanner";
const session = {};
/** Bumped by every scan; only the newest scan may publish a result. */
let generation = 0;
let lastContext;
let panel;
let ready = false;
const queue = [];
function post(message) {
    if (!panel)
        return;
    if (!ready) {
        queue.push(message);
        return;
    }
    (0, webview_ui_1.safePostMessage)(panel, message);
}
function workspaceInfo() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    return { name: vscode.workspace.name ?? folders[0]?.name ?? "No folder open", folders: folders.map(f => f.name), hasWorkspace: folders.length > 0 };
}
function initMessage() {
    return {
        type: "init",
        workspace: workspaceInfo(),
        ecosystems: types_1.SUPPORTED_ECOSYSTEMS,
        files: parsers_1.SUPPORTED_FILE_NAMES,
        result: session.result,
        running: session.running ? { label: session.running.label } : undefined,
        progress: session.progress,
        error: session.error
    };
}
/** Opens (or reveals) the scanner. `run` starts a workspace scan; `files` scans those files. */
async function openOsvScanner(context, options = {}) {
    lastContext = context;
    const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
    const codiconsRoot = vscode.Uri.file(path.join(context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
    const opened = (0, webview_ui_1.openToolPanel)(VIEW_TYPE, "OSV Vulnerability Scanner", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
    if (opened.created) {
        panel = opened.panel;
        ready = false;
        queue.length = 0;
        panel.iconPath = { light: vscode.Uri.joinPath(mediaRoot, "osv-light.svg"), dark: vscode.Uri.joinPath(mediaRoot, "osv-dark.svg") };
        (0, service_1.setWebviewHtml)(panel.webview, (0, page_1.renderOsvPage)({
            cspSource: panel.webview.cspSource,
            scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "osv-scanner.js")).toString(),
            codiconsUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString()
        }));
        const thisPanel = panel;
        const subscription = panel.webview.onDidReceiveMessage(message => {
            handleMessage(context, message).catch(error => {
                console.error("DevSnip Pro: OSV scanner action failed.", error);
                post({ type: "toast", kind: "error", message: `That did not work: ${error instanceof Error ? error.message : String(error)}` });
            });
        });
        panel.onDidDispose(() => {
            subscription.dispose();
            if (panel === thisPanel) {
                panel = undefined;
                ready = false;
                queue.length = 0;
            }
            // A scan keeps running in the background and its result is shown when the panel reopens.
        });
    }
    if (options.files?.length)
        await startScan(context, { files: options.files });
    else if (options.run)
        await startScan(context, {});
}
exports.openOsvScanner = openOsvScanner;
async function handleMessage(context, message) {
    switch (message?.type) {
        case "ready":
            ready = true;
            if (panel)
                (0, webview_ui_1.safePostMessage)(panel, initMessage());
            for (const queued of queue.splice(0))
                if (panel)
                    (0, webview_ui_1.safePostMessage)(panel, queued);
            return;
        case "scan":
            await startScan(context, { fresh: message.fresh === true });
            return;
        case "scanFiles": {
            const picked = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, openLabel: "Scan", title: "Choose dependency files to scan", filters: workspace_1.FILE_DIALOG_FILTERS });
            if (picked?.length)
                await startScan(context, { files: picked });
            return;
        }
        case "cancel":
            session.running?.controller.abort();
            return;
        case "showLog":
            (0, engine_1.scanLog)().show(true);
            return;
        case "mavenSettings":
            await vscode.commands.executeCommand("workbench.action.openSettings", "devsnip.osvScanner");
            return;
        case "openFolder":
            await vscode.commands.executeCommand("workbench.action.files.openFolder");
            return;
        case "export":
            await exportReport(message.format === "html" ? "html" : "json");
            return;
        case "openFile":
            await openFile(String(message.file ?? ""), Number(message.line) || 1);
            return;
        case "openExternal": {
            const url = String(message.url ?? "");
            if (!/^https?:\/\//i.test(url))
                return;
            await vscode.env.openExternal(vscode.Uri.parse(url));
            return;
        }
        case "copy":
            await vscode.env.clipboard.writeText(String(message.text ?? ""));
            post({ type: "toast", kind: "ok", message: message.label ? `Copied ${String(message.label)}.` : "Copied to the clipboard." });
            return;
        case "runCommand":
            await runRemediation(String(message.command ?? ""), String(message.cwd ?? ""));
            return;
        case "clearCache": {
            const store = await (0, engine_1.loadCache)(context);
            store.clear();
            await (0, engine_1.saveCache)(context);
            await (0, host_1.clearPomCache)(context);
            post({ type: "toast", kind: "ok", message: "Cleared cached OSV advisories and downloaded Maven POMs. The next scan fetches everything again." });
            return;
        }
    }
}
async function startScan(context, options) {
    if (session.running) {
        post({ type: "toast", message: "A scan is already running. Cancel it first to start another." });
        return;
    }
    const info = workspaceInfo();
    if (!options.files && !info.hasWorkspace) {
        session.error = { message: "Open a folder or workspace to scan its dependencies, or choose dependency files to scan.", kind: "no-workspace" };
        post({ type: "error", ...session.error });
        return;
    }
    const controller = new AbortController();
    const mine = ++generation;
    const label = options.files ? (options.files.length === 1 ? path.basename(options.files[0].fsPath) : `${options.files.length} selected items`) : info.name;
    session.running = { controller, startedAt: Date.now(), label };
    session.error = undefined;
    session.progress = { phase: "discover", message: "Looking for dependency files…", fraction: 0.01 };
    post({ type: "started", label, progress: session.progress });
    const onProgress = (progress) => { session.progress = progress; post({ type: "progress", progress }); };
    const token = new vscode.CancellationTokenSource();
    controller.signal.addEventListener("abort", () => token.cancel(), { once: true });
    try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "OSV scan" }, async (report) => {
            const discovery = options.files
                ? await (0, workspace_1.discoverFiles)(options.files, token.token)
                : await (0, workspace_1.discoverWorkspace)(token.token, (done, total) => onProgress({ phase: "discover", message: `Reading dependency files (${done}/${total})`, fraction: 0.02 + 0.03 * (done / Math.max(1, total)) }));
            if (controller.signal.aborted)
                throw new vscode.CancellationError();
            const { result } = await (0, engine_1.runEngineScan)({
                context, discovery, label, title: "OSV scan", signal: controller.signal, fresh: options.fresh,
                workspace: { name: options.files ? label : info.name, folders: options.files ? [] : info.folders },
                // Files inside the workspace keep workspace-relative paths, so they can be opened and fixed from the panel.
                source: !options.files || discovery.inWorkspace ? "workspace" : "files",
                onProgress: progress => { onProgress(progress); report.report({ message: progress.message }); }
            });
            if (mine !== generation)
                return; // a newer scan owns the panel now
            session.result = result;
            session.progress = undefined;
            post({ type: "result", result });
            if (!result.cancelled) {
                (0, analytics_1.trackToolUsed)(TOOL_ID);
                void (0, activation_1.reach)("first_security_scan");
            }
            notifyIfHidden(result);
        });
    }
    catch (error) {
        if (mine !== generation)
            return;
        session.progress = undefined;
        if (error instanceof vscode.CancellationError || controller.signal.aborted) {
            post({ type: "cancelled" });
        }
        else {
            session.error = { message: error instanceof Error ? error.message : String(error) };
            post({ type: "error", ...session.error });
        }
    }
    finally {
        token.dispose();
        if (session.running?.controller === controller)
            session.running = undefined;
    }
}
function notifyIfHidden(result) {
    if (panel?.visible)
        return;
    const s = result.summary;
    const headline = s.findings
        ? `OSV scan: ${s.vulnerablePackages} vulnerable package${s.vulnerablePackages === 1 ? "" : "s"} (${s.critical} critical, ${s.high} high).`
        : `OSV scan: no known vulnerabilities in ${s.packages} package${s.packages === 1 ? "" : "s"}.`;
    void vscode.window.showInformationMessage(headline, "Show Results").then(choice => {
        if (choice === "Show Results")
            panel?.reveal();
    });
}
async function openFile(file, line) {
    if (!file)
        return;
    const folders = vscode.workspace.workspaceFolders ?? [];
    let uri;
    // Multi-root paths start with the folder name.
    const [first, ...rest] = file.split("/");
    const named = folders.find(f => f.name === first);
    if (named && folders.length > 1)
        uri = vscode.Uri.joinPath(named.uri, ...rest);
    else if (folders[0])
        uri = vscode.Uri.joinPath(folders[0].uri, ...file.split("/"));
    if (!uri) {
        post({ type: "toast", kind: "error", message: `${file} is outside the workspace.` });
        return;
    }
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        const target = Math.max(0, Math.min(line - 1, document.lineCount - 1));
        const position = new vscode.Position(target, 0);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, selection: new vscode.Range(position, position) });
    }
    catch (error) {
        post({ type: "toast", kind: "error", message: `Could not open ${file}: ${error instanceof Error ? error.message : String(error)}` });
    }
}
async function exportReport(format) {
    const result = session.result;
    if (!result) {
        post({ type: "toast", message: "Run a scan first; there is nothing to export yet." });
        return;
    }
    const stamp = result.finishedAt.replace(/[:.]/g, "-").slice(0, 19);
    const name = `osv-report-${result.workspace.name.replace(/[^\w.-]+/g, "-")}-${stamp}.${format}`;
    const root = vscode.workspace.workspaceFolders?.[0];
    const target = await vscode.window.showSaveDialog({
        defaultUri: root ? vscode.Uri.joinPath(root.uri, name) : vscode.Uri.file(path.join(os.homedir(), name)),
        filters: format === "json" ? { JSON: ["json"] } : { HTML: ["html"] },
        saveLabel: "Export report",
        title: `Export OSV report as ${format.toUpperCase()}`
    });
    if (!target)
        return;
    await vscode.workspace.fs.writeFile(target, Buffer.from(format === "json" ? (0, report_1.reportJson)(result) : (0, report_1.reportHtml)(result), "utf8"));
    post({ type: "toast", kind: "ok", message: `Report saved to ${path.basename(target.fsPath)}.` });
    const action = format === "html" ? "Open in Browser" : "Open";
    const choice = await vscode.window.showInformationMessage(`OSV report saved to ${path.basename(target.fsPath)}.`, action);
    if (choice === "Open in Browser")
        await vscode.env.openExternal(target);
    else if (choice === "Open")
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
}
async function runRemediation(command, cwd) {
    const suggested = session.result?.remediations.some(r => r.commands.some(c => c.command === command && c.cwd === cwd));
    if (!suggested) {
        post({ type: "toast", kind: "error", message: "That command is not part of the current scan's suggestions." });
        return;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length || session.result?.source !== "workspace") {
        await vscode.env.clipboard.writeText(command);
        post({ type: "toast", message: "Copied the command. Run it in the project's folder (the scanned files are not in an open workspace)." });
        return;
    }
    const [first, ...rest] = cwd.split("/").filter(Boolean);
    const named = folders.length > 1 ? folders.find(f => f.name === first) : undefined;
    const dir = named ? vscode.Uri.joinPath(named.uri, ...rest) : vscode.Uri.joinPath(folders[0].uri, ...cwd.split("/").filter(Boolean));
    const where = vscode.workspace.asRelativePath(dir, folders.length > 1) || folders[0].name;
    const confirmed = await (0, webview_ui_1.confirmAction)(`Run this command in ${where}?\n\n${command}\n\nIt changes your dependencies and lockfile. Review the advisory and commit or stash your work first.`, "Run in Terminal", "warning");
    if (!confirmed)
        return;
    const terminal = vscode.window.createTerminal({ name: "DevSnip Pro · OSV fix", cwd: dir });
    terminal.show();
    terminal.sendText(command, true);
    post({ type: "toast", kind: "ok", message: "Sent to the terminal. Scan again when it finishes to confirm the fix." });
}
/** For tests: the scanner's in-memory state. Clears the last result and the advisory cache so each test talks to its own fake OSV. */
function osvSessionForTests(reset = false) {
    if (reset) {
        session.result = undefined;
        (0, engine_1.clearMemoryCache)();
        if (lastContext)
            void (0, host_1.clearPomCache)(lastContext);
    }
    return session;
}
exports.osvSessionForTests = osvSessionForTests;
//# sourceMappingURL=panel.js.map