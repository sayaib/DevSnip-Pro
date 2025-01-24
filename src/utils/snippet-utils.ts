import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface SnippetDefinition {
  prefix: string;
  body: string[];
  description: string;
  scope?: string;
}

export async function getLanguageSnippetsPath(
  context: vscode.ExtensionContext,
  language: string
): Promise<string> {
  const snippetsPath = path.join(context.extensionPath, "custom");
  if (!fs.existsSync(snippetsPath)) {
    fs.mkdirSync(snippetsPath, { recursive: true });
  }
  return path.join(snippetsPath, `custom_${language}.json`);
}

export async function readExistingSnippets(
  filePath: string
): Promise<Record<string, SnippetDefinition>> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Error reading snippets:", error);
  }
  return {};
}

export async function saveSnippets(
  filePath: string,
  snippets: Record<string, SnippetDefinition>
): Promise<void> {
  fs.writeFileSync(filePath, JSON.stringify(snippets, null, 2));
}

export function getLanguageFromFileName(fileName: string): string {
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
