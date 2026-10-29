import * as vscode from "vscode";
import { ToolsSidebarProvider, TOOLS_VIEW_ID } from "../sidebar/tools-sidebar";
import { registerHubCommands } from "../commands/hubCommands";
import { registerToolkitCommands } from "../toolkits/runner";
import { registerOnboardingCommands } from "../onboarding/commands";
import { initActivation, noteCommand } from "../onboarding/activation";
import { autoRecordToolUsage, buyReward, getUserStats, grantKeptTheme, recordDiscovery, registerMilestoneTrackerCommand, setMilestoneContext, setTreeRefreshCallback, themeLockFor, Discovery } from "../commands/milestoneTracker";
import { initThemes, registerThemeCommand, setThemeAccess } from "../theme/service";
import { COMMAND_PREFIX, registerLazyCommands, setUsageRecorder } from "../utils/command-registry";
import { disposeAllToolPanels } from "../utils/webview-ui";
import { registerUniversalToolSearch } from "../commands/toolSearch";

/** Browser activation never imports the Desktop activation graph or its drivers. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await vscode.commands.executeCommand("setContext", "devsnip.webHost", true);
  setMilestoneContext(context);
  setThemeAccess({
    lock: id => themeLockFor(getUserStats(context), id),
    unlock: async id => {
      const lock = themeLockFor(getUserStats(context), id);
      return !lock || (await buyReward(context, lock.rewardId)) === "ok";
    },
    grant: id => grantKeptTheme(context, id)
  });
  initThemes(context);
  const sidebar = new ToolsSidebarProvider(context);
  setTreeRefreshCallback(() => sidebar.refresh());
  setUsageRecorder(command => {
    void autoRecordToolUsage(command);
    sidebar.recordUsage(command);
    noteCommand(command);
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(TOOLS_VIEW_ID, sidebar));
  registerToolkitCommands(context);
  registerHubCommands(context);
  registerThemeCommand(context);
  registerMilestoneTrackerCommand(context);
  registerOnboardingCommands(context);
  registerLazyCommands(context.subscriptions, ["insertDebugLog", "removeDebugLogsInFile"].map(c => COMMAND_PREFIX + c), async () => {
    (await import("../debug/commands")).registerDebugLogCommands(context);
  });
  registerUniversalToolSearch(context);
  const version = String(context.extension.packageJSON.version);
  const previous = context.globalState.get<string>("devsnip.web.lastVersion");
  await initActivation(context, version, { isNewInstall: !previous && !context.globalState.keys().some(k => k.startsWith("devsnip.activation")), previousVersion: previous, recordDiscovery: id => recordDiscovery(context, id as Discovery) });
  await context.globalState.update("devsnip.web.lastVersion", version);
}
export function deactivate(): void { disposeAllToolPanels(); }
