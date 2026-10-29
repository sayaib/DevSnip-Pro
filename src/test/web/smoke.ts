import * as vscode from "vscode";
import { ALL_TOOLS, validateRegistry } from "../../toolkits/registry";
import { TOOLKIT_COMMANDS } from "../../toolkits/commands";
import { NAV } from "../../toolkits/layout";
import { SIDEBAR_GROUPS, sidebarCommands } from "../../sidebar/tool-groups";
import { ALL_TOOLS_HUB } from "../../commands/hubs";
import { isCommandSupported } from "../../platform/capabilities";
import { createToolContext, runTool } from "../../toolkits/runner";
import { ToolContext, Values } from "../../toolkits/types";
import { guideSteps, whatsNew } from "../../onboarding/activation";
import { tipForDate, eventForWeek } from "../../services/activities";
import { createDailyQuests, isQuestAvailable } from "../../services/quests";
import { searchableTools } from "../../commands/toolSearch";
export { outputCapabilities } from "../../platform/workspace";
export { activate, deactivate } from "../../web/extension";
export { knownCommands } from "../../utils/command-registry";
export { buildMilestoneView } from "../../commands/milestoneTracker";
export { navigationFor } from "../../toolkits/layout";
export { createToolContext } from "../../toolkits/runner";

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export async function runBrowserTools(): Promise<{ tools: number; variants: number }> {
  check(validateRegistry().length === 0, validateRegistry().join("\n"));
  const context: ToolContext = { now: () => new Date("2026-10-29T10:00:00Z"), storage: { get: (_k, fallback) => fallback, set: async () => undefined } };
  let variants = 0;
  for (const tool of ALL_TOOLS) {
    check(isCommandSupported(tool.command), `Unsupported tool: ${tool.id}`);
    check(!tool.network, `Unrestricted networking exposed: ${tool.id}`);
    const base = Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.id, f.default])) as Values;
    const cases = [{ label: "defaults", values: base, required: false }, ...(tool.examples ?? []).map(e => ({ label: e.label, values: { ...base, ...e.values }, required: true }))];
    for (const f of tool.fields) if (f.kind === "select") for (const option of f.options ?? []) cases.push({ label: `${f.id}=${option.value}`, values: { ...base, ...(tool.examples?.[0]?.values ?? {}), [f.id]: option.value }, required: false });
    for (const sample of cases) {
      const outcome = await runTool(tool, sample.values, context);
      check(outcome.outcome === "success" || (!sample.required && outcome.outcome === "input_error"), `${tool.id} [${sample.label}]: ${outcome.error}`);
      variants++;
    }
    check(TOOLKIT_COMMANDS.some(c => c.tool === tool.id), `Missing command: ${tool.id}`);
  }
  const commands = sidebarCommands();
  for (const section of NAV) {
    check(section.entries.length, `Empty section: ${section.id}`);
    for (const category of section.categories ?? []) check(section.entries.some(e => e.category === category), `Empty category: ${category}`);
    for (const entry of section.entries) check(isCommandSupported(entry.command), `Unsupported navigation: ${entry.command}`);
  }
  check(!NAV.some(s => s.id === "spreadsheets"), "Unsupported spreadsheet category remains");
  check(SIDEBAR_GROUPS.flatMap(g => g.tools).length === ALL_TOOLS_HUB.tools.length, "Hub/sidebar differ");
  for (const tool of ALL_TOOLS_HUB.tools) check(commands.has(tool.command), `Hub-only command: ${tool.command}`);
  for (const step of guideSteps()) check(isCommandSupported(step.command), `Unsupported guide: ${step.command}`);
  for (const item of whatsNew("99.0.0")?.items ?? []) check(!item.command || isCommandSupported(item.command), "Unsupported release link");
  for (const item of await searchableTools()) check(isCommandSupported(item.command), `Unsupported search result: ${item.command}`);
  for (const quest of createDailyQuests("2026-10-29").items) check(isQuestAvailable(quest.id), "Impossible browser quest");
  check(!["api_week", "snippet_week", "security_week"].includes(eventForWeek("2026-10-26").id), "Impossible browser event");
  for (let day = 1; day <= 28; day++) check(isCommandSupported(tipForDate(`2026-10-${String(day).padStart(2,"0")}`).command), "Unsupported daily tip");
  return { tools: ALL_TOOLS.length, variants };
}

/** Same assertions run inside the real VS Code browser worker via test-web. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("sayaib.hue-console");
  check(extension, "Extension was not installed");
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const entry of TOOLKIT_COMMANDS.filter(e => isCommandSupported(e.command))) check(commands.includes(`sayaib.hue-console.${entry.command}`), `Command not registered: ${entry.command}`);
  const result = await runBrowserTools();
  const host = createToolContext({ globalState: { get: (_key: string, fallback: unknown) => fallback } } as unknown as vscode.ExtensionContext);
  check(!host.network, "TCP capability leaked into browser");
  if (host.workspace) {
    // A virtual fixture proves reads preserve URI schemes, rather than using fsPath.
    const uri = vscode.workspace.workspaceFolders![0].uri;
    const target = vscode.Uri.joinPath(uri, "devsnip-web-test.txt");
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode("Browser ✓"));
    try { check(await host.workspace.readFile("devsnip-web-test.txt") === "Browser ✓", "Virtual workspace UTF-8 read failed"); }
    finally { await vscode.workspace.fs.delete(target); }
  }
  const document = await vscode.workspace.openTextDocument({ language: "javascript", content: "const count = 1;\ncount;\n" });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(1, 0, 1, 5);
  await vscode.commands.executeCommand("sayaib.hue-console.insertDebugLog");
  check(document.getText().includes("console.log"), "Browser debug-log insertion failed");
  await vscode.commands.executeCommand("undo");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  // 1s hosts register their repository providers as read-only. Verify against
  // provider capabilities, including scratch-copy editing of remote documents.
  const remoteText = "const amount = 2;\namount;\n";
  for (const scheme of ["github1s-test", "gitlab1s-test"]) {
    const changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    const provider = vscode.workspace.registerFileSystemProvider(scheme, {
      onDidChangeFile: changes.event,
      watch: () => new vscode.Disposable(() => undefined),
      stat: () => ({ type: vscode.FileType.File, size: remoteText.length, ctime: 0, mtime: 0 }),
      readFile: () => new TextEncoder().encode(remoteText),
      readDirectory: () => [],
      createDirectory: () => { throw vscode.FileSystemError.NoPermissions(); },
      writeFile: () => { throw vscode.FileSystemError.NoPermissions(); },
      delete: () => { throw vscode.FileSystemError.NoPermissions(); },
      rename: () => { throw vscode.FileSystemError.NoPermissions(); }
    }, { isReadonly: true });
    try {
      const remote = await vscode.workspace.openTextDocument(vscode.Uri.parse(`${scheme}://owner/repo/test.js`));
      const readonlyEditor = await vscode.window.showTextDocument(remote);
      readonlyEditor.selection = new vscode.Selection(1, 0, 1, 6);
      const { outputCapabilities } = await import("../../platform/workspace");
      const capabilities = outputCapabilities(readonlyEditor, remote.uri);
      check(!capabilities.writeWorkspace && !capabilities.insert && !capabilities.saveAs, "Read-only 1s capabilities were not detected");
      await vscode.commands.executeCommand("sayaib.hue-console.insertDebugLog");
      const edited = vscode.window.activeTextEditor?.document;
      check(edited?.isUntitled && edited.getText().includes("console.log"), "Read-only debug action did not use a scratch copy");
      check(remote.getText() === remoteText, "The read-only repository was modified");
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    } finally { provider.dispose(); changes.dispose(); }
  }
  await vscode.commands.executeCommand("workbench.view.extension.myActivityBar");
  await vscode.commands.executeCommand("sayaib.hue-console.jsonFormatter");
  await vscode.commands.executeCommand("sayaib.hue-console.advancedToolsHub");
  console.log(`DevSnip browser host: ${result.tools} tools, ${result.variants} variants passed.`);
}
