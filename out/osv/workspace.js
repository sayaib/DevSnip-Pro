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
exports.FILE_DIALOG_FILTERS = exports.discoverFiles = exports.discoverWorkspace = exports.constraintIncludes = exports.requirementIncludes = exports.MAX_FILE_BYTES = exports.MAX_FILES = exports.EXCLUDE_GLOB = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const parsers_1 = require("./parsers");
const discovery_rules_1 = require("./discovery-rules");
/**
 * Finds and reads the dependency files of the open workspace (or files the
 * user picked). Only those files are read, and their text never leaves the
 * extension host: the scan sends package names and versions to OSV, nothing else.
 */
/**
 * Installed packages and caches: never the project's own manifests. Output and vendor folders
 * (build, dist, target, vendor, …) are filtered afterwards, only when they belong to the project beside them.
 */
exports.EXCLUDE_GLOB = discovery_rules_1.HARD_EXCLUDE_GLOB;
exports.MAX_FILES = 5000;
/** Large monorepo lockfiles reach tens of megabytes; anything bigger is almost certainly not one. */
exports.MAX_FILE_BYTES = 64 * 1024 * 1024;
function locate(entries) {
    return new Map(entries.map(e => [e.relative, { fsPath: e.uri.fsPath, root: vscode.workspace.getWorkspaceFolder(e.uri)?.uri.fsPath ?? path.dirname(e.uri.fsPath) }]));
}
async function readOne(uri, relative) {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > exports.MAX_FILE_BYTES)
            return { path: relative, error: `Larger than ${exports.MAX_FILE_BYTES / 1024 / 1024} MB, so it was skipped.` };
        const bytes = await vscode.workspace.fs.readFile(uri);
        let text = Buffer.from(bytes).toString("utf8");
        if (text.charCodeAt(0) === 0xfeff)
            text = text.slice(1);
        // bun.lockb is binary; anything else with NUL bytes is not a text manifest.
        if (!relative.endsWith(".lockb") && text.slice(0, 4096).includes("\u0000"))
            return { path: relative, error: "Binary content; not a text dependency file." };
        return { path: relative, text };
    }
    catch (error) {
        return { path: relative, error: `Could not be read: ${error instanceof Error ? error.message : String(error)}` };
    }
}
/** Reads files in small parallel batches so a big monorepo neither stalls nor exhausts file handles. */
async function readAll(entries, token, onRead) {
    const out = [];
    const BATCH = 16;
    for (let i = 0; i < entries.length; i += BATCH) {
        if (token?.isCancellationRequested)
            break;
        out.push(...await Promise.all(entries.slice(i, i + BATCH).map(e => readOne(e.uri, e.relative))));
        onRead?.(Math.min(entries.length, i + BATCH), entries.length);
    }
    return out;
}
function relativePath(uri) {
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    return vscode.workspace.asRelativePath(uri, multiRoot).replace(/\\/g, "/");
}
/** `-r file` / `--requirement file` lines of a pip requirements file (constraints files are not installs). */
function requirementIncludes(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(?:-r|--requirement)(?:\s+|=)(\S+)/.exec(line);
        if (match && !/^[a-z]+:\/\//i.test(match[1]))
            out.push(match[1]);
    }
    return out;
}
exports.requirementIncludes = requirementIncludes;
/** `-c file` / `--constraint file` lines: they pin versions of what the file installs, and are read as context. */
function constraintIncludes(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(?:-c|--constraint)(?:\s+|=)(\S+)/.exec(line);
        if (match && !/^[a-z]+:\/\//i.test(match[1]))
            out.push(match[1]);
    }
    return out;
}
exports.constraintIncludes = constraintIncludes;
/**
 * Requirements files pulled in with -r that discovery did not match by name
 * (`-r common.txt`), so their packages are scanned too. Followed up to five
 * levels, inside the workspace only.
 */
async function followRequirementIncludes(files, entries, token) {
    const added = [];
    const known = new Set(files.map(f => f.path));
    let frontier = files.filter(f => f.text !== undefined && ((0, parsers_1.detectFileType)(f.path)?.id === "requirements")).map(f => ({ file: f, uri: entries.find(e => e.relative === f.path)?.uri }));
    for (let depth = 0; depth < 5 && frontier.length && !token?.isCancellationRequested; depth++) {
        const next = [];
        for (const { file, uri } of frontier) {
            if (!uri || file.text === undefined)
                continue;
            const folder = vscode.workspace.getWorkspaceFolder(uri);
            const includes = [...requirementIncludes(file.text).map(p => ({ p, constraint: false })), ...constraintIncludes(file.text).map(p => ({ p, constraint: true }))];
            for (const { p: include, constraint } of includes) {
                const target = vscode.Uri.joinPath(uri, "..", include);
                if (folder && !(target.fsPath + path.sep).startsWith(folder.uri.fsPath + path.sep))
                    continue;
                const relative = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), include));
                if (known.has(relative) || relative.startsWith(".."))
                    continue;
                known.add(relative);
                // A constraints file is not installed itself; it is read as context to pin what the including file installs.
                const read = { ...(await readOne(target, relative)), hint: "requirements", ...(constraint ? { context: true } : {}) };
                if (read.text === undefined)
                    continue; // a missing include is reported by pip, not here
                added.push({ uri: target, relative, file: read });
                if (!constraint)
                    next.push({ file: read, uri: target });
            }
        }
        frontier = next;
    }
    return added;
}
/**
 * Drops files in a project's build output or vendored dependencies (vendor beside composer.json, target beside pom.xml),
 * and finds the recognised-but-unsupported dependency files among the rest.
 */
async function classify(all, unsupportedUris, token) {
    const known = new Set(all.map(e => e.relative));
    const unsupportedEntries = unsupportedUris.map(uri => ({ uri, relative: relativePath(uri) }));
    for (const e of unsupportedEntries)
        known.add(e.relative);
    const onDisk = new Map();
    // Owner files that are not dependency files (tsconfig.json, mix.exs, CMakeLists.txt) are checked on disk,
    // beside the output folder the file being classified sits in.
    const hasFrom = (entry) => (relative) => {
        if (known.has(relative))
            return Promise.resolve(true);
        let answer = onDisk.get(relative);
        if (!answer) {
            const ups = entry.relative.split("/").length - (relative.split("/").length - 1);
            const uri = vscode.Uri.joinPath(entry.uri, ...Array(ups).fill(".."), path.posix.basename(relative));
            answer = Promise.resolve(vscode.workspace.fs.stat(uri)).then(() => true, () => false);
            onDisk.set(relative, answer);
        }
        return answer;
    };
    const generatedFolders = new Set();
    let generatedFiles = 0;
    const kept = [];
    for (const entry of all) {
        if (token?.isCancellationRequested)
            break;
        const generated = await (0, discovery_rules_1.generatedFolderOf)(entry.relative, hasFrom(entry));
        if (generated) {
            generatedFolders.add(generated);
            generatedFiles++;
            continue;
        }
        kept.push(entry);
    }
    const unsupported = [];
    for (const entry of unsupportedEntries) {
        if (await (0, discovery_rules_1.generatedFolderOf)(entry.relative, hasFrom(entry)))
            continue;
        const dir = path.posix.dirname(entry.relative);
        const siblings = [...known].filter(f => path.posix.dirname(f) === dir).map(f => path.posix.basename(f));
        const format = (0, discovery_rules_1.unsupportedFormatOf)(entry.relative, siblings);
        if (format)
            unsupported.push({ path: entry.relative, format });
    }
    return { kept, unsupported: unsupported.sort((a, b) => a.path.localeCompare(b.path)), generated: { folders: [...generatedFolders].sort(), files: generatedFiles } };
}
async function discoverWorkspace(token, onRead) {
    const limitations = [];
    // Output and vendor folders are filtered after the search, so a generous cap leaves room for them.
    const [uris, unsupportedUris] = await Promise.all([
        vscode.workspace.findFiles(parsers_1.DEPENDENCY_FILE_GLOB, exports.EXCLUDE_GLOB, exports.MAX_FILES * 4 + 1, token),
        vscode.workspace.findFiles(discovery_rules_1.UNSUPPORTED_FILE_GLOB, exports.EXCLUDE_GLOB, 500, token)
    ]);
    const found = uris
        .map(uri => ({ uri, relative: relativePath(uri) }))
        .filter(e => (0, parsers_1.detectFileType)(e.relative) || parsers_1.AUXILIARY_FILES.includes(path.posix.basename(e.relative)));
    const { kept, unsupported, generated } = await classify(found, unsupportedUris, token);
    const entries = kept.sort((a, b) => a.relative.localeCompare(b.relative));
    if (entries.length > exports.MAX_FILES || uris.length > exports.MAX_FILES * 4) {
        limitations.push(`The workspace has more than ${exports.MAX_FILES.toLocaleString("en-US")} dependency files; only the first ${exports.MAX_FILES.toLocaleString("en-US")} were scanned.`);
        entries.length = Math.min(entries.length, exports.MAX_FILES);
    }
    limitations.push("Installed packages and caches (node_modules, .venv, site-packages, …) are skipped; their manifests belong to dependencies, not this project.");
    if (generated.files)
        limitations.push(`${generated.files} dependency file${generated.files === 1 ? " was" : "s were"} left out because ${generated.files === 1 ? "it is" : "they are"} in build output or vendored dependencies of the project beside ${generated.folders.length === 1 ? "it" : "them"} (${generated.folders.slice(0, 5).join(", ")}${generated.folders.length > 5 ? ", …" : ""}).`);
    const files = await readAll(entries, token, onRead);
    const included = await followRequirementIncludes(files, entries, token);
    return { files: [...files, ...included.map(i => i.file)], limitations, locations: locate([...entries, ...included]), unsupported, generated };
}
exports.discoverWorkspace = discoverWorkspace;
/**
 * Files the user chose (from the explorer or a file dialog). Paths are made
 * relative to their common folder so the report does not expose a home directory.
 */
async function discoverFiles(selected, token) {
    const limitations = [];
    // A folder (a project in a monorepo) scans the dependency files inside it.
    const uris = [];
    for (const uri of selected) {
        let isFolder = false;
        try {
            isFolder = ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
        }
        catch { /* missing: reported below */ }
        if (!isFolder) {
            uris.push(uri);
            continue;
        }
        const found = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, parsers_1.DEPENDENCY_FILE_GLOB), exports.EXCLUDE_GLOB, exports.MAX_FILES * 4, token);
        const { kept } = await classify(found.map(f => ({ uri: f, relative: relativePath(f) })), [], token);
        uris.push(...kept.map(k => k.uri).filter(f => !parsers_1.AUXILIARY_FILES.includes(path.posix.basename(f.path))).slice(0, exports.MAX_FILES));
    }
    const supported = uris.filter(uri => (0, parsers_1.detectFileType)(uri.path));
    const skipped = uris.length - supported.length;
    if (skipped)
        limitations.push(`${skipped} selected file${skipped === 1 ? " is" : "s are"} not a supported dependency file and ${skipped === 1 ? "was" : "were"} skipped.`);
    const inWorkspace = supported.every(uri => vscode.workspace.getWorkspaceFolder(uri));
    let entries;
    if (inWorkspace) {
        entries = supported.map(uri => ({ uri, relative: relativePath(uri) }));
    }
    else {
        const dirs = supported.map(uri => path.posix.dirname(uri.path));
        let common = dirs[0] ?? "/";
        for (const dir of dirs)
            while (common !== "/" && !(dir === common || dir.startsWith(`${common}/`)))
                common = path.posix.dirname(common);
        const base = path.posix.dirname(common);
        entries = supported.map(uri => ({ uri, relative: path.posix.relative(base === "/" ? "/" : base, uri.path) }));
    }
    // Context files near the chosen ones: central NuGet versions and Gradle properties next to them, and the
    // parent POMs above a pom.xml (up to the workspace folder), so a module resolves as it does in its reactor.
    const extras = [];
    const addExtra = async (candidate, relative) => {
        if (entries.some(e => e.relative === relative) || extras.some(e => e.relative === relative))
            return;
        try {
            await vscode.workspace.fs.stat(candidate);
            extras.push({ uri: candidate, relative });
        }
        catch { /* not there */ }
    };
    for (const entry of entries) {
        for (const name of parsers_1.AUXILIARY_FILES)
            await addExtra(vscode.Uri.joinPath(entry.uri, "..", name), path.posix.join(path.posix.dirname(entry.relative), name));
        if (!entry.relative.endsWith("pom.xml"))
            continue;
        const folder = vscode.workspace.getWorkspaceFolder(entry.uri);
        let dirUri = vscode.Uri.joinPath(entry.uri, "..");
        let dirRel = path.posix.dirname(entry.relative);
        for (let level = 0; level < 6 && dirRel !== "." && dirRel !== ""; level++) {
            if (folder && dirUri.fsPath === folder.uri.fsPath)
                break;
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
exports.discoverFiles = discoverFiles;
exports.FILE_DIALOG_FILTERS = {
    "Dependency files": ["json", "lock", "yaml", "txt", "toml", "xml", "mod", "gradle", "kts", "csproj", "fsproj", "vbproj", "config", "lockfile", "resolved", "rb"],
    "All files": ["*"]
};
//# sourceMappingURL=workspace.js.map