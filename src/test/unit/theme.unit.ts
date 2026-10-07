import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { contrast, DESIGN_TOKENS, findTheme, swatches, SYSTEM_THEME_ID, THEMES, themeRules, themeVariables, validThemeId } from "../../theme/themes";
import { extendCsp, injectTheme, THEME_MESSAGE, themeMessage } from "../../theme/inject";
import { currentThemeId, initThemes, setTheme, setWebviewHtml, themeChoices } from "../../theme/service";
import { renderToolsSidebar } from "../../sidebar/tools-sidebar";
import { renderToolPage } from "../../toolkits/page";
import { renderToolHub } from "../../utils/tool-hub";
import { ALL_TOOLS_HUB } from "../../commands/hubs";
import { findTool } from "../../toolkits/registry";
import { describe } from "../../toolkits/types";
import { renderDatabasePage } from "../../database/page";
import { securityHubHtml } from "../../commands/securityTools";
import { getWebviewContent } from "../../commands/api-test";
import { TOOL_CSS, UTILITY_CSS } from "../../utils/webview-ui";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "test") walk(full, out); }
    else if (/\.(ts|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const STATUS = { sidebar: { badge: "🥉", level: "Bronze", points: 0, lifetimePoints: 0, nextLevel: "Silver", toNext: 150, progress: 0 } };

/** Every page DevSnip Pro renders, through the real render functions. */
function pages(): Array<[string, string]> {
  const tool = findTool("text.format")!;
  return [
    ["sidebar", renderToolsSidebar({ cspSource: "vscode-resource:", scriptUri: "s.js", codiconsUri: "c.css", status: STATUS.sidebar, expanded: [], theme: { current: "system", choices: themeChoices() } })],
    ["toolkit", renderToolPage({ cspSource: "vscode-resource:", scriptUri: "t.js", tool: describe(tool), section: { id: "text", title: "Text" }, examples: [], initial: {}, platform: "darwin" })],
    ["hub", renderToolHub(ALL_TOOLS_HUB, { cspSource: "vscode-resource:", scriptUri: "h.js", pinned: [] })],
    ["database", renderDatabasePage({ cspSource: "vscode-resource:", scriptUri: "d.js", codiconsUri: "c.css", platform: "darwin" })],
    ["security", securityHubHtml("abc123", { url: "https://example.com", timeoutMs: 1000, activeChecks: false })],
    ["rest", getWebviewContent([], true)]
  ];
}

suite("themes: palettes", () => {
  test("ships the promised themes, each with a unique id and complete #rrggbb palette", () => {
    assert.deepStrictEqual(THEMES.map(t => t.label), ["Dark", "Midnight", "Dracula", "Monokai", "Nord", "Cyberpunk", "Solarized", "Ember", "Synthwave", "Aurora", "Light", "High Contrast"]);
    assert.strictEqual(new Set(THEMES.map(t => t.id)).size, THEMES.length);
    assert.ok(!findTheme(SYSTEM_THEME_ID), "system is not a palette");
    for (const theme of THEMES) {
      const p = theme.palette;
      const colours = { ...p, ...Object.fromEntries(Object.entries(p.ansi).map(([k, v]) => [`ansi.${k}`, v])), ...Object.fromEntries(Object.entries(p.syntax).map(([k, v]) => [`syntax.${k}`, v])) } as Record<string, unknown>;
      for (const [key, value] of Object.entries(colours)) {
        if (["kind", "ansi", "syntax", "shadow"].includes(key)) continue;
        assert.match(String(value), /^#[0-9a-f]{6}$/, `${theme.id}.${key}`);
      }
      assert.strictEqual(swatches(theme).length, 4);
    }
  });

  test("every theme keeps text, controls and status colours readable (WCAG)", () => {
    const rules: Array<[keyof typeof THEMES[0]["palette"], keyof typeof THEMES[0]["palette"], number]> = [
      ["fg", "bg", 7], ["fg", "sidebar", 7], ["fg", "surface", 4.5], ["fg", "surface2", 4.5],
      ["muted", "bg", 4.5], ["muted", "sidebar", 4.5], ["muted", "surface", 4.5],
      ["accentFg", "accent", 4.5], ["accentFg", "accentHover", 4.5],
      ["link", "bg", 4.5], ["link", "surface", 4.5], ["selectionFg", "selection", 4.5], ["fg", "selection", 4.5],
      ["success", "bg", 4.5], ["warning", "bg", 4.5], ["danger", "bg", 4.5], ["info", "bg", 4.5],
      // Text drawn on a status fill uses the background colour (--ds-on-status).
      ["bg", "success", 4.5], ["bg", "danger", 4.5],
      ["focus", "bg", 3], ["disabled", "bg", 2.5]
    ];
    const failures: string[] = [];
    for (const theme of THEMES) {
      const p = theme.palette as unknown as Record<string, string> & { ansi: Record<string, string>; syntax: Record<string, string> };
      for (const [a, b, min] of rules) {
        const ratio = contrast(p[a as string], p[b as string]);
        if (ratio < min) failures.push(`${theme.id}: ${String(a)} on ${String(b)} is ${ratio.toFixed(2)}, needs ${min}`);
      }
      // Icons and category colours are non-text (3:1); code tokens are text (4.5:1).
      for (const [name, colour] of Object.entries(p.ansi)) if (contrast(colour, p.bg) < 3) failures.push(`${theme.id}: ansi.${name}`);
      for (const [name, colour] of Object.entries(p.syntax)) if (contrast(colour, p.bg) < 4.5) failures.push(`${theme.id}: syntax.${name}`);
    }
    assert.deepStrictEqual(failures, []);
  });

  test("themes every VS Code colour variable the webviews use", () => {
    const used = new Set<string>();
    for (const file of [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "media"))]) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/--vscode-([a-zA-Z0-9-]+)/g)) used.add(m[1]);
    }
    // Font settings stay the user's, and dynamic ids are built at runtime.
    const ignored = /^(font-|editor-font-|font$)|^(font-family|font-size|font-weight)$/;
    const themed = new Set(Object.keys(themeVariables(THEMES[0].palette)));
    const missing = [...used].filter(name => !ignored.test(name) && !themed.has(name) && !name.endsWith("-"));
    assert.deepStrictEqual(missing, [], "add these to themeVariables() so every theme restyles them");
  });

  test("shared stylesheets use tokens, not hard-coded status colours", () => {
    for (const css of [TOOL_CSS, UTILITY_CSS]) {
      assert.ok(!/#2e7d32|#c62828|#1565c0|--success: #|--error: #|--warning: #/.test(css));
      assert.ok(!/color: #fff\b/.test(css), "text on fills uses --ds-on-status or a theme colour");
    }
  });

  test("System Default only defines design tokens; named themes override VS Code's variables", () => {
    assert.deepStrictEqual(themeRules("system"), [DESIGN_TOKENS]);
    assert.deepStrictEqual(themeRules("nope"), [DESIGN_TOKENS]);
    const rules = themeRules("dracula").join("\n");
    assert.match(rules, /--vscode-editor-background: #282a36 !important;/);
    assert.match(rules, /--vscode-button-background: #bd93f9 !important;/);
    assert.match(rules, /--vscode-contrastBorder: initial !important;/, "HC outlines are reset outside High Contrast");
    assert.match(rules, /color-scheme: dark !important/);
    assert.match(themeRules("light").join("\n"), /color-scheme: light !important/);
    assert.match(themeRules("high-contrast").join("\n"), /--vscode-contrastBorder: #6fc3df !important;/);
    assert.match(themeRules("nord", "sidebar").join("\n"), /background-color: #2a2f3a !important/);
    assert.strictEqual(validThemeId("midnight"), "midnight");
    assert.strictEqual(validThemeId("deleted-theme"), "system");
    assert.strictEqual(validThemeId(42), "system");
  });
});

suite("themes: injection", () => {
  test("extends each kind of CSP with one nonce, keeping inline styles working", () => {
    assert.strictEqual(
      extendCsp("default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-a';", "N"),
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-a' 'nonce-N';",
      "a nonce would disable 'unsafe-inline', so style-src is left alone"
    );
    assert.strictEqual(
      extendCsp("default-src 'none'; font-src x; style-src x 'nonce-a'; script-src 'nonce-a';", "N"),
      "default-src 'none'; font-src x; style-src x 'nonce-a' 'nonce-N'; script-src 'nonce-a' 'nonce-N';"
    );
    assert.strictEqual(extendCsp("default-src 'none'; style-src 'unsafe-inline'; script-src vscode-resource:;", "N"), "default-src 'none'; style-src 'unsafe-inline'; script-src vscode-resource: 'nonce-N';");
  });

  test("every DevSnip Pro page gets the theme, its runtime and a CSP that allows them", () => {
    for (const [name, html] of pages()) {
      const out = injectTheme(html, "nord", name === "sidebar" ? "sidebar" : "panel");
      const nonce = /<style id="devsnip-theme" nonce="([A-Za-z0-9]+)">/.exec(out)?.[1];
      assert.ok(nonce, `${name}: theme style missing`);
      assert.strictEqual(out.split('id="devsnip-theme"').length, 2, `${name}: exactly one theme block`);
      const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(out)?.[1] ?? "";
      assert.ok(new RegExp(`script-src[^;]*'nonce-${nonce}'`).test(csp), `${name}: script nonce allowed`);
      const styleSrc = /style-src[^;]*/.exec(csp)?.[0] ?? "";
      assert.ok(/'unsafe-inline'/.test(styleSrc) || styleSrc.includes(`'nonce-${nonce}'`), `${name}: theme style allowed`);
      assert.ok(out.indexOf('id="devsnip-theme"') < out.search(/<\/head>/i), `${name}: injected inside <head>`);
      assert.match(out, /--vscode-editor-background: #2e3440 !important/);
      const runtime = new RegExp(`<script nonce="${nonce}">([\\s\\S]*?)</script>`).exec(out)?.[1] ?? "";
      assert.doesNotThrow(() => new vm.Script(runtime), `${name}: runtime parses`);
    }
  });

  test("works on pages without a head, and never treats $ in injected text as a pattern", () => {
    const out = injectTheme("<body>hi</body>", "light");
    assert.ok(out.startsWith('<style id="devsnip-theme"'), out.slice(0, 40));
    const bare = injectTheme("plain", "system");
    assert.ok(bare.endsWith("plain"));
    assert.ok(!injectTheme("<html><head></head><body></body></html>", "dark").includes("$&"));
  });

  test("theme messages carry the rules and the kind the runtime mirrors onto body classes", () => {
    const msg = themeMessage("high-contrast", "panel");
    assert.strictEqual(msg.type, THEME_MESSAGE);
    assert.strictEqual(msg.kind, "hc");
    assert.deepStrictEqual(themeMessage("system", "panel").kind, null);
    assert.strictEqual(themeMessage("bogus", "panel").id, "system");
  });
});

suite("themes: service", () => {
  test("persists the choice, applies it to new pages and pushes it to open ones", async () => {
    const context = createExtensionContext({ "devsnip.appearance.theme": "dracula" });
    initThemes(context);
    assert.strictEqual(currentThemeId(), "dracula", "the stored theme is restored on start");

    const sent: unknown[] = [];
    const live = { html: "", postMessage: async (m: unknown) => { sent.push(m); return true; } };
    const disposed = { html: "", postMessage: () => { throw new Error("Webview is disposed"); } };
    setWebviewHtml(live as never, "<html><head></head><body></body></html>");
    setWebviewHtml(disposed as never, "<html><head></head><body></body></html>");
    assert.match(live.html, /--vscode-editor-background: #282a36 !important/);

    await setTheme("light");
    assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "light");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual((sent[0] as { id: string }).id, "light");
    await assert.rejects(setTheme("nope"), /Unknown theme/);
    await setTheme("system");
    assert.strictEqual(sent.length, 2, "the disposed webview was dropped, the live one kept");

    initThemes(createExtensionContext({ "devsnip.appearance.theme": "removed-theme" }));
    assert.strictEqual(currentThemeId(), "system", "an unknown stored theme falls back to System Default");
  });

  test("the sidebar shows the picker with System Default first and a preview per theme", () => {
    const choices = themeChoices();
    assert.strictEqual(choices[0].id, "system");
    assert.strictEqual(choices.length, THEMES.length + 1);
    assert.ok(choices.slice(1).every(c => c.preview && c.swatches.length === 4));
    const html = renderToolsSidebar({ cspSource: "x", scriptUri: "s.js", codiconsUri: "c.css", status: STATUS.sidebar, expanded: [], theme: { current: "nord", choices } });
    assert.ok(html.indexOf('id="themeBtn"') < html.indexOf('id="rank"'), "the selector sits above the rank card and tools");
    assert.match(html, /"current":"nord"/);
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(ROOT, "media", "tools-sidebar.js"), "utf8")));
  });
});
