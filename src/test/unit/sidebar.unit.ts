import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { SIDEBAR_GROUPS, sidebarCommands } from "../../sidebar/tool-groups";
import { ToolsSidebarProvider, cleanUsage, renderToolsSidebar, themeColorVar } from "../../sidebar/tools-sidebar";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributed = new Set<string>(manifest.contributes.commands.map((c: { command: string }) => c.command));
const codiconCss = fs.readFileSync(path.join(ROOT, "node_modules", "@vscode", "codicons", "dist", "codicon.css"), "utf8");

function render(): string {
  return renderToolsSidebar({
    cspSource: "vscode-webview://test",
    scriptUri: "vscode-webview://test/media/tools-sidebar.js",
    codiconsUri: "vscode-webview://test/codicon.css",
    status: { badge: "🥇", level: "Gold", points: 1427, lifetimePoints: 1427, nextLevel: "Platinum", toNext: 373, progress: 0.69 },
    expanded: ["Core", "Not a category"],
    favorites: ["sayaib.hue-console.openGUI", "sayaib.hue-console.notASidebarTool"],
    usage: { "sayaib.hue-console.jwtDecoder": { count: 3, last: 1000 }, "sayaib.hue-console.unknown": { count: 9, last: 1 } }
  });
}

suite("tools sidebar", () => {
  test("keeps every category, in order, with its icon and colour", () => {
    assert.deepStrictEqual(
      SIDEBAR_GROUPS.map(g => g.name),
      ["Core", "Snippets", "Developer Tools", "AI & ML", "RAG", "Data", "DevOps", "Security"]
    );
    for (const group of SIDEBAR_GROUPS) {
      assert.ok(group.tools.length > 0, `${group.name} has no tools`);
      assert.ok(/^terminal\.ansiBright[A-Z][a-z]+$/.test(group.color), `${group.name} colour ${group.color}`);
    }
    assert.strictEqual(themeColorVar("terminal.ansiBrightYellow"), "--vscode-terminal-ansiBrightYellow");
  });

  test("every entry runs a contributed command", () => {
    for (const command of sidebarCommands()) assert.ok(contributed.has(command), `${command} is not in package.json`);
  });

  test("every icon exists in the bundled codicon font", () => {
    const icons = new Set(SIDEBAR_GROUPS.flatMap(g => [g.icon, ...g.tools.map(t => t.icon)]));
    // Icons the page script and markup use for chrome, filters and favorites.
    const chrome = ["chevron-right", "search", "close", "filter", "info", "check", "list-tree", "star-empty", "star-full", "history", "graph"];
    for (const icon of [...icons, ...chrome]) {
      assert.ok(codiconCss.includes(`.codicon-${icon}:before`), `codicon "${icon}" is missing, so it would render blank`);
    }
  });

  test("the view is contributed as a webview with the same id", () => {
    const views = manifest.contributes.views.myActivityBar;
    assert.deepStrictEqual(views.find((v: { id: string }) => v.id === "myView"), { type: "webview", id: "myView", name: "Tools" });
  });

  test("the page loads scripts only by nonce and embeds data safely", () => {
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
    assert.strictEqual(data.groups.length, SIDEBAR_GROUPS.length);
    assert.deepStrictEqual(data.favorites, ["sayaib.hue-console.openGUI"], "favorites are limited to sidebar tools");
    assert.deepStrictEqual(Object.keys(data.usage), ["sayaib.hue-console.jwtDecoder"], "usage is limited to sidebar tools");
    assert.deepStrictEqual(data.levels.map((l: { name: string }) => l.name).slice(0, 4), ["Bronze", "Silver", "Gold", "Platinum"]);
  });

  test("the search box, status area and tree are labelled", () => {
    const html = render();
    assert.ok(/<input id="search"[^>]*aria-label="Search tools"/.test(html));
    assert.ok(/role="tree"[^>]*aria-label="DevSnip Pro tools"/.test(html));
    assert.ok(/id="status"[^>]*title="Open the Milestone/.test(html));
  });

  test("media/tools-sidebar.js parses and acquires the VS Code API once", () => {
    const source = fs.readFileSync(path.join(ROOT, "media", "tools-sidebar.js"), "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: "tools-sidebar.js" }));
    assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
  });

  test("every tool has a one-line description for its hover card", () => {
    for (const group of SIDEBAR_GROUPS) {
      for (const tool of group.tools) {
        assert.ok(tool.description.trim().length >= 20, `${tool.label} needs a description`);
        assert.ok(tool.description.length <= 110, `${tool.label}: keep the description to one line`);
      }
    }
  });

  test("the search box advertises its shortcut and the filter is a menu", () => {
    const html = render();
    assert.ok(/aria-keyshortcuts="Control\+K Meta\+K \/"/.test(html));
    assert.ok(/id="filterBtn"[^>]*aria-haspopup="menu"/.test(html));
    assert.ok(/id="meter"[^>]*role="progressbar"/.test(html), "the rank bar must be exposed as a progress bar");
  });
});

suite("tools sidebar usage", () => {
  test("cleanUsage keeps only well-formed entries for sidebar tools", () => {
    assert.deepStrictEqual(cleanUsage(null), {});
    assert.deepStrictEqual(cleanUsage({
      "sayaib.hue-console.openGUI": { count: 2.7, last: 5 },
      "sayaib.hue-console.jwtDecoder": { count: 0, last: 5 },
      "sayaib.hue-console.textDiff": { count: "3", last: 5 },
      "sayaib.hue-console.unknown": { count: 1, last: 1 }
    }), { "sayaib.hue-console.openGUI": { count: 2, last: 5 } });
  });

  test("recordUsage counts sidebar tools from any entry point and ignores everything else", () => {
    const context = createExtensionContext();
    const provider = new ToolsSidebarProvider(context);
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
