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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vm = __importStar(require("vm"));
const tool_groups_1 = require("../../sidebar/tool-groups");
const tools_sidebar_1 = require("../../sidebar/tools-sidebar");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributed = new Set(manifest.contributes.commands.map((c) => c.command));
const codiconCss = fs.readFileSync(path.join(ROOT, "node_modules", "@vscode", "codicons", "dist", "codicon.css"), "utf8");
function render() {
    return (0, tools_sidebar_1.renderToolsSidebar)({
        cspSource: "vscode-webview://test",
        scriptUri: "vscode-webview://test/media/tools-sidebar.js",
        codiconsUri: "vscode-webview://test/codicon.css",
        status: { badge: "🥇", level: "Gold", points: 1427, lifetimePoints: 1427, nextLevel: "Platinum", toNext: 373, progress: 0.69 },
        expanded: ["Backend & API", "Not a category"],
        favorites: ["sayaib.hue-console.openGUI", "sayaib.hue-console.notASidebarTool"],
        usage: { "sayaib.hue-console.jwtDecoder": { count: 3, last: 1000 }, "sayaib.hue-console.unknown": { count: 9, last: 1 } }
    });
}
(0, run_unit_tests_1.suite)("tools sidebar", () => {
    (0, run_unit_tests_1.test)("keeps every category, in order, with its icon and colour", () => {
        assert.deepStrictEqual(tool_groups_1.SIDEBAR_GROUPS.map(g => g.name), ["Backend & API", "Web & Frontend", "Mobile Development", "Code & Productivity", "Text & Formatters", "Encoders & Converters", "Database", "Testing & Debugging", "Git & Version Control", "DevOps & Cloud", "Security & Auth", "AI & ML", "Data & RAG"]);
        for (const group of tool_groups_1.SIDEBAR_GROUPS) {
            assert.ok(group.tools.length > 0, `${group.name} has no tools`);
            assert.ok(/^terminal\.ansiBright[A-Z][a-z]+$/.test(group.color), `${group.name} colour ${group.color}`);
        }
        assert.strictEqual((0, tools_sidebar_1.themeColorVar)("terminal.ansiBrightYellow"), "--vscode-terminal-ansiBrightYellow");
    });
    (0, run_unit_tests_1.test)("no tool appears in two groups", () => {
        const commands = tool_groups_1.SIDEBAR_GROUPS.flatMap(g => g.tools.map(t => t.command));
        assert.strictEqual(new Set(commands).size, commands.length);
    });
    (0, run_unit_tests_1.test)("every entry runs a contributed command", () => {
        for (const command of (0, tool_groups_1.sidebarCommands)())
            assert.ok(contributed.has(command), `${command} is not in package.json`);
    });
    (0, run_unit_tests_1.test)("every icon exists in the bundled codicon font", () => {
        const icons = new Set(tool_groups_1.SIDEBAR_GROUPS.flatMap(g => [g.icon, ...g.tools.map(t => t.icon)]));
        // Icons the page script and markup use for chrome, filters and favorites.
        const chrome = ["chevron-right", "search", "close", "filter", "info", "check", "list-tree", "star-empty", "star-full", "history", "graph"];
        for (const icon of [...icons, ...chrome]) {
            assert.ok(codiconCss.includes(`.codicon-${icon}:before`), `codicon "${icon}" is missing, so it would render blank`);
        }
    });
    (0, run_unit_tests_1.test)("the view is contributed as a webview with the same id", () => {
        const views = manifest.contributes.views.myActivityBar;
        assert.deepStrictEqual(views.find((v) => v.id === "myView"), { type: "webview", id: "myView", name: "Tools" });
    });
    (0, run_unit_tests_1.test)("the page loads scripts only by nonce and embeds data safely", () => {
        const html = render();
        const nonce = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(html)?.[1];
        assert.ok(nonce, "the CSP must restrict scripts to a nonce");
        assert.ok(!/unsafe-inline|unsafe-eval/.test(html), "no unsafe CSP sources");
        for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
            assert.ok(tag.includes('type="application/json"') || tag.includes(`nonce="${nonce}"`), `script without nonce: ${tag}`);
        }
        const json = /<script type="application\/json" id="sidebar-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
        const data = JSON.parse(json);
        assert.deepStrictEqual(data.expanded, ["Backend & API"], "unknown categories in saved state are dropped");
        assert.strictEqual(data.groups.length, tool_groups_1.SIDEBAR_GROUPS.length);
        assert.deepStrictEqual(data.favorites, ["sayaib.hue-console.openGUI"], "favorites are limited to sidebar tools");
        assert.deepStrictEqual(Object.keys(data.usage), ["sayaib.hue-console.jwtDecoder"], "usage is limited to sidebar tools");
        assert.deepStrictEqual(data.levels.map((l) => l.name).slice(0, 4), ["Bronze", "Silver", "Gold", "Platinum"]);
    });
    (0, run_unit_tests_1.test)("the search box, status area and tree are labelled", () => {
        const html = render();
        assert.ok(/<input id="search"[^>]*aria-label="Search tools"/.test(html));
        assert.ok(/role="tree"[^>]*aria-label="DevSnip Pro tools"/.test(html));
        assert.ok(/id="status"[^>]*aria-label="[^"]*Open Milestones/.test(html), "the rank card says where it goes");
        // The card's action is also spelled out on screen, not only in a tooltip.
        assert.ok(/id="rankCta"[^>]*>[\s\S]*?Milestones/.test(html));
        assert.ok(/id="rankInfo"[^>]*>[\s\S]*?How ranks work/.test(html));
    });
    (0, run_unit_tests_1.test)("media/tools-sidebar.js parses and acquires the VS Code API once", () => {
        const source = fs.readFileSync(path.join(ROOT, "media", "tools-sidebar.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: "tools-sidebar.js" }));
        assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
    });
    (0, run_unit_tests_1.test)("every tool has a one-line description for its hover card", () => {
        for (const group of tool_groups_1.SIDEBAR_GROUPS) {
            for (const tool of group.tools) {
                assert.ok(tool.description.trim().length >= 20, `${tool.label} needs a description`);
                assert.ok(tool.description.length <= 110, `${tool.label}: keep the description to one line`);
            }
        }
    });
    (0, run_unit_tests_1.test)("the search box advertises its shortcut and the filter is a menu", () => {
        const html = render();
        assert.ok(/aria-keyshortcuts="Control\+K Meta\+K \/"/.test(html));
        assert.ok(/id="filterBtn"[^>]*aria-haspopup="menu"/.test(html));
        assert.ok(/id="meter"[^>]*role="progressbar"/.test(html), "the rank bar must be exposed as a progress bar");
    });
});
(0, run_unit_tests_1.suite)("tools sidebar usage", () => {
    (0, run_unit_tests_1.test)("cleanUsage keeps only well-formed entries for sidebar tools", () => {
        assert.deepStrictEqual((0, tools_sidebar_1.cleanUsage)(null), {});
        assert.deepStrictEqual((0, tools_sidebar_1.cleanUsage)({
            "sayaib.hue-console.openGUI": { count: 2.7, last: 5 },
            "sayaib.hue-console.jwtDecoder": { count: 0, last: 5 },
            "sayaib.hue-console.textDiff": { count: "3", last: 5 },
            "sayaib.hue-console.unknown": { count: 1, last: 1 }
        }), { "sayaib.hue-console.openGUI": { count: 2, last: 5 } });
    });
    (0, run_unit_tests_1.test)("recordUsage counts sidebar tools from any entry point and ignores everything else", () => {
        const context = (0, vscode_stub_1.createExtensionContext)();
        const provider = new tools_sidebar_1.ToolsSidebarProvider(context);
        provider.recordUsage("sayaib.hue-console.jwtDecoder");
        provider.recordUsage("sayaib.hue-console.jwtDecoder");
        provider.recordUsage("sayaib.hue-console.milestoneTracker");
        provider.recordUsage("sayaib.hue-console.searchTools");
        provider.recordUsage("workbench.action.files.save");
        const usage = context.globalState.get("devsnip.sidebar.usage");
        assert.deepStrictEqual(Object.keys(usage), ["sayaib.hue-console.jwtDecoder"]);
        assert.strictEqual(usage["sayaib.hue-console.jwtDecoder"].count, 2);
        assert.ok(usage["sayaib.hue-console.jwtDecoder"].last > 0);
    });
});
//# sourceMappingURL=sidebar.unit.js.map