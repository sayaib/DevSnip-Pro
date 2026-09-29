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
const api_test_1 = require("./commands/api-test");
const advancedTools_1 = require("./commands/advancedTools");
const dependencyManager_1 = require("./commands/dependencyManager");
const hubCommands_1 = require("./commands/hubCommands");
const runner_1 = require("./toolkits/runner");
const securityTools_1 = require("./commands/securityTools");
const milestoneTracker_1 = require("./commands/milestoneTracker");
const command_registry_1 = require("./utils/command-registry");
const analytics_1 = require("./analytics");
const readmeManager_1 = require("./commands/readmeManager");
const openCodeIntegration_1 = require("./commands/openCodeIntegration");
const command_dispatch_1 = require("./utils/command-dispatch");
const webview_ui_1 = require("./utils/webview-ui");
const feature_access_1 = require("./premium/feature-access");
const collections_1 = require("./services/collections");
const premium_commands_1 = require("./premium/premium-commands");
function activate(context) {
    const activationStart = Date.now();
    // Before anything writes state, so an existing user is never reported as a new install.
    const installSnapshot = (0, analytics_1.snapshotInstall)(context);
    const snippetsFolderPath = path.join(context.extensionPath, "custom");
    // The milestone store needs its context before any command can record usage.
    (0, milestoneTracker_1.setMilestoneContext)(context);
    // Tool usage points are awarded by registerTrackedCommand, which every
    // DevSnip Pro command is registered through. The recorder is installed before
    // any command is registered, so no invocation is missed and none is counted twice.
    (0, command_registry_1.setUsageRecorder)(command => { void (0, milestoneTracker_1.autoRecordToolUsage)(command); });
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
    const myTreeView = new MyTreeDataProvider(context);
    (0, milestoneTracker_1.setTreeRefreshCallback)(() => myTreeView.refresh());
    const treeView = vscode.window.createTreeView("myView", {
        treeDataProvider: myTreeView,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
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
        ["REST API client", () => (0, api_test_1.apiTest)(context, { access, collections })],
        ["premium commands", () => (0, premium_commands_1.registerPremiumCommands)(context, access)],
        ["developer utilities", () => (0, advancedTools_1.registerAdvancedToolsCommands)(context)],
        ["dependencies & installation", () => (0, dependencyManager_1.registerDependencyManagerCommand)(context)],
        ["tool hubs", () => (0, hubCommands_1.registerHubCommands)(context)],
        ["developer, AI, RAG, data and DevOps tools", () => (0, runner_1.registerToolkitCommands)(context)],
        ["security tools", () => (0, securityTools_1.registerSecurityToolsCommands)(context)],
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
/** Tools that are not part of the toolkit registry. Toolkit tools are added at search time. */
const STANDALONE_TOOLS = [
    { label: "REST API Client", description: "Core / HTTP / GraphQL / WebSocket", command: "sayaib.hue-console.openGUI" },
    { label: "Analyze and Remove Console Logs", description: "Core / Cleanup", command: "sayaib.hue-console.listAndRemoveConsoleLogs" },
    { label: "Remove Unused Imports", description: "Core / Cleanup", command: "sayaib.hue-console.removeUnusedImports" },
    { label: "README Viewer & Manager", description: "Core / Docs", command: "sayaib.hue-console.readmeManager" },
    { label: "OpenCode Integration", description: "Core / AI assistant", command: "sayaib.hue-console.openCodeIntegration" },
    { label: "Create Custom Code Snippet", description: "Snippets", command: "sayaib.hue-console.createCustomSnippet" },
    { label: "View Saved Code Snippets", description: "Snippets", command: "sayaib.hue-console.showSnippets" },
    { label: "Developer Tools", description: "Hub", command: "sayaib.hue-console.advancedToolsHub" },
    { label: "AI & ML Tools", description: "Hub", command: "sayaib.hue-console.aiMlHub" },
    { label: "RAG Tools", description: "Hub", command: "sayaib.hue-console.ragHub" },
    { label: "Data Tools", description: "Hub", command: "sayaib.hue-console.bigDataHub" },
    { label: "DevOps Tools", description: "Hub", command: "sayaib.hue-console.devopsGenerator" },
    { label: "Dependencies & Installation", description: "Developer Tools / npm / yarn / pnpm / pip / Maven / Gradle", command: "sayaib.hue-console.dependencyManager" },
    { label: "Regex Builder & Tester", description: "Developer Tools / Pattern", command: "sayaib.hue-console.regexBuilder" },
    { label: "JSON/XML Formatter", description: "Developer Tools / Format / Validate", command: "sayaib.hue-console.jsonFormatter" },
    { label: "Hash Generator", description: "Developer Tools / SHA", command: "sayaib.hue-console.hashGenerator" },
    { label: "Timestamp Converter", description: "Developer Tools / Epoch / Dates", command: "sayaib.hue-console.timestampConverter" },
    { label: "Color Palette", description: "Developer Tools / Design / Contrast", command: "sayaib.hue-console.colorPalette" },
    { label: "Security Hub", description: "Security / Endpoint / Workspace / Cloud / Dependencies", command: "sayaib.hue-console.securityHub" },
    { label: "Endpoint Security Scan", description: "Security / Headers / HSTS / CSP / CORS / TLS / Cookies", command: "sayaib.hue-console.endpointSecurityScan" },
    { label: "Security Audit", description: "Security / Secrets / Injection / Unsafe Code", command: "sayaib.hue-console.securityAudit" },
    { label: "Cloud Security Audit", description: "Security / Terraform / Kubernetes / Docker / IAM", command: "sayaib.hue-console.cloudSecurityAudit" },
    { label: "Dependency & Config Check", description: "Security / Lockfiles / Advisories / CI hardening", command: "sayaib.hue-console.dependencyAudit" },
    { label: "Milestone & Points Tracker", description: "Progress", command: "sayaib.hue-console.milestoneTracker" },
];
/** Every searchable tool: the standalone ones plus the toolkit (title, section, category and keywords). */
async function searchableTools() {
    const { ALL_TOOLS, SECTIONS } = await Promise.resolve().then(() => __importStar(require("./toolkits/registry")));
    const toolkit = ALL_TOOLS.map(tool => ({
        label: tool.title,
        description: `${SECTIONS.find(s => s.id === tool.section)?.title} / ${tool.category} / ${(tool.keywords ?? []).slice(0, 5).join(" / ")}`,
        command: `sayaib.hue-console.${tool.command}`
    }));
    return [...STANDALONE_TOOLS, ...toolkit];
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
class MyTreeDataProvider {
    constructor(context) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.context = context;
        this.groups = this.createGroups();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof ToolGroup) {
            return element.children;
        }
        const stats = (0, milestoneTracker_1.getUserStats)(this.context);
        // The level follows lifetime points so spending never demotes it; the number is the spendable balance.
        const level = (0, milestoneTracker_1.getCurrentLevel)(stats.lifetimePoints);
        const trackerItem = this.createCommandButton(`${level.badge} ${level.name} (${stats.totalPoints} pts)`, "sayaib.hue-console.milestoneTracker", "trophy", new vscode.ThemeColor("terminal.ansiBrightYellow"));
        trackerItem.tooltip = `${level.name} level - ${stats.lifetimePoints} points earned in total, ${stats.totalPoints} available to spend`;
        return [
            trackerItem,
            this.createCommandButton("Search tools", "sayaib.hue-console.searchTools", "search", new vscode.ThemeColor("terminal.ansiBrightCyan")),
            ...this.groups,
        ];
    }
    createGroups() {
        const c = (id) => `sayaib.hue-console.${id}`;
        return [
            new ToolGroup("Core", "rocket", "terminal.ansiBrightYellow", [
                this.createCommandButton("REST API Client", c("openGUI"), "cloud"),
                this.createCommandButton("Clean Console Logs", c("listAndRemoveConsoleLogs"), "trash"),
                this.createCommandButton("Remove Unused Imports", c("removeUnusedImports"), "symbol-method"),
                this.createCommandButton("README Viewer & Manager", c("readmeManager"), "book"),
                this.createCommandButton("OpenCode Integration", c("openCodeIntegration"), "terminal"),
            ]),
            new ToolGroup("Snippets", "book", "terminal.ansiBrightMagenta", [
                this.createCommandButton("Create Snippet", c("createCustomSnippet"), "edit"),
                this.createCommandButton("Saved Snippets", c("showSnippets"), "file-code"),
            ]),
            new ToolGroup("Developer Tools", "tools", "terminal.ansiBrightWhite", [
                this.createCommandButton("All developer tools", c("advancedToolsHub"), "layout"),
                this.createCommandButton("JSON/XML Formatter", c("jsonFormatter"), "json"),
                this.createCommandButton("Encode / Decode", c("base64Encoder"), "symbol-string"),
                this.createCommandButton("JWT Decoder", c("jwtDecoder"), "key"),
                this.createCommandButton("Diff Checker", c("textDiff"), "diff"),
                this.createCommandButton("Dependencies & Installation", c("dependencyManager"), "package"),
            ]),
            new ToolGroup("AI & ML", "hubot", "terminal.ansiBrightCyan", [
                this.createCommandButton("All AI & ML tools", c("aiMlHub"), "layout"),
                this.createCommandButton("Prompt Builder", c("promptTemplate"), "comment-discussion"),
                this.createCommandButton("Token & Cost Estimator", c("tokenCounter"), "symbol-numeric"),
                this.createCommandButton("LLM Client Setup", c("llmClientSetup"), "plug"),
                this.createCommandButton("LLM JSON Validator", c("llmJsonValidator"), "json"),
            ]),
            new ToolGroup("RAG", "search", "terminal.ansiBrightGreen", [
                this.createCommandButton("All RAG tools", c("ragHub"), "layout"),
                this.createCommandButton("Chunking Tester", c("chunkingTester"), "list-flat"),
                this.createCommandButton("RAG Pipeline Generator", c("ragPipeline"), "rocket"),
                this.createCommandButton("Retrieval Evaluation", c("ragEvalScores"), "checklist"),
            ]),
            new ToolGroup("Data", "database", "terminal.ansiBrightGreen", [
                this.createCommandButton("All data tools", c("bigDataHub"), "layout"),
                this.createCommandButton("Data Converter", c("dataConverter"), "arrow-swap"),
                this.createCommandButton("JSON to Types", c("jsonToTypes"), "symbol-class"),
                this.createCommandButton("SQL Formatter & Linter", c("sparkSqlFormatter"), "database"),
                this.createCommandButton("Mock Data Generator", c("mockDataGenerator"), "sparkle"),
            ]),
            new ToolGroup("DevOps", "server-environment", "terminal.ansiBrightBlue", [
                this.createCommandButton("All DevOps tools", c("devopsGenerator"), "layout"),
                this.createCommandButton("Dockerfile", c("dockerfileHelper"), "package"),
                this.createCommandButton("Docker Compose", c("composeHelper"), "layers"),
                this.createCommandButton("Kubernetes & Helm", c("kubernetesHelper"), "server"),
                this.createCommandButton("CI Pipeline", c("ciPipelineGenerator"), "github-action"),
                this.createCommandButton(".env Checker", c("envChecker"), "key"),
                this.createCommandButton("Log Analyzer", c("observabilityAnalyze"), "pulse"),
            ]),
            new ToolGroup("Security", "shield", "terminal.ansiBrightRed", [
                this.createCommandButton("Security Hub", c("securityHub"), "shield"),
                this.createCommandButton("Endpoint Security Scan", c("endpointSecurityScan"), "radio-tower"),
                this.createCommandButton("Workspace Audit", c("securityAudit"), "search"),
                this.createCommandButton("Cloud & Container Audit", c("cloudSecurityAudit"), "cloud"),
                this.createCommandButton("Dependency & Config Check", c("dependencyAudit"), "package"),
            ]),
        ];
    }
    createCommandButton(label, command, iconId, color, description) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.iconPath = color ? new vscode.ThemeIcon(iconId, color) : new vscode.ThemeIcon(iconId);
        item.description = description;
        return item;
    }
}
class ToolGroup extends vscode.TreeItem {
    constructor(groupName, iconId, colorId, children) {
        super(groupName, vscode.TreeItemCollapsibleState.Collapsed);
        this.groupName = groupName;
        this.children = children;
        this.contextValue = "devsnipToolGroup";
        this.iconPath = new vscode.ThemeIcon(iconId, new vscode.ThemeColor(colorId));
    }
}
async function deactivate() {
    // Panels opened through the shared registry are not in context.subscriptions.
    (0, webview_ui_1.disposeAllToolPanels)();
    // Ends the session and makes one bounded (2s) attempt to send queued events.
    await (0, analytics_1.shutdownAnalytics)();
}
exports.deactivate = deactivate;
//# sourceMappingURL=extention.js.map