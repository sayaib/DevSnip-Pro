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
const tool_hub_1 = require("../../utils/tool-hub");
const hubs_1 = require("../../commands/hubs");
const commands_1 = require("../../toolkits/commands");
const layout_1 = require("../../toolkits/layout");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributed = new Set(manifest.contributes.commands.map((c) => c.command));
(0, run_unit_tests_1.suite)("tool hubs", () => {
    (0, run_unit_tests_1.test)("every hub definition is consistent (categories, icons, no duplicates)", () => {
        for (const hub of hubs_1.ALL_HUBS)
            assert.deepStrictEqual((0, tool_hub_1.validateHub)(hub), [], hub.heading);
    });
    (0, run_unit_tests_1.test)("every card opens a contributed command", () => {
        for (const hub of hubs_1.ALL_HUBS) {
            for (const tool of hub.tools)
                assert.ok(contributed.has(tool.command), `${hub.heading}: ${tool.command} is not in package.json`);
        }
    });
    (0, run_unit_tests_1.test)("every toolkit tool is reachable from a hub", () => {
        // A tool missing from every hub is invisible to anyone browsing.
        const hubCommands = new Set(hubs_1.ALL_HUBS.flatMap(h => h.tools.map(t => t.command)));
        for (const entry of commands_1.TOOLKIT_COMMANDS.filter(c => !c.values)) {
            assert.ok(hubCommands.has(`sayaib.hue-console.${entry.command}`), `${entry.command} is not reachable from a hub`);
        }
    });
    (0, run_unit_tests_1.test)("the Data & RAG section keeps its guided path for newcomers", () => {
        const journeys = hubs_1.ALL_HUBS[0].journeys ?? {};
        assert.ok((journeys["Data & RAG"] ?? []).length >= 5);
    });
    (0, run_unit_tests_1.test)("the hub lists every navigation entry exactly once, in layout order", () => {
        const commands = hubs_1.ALL_HUBS[0].tools.map(t => t.command);
        assert.strictEqual(new Set(commands).size, commands.length);
        assert.deepStrictEqual(commands, layout_1.NAV.flatMap(s => s.entries.map(e => `sayaib.hue-console.${e.command}`)));
        assert.deepStrictEqual(hubs_1.ALL_HUBS[0].categories, layout_1.NAV.map(s => s.title));
    });
    (0, run_unit_tests_1.test)("older hub commands open the hub on an existing section", () => {
        for (const [command, section] of Object.entries(layout_1.HUB_COMMANDS)) {
            assert.ok(contributed.has(`sayaib.hue-console.${command}`), command);
            assert.ok(section === "all" || layout_1.NAV.some(s => s.id === section), command);
        }
        const html = (0, tool_hub_1.renderToolHub)(hubs_1.ALL_HUBS[0], { cspSource: "x", scriptUri: "x", pinned: [], initialCategory: "AI & ML" });
        assert.strictEqual(JSON.parse(/id="hub-data">([\s\S]*?)<\/script>/.exec(html)[1]).initialCategory, "AI & ML");
    });
    (0, run_unit_tests_1.test)("rendered page loads its script from the webview only and embeds data safely", () => {
        const hub = { ...hubs_1.ALL_HUBS[0], heading: "Tools </script><b>" };
        const html = (0, tool_hub_1.renderToolHub)(hub, { cspSource: "vscode-webview://abc", scriptUri: "vscode-webview://abc/tool-hub.js", pinned: ["sayaib.hue-console.hashGenerator", "not-a-tool"] });
        assert.ok(html.includes("script-src vscode-webview://abc;"));
        assert.ok(!/<script>(?!\s*$)/.test(html), "no inline executable script");
        assert.ok(!html.includes("<b>"), "heading is escaped");
        const json = /<script type="application\/json" id="hub-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
        assert.ok(json);
        const data = JSON.parse(json);
        assert.deepStrictEqual(data.pinned, ["sayaib.hue-console.hashGenerator"], "unknown pinned commands are dropped");
        assert.strictEqual(data.tools.length, hubs_1.ALL_HUBS[0].tools.length);
    });
    (0, run_unit_tests_1.test)("icons are plain SVG shapes", () => {
        for (const [name, markup] of Object.entries(tool_hub_1.HUB_ICONS)) {
            assert.ok(/^(<(path|circle|rect|ellipse)\b[^<>]*\/>)+$/.test(markup), `icon ${name} contains something other than shapes`);
        }
    });
    (0, run_unit_tests_1.test)("media/tool-hub.js parses and acquires the VS Code API once", () => {
        const source = fs.readFileSync(path.join(ROOT, "media", "tool-hub.js"), "utf8");
        assert.doesNotThrow(() => new vm.Script(source, { filename: "tool-hub.js" }));
        assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
    });
});
//# sourceMappingURL=tool-hub.unit.js.map