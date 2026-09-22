import * as vscode from "vscode";
import * as path from "path";
import { registerCreateSnippetCommand } from "./commands/createSnippetCommand";
import { registerShowSnippetsCommand } from "./commands/showSnippetsCommand";
import { registerListAndRemoveConsoleLogsCommand } from "./commands/listAndRemoveConsoleLogsCommand";
import { registerRemoveUnusedImportsCommand } from "./commands/removeUnusedImportsCommand";
import { apiTest } from "./commands/api-test";
import { registerAdvancedToolsCommands } from "./commands/advancedTools";
import { registerAiMlToolsCommands } from "./commands/aiMlTools";
import { registerBigDataToolsCommands } from "./commands/bigDataTools";
import { registerRagToolsCommands } from "./commands/ragTools";
import { registerAiMlExtraTools } from "./commands/aiMlExtraTools";
import { registerPlatformToolsCommands } from "./commands/platformTools";
import { registerMilestoneTrackerCommand, getUserStats, getCurrentLevel, setTreeRefreshCallback, setMilestoneContext, autoRecordToolUsage } from "./commands/milestoneTracker";
import { registerTrackedCommand, setUsageRecorder } from "./utils/command-registry";
import { registerReadmeManagerCommand } from "./commands/readmeManager";
import { registerOpenCodeIntegrationCommand } from "./commands/openCodeIntegration";
import { executeQueuedCommand } from "./utils/command-dispatch";
import { disposeAllToolPanels } from "./utils/webview-ui";

export function activate(context: vscode.ExtensionContext) {
  const snippetsFolderPath = path.join(context.extensionPath, "custom");

  // The milestone store needs its context before any command can record usage.
  setMilestoneContext(context);

  // Tool usage points are awarded by registerTrackedCommand, which every
  // DevSnip Pro command is registered through. The recorder is installed before
  // any command is registered, so no invocation is missed and none is counted twice.
  setUsageRecorder(command => { void autoRecordToolUsage(command); });

  const myTreeView = new MyTreeDataProvider(context);
  setTreeRefreshCallback(() => myTreeView.refresh());
  const treeView = vscode.window.createTreeView("myView", {
    treeDataProvider: myTreeView,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // One failing group must not stop the rest of the extension from loading:
  // a thrown error here would leave every other command unregistered.
  const registrations: Array<[string, () => void]> = [
    ["snippets", () => {
      registerCreateSnippetCommand(context);
      registerShowSnippetsCommand(context, snippetsFolderPath);
    }],
    ["workspace hygiene", () => {
      registerListAndRemoveConsoleLogsCommand(context);
      registerRemoveUnusedImportsCommand(context);
      registerReadmeManagerCommand(context);
    }],
    ["OpenCode integration", () => registerOpenCodeIntegrationCommand(context)],
    ["REST API client", () => apiTest(context)],
    ["developer utilities", () => registerAdvancedToolsCommands(context)],
    ["AI/ML tools", () => {
      registerAiMlToolsCommands(context);
      registerAiMlExtraTools(context);
    }],
    ["big data tools", () => registerBigDataToolsCommands(context)],
    ["RAG tools", () => registerRagToolsCommands(context)],
    ["platform tools", () => registerPlatformToolsCommands(context)],
    ["milestone tracker", () => registerMilestoneTrackerCommand(context)],
    ["tool search", () => registerUniversalToolSearch(context)],
  ];

  for (const [name, register] of registrations) {
    try {
      register();
    } catch (error) {
      console.error(`DevSnip Pro: failed to register ${name}.`, error);
      vscode.window.showErrorMessage(
        `DevSnip Pro could not load its ${name} commands: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

type ToolSearchItem = {
  label: string;
  description: string;
  command: string;
};

const UNIVERSAL_TOOLS: ToolSearchItem[] = [
  { label: "Open REST API Client", description: "Core Workflow", command: "sayaib.hue-console.openGUI" },
  { label: "Analyze and Remove Console Logs", description: "Core Workflow", command: "sayaib.hue-console.listAndRemoveConsoleLogs" },
  { label: "Remove Unused Imports", description: "Core Workflow", command: "sayaib.hue-console.removeUnusedImports" },
  { label: "README Viewer & Manager", description: "Core Workflow", command: "sayaib.hue-console.readmeManager" },
  { label: "OpenCode Integration", description: "Core Workflow", command: "sayaib.hue-console.openCodeIntegration" },
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
  { label: "LR Scheduler Visualizer", description: "AI / Training", command: "sayaib.hue-console.lrScheduler" },
  { label: "LLM Inference & VRAM Estimator", description: "AI / Inference", command: "sayaib.hue-console.inferenceEstimator" },
  { label: "Big Data Tools", description: "Data Engineering / Hub", command: "sayaib.hue-console.bigDataHub" },
  { label: "Schema Viewer", description: "Data Engineering / Schema", command: "sayaib.hue-console.schemaViewer" },
  { label: "Spark SQL Formatter", description: "Data Engineering / Querying", command: "sayaib.hue-console.sparkSqlFormatter" },
  { label: "Data Quality Checker", description: "Data Engineering / Quality", command: "sayaib.hue-console.dataQualityChecker" },
  { label: "Schema Diff Tool", description: "Data Engineering / Schema", command: "sayaib.hue-console.schemaDiff" },
  { label: "Partition Calculator", description: "Data Engineering / Performance", command: "sayaib.hue-console.partitionCalc" },
  { label: "Delta Lake Log Analyzer", description: "Data Engineering / Lakehouse", command: "sayaib.hue-console.deltaLakeAnalyzer" },
  { label: "Spark Cluster & Cost Estimator", description: "Data Engineering / Cloud", command: "sayaib.hue-console.sparkCostEstimator" },
  { label: "RAG Tools", description: "RAG / Hub", command: "sayaib.hue-console.ragHub" },
  { label: "Chunking Strategy Tester", description: "RAG / Ingestion", command: "sayaib.hue-console.chunkingTester" },
  { label: "Embedding Cost Calculator", description: "RAG / Infrastructure", command: "sayaib.hue-console.embeddingCost" },
  { label: "Context Window Calculator", description: "RAG / Retrieval", command: "sayaib.hue-console.contextWindow" },
  { label: "Semantic Dedup Checker", description: "RAG / Quality", command: "sayaib.hue-console.semanticDedup" },
  { label: "RAG Eval Calculator", description: "RAG / Evaluation", command: "sayaib.hue-console.ragEvalScores" },
  { label: "Hybrid Search & RRF Simulator", description: "RAG / Retrieval", command: "sayaib.hue-console.hybridSearchRrf" },
  { label: "RAG Hallucination Analyzer", description: "RAG / Evaluation", command: "sayaib.hue-console.ragHallucinationAnalyzer" },
  { label: "Security Audit", description: "Security / Secrets / Unsafe Code", command: "sayaib.hue-console.securityAudit" },
  { label: "Cloud Security Audit", description: "Security / Terraform / Kubernetes / IAM", command: "sayaib.hue-console.cloudSecurityAudit" },
  { label: "DevOps Artifact Generator", description: "DevOps / Docker / CI", command: "sayaib.hue-console.devopsGenerator" },
  { label: "AI/ML DevOps Generator", description: "MLOps / GPU / Model Serving / ML CI", command: "sayaib.hue-console.mlopsGenerator" },
  { label: "Observability Log Analyzer", description: "Observability / Logs / Reliability", command: "sayaib.hue-console.observabilityAnalyze" },
  { label: "Observability Starter Generator", description: "Observability / OpenTelemetry / Structured Logs", command: "sayaib.hue-console.observabilityStarter" },
  { label: "Milestone & Points Tracker", description: "Gamification / Progress", command: "sayaib.hue-console.milestoneTracker" },
];

function registerUniversalToolSearch(context: vscode.ExtensionContext): void {
  const searchCommand = registerTrackedCommand("sayaib.hue-console.searchTools", async () => {
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
  private readonly groups: ToolGroup[];
  private readonly context: vscode.ExtensionContext;
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.groups = this.createGroups();
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof ToolGroup) {
      return element.children;
    }

    const stats = getUserStats(this.context);
    const level = getCurrentLevel(stats.totalPoints);
    const trackerItem = this.createCommandButton(
      `${level.badge} ${level.name} (${stats.totalPoints} pts)`,
      "sayaib.hue-console.milestoneTracker",
      "trophy",
      new vscode.ThemeColor("terminal.ansiBrightYellow")
    );

    return [
      trackerItem,
      this.createCommandButton(
        "Search tools",
        "sayaib.hue-console.searchTools",
        "search",
        new vscode.ThemeColor("terminal.ansiBrightCyan")
      ),
      ...this.groups,
    ];
  }

  private createGroups(): ToolGroup[] {
    return [
      new ToolGroup("Core", "rocket", "terminal.ansiBrightYellow", [
        this.createCommandButton("REST API Client", "sayaib.hue-console.openGUI", "cloud"),
        this.createCommandButton("Clean Console Logs", "sayaib.hue-console.listAndRemoveConsoleLogs", "trash"),
        this.createCommandButton("Remove Unused Imports", "sayaib.hue-console.removeUnusedImports", "symbol-method"),
        this.createCommandButton("README Viewer & Manager", "sayaib.hue-console.readmeManager", "book"),
        this.createCommandButton("OpenCode Integration", "sayaib.hue-console.openCodeIntegration", "terminal"),
      ]),
      new ToolGroup("Snippets", "book", "terminal.ansiBrightMagenta", [
        this.createCommandButton("Create Snippet", "sayaib.hue-console.createCustomSnippet", "edit"),
        this.createCommandButton("Saved Snippets", "sayaib.hue-console.showSnippets", "file-code"),
      ]),
      new ToolGroup("AI & ML", "hubot", "terminal.ansiBrightCyan", [
        this.createCommandButton("AI & ML Tools", "sayaib.hue-console.aiMlHub", "robot"),
      ]),
      new ToolGroup("Data & RAG", "database", "terminal.ansiBrightGreen", [
        this.createCommandButton("Big Data", "sayaib.hue-console.bigDataHub", "database"),
        this.createCommandButton("RAG", "sayaib.hue-console.ragHub", "search"),
      ]),
      new ToolGroup("Security", "shield", "terminal.ansiBrightRed", [
        this.createCommandButton("Local Security Audit", "sayaib.hue-console.securityAudit", "shield"),
        this.createCommandButton("Cloud Config Audit", "sayaib.hue-console.cloudSecurityAudit", "cloud"),
      ]),
      new ToolGroup("DevOps & Observability", "pulse", "terminal.ansiBrightCyan", [
        this.createCommandButton("DevOps Generator", "sayaib.hue-console.devopsGenerator", "cloud-upload"),
        this.createCommandButton("MLOps Generator", "sayaib.hue-console.mlopsGenerator", "server-process"),
        this.createCommandButton("Log Analyzer", "sayaib.hue-console.observabilityAnalyze", "pulse"),
        this.createCommandButton("Telemetry Starter", "sayaib.hue-console.observabilityStarter", "broadcast"),
      ]),
      new ToolGroup("Utilities", "tools", "terminal.ansiBrightWhite", [
        this.createCommandButton("Developer Utilities", "sayaib.hue-console.advancedToolsHub", "tools"),
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
    item.iconPath = color ? new vscode.ThemeIcon(iconId, color) : new vscode.ThemeIcon(iconId);
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

export function deactivate() {
  // Panels opened through the shared registry are not in context.subscriptions.
  disposeAllToolPanels();
}
