import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { trackToolUsed } from "../analytics";
import { reach } from "../onboarding/activation";
import { setWebviewHtml } from "../theme/service";
import { confirmAction, openToolPanel, safePostMessage } from "../utils/webview-ui";
import { OsvCache, OsvClient } from "./client";
import { renderOsvPage } from "./page";
import { SUPPORTED_FILE_NAMES } from "./parsers";
import { reportHtml, reportJson } from "./report";
import { runScan, ScanFile } from "./scan";
import type { ScanProgress, ScanResult } from "./types";
import { SUPPORTED_ECOSYSTEMS } from "./types";
import { discoverFiles, discoverWorkspace, FILE_DIALOG_FILTERS } from "./workspace";
import { detectFileType } from "./parsers";
import { resolveMavenProjects } from "./maven/index";
import { buildToolGate, clearPomCache, createGradleStrategy, createMavenStrategy } from "./maven/host";
import { resolveGradleProjects } from "./gradle/index";

/**
 * The OSV Vulnerability Scanner panel: one webview, one scan at a time.
 *
 * The page asks; the host scans, exports, opens files and links, and runs a
 * remediation command only after a modal confirmation, and only a command
 * that the current result actually suggested (a message cannot smuggle in its own).
 */

const VIEW_TYPE = "devsnipOsvScanner";
const CACHE_FILE = "osv-cache.json";
const TOOL_ID = "osvScanner";

interface Session {
  result?: ScanResult;
  running?: { controller: AbortController; startedAt: number; label: string };
  progress?: ScanProgress;
  error?: { message: string; kind?: string };
}

const session: Session = {};
/** Bumped by every scan; only the newest scan may publish a result. */
let generation = 0;
let lastContext: vscode.ExtensionContext | undefined;
let panel: vscode.WebviewPanel | undefined;
let ready = false;
const queue: unknown[] = [];
let cache: OsvCache | undefined;
let logChannel: vscode.LogOutputChannel | undefined;

/** "DevSnip Pro: OSV Scanner" in the Output panel: what each scan found, queried and dropped, stage by stage. */
function scanLog(): vscode.LogOutputChannel {
  logChannel ??= vscode.window.createOutputChannel("DevSnip Pro: OSV Scanner", { log: true });
  return logChannel;
}
let cacheLoad: Promise<OsvCache> | undefined;

function post(message: unknown): void {
  if (!panel) return;
  if (!ready) { queue.push(message); return; }
  safePostMessage(panel, message);
}

function workspaceInfo(): { name: string; folders: string[]; hasWorkspace: boolean } {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return { name: vscode.workspace.name ?? folders[0]?.name ?? "No folder open", folders: folders.map(f => f.name), hasWorkspace: folders.length > 0 };
}

function toolVersion(context: vscode.ExtensionContext): string {
  return String(context.extension?.packageJSON?.version ?? "dev");
}

async function loadCache(context: vscode.ExtensionContext): Promise<OsvCache> {
  if (cache) return cache;
  cacheLoad ??= (async () => {
    const fresh = new OsvCache(2000);
    try {
      if (context.globalStorageUri) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE));
        fresh.load(JSON.parse(Buffer.from(bytes).toString("utf8")));
      }
    } catch { /* first run, or an unreadable cache: start empty */ }
    cache = fresh;
    return fresh;
  })();
  return cacheLoad;
}

async function saveCache(context: vscode.ExtensionContext): Promise<void> {
  if (!cache?.dirty || !context.globalStorageUri) return;
  try {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(context.globalStorageUri, CACHE_FILE), Buffer.from(JSON.stringify(cache.toJSON()), "utf8"));
    cache.dirty = false;
  } catch (error) {
    console.warn("DevSnip Pro: could not save the OSV cache.", error);
  }
}

function initMessage(): unknown {
  return {
    type: "init",
    workspace: workspaceInfo(),
    ecosystems: SUPPORTED_ECOSYSTEMS,
    files: SUPPORTED_FILE_NAMES,
    result: session.result,
    running: session.running ? { label: session.running.label } : undefined,
    progress: session.progress,
    error: session.error
  };
}

/** Opens (or reveals) the scanner. `run` starts a workspace scan; `files` scans those files. */
export async function openOsvScanner(context: vscode.ExtensionContext, options: { run?: boolean; files?: vscode.Uri[] } = {}): Promise<void> {
  lastContext = context;
  const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
  const codiconsRoot = vscode.Uri.file(path.join(context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
  const opened = openToolPanel(VIEW_TYPE, "OSV Vulnerability Scanner", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
  if (opened.created) {
    panel = opened.panel;
    ready = false;
    queue.length = 0;
    panel.iconPath = { light: vscode.Uri.joinPath(mediaRoot, "osv-light.svg"), dark: vscode.Uri.joinPath(mediaRoot, "osv-dark.svg") };
    setWebviewHtml(panel.webview, renderOsvPage({
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
      if (panel === thisPanel) { panel = undefined; ready = false; queue.length = 0; }
      // A scan keeps running in the background and its result is shown when the panel reopens.
    });
  }
  if (options.files?.length) await startScan(context, { files: options.files });
  else if (options.run) await startScan(context, {});
}

async function handleMessage(context: vscode.ExtensionContext, message: { type?: string; [key: string]: unknown }): Promise<void> {
  switch (message?.type) {
    case "ready":
      ready = true;
      if (panel) safePostMessage(panel, initMessage());
      for (const queued of queue.splice(0)) if (panel) safePostMessage(panel, queued);
      return;
    case "scan":
      await startScan(context, { fresh: message.fresh === true });
      return;
    case "scanFiles": {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFiles: true, canSelectFolders: false, openLabel: "Scan", title: "Choose dependency files to scan", filters: FILE_DIALOG_FILTERS });
      if (picked?.length) await startScan(context, { files: picked });
      return;
    }
    case "cancel":
      session.running?.controller.abort();
      return;
    case "showLog":
      scanLog().show(true);
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
      if (!/^https?:\/\//i.test(url)) return;
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
      const store = await loadCache(context);
      store.clear();
      await saveCache(context);
      await clearPomCache(context);
      post({ type: "toast", kind: "ok", message: "Cleared cached OSV advisories and downloaded Maven POMs. The next scan fetches everything again." });
      return;
    }
  }
}

async function startScan(context: vscode.ExtensionContext, options: { fresh?: boolean; files?: vscode.Uri[] }): Promise<void> {
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
  const onProgress = (progress: ScanProgress) => { session.progress = progress; post({ type: "progress", progress }); };

  const token = new vscode.CancellationTokenSource();
  controller.signal.addEventListener("abort", () => token.cancel(), { once: true });
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "OSV scan" }, async report => {
      const discovery = options.files
        ? await discoverFiles(options.files, token.token)
        : await discoverWorkspace(token.token, (done, total) => onProgress({ phase: "discover", message: `Reading dependency files (${done}/${total})`, fraction: 0.02 + 0.03 * (done / Math.max(1, total)) }));
      const files: ScanFile[] = discovery.files;
      if (controller.signal.aborted) throw new vscode.CancellationError();
      const store = await loadCache(context);
      const client = new OsvClient({ userAgent: `DevSnip-Pro/${toolVersion(context)} (VS Code ${vscode.version}; OSV scanner)` });
      const log = scanLog();
      log.info(`---- OSV scan of ${label} (DevSnip Pro ${toolVersion(context)}) ----`);
      const pomPaths = files.filter(f => detectFileType(f.path)?.id === "pom").map(f => f.path);
      const allowBuildTools = buildToolGate(context, message => log.info(message));
      const result = await runScan(files, {
        onLog: message => log.info(message),
        resolveMaven: async (poms, signal) => {
          const strategy = await createMavenStrategy({ context, allowBuildTools, locations: discovery.locations, pomPaths, onLog: message => log.info(message) });
          return resolveMavenProjects(poms, strategy, { signal, onLog: message => log.info(message), onProgress: message => onProgress({ phase: "parse", message, fraction: 0.08 }) });
        },
        resolveGradle: async (gradleFiles, signal) => {
          const buildFiles = gradleFiles.filter(f => !f.context && /build\.gradle(\.kts)?$/.test(f.path)).map(f => f.path);
          const strategy = await createGradleStrategy({ context, allowBuildTools, locations: discovery.locations, buildFiles, onLog: message => log.info(message) });
          return resolveGradleProjects(gradleFiles, strategy, { signal, onLog: message => log.info(message), onProgress: message => onProgress({ phase: "parse", message, fraction: 0.09 }) });
        },
        client, cache: store, signal: controller.signal, fresh: options.fresh, toolVersion: toolVersion(context),
        workspace: { name: options.files ? label : info.name, folders: options.files ? [] : info.folders },
        // Files inside the workspace keep workspace-relative paths, so they can be opened and fixed from the panel.
        source: !options.files || discovery.inWorkspace ? "workspace" : "files",
        limitations: discovery.limitations,
        onProgress: progress => { onProgress(progress); report.report({ message: progress.message }); }
      });
      if (mine !== generation) return; // a newer scan owns the panel now
      session.result = result;
      session.progress = undefined;
      post({ type: "result", result });
      void saveCache(context);
      if (!result.cancelled) {
        trackToolUsed(TOOL_ID);
        void reach("first_security_scan");
      }
      notifyIfHidden(result);
    });
  } catch (error) {
    if (mine !== generation) return;
    session.progress = undefined;
    if (error instanceof vscode.CancellationError || controller.signal.aborted) {
      post({ type: "cancelled" });
    } else {
      session.error = { message: error instanceof Error ? error.message : String(error) };
      post({ type: "error", ...session.error });
    }
  } finally {
    token.dispose();
    if (session.running?.controller === controller) session.running = undefined;
  }
}

function notifyIfHidden(result: ScanResult): void {
  if (panel?.visible) return;
  const s = result.summary;
  const headline = s.findings
    ? `OSV scan: ${s.vulnerablePackages} vulnerable package${s.vulnerablePackages === 1 ? "" : "s"} (${s.critical} critical, ${s.high} high).`
    : `OSV scan: no known vulnerabilities in ${s.packages} package${s.packages === 1 ? "" : "s"}.`;
  void vscode.window.showInformationMessage(headline, "Show Results").then(choice => {
    if (choice === "Show Results") panel?.reveal();
  });
}

async function openFile(file: string, line: number): Promise<void> {
  if (!file) return;
  const folders = vscode.workspace.workspaceFolders ?? [];
  let uri: vscode.Uri | undefined;
  // Multi-root paths start with the folder name.
  const [first, ...rest] = file.split("/");
  const named = folders.find(f => f.name === first);
  if (named && folders.length > 1) uri = vscode.Uri.joinPath(named.uri, ...rest);
  else if (folders[0]) uri = vscode.Uri.joinPath(folders[0].uri, ...file.split("/"));
  if (!uri) { post({ type: "toast", kind: "error", message: `${file} is outside the workspace.` }); return; }
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const target = Math.max(0, Math.min(line - 1, document.lineCount - 1));
    const position = new vscode.Position(target, 0);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, selection: new vscode.Range(position, position) });
  } catch (error) {
    post({ type: "toast", kind: "error", message: `Could not open ${file}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function exportReport(format: "json" | "html"): Promise<void> {
  const result = session.result;
  if (!result) { post({ type: "toast", message: "Run a scan first; there is nothing to export yet." }); return; }
  const stamp = result.finishedAt.replace(/[:.]/g, "-").slice(0, 19);
  const name = `osv-report-${result.workspace.name.replace(/[^\w.-]+/g, "-")}-${stamp}.${format}`;
  const root = vscode.workspace.workspaceFolders?.[0];
  const target = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root.uri, name) : vscode.Uri.file(path.join(os.homedir(), name)),
    filters: format === "json" ? { JSON: ["json"] } : { HTML: ["html"] },
    saveLabel: "Export report",
    title: `Export OSV report as ${format.toUpperCase()}`
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(format === "json" ? reportJson(result) : reportHtml(result), "utf8"));
  post({ type: "toast", kind: "ok", message: `Report saved to ${path.basename(target.fsPath)}.` });
  const action = format === "html" ? "Open in Browser" : "Open";
  const choice = await vscode.window.showInformationMessage(`OSV report saved to ${path.basename(target.fsPath)}.`, action);
  if (choice === "Open in Browser") await vscode.env.openExternal(target);
  else if (choice === "Open") await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target));
}

async function runRemediation(command: string, cwd: string): Promise<void> {
  const suggested = session.result?.remediations.some(r => r.commands.some(c => c.command === command && c.cwd === cwd));
  if (!suggested) { post({ type: "toast", kind: "error", message: "That command is not part of the current scan's suggestions." }); return; }
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
  const confirmed = await confirmAction(
    `Run this command in ${where}?\n\n${command}\n\nIt changes your dependencies and lockfile. Review the advisory and commit or stash your work first.`,
    "Run in Terminal",
    "warning"
  );
  if (!confirmed) return;
  const terminal = vscode.window.createTerminal({ name: "DevSnip Pro · OSV fix", cwd: dir });
  terminal.show();
  terminal.sendText(command, true);
  post({ type: "toast", kind: "ok", message: "Sent to the terminal. Scan again when it finishes to confirm the fix." });
}

/** For tests: the scanner's in-memory state. Clears the last result and the advisory cache so each test talks to its own fake OSV. */
export function osvSessionForTests(reset = false): Session {
  if (reset) {
    session.result = undefined;
    cache?.clear();
    if (lastContext) void clearPomCache(lastContext);
  }
  return session;
}
