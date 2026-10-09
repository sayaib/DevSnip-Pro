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
const markdown_1 = require("../../utils/markdown");
const run_unit_tests_1 = require("./run-unit-tests");
(0, run_unit_tests_1.suite)("markdown renderer", () => {
    (0, run_unit_tests_1.test)("renders headings, emphasis and inline code", () => {
        const html = (0, markdown_1.renderMarkdown)("# Title\n\nSome **bold** and *italic* and `code`.");
        assert.ok(html.includes("<h1>Title</h1>"));
        assert.ok(html.includes("<strong>bold</strong>"));
        assert.ok(html.includes("<em>italic</em>"));
        assert.ok(html.includes("<code>code</code>"));
    });
    (0, run_unit_tests_1.test)("escapes raw HTML so README content cannot execute", () => {
        const html = (0, markdown_1.renderMarkdown)('<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>');
        assert.ok(!html.includes("<img"));
        assert.ok(!html.includes("<script"));
        assert.ok(html.includes("&lt;img"));
        assert.ok(html.includes("&lt;script"));
    });
    (0, run_unit_tests_1.test)("drops javascript: links but keeps https links", () => {
        const html = (0, markdown_1.renderMarkdown)("[bad](javascript:alert(1)) [good](https://example.com)");
        assert.ok(!html.includes('href="javascript'));
        assert.ok(html.includes('<a href="https://example.com">good</a>'));
    });
    (0, run_unit_tests_1.test)("keeps code fences verbatim and escaped", () => {
        const html = (0, markdown_1.renderMarkdown)('```js\nconsole.log("<b>hi</b>");\n```');
        assert.ok(html.includes('<pre><code class="language-js">'));
        assert.ok(html.includes("&lt;b&gt;hi&lt;/b&gt;"));
    });
    (0, run_unit_tests_1.test)("renders tables, task lists and blockquotes", () => {
        const html = (0, markdown_1.renderMarkdown)("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n> quoted");
        assert.ok(html.includes("<table>") && html.includes("<th>a</th>") && html.includes("<td>2</td>"));
        assert.ok(html.includes('<input type="checkbox" disabled checked>'));
        assert.ok(html.includes("<blockquote>"));
    });
    (0, run_unit_tests_1.test)("handles empty and non-string input without throwing", () => {
        assert.strictEqual((0, markdown_1.renderMarkdown)(""), "");
        assert.doesNotThrow(() => (0, markdown_1.renderMarkdown)(undefined));
    });
});
//# sourceMappingURL=markdown.unit.js.map