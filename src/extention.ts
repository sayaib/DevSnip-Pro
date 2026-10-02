import * as vscode from "vscode";
import * as path from "path";
import { registerCreateSnippetCommand } from "./commands/createSnippetCommand";
import { registerShowSnippetsCommand } from "./commands/showSnippetsCommand";
import { registerListAndRemoveConsoleLogsCommand } from "./commands/listAndRemoveConsoleLogsCommand";
import { registerRemoveUnusedImportsCommand } from "./commands/removeUnusedImportsCommand";
import { registerHubCommands } from "./commands/hubCommands";
import { registerToolkitCommands } from "./toolkits/runner";
import { registerDatabaseClientCommand } from "./database/command";
import { initThemes, registerThemeCommand } from "./theme/service";
import { registerMilestoneTrackerCommand, setTreeRefreshCallback, setMilestoneContext, autoRecordToolUsage, redeemPoints, refundPoints, getPointsBalance, recordDiscovery, Discovery } from "./commands/milestoneTracker";
import { registerLazyCommands, registerTrackedCommand, setCommandObserver, setUsageRecorder } from "./utils/command-registry";
import { classifyInstall, initAnalytics, shutdownAnalytics, snapshotInstall, track, trackCommand } from "./analytics";
import { initActivation, noteCommand } from "./onboarding/activation";
import { registerOnboardingCommands } from "./onboarding/commands";
import { registerReadmeManagerCommand } from "./commands/readmeManager";
import { registerOpenCodeIntegrationCommand } from "./commands/openCodeIntegration";
import { executeQueuedCommand } from "./utils/command-dispatch";
import { disposeAllToolPanels } from "./utils/webview-ui";
import { FeatureAccessService } from "./premium/feature-access";
import { CollectionStore } from "./services/collections";
import { registerPremiumCommands } from "./premium/premium-commands";
import { ToolsSidebarProvider, TOOLS_VIEW_ID } from "./sidebar/tools-sidebar";

const SECURITY_COMMANDS = ["securityHub", "endpointSecurityScan", "securityAudit", "cloudSecurityAudit", "dependencyAudit"].map(id => `sayaib.hue-console.${id}`);

export function activate(context: vscode.ExtensionContext) {
  const activationStart = Date.now();
  // Before anything writes state, so an existing user is never reported as a new install.
  const installSnapshot = snapshotInstall(context);
  const snippetsFolderPath = path.join(context.extensionPath, "custom");

  // The milestone store needs its context before any command can record usage.
  setMilestoneContext(context);
  // The appearance theme is read before any webview renders, so none flashes the wrong theme.
  initThemes(context);
  // Local first-use and onboarding state. The install snapshot decides whether this is a new user.
  const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
  const install = classifyInstall(installSnapshot, version);
  void initActivation(context, version, {
    isNewInstall: install.firstRun,
    previousVersion: install.previousVersion,
    recordDiscovery: id => recordDiscovery(context, id as Discovery)
  }).catch(error => console.error("DevSnip Pro: onboarding state could not be loaded.", error));

  // Tool usage points are awarded by registerTrackedCommand, which every
  // DevSnip Pro command is registered through. The recorder is installed before
  // any command is registered, so no invocation is missed and none is counted twice.
  // The Tools sidebar is created below; its recently/most used lists come from here too.
  let toolsSidebar: ToolsSidebarProvider | undefined;
  setUsageRecorder(command => {
    void autoRecordToolUsage(command);
    toolsSidebar?.recordUsage(command);
    noteCommand(command);
  });
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

  toolsSidebar = new ToolsSidebarProvider(context);
  setTreeRefreshCallback(() => toolsSidebar?.refresh());
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
    // The three largest features load on first use, keeping them out of activation.
    ["REST API client", () => registerLazyCommands(context.subscriptions, ["sayaib.hue-console.openGUI"], async () => {
      (await import("./commands/api-test")).apiTest(context, { access, collections });
    })],
    ["premium commands", () => registerPremiumCommands(context, access)],
    ["dependencies & installation", () => registerLazyCommands(context.subscriptions, ["sayaib.hue-console.dependencyManager"], async () => {
      (await import("./commands/dependencyManager")).registerDependencyManagerCommand(context);
    })],
    ["tool hubs", () => registerHubCommands(context)],
    ["toolkit tools", () => registerToolkitCommands(context)],
    ["security tools", () => registerLazyCommands(context.subscriptions, SECURITY_COMMANDS, async () => {
      (await import("./commands/securityTools")).registerSecurityToolsCommands(context);
    })],
    ["database client", () => registerDatabaseClientCommand(context)],
    ["appearance themes", () => registerThemeCommand(context)],
    ["onboarding", () => registerOnboardingCommands(context)],
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

/** Every tool in the navigation, in section order: section, sub-group and keywords make it findable. */
async function searchableTools(): Promise<ToolSearchItem[]> {
  const { NAV, COMMAND_PREFIX } = await import("./toolkits/layout");
  const { findTool } = await import("./toolkits/registry");
  const tools = NAV.flatMap(section => section.entries.map(entry => {
    const tool = entry.tool ? findTool(entry.tool) : undefined;
    const keywords = (tool?.keywords ?? entry.keywords ?? []).slice(0, 5);
    return {
      label: tool?.title ?? entry.label,
      description: [section.title, entry.category, ...keywords].filter(Boolean).join(" / "),
      command: COMMAND_PREFIX + entry.command
    };
  }));
  return [
    ...tools,
    { label: "Browse All Tools", description: "All sections, with search and pinning", command: `${COMMAND_PREFIX}advancedToolsHub` },
    { label: "Security Hub", description: "Security & Auth / every security scan in one panel", command: `${COMMAND_PREFIX}securityHub` },
    { label: "Milestone & Points Tracker", description: "Progress", command: `${COMMAND_PREFIX}milestoneTracker` }
  ];
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
