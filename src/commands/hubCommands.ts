import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { openToolHub } from "../utils/tool-hub";

/**
 * The tool hubs. Hub definitions are built from the toolkit registry, which is
 * loaded on first open so activation stays light.
 */
export function registerHubCommands(context: vscode.ExtensionContext): void {
  const hubs: Array<[string, "DEVELOPER_TOOLS_HUB" | "AI_ML_HUB" | "RAG_HUB" | "DATA_HUB" | "DEVOPS_HUB"]> = [
    ["advancedToolsHub", "DEVELOPER_TOOLS_HUB"],
    ["aiMlHub", "AI_ML_HUB"],
    ["ragHub", "RAG_HUB"],
    ["bigDataHub", "DATA_HUB"],
    ["devopsGenerator", "DEVOPS_HUB"]
  ];
  for (const [command, key] of hubs) {
    context.subscriptions.push(registerTrackedCommand(`sayaib.hue-console.${command}`, async () => {
      const definitions = await import("./hubs");
      openToolHub(context, definitions[key]);
    }));
  }
}
