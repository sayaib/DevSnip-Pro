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
exports.registerUniversalToolSearch = exports.searchableTools = void 0;
const vscode = __importStar(require("vscode"));
const command_registry_1 = require("../utils/command-registry");
const command_dispatch_1 = require("../utils/command-dispatch");
const capabilities_1 = require("../platform/capabilities");
/** Every tool in the navigation, in section order: section, sub-group and keywords make it findable. */
async function searchableTools() {
    const { NAV, COMMAND_PREFIX } = await Promise.resolve().then(() => __importStar(require("../toolkits/layout")));
    const { findTool } = await Promise.resolve().then(() => __importStar(require("../toolkits/registry")));
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
    ].filter(tool => (0, capabilities_1.isCommandSupported)(tool.command));
}
exports.searchableTools = searchableTools;
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
            vscode.window.showErrorMessage(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        const tools = await searchableTools();
        const matches = tools.filter(tool => matcher.test(`${tool.label} ${tool.description} ${tool.command}`));
        if (!matches.length) {
            vscode.window.showInformationMessage("No DevSnip Pro tools matched that regular expression.");
            return;
        }
        const selected = await vscode.window.showQuickPick(matches.map(tool => ({ label: tool.label, description: tool.description, detail: tool.command, command: tool.command })), { title: `${matches.length} matching DevSnip Pro tool${matches.length === 1 ? "" : "s"}`, matchOnDescription: true, matchOnDetail: true });
        if (selected)
            await (0, command_dispatch_1.executeQueuedCommand)(selected.command);
    });
    context.subscriptions.push(searchCommand);
}
exports.registerUniversalToolSearch = registerUniversalToolSearch;
//# sourceMappingURL=toolSearch.js.map