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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const createSnippetCommand_1 = require("./commands/createSnippetCommand");
const showSnippetsCommand_1 = require("./commands/showSnippetsCommand");
const listAndRemoveConsoleLogsCommand_1 = require("./commands/listAndRemoveConsoleLogsCommand");
const removeUnusedImportsCommand_1 = require("./commands/removeUnusedImportsCommand");
const hubCommands_1 = require("./commands/hubCommands");
const runner_1 = require("./toolkits/runner");
const command_1 = require("./database/command");
const service_1 = require("./theme/service");
const milestoneTracker_1 = require("./commands/milestoneTracker");
const command_registry_1 = require("./utils/command-registry");
const analytics_1 = require("./analytics");
const activation_1 = require("./onboarding/activation");
const commands_1 = require("./onboarding/commands");
const readmeManager_1 = require("./commands/readmeManager");
const openCodeIntegration_1 = require("./commands/openCodeIntegration");
const command_dispatch_1 = require("./utils/command-dispatch");
const webview_ui_1 = require("./utils/webview-ui");
const feature_access_1 = require("./premium/feature-access");
const collections_1 = require("./services/collections");
const premium_commands_1 = require("./premium/premium-commands");
const tools_sidebar_1 = require("./sidebar/tools-sidebar");
const SECURITY_COMMANDS = ["securityHub", "endpointSecurityScan", "securityAudit", "cloudSecurityAudit", "dependencyAudit"].map(id => `sayaib.hue-console.${id}`);
function activate(context) {
    const activationStart = Date.now();
    // Before anything writes state, so an existing user is never reported as a new install.
    const installSnapshot = (0, analytics_1.snapshotInstall)(context);
    const snippetsFolderPath = path.join(context.extensionPath, "custom");
    // The milestone store needs its context before any command can record usage.
    (0, milestoneTracker_1.setMilestoneContext)(context);
    // Every theme but System Default unlocks with points; the picker asks the milestone store.
    (0, service_1.setThemeAccess)({
        lock: themeId => (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), themeId),
        unlock: async (themeId) => {
            const lock = (0, milestoneTracker_1.themeLockFor)((0, milestoneTracker_1.getUserStats)(context), themeId);
            return !lock || (await (0, milestoneTracker_1.buyReward)(context, lock.rewardId)) === "ok";
        },
        grant: themeId => (0, milestoneTracker_1.grantKeptTheme)(context, themeId)
    });
    // The appearance theme is read before any webview renders, so none flashes the wrong theme.
    (0, service_1.initThemes)(context);
    // Local first-use and onboarding state. The install snapshot decides whether this is a new user.
    const version = String(context.extension?.packageJSON?.version ?? "0.0.0");
    const install = (0, analytics_1.classifyInstall)(installSnapshot, version);
    void (0, activation_1.initActivation)(context, version, {
        isNewInstall: install.firstRun,
        previousVersion: install.previousVersion,
        recordDiscovery: id => (0, milestoneTracker_1.recordDiscovery)(context, id)
    }).catch(error => console.error("DevSnip Pro: onboarding state could not be loaded.", error));
    // Tool usage points are awarded by registerTrackedCommand, which every
    // DevSnip Pro command is registered through. The recorder is installed before
    // any command is registered, so no invocation is missed and none is counted twice.
    // The Tools sidebar is created below; its recently/most used lists come from here too.
    let toolsSidebar;
    (0, command_registry_1.setUsageRecorder)(command => {
        void (0, milestoneTracker_1.autoRecordToolUsage)(command);
        toolsSidebar?.recordUsage(command);
        (0, activation_1.noteCommand)(command);
    });
    (0, command_registry_1.setCommandObserver)(analytics_1.trackCommand);
    // Premium REST API Client features are unlocked by spending DevSnip Pro
    // points, so the access service is given a ledger over the milestone
    // tracker's balance. There is no licence and no subscription.
    const access = new feature_access_1.FeatureAccessService(context, {
        balance: () => (0, milestoneTracker_1.getPointsBalance)(context),
        spend: (amount, reason) => (0, milestoneTracker_1.redeemPoints)(context, amount, reason),
        refund: (amount, reason) => (0, milestoneTracker_1.refundPoints)(context, amount, reason)
    });
    const collections = new collections_1.CollectionStore(context, access);
    toolsSidebar = new tools_sidebar_1.ToolsSidebarProvider(context);
    (0, milestoneTracker_1.setTreeRefreshCallback)(() => toolsSidebar?.refresh());
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(tools_sidebar_1.TOOLS_VIEW_ID, toolsSidebar));
    // One failing group must not stop the rest of the extension from loading:
    // a thrown error here would leave every other command unregistered.
    const registrations = [
        ["snippets", () => {
                (0, createSnippetCommand_1.registerCreateSnippetCommand)(context);
                (0, showSnippetsCommand_1.registerShowSnippetsCommand)(context, snippetsFolderPath);
            }],
        ["workspace hygiene", () => {
                (0, listAndRemoveConsoleLogsCommand_1.registerListAndRemoveConsoleLogsCommand)(context);
                (0, removeUnusedImportsCommand_1.registerRemoveUnusedImportsCommand)(context);
                (0, readmeManager_1.registerReadmeManagerCommand)(context);
            }],
        ["OpenCode integration", () => (0, openCodeIntegration_1.registerOpenCodeIntegrationCommand)(context)],
        // The three largest features load on first use, keeping them out of activation.
        ["REST API client", () => (0, command_registry_1.registerLazyCommands)(context.subscriptions, ["sayaib.hue-console.openGUI"], async () => {
                (await Promise.resolve().then(() => __importStar(require("./commands/api-test")))).apiTest(context, { access, collections });
            })],
        ["premium commands", () => (0, premium_commands_1.registerPremiumCommands)(context, access)],
        ["dependencies & installation", () => (0, command_registry_1.registerLazyCommands)(context.subscriptions, ["sayaib.hue-console.dependencyManager"], async () => {
                (await Promise.resolve().then(() => __importStar(require("./commands/dependencyManager")))).registerDependencyManagerCommand(context);
            })],
        ["tool hubs", () => (0, hubCommands_1.registerHubCommands)(context)],
        ["toolkit tools", () => (0, runner_1.registerToolkitCommands)(context)],
        ["security tools", () => (0, command_registry_1.registerLazyCommands)(context.subscriptions, SECURITY_COMMANDS, async () => {
                (await Promise.resolve().then(() => __importStar(require("./commands/securityTools")))).registerSecurityToolsCommands(context);
            })],
        ["database client", () => (0, command_1.registerDatabaseClientCommand)(context)],
        ["appearance themes", () => (0, service_1.registerThemeCommand)(context)],
        ["onboarding", () => (0, commands_1.registerOnboardingCommands)(context)],
        ["milestone tracker", () => (0, milestoneTracker_1.registerMilestoneTrackerCommand)(context)],
        ["tool search", () => registerUniversalToolSearch(context)],
    ];
    for (const [name, register] of registrations) {
        try {
            register();
        }
        catch (error) {
            console.error(`DevSnip Pro: failed to register ${name}.`, error);
            vscode.window.showErrorMessage(`DevSnip Pro could not load its ${name} commands: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    // Last, so activation_ms covers the whole activation and nothing waits on it.
    (0, analytics_1.initAnalytics)(context, activationStart, installSnapshot);
}
exports.activate = activate;
/** Every tool in the navigation, in section order: section, sub-group and keywords make it findable. */
async function searchableTools() {
    const { NAV, COMMAND_PREFIX } = await Promise.resolve().then(() => __importStar(require("./toolkits/layout")));
    const { findTool } = await Promise.resolve().then(() => __importStar(require("./toolkits/registry")));
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
function registerUniversalToolSearch(context) {
    const searchCommand = (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.searchTools", async () => {
        const pattern = await vscode.window.showInputBox({
            title: "Search DevSnip Pro Tools",
            prompt: "Enter a regular expression to match tool names, categories, or commands",
            placeHolder: "e.g. json|schema|rag|calculator",
            value: "",
        });
        if (pattern === undefined)
            return;
        let matcher;
        try {
            matcher = new RegExp(pattern || ".*", "i");
        }
        catch (error) {
            (0, analytics_1.track)("tool_search_performed", { query_length: pattern.length, match_count: 0, invalid_pattern: true });
            vscode.window.showErrorMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const tools = await searchableTools();
        const matches = tools.filter(tool => matcher.test(`${tool.label} ${tool.description} ${tool.command}`));
        // The query itself is never sent - only its length and how many tools matched.
        (0, analytics_1.track)("tool_search_performed", { query_length: pattern.length, match_count: matches.length, invalid_pattern: false });
        if (!matches.length) {
            vscode.window.showInformationMessage("No DevSnip Pro tools matched that regular expression.");
            return;
        }
        const selected = await vscode.window.showQuickPick(matches.map(tool => ({ label: tool.label, description: tool.description, detail: tool.command, command: tool.command })), { title: `${matches.length} matching DevSnip Pro tool${matches.length === 1 ? "" : "s"}`, matchOnDescription: true, matchOnDetail: true });
        if (selected) {
            (0, analytics_1.track)("tool_search_selected", {
                feature: selected.command.replace("sayaib.hue-console.", ""),
                rank: matches.findIndex(tool => tool.command === selected.command) + 1
            });
            await (0, command_dispatch_1.executeQueuedCommand)(selected.command);
        }
    });
    context.subscriptions.push(searchCommand);
}
async function deactivate() {
    // Panels opened through the shared registry are not in context.subscriptions.
    (0, webview_ui_1.disposeAllToolPanels)();
    // Ends the session and makes one bounded (2s) attempt to send queued events.
    await (0, analytics_1.shutdownAnalytics)();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extention.js.map