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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
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
const aiMlTools_1 = require("./commands/aiMlTools");
const bigDataTools_1 = require("./commands/bigDataTools");
const ragTools_1 = require("./commands/ragTools");
const aiMlExtraTools_1 = require("./commands/aiMlExtraTools");
const platformTools_1 = require("./commands/platformTools");
const command_dispatch_1 = require("./utils/command-dispatch");
function activate(context) {
    const snippetsFolderPath = path.join(context.extensionPath, "custom");
    console.log("DevSnip Pro extension is now active!");
    const myTreeView = new MyTreeDataProvider();
    const treeView = vscode.window.createTreeView("myView", {
        treeDataProvider: myTreeView,
        showCollapseAll: false,
    });
    context.subscriptions.push(treeView);
    // Register existing commands
    (0, createSnippetCommand_1.registerCreateSnippetCommand)(context);
    (0, showSnippetsCommand_1.registerShowSnippetsCommand)(context, snippetsFolderPath);
    (0, listAndRemoveConsoleLogsCommand_1.registerListAndRemoveConsoleLogsCommand)(context);
    (0, removeUnusedImportsCommand_1.registerRemoveUnusedImportsCommand)(context); // Add this line
    (0, api_test_1.apiTest)(context);
    // Register advanced tools commands
    (0, advancedTools_1.registerAdvancedToolsCommands)(context);
    // Register AI/ML & LLM tools commands
    (0, aiMlTools_1.registerAiMlToolsCommands)(context);
    (0, aiMlExtraTools_1.registerAiMlExtraTools)(context);
    // Register Big Data tools commands
    (0, bigDataTools_1.registerBigDataToolsCommands)(context);
    // Register RAG tools commands
    (0, ragTools_1.registerRagToolsCommands)(context);
    (0, platformTools_1.registerPlatformToolsCommands)(context);
    registerUniversalToolSearch(context);
}
exports.activate = activate;
const UNIVERSAL_TOOLS = [
    { label: "Open REST API Client", description: "Core Workflow", command: "sayaib.hue-console.openGUI" },
    { label: "Analyze and Remove Console Logs", description: "Core Workflow", command: "sayaib.hue-console.listAndRemoveConsoleLogs" },
    { label: "Remove Unused Imports", description: "Core Workflow", command: "sayaib.hue-console.removeUnusedImports" },
    { label: "Create Custom Code Snippet", description: "Snippets", command: "sayaib.hue-console.createCustomSnippet" },
    { label: "View Saved Code Snippets", description: "Snippets", command: "sayaib.hue-console.showSnippets" },
    { label: "Advanced Developer Tools", description: "Advanced Utilities", command: "sayaib.hue-console.advancedToolsHub" },
    { label: "Regex Builder & Tester", description: "Advanced / Pattern", command: "sayaib.hue-console.regexBuilder" },
    { label: "JSON/XML Formatter", description: "Advanced / Data", command: "sayaib.hue-console.jsonFormatter" },
    { label: "Hash Generator", description: "Advanced / Security", command: "sayaib.hue-console.hashGenerator" },
    { label: "Base64 Encoder/Decoder", description: "Advanced / Encoding", command: "sayaib.hue-console.base64Encoder" },
    { label: "URL Encoder/Decoder", description: "Advanced / Encoding", command: "sayaib.hue-console.urlEncoder" },
    { label: "Timestamp Converter", description: "Advanced / Dates", command: "sayaib.hue-console.timestampConverter" },
    { label: "JSON to TOON Converter", description: "Advanced / Data", command: "sayaib.hue-console.jsonToToon" },
    { label: "Color Palette", description: "Advanced / Design", command: "sayaib.hue-console.colorPalette" },
    { label: "Lorem Ipsum Generator", description: "Advanced / Content", command: "sayaib.hue-console.loremGenerator" },
    { label: "AI/ML & LLM Tools", description: "AI / Hub", command: "sayaib.hue-console.aiMlHub" },
    { label: "Token Counter & Cost Calculator", description: "AI / LLM", command: "sayaib.hue-console.tokenCounter" },
    { label: "Prompt Template Manager", description: "AI / Prompting", command: "sayaib.hue-console.promptTemplate" },
    { label: "Prompt Playground", description: "AI / Prompting", command: "sayaib.hue-console.promptPlayground" },
    { label: "Python ML Code Generator", description: "AI / Model Development", command: "sayaib.hue-console.mlCodeGen" },
    { label: "LLM API Tester", description: "AI / APIs", command: "sayaib.hue-console.llmApiTester" },
    { label: "Dataset Split Calculator", description: "AI / Data", command: "sayaib.hue-console.datasetSplit" },
    { label: "Dataset Profiler", description: "AI / Data", command: "sayaib.hue-console.datasetProfiler" },
    { label: "JSONL Viewer", description: "AI / Data", command: "sayaib.hue-console.jsonlViewer" },
    { label: "Model Metrics Calculator", description: "AI / Evaluation", command: "sayaib.hue-console.metricsCalculator" },
    { label: "GPU VRAM Calculator", description: "AI / Infrastructure", command: "sayaib.hue-console.gpuVram" },
    { label: "Experiment Logger", description: "AI / MLOps", command: "sayaib.hue-console.experimentLogger" },
    { label: "Model Card Generator", description: "AI / Documentation", command: "sayaib.hue-console.modelCard" },
    { label: "Markdown Table Generator", description: "AI / Documentation", command: "sayaib.hue-console.mdTableGen" },
    { label: "Big Data Tools", description: "Data Engineering / Hub", command: "sayaib.hue-console.bigDataHub" },
    { label: "Schema Viewer", description: "Data Engineering / Schema", command: "sayaib.hue-console.schemaViewer" },
    { label: "Spark SQL Formatter", description: "Data Engineering / Querying", command: "sayaib.hue-console.sparkSqlFormatter" },
    { label: "Data Quality Checker", description: "Data Engineering / Quality", command: "sayaib.hue-console.dataQualityChecker" },
    { label: "Schema Diff Tool", description: "Data Engineering / Schema", command: "sayaib.hue-console.schemaDiff" },
    { label: "Partition Calculator", description: "Data Engineering / Performance", command: "sayaib.hue-console.partitionCalc" },
    { label: "RAG Tools", description: "RAG / Hub", command: "sayaib.hue-console.ragHub" },
    { label: "Chunking Strategy Tester", description: "RAG / Ingestion", command: "sayaib.hue-console.chunkingTester" },
    { label: "Embedding Cost Calculator", description: "RAG / Infrastructure", command: "sayaib.hue-console.embeddingCost" },
    { label: "Context Window Calculator", description: "RAG / Retrieval", command: "sayaib.hue-console.contextWindow" },
    { label: "Semantic Dedup Checker", description: "RAG / Quality", command: "sayaib.hue-console.semanticDedup" },
    { label: "RAG Eval Calculator", description: "RAG / Evaluation", command: "sayaib.hue-console.ragEvalScores" },
    { label: "Security Audit", description: "Security / Secrets / Unsafe Code", command: "sayaib.hue-console.securityAudit" },
    { label: "Cloud Security Audit", description: "Security / Terraform / Kubernetes / IAM", command: "sayaib.hue-console.cloudSecurityAudit" },
    { label: "DevOps Artifact Generator", description: "DevOps / Docker / CI", command: "sayaib.hue-console.devopsGenerator" },
    { label: "AI/ML DevOps Generator", description: "MLOps / GPU / Model Serving / ML CI", command: "sayaib.hue-console.mlopsGenerator" },
    { label: "Observability Log Analyzer", description: "Observability / Logs / Reliability", command: "sayaib.hue-console.observabilityAnalyze" },
    { label: "Observability Starter Generator", description: "Observability / OpenTelemetry / Structured Logs", command: "sayaib.hue-console.observabilityStarter" },
];
function registerUniversalToolSearch(context) {
    const searchCommand = vscode.commands.registerCommand("sayaib.hue-console.searchTools", () => __awaiter(this, void 0, void 0, function* () {
        const pattern = yield vscode.window.showInputBox({
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
            vscode.window.showErrorMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const matches = UNIVERSAL_TOOLS.filter(tool => matcher.test(`${tool.label} ${tool.description} ${tool.command}`));
        if (!matches.length) {
            vscode.window.showInformationMessage("No DevSnip Pro tools matched that regular expression.");
            return;
        }
        const selected = yield vscode.window.showQuickPick(matches.map(tool => ({ label: tool.label, description: tool.description, detail: tool.command, command: tool.command })), { title: `${matches.length} matching DevSnip Pro tool${matches.length === 1 ? "" : "s"}`, matchOnDescription: true, matchOnDetail: true });
        if (selected)
            yield (0, command_dispatch_1.executeQueuedCommand)(selected.command);
    }));
    context.subscriptions.push(searchCommand);
}
class MyTreeDataProvider {
    constructor() {
        this.groups = this.createGroups();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element instanceof ToolGroup) {
            return element.children;
        }
        return [
            this.createCommandButton("Search tools", "sayaib.hue-console.searchTools", "search", new vscode.ThemeColor("terminal.ansiBrightCyan")),
            ...this.groups,
        ];
    }
    createGroups() {
        return [
            new ToolGroup("Core", "rocket", "terminal.ansiBrightYellow", [
                this.createCommandButton("REST API Client", "sayaib.hue-console.openGUI", "cloud"),
                this.createCommandButton("Clean Console Logs", "sayaib.hue-console.listAndRemoveConsoleLogs", "trash"),
                this.createCommandButton("Remove Unused Imports", "sayaib.hue-console.removeUnusedImports", "symbol-method"),
            ]),
            new ToolGroup("Snippets", "book", "terminal.ansiBrightMagenta", [
                this.createCommandButton("Create Snippet", "sayaib.hue-console.createCustomSnippet", "edit"),
                this.createCommandButton("Saved Snippets", "sayaib.hue-console.showSnippets", "file-code"),
            ]),
            new ToolGroup("AI & ML", "hubot", "terminal.ansiBrightCyan", [
                this.createCommandButton("AI & ML Tools", "sayaib.hue-console.aiMlHub", "robot"),
            ]),
            new ToolGroup("Data & RAG", "database", "terminal.ansiBrightGreen", [
                this.createCommandButton("Big Data", "sayaib.hue-console.bigDataHub", "database"),
                this.createCommandButton("RAG", "sayaib.hue-console.ragHub", "search"),
            ]),
            new ToolGroup("Security", "shield", "terminal.ansiBrightRed", [
                this.createCommandButton("Local Security Audit", "sayaib.hue-console.securityAudit", "shield"),
                this.createCommandButton("Cloud Config Audit", "sayaib.hue-console.cloudSecurityAudit", "cloud"),
            ]),
            new ToolGroup("DevOps & Observability", "pulse", "terminal.ansiBrightCyan", [
                this.createCommandButton("DevOps Generator", "sayaib.hue-console.devopsGenerator", "cloud-upload"),
                this.createCommandButton("MLOps Generator", "sayaib.hue-console.mlopsGenerator", "server-process"),
                this.createCommandButton("Log Analyzer", "sayaib.hue-console.observabilityAnalyze", "pulse"),
                this.createCommandButton("Telemetry Starter", "sayaib.hue-console.observabilityStarter", "broadcast"),
            ]),
            new ToolGroup("Utilities", "tools", "terminal.ansiBrightWhite", [
                this.createCommandButton("Developer Utilities", "sayaib.hue-console.advancedToolsHub", "tools"),
            ]),
        ];
    }
    createCommandButton(label, command, iconId, color, description) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        // Keep child icons neutral; color is reserved for category headers so the
        // tree remains scannable when several sections are expanded.
        item.iconPath = new vscode.ThemeIcon(iconId);
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
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extention.js.map