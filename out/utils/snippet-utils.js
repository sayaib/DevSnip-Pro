"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLanguageFromFileName = exports.saveSnippets = exports.readExistingSnippets = exports.getLanguageSnippetsPath = void 0;
const fs = require("fs");
const path = require("path");
function getLanguageSnippetsPath(context, language) {
    return __awaiter(this, void 0, void 0, function* () {
        const snippetsPath = path.join(context.extensionPath, "custom");
        if (!fs.existsSync(snippetsPath)) {
            fs.mkdirSync(snippetsPath, { recursive: true });
        }
        return path.join(snippetsPath, `custom_${language}.json`);
    });
}
exports.getLanguageSnippetsPath = getLanguageSnippetsPath;
function readExistingSnippets(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, "utf8");
                return JSON.parse(content);
            }
        }
        catch (error) {
            console.error("Error reading snippets:", error);
        }
        return {};
    });
}
exports.readExistingSnippets = readExistingSnippets;
function saveSnippets(filePath, snippets) {
    return __awaiter(this, void 0, void 0, function* () {
        fs.writeFileSync(filePath, JSON.stringify(snippets, null, 2));
    });
}
exports.saveSnippets = saveSnippets;
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
        case ".gradle":
            return "gradle";
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