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
import { registerMilestoneTrackerCommand, setTreeRefreshCallback, setMilestoneContext, autoRecordToolUsage, redeemPoints, refundPoints, getPointsBalance } from "./commands/milestoneTracker";
import { registerTrackedCommand, setCommandObserver, setUsageRecorder } from "./utils/command-registry";
import { initAnalytics, shutdownAnalytics, snapshotInstall, track, trackCommand } from "./analytics";
import { registerReadmeManagerCommand } from "./commands/readmeManager";
import { registerOpenCodeIntegrationCommand } from "./commands/openCodeIntegration";
import { executeQueuedCommand } from "./utils/command-dispatch";
import { disposeAllToolPanels } from "./utils/webview-ui";
import { FeatureAccessService } from "./premium/feature-access";
import { CollectionStore } from "./services/collections";
import { registerPremiumCommands } from "./premium/premium-commands";
import { ToolsSidebarProvider, TOOLS_VIEW_ID } from "./sidebar/tools-sidebar";

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

  const toolsSidebar = new ToolsSidebarProvider(context);
  setTreeRefreshCallback(() => toolsSidebar.refresh());
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(TOOLS_VIEW_ID, toolsSidebar));

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

export async function deactivate(): Promise<void> {
  // Panels opened through the shared registry are not in context.subscriptions.
  disposeAllToolPanels();
  // Ends the session and makes one bounded (2s) attempt to send queued events.
  await shutdownAnalytics();
}
