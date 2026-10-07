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
exports.getLanguageFromFileName = exports.syncSnippetBackups = exports.saveSnippets = exports.readExistingSnippets = exports.getLanguageSnippetsPath = exports.isLanguageSupported = exports.getSupportedLanguages = exports.setSnippetBackupFolder = exports.getSnippetsFolder = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Directory holding the snippet files contributed through package.json.
 *
 * VS Code only loads snippets from files an extension contributes, so user
 * snippets have to live here, inside the installed extension. That folder is
 * replaced on every update, so each save is also copied to a backup folder in
 * the extension's global storage (see setSnippetBackupFolder), and
 * syncSnippetBackups restores from it after an update.
 */
function getSnippetsFolder(context) {
    return path.join(context.extensionPath, "custom");
}
exports.getSnippetsFolder = getSnippetsFolder;
let backupFolder;
/** Where every snippet save is mirrored. Set once at activation. */
function setSnippetBackupFolder(folder) {
    backupFolder = folder;
}
exports.setSnippetBackupFolder = setSnippetBackupFolder;
/**
 * Languages VS Code will actually load snippets for: only the files declared
 * in `contributes.snippets` are read at startup, so writing to any other
 * language would silently produce a snippet that never appears.
 */
function getSupportedLanguages(context) {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(context.extensionPath, "package.json"), "utf8"));
        const languages = (manifest.contributes?.snippets ?? [])
            .map(entry => entry.language)
            .filter((language) => Boolean(language));
        if (languages.length)
            return [...new Set(languages)].sort();
    }
    catch (error) {
        console.error("DevSnip Pro: unable to read contributed snippet languages.", error);
    }
    // Fall back to whatever snippet files are on disk.
    try {
        return fs
            .readdirSync(getSnippetsFolder(context))
            .filter(file => file.startsWith("custom_") && file.endsWith(".json"))
            .map(file => file.slice("custom_".length, -".json".length))
            .sort();
    }
    catch {
        return [];
    }
}
exports.getSupportedLanguages = getSupportedLanguages;
function isLanguageSupported(context, language) {
    return getSupportedLanguages(context).includes(language);
}
exports.isLanguageSupported = isLanguageSupported;
async function getLanguageSnippetsPath(context, language) {
    const snippetsPath = getSnippetsFolder(context);
    if (!fs.existsSync(snippetsPath)) {
        fs.mkdirSync(snippetsPath, { recursive: true });
    }
    return path.join(snippetsPath, `custom_${language}.json`);
}
exports.getLanguageSnippetsPath = getLanguageSnippetsPath;
/**
 * Reads a snippet file. A hand-edited or truncated file must not take the whole
 * command down, so a parse failure is surfaced to the caller instead.
 */
async function readExistingSnippets(filePath) {
    if (!fs.existsSync(filePath))
        return {};
    let content;
    try {
        content = fs.readFileSync(filePath, "utf8");
    }
    catch (error) {
        throw new Error(`Could not read ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!content.trim())
        return {};
    try {
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch (error) {
        throw new Error(`${path.basename(filePath)} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix or delete the file, then try again.`);
    }
}
exports.readExistingSnippets = readExistingSnippets;
async function saveSnippets(filePath, snippets) {
    const content = `${JSON.stringify(snippets, null, 2)}\n`;
    try {
        fs.writeFileSync(filePath, content, "utf8");
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not write ${path.basename(filePath)} (${reason}). Snippets are stored inside the extension folder, which must be writable.`);
    }
    if (!backupFolder)
        return;
    try {
        await fs.promises.mkdir(backupFolder, { recursive: true });
        await fs.promises.writeFile(path.join(backupFolder, path.basename(filePath)), content, "utf8");
    }
    catch (error) {
        // The snippet itself is saved; only the copy that survives updates failed.
        console.error("DevSnip Pro: could not back up snippets.", error);
    }
}
exports.saveSnippets = saveSnippets;
/** Reads a snippet file for syncing: undefined when missing or not valid JSON (then it is left alone). */
async function readForSync(filePath) {
    let raw;
    try {
        raw = await fs.promises.readFile(filePath, "utf8");
    }
    catch {
        return undefined;
    }
    if (!raw.trim())
        return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/** The snippets folder of the newest other installed version of this extension, if any is still on disk. */
async function previousVersionFolder(extensionPath) {
    const root = path.dirname(extensionPath);
    const current = path.basename(extensionPath);
    const match = /^(.+?)-(\d+)\.(\d+)\.(\d+)/.exec(current);
    if (!match)
        return undefined;
    const prefix = `${match[1].toLowerCase()}-`;
    let entries;
    try {
        entries = await fs.promises.readdir(root);
    }
    catch {
        return undefined;
    }
    const versions = entries
        .filter(name => name !== current && name.toLowerCase().startsWith(prefix))
        .map(name => ({ name, parts: /-(\d+)\.(\d+)\.(\d+)/.exec(name)?.slice(1).map(Number) }))
        .filter((entry) => !!entry.parts)
        .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
    return versions.length ? path.join(root, versions[0].name, "custom") : undefined;
}
/**
 * Keeps the snippet files in the extension folder and their backups in step.
 *
 * - A file the update replaced with an empty one is restored from its backup.
 * - Otherwise the extension's file is the truth and the backup is refreshed,
 *   so hand edits and deletions are kept.
 * - The first time there is no backup yet, snippets are recovered from an
 *   older installed version of the extension if VS Code has not removed it.
 *
 * Only languages the extension contributes are written. Returns how many
 * snippets were restored.
 */
async function syncSnippetBackups(liveFolder, backup, extensionPath) {
    let firstRun = false;
    try {
        await fs.promises.access(backup);
    }
    catch {
        firstRun = true;
    }
    await fs.promises.mkdir(backup, { recursive: true });
    const legacy = firstRun && extensionPath ? await previousVersionFolder(extensionPath) : undefined;
    let files;
    try {
        files = (await fs.promises.readdir(liveFolder)).filter(file => /^custom_.+\.json$/.test(file));
    }
    catch {
        return 0;
    }
    let restored = 0;
    for (const file of files) {
        const live = await readForSync(path.join(liveFolder, file));
        if (!live)
            continue;
        const saved = (await readForSync(path.join(backup, file))) ?? (legacy ? await readForSync(path.join(legacy, file)) : undefined);
        const liveCount = Object.keys(live).length;
        if (!liveCount && saved && Object.keys(saved).length) {
            const content = `${JSON.stringify(saved, null, 2)}\n`;
            await fs.promises.writeFile(path.join(liveFolder, file), content, "utf8");
            await fs.promises.writeFile(path.join(backup, file), content, "utf8");
            restored += Object.keys(saved).length;
        }
        else if (liveCount && JSON.stringify(live) !== JSON.stringify(saved)) {
            // Only write when something changed, so an ordinary start does no disk writes.
            await fs.promises.writeFile(path.join(backup, file), `${JSON.stringify(live, null, 2)}\n`, "utf8");
        }
    }
    return restored;
}
exports.syncSnippetBackups = syncSnippetBackups;
function getLanguageFromFileName(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    switch (extension) {
        case ".ts":
            return "typescript";
        case ".tsx":
            return "typescriptreact";
        case ".js":
            return "javascript";
        case ".jsx":
            return "javascriptreact";
        case ".html":
            return "html";
        case ".css":
            return "css";
        case ".scss":
            return "scss";
        case ".sass":
            return "sass";
        case ".json":
            return "json";
        case ".yml":
        case ".yaml":
            return "yaml";
        case ".md":
            return "markdown";
        case ".py":
            return "python";
        case ".java":
            return "java";
        case ".c":
            return "c";
        case ".cpp":
            return "cpp";
        case ".h":
            return "cpp"; // Header files treated as C++ by default
        case ".cs":
            return "csharp";
        case ".php":
            return "php";
        case ".rb":
            return "ruby";
        case ".go":
            return "go";
        case ".sh":
            return "shellscript";
        case ".bat":
            return "bat";
        case ".ps1":
            return "powershell";
        case ".kt":
            return "kotlin";
        case ".swift":
            return "swift";
        case ".rs":
            return "rust";
        case ".dart":
            return "dart";
        case ".lua":
            return "lua";
        case ".sql":
            return "sql";
        case ".r":
            return "r";
        case ".pl":
            return "perl";
        case ".xml":
            return "xml";
        case ".svg":
            return "xml"; // SVG files are treated as XML
        case ".txt":
            return "plaintext";
        case ".log":
            return "log";
        case ".ini":
            return "ini";
        case ".dockerfile":
            return "dockerfile";
        case ".toml":
            return "toml";
        case ".makefile":
        case "Makefile":
            return "makefile";
        // VS Code opens Gradle build files as Groovy.
        case ".gradle":
        case ".groovy":
            return "groovy";
        case ".vb":
            return "vb";
        case ".asm":
            return "asm";
        case ".coffee":
            return "coffeescript";
        case ".vue":
            return "vue";
        case ".svelte":
            return "svelte";
        case ".elm":
            return "elm";
        case ".nim":
            return "nim";
        default:
            return "plaintext"; // Default to plaintext
    }
}
exports.getLanguageFromFileName = getLanguageFromFileName;
//# sourceMappingURL=snippet-utils.js.map