import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { trackToolUsed } from "../analytics";
import { reach } from "../onboarding/activation";
import { setWebviewHtml } from "../theme/service";
import { confirmAction, openToolPanel, safePostMessage } from "../utils/webview-ui";
import { clearMemoryCache, loadCache, runEngineScan, saveCache, scanLog } from "../osv/engine";
import { clearPomCache } from "../osv/maven/host";
import { SUPPORTED_ECOSYSTEMS } from "../osv/types";
import type { ScanProgress } from "../osv/types";
import { discoverWorkspace, Discovery } from "../osv/workspace";
import { analyseScan } from "./engine";
import { applyEdit, describeEdit, EditSpec } from "./edits";
import { clearScaCaches, createScaProviders, NVD_KEY_SECRET, saveScaCaches, scaSettings } from "./host";
import { renderScaPage } from "./page";
import { detectProjects, filesForProjects } from "./projects";
import { scaCsv, scaJson } from "./report";
import type { AdviceOption, ScaProject, ScaResult } from "./types";

/**
 * The SCA Scanner panel. It scans through the shared vulnerability engine
 * (the same one as the OSV Vulnerability Scanner), then adds known
 * exploitation, NVD scores, dependency health and remediation advice.
 *
 * Project files change only through "Apply": the edit must be one the current
 * result proposed, it is recomputed from the file's current text, shown as a
 * diff on request, and written only after a modal confirmation.
 */

const VIEW_TYPE = "devsnipScaScanner";
const TOOL_ID = "scaScanner";
const PREVIEW_SCHEME = "devsnip-sca-preview";

interface Session {
  result?: ScaResult;
  projects?: ScaProject[];
  running?: { controller: AbortController; startedAt: number; label: string };
  progress?: ScanProgress;
  error?: { message: string; kind?: string };
}

const session: Session = {};
let generation = 0;
let panel: vscode.WebviewPanel | undefined;
let ready = false;
const queue: unknown[] = [];
const previews = new Map<string, string>();
let previewEmitter: vscode.EventEmitter<vscode.Uri> | undefined;
let lastContext: vscode.ExtensionContext | undefined;

function post(message: unknown): void {
  if (!panel) return;
  if (!ready) { queue.push(message); return; }
  safePostMessage(panel, message);
}

function workspaceInfo(): { name: string; folders: string[]; hasWorkspace: boolean; trusted: boolean } {
  const folders = vscode.workspace.workspaceFolders ?? [];
  return { name: vscode.workspace.name ?? folders[0]?.name ?? "No folder open", folders: folders.map(f => f.name), hasWorkspace: folders.length > 0, trusted: vscode.workspace.isTrusted };
}

async function initMessage(context: vscode.ExtensionContext): Promise<unknown> {
  let hasNvdKey = false;
  try { hasNvdKey = Boolean(await context.secrets?.get(NVD_KEY_SECRET)); } catch { /* no secret storage */ }
  return {
    type: "init",
    workspace: workspaceInfo(),
    ecosystems: SUPPORTED_ECOSYSTEMS,
    settings: { ...scaSettings(), hasNvdKey },
    projects: session.projects,
    result: session.result,
    running: session.running ? { label: session.running.label } : undefined,
    progress: session.progress,
    error: session.error
  };
}

export async function openScaScanner(context: vscode.ExtensionContext, options: { run?: boolean } = {}): Promise<void> {
  lastContext = context;
  ensurePreviewProvider(context);
  const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
  const codiconsRoot = vscode.Uri.file(path.join(context.extensionPath, "node_modules", "@vscode", "codicons", "dist"));
  const opened = openToolPanel(VIEW_TYPE, "SCA Scanner", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
  if (opened.created) {
    panel = opened.panel;
    ready = false;
    queue.length = 0;
    panel.iconPath = { light: vscode.Uri.joinPath(mediaRoot, "osv-light.svg"), dark: vscode.Uri.joinPath(mediaRoot, "osv-dark.svg") };
    setWebviewHtml(panel.webview, renderScaPage({
      cspSource: panel.webview.cspSource,
      modelUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "sca-model.js")).toString(),
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "sca-scanner.js")).toString(),
      codiconsUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString()
    }));
    const thisPanel = panel;
    const subscription = panel.webview.onDidReceiveMessage(message => {
      handleMessage(context, message).catch(error => {
        console.error("DevSnip Pro: SCA scanner action failed.", error);
        post({ type: "toast", kind: "error", message: `That did not work: ${error instanceof Error ? error.message : String(error)}` });
      });
    });
    panel.onDidDispose(() => {
      subscription.dispose();
      if (panel === thisPanel) { panel = undefined; ready = false; queue.length = 0; }
    });
  }
  if (options.run) await startScan(context, {});
}

async function handleMessage(context: vscode.ExtensionContext, message: { type?: string; [key: string]: unknown }): Promise<void> {
  switch (message?.type) {
    case "ready":
      ready = true;
      if (panel) safePostMessage(panel, await initMessage(context));
      for (const queued of queue.splice(0)) if (panel) safePostMessage(panel, queued);
      if (!session.projects && !session.running && workspaceInfo().hasWorkspace) void detect();
      return;
    case "detect":
      await detect();
      return;
    case "scan": {
      const dirs = Array.isArray(message.projects) ? message.projects.filter((d): d is string => typeof d === "string") : undefined;
      await startScan(context, { fresh: message.fresh === true, projects: dirs });
      return;
    }
    case "cancel":
      session.running?.controller.abort();
      return;
    case "showLog":
      scanLog().show(true);
      return;
    case "settings":
      await vscode.commands.executeCommand("workbench.action.openSettings", message.section === "build" ? "devsnip.osvScanner" : "devsnip.sca");
      return;
    case "openFolder":
      await vscode.commands.executeCommand("workbench.action.files.openFolder");
      return;
    case "export":
      await exportReport(message.format === "csv" ? "csv" : "json");
      return;
    case "openFile":
      await openFile(String(message.file ?? ""), Number(message.line) || 0);
      return;
    case "openExternal": {
      const url = String(message.url ?? "");
      if (/^https?:\/\//i.test(url)) await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    case "copy":
      await vscode.env.clipboard.writeText(String(message.text ?? ""));
      post({ type: "toast", kind: "ok", message: message.label ? `Copied ${String(message.label)}.` : "Copied to the clipboard." });
      return;
    case "preview":
      await previewOption(String(message.option ?? ""));
      return;
    case "apply":
      await applyOption(String(message.option ?? ""));
      return;
    case "runCommand":
      await runCommand(String(message.command ?? ""), String(message.cwd ?? ""));
      return;
    case "nvdKey":
      await setNvdKey(context);
      return;
    case "clearCache":
      (await loadCache(context)).clear();
      await saveCache(context);
      await clearPomCache(context);
      await clearScaCaches(context);
      post({ type: "toast", kind: "ok", message: "Cleared cached advisories, POMs, NVD scores, registry data and the KEV catalog." });
      return;
  }
}

/* ------------------------------------------------------------------ *
 * Projects and scanning
 * ------------------------------------------------------------------ */

async function detect(): Promise<Discovery | undefined> {
  if (!workspaceInfo().hasWorkspace) return undefined;
  post({ type: "detecting" });
  try {
    const discovery = await discoverWorkspace();
    session.projects = detectProjects(discovery.files, workspaceInfo().name);
    post({ type: "projects", projects: session.projects });
    return discovery;
  } catch (error) {
    post({ type: "projects", projects: [], error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

async function startScan(context: vscode.ExtensionContext, options: { fresh?: boolean; projects?: string[] }): Promise<void> {
  if (session.running) { post({ type: "toast", message: "A scan is already running. Cancel it first to start another." }); return; }
  const info = workspaceInfo();
  if (!info.hasWorkspace) {
    session.error = { message: "Open a folder or workspace to scan its dependencies.", kind: "no-workspace" };
    post({ type: "error", ...session.error });
    return;
  }
  const controller = new AbortController();
  const mine = ++generation;
  const startedAt = Date.now();
  session.running = { controller, startedAt, label: info.name };
  session.error = undefined;
  session.progress = { phase: "discover", message: "Looking for dependency files…", fraction: 0.01 };
  post({ type: "started", label: info.name, progress: session.progress });
  const onProgress = (progress: ScanProgress) => { if (mine !== generation) return; session.progress = progress; post({ type: "progress", progress }); };
  const token = new vscode.CancellationTokenSource();
  controller.signal.addEventListener("abort", () => token.cancel(), { once: true });
  const log = scanLog();
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "SCA scan" }, async report => {
      const discoverStarted = Date.now();
      const discovery = await discoverWorkspace(token.token, (done, total) => onProgress({ phase: "discover", message: `Reading dependency files (${done}/${total})`, fraction: 0.02 + 0.03 * (done / Math.max(1, total)) }));
      const discoverMs = Date.now() - discoverStarted;
      if (controller.signal.aborted) throw new vscode.CancellationError();
      const projects = detectProjects(discovery.files, info.name);
      session.projects = projects;
      post({ type: "projects", projects });
      const wanted = options.projects?.length ? projects.filter(p => options.projects!.includes(p.dir)) : projects;
      const partial = wanted.length > 0 && wanted.length < projects.length;
      const under = (dir: string, file: string) => dir === "" || file.startsWith(`${dir}/`);
      const selected: Discovery = partial
        ? { ...discovery, files: filesForProjects(discovery.files, wanted.map(p => p.dir)), unsupported: discovery.unsupported?.filter(u => wanted.some(p => under(p.dir, u.path))) }
        : discovery;
      const label = partial ? (wanted.length === 1 ? wanted[0].name : `${wanted.length} projects in ${info.name}`) : info.name;
      if (session.running) session.running.label = label;
      const { result: scan, client } = await runEngineScan({
        context, discovery: selected, label, title: "SCA scan", signal: controller.signal, fresh: options.fresh,
        workspace: { name: label, folders: info.folders },
        source: "workspace",
        onProgress: progress => { onProgress({ ...progress, fraction: progress.fraction * 0.9 }); report.report({ message: progress.message }); }
      });
      if (mine !== generation) return;
      const providers = await createScaProviders(context, message => log.info(message), client);
      const texts = new Map(selected.files.filter(f => f.text !== undefined).map(f => [f.path, f.text!]));
      const discoveryFacts = { durationMs: discoverMs, leftOutAsBuildOutput: discovery.generated?.files ?? 0 };
      const result = scan.cancelled
        ? await analyseScan(scan, { healthScope: "off" }, { projects: wanted, texts, toolVersion: scan.toolVersion, startedAt, signal: controller.signal, discovery: discoveryFacts })
        : await analyseScan(scan, providers, {
          projects: wanted, texts, toolVersion: scan.toolVersion, startedAt, signal: controller.signal, discovery: discoveryFacts,
          onProgress: (message, fraction) => { onProgress({ phase: "verify", message, fraction }); report.report({ message }); }
        });
      if (controller.signal.aborted && result.status !== "cancelled") result.status = "cancelled";
      void saveScaCaches(context);
      for (const provider of result.providers) log.info(`SCA ${provider.id}: ${provider.status} — ${provider.message}`);
      const dg = result.diagnostics;
      log.info(`SCA diagnostics: status ${dg.status}${dg.incompleteReasons.length ? ` (${dg.incompleteReasons.join("; ")})` : ""}; ${dg.projects.length} projects; files ${dg.files.scanned} scanned, ${dg.files.failed.length} unreadable, ${dg.files.unsupported.length} unsupported, ${dg.files.leftOutAsBuildOutput} in build output; dependencies ${dg.dependencies.discovered} (${dg.dependencies.direct} direct, ${dg.dependencies.transitive} transitive, ${dg.dependencies.relationUnknown} unknown, ${dg.dependencies.unresolved} unresolved); ${dg.advisories.packagesChecked} checked with OSV, ${dg.advisories.findings} findings from ${dg.advisories.unique} advisories; timings ${Object.entries(dg.timings).map(([k, v]) => `${k} ${v} ms`).join(", ")}.`);
      if (mine !== generation) return;
      session.result = result;
      session.progress = undefined;
      previews.clear();
      post({ type: "result", result });
      if (result.status !== "cancelled") {
        trackToolUsed(TOOL_ID);
        void reach("first_security_scan");
      }
      notifyIfHidden(result);
    });
  } catch (error) {
    if (mine !== generation) return;
    session.progress = undefined;
    if (error instanceof vscode.CancellationError || controller.signal.aborted) post({ type: "cancelled" });
    else {
      session.error = { message: error instanceof Error ? error.message : String(error) };
      post({ type: "error", ...session.error });
    }
  } finally {
    token.dispose();
    if (session.running?.controller === controller) session.running = undefined;
  }
}

function notifyIfHidden(result: ScaResult): void {
  if (panel?.visible) return;
  const s = result.summary;
  const headline = s.vulnerableDependencies
    ? `SCA scan: ${s.vulnerableDependencies} vulnerable dependenc${s.vulnerableDependencies === 1 ? "y" : "ies"} (${s.critical} critical, ${s.high} high${s.exploited ? `, ${s.exploited} known exploited` : ""}).`
    : `SCA scan: no known vulnerabilities in ${s.dependencies} dependenc${s.dependencies === 1 ? "y" : "ies"}.`;
  void vscode.window.showInformationMessage(headline, "Show Results").then(choice => { if (choice === "Show Results") panel?.reveal(); });
}

/* ------------------------------------------------------------------ *
 * Files, exports, edits
 * ------------------------------------------------------------------ */

/** A workspace-relative scan path as a URI (multi-root paths start with the folder name). */
export function workspaceUri(file: string): vscode.Uri | undefined {
  if (!file || file.split("/").includes("..")) return undefined;
  const folders = vscode.workspace.workspaceFolders ?? [];
  const [first, ...rest] = file.split("/");
  const named = folders.length > 1 ? folders.find(f => f.name === first) : undefined;
  if (named) return vscode.Uri.joinPath(named.uri, ...rest);
  return folders[0] ? vscode.Uri.joinPath(folders[0].uri, ...file.split("/")) : undefined;
}

async function openFile(file: string, line: number): Promise<void> {
  const uri = workspaceUri(file);
  if (!uri) { post({ type: "toast", kind: "error", message: `${file} is not in the workspace.` }); return; }
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const options: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.One, preview: false };
    if (line > 0) {
      const position = new vscode.Position(Math.min(line - 1, document.lineCount - 1), 0);
      options.selection = new vscode.Range(position, position);
    }
    await vscode.window.showTextDocument(document, options);
  } catch (error) {
    post({ type: "toast", kind: "error", message: `Could not open ${file}: ${error instanceof Error ? error.message : String(error)}` });
  }
}

async function exportReport(format: "json" | "csv"): Promise<void> {
  const result = session.result;
  if (!result) { post({ type: "toast", message: "Run a scan first; there is nothing to export yet." }); return; }
  const stamp = result.finishedAt.replace(/[:.]/g, "-").slice(0, 19);
  const name = `sca-report-${result.scan.workspace.name.replace(/[^\w.-]+/g, "-")}-${stamp}.${format}`;
  const root = vscode.workspace.workspaceFolders?.[0];
  const target = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root.uri, name) : vscode.Uri.file(path.join(os.homedir(), name)),
    filters: format === "json" ? { JSON: ["json"] } : { CSV: ["csv"] },
    saveLabel: "Export report",
    title: `Export SCA report as ${format.toUpperCase()}`
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(format === "json" ? scaJson(result) : scaCsv(result), "utf8"));
  post({ type: "toast", kind: "ok", message: `Report saved to ${path.basename(target.fsPath)}.` });
}

/** The option with this id in the current result (a message cannot bring its own edit). */
function findOption(id: string): AdviceOption | undefined {
  for (const advice of session.result?.advice ?? []) {
    const option = advice.options.find(o => o.id === id);
    if (option) return option;
  }
  return undefined;
}

async function proposed(edit: EditSpec): Promise<{ uri: vscode.Uri; document: vscode.TextDocument; text: string } | { error: string }> {
  const uri = workspaceUri(edit.file);
  if (!uri) return { error: `${edit.file} is not in the workspace.` };
  let document: vscode.TextDocument;
  try { document = await vscode.workspace.openTextDocument(uri); } catch (error) { return { error: `${edit.file} could not be opened: ${error instanceof Error ? error.message : String(error)}` }; }
  const result = applyEdit(edit, document.getText());
  if ("error" in result) return { error: result.error };
  if (result.text === document.getText()) return { error: `${edit.file} already has this change.` };
  return { uri, document, text: result.text };
}

function ensurePreviewProvider(context: vscode.ExtensionContext): void {
  if (previewEmitter) return;
  previewEmitter = new vscode.EventEmitter<vscode.Uri>();
  const emitter = previewEmitter;
  context.subscriptions.push(emitter, vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, {
    onDidChange: emitter.event,
    provideTextDocumentContent: uri => previews.get(uri.query) ?? ""
  }));
}

async function previewOption(id: string): Promise<void> {
  const option = findOption(id);
  if (!option?.edit) { post({ type: "toast", kind: "error", message: "That change is not part of the current scan's suggestions." }); return; }
  const change = await proposed(option.edit);
  if ("error" in change) { post({ type: "toast", kind: "error", message: change.error }); return; }
  const key = `${Date.now().toString(36)}-${previews.size}`;
  previews.set(key, change.text);
  const previewUri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: change.uri.path, query: key });
  await vscode.commands.executeCommand("vscode.diff", change.uri, previewUri, `${path.posix.basename(option.edit.file)}: proposed change (preview)`, { preview: true });
}

async function applyOption(id: string): Promise<void> {
  const option = findOption(id);
  if (!option?.edit) { post({ type: "toast", kind: "error", message: "That change is not part of the current scan's suggestions." }); return; }
  if (!vscode.workspace.isTrusted) { post({ type: "toast", kind: "error", message: "Trust this workspace to let DevSnip Pro change its files, or edit the manifest yourself." }); return; }
  const change = await proposed(option.edit);
  if ("error" in change) { post({ type: "toast", kind: "error", message: change.error }); return; }
  const confirmed = await confirmAction(
    `${describeEdit(option.edit)}?\n\n${option.title}. Risk: ${option.risk}.\n\nOnly this file is changed and saved; nothing is installed or built. Your package manager or build updates its lockfile the next time it runs. Review the diff, run your tests, then scan again.`,
    "Apply Change",
    "warning"
  );
  if (!confirmed) return;
  const edit = new vscode.WorkspaceEdit();
  const whole = new vscode.Range(change.document.positionAt(0), change.document.positionAt(change.document.getText().length));
  edit.replace(change.uri, whole, change.text);
  if (!(await vscode.workspace.applyEdit(edit))) { post({ type: "toast", kind: "error", message: `${option.edit.file} could not be changed.` }); return; }
  await change.document.save();
  await vscode.window.showTextDocument(change.document, { viewColumn: vscode.ViewColumn.One, preview: false });
  post({ type: "applied", option: id, file: option.edit.file });
  post({ type: "toast", kind: "ok", message: `Changed ${option.edit.file}. Undo with Ctrl/Cmd+Z in the editor; scan again to confirm the fix.` });
}

async function runCommand(command: string, cwd: string): Promise<void> {
  const suggested = session.result?.advice.some(a => a.options.some(o => o.commands?.some(c => c.command === command && c.cwd === cwd)));
  if (!suggested) { post({ type: "toast", kind: "error", message: "That command is not part of the current scan's suggestions." }); return; }
  const dir = workspaceUri(cwd || ".") ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!dir || !vscode.workspace.isTrusted) {
    await vscode.env.clipboard.writeText(command);
    post({ type: "toast", message: "Copied the command; run it in the project's folder." });
    return;
  }
  const confirmed = await confirmAction(`Run this command in ${cwd || "the workspace folder"}?\n\n${command}\n\nIt installs packages and changes your lockfile. Commit or stash your work first.`, "Run in Terminal", "warning");
  if (!confirmed) return;
  const terminal = vscode.window.createTerminal({ name: "DevSnip Pro · SCA fix", cwd: dir });
  terminal.show();
  terminal.sendText(command, true);
}

async function setNvdKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "NVD API key (optional)",
    prompt: "A free key from nvd.nist.gov raises NVD's limit from 5 to 50 requests per 30 seconds. It is kept in VS Code's secret storage and sent only to NVD. Leave empty to remove it.",
    password: true,
    ignoreFocusOut: true,
    validateInput: v => (!v || /^[A-Za-z0-9-]{20,64}$/.test(v.trim()) ? undefined : "That does not look like an NVD API key.")
  });
  if (value === undefined) return;
  if (value.trim()) await context.secrets.store(NVD_KEY_SECRET, value.trim());
  else await context.secrets.delete(NVD_KEY_SECRET);
  post({ type: "settings", settings: { ...scaSettings(), hasNvdKey: Boolean(value.trim()) } });
  post({ type: "toast", kind: "ok", message: value.trim() ? "Saved the NVD API key." : "Removed the NVD API key." });
}

/** For tests: the panel's state; `reset` clears results and caches so each test sees its own fakes. */
export function scaSessionForTests(reset = false): Session & { previews: Map<string, string> } {
  if (reset) {
    session.result = undefined;
    session.projects = undefined;
    session.error = undefined;
    clearMemoryCache();
    if (lastContext) { void clearPomCache(lastContext); void clearScaCaches(lastContext); }
  }
  return Object.assign(session, { previews });
}

/** For tests: handle a webview message as if the page sent it. */
export async function scaMessageForTests(message: { type: string; [key: string]: unknown }): Promise<void> {
  if (!lastContext) throw new Error("Open the SCA Scanner first.");
  await handleMessage(lastContext, message);
}
