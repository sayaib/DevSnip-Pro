"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.runBrowserTools = exports.createToolContext = exports.navigationFor = exports.buildMilestoneView = exports.knownCommands = exports.deactivate = exports.activate = exports.outputCapabilities = void 0;
const vscode = __importStar(require("vscode"));
const registry_1 = require("../../toolkits/registry");
const commands_1 = require("../../toolkits/commands");
const layout_1 = require("../../toolkits/layout");
const tool_groups_1 = require("../../sidebar/tool-groups");
const hubs_1 = require("../../commands/hubs");
const capabilities_1 = require("../../platform/capabilities");
const runner_1 = require("../../toolkits/runner");
const activation_1 = require("../../onboarding/activation");
const activities_1 = require("../../services/activities");
const quests_1 = require("../../services/quests");
const toolSearch_1 = require("../../commands/toolSearch");
var workspace_1 = require("../../platform/workspace");
Object.defineProperty(exports, "outputCapabilities", { enumerable: true, get: function () { return workspace_1.outputCapabilities; } });
var extension_1 = require("../../web/extension");
Object.defineProperty(exports, "activate", { enumerable: true, get: function () { return extension_1.activate; } });
Object.defineProperty(exports, "deactivate", { enumerable: true, get: function () { return extension_1.deactivate; } });
var command_registry_1 = require("../../utils/command-registry");
Object.defineProperty(exports, "knownCommands", { enumerable: true, get: function () { return command_registry_1.knownCommands; } });
var milestoneTracker_1 = require("../../commands/milestoneTracker");
Object.defineProperty(exports, "buildMilestoneView", { enumerable: true, get: function () { return milestoneTracker_1.buildMilestoneView; } });
var layout_2 = require("../../toolkits/layout");
Object.defineProperty(exports, "navigationFor", { enumerable: true, get: function () { return layout_2.navigationFor; } });
var runner_2 = require("../../toolkits/runner");
Object.defineProperty(exports, "createToolContext", { enumerable: true, get: function () { return runner_2.createToolContext; } });
function check(value, message) { if (!value)
    throw new Error(message); }
async function runBrowserTools() {
    check((0, registry_1.validateRegistry)().length === 0, (0, registry_1.validateRegistry)().join("\n"));
    const context = { now: () => new Date("2026-10-29T10:00:00Z"), storage: { get: (_k, fallback) => fallback, set: async () => undefined } };
    let variants = 0;
    for (const tool of registry_1.ALL_TOOLS) {
        check((0, capabilities_1.isCommandSupported)(tool.command), `Unsupported tool: ${tool.id}`);
        check(!tool.network, `Unrestricted networking exposed: ${tool.id}`);
        const base = Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.id, f.default]));
        const cases = [{ label: "defaults", values: base, required: false }, ...(tool.examples ?? []).map(e => ({ label: e.label, values: { ...base, ...e.values }, required: true }))];
        for (const f of tool.fields)
            if (f.kind === "select")
                for (const option of f.options ?? [])
                    cases.push({ label: `${f.id}=${option.value}`, values: { ...base, ...(tool.examples?.[0]?.values ?? {}), [f.id]: option.value }, required: false });
        for (const sample of cases) {
            const outcome = await (0, runner_1.runTool)(tool, sample.values, context);
            check(outcome.outcome === "success" || (!sample.required && outcome.outcome === "input_error"), `${tool.id} [${sample.label}]: ${outcome.error}`);
            variants++;
        }
        check(commands_1.TOOLKIT_COMMANDS.some(c => c.tool === tool.id), `Missing command: ${tool.id}`);
    }
    const commands = (0, tool_groups_1.sidebarCommands)();
    for (const section of layout_1.NAV) {
        check(section.entries.length, `Empty section: ${section.id}`);
        for (const category of section.categories ?? [])
            check(section.entries.some(e => e.category === category), `Empty category: ${category}`);
        for (const entry of section.entries)
            check((0, capabilities_1.isCommandSupported)(entry.command), `Unsupported navigation: ${entry.command}`);
    }
    check(!layout_1.NAV.some(s => s.id === "spreadsheets"), "Unsupported spreadsheet category remains");
    check(tool_groups_1.SIDEBAR_GROUPS.flatMap(g => g.tools).length === hubs_1.ALL_TOOLS_HUB.tools.length, "Hub/sidebar differ");
    for (const tool of hubs_1.ALL_TOOLS_HUB.tools)
        check(commands.has(tool.command), `Hub-only command: ${tool.command}`);
    for (const step of (0, activation_1.guideSteps)())
        check((0, capabilities_1.isCommandSupported)(step.command), `Unsupported guide: ${step.command}`);
    for (const item of (0, activation_1.whatsNew)("99.0.0")?.items ?? [])
        check(!item.command || (0, capabilities_1.isCommandSupported)(item.command), "Unsupported release link");
    for (const item of await (0, toolSearch_1.searchableTools)())
        check((0, capabilities_1.isCommandSupported)(item.command), `Unsupported search result: ${item.command}`);
    for (const quest of (0, quests_1.createDailyQuests)("2026-10-29").items)
        check((0, quests_1.isQuestAvailable)(quest.id), "Impossible browser quest");
    check(!["api_week", "snippet_week", "security_week"].includes((0, activities_1.eventForWeek)("2026-10-26").id), "Impossible browser event");
    for (let day = 1; day <= 28; day++)
        check((0, capabilities_1.isCommandSupported)((0, activities_1.tipForDate)(`2026-10-${String(day).padStart(2, "0")}`).command), "Unsupported daily tip");
    return { tools: registry_1.ALL_TOOLS.length, variants };
}
exports.runBrowserTools = runBrowserTools;
/** Same assertions run inside the real VS Code browser worker via test-web. */
async function run() {
    const extension = vscode.extensions.getExtension("sayaib.hue-console");
    check(extension, "Extension was not installed");
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const entry of commands_1.TOOLKIT_COMMANDS.filter(e => (0, capabilities_1.isCommandSupported)(e.command)))
        check(commands.includes(`sayaib.hue-console.${entry.command}`), `Command not registered: ${entry.command}`);
    const result = await runBrowserTools();
    const host = (0, runner_1.createToolContext)({ globalState: { get: (_key, fallback) => fallback } });
    check(!host.network, "TCP capability leaked into browser");
    if (host.workspace) {
        // A virtual fixture proves reads preserve URI schemes, rather than using fsPath.
        const uri = vscode.workspace.workspaceFolders[0].uri;
        const target = vscode.Uri.joinPath(uri, "devsnip-web-test.txt");
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode("Browser ✓"));
        try {
            check(await host.workspace.readFile("devsnip-web-test.txt") === "Browser ✓", "Virtual workspace UTF-8 read failed");
        }
        finally {
            await vscode.workspace.fs.delete(target);
        }
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
        const changes = new vscode.EventEmitter();
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
            const { outputCapabilities } = await Promise.resolve().then(() => __importStar(require("../../platform/workspace")));
            const capabilities = outputCapabilities(readonlyEditor, remote.uri);
            check(!capabilities.writeWorkspace && !capabilities.insert && !capabilities.saveAs, "Read-only 1s capabilities were not detected");
            await vscode.commands.executeCommand("sayaib.hue-console.insertDebugLog");
            const edited = vscode.window.activeTextEditor?.document;
            check(edited?.isUntitled && edited.getText().includes("console.log"), "Read-only debug action did not use a scratch copy");
            check(remote.getText() === remoteText, "The read-only repository was modified");
            await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }
        finally {
            provider.dispose();
            changes.dispose();
        }
    }
    await vscode.commands.executeCommand("workbench.view.extension.myActivityBar");
    await vscode.commands.executeCommand("sayaib.hue-console.jsonFormatter");
    await vscode.commands.executeCommand("sayaib.hue-console.advancedToolsHub");
    console.log(`DevSnip browser host: ${result.tools} tools, ${result.variants} variants passed.`);
}
exports.run = run;
//# sourceMappingURL=smoke.js.map