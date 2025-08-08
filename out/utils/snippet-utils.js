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
exports.getLanguageFromFileName = exports.saveSnippets = exports.readExistingSnippets = exports.getLanguageSnippetsPath = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
async function getLanguageSnippetsPath(context, language) {
    const snippetsPath = path.join(context.extensionPath, "custom");
    if (!fs.existsSync(snippetsPath)) {
        fs.mkdirSync(snippetsPath, { recursive: true });
    }
    return path.join(snippetsPath, `custom_${language}.json`);
}
exports.getLanguageSnippetsPath = getLanguageSnippetsPath;
async function readExistingSnippets(filePath) {
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
}
exports.readExistingSnippets = readExistingSnippets;
async function saveSnippets(filePath, snippets) {
    fs.writeFileSync(filePath, JSON.stringify(snippets, null, 2));
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
            return "cpp";
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
            return "xml";
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
            return "plaintext";
    }
}
exports.getLanguageFromFileName = getLanguageFromFileName;
//# sourceMappingURL=snippet-utils.js.map