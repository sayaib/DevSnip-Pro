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
const vscode = __importStar(require("vscode"));
const command_1 = require("../../ecosystem/command");
const marks_1 = require("../../ecosystem/marks");
const page_1 = require("../../ecosystem/page");
const panel_1 = require("../../ecosystem/panel");
const products_1 = require("../../ecosystem/products");
const capabilities_1 = require("../../platform/capabilities");
const tools_sidebar_1 = require("../../sidebar/tools-sidebar");
const layout_1 = require("../../toolkits/layout");
const webview_ui_1 = require("../../utils/webview-ui");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const codiconCss = fs.readFileSync(path.join(ROOT, "node_modules", "@vscode", "codicons", "dist", "codicon.css"), "utf8");
/** The official home of each app; a link anywhere else is a mistake. */
const OFFICIAL_HOSTS = {
    vscode: "marketplace.visualstudio.com",
    jetbrains: "plugins.jetbrains.com",
    chrome: "chromewebstore.google.com",
    studio: "apps.microsoft.com"
};
function page(options = {}) {
    return (0, page_1.renderEcosystemPage)({ cspSource: "vscode-webview://test", codiconsUri: "vscode-webview://test/codicon.css", logoUri: "vscode-webview://test/logo.png", ...options });
}
(0, run_unit_tests_1.suite)("DevSnip Pro ecosystem", () => {
    (0, run_unit_tests_1.test)("lists each app once, with an https link to its official store page", () => {
        assert.deepStrictEqual(products_1.ECOSYSTEM_PRODUCTS.map(p => p.id).sort(), Object.keys(OFFICIAL_HOSTS).sort());
        for (const product of products_1.ECOSYSTEM_PRODUCTS) {
            const url = new URL(product.url);
            assert.strictEqual(url.protocol, "https:", product.id);
            assert.strictEqual(url.hostname, OFFICIAL_HOSTS[product.id], product.id);
            assert.ok(product.features.length >= 3 && product.features.length <= 4, `${product.id} has 3-4 features`);
            assert.ok(product.name && product.tagline && product.description && product.meta && product.cta && product.platform, product.id);
        }
        assert.strictEqual((0, products_1.findProduct)("studio").url, "https://apps.microsoft.com/detail/9n1dx0bjcxdx?cid=DevShareMCLPCS", "same Store link as the Database Client card");
        assert.deepStrictEqual(products_1.ECOSYSTEM_PRODUCTS.filter(p => p.current).map(p => p.id), ["vscode"]);
    });
    (0, run_unit_tests_1.test)("suggests the app that fits what the user is working on", () => {
        assert.strictEqual((0, products_1.productForSection)("database")?.id, "studio");
        assert.strictEqual((0, products_1.productForSection)("spreadsheets")?.id, "studio");
        assert.strictEqual((0, products_1.productForSection)("frontend")?.id, "chrome");
        assert.strictEqual((0, products_1.productForSection)("api")?.id, "jetbrains");
        assert.strictEqual((0, products_1.productForSection)("git"), undefined);
        assert.strictEqual((0, products_1.resolveFocus)("studio")?.id, "studio");
        assert.strictEqual((0, products_1.resolveFocus)("database")?.id, "studio");
        assert.strictEqual((0, products_1.resolveFocus)("vscode"), undefined, "the app in use is never suggested");
        assert.strictEqual((0, products_1.resolveFocus)("nope"), undefined);
        assert.strictEqual((0, products_1.resolveFocus)({ id: "studio" }), undefined);
        const sections = new Set(layout_1.NAV.map(section => section.id));
        for (const product of products_1.ECOSYSTEM_PRODUCTS)
            for (const section of product.sections)
                assert.ok(sections.has(section), `${product.id}: ${section}`);
    });
    (0, run_unit_tests_1.test)("the page is static: no scripts of its own, no remote resources, no inline styles", () => {
        const html = page();
        const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
        assert.ok(csp.startsWith("default-src 'none';"));
        assert.ok(!/unsafe-inline|unsafe-eval|https:/.test(csp), csp);
        assert.ok(/img-src vscode-webview:\/\/test;/.test(csp));
        assert.ok(!/<script\b/.test(html), "the theme runtime is the only script, added by setWebviewHtml");
        assert.ok(!/\sstyle="/.test(html), "inline style attributes are blocked by the CSP");
        assert.ok(!/\ssrc="https?:/.test(html), "nothing is loaded from the network");
    });
    (0, run_unit_tests_1.test)("every app has a card with features and a labelled link to its store", () => {
        const html = page();
        for (const product of products_1.ECOSYSTEM_PRODUCTS) {
            assert.ok(html.includes(`id="p-${product.id}"`), product.id);
            assert.ok(html.includes(`href="${product.url.replace(/&/g, "&amp;")}"`), `${product.id} links to its store`);
            assert.ok(html.includes(`href="#p-${product.id}"`), `${product.id} has a platform chip`);
        }
        assert.ok(html.includes("Available on multiple platforms"));
        assert.ok(/aria-label="Add to Chrome: DevSnip Pro for Chrome \(opens Chrome Web Store in your browser\)"/.test(html));
        assert.ok(/<span class="pill">[\s\S]*?Installed<\/span>/.test(html), "the VS Code card says it is installed");
        assert.ok(!html.includes("Suggested</span>"), "nothing is suggested without a focus");
        for (const icon of new Set(html.match(/codicon-[a-z-]+/g).map(c => c.slice(8)))) {
            assert.ok(codiconCss.includes(`.codicon-${icon}:before`), `codicon ${icon} exists`);
        }
    });
    (0, run_unit_tests_1.test)("a focus puts its app first and marks it suggested", () => {
        const studio = (0, products_1.findProduct)("studio");
        assert.strictEqual((0, page_1.cardOrder)(studio)[0].id, "studio");
        assert.strictEqual((0, page_1.cardOrder)().slice(-1)[0].id, "vscode", "the app in use comes last");
        const html = page({ focus: studio, platform: "darwin" });
        const first = /<article class="([^"]+)" id="p-([a-z]+)"/.exec(html);
        assert.deepStrictEqual([first[1], first[2]], ["card featured", "studio"]);
        assert.ok(html.includes("Working with databases?"));
        assert.ok(html.includes("View on Microsoft Store"), "off Windows the Store link reads View");
        assert.ok(page({ focus: studio, platform: "win32" }).includes("Get it from Microsoft Store"));
    });
    (0, run_unit_tests_1.test)("without a logo URI the page still draws a brand mark", () => {
        const html = (0, page_1.renderEcosystemPage)({ cspSource: "x", codiconsUri: "x" });
        assert.ok(!/<img\b/.test(html));
        assert.ok(html.includes('class="hero-logo"'));
    });
    (0, run_unit_tests_1.test)("every resource the panel loads sits inside a folder it may read", () => {
        // VS Code allows a resource only when its path starts with `root + "/"`, so roots must be folders.
        assert.ok(fs.statSync(path.join(ROOT, ...panel_1.ECOSYSTEM_LOGO)).isFile(), "the logo ships in media/");
        const context = (0, vscode_stub_1.createExtensionContext)();
        context.extensionUri = { fsPath: ROOT, scheme: "file", toString: () => `file://${ROOT}` };
        const window = vscode.window;
        const original = window.createWebviewPanel;
        let roots = [];
        let html = "";
        window.createWebviewPanel = (_type, _title, _column, options) => {
            roots = options.localResourceRoots.map(root => root.fsPath);
            return {
                webview: {
                    cspSource: "vscode-resource:",
                    asWebviewUri: (uri) => ({ toString: () => `vscode-resource:${uri.fsPath}` }),
                    set html(value) { html = value; }, get html() { return html; },
                    postMessage: async () => true
                },
                reveal() { }, onDidDispose() { return { dispose() { } }; }, dispose() { }
            };
        };
        try {
            (0, panel_1.openEcosystem)(context, "database");
        }
        finally {
            window.createWebviewPanel = original;
            (0, webview_ui_1.disposeAllToolPanels)();
        }
        const loaded = [...html.matchAll(/(?:src|href)="vscode-resource:([^"]+)"/g)].map(m => m[1]);
        assert.ok(loaded.some(file => file.endsWith(panel_1.ECOSYSTEM_LOGO.join("/"))), "the logo is used");
        for (const file of loaded) {
            assert.ok(fs.existsSync(file), `${file} exists`);
            assert.ok(roots.some(root => file.startsWith(root.endsWith("/") ? root : root + "/")), `${file} is outside ${roots.join(", ")}`);
        }
    });
    (0, run_unit_tests_1.test)("platform marks are self-contained SVG", () => {
        for (const [name, svg] of Object.entries((0, marks_1.platformMarks)())) {
            assert.ok(!/style=|href=|<script|url\(/.test(svg), name);
        }
        assert.ok(/^<svg class="mark" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"/.test((0, marks_1.platformMark)("chrome")));
    });
    (0, run_unit_tests_1.test)("the sidebar strip lists the other apps and suggests one per category", () => {
        const strip = (0, tools_sidebar_1.ecosystemStrip)();
        for (const product of products_1.ECOSYSTEM_PRODUCTS) {
            assert.strictEqual(strip.includes(`<li class="eco-item" data-product="${product.id}">`), !product.current, product.id);
            if (product.current)
                continue;
            assert.ok(strip.includes(`data-details="${product.id}"`), `${product.id} has a details button`);
            assert.ok(strip.includes((0, webview_ui_1.escapeHtml)(product.blurb)) && strip.includes((0, webview_ui_1.escapeHtml)(product.nudge)), product.id);
        }
        assert.ok(!/devsnip\.pro|data-product="web"/.test(strip), "no website entry");
        assert.ok(strip.includes("Available on multiple platforms"));
        assert.ok(!/\sstyle="|suggested/.test(strip), "no inline styles; the page script picks the suggestion");
        const suggest = (0, tools_sidebar_1.ecosystemSuggestions)();
        assert.strictEqual(suggest["Database"], "studio");
        assert.strictEqual(suggest["Web & Frontend"], "chrome");
        const html = (0, tools_sidebar_1.renderToolsSidebar)({
            cspSource: "vscode-webview://test", scriptUri: "s.js", codiconsUri: "c.css", expanded: [],
            status: { badge: "🥉", level: "Bronze", points: 0, lifetimePoints: 0, nextLevel: "Silver", toNext: 100, progress: 0 }
        });
        const data = JSON.parse(/<script type="application\/json" id="sidebar-data">([\s\S]*?)<\/script>/.exec(html)[1]);
        assert.deepStrictEqual(data.ecosystem.suggest, suggest);
        assert.ok(html.indexOf('id="eco"') > html.indexOf('id="tree"'), "the strip sits below the tools");
    });
    (0, run_unit_tests_1.test)("the command is contributed, works in the browser, and only opens listed links", async () => {
        const entry = manifest.contributes.commands.find((c) => c.command === command_1.ECOSYSTEM_COMMAND);
        assert.ok(entry && /^🌐 DevSnip Pro: Explore DevSnip Pro Ecosystem/.test(entry.title));
        assert.ok((0, capabilities_1.isCommandSupported)(command_1.ECOSYSTEM_COMMAND, true));
        const opened = [];
        const env = vscode.env;
        const original = env.openExternal;
        env.openExternal = async (uri) => { opened.push(uri.toString()); return true; };
        try {
            assert.strictEqual(await (0, command_1.openProductPage)("chrome"), true);
            assert.strictEqual(await (0, command_1.openProductPage)("https://evil.example"), false);
            assert.strictEqual(await (0, command_1.openProductPage)(undefined), false);
        }
        finally {
            env.openExternal = original;
        }
        assert.deepStrictEqual(opened, [(0, products_1.findProduct)("chrome").url]);
    });
});
//# sourceMappingURL=ecosystem.unit.js.map