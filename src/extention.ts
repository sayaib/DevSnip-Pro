import * as vscode from "vscode";
import * as path from "path";
import { setSnippetBackupFolder, syncSnippetBackups } from "./utils/snippet-utils";
import { registerHubCommands } from "./commands/hubCommands";
import { registerToolkitCommands } from "./toolkits/runner";
import { registerDatabaseClientCommand } from "./database/command";
import { initThemes, registerThemeCommand, setThemeAccess } from "./theme/service";
import { registerMilestoneTrackerCommand, setTreeRefreshCallback, setMilestoneContext, autoRecordToolUsage, redeemPoints, refundPoints, getPointsBalance, recordDiscovery, Discovery, getUserStats, themeLockFor, buyReward, grantKeptTheme } from "./commands/milestoneTracker";
import { registerLazyCommands, registerTrackedCommand, setCommandObserver, setUsageRecorder } from "./utils/command-registry";
import { classifyInstall, initAnalytics, shutdownAnalytics, snapshotInstall, trackCommand } from "./analytics";
import { initActivation, noteCommand } from "./onboarding/activation";
import { registerOnboardingCommands } from "./onboarding/commands";
import { executeQueuedCommand } from "./utils/command-dispatch";
import { disposeAllToolPanels } from "./utils/webview-ui";
import { FeatureAccessService } from "./premium/feature-access";
import { CollectionStore } from "./services/collections";
import { registerPremiumCommands } from "./premium/premium-commands";
import { ToolsSidebarProvider, TOOLS_VIEW_ID } from "./sidebar/tools-sidebar";

const SNIPPET_COMMANDS = ["createCustomSnippet", "showSnippets"].map(id => `sayaib.hue-console.${id}`);
const HYGIENE_COMMANDS = ["listAndRemoveConsoleLogs", "removeUnusedImports", "readmeManager"].map(id => `sayaib.hue-console.${id}`);
const SECURITY_COMMANDS = ["securityHub", "endpointSecurityScan", "securityAudit", "cloudSecurityAudit", "dependencyAudit"].map(id => `sayaib.hue-console.${id}`);

export function activate(context: vscode.ExtensionContext) {
  // Before anything writes state, so an existing user is never treated as a new install.
  const installSnapshot = snapshotInstall(context);
  const snippetsFolderPath = path.join(context.extensionPath, "custom");

  // The milestone store needs its context before any command can record usage.
  setMilestoneContext(context);
  // User snippets live inside the installed extension, which an update replaces;
  // every save is mirrored to global storage and restored from there.
  const snippetBackup = context.globalStorageUri ? path.join(context.globalStorageUri.fsPath, "snippets") : undefined;
  setSnippetBackupFolder(snippetBackup);
  if (snippetBackup) void restoreSnippetsAfterUpdate(snippetsFolderPath, snippetBackup, context.extensionPath);
  // Every theme but System Default unlocks with points; the picker asks the milestone store.
  setThemeAccess({
    lock: themeId => themeLockFor(getUserStats(context), themeId),
    unlock: async themeId => {
      const lock = themeLockFor(getUserStats(context), themeId);
      return !lock || (await buyReward(context, lock.rewardId)) === "ok";
    },
    grant: themeId => grantKeptTheme(context, themeId)
  });
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
    // Features with a single entry command load on first use, keeping them out of activation.
    ["snippets", () => registerLazyCommands(context.subscriptions, SNIPPET_COMMANDS, async () => {
      (await import("./commands/createSnippetCommand")).registerCreateSnippetCommand(context);
      (await import("./commands/showSnippetsCommand")).registerShowSnippetsCommand(context, snippetsFolderPath);
    })],
    ["workspace hygiene", () => registerLazyCommands(context.subscriptions, HYGIENE_COMMANDS, async () => {
      (await import("./commands/listAndRemoveConsoleLogsCommand")).registerListAndRemoveConsoleLogsCommand(context);
      (await import("./commands/removeUnusedImportsCommand")).registerRemoveUnusedImportsCommand(context);
      (await import("./commands/readmeManager")).registerReadmeManagerCommand(context);
    })],
    ["OpenCode integration", () => registerLazyCommands(context.subscriptions, ["sayaib.hue-console.openCodeIntegration"], async () => {
      (await import("./commands/openCodeIntegration")).registerOpenCodeIntegrationCommand(context);
    })],
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

  // Last, so nothing waits on it.
  initAnalytics(context, installSnapshot);
}

/** Puts back snippets an update removed, and tells the user when it did. Never throws. */
async function restoreSnippetsAfterUpdate(liveFolder: string, backup: string, extensionPath: string): Promise<void> {
  try {
    const restored = await syncSnippetBackups(liveFolder, backup, extensionPath);
    if (!restored) return;
    const choice = await vscode.window.showInformationMessage(
      `DevSnip Pro restored ${restored} custom snippet${restored === 1 ? "" : "s"} after the update. Reload the window if they do not appear in suggestions yet.`,
      "Reload Window"
    );
    if (choice === "Reload Window") await vscode.commands.executeCommand("workbench.action.reloadWindow");
  } catch (error) {
    console.error("DevSnip Pro: could not restore snippets.", error);
  }
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
      vscode.window.showErrorMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const tools = await searchableTools();
    const matches = tools.filter(tool => matcher.test(`${tool.label} ${tool.description} ${tool.command}`));
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

export async function deactivate(): Promise<void> {
  // Panels opened through the shared registry are not in context.subscriptions.
  disposeAllToolPanels();
  // Saves undelivered events and makes one bounded (1s) attempt to send them.
  await shutdownAnalytics();
}
