import * as vscode from "vscode";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { GeneratedFile, ToolContext, ToolDefinition, ToolExample, ToolInputError, ToolResult, Values, describe } from "./types";
import { TOOLKIT_COMMANDS } from "./commands";
import { renderToolPage } from "./page";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";
import { confirmAction, openToolPanel, safePostMessage } from "../utils/webview-ui";
import { track } from "../analytics";
import { setWebviewHtml } from "../theme/service";
import { noteToolRun } from "../onboarding/activation";

/**
 * Hosts the toolkit tools: one command and one panel per tool. The webview
 * (media/toolkit.js) renders the form and results; everything that touches
 * VS Code - running the tool, the clipboard, editors and files - happens here.
 */

const RUN_TIMEOUT_MS = 90_000;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const SEARCH_EXCLUDE = "**/{node_modules,.git,dist,build,out,.next,.venv,venv,__pycache__,target,vendor,coverage}/**";

/** The panel steals focus, so remember the editor the user was last working in. */
let lastEditor: vscode.TextEditor | undefined;

export function registerToolkitCommands(context: vscode.ExtensionContext): void {
  lastEditor = vscode.window.activeTextEditor;
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) lastEditor = editor; }));
  for (const entry of TOOLKIT_COMMANDS) {
    context.subscriptions.push(registerTrackedCommand(COMMAND_PREFIX + entry.command, async (arg?: unknown) => {
      // Tool definitions and their engines load on first use, not at activation.
      const { findTool } = await import("./registry");
      const tool = findTool(entry.tool);
      if (!tool) throw new Error(`Unknown tool ${entry.tool}`);
      // Alias presets (e.g. a mode) and the editor text when run from the context menu both apply.
      const fromEditor = initialFromInvocation(tool, arg);
      await openTool(context, tool, entry.values || fromEditor ? { ...(entry.values ?? {}), ...(fromEditor ?? {}) } : undefined);
    }));
  }
}

/**
 * Run from the editor context menu (VS Code passes the file's Uri), a tool
 * starts with the selection - or the whole file - in its main input.
 */
function initialFromInvocation(tool: ToolDefinition, arg: unknown): Values | undefined {
  if (!(arg instanceof vscode.Uri)) return undefined;
  const editor = vscode.window.activeTextEditor;
  const field = tool.fields.find(f => f.fromEditor);
  if (!editor || !field) return undefined;
  const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
  if (text.length > MAX_READ_BYTES) return undefined;
  const values: Values = { [field.id]: text };
  // A field shown only in one mode (e.g. the Dockerfile linter's input) switches the tool to that mode.
  if (field.showIf) values[field.showIf.field] = field.showIf.equals[0];
  return values;
}

export async function openTool(context: vscode.ExtensionContext, tool: ToolDefinition, initial?: Values): Promise<void> {
  const mediaRoot = vscode.Uri.file(path.join(context.extensionPath, "media"));
  const { panel, created } = openToolPanel(`devsnip.tool.${tool.id}`, tool.title, { enableScripts: true, localResourceRoots: [mediaRoot] });
  if (!created) {
    if (initial) safePostMessage(panel, { type: "setValues", values: initial, run: true });
    return;
  }
  const ctx = createToolContext(context);
  const { SECTIONS } = await import("./registry");
  const section = SECTIONS.find(s => s.id === tool.section)!;
  setWebviewHtml(panel.webview, renderToolPage({
    cspSource: panel.webview.cspSource,
    scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "toolkit.js")).toString(),
    tool: describe(tool),
    section: { id: section.id, title: section.title },
    examples: await allExamples(tool, ctx),
    initial: initial ?? {},
    platform: process.platform
  }));

  let liveTracked = false;
  let latestRequest = 0;
  const feature = tool.command;
  const subscription = panel.webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "run": {
        const requestId = Number(message.requestId) || 0;
        latestRequest = Math.max(latestRequest, requestId);
        const trigger = ["run", "live", "preset", "action"].includes(message.trigger) ? message.trigger : "run";
        const action = typeof message.action === "string" && tool.actions?.some(a => a.id === message.action) ? message.action : undefined;
        const started = Date.now();
        const outcome = await runTool(tool, sanitizeValues(message.values), ctx, action);
        const durationMs = Date.now() - started;
        // A slower, older live run must not overwrite a newer result.
        if (requestId < latestRequest && trigger === "live") return;
        safePostMessage(panel, { type: "result", requestId, durationMs, ...outcome });
        if (action) safePostMessage(panel, { type: "examples", examples: await allExamples(tool, ctx) });
        if (trigger !== "live" || !liveTracked) {
          if (trigger === "live") liveTracked = true;
          track("tool_run_completed", { feature, section: tool.section, outcome: outcome.outcome, trigger, duration_ms: durationMs });
        }
        noteToolRun(tool.section, outcome.outcome);
        return;
      }
      case "readEditor": {
        const editor = lastEditor && !lastEditor.document.isClosed ? lastEditor : vscode.window.visibleTextEditors[0];
        if (!editor) {
          safePostMessage(panel, { type: "notice", kind: "warning", text: "Open a file in an editor first." });
          return;
        }
        const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
        if (text.length > MAX_READ_BYTES) {
          safePostMessage(panel, { type: "notice", kind: "warning", text: "That file is larger than 5 MB; select the part you need first." });
          return;
        }
        safePostMessage(panel, { type: "editorText", field: String(message.field), text, source: `${editor.selection.isEmpty ? "all of" : "selection in"} ${path.basename(editor.document.fileName)}` });
        return;
      }
      case "copy":
        await vscode.env.clipboard.writeText(String(message.text ?? ""));
        safePostMessage(panel, { type: "notice", kind: "success", text: "Copied to the clipboard." });
        track("tool_output_used", { feature, action: "copy" });
        return;
      case "insert": {
        await insertAtCursor(String(message.text ?? ""), typeof message.language === "string" ? message.language : undefined);
        track("tool_output_used", { feature, action: "insert" });
        return;
      }
      case "open": {
        const document = await vscode.workspace.openTextDocument({ content: String(message.text ?? ""), language: editorLanguage(message.language) });
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
        track("tool_output_used", { feature, action: "open" });
        return;
      }
      case "download": {
        const saved = await saveAs(String(message.text ?? ""), typeof message.language === "string" ? message.language : undefined, typeof message.fileName === "string" ? message.fileName : "");
        if (saved) {
          safePostMessage(panel, { type: "notice", kind: "success", text: `Saved ${path.basename(saved)}.` });
          track("tool_output_used", { feature, action: "save" });
        }
        return;
      }
      case "save":
      case "writeAll": {
        const files = (Array.isArray(message.files) ? message.files : []).filter((f: unknown): f is GeneratedFile => !!f && typeof (f as GeneratedFile).path === "string" && typeof (f as GeneratedFile).content === "string");
        if (!files.length) return;
        const result = await writeFiles(files);
        safePostMessage(panel, { type: "notice", kind: result.kind, text: result.text });
        if (result.written) track("tool_output_used", { feature, action: message.type === "save" ? "save" : "write_all", file_count: result.written });
        return;
      }
    }
  });
  panel.onDidDispose(() => subscription.dispose());
}

async function allExamples(tool: ToolDefinition, ctx: ToolContext): Promise<ToolExample[]> {
  let dynamic: ToolExample[] = [];
  try {
    dynamic = tool.dynamicExamples ? await tool.dynamicExamples(ctx) : [];
  } catch (error) {
    console.warn(`DevSnip Pro: could not load presets for ${tool.id}.`, error);
  }
  return [...(tool.examples ?? []), ...dynamic];
}

/** Only plain string / number / boolean values reach a tool. */
function sanitizeValues(raw: unknown): Values {
  const values: Values = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return values;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") values[key] = value;
  }
  return values;
}

export async function runTool(tool: ToolDefinition, values: Values, ctx: ToolContext, action?: string): Promise<{ outcome: "success" | "input_error" | "error" | "timeout"; result?: ToolResult; error?: string }> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError()), RUN_TIMEOUT_MS); });
    const result = await Promise.race([Promise.resolve().then(() => tool.run(values, ctx, action)), timeout]);
    return { outcome: "success", result };
  } catch (error) {
    if (error instanceof ToolInputError) return { outcome: "input_error", error: error.message };
    if (error instanceof TimeoutError) return { outcome: "timeout", error: "The tool did not finish within 90 seconds." };
    console.error(`DevSnip Pro: ${tool.id} failed.`, error);
    return { outcome: "error", error: `Something went wrong: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class TimeoutError extends Error {}

// ---------------------------------------------------------------------------
// Environment for tools
// ---------------------------------------------------------------------------

/** Accepts plain workspace-relative paths only: no absolute paths, no "..". */
export function safeRelativePath(input: string): string | undefined {
  const normalized = input.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return undefined;
  const parts = normalized.split("/");
  if (parts.some(p => p === ".." || p === "")) return undefined;
  return parts.join("/");
}

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export function createToolContext(context: vscode.ExtensionContext): ToolContext {
  const root = workspaceRoot();
  const resolve = (relative: string): vscode.Uri => {
    const safe = safeRelativePath(relative);
    if (!safe || !root) throw new ToolInputError(`Invalid workspace path: ${relative}`);
    return vscode.Uri.joinPath(root, ...safe.split("/"));
  };
  return {
    workspace: root ? {
      name: vscode.workspace.workspaceFolders![0].name,
      async exists(relative) {
        try { await vscode.workspace.fs.stat(resolve(relative)); return true; } catch { return false; }
      },
      async readFile(relative) {
        try {
          const uri = resolve(relative);
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > MAX_READ_BYTES) return undefined;
          return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        } catch {
          return undefined;
        }
      },
      async findFiles(glob, limit) {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, glob), SEARCH_EXCLUDE, limit);
        return uris.map(u => path.relative(root.fsPath, u.fsPath).split(path.sep).join("/"));
      }
    } : undefined,
    storage: {
      get: (key, fallback) => context.globalState.get(key, fallback),
      set: async (key, value) => { await context.globalState.update(key, value); }
    },
    network: { isPortFree },
    now: () => new Date()
  };
}

/** A port is in use when something accepts a connection on it (IPv4 or IPv6 loopback). */
export async function isPortFree(port: number): Promise<boolean> {
  const listening = (host: string) => new Promise<boolean>(resolve => {
    const socket = net.connect({ port, host });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.setTimeout(400, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
  const [v4, v6] = await Promise.all([listening("127.0.0.1"), listening("::1")]);
  return !v4 && !v6;
}

// ---------------------------------------------------------------------------
// Output actions
// ---------------------------------------------------------------------------

const LANGUAGE_IDS: Record<string, string> = {
  dockerfile: "dockerfile", yaml: "yaml", json: "json", jsonl: "jsonl", python: "python", typescript: "typescript", javascript: "javascript",
  shell: "shellscript", sql: "sql", markdown: "markdown", go: "go", java: "java", groovy: "groovy", nginx: "nginx", terraform: "terraform",
  dotenv: "dotenv", properties: "properties", csv: "csv", tsv: "tsv", diff: "diff", log: "log", ignore: "ignore", helm: "helm", http: "http", text: "plaintext",
  tsx: "typescriptreact", jsx: "javascriptreact", dart: "dart", kotlin: "kotlin", swift: "swift", xml: "xml", html: "html", css: "css", graphql: "graphql",
  php: "php", ruby: "ruby", prisma: "prisma"
};

function editorLanguage(language: unknown): string {
  return (typeof language === "string" && LANGUAGE_IDS[language]) || "plaintext";
}

const EXTENSIONS: Record<string, string> = {
  typescript: "ts", javascript: "js", tsx: "tsx", jsx: "jsx", json: "json", jsonl: "jsonl", yaml: "yaml", python: "py", shell: "sh", sql: "sql",
  markdown: "md", go: "go", java: "java", kotlin: "kt", swift: "swift", dart: "dart", xml: "xml", html: "html", css: "css", graphql: "graphql",
  dockerfile: "Dockerfile", nginx: "conf", terraform: "tf", dotenv: "env", properties: "properties", csv: "csv", tsv: "tsv", diff: "diff",
  http: "http", php: "php", ruby: "rb", groovy: "gradle", prisma: "prisma", ignore: "gitignore", log: "log", text: "txt"
};

/** "Save as…": the user picks the location, so any path they choose is allowed. */
async function saveAs(text: string, language: string | undefined, suggested: string): Promise<string | undefined> {
  const ext = (language && EXTENSIONS[language]) || "txt";
  const base = suggested.split(/[\\/]/).pop()!.replace(/[^\w.@ -]+/g, " ").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "output";
  const name = /\.[A-Za-z0-9]{1,12}$/.test(base) || base === "Dockerfile" ? base : `${base}.${ext}`;
  const root = workspaceRoot();
  const target = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root, name) : vscode.Uri.file(path.join(os.homedir(), name)),
    saveLabel: "Save"
  });
  if (!target) return undefined;
  await vscode.workspace.fs.writeFile(target, Buffer.from(text, "utf8"));
  return target.fsPath;
}

async function insertAtCursor(text: string, language?: string): Promise<void> {
  const editor = lastEditor && !lastEditor.document.isClosed ? lastEditor : undefined;
  if (!editor) {
    const document = await vscode.workspace.openTextDocument({ content: text, language: editorLanguage(language) });
    await vscode.window.showTextDocument(document, { preview: false });
    return;
  }
  const shown = await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
  await shown.edit(builder => { for (const selection of shown.selections) builder.replace(selection, text); });
}

async function writeFiles(files: GeneratedFile[]): Promise<{ kind: "success" | "warning" | "error"; text: string; written: number }> {
  const root = workspaceRoot();
  if (!root) return { kind: "error", text: "Open a folder first: files are written into the workspace.", written: 0 };
  const targets: Array<{ file: GeneratedFile; uri: vscode.Uri; exists: boolean }> = [];
  for (const file of files) {
    const safe = safeRelativePath(file.path);
    if (!safe) return { kind: "error", text: `Refused to write "${file.path}": only paths inside the workspace are allowed.`, written: 0 };
    const uri = vscode.Uri.joinPath(root, ...safe.split("/"));
    let exists = false;
    try { await vscode.workspace.fs.stat(uri); exists = true; } catch { /* new file */ }
    targets.push({ file: { ...file, path: safe }, uri, exists });
  }
  const overwrite = targets.filter(t => t.exists && t.file.mode !== "append");
  if (overwrite.length) {
    const list = overwrite.slice(0, 8).map(t => t.file.path).join("\n");
    const ok = await confirmAction(`${overwrite.length === 1 ? "This file already exists" : `${overwrite.length} files already exist`}:\n${list}${overwrite.length > 8 ? "\n…" : ""}\n\nOverwrite?`, "Overwrite");
    if (!ok) return { kind: "warning", text: "Nothing was written.", written: 0 };
  }
  for (const t of targets) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(t.uri, ".."));
    let content = t.file.content;
    if (t.file.mode === "append" && t.exists) {
      const existing = Buffer.from(await vscode.workspace.fs.readFile(t.uri)).toString("utf8");
      content = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + content;
    }
    await vscode.workspace.fs.writeFile(t.uri, Buffer.from(content, "utf8"));
  }
  const first = targets[0];
  await vscode.window.showTextDocument(first.uri, { preview: targets.length > 1, viewColumn: vscode.ViewColumn.Beside });
  const appended = targets.filter(t => t.file.mode === "append" && t.exists).length;
  return {
    kind: "success",
    text: targets.length === 1 ? `${appended ? "Appended to" : "Wrote"} ${first.file.path}.` : `Wrote ${targets.length} files: ${targets.map(t => t.file.path).slice(0, 6).join(", ")}${targets.length > 6 ? "…" : ""}.`,
    written: targets.length
  };
}
