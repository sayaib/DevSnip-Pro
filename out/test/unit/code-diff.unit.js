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
const panel_1 = require("../../diff/panel");
const page_1 = require("../../diff/page");
const capabilities_1 = require("../../platform/capabilities");
const commands_1 = require("../../toolkits/commands");
const layout_1 = require("../../toolkits/layout");
const run_unit_tests_1 = require("./run-unit-tests");
const ROOT = path.resolve(__dirname, "../../..");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const E = require(path.join(ROOT, "media", "code-diff-engine.js"));
function compute(left, right, options = {}) {
    return E.compute(left, right, options);
}
/** Applies a unified diff the way `patch` does, for checking the patch output. */
function applyPatch(original, patch) {
    const src = original === "" ? [] : original.replace(/\r\n?/g, "\n").split("\n");
    let srcFinalNewline = original.endsWith("\n") || original.endsWith("\r");
    if (srcFinalNewline)
        src.pop();
    const out = [];
    let outFinalNewline = srcFinalNewline;
    const lines = patch.split("\n");
    if (lines[lines.length - 1] === "")
        lines.pop();
    let pos = 0, i = 2;
    while (i < lines.length) {
        const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i]);
        assert.ok(h, `hunk header expected: ${lines[i]}`);
        const aStart = Number(h[1]), aCount = h[2] === undefined ? 1 : Number(h[2]);
        const startIndex = aCount === 0 ? aStart : aStart - 1;
        while (pos < startIndex)
            out.push(src[pos++]);
        i++;
        while (i < lines.length && !lines[i].startsWith("@@")) {
            const l = lines[i], tag = l[0], body = l.slice(1);
            const noNl = lines[i + 1] === "\\ No newline at end of file";
            if (tag === " ") {
                assert.strictEqual(src[pos], body, "context matches");
                out.push(src[pos++]);
                outFinalNewline = !noNl;
            }
            else if (tag === "-") {
                assert.strictEqual(src[pos], body, "removed line matches");
                pos++;
                if (noNl)
                    srcFinalNewline = false;
            }
            else if (tag === "+") {
                out.push(body);
                outFinalNewline = !noNl;
            }
            i += noNl ? 2 : 1;
        }
    }
    // Lines after the last hunk come from the original, with its final line break.
    if (pos < src.length)
        outFinalNewline = srcFinalNewline;
    while (pos < src.length)
        out.push(src[pos++]);
    if (!out.length)
        return "";
    return out.join("\n") + (outFinalNewline ? "\n" : "");
}
function lcsLength(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--)
        for (let j = b.length - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    return dp[0][0];
}
function random(seed) {
    return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
function lineOf(text, side, index) { return text.slice(side.starts[index], side.ends[index]); }
(0, run_unit_tests_1.suite)("code diff: engine", () => {
    (0, run_unit_tests_1.test)("splits lines on every line-ending style and reports it", () => {
        assert.deepStrictEqual(pick(E.splitLines("a\r\nb\r\n")), { count: 2, eol: "CRLF", finalNewline: true });
        assert.deepStrictEqual(pick(E.splitLines("a\nb")), { count: 2, eol: "LF", finalNewline: false });
        assert.deepStrictEqual(pick(E.splitLines("a\rb\n")), { count: 2, eol: "mixed", finalNewline: true });
        assert.deepStrictEqual(pick(E.splitLines("")), { count: 0, eol: "none", finalNewline: false });
        assert.deepStrictEqual(pick(E.splitLines("\n")), { count: 1, eol: "LF", finalNewline: true });
        function pick(s) { return { count: s.count, eol: s.eol, finalNewline: s.finalNewline }; }
    });
    (0, run_unit_tests_1.test)("counts added, removed and modified lines, pairing edits of the same line", () => {
        const m = compute("PORT=3000\nLOG_LEVEL=info\nCACHE_TTL=60\nFEATURE_X=false", "PORT=3000\nLOG_LEVEL=debug\nCACHE_TTL=60\nFEATURE_X=true\nFEATURE_Y=true");
        assert.deepStrictEqual(m.stats, { added: 1, removed: 0, modified: 2, unchanged: 2, additions: 3, deletions: 2, changes: 2 });
        // LOG_LEVEL=info is paired with LOG_LEVEL=debug.
        const del = Array.from(m.kind).indexOf(E.KIND_DELETE);
        assert.strictEqual(m.ai[del], 1);
        assert.strictEqual(m.bi[m.pair[del]], 1);
        assert.strictEqual(m.pair[m.pair[del]], del);
    });
    (0, run_unit_tests_1.test)("identical, whitespace-only, case-only and line-ending-only differences", () => {
        assert.ok(compute("a\nb\n", "a\nb\n").exact);
        const eol = compute("a\r\nb\r\n", "a\nb\n");
        assert.ok(eol.identical && !eol.exact, "line endings never show as changes");
        assert.strictEqual(eol.left.eol, "CRLF");
        assert.ok(!compute("if (x) {\n  y();\n}", "if (x) {\n\ty();\n}").identical);
        assert.ok(compute("if (x) {\n  y();\n}", "if (x){\n\ty( );\n}", { ignoreWhitespace: true }).identical);
        assert.ok(!compute("SELECT 1", "select 1").identical);
        assert.ok(compute("SELECT 1", "select 1", { ignoreCase: true }).identical);
    });
    (0, run_unit_tests_1.test)("a missing final newline is a change, as in git, unless whitespace is ignored", () => {
        const m = compute("a\nb\n", "a\nb");
        assert.ok(!m.identical);
        assert.strictEqual(m.stats.modified, 1);
        assert.strictEqual(E.unifiedPatch(m, "a\nb\n", "a\nb"), "--- a/original\n+++ b/modified\n@@ -1,2 +1,2 @@\n a\n-b\n+b\n\\ No newline at end of file\n");
        assert.ok(compute("a\nb\n", "a\nb", { ignoreWhitespace: true }).identical);
    });
    (0, run_unit_tests_1.test)("random edits: every line appears once, in order, and patches apply exactly", () => {
        const rnd = random(4242);
        const vocab = ["a", "b", "}", "", "  return x;", "function f() {", "x = 1", "  foo();", "bar", "\tbaz"];
        for (let t = 0; t < 600; t++) {
            const a = Array.from({ length: Math.floor(rnd() * 20) }, () => vocab[Math.floor(rnd() * vocab.length)]);
            const b = a.slice();
            for (let k = Math.floor(rnd() * 6); k > 0; k--) {
                const p = Math.floor(rnd() * (b.length + 1)), op = rnd();
                if (op < 0.35)
                    b.splice(p, 1);
                else if (op < 0.7)
                    b.splice(p, 0, vocab[Math.floor(rnd() * vocab.length)]);
                else
                    b[p] = (b[p] ?? "") + "z";
            }
            const left = a.join("\n") + (a.length && rnd() < 0.8 ? "\n" : ""), right = b.join("\n") + (b.length && rnd() < 0.8 ? "\n" : "");
            const m = compute(left, right);
            const seenA = [], seenB = [];
            for (let r = 0; r < m.rows; r++) {
                if (m.ai[r] >= 0)
                    seenA.push(m.ai[r]);
                if (m.bi[r] >= 0)
                    seenB.push(m.bi[r]);
                if (m.kind[r] === E.KIND_EQUAL)
                    assert.strictEqual(lineOf(left, m.left, m.ai[r]), lineOf(right, m.right, m.bi[r]));
                if (m.pair[r] >= 0)
                    assert.strictEqual(m.pair[m.pair[r]], r, "pairs are symmetric");
            }
            assert.deepStrictEqual(seenA, [...Array(m.left.count).keys()]);
            assert.deepStrictEqual(seenB, [...Array(m.right.count).keys()]);
            assert.strictEqual(applyPatch(left, E.unifiedPatch(m, left, right)), right, `patch for ${JSON.stringify(left)} → ${JSON.stringify(right)}`);
        }
    });
    (0, run_unit_tests_1.test)("diffs are minimal (as few changed lines as possible)", () => {
        const rnd = random(99);
        const voc = "abcdefgh".split("");
        for (let t = 0; t < 400; t++) {
            const a = Array.from({ length: 30 }, () => voc[Math.floor(rnd() * voc.length)]);
            const b = a.slice();
            for (let k = 0; k < 6; k++) {
                const p = Math.floor(rnd() * b.length);
                if (rnd() < 0.5)
                    b.splice(p, 1);
                else
                    b.splice(p, 0, voc[Math.floor(rnd() * voc.length)]);
            }
            const m = compute(a.join("\n") + "\n", b.join("\n") + "\n");
            assert.strictEqual(m.stats.additions + m.stats.deletions, a.length + b.length - 2 * lcsLength(a, b));
        }
    });
    (0, run_unit_tests_1.test)("an inserted function reads naturally (blank line after it, not before)", () => {
        const before = "function a() {\n  return 1;\n}\n\nfunction c() {\n  return 3;\n}\n";
        const after = "function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n\nfunction c() {\n  return 3;\n}\n";
        const patch = E.unifiedPatch(compute(before, after), before, after);
        assert.ok(patch.includes("+function b() {\n+  return 2;\n+}\n+\n function c() {"), patch);
        const cls = E.unifiedPatch(compute("class X {\n  foo() {\n  }\n}\n", "class X {\n  foo() {\n  }\n  bar() {\n  }\n}\n"), "class X {\n  foo() {\n  }\n}\n", "class X {\n  foo() {\n  }\n  bar() {\n  }\n}\n");
        assert.ok(cls.includes("   }\n+  bar() {\n+  }\n }"), cls);
    });
    (0, run_unit_tests_1.test)("large files compare quickly and very different ones still finish", () => {
        const lines = Array.from({ length: 60000 }, (_, i) => `  const value${i} = compute(${i % 97}, "item-${i % 13}");`);
        const changed = lines.slice();
        const rnd = random(5);
        for (let i = 0; i < 600; i++) {
            const p = Math.floor(rnd() * changed.length);
            if (rnd() < 0.5)
                changed.splice(p, 1);
            else
                changed[p] += " // edited";
        }
        let t0 = Date.now();
        const m = compute(lines.join("\n"), changed.join("\n"), { language: "javascript" });
        assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
        assert.ok(!m.approximate && m.leftTokens && m.leftTokens.length > 0);
        const other = Array.from({ length: 20000 }, (_, i) => `other ${i * 7}`);
        t0 = Date.now();
        const d = compute(lines.slice(0, 20000).join("\n"), other.join("\n"), { timeoutMs: 3000 });
        assert.ok(Date.now() - t0 < 4000);
        assert.strictEqual(d.stats.deletions, 20000);
        assert.strictEqual(d.stats.additions, 20000);
    });
    (0, run_unit_tests_1.test)("word-level changes inside a modified line", () => {
        assert.deepStrictEqual(E.inlineDiff("const PORT = 3000;", "const PORT = 4000;"), { a: [13, 17], b: [13, 17] });
        const r = E.inlineDiff("return items[i].price * qty;", "return item.price * item.qty;");
        assert.ok(r.a.length > 0 && r.b.length > 0);
        assert.deepStrictEqual(E.inlineDiff("a  =  1", "a = 1", { ignoreWhitespace: true }), { a: [], b: [] });
        assert.deepStrictEqual(E.inlineDiff("SELECT x", "select x", { ignoreCase: true }), { a: [], b: [] });
    });
    (0, run_unit_tests_1.test)("rendered lines escape markup and nest change marks inside syntax spans correctly", () => {
        const line = 'const s = "<script>alert(1)</script>";';
        const html = E.lineHtml(line, 0, line.length, E.tokenize(line, "javascript"), [10, 20]);
        assert.ok(!html.includes("<script>"), html);
        assert.ok(html.includes("&lt;script&gt;"));
        assert.ok(html.startsWith('<span class="s-kw">const</span>'), html);
        assert.strictEqual((html.match(/<mark/g) || []).length, (html.match(/<\/mark>/g) || []).length);
        // Stripping the tags gives the original text back.
        const plain = html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
        assert.strictEqual(plain, line);
        assert.strictEqual(E.lineHtml("a & b", 0, 5, null, null), "a &amp; b");
    });
    (0, run_unit_tests_1.test)("syntax tokens follow comments and strings across lines", () => {
        const src = "/* one\n two */\nconst x = 1;";
        const t = E.tokenize(src, "typescript");
        assert.deepStrictEqual([t[0], t[1], t[2]], [0, 14, 1], "the block comment spans both lines");
        assert.ok(E.lineHtml(src, 7, 14, t, null).startsWith('<span class="s-com">'));
        assert.strictEqual(E.tokenize("plain words", "plaintext"), null);
    });
    (0, run_unit_tests_1.test)("detects the language from the file name, then the content", () => {
        const cases = [
            ["app.tsx", "", "jsx"], ["Dockerfile", "", "dockerfile"], [".env.local", "", "toml"], ["main.go", "", "go"], ["styles.scss", "", "css"],
            ["", "{\n  \"a\": 1\n}", "json"], ["", "def f(x):\n    return x\n", "python"], ["", "#!/bin/bash\necho hi", "shell"],
            ["", "import React from 'react';\nexport const A = () => null;", "javascript"], ["", "interface A { b: string }", "typescript"],
            ["", "SELECT id FROM users WHERE id = 1;", "sql"], ["", "<?xml version=\"1.0\"?><a/>", "xml"], ["", "just some notes", "plaintext"]
        ];
        for (const [name, text, expected] of cases)
            assert.strictEqual(E.detectLanguage(name, text), expected, `${name || text}`);
    });
    (0, run_unit_tests_1.test)("the worker can be built from the engine's own source", () => {
        const engine = vm.runInNewContext(`(${E.factorySource})()`, {});
        const m = engine.compute("a\nb\n", "a\nc\n", {});
        assert.strictEqual(m.stats.modified + m.stats.added, 1);
    });
});
(0, run_unit_tests_1.suite)("code diff: page and host", () => {
    (0, run_unit_tests_1.test)("renders a CSP-locked page that allows only a blob worker, with the engine loaded first", () => {
        const html = (0, page_1.renderCodeDiffPage)({ cspSource: "vscode-resource:", engineUri: "vscode-resource:/media/code-diff-engine.js", scriptUri: "vscode-resource:/media/code-diff.js", codiconsUri: "vscode-resource:/codicon.css", platform: "darwin", canSave: true, prefs: page_1.DEFAULT_PREFS, initial: { left: { name: "a</script>.js", text: "</script><script>alert(1)</script>" } } });
        const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
        assert.ok(/script-src 'nonce-[A-Za-z0-9]+';/.test(csp), csp);
        assert.ok(csp.includes("worker-src blob:"), csp);
        assert.ok(!csp.includes("unsafe"), csp);
        assert.ok(html.indexOf("code-diff-engine.js") < html.indexOf("code-diff.js\""), "engine before UI");
        assert.ok(!/ on[a-z]+="/i.test(html), "no inline event handlers");
        assert.ok(!html.includes("</script><script>alert"), "initial text cannot close the boot script");
        for (const file of ["code-diff.js", "code-diff-engine.js"]) {
            const source = fs.readFileSync(path.join(ROOT, "media", file), "utf8");
            assert.doesNotThrow(() => new vm.Script(source, { filename: file }));
            assert.ok(!/eval\(|new Function/.test(source), file);
        }
    });
    (0, run_unit_tests_1.test)("preferences from the page are validated", () => {
        assert.deepStrictEqual((0, page_1.sanitizePrefs)(undefined), page_1.DEFAULT_PREFS);
        const p = (0, page_1.sanitizePrefs)({ mode: "json", view: "unified", wrap: "yes", context: 999, tabSize: 2, arrayKey: "x".repeat(500), extra: 1 });
        assert.strictEqual(p.mode, "json");
        assert.strictEqual(p.view, "unified");
        assert.strictEqual(p.wrap, page_1.DEFAULT_PREFS.wrap);
        assert.strictEqual(p.context, page_1.DEFAULT_PREFS.context);
        assert.strictEqual(p.tabSize, 2);
        assert.strictEqual(p.arrayKey.length, 100);
        assert.ok(!("extra" in p));
    });
    (0, run_unit_tests_1.test)("JSON structure mode keeps the previous Diff Checker's behaviour", () => {
        const r = (0, panel_1.jsonDiff)('{"id": 7, "plan": {"seats": 5}, "roles": ["admin"]}', '{"plan": {"seats": "5"}, "id": 7, "roles": ["admin", "billing"], "active": true}', { ignoreArrayOrder: false, arrayKey: "" });
        assert.deepStrictEqual(r.counts, { added: 2, removed: 0, changed: 0, type: 1 });
        assert.ok(r.entries.some(e => e.kind === "type" && e.path === "$.plan.seats"));
        assert.deepStrictEqual((0, panel_1.jsonDiff)('{"a":1,"b":2}', '{"b":2,"a":1}', { ignoreArrayOrder: false, arrayKey: "" }).entries, []);
        assert.deepStrictEqual((0, panel_1.jsonDiff)("[1,2]", "[2,1]", { ignoreArrayOrder: true, arrayKey: "" }).entries, []);
        const bad = (0, panel_1.jsonDiff)('{"a": 1,\n "b": }', "{}", { ignoreArrayOrder: false, arrayKey: "" });
        assert.ok(bad.error && /Original is not valid JSON \(line 2, column 7/.test(bad.error), bad.error);
    });
    (0, run_unit_tests_1.test)("files decode as UTF-8 or UTF-16 and binaries are refused", () => {
        assert.strictEqual((0, panel_1.decodeText)(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])), "hi");
        assert.strictEqual((0, panel_1.decodeText)(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0])), "hi");
        assert.strictEqual((0, panel_1.decodeText)(new Uint8Array([0xfe, 0xff, 0, 0x68, 0, 0x69])), "hi");
        assert.throws(() => (0, panel_1.decodeText)(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), "logo.png"), /logo\.png looks like a binary file/);
    });
    (0, run_unit_tests_1.test)("is listed as Code Diff Checker, keeps its command id and works in the browser", () => {
        const entry = layout_1.NAV.flatMap(s => s.entries).find(e => e.command === "textDiff");
        assert.strictEqual(entry?.label, "Code Diff Checker");
        assert.ok(!commands_1.TOOLKIT_COMMANDS.some(c => c.command === "textDiff"), "no longer a form tool");
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
        const contributed = manifest.contributes.commands.find((c) => c.command === "sayaib.hue-console.textDiff");
        assert.strictEqual(contributed?.title, "📝 DevSnip Pro: Code Diff Checker");
        assert.ok((0, capabilities_1.isCommandSupported)("textDiff", true));
    });
});
//# sourceMappingURL=code-diff.unit.js.map