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
const themes_1 = require("../../theme/themes");
const inject_1 = require("../../theme/inject");
const service_1 = require("../../theme/service");
const tools_sidebar_1 = require("../../sidebar/tools-sidebar");
const page_1 = require("../../toolkits/page");
const tool_hub_1 = require("../../utils/tool-hub");
const hubs_1 = require("../../commands/hubs");
const registry_1 = require("../../toolkits/registry");
const types_1 = require("../../toolkits/types");
const page_2 = require("../../database/page");
const securityTools_1 = require("../../commands/securityTools");
const api_test_1 = require("../../commands/api-test");
const webview_ui_1 = require("../../utils/webview-ui");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "..", "..", "..");
function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "test")
                walk(full, out);
        }
        else if (/\.(ts|js)$/.test(entry.name))
            out.push(full);
    }
    return out;
}
const STATUS = { sidebar: { badge: "🥉", level: "Bronze", points: 0, lifetimePoints: 0, nextLevel: "Silver", toNext: 150, progress: 0 } };
/** Every page DevSnip Pro renders, through the real render functions. */
function pages() {
    const tool = (0, registry_1.findTool)("text.format");
    return [
        ["sidebar", (0, tools_sidebar_1.renderToolsSidebar)({ cspSource: "vscode-resource:", scriptUri: "s.js", codiconsUri: "c.css", status: STATUS.sidebar, expanded: [], theme: { current: "system", choices: (0, service_1.themeChoices)() } })],
        ["toolkit", (0, page_1.renderToolPage)({ cspSource: "vscode-resource:", scriptUri: "t.js", tool: (0, types_1.describe)(tool), section: { id: "text", title: "Text" }, examples: [], initial: {}, platform: "darwin" })],
        ["hub", (0, tool_hub_1.renderToolHub)(hubs_1.ALL_TOOLS_HUB, { cspSource: "vscode-resource:", scriptUri: "h.js", pinned: [] })],
        ["database", (0, page_2.renderDatabasePage)({ cspSource: "vscode-resource:", scriptUri: "d.js", codiconsUri: "c.css", platform: "darwin" })],
        ["security", (0, securityTools_1.securityHubHtml)("abc123", { url: "https://example.com", timeoutMs: 1000, activeChecks: false })],
        ["rest", (0, api_test_1.getWebviewContent)([], true)]
    ];
}
(0, run_unit_tests_1.suite)("themes: palettes", () => {
    (0, run_unit_tests_1.test)("ships the promised themes, each with a unique id and complete #rrggbb palette", () => {
        assert.deepStrictEqual(themes_1.THEMES.map(t => t.label), ["Dark", "Midnight", "Dracula", "Monokai", "Nord", "Cyberpunk", "Solarized", "Ember", "Synthwave", "Aurora", "Light", "High Contrast"]);
        assert.strictEqual(new Set(themes_1.THEMES.map(t => t.id)).size, themes_1.THEMES.length);
        assert.ok(!(0, themes_1.findTheme)(themes_1.SYSTEM_THEME_ID), "system is not a palette");
        for (const theme of themes_1.THEMES) {
            const p = theme.palette;
            const colours = { ...p, ...Object.fromEntries(Object.entries(p.ansi).map(([k, v]) => [`ansi.${k}`, v])), ...Object.fromEntries(Object.entries(p.syntax).map(([k, v]) => [`syntax.${k}`, v])) };
            for (const [key, value] of Object.entries(colours)) {
                if (["kind", "ansi", "syntax", "shadow"].includes(key))
                    continue;
                assert.match(String(value), /^#[0-9a-f]{6}$/, `${theme.id}.${key}`);
            }
            assert.strictEqual((0, themes_1.swatches)(theme).length, 4);
        }
    });
    (0, run_unit_tests_1.test)("every theme keeps text, controls and status colours readable (WCAG)", () => {
        const rules = [
            ["fg", "bg", 7], ["fg", "sidebar", 7], ["fg", "surface", 4.5], ["fg", "surface2", 4.5],
            ["muted", "bg", 4.5], ["muted", "sidebar", 4.5], ["muted", "surface", 4.5],
            ["accentFg", "accent", 4.5], ["accentFg", "accentHover", 4.5],
            ["link", "bg", 4.5], ["link", "surface", 4.5], ["selectionFg", "selection", 4.5], ["fg", "selection", 4.5],
            ["success", "bg", 4.5], ["warning", "bg", 4.5], ["danger", "bg", 4.5], ["info", "bg", 4.5],
            // Text drawn on a status fill uses the background colour (--ds-on-status).
            ["bg", "success", 4.5], ["bg", "danger", 4.5],
            ["focus", "bg", 3], ["disabled", "bg", 2.5]
        ];
        const failures = [];
        for (const theme of themes_1.THEMES) {
            const p = theme.palette;
            for (const [a, b, min] of rules) {
                const ratio = (0, themes_1.contrast)(p[a], p[b]);
                if (ratio < min)
                    failures.push(`${theme.id}: ${String(a)} on ${String(b)} is ${ratio.toFixed(2)}, needs ${min}`);
            }
            // Icons and category colours are non-text (3:1); code tokens are text (4.5:1).
            for (const [name, colour] of Object.entries(p.ansi))
                if ((0, themes_1.contrast)(colour, p.bg) < 3)
                    failures.push(`${theme.id}: ansi.${name}`);
            for (const [name, colour] of Object.entries(p.syntax))
                if ((0, themes_1.contrast)(colour, p.bg) < 4.5)
                    failures.push(`${theme.id}: syntax.${name}`);
        }
        assert.deepStrictEqual(failures, []);
    });
    (0, run_unit_tests_1.test)("themes every VS Code colour variable the webviews use", () => {
        const used = new Set();
        for (const file of [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "media"))]) {
            for (const m of fs.readFileSync(file, "utf8").matchAll(/--vscode-([a-zA-Z0-9-]+)/g))
                used.add(m[1]);
        }
        // Font settings stay the user's, and dynamic ids are built at runtime.
        const ignored = /^(font-|editor-font-|font$)|^(font-family|font-size|font-weight)$/;
        const themed = new Set(Object.keys((0, themes_1.themeVariables)(themes_1.THEMES[0].palette)));
        const missing = [...used].filter(name => !ignored.test(name) && !themed.has(name) && !name.endsWith("-"));
        assert.deepStrictEqual(missing, [], "add these to themeVariables() so every theme restyles them");
    });
    (0, run_unit_tests_1.test)("shared stylesheets use tokens, not hard-coded status colours", () => {
        for (const css of [webview_ui_1.TOOL_CSS, webview_ui_1.UTILITY_CSS]) {
            assert.ok(!/#2e7d32|#c62828|#1565c0|--success: #|--error: #|--warning: #/.test(css));
            assert.ok(!/color: #fff\b/.test(css), "text on fills uses --ds-on-status or a theme colour");
        }
    });
    (0, run_unit_tests_1.test)("System Default only defines design tokens; named themes override VS Code's variables", () => {
        assert.deepStrictEqual((0, themes_1.themeRules)("system"), [themes_1.DESIGN_TOKENS]);
        assert.deepStrictEqual((0, themes_1.themeRules)("nope"), [themes_1.DESIGN_TOKENS]);
        const rules = (0, themes_1.themeRules)("dracula").join("\n");
        assert.match(rules, /--vscode-editor-background: #282a36 !important;/);
        assert.match(rules, /--vscode-button-background: #bd93f9 !important;/);
        assert.match(rules, /--vscode-contrastBorder: initial !important;/, "HC outlines are reset outside High Contrast");
        assert.match(rules, /color-scheme: dark !important/);
        assert.match((0, themes_1.themeRules)("light").join("\n"), /color-scheme: light !important/);
        assert.match((0, themes_1.themeRules)("high-contrast").join("\n"), /--vscode-contrastBorder: #6fc3df !important;/);
        assert.match((0, themes_1.themeRules)("nord", "sidebar").join("\n"), /background-color: #2a2f3a !important/);
        assert.strictEqual((0, themes_1.validThemeId)("midnight"), "midnight");
        assert.strictEqual((0, themes_1.validThemeId)("deleted-theme"), "system");
        assert.strictEqual((0, themes_1.validThemeId)(42), "system");
    });
});
(0, run_unit_tests_1.suite)("themes: injection", () => {
    (0, run_unit_tests_1.test)("extends each kind of CSP with one nonce, keeping inline styles working", () => {
        assert.strictEqual((0, inject_1.extendCsp)("default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-a';", "N"), "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-a' 'nonce-N';", "a nonce would disable 'unsafe-inline', so style-src is left alone");
        assert.strictEqual((0, inject_1.extendCsp)("default-src 'none'; font-src x; style-src x 'nonce-a'; script-src 'nonce-a';", "N"), "default-src 'none'; font-src x; style-src x 'nonce-a' 'nonce-N'; script-src 'nonce-a' 'nonce-N';");
        assert.strictEqual((0, inject_1.extendCsp)("default-src 'none'; style-src 'unsafe-inline'; script-src vscode-resource:;", "N"), "default-src 'none'; style-src 'unsafe-inline'; script-src vscode-resource: 'nonce-N';");
    });
    (0, run_unit_tests_1.test)("every DevSnip Pro page gets the theme, its runtime and a CSP that allows them", () => {
        for (const [name, html] of pages()) {
            const out = (0, inject_1.injectTheme)(html, "nord", name === "sidebar" ? "sidebar" : "panel");
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
    (0, run_unit_tests_1.test)("works on pages without a head, and never treats $ in injected text as a pattern", () => {
        const out = (0, inject_1.injectTheme)("<body>hi</body>", "light");
        assert.ok(out.startsWith('<style id="devsnip-theme"'), out.slice(0, 40));
        const bare = (0, inject_1.injectTheme)("plain", "system");
        assert.ok(bare.endsWith("plain"));
        assert.ok(!(0, inject_1.injectTheme)("<html><head></head><body></body></html>", "dark").includes("$&"));
    });
    (0, run_unit_tests_1.test)("theme messages carry the rules and the kind the runtime mirrors onto body classes", () => {
        const msg = (0, inject_1.themeMessage)("high-contrast", "panel");
        assert.strictEqual(msg.type, inject_1.THEME_MESSAGE);
        assert.strictEqual(msg.kind, "hc");
        assert.deepStrictEqual((0, inject_1.themeMessage)("system", "panel").kind, null);
        assert.strictEqual((0, inject_1.themeMessage)("bogus", "panel").id, "system");
    });
});
(0, run_unit_tests_1.suite)("themes: service", () => {
    (0, run_unit_tests_1.test)("persists the choice, applies it to new pages and pushes it to open ones", async () => {
        const context = (0, vscode_stub_1.createExtensionContext)({ "devsnip.appearance.theme": "dracula" });
        (0, service_1.initThemes)(context);
        assert.strictEqual((0, service_1.currentThemeId)(), "dracula", "the stored theme is restored on start");
        const sent = [];
        const live = { html: "", postMessage: async (m) => { sent.push(m); return true; } };
        const disposed = { html: "", postMessage: () => { throw new Error("Webview is disposed"); } };
        (0, service_1.setWebviewHtml)(live, "<html><head></head><body></body></html>");
        (0, service_1.setWebviewHtml)(disposed, "<html><head></head><body></body></html>");
        assert.match(live.html, /--vscode-editor-background: #282a36 !important/);
        await (0, service_1.setTheme)("light");
        assert.strictEqual(context.globalState.get("devsnip.appearance.theme"), "light");
        assert.strictEqual(sent.length, 1);
        assert.strictEqual(sent[0].id, "light");
        await assert.rejects((0, service_1.setTheme)("nope"), /Unknown theme/);
        await (0, service_1.setTheme)("system");
        assert.strictEqual(sent.length, 2, "the disposed webview was dropped, the live one kept");
        (0, service_1.initThemes)((0, vscode_stub_1.createExtensionContext)({ "devsnip.appearance.theme": "removed-theme" }));
        assert.strictEqual((0, service_1.currentThemeId)(), "system", "an unknown stored theme falls back to System Default");
    });
    (0, run_unit_tests_1.test)("the sidebar shows the picker with System Default first and a preview per theme", () => {
        const choices = (0, service_1.themeChoices)();
        assert.strictEqual(choices[0].id, "system");
        assert.strictEqual(choices.length, themes_1.THEMES.length + 1);
        assert.ok(choices.slice(1).every(c => c.preview && c.swatches.length === 4));
        const html = (0, tools_sidebar_1.renderToolsSidebar)({ cspSource: "x", scriptUri: "s.js", codiconsUri: "c.css", status: STATUS.sidebar, expanded: [], theme: { current: "nord", choices } });
        assert.ok(html.indexOf('id="themeBtn"') < html.indexOf('id="rank"'), "the selector sits above the rank card and tools");
        assert.match(html, /"current":"nord"/);
        assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(ROOT, "media", "tools-sidebar.js"), "utf8")));
    });
});
//# sourceMappingURL=theme.unit.js.map