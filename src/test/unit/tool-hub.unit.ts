import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { HUB_ICONS, renderToolHub, validateHub } from "../../utils/tool-hub";
import { ALL_HUBS } from "../../commands/hubs";
import { TOOLKIT_COMMANDS } from "../../toolkits/commands";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const contributed = new Set<string>(manifest.contributes.commands.map((c: { command: string }) => c.command));

suite("tool hubs", () => {
  test("every hub definition is consistent (categories, icons, no duplicates)", () => {
    for (const hub of ALL_HUBS) assert.deepStrictEqual(validateHub(hub), [], hub.heading);
  });

  test("every card opens a contributed command", () => {
    for (const hub of ALL_HUBS) {
      for (const tool of hub.tools) assert.ok(contributed.has(tool.command), `${hub.heading}: ${tool.command} is not in package.json`);
    }
  });

  test("every toolkit tool is reachable from a hub", () => {
    // A tool missing from every hub is invisible to anyone browsing.
    const hubCommands = new Set(ALL_HUBS.flatMap(h => h.tools.map(t => t.command)));
    for (const entry of TOOLKIT_COMMANDS.filter(c => !c.values)) {
      assert.ok(hubCommands.has(`sayaib.hue-console.${entry.command}`), `${entry.command} is not reachable from a hub`);
    }
  });

  test("the RAG hub offers a guided path for newcomers", () => {
    const rag = ALL_HUBS.find(h => h.viewType === "ragHub")!;
    assert.ok((rag.journey ?? []).length >= 5);
  });

  test("rendered page loads its script from the webview only and embeds data safely", () => {
    const hub = { ...ALL_HUBS[0], heading: "Tools </script><b>" };
    const html = renderToolHub(hub, { cspSource: "vscode-webview://abc", scriptUri: "vscode-webview://abc/tool-hub.js", pinned: ["sayaib.hue-console.hashGenerator", "not-a-tool"] });
    assert.ok(html.includes("script-src vscode-webview://abc;"));
    assert.ok(!/<script>(?!\s*$)/.test(html), "no inline executable script");
    assert.ok(!html.includes("<b>"), "heading is escaped");
    const json = /<script type="application\/json" id="hub-data">([\s\S]*?)<\/script>/.exec(html)?.[1];
    assert.ok(json);
    const data = JSON.parse(json!);
    assert.deepStrictEqual(data.pinned, ["sayaib.hue-console.hashGenerator"], "unknown pinned commands are dropped");
    assert.strictEqual(data.tools.length, ALL_HUBS[0].tools.length);
  });

  test("icons are plain SVG shapes", () => {
    for (const [name, markup] of Object.entries(HUB_ICONS)) {
      assert.ok(/^(<(path|circle|rect|ellipse)\b[^<>]*\/>)+$/.test(markup), `icon ${name} contains something other than shapes`);
    }
  });

  test("media/tool-hub.js parses and acquires the VS Code API once", () => {
    const source = fs.readFileSync(path.join(ROOT, "media", "tool-hub.js"), "utf8");
    assert.doesNotThrow(() => new vm.Script(source, { filename: "tool-hub.js" }));
    assert.strictEqual((source.match(/acquireVsCodeApi\(\)/g) || []).length, 1);
  });
});
