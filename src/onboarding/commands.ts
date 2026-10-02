import * as path from "path";
import * as vscode from "vscode";
import { track } from "../analytics";
import { COMMAND_PREFIX, registerTrackedCommand } from "../utils/command-registry";

export const WALKTHROUGH_ID = "sayaib.hue-console#devsnip.getStarted";

/** "Get Started" opens the guided walkthrough; "What's New" opens the release notes. Neither opens on its own. */
export function registerOnboardingCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerTrackedCommand(`${COMMAND_PREFIX}getStarted`, async () => {
      track("onboarding_action", { action: "walkthrough_opened" });
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH_ID, false);
    }),
    registerTrackedCommand(`${COMMAND_PREFIX}whatsNew`, async () => {
      const changelog = vscode.Uri.file(path.join(context.extensionPath, "CHANGELOG.md"));
      await vscode.commands.executeCommand("markdown.showPreview", changelog);
    })
  );
}
