import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ECOSYSTEM_COMMAND, openProductPage } from "../../ecosystem/command";
import { platformMark, platformMarks } from "../../ecosystem/marks";
import { cardOrder, renderEcosystemPage } from "../../ecosystem/page";
import { ECOSYSTEM_LOGO, openEcosystem } from "../../ecosystem/panel";
import { ECOSYSTEM_PRODUCTS, findProduct, productForSection, resolveFocus } from "../../ecosystem/products";
import { isCommandSupported } from "../../platform/capabilities";
import { ecosystemStrip, ecosystemSuggestions, renderToolsSidebar } from "../../sidebar/tools-sidebar";
import { NAV } from "../../toolkits/layout";
import { disposeAllToolPanels, escapeHtml } from "../../utils/webview-ui";
import { createExtensionContext } from "./vscode-stub";
import { suite, test } from "./run-unit-tests";

const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const codiconCss = fs.readFileSync(path.join(ROOT, "node_modules", "@vscode", "codicons", "dist", "codicon.css"), "utf8");

/** The official home of each app; a link anywhere else is a mistake. */
const OFFICIAL_HOSTS: Record<string, string> = {
  vscode: "marketplace.visualstudio.com",
  jetbrains: "plugins.jetbrains.com",
  chrome: "chromewebstore.google.com",
  studio: "apps.microsoft.com"
};

function page(options: Partial<Parameters<typeof renderEcosystemPage>[0]> = {}): string {
  return renderEcosystemPage({ cspSource: "vscode-webview://test", codiconsUri: "vscode-webview://test/codicon.css", logoUri: "vscode-webview://test/logo.png", ...options });
}

suite("DevSnip Pro ecosystem", () => {
  test("lists each app once, with an https link to its official store page", () => {
    assert.deepStrictEqual(ECOSYSTEM_PRODUCTS.map(p => p.id).sort(), Object.keys(OFFICIAL_HOSTS).sort());
    for (const product of ECOSYSTEM_PRODUCTS) {
      const url = new URL(product.url);
      assert.strictEqual(url.protocol, "https:", product.id);
      assert.strictEqual(url.hostname, OFFICIAL_HOSTS[product.id], product.id);
      assert.ok(product.features.length >= 3 && product.features.length <= 4, `${product.id} has 3-4 features`);
      assert.ok(product.name && product.tagline && product.description && product.meta && product.cta && product.platform, product.id);
    }
    assert.strictEqual(findProduct("studio")!.url, "https://apps.microsoft.com/detail/9n1dx0bjcxdx?cid=DevShareMCLPCS", "same Store link as the Database Client card");
    assert.deepStrictEqual(ECOSYSTEM_PRODUCTS.filter(p => p.current).map(p => p.id), ["vscode"]);
  });

  test("suggests the app that fits what the user is working on", () => {
    assert.strictEqual(productForSection("database")?.id, "studio");
    assert.strictEqual(productForSection("spreadsheets")?.id, "studio");
    assert.strictEqual(productForSection("frontend")?.id, "chrome");
    assert.strictEqual(productForSection("api")?.id, "jetbrains");
    assert.strictEqual(productForSection("git"), undefined);
    assert.strictEqual(resolveFocus("studio")?.id, "studio");
    assert.strictEqual(resolveFocus("database")?.id, "studio");
    assert.strictEqual(resolveFocus("vscode"), undefined, "the app in use is never suggested");
    assert.strictEqual(resolveFocus("nope"), undefined);
    assert.strictEqual(resolveFocus({ id: "studio" }), undefined);
    const sections = new Set(NAV.map(section => section.id));
    for (const product of ECOSYSTEM_PRODUCTS) for (const section of product.sections) assert.ok(sections.has(section), `${product.id}: ${section}`);
  });

  test("the page is static: no scripts of its own, no remote resources, no inline styles", () => {
    const html = page();
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    assert.ok(csp.startsWith("default-src 'none';"));
    assert.ok(!/unsafe-inline|unsafe-eval|https:/.test(csp), csp);
    assert.ok(/img-src vscode-webview:\/\/test;/.test(csp));
    assert.ok(!/<script\b/.test(html), "the theme runtime is the only script, added by setWebviewHtml");
    assert.ok(!/\sstyle="/.test(html), "inline style attributes are blocked by the CSP");
    assert.ok(!/\ssrc="https?:/.test(html), "nothing is loaded from the network");
  });

  test("every app has a card with features and a labelled link to its store", () => {
    const html = page();
    for (const product of ECOSYSTEM_PRODUCTS) {
      assert.ok(html.includes(`id="p-${product.id}"`), product.id);
      assert.ok(html.includes(`href="${product.url.replace(/&/g, "&amp;")}"`), `${product.id} links to its store`);
      assert.ok(html.includes(`href="#p-${product.id}"`), `${product.id} has a platform chip`);
    }
    assert.ok(html.includes("Available on multiple platforms"));
    assert.ok(/aria-label="Add to Chrome: DevSnip Pro for Chrome \(opens Chrome Web Store in your browser\)"/.test(html));
    assert.ok(/<span class="pill">[\s\S]*?Installed<\/span>/.test(html), "the VS Code card says it is installed");
    assert.ok(!html.includes("Suggested</span>"), "nothing is suggested without a focus");
    for (const icon of new Set(html.match(/codicon-[a-z-]+/g)!.map(c => c.slice(8)))) {
      assert.ok(codiconCss.includes(`.codicon-${icon}:before`), `codicon ${icon} exists`);
    }
  });

  test("a focus puts its app first and marks it suggested", () => {
    const studio = findProduct("studio")!;
    assert.strictEqual(cardOrder(studio)[0].id, "studio");
    assert.strictEqual(cardOrder().slice(-1)[0].id, "vscode", "the app in use comes last");
    const html = page({ focus: studio, platform: "darwin" });
    const first = /<article class="([^"]+)" id="p-([a-z]+)"/.exec(html)!;
    assert.deepStrictEqual([first[1], first[2]], ["card featured", "studio"]);
    assert.ok(html.includes("Working with databases?"));
    assert.ok(html.includes("View on Microsoft Store"), "off Windows the Store link reads View");
    assert.ok(page({ focus: studio, platform: "win32" }).includes("Get it from Microsoft Store"));
  });

  test("without a logo URI the page still draws a brand mark", () => {
    const html = renderEcosystemPage({ cspSource: "x", codiconsUri: "x" });
    assert.ok(!/<img\b/.test(html));
    assert.ok(html.includes('class="hero-logo"'));
  });

  test("every resource the panel loads sits inside a folder it may read", () => {
    // VS Code allows a resource only when its path starts with `root + "/"`, so roots must be folders.
    assert.ok(fs.statSync(path.join(ROOT, ...ECOSYSTEM_LOGO)).isFile(), "the logo ships in media/");
    const context = createExtensionContext() as unknown as { extensionUri: unknown };
    context.extensionUri = { fsPath: ROOT, scheme: "file", toString: () => `file://${ROOT}` };
    const window = vscode.window as unknown as { createWebviewPanel: (...args: any[]) => unknown };
    const original = window.createWebviewPanel;
    let roots: string[] = [];
    let html = "";
    window.createWebviewPanel = (_type: string, _title: string, _column: unknown, options: { localResourceRoots: Array<{ fsPath: string }> }) => {
      roots = options.localResourceRoots.map(root => root.fsPath);
      return {
        webview: {
          cspSource: "vscode-resource:",
          asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `vscode-resource:${uri.fsPath}` }),
          set html(value: string) { html = value; }, get html() { return html; },
          postMessage: async () => true
        },
        reveal() {}, onDidDispose() { return { dispose() {} }; }, dispose() {}
      };
    };
    try {
      openEcosystem(context as never, "database");
    } finally {
      window.createWebviewPanel = original;
      disposeAllToolPanels();
    }
    const loaded = [...html.matchAll(/(?:src|href)="vscode-resource:([^"]+)"/g)].map(m => m[1]);
    assert.ok(loaded.some(file => file.endsWith(ECOSYSTEM_LOGO.join("/"))), "the logo is used");
    for (const file of loaded) {
      assert.ok(fs.existsSync(file), `${file} exists`);
      assert.ok(roots.some(root => file.startsWith(root.endsWith("/") ? root : root + "/")), `${file} is outside ${roots.join(", ")}`);
    }
  });

  test("platform marks are self-contained SVG", () => {
    for (const [name, svg] of Object.entries(platformMarks())) {
      assert.ok(!/style=|href=|<script|url\(/.test(svg), name);
    }
    assert.ok(/^<svg class="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"/.test(platformMark("chrome")));
  });

  test("the sidebar strip lists the other apps and suggests one per category", () => {
    const strip = ecosystemStrip();
    for (const product of ECOSYSTEM_PRODUCTS) {
      assert.strictEqual(strip.includes(`<li class="eco-item" data-product="${product.id}">`), !product.current, product.id);
      if (product.current) continue;
      assert.ok(strip.includes(`data-details="${product.id}"`), `${product.id} has a details button`);
      assert.ok(strip.includes(escapeHtml(product.blurb)) && strip.includes(escapeHtml(product.nudge!)), product.id);
    }
    assert.ok(!/devsnip\.pro|data-product="web"/.test(strip), "no website entry");
    assert.ok(strip.includes("Available on multiple platforms"));
    assert.ok(!/\sstyle="|suggested/.test(strip), "no inline styles; the page script picks the suggestion");
    const suggest = ecosystemSuggestions();
    assert.strictEqual(suggest["Database"], "studio");
    assert.strictEqual(suggest["Web & Frontend"], "chrome");
    const html = renderToolsSidebar({
      cspSource: "vscode-webview://test", scriptUri: "s.js", codiconsUri: "c.css", expanded: [],
      status: { badge: "🥉", level: "Bronze", points: 0, lifetimePoints: 0, nextLevel: "Silver", toNext: 100, progress: 0 }
    });
    const data = JSON.parse(/<script type="application\/json" id="sidebar-data">([\s\S]*?)<\/script>/.exec(html)![1]);
    assert.deepStrictEqual(data.ecosystem.suggest, suggest);
    assert.ok(html.indexOf('id="eco"') > html.indexOf('id="tree"'), "the strip sits below the tools");
  });

  test("the command is contributed, works in the browser, and only opens listed links", async () => {
    const entry = manifest.contributes.commands.find((c: { command: string }) => c.command === ECOSYSTEM_COMMAND);
    assert.ok(entry && /^🌐 DevSnip Pro: Explore DevSnip Pro Ecosystem/.test(entry.title));
    assert.ok(isCommandSupported(ECOSYSTEM_COMMAND, true));
    const opened: string[] = [];
    const env = vscode.env as unknown as { openExternal: (uri: { toString(): string }) => Promise<boolean> };
    const original = env.openExternal;
    env.openExternal = async uri => { opened.push(uri.toString()); return true; };
    try {
      assert.strictEqual(await openProductPage("chrome"), true);
      assert.strictEqual(await openProductPage("https://evil.example"), false);
      assert.strictEqual(await openProductPage(undefined), false);
    } finally {
      env.openExternal = original;
    }
    assert.deepStrictEqual(opened, [findProduct("chrome")!.url]);
  });
});
