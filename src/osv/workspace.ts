import * as path from "path";
import * as vscode from "vscode";
import { DEPENDENCY_FILE_GLOB, detectFileType, AUXILIARY_FILES } from "./parsers";
import type { ScanFile } from "./scan";

/**
 * Finds and reads the dependency files of the open workspace (or files the
 * user picked). Only those files are read, and their text never leaves the
 * extension host: the scan sends package names and versions to OSV, nothing else.
 */

/** Build output, caches and installed dependencies: never the project's own manifests. */
export const EXCLUDE_GLOB = "**/{node_modules,.git,.hg,.svn,bower_components,jspm_packages,vendor,.venv,venv,.tox,.nox,__pycache__,site-packages,target,dist,build,out,.gradle,.idea,.next,.nuxt,.svelte-kit,.turbo,.cache,coverage,.terraform,Pods,Carthage,.dart_tool,.pub-cache,_build,deps,.build,.vscode-test,.yarn}/**";
export const MAX_FILES = 5000;
/** Large monorepo lockfiles reach tens of megabytes; anything bigger is almost certainly not one. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface Discovery {
  files: ScanFile[];
  limitations: string[];
  /** File system path of each scanned file, by its scan path (Maven runs in the project's directory). */
  locations: Map<string, { fsPath: string; root: string }>;
  /** Every scanned file is inside the open workspace (paths are workspace-relative). */
  inWorkspace?: boolean;
}

function locate(entries: Array<{ uri: vscode.Uri; relative: string }>): Discovery["locations"] {
  return new Map(entries.map(e => [e.relative, { fsPath: e.uri.fsPath, root: vscode.workspace.getWorkspaceFolder(e.uri)?.uri.fsPath ?? path.dirname(e.uri.fsPath) }]));
}

async function readOne(uri: vscode.Uri, relative: string): Promise<ScanFile> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_FILE_BYTES) return { path: relative, error: `Larger than ${MAX_FILE_BYTES / 1024 / 1024} MB, so it was skipped.` };
    const bytes = await vscode.workspace.fs.readFile(uri);
    let text = Buffer.from(bytes).toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // bun.lockb is binary; anything else with NUL bytes is not a text manifest.
    if (!relative.endsWith(".lockb") && text.slice(0, 4096).includes("\u0000")) return { path: relative, error: "Binary content; not a text dependency file." };
    return { path: relative, text };
  } catch (error) {
    return { path: relative, error: `Could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Reads files in small parallel batches so a big monorepo neither stalls nor exhausts file handles. */
async function readAll(entries: Array<{ uri: vscode.Uri; relative: string }>, token?: vscode.CancellationToken, onRead?: (done: number, total: number) => void): Promise<ScanFile[]> {
  const out: ScanFile[] = [];
  const BATCH = 16;
  for (let i = 0; i < entries.length; i += BATCH) {
    if (token?.isCancellationRequested) break;
    out.push(...await Promise.all(entries.slice(i, i + BATCH).map(e => readOne(e.uri, e.relative))));
    onRead?.(Math.min(entries.length, i + BATCH), entries.length);
  }
  return out;
}

function relativePath(uri: vscode.Uri): string {
  const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
  return vscode.workspace.asRelativePath(uri, multiRoot).replace(/\\/g, "/");
}

/** `-r file` / `--requirement file` lines of a pip requirements file (constraints files are not installs). */
export function requirementIncludes(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:-r|--requirement)(?:\s+|=)(\S+)/.exec(line);
    if (match && !/^[a-z]+:\/\//i.test(match[1])) out.push(match[1]);
  }
  return out;
}

/**
 * Requirements files pulled in with -r that discovery did not match by name
 * (`-r common.txt`), so their packages are scanned too. Followed up to five
 * levels, inside the workspace only.
 */
async function followRequirementIncludes(files: ScanFile[], entries: Array<{ uri: vscode.Uri; relative: string }>, token?: vscode.CancellationToken): Promise<Array<{ uri: vscode.Uri; relative: string; file: ScanFile }>> {
  const added: Array<{ uri: vscode.Uri; relative: string; file: ScanFile }> = [];
  const known = new Set(files.map(f => f.path));
  let frontier = files.filter(f => f.text !== undefined && (detectFileType(f.path)?.id === "requirements")).map(f => ({ file: f, uri: entries.find(e => e.relative === f.path)?.uri }));
  for (let depth = 0; depth < 5 && frontier.length && !token?.isCancellationRequested; depth++) {
    const next: typeof frontier = [];
    for (const { file, uri } of frontier) {
      if (!uri || file.text === undefined) continue;
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      for (const include of requirementIncludes(file.text)) {
        const target = vscode.Uri.joinPath(uri, "..", include);
        if (folder && !(target.fsPath + path.sep).startsWith(folder.uri.fsPath + path.sep)) continue;
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), include));
        if (known.has(relative) || relative.startsWith("..")) continue;
        known.add(relative);
        const read = { ...(await readOne(target, relative)), hint: "requirements" };
        if (read.text === undefined) continue; // a missing include is reported by pip, not here
        added.push({ uri: target, relative, file: read });
        next.push({ file: read, uri: target });
      }
    }
    frontier = next;
  }
  return added;
}

export async function discoverWorkspace(token?: vscode.CancellationToken, onRead?: (done: number, total: number) => void): Promise<Discovery> {
  const limitations: string[] = [];
  const uris = await vscode.workspace.findFiles(DEPENDENCY_FILE_GLOB, EXCLUDE_GLOB, MAX_FILES + 1, token);
  const entries = uris
    .map(uri => ({ uri, relative: relativePath(uri) }))
    .filter(e => detectFileType(e.relative) || AUXILIARY_FILES.includes(path.posix.basename(e.relative)))
    .sort((a, b) => a.relative.localeCompare(b.relative));
  if (uris.length > MAX_FILES) {
    limitations.push(`The workspace has more than ${MAX_FILES.toLocaleString("en-US")} dependency files; only the first ${MAX_FILES.toLocaleString("en-US")} were scanned.`);
    entries.length = Math.min(entries.length, MAX_FILES);
  }
  limitations.push("Folders with installed packages or build output (node_modules, vendor, .venv, target, dist, build, …) are skipped; their manifests belong to dependencies, not this project.");
  const files = await readAll(entries, token, onRead);
  const included = await followRequirementIncludes(files, entries, token);
  return { files: [...files, ...included.map(i => i.file)], limitations, locations: locate([...entries, ...included]) };
}

/**
 * Files the user chose (from the explorer or a file dialog). Paths are made
 * relative to their common folder so the report does not expose a home directory.
 */
export async function discoverFiles(selected: vscode.Uri[], token?: vscode.CancellationToken): Promise<Discovery> {
  const limitations: string[] = [];
  // A folder (a project in a monorepo) scans the dependency files inside it.
  const uris: vscode.Uri[] = [];
  for (const uri of selected) {
    let isFolder = false;
    try { isFolder = ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0; } catch { /* missing: reported below */ }
    if (!isFolder) { uris.push(uri); continue; }
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, DEPENDENCY_FILE_GLOB), EXCLUDE_GLOB, MAX_FILES, token);
    uris.push(...found.filter(f => !AUXILIARY_FILES.includes(path.posix.basename(f.path))));
  }
  const supported = uris.filter(uri => detectFileType(uri.path));
  const skipped = uris.length - supported.length;
  if (skipped) limitations.push(`${skipped} selected file${skipped === 1 ? " is" : "s are"} not a supported dependency file and ${skipped === 1 ? "was" : "were"} skipped.`);
  const inWorkspace = supported.every(uri => vscode.workspace.getWorkspaceFolder(uri));
  let entries: Array<{ uri: vscode.Uri; relative: string }>;
  if (inWorkspace) {
    entries = supported.map(uri => ({ uri, relative: relativePath(uri) }));
  } else {
    const dirs = supported.map(uri => path.posix.dirname(uri.path));
    let common = dirs[0] ?? "/";
    for (const dir of dirs) while (common !== "/" && !(dir === common || dir.startsWith(`${common}/`))) common = path.posix.dirname(common);
    const base = path.posix.dirname(common);
    entries = supported.map(uri => ({ uri, relative: path.posix.relative(base === "/" ? "/" : base, uri.path) }));
  }
  // Context files near the chosen ones: central NuGet versions and Gradle properties next to them, and the
  // parent POMs above a pom.xml (up to the workspace folder), so a module resolves as it does in its reactor.
  const extras: Array<{ uri: vscode.Uri; relative: string }> = [];
  const addExtra = async (candidate: vscode.Uri, relative: string) => {
    if (entries.some(e => e.relative === relative) || extras.some(e => e.relative === relative)) return;
    try {
      await vscode.workspace.fs.stat(candidate);
      extras.push({ uri: candidate, relative });
    } catch { /* not there */ }
  };
  for (const entry of entries) {
    for (const name of AUXILIARY_FILES) await addExtra(vscode.Uri.joinPath(entry.uri, "..", name), path.posix.join(path.posix.dirname(entry.relative), name));
    if (!entry.relative.endsWith("pom.xml")) continue;
    const folder = vscode.workspace.getWorkspaceFolder(entry.uri);
    let dirUri = vscode.Uri.joinPath(entry.uri, "..");
    let dirRel = path.posix.dirname(entry.relative);
    for (let level = 0; level < 6 && dirRel !== "." && dirRel !== ""; level++) {
      if (folder && dirUri.fsPath === folder.uri.fsPath) break;
      dirUri = vscode.Uri.joinPath(dirUri, "..");
      dirRel = path.posix.dirname(dirRel);
      await addExtra(vscode.Uri.joinPath(dirUri, "pom.xml"), dirRel === "." ? "pom.xml" : `${dirRel}/pom.xml`);
    }
  }
  const files = await readAll(entries, token);
  const included = await followRequirementIncludes(files, entries, token);
  const context = (await readAll(extras, token)).map(file => ({ ...file, context: true }));
  return { files: [...files, ...included.map(i => i.file), ...context], limitations, locations: locate([...entries, ...extras, ...included]), inWorkspace };
}

export const FILE_DIALOG_FILTERS: Record<string, string[]> = {
  "Dependency files": ["json", "lock", "yaml", "txt", "toml", "xml", "mod", "gradle", "kts", "csproj", "fsproj", "vbproj", "config", "lockfile", "resolved", "rb"],
  "All files": ["*"]
};
