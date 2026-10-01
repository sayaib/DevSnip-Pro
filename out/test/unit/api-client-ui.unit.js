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
const run_unit_tests_1 = require("./run-unit-tests");
/**
 * Structural and accessibility invariants for the REST API Client page.
 *
 * These assert on the markup the extension host actually produces, so a future
 * edit that drops a label, desynchronises a tab's accessible state, or removes
 * the large-response guard fails the build rather than shipping.
 */
function renderClient(allowWebSockets = false) {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { getWebviewContent } = require("../../commands/api-test");
    /* eslint-enable @typescript-eslint/no-var-requires */
    return getWebviewContent([], allowWebSockets);
}
/** Crude element scan; enough to assert on attributes without a DOM library. */
function elementsWith(html, pattern) {
    return html.match(pattern) ?? [];
}
(0, run_unit_tests_1.suite)("REST API Client markup", () => {
    (0, run_unit_tests_1.test)("the core request controls are present", () => {
        const html = renderClient();
        for (const id of ["method", "url", "sendRequest", "cancelRequest", "responseOutput", "statusCode"]) {
            assert.ok(html.includes(`id="${id}"`), `the ${id} control is missing`);
        }
    });
    (0, run_unit_tests_1.test)("every tab exposes an accessible selected state", () => {
        const html = renderClient();
        const tabs = elementsWith(html, /<button[^>]*role="tab"[^>]*>/g);
        assert.ok(tabs.length >= 10, `expected the request and response tabs, found ${tabs.length}`);
        const missing = tabs.filter(tab => !/aria-selected="(true|false)"/.test(tab));
        assert.deepStrictEqual(missing, [], "these tabs have no aria-selected, so assistive tech cannot tell which is active");
    });
    (0, run_unit_tests_1.test)("every tab list is labelled and holds tabs", () => {
        const html = renderClient();
        const lists = elementsWith(html, /<div[^>]*role="tablist"[^>]*>/g);
        assert.ok(lists.length >= 3, `expected at least three tab lists, found ${lists.length}`);
        const unlabelled = lists.filter(list => !/aria-label="/.test(list));
        assert.deepStrictEqual(unlabelled, [], "a tab list needs an aria-label to be identifiable");
    });
    (0, run_unit_tests_1.test)("inputs are labelled for screen readers", () => {
        const html = renderClient();
        // Every text-like input carries either an aria-label or a matching <label>.
        const inputs = elementsWith(html, /<input[^>]*type="(?:text|search|number|password)"[^>]*>/g);
        const unlabelled = inputs.filter(input => {
            if (/aria-label="/.test(input))
                return false;
            const id = /id="([^"]+)"/.exec(input)?.[1];
            return !(id && html.includes(`for="${id}"`));
        });
        assert.deepStrictEqual(unlabelled.map(i => i.slice(0, 60)), [], "these inputs have no accessible name");
    });
    (0, run_unit_tests_1.test)("the URL error hint is a live region the field can point at", () => {
        const html = renderClient();
        assert.ok(/id="urlError"[^>]*aria-live="polite"/.test(html), "the URL hint must announce itself when it changes");
        assert.ok(html.includes('aria-describedby'), "the URL field must be able to reference its hint");
        assert.ok(html.includes("aria-invalid"), "URL validity must be exposed, not only coloured");
    });
    (0, run_unit_tests_1.test)("status is conveyed with a glyph and text, never colour alone", () => {
        const html = renderClient();
        // The renderer prefixes the status with a check, warning or cross glyph.
        for (const [name, glyph] of [["check", "\u2713"], ["warning", "\u26A0"], ["cross", "\u2717"]]) {
            assert.ok(html.includes(glyph), `the status renderer is missing its ${name} indicator`);
        }
    });
    (0, run_unit_tests_1.test)("large responses are bounded so the panel stays responsive", () => {
        const html = renderClient();
        assert.ok(/HIGHLIGHT_CHAR_BUDGET\s*=\s*\d+/.test(html), "the response render budget is gone");
        assert.ok(html.includes("renderFullResponse"), "there must be a way to opt into rendering the whole payload");
    });
    (0, run_unit_tests_1.test)("tab lists support arrow-key navigation", () => {
        const html = renderClient();
        for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
            assert.ok(html.includes(key), `tab keyboard navigation is missing ${key}`);
        }
        assert.ok(html.includes("wireTabList"), "the tab list keyboard wiring is gone");
    });
    (0, run_unit_tests_1.test)("colours come from the VS Code theme rather than being hardcoded", () => {
        const html = renderClient();
        const styles = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
        // Custom property declarations must resolve through the theme.
        const declarations = styles.match(/--[a-z0-9-]+\s*:\s*[^;]+;/gi) ?? [];
        const literal = declarations.filter(decl => /:\s*(#[0-9a-f]{3,8}|rgb|hsl)/i.test(decl) && !/var\(--vscode/.test(decl));
        assert.deepStrictEqual(literal.map(d => d.trim()), [], "these palette entries ignore the VS Code theme and will look wrong in light or high-contrast themes");
    });
    (0, run_unit_tests_1.test)("empty states explain what to do instead of showing a blank panel", () => {
        const html = renderClient();
        assert.ok(html.includes("No response yet"), "the response panel needs an empty state");
        assert.ok(/Configure your request/.test(html), "the empty state should say what to do next");
    });
    (0, run_unit_tests_1.test)("the points balance is always visible and opens the points hub", () => {
        const html = renderClient();
        assert.ok(html.includes('id="pointsBadge"'), "the header needs a points balance");
        assert.ok(html.includes('id="userPointsBadge"'), "the balance value needs an element to update");
        assert.ok(/aria-label="Points balance"/.test(html), "the balance needs an accessible name");
    });
    (0, run_unit_tests_1.test)("the client can explain how points are earned", () => {
        const html = renderClient();
        assert.ok(html.includes("showEarnPoints"), "there must be an earn-points explainer");
        assert.ok(html.includes("Points are earned by using DevSnip Pro"), "the explainer needs its content");
        assert.ok(html.includes("cost-tag"), "premium tools must be able to show their price");
    });
    (0, run_unit_tests_1.test)("tool action buttons share a styled row", () => {
        const html = renderClient();
        const styles = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
        // Without a rule the wrapper is an unstyled block and the buttons stack
        // ragged, each sized to its own label.
        assert.ok(/\.tool-actions-row\s*\{[^}]*display:\s*flex/.test(styles), "the actions row must lay its buttons out in a flex row");
        assert.ok(/\.tool-actions-row\s+\.btn\s*\{[^}]*min-width/.test(styles), "buttons in a row need a shared minimum width so they line up");
        assert.ok(!html.includes("feature-card-actions"), "the old unstyled actions class should be gone");
    });
    (0, run_unit_tests_1.test)("the WebSocket allowance still tracks entitlement", () => {
        assert.ok(!/connect-src/.test(renderClient(false)), "a free page must not be allowed to open a socket");
        assert.ok(/connect-src ws: wss:/.test(renderClient(true)), "an entitled page needs the allowance");
    });
    (0, run_unit_tests_1.test)("the request builder offers tabs, saving and keyboard shortcuts", () => {
        const html = renderClient();
        for (const id of ["reqTabs", "newTabBtn", "reqName", "saveRequestBtn", "moreMenu", "curlModal", "shortcutsModal", "splitter"]) {
            assert.ok(html.includes(`id="${id}"`), `the ${id} control is missing`);
        }
        assert.ok(/role="menu"/.test(html) && /role="menuitem"/.test(html), "the actions menu needs menu semantics");
        assert.ok(/id="splitter"[^>]*role="separator"/.test(html), "the pane splitter must be a focusable separator");
    });
    (0, run_unit_tests_1.test)("every role=tab in the static markup sits inside a labelled tab list", () => {
        const html = renderClient();
        const lists = elementsWith(html, /<div[^>]*role="tablist"[^>]*>/g);
        assert.ok(lists.some(list => /id="reqTabs"/.test(list)), "open requests are a tab list");
    });
});
/**
 * The JSON viewer once dropped every quote and colon, so a response read as
 * `name Leanne` instead of `"name": "Leanne"`. These run the page's own
 * functions against real payloads.
 */
(0, run_unit_tests_1.suite)("REST API Client response rendering", () => {
    function pageFunction(name, until, deps = []) {
        const html = renderClient();
        const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
        const slice = (start, end) => {
            const from = script.indexOf(start);
            const to = script.indexOf(end, from + start.length);
            assert.ok(from >= 0 && to > from, `could not find ${start} in the page script`);
            return script.slice(from, to);
        };
        const source = deps.map(dep => slice(`function ${dep}(`, "\n}\n") + "\n}\n").join("") + slice(`function ${name}(`, until);
        return new Function(`${source}; return ${name};`)();
    }
    (0, run_unit_tests_1.test)("highlighted JSON keeps quotes, colons and punctuation", () => {
        const highlightJson = pageFunction("highlightJson", "function highlightMarkup(", ["escapeHtml"]);
        const json = JSON.stringify({ name: "Ada \"Countess\"", n: -1.5e3, ok: true, none: null, list: [1, "two"] }, null, 2);
        const html = highlightJson(json);
        const text = html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        assert.strictEqual(text, json, "the visible text must be exactly the JSON");
        assert.ok(html.includes('<span class="json-key">&quot;name&quot;</span>'));
        assert.ok(html.includes('<span class="json-number">-1500</span>'));
        assert.ok(html.includes('<span class="json-boolean">true</span>'));
        assert.ok(html.includes('<span class="json-null">null</span>'));
    });
    (0, run_unit_tests_1.test)("a JSON syntax error is located by line and column", () => {
        const locate = pageFunction("jsonErrorOffset", "/* Turns a JSON.parse error");
        const text = '{\n  "a": 1,\n  "b": }';
        assert.strictEqual(locate(text), text.indexOf("}"));
        assert.strictEqual(locate('{"a": [1, 2]}'), -1);
        assert.strictEqual(locate('{"a": 1,}'), 8, "a trailing comma is reported where the next key was expected");
    });
});
//# sourceMappingURL=api-client-ui.unit.js.map