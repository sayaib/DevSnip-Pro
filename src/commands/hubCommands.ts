import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { openToolHub } from "../utils/tool-hub";
import { HUB_COMMANDS, NAV } from "../toolkits/layout";

/**
 * "Browse all tools" and the older per-section hub commands, which keep
 * working (keybindings, muscle memory) and open the hub on their section.
 * The hub definition is built from the registry on first open, so
 * activation stays light.
 */
export function registerHubCommands(context: vscode.ExtensionContext): void {
  for (const [command, section] of Object.entries(HUB_COMMANDS)) {
    context.subscriptions.push(registerTrackedCommand(`sayaib.hue-console.${command}`, async () => {
      const { ALL_TOOLS_HUB } = await import("./hubs");
      openToolHub(context, ALL_TOOLS_HUB, section === "all" ? undefined : NAV.find(s => s.id === section)?.title);
    }));
  }
}
