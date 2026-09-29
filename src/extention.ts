import * as vscode from "vscode";
import * as path from "path";
import { registerCreateSnippetCommand } from "./commands/createSnippetCommand";
import { registerShowSnippetsCommand } from "./commands/showSnippetsCommand";
import { registerListAndRemoveConsoleLogsCommand } from "./commands/listAndRemoveConsoleLogsCommand";
import { registerRemoveUnusedImportsCommand } from "./commands/removeUnusedImportsCommand";
import { apiTest } from "./commands/api-test";
import { registerAdvancedToolsCommands } from "./commands/advancedTools";
import { registerDependencyManagerCommand } from "./commands/dependencyManager";
import { registerHubCommands } from "./commands/hubCommands";
import { registerToolkitCommands } from "./toolkits/runner";
import { registerSecurityToolsCommands } from "./commands/securityTools";
import { registerMilestoneTrackerCommand, getUserStats, getCurrentLevel, setTreeRefreshCallback, setMilestoneContext, autoRecordToolUsage, redeemPoints, refundPoints, getPointsBalance } from "./commands/milestoneTracker";
import { registerTrackedCommand, setCommandObserver, setUsageRecorder } from "./utils/command-registry";
import { initAnalytics, shutdownAnalytics, snapshotInstall, track, trackCommand } from "./analytics";
import { registerReadmeManagerCommand } from "./commands/readmeManager";
import { registerOpenCodeIntegrationCommand } from "./commands/openCodeIntegration";
import { executeQueuedCommand } from "./utils/command-dispatch";
import { disposeAllToolPanels } from "./utils/webview-ui";
import { FeatureAccessService } from "./premium/feature-access";
import { CollectionStore } from "./services/collections";
import { registerPremiumCommands } from "./premium/premium-commands";

export function activate(context: vscode.ExtensionContext) {
  const activationStart = Date.now();
  // Before anything writes state, so an existing user is never reported as a new install.
  const installSnapshot = snapshotInstall(context);
  const snippetsFolderPath = path.join(context.extensionPath, "custom");

  // The milestone store needs its context before any command can record usage.
  setMilestoneContext(context);

  // Tool usage points are awarded by registerTrackedCommand, which every
  // DevSnip Pro command is registered through. The recorder is installed before
  // any command is registered, so no invocation is missed and none is counted twice.
  setUsageRecorder(command => { void autoRecordToolUsage(command); });
  setCommandObserver(trackCommand);

  // Premium REST API Client features are unlocked by spending DevSnip Pro
  // points, so the access service is given a ledger over the milestone
  // tracker's balance. There is no licence and no subscription.
  const access = new FeatureAccessService(context, {
    balance: () => getPointsBalance(context),
    spend: (amount, reason) => redeemPoints(context, amount, reason),
    refund: (amount, reason) => refundPoints(context, amount, reason)
  });

  const collections = new CollectionStore(context, access);

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
    ["REST API client", () => apiTest(context, { access, collections })],
    ["premium commands", () => registerPremiumCommands(context, access)],
    ["developer utilities", () => registerAdvancedToolsCommands(context)],
    ["dependencies & installation", () => registerDependencyManagerCommand(context)],
    ["tool hubs", () => registerHubCommands(context)],
    ["developer, AI, RAG, data and DevOps tools", () => registerToolkitCommands(context)],
    ["security tools", () => registerSecurityToolsCommands(context)],
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

  // Last, so activation_ms covers the whole activation and nothing waits on it.
  initAnalytics(context, activationStart, installSnapshot);
}

type ToolSearchItem = {
  label: string;
  description: string;
  command: string;
};

/** Tools that are not part of the toolkit registry. Toolkit tools are added at search time. */
const STANDALONE_TOOLS: ToolSearchItem[] = [
  { label: "REST API Client", description: "Core / HTTP / GraphQL / WebSocket", command: "sayaib.hue-console.openGUI" },
  { label: "Analyze and Remove Console Logs", description: "Core / Cleanup", command: "sayaib.hue-console.listAndRemoveConsoleLogs" },
  { label: "Remove Unused Imports", description: "Core / Cleanup", command: "sayaib.hue-console.removeUnusedImports" },
  { label: "README Viewer & Manager", description: "Core / Docs", command: "sayaib.hue-console.readmeManager" },
  { label: "OpenCode Integration", description: "Core / AI assistant", command: "sayaib.hue-console.openCodeIntegration" },
  { label: "Create Custom Code Snippet", description: "Snippets", command: "sayaib.hue-console.createCustomSnippet" },
  { label: "View Saved Code Snippets", description: "Snippets", command: "sayaib.hue-console.showSnippets" },
  { label: "Developer Tools", description: "Hub", command: "sayaib.hue-console.advancedToolsHub" },
  { label: "AI & ML Tools", description: "Hub", command: "sayaib.hue-console.aiMlHub" },
  { label: "RAG Tools", description: "Hub", command: "sayaib.hue-console.ragHub" },
  { label: "Data Tools", description: "Hub", command: "sayaib.hue-console.bigDataHub" },
  { label: "DevOps Tools", description: "Hub", command: "sayaib.hue-console.devopsGenerator" },
  { label: "Dependencies & Installation", description: "Developer Tools / npm / yarn / pnpm / pip / Maven / Gradle", command: "sayaib.hue-console.dependencyManager" },
  { label: "Regex Builder & Tester", description: "Developer Tools / Pattern", command: "sayaib.hue-console.regexBuilder" },
  { label: "JSON/XML Formatter", description: "Developer Tools / Format / Validate", command: "sayaib.hue-console.jsonFormatter" },
  { label: "Hash Generator", description: "Developer Tools / SHA", command: "sayaib.hue-console.hashGenerator" },
  { label: "Timestamp Converter", description: "Developer Tools / Epoch / Dates", command: "sayaib.hue-console.timestampConverter" },
  { label: "Color Palette", description: "Developer Tools / Design / Contrast", command: "sayaib.hue-console.colorPalette" },
  { label: "Security Hub", description: "Security / Endpoint / Workspace / Cloud / Dependencies", command: "sayaib.hue-console.securityHub" },
  { label: "Endpoint Security Scan", description: "Security / Headers / HSTS / CSP / CORS / TLS / Cookies", command: "sayaib.hue-console.endpointSecurityScan" },
  { label: "Security Audit", description: "Security / Secrets / Injection / Unsafe Code", command: "sayaib.hue-console.securityAudit" },
  { label: "Cloud Security Audit", description: "Security / Terraform / Kubernetes / Docker / IAM", command: "sayaib.hue-console.cloudSecurityAudit" },
  { label: "Dependency & Config Check", description: "Security / Lockfiles / Advisories / CI hardening", command: "sayaib.hue-console.dependencyAudit" },
  { label: "Milestone & Points Tracker", description: "Progress", command: "sayaib.hue-console.milestoneTracker" },
];

/** Every searchable tool: the standalone ones plus the toolkit (title, section, category and keywords). */
async function searchableTools(): Promise<ToolSearchItem[]> {
  const { ALL_TOOLS, SECTIONS } = await import("./toolkits/registry");
  const toolkit = ALL_TOOLS.map(tool => ({
    label: tool.title,
    description: `${SECTIONS.find(s => s.id === tool.section)?.title} / ${tool.category} / ${(tool.keywords ?? []).slice(0, 5).join(" / ")}`,
    command: `sayaib.hue-console.${tool.command}`
  }));
  return [...STANDALONE_TOOLS, ...toolkit];
}

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
      track("tool_search_performed", { query_length: pattern.length, match_count: 0, invalid_pattern: true });
      vscode.window.showErrorMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const tools = await searchableTools();
    const matches = tools.filter(tool => matcher.test(`${tool.label} ${tool.description} ${tool.command}`));
    // The query itself is never sent - only its length and how many tools matched.
    track("tool_search_performed", { query_length: pattern.length, match_count: matches.length, invalid_pattern: false });
    if (!matches.length) {
      vscode.window.showInformationMessage("No DevSnip Pro tools matched that regular expression.");
      return;
    }

    const selected = await vscode.window.showQuickPick(
      matches.map(tool => ({ label: tool.label, description: tool.description, detail: tool.command, command: tool.command })),
      { title: `${matches.length} matching DevSnip Pro tool${matches.length === 1 ? "" : "s"}`, matchOnDescription: true, matchOnDetail: true }
    );
    if (selected) {
      track("tool_search_selected", {
        feature: selected.command.replace("sayaib.hue-console.", ""),
        rank: matches.findIndex(tool => tool.command === selected.command) + 1
      });
      await executeQueuedCommand(selected.command);
    }
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
    // The level follows lifetime points so spending never demotes it; the number is the spendable balance.
    const level = getCurrentLevel(stats.lifetimePoints);
    const trackerItem = this.createCommandButton(
      `${level.badge} ${level.name} (${stats.totalPoints} pts)`,
      "sayaib.hue-console.milestoneTracker",
      "trophy",
      new vscode.ThemeColor("terminal.ansiBrightYellow")
    );
    trackerItem.tooltip = `${level.name} level - ${stats.lifetimePoints} points earned in total, ${stats.totalPoints} available to spend`;

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
    const c = (id: string) => `sayaib.hue-console.${id}`;
    return [
      new ToolGroup("Core", "rocket", "terminal.ansiBrightYellow", [
        this.createCommandButton("REST API Client", c("openGUI"), "cloud"),
        this.createCommandButton("Clean Console Logs", c("listAndRemoveConsoleLogs"), "trash"),
        this.createCommandButton("Remove Unused Imports", c("removeUnusedImports"), "symbol-method"),
        this.createCommandButton("README Viewer & Manager", c("readmeManager"), "book"),
        this.createCommandButton("OpenCode Integration", c("openCodeIntegration"), "terminal"),
      ]),
      new ToolGroup("Snippets", "book", "terminal.ansiBrightMagenta", [
        this.createCommandButton("Create Snippet", c("createCustomSnippet"), "edit"),
        this.createCommandButton("Saved Snippets", c("showSnippets"), "file-code"),
      ]),
      new ToolGroup("Developer Tools", "tools", "terminal.ansiBrightWhite", [
        this.createCommandButton("All developer tools", c("advancedToolsHub"), "layout"),
        this.createCommandButton("JSON/XML Formatter", c("jsonFormatter"), "json"),
        this.createCommandButton("Encode / Decode", c("base64Encoder"), "symbol-string"),
        this.createCommandButton("JWT Decoder", c("jwtDecoder"), "key"),
        this.createCommandButton("Diff Checker", c("textDiff"), "diff"),
        this.createCommandButton("Dependencies & Installation", c("dependencyManager"), "package"),
      ]),
      new ToolGroup("AI & ML", "hubot", "terminal.ansiBrightCyan", [
        this.createCommandButton("All AI & ML tools", c("aiMlHub"), "layout"),
        this.createCommandButton("Prompt Builder", c("promptTemplate"), "comment-discussion"),
        this.createCommandButton("Token & Cost Estimator", c("tokenCounter"), "symbol-numeric"),
        this.createCommandButton("LLM Client Setup", c("llmClientSetup"), "plug"),
        this.createCommandButton("LLM JSON Validator", c("llmJsonValidator"), "json"),
      ]),
      new ToolGroup("RAG", "search", "terminal.ansiBrightGreen", [
        this.createCommandButton("All RAG tools", c("ragHub"), "layout"),
        this.createCommandButton("Chunking Tester", c("chunkingTester"), "list-flat"),
        this.createCommandButton("RAG Pipeline Generator", c("ragPipeline"), "rocket"),
        this.createCommandButton("Retrieval Evaluation", c("ragEvalScores"), "checklist"),
      ]),
      new ToolGroup("Data", "database", "terminal.ansiBrightGreen", [
        this.createCommandButton("All data tools", c("bigDataHub"), "layout"),
        this.createCommandButton("Data Converter", c("dataConverter"), "arrow-swap"),
        this.createCommandButton("JSON to Types", c("jsonToTypes"), "symbol-class"),
        this.createCommandButton("SQL Formatter & Linter", c("sparkSqlFormatter"), "database"),
        this.createCommandButton("Mock Data Generator", c("mockDataGenerator"), "sparkle"),
      ]),
      new ToolGroup("DevOps", "server-environment", "terminal.ansiBrightBlue", [
        this.createCommandButton("All DevOps tools", c("devopsGenerator"), "layout"),
        this.createCommandButton("Dockerfile", c("dockerfileHelper"), "package"),
        this.createCommandButton("Docker Compose", c("composeHelper"), "layers"),
        this.createCommandButton("Kubernetes & Helm", c("kubernetesHelper"), "server"),
        this.createCommandButton("CI Pipeline", c("ciPipelineGenerator"), "github-action"),
        this.createCommandButton(".env Checker", c("envChecker"), "key"),
        this.createCommandButton("Log Analyzer", c("observabilityAnalyze"), "pulse"),
      ]),
      new ToolGroup("Security", "shield", "terminal.ansiBrightRed", [
        this.createCommandButton("Security Hub", c("securityHub"), "shield"),
        this.createCommandButton("Endpoint Security Scan", c("endpointSecurityScan"), "radio-tower"),
        this.createCommandButton("Workspace Audit", c("securityAudit"), "search"),
        this.createCommandButton("Cloud & Container Audit", c("cloudSecurityAudit"), "cloud"),
        this.createCommandButton("Dependency & Config Check", c("dependencyAudit"), "package"),
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

export async function deactivate(): Promise<void> {
  // Panels opened through the shared registry are not in context.subscriptions.
  disposeAllToolPanels();
  // Ends the session and makes one bounded (2s) attempt to send queued events.
  await shutdownAnalytics();
}
