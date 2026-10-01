import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { SIDEBAR_GROUPS, sidebarCommands } from "../../sidebar/tool-groups";
import { renderToolsSidebar, themeColorVar } from "../../sidebar/tools-sidebar";
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
    status: { badge: "🥇", level: "Gold", points: 420, lifetimePoints: 1020, nextLevel: "Platinum", toNext: 780, progress: 0.35 },
    expanded: ["Core", "Not a category"]
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
    for (const icon of [...icons, "chevron-right", "search", "close", "list-filter"]) {
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
});
