import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface SnippetDefinition {
  prefix: string;
  body: string[];
  description: string;
  scope?: string;
}

/** Directory holding the snippet files contributed through package.json. */
export function getSnippetsFolder(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "custom");
}

/**
 * Languages VS Code will actually load snippets for: only the files declared
 * in `contributes.snippets` are read at startup, so writing to any other
 * language would silently produce a snippet that never appears.
 */
export function getSupportedLanguages(context: vscode.ExtensionContext): string[] {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(context.extensionPath, "package.json"), "utf8")
    ) as { contributes?: { snippets?: Array<{ language?: string }> } };
    const languages = (manifest.contributes?.snippets ?? [])
      .map(entry => entry.language)
      .filter((language): language is string => Boolean(language));
    if (languages.length) return [...new Set(languages)].sort();
  } catch (error) {
    console.error("DevSnip Pro: unable to read contributed snippet languages.", error);
  }
  // Fall back to whatever snippet files are on disk.
  try {
    return fs
      .readdirSync(getSnippetsFolder(context))
      .filter(file => file.startsWith("custom_") && file.endsWith(".json"))
      .map(file => file.slice("custom_".length, -".json".length))
      .sort();
  } catch {
    return [];
  }
}

export function isLanguageSupported(context: vscode.ExtensionContext, language: string): boolean {
  return getSupportedLanguages(context).includes(language);
}

export async function getLanguageSnippetsPath(
  context: vscode.ExtensionContext,
  language: string
): Promise<string> {
  const snippetsPath = getSnippetsFolder(context);
  if (!fs.existsSync(snippetsPath)) {
    fs.mkdirSync(snippetsPath, { recursive: true });
  }
  return path.join(snippetsPath, `custom_${language}.json`);
}

/**
 * Reads a snippet file. A hand-edited or truncated file must not take the whole
 * command down, so a parse failure is surfaced to the caller instead.
 */
export async function readExistingSnippets(
  filePath: string
): Promise<Record<string, SnippetDefinition>> {
  if (!fs.existsSync(filePath)) return {};
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!content.trim()) return {};
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(
      `${path.basename(filePath)} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix or delete the file, then try again.`
    );
  }
}

export async function saveSnippets(
  filePath: string,
  snippets: Record<string, SnippetDefinition>
): Promise<void> {
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(snippets, null, 2)}\n`, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not write ${path.basename(filePath)} (${reason}). Snippets are stored inside the extension folder, which must be writable.`
    );
  }
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
