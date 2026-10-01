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
        status: { badge: "🥇", level: "Gold", points: 420, lifetimePoints: 1020, nextLevel: "Platinum", toNext: 780, progress: 0.35 },
        expanded: ["Core", "Not a category"]
    });
}
(0, run_unit_tests_1.suite)("tools sidebar", () => {
    (0, run_unit_tests_1.test)("keeps every category, in order, with its icon and colour", () => {
        assert.deepStrictEqual(tool_groups_1.SIDEBAR_GROUPS.map(g => g.name), ["Core", "Snippets", "Developer Tools", "AI & ML", "RAG", "Data", "DevOps", "Security"]);
        for (const group of tool_groups_1.SIDEBAR_GROUPS) {
            assert.ok(group.tools.length > 0, `${group.name} has no tools`);
            assert.ok(/^terminal\.ansiBright[A-Z][a-z]+$/.test(group.color), `${group.name} colour ${group.color}`);
        }
        assert.strictEqual((0, tools_sidebar_1.themeColorVar)("terminal.ansiBrightYellow"), "--vscode-terminal-ansiBrightYellow");
    });
    (0, run_unit_tests_1.test)("every entry runs a contributed command", () => {
        for (const command of (0, tool_groups_1.sidebarCommands)())
            assert.ok(contributed.has(command), `${command} is not in package.json`);
    });
    (0, run_unit_tests_1.test)("every icon exists in the bundled codicon font", () => {
        const icons = new Set(tool_groups_1.SIDEBAR_GROUPS.flatMap(g => [g.icon, ...g.tools.map(t => t.icon)]));
        for (const icon of [...icons, "chevron-right", "search", "close", "list-filter"]) {
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
        assert.deepStrictEqual(data.expanded, ["Core"], "unknown categories in saved state are dropped");
        assert.strictEqual(data.groups.length, tool_groups_1.SIDEBAR_GROUPS.length);
    });
    (0, run_unit_tests_1.test)("the search box, status area and tree are labelled", () => {
        const html = render();
        assert.ok(/<input id="search"[^>]*aria-label="Search tools"/.test(html));
        assert.ok(/role="tree"[^>]*aria-label="DevSnip Pro tools"/.test(html));
        assert.ok(/id="status"[^>]*title="Open the Milestone/.test(html));
    });
    (0, run_unit_tests_1.test)("media/tools-sidebar.js parses and acquires the VS Code API once", () => {
        const source = fs.readFileSync(path.join(ROOT, "media", "tools-sidebar.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: "tools-sidebar.js" }));
        assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
    });
});
//# sourceMappingURL=sidebar.unit.js.map