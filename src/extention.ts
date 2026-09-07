import * as vscode from "vscode";
import * as path from "path";
import { registerCreateSnippetCommand } from "./commands/createSnippetCommand";
import { registerShowSnippetsCommand } from "./commands/showSnippetsCommand";
import { registerListAndRemoveConsoleLogsCommand } from "./commands/listAndRemoveConsoleLogsCommand";
import { registerRemoveUnusedImportsCommand } from "./commands/removeUnusedImportsCommand";
import { codeSnapShot } from "./commands/take-code-snip";
import { apiTest } from "./commands/api-test";
import { registerAdvancedToolsCommands } from "./commands/advancedTools";
import { registerAiMlToolsCommands } from "./commands/aiMlTools";
import { registerBigDataToolsCommands } from "./commands/bigDataTools";
import { registerRagToolsCommands } from "./commands/ragTools";
import { registerAiMlExtraTools } from "./commands/aiMlExtraTools";
import { executeQueuedCommand } from "./utils/command-dispatch";

export function activate(context: vscode.ExtensionContext) {
  const snippetsFolderPath = path.join(context.extensionPath, "custom");

  console.log("DevSnip Pro extension is now active!");
  const myTreeView = new MyTreeDataProvider();
  vscode.window.registerTreeDataProvider("myView", myTreeView);
  context.subscriptions.push({ dispose: () => {} }); // Tree data provider is managed by VS Code

  // Register existing commands
  registerCreateSnippetCommand(context);
  registerShowSnippetsCommand(context, snippetsFolderPath);
  registerListAndRemoveConsoleLogsCommand(context);
  registerRemoveUnusedImportsCommand(context); // Add this line

  apiTest(context);
  codeSnapShot(context);
  
  // Register advanced tools commands
  registerAdvancedToolsCommands(context);

  // Register AI/ML & LLM tools commands
  registerAiMlToolsCommands(context);
  registerAiMlExtraTools(context);

  // Register Big Data tools commands
  registerBigDataToolsCommands(context);

  // Register RAG tools commands
  registerRagToolsCommands(context);
  registerUniversalToolSearch(context);
}

type ToolSearchItem = {
  label: string;
  description: string;
  command: string;
};

const UNIVERSAL_TOOLS: ToolSearchItem[] = [
  { label: "Open REST API Client", description: "Core Workflow", command: "sayaib.hue-console.openGUI" },
  { label: "Capture Code Snapshot", description: "Core Workflow", command: "sayaib.hue-console.captureCode" },
  { label: "Analyze and Remove Console Logs", description: "Core Workflow", command: "sayaib.hue-console.listAndRemoveConsoleLogs" },
  { label: "Remove Unused Imports", description: "Core Workflow", command: "sayaib.hue-console.removeUnusedImports" },
  { label: "Create Custom Code Snippet", description: "Snippets", command: "sayaib.hue-console.createCustomSnippet" },
  { label: "View Saved Code Snippets", description: "Snippets", command: "sayaib.hue-console.showSnippets" },
  { label: "Advanced Developer Tools", description: "Advanced Utilities", command: "sayaib.hue-console.advancedToolsHub" },
  { label: "Regex Builder & Tester", description: "Advanced / Pattern", command: "sayaib.hue-console.regexBuilder" },
  { label: "JSON/XML Formatter", description: "Advanced / Data", command: "sayaib.hue-console.jsonFormatter" },
  { label: "Hash Generator", description: "Advanced / Security", command: "sayaib.hue-console.hashGenerator" },
  { label: "Base64 Encoder/Decoder", description: "Advanced / Encoding", command: "sayaib.hue-console.base64Encoder" },
  { label: "URL Encoder/Decoder", description: "Advanced / Encoding", command: "sayaib.hue-console.urlEncoder" },
  { label: "Timestamp Converter", description: "Advanced / Dates", command: "sayaib.hue-console.timestampConverter" },
  { label: "JSON to TOON Converter", description: "Advanced / Data", command: "sayaib.hue-console.jsonToToon" },
  { label: "Color Palette", description: "Advanced / Design", command: "sayaib.hue-console.colorPalette" },
  { label: "Lorem Ipsum Generator", description: "Advanced / Content", command: "sayaib.hue-console.loremGenerator" },
  { label: "AI/ML & LLM Tools", description: "AI / Hub", command: "sayaib.hue-console.aiMlHub" },
  { label: "Token Counter & Cost Calculator", description: "AI / LLM", command: "sayaib.hue-console.tokenCounter" },
  { label: "Prompt Template Manager", description: "AI / Prompting", command: "sayaib.hue-console.promptTemplate" },
  { label: "Prompt Playground", description: "AI / Prompting", command: "sayaib.hue-console.promptPlayground" },
  { label: "Python ML Code Generator", description: "AI / Model Development", command: "sayaib.hue-console.mlCodeGen" },
  { label: "LLM API Tester", description: "AI / APIs", command: "sayaib.hue-console.llmApiTester" },
  { label: "Dataset Split Calculator", description: "AI / Data", command: "sayaib.hue-console.datasetSplit" },
  { label: "Dataset Profiler", description: "AI / Data", command: "sayaib.hue-console.datasetProfiler" },
  { label: "JSONL Viewer", description: "AI / Data", command: "sayaib.hue-console.jsonlViewer" },
  { label: "Model Metrics Calculator", description: "AI / Evaluation", command: "sayaib.hue-console.metricsCalculator" },
  { label: "GPU VRAM Calculator", description: "AI / Infrastructure", command: "sayaib.hue-console.gpuVram" },
  { label: "Experiment Logger", description: "AI / MLOps", command: "sayaib.hue-console.experimentLogger" },
  { label: "Model Card Generator", description: "AI / Documentation", command: "sayaib.hue-console.modelCard" },
  { label: "Markdown Table Generator", description: "AI / Documentation", command: "sayaib.hue-console.mdTableGen" },
  { label: "Big Data Tools", description: "Data Engineering / Hub", command: "sayaib.hue-console.bigDataHub" },
  { label: "Schema Viewer", description: "Data Engineering / Schema", command: "sayaib.hue-console.schemaViewer" },
  { label: "Spark SQL Formatter", description: "Data Engineering / Querying", command: "sayaib.hue-console.sparkSqlFormatter" },
  { label: "Data Quality Checker", description: "Data Engineering / Quality", command: "sayaib.hue-console.dataQualityChecker" },
  { label: "Schema Diff Tool", description: "Data Engineering / Schema", command: "sayaib.hue-console.schemaDiff" },
  { label: "Partition Calculator", description: "Data Engineering / Performance", command: "sayaib.hue-console.partitionCalc" },
  { label: "RAG Tools", description: "RAG / Hub", command: "sayaib.hue-console.ragHub" },
  { label: "Chunking Strategy Tester", description: "RAG / Ingestion", command: "sayaib.hue-console.chunkingTester" },
  { label: "Embedding Cost Calculator", description: "RAG / Infrastructure", command: "sayaib.hue-console.embeddingCost" },
  { label: "Context Window Calculator", description: "RAG / Retrieval", command: "sayaib.hue-console.contextWindow" },
  { label: "Semantic Dedup Checker", description: "RAG / Quality", command: "sayaib.hue-console.semanticDedup" },
  { label: "RAG Eval Calculator", description: "RAG / Evaluation", command: "sayaib.hue-console.ragEvalScores" },
];

function registerUniversalToolSearch(context: vscode.ExtensionContext): void {
  const searchCommand = vscode.commands.registerCommand("sayaib.hue-console.searchTools", async () => {
    const pattern = await vscode.window.showInputBox({
      title: "Search DevSnip Pro Tools",
      prompt: "Enter a regular expression to match tool names, categories, or commands",
      placeHolder: "e.g. json|schema|rag|calculator",
      value: "",
    });
    if (pattern === undefined) return;

    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern || ".*", "i");
    } catch (error) {
      vscode.window.showErrorMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const matches = UNIVERSAL_TOOLS.filter(tool => matcher.test(`${tool.label} ${tool.description} ${tool.command}`));
    if (!matches.length) {
      vscode.window.showInformationMessage("No DevSnip Pro tools matched that regular expression.");
      return;
    }

    const selected = await vscode.window.showQuickPick(
      matches.map(tool => ({ label: tool.label, description: tool.description, detail: tool.command, command: tool.command })),
      { title: `${matches.length} matching DevSnip Pro tool${matches.length === 1 ? "" : "s"}`, matchOnDescription: true, matchOnDetail: true }
    );
    if (selected) await executeQueuedCommand(selected.command);
  });
  context.subscriptions.push(searchCommand);
}

class MyTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof ToolGroup) {
      return element.children;
    }

    return [
      this.createCommandButton(
        "Search all tools",
        "sayaib.hue-console.searchTools",
        "search",
        new vscode.ThemeColor("terminal.ansiBrightCyan")
      ),
      new ToolGroup("Core Workflow", "rocket", "terminal.ansiBrightYellow", [
        this.createCommandButton("Open REST API Client", "sayaib.hue-console.openGUI", "cloud", new vscode.ThemeColor("terminal.ansiBrightCyan")),
        this.createCommandButton("Capture Code Snapshot", "sayaib.hue-console.captureCode", "code", new vscode.ThemeColor("terminal.ansiBrightYellow")),
        this.createCommandButton("Analyze and Remove Console Logs", "sayaib.hue-console.listAndRemoveConsoleLogs", "trash", new vscode.ThemeColor("terminal.ansiBrightRed")),
        this.createCommandButton("Remove Unused Imports", "sayaib.hue-console.removeUnusedImports", "symbol-method", new vscode.ThemeColor("terminal.ansiBrightGreen")),
      ]),
      new ToolGroup("Snippets", "book", "terminal.ansiBrightMagenta", [
        this.createCommandButton("Create Custom Code Snippet", "sayaib.hue-console.createCustomSnippet", "edit", new vscode.ThemeColor("terminal.ansiBrightBlue")),
        this.createCommandButton("View Saved Code Snippets", "sayaib.hue-console.showSnippets", "file-code", new vscode.ThemeColor("terminal.ansiBrightMagenta")),
      ]),
      new ToolGroup("AI / ML / LLM", "hubot", "terminal.ansiBrightCyan", [
        this.createCommandButton("AI/ML & LLM Tools", "sayaib.hue-console.aiMlHub", "robot", new vscode.ThemeColor("terminal.ansiBrightCyan")),
      ]),
      new ToolGroup("Data Engineering", "database", "terminal.ansiBrightGreen", [
        this.createCommandButton("Big Data Tools", "sayaib.hue-console.bigDataHub", "database", new vscode.ThemeColor("terminal.ansiBrightYellow")),
        this.createCommandButton("RAG Tools", "sayaib.hue-console.ragHub", "search", new vscode.ThemeColor("terminal.ansiBrightMagenta")),
      ]),
      new ToolGroup("Advanced Utilities", "tools", "terminal.ansiBrightWhite", [
        this.createCommandButton("Advanced Developer Tools", "sayaib.hue-console.advancedToolsHub", "tools", new vscode.ThemeColor("terminal.ansiBrightWhite")),
      ]),
    ];
  }

  private createCommandButton(
    label: string,
    command: string,
    iconId: string,
    color?: vscode.ThemeColor,
    description?: string
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None
    );
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(iconId, color); // Adding color to icon
    item.description = description;
    return item;
  }
}

class ToolGroup extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    iconId: string,
    colorId: string,
    public readonly children: vscode.TreeItem[]
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "devsnipToolGroup";
    this.iconPath = new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colorId));
  }
}

export function deactivate() {}
