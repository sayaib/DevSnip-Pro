import * as vscode from "vscode";
import { registerTrackedCommand } from "../utils/command-registry";
import { executeQueuedCommand } from "../utils/command-dispatch";
import { isCommandSupported } from "../platform/capabilities";

type ToolSearchItem = {
  label: string;
  description: string;
  command: string;
};

/** Every tool in the navigation, in section order: section, sub-group and keywords make it findable. */
export async function searchableTools(): Promise<ToolSearchItem[]> {
  const { NAV, COMMAND_PREFIX } = await import("../toolkits/layout");
  const { findTool } = await import("../toolkits/registry");
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
  ].filter(tool => isCommandSupported(tool.command));
}

export function registerUniversalToolSearch(context: vscode.ExtensionContext): void {
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

