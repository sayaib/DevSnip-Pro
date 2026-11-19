import * as vscode from "vscode";
import { trackToolUsed } from "../analytics";
import { hostPlatform, resourceName } from "../platform/environment";
import { outputCapabilities } from "../platform/workspace";
import { setWebviewHtml } from "../theme/service";
import { diffValues } from "../toolkits/engines/data-inspect";
import { describeJsonError } from "../toolkits/engines/json-locate";
import { openToolPanel, safePostMessage } from "../utils/webview-ui";
import { lastTextEditor } from "./command";
import { CodeDiffInitial, CodeDiffPrefs, renderCodeDiffPage, sanitizePrefs } from "./page";

const VIEW_TYPE = "devsnip.codeDiff";
const PREFS_KEY = "devsnip.codeDiff.prefs";
/** Large enough for generated files and logs; the page stays responsive well past this. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const JSON_MAX_ENTRIES = 5000;

export interface SideText { name: string; text: string; language?: string }

/** Opens the Code Diff Checker (or brings it to the front) with whatever the command was given. */
export async function openCodeDiff(context: vscode.ExtensionContext, arg?: unknown, all?: unknown): Promise<void> {
  const initial = await initialFromInvocation(arg, all);
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, "media");
  const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist");
  const { panel, created } = openToolPanel(VIEW_TYPE, "Code Diff Checker", { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot, codiconsRoot] });
  if (!created) {
    if (initial.left || initial.right) safePostMessage(panel, { type: "setInputs", ...initial });
    return;
  }
  const webview = panel.webview;
  const uri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, file)).toString();
  setWebviewHtml(webview, renderCodeDiffPage({
    cspSource: webview.cspSource,
    engineUri: uri("code-diff-engine.js"),
    scriptUri: uri("code-diff.js"),
    codiconsUri: webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, "codicon.css")).toString(),
    platform: hostPlatform(),
    canSave: outputCapabilities().saveAs,
    prefs: sanitizePrefs(context.globalState.get<Partial<CodeDiffPrefs>>(PREFS_KEY)),
    initial
  }));

  const post = (message: unknown) => safePostMessage(panel, message);
  const notice = (kind: "info" | "success" | "warning" | "error", text: string) => post({ type: "notice", kind, text });
  const subscription = webview.onDidReceiveMessage(async message => {
    if (!message || typeof message !== "object") return;
    try {
      await handle(message);
    } catch (error) {
      console.error("DevSnip Pro: Code Diff Checker action failed.", error);
      notice("error", error instanceof Error ? error.message : String(error));
    }
  });
  panel.onDidDispose(() => subscription.dispose());

  async function handle(message: any): Promise<void> {
    const side = message.side === "right" ? "right" : "left";
    switch (message.type) {
      case "pickFile": {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: side === "left" ? "Use as original" : "Use as modified", title: side === "left" ? "Choose the original file" : "Choose the modified file", defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri });
        if (!picked?.[0]) return;
        post({ type: "file", side, ...(await readSide(picked[0])) });
        return;
      }
      case "readEditor": {
        const editor = lastTextEditor();
        if (!editor) { notice("warning", "Open a file in an editor first, then choose From editor."); return; }
        const selection = editor.selection;
        const text = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
        if (text.length > MAX_FILE_BYTES) { notice("error", "That editor is too large to compare here."); return; }
        post({ type: "file", side, name: resourceName(editor.document.uri), text, language: editor.document.languageId, note: selection.isEmpty ? undefined : "selection" });
        return;
      }
      case "paste": {
        const text = await vscode.env.clipboard.readText();
        if (!text) { notice("warning", "The clipboard is empty."); return; }
        post({ type: "file", side, text, keepName: true });
        return;
      }
      case "copy": {
        if (typeof message.text !== "string") return;
        await vscode.env.clipboard.writeText(message.text);
        notice("success", typeof message.label === "string" ? message.label : "Copied to the clipboard.");
        return;
      }
      case "save": {
        if (typeof message.text !== "string") return;
        const name = String(message.name || "changes.diff").replace(/[\\/:*?"<>|]+/g, "-");
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const target = await vscode.window.showSaveDialog({
          defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
          saveLabel: "Save",
          filters: name.endsWith(".html") ? { HTML: ["html"] } : { "Diff / patch": ["diff", "patch"], "All files": ["*"] }
        });
        if (!target) return;
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(message.text));
        notice("success", `Saved ${resourceName(target)}.`);
        return;
      }
      case "openPatch": {
        if (typeof message.text !== "string") return;
        const doc = await vscode.workspace.openTextDocument({ content: message.text, language: "diff" });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        return;
      }
      case "jsonDiff": {
        post({ type: "jsonResult", requestId: message.requestId, ...jsonDiff(String(message.left ?? ""), String(message.right ?? ""), { ignoreArrayOrder: message.ignoreArrayOrder === true, arrayKey: typeof message.arrayKey === "string" ? message.arrayKey.trim() : "" }) });
        return;
      }
      case "prefs":
        await context.globalState.update(PREFS_KEY, sanitizePrefs(message.prefs));
        return;
      case "compared":
        // Live comparisons re-run as you type; analytics counts a tool once per few minutes.
        trackToolUsed("textDiff");
        return;
    }
  }
}

/** Reads a file for one side, refusing binaries and very large files with a clear reason. */
export async function readSide(uri: vscode.Uri): Promise<SideText> {
  const name = resourceName(uri);
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.type & vscode.FileType.Directory) throw new Error(`${name} is a folder. Choose a file.`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`${name} is ${(stat.size / 1024 / 1024).toFixed(1)} MB. Files up to ${MAX_FILE_BYTES / 1024 / 1024} MB can be compared.`);
  return { name, text: decodeText(await vscode.workspace.fs.readFile(uri), name) };
}

/** UTF-8 (with or without BOM) or UTF-16 with a BOM; binary content is refused. */
export function decodeText(bytes: Uint8Array, name = "The file"): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const probe = bytes.subarray(0, 8000);
  if (probe.includes(0)) throw new Error(`${name} looks like a binary file. The Code Diff Checker compares text.`);
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return new TextDecoder("utf-8").decode(bytes.subarray(start));
}

async function initialFromInvocation(arg: unknown, all: unknown): Promise<CodeDiffInitial> {
  try {
    // Two files selected in the explorer: VS Code passes the clicked one and the whole selection.
    const uris = Array.isArray(all) ? all.filter((u): u is vscode.Uri => u instanceof vscode.Uri) : [];
    if (uris.length >= 2) {
      const [left, right] = await Promise.all([readSide(uris[0]), readSide(uris[1])]);
      return { left, right };
    }
    if (arg instanceof vscode.Uri) return { left: await readSide(arg) };
    if (arg && typeof arg === "object") {
      const o = arg as { left?: unknown; right?: unknown };
      const side = (v: unknown): SideText | undefined => typeof v === "string" ? { name: "", text: v } : undefined;
      if (typeof o.left === "string" || typeof o.right === "string") return { left: side(o.left), right: side(o.right) };
    }
  } catch (error) {
    void vscode.window.showWarningMessage(`Code Diff Checker: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {};
}

export interface JsonDiffResult {
  error?: string;
  entries?: Array<{ kind: string; path: string; before: string; after: string }>;
  counts?: { added: number; removed: number; changed: number; type: number };
  truncated?: boolean;
}

/** Structural JSON comparison (key order and formatting ignored), as the previous Diff Checker offered. */
export function jsonDiff(left: string, right: string, options: { ignoreArrayOrder: boolean; arrayKey: string }): JsonDiffResult {
  if (!left.trim() && !right.trim()) return { error: "Paste two JSON documents to compare." };
  const parse = (text: string, which: string) => {
    try { return JSON.parse(text.replace(/^﻿/, "")); } catch { throw new Error(`${which} is not valid JSON (${describeJsonError(text)}).`); }
  };
  let a: unknown, b: unknown;
  try {
    a = parse(left, "Original");
    b = parse(right, "Modified");
  } catch (error) {
    return { error: (error as Error).message };
  }
  const all = diffValues(a, b, { ignoreArrayOrder: options.ignoreArrayOrder, arrayKey: options.arrayKey || undefined });
  const show = (v: unknown) => v === undefined ? "" : truncate(JSON.stringify(v), 400);
  const count = (k: string) => all.filter(e => e.kind === k).length;
  return {
    entries: all.slice(0, JSON_MAX_ENTRIES).map(e => ({ kind: e.kind, path: e.path, before: show(e.before), after: show(e.after) })),
    counts: { added: count("added"), removed: count("removed"), changed: count("changed"), type: count("type") },
    truncated: all.length > JSON_MAX_ENTRIES
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
