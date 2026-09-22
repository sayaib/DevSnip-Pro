import * as assert from "assert";
import { renderMarkdown } from "../../utils/markdown";
import { suite, test } from "./run-unit-tests";

suite("markdown renderer", () => {
  test("renders headings, emphasis and inline code", () => {
    const html = renderMarkdown("# Title\n\nSome **bold** and *italic* and `code`.");
    assert.ok(html.includes("<h1>Title</h1>"));
    assert.ok(html.includes("<strong>bold</strong>"));
    assert.ok(html.includes("<em>italic</em>"));
    assert.ok(html.includes("<code>code</code>"));
  });

  test("escapes raw HTML so README content cannot execute", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>');
    assert.ok(!html.includes("<img"));
    assert.ok(!html.includes("<script"));
    assert.ok(html.includes("&lt;img"));
    assert.ok(html.includes("&lt;script"));
  });

  test("drops javascript: links but keeps https links", () => {
    const html = renderMarkdown("[bad](javascript:alert(1)) [good](https://example.com)");
    assert.ok(!html.includes('href="javascript'));
    assert.ok(html.includes('<a href="https://example.com">good</a>'));
  });

  test("keeps code fences verbatim and escaped", () => {
    const html = renderMarkdown('```js\nconsole.log("<b>hi</b>");\n```');
    assert.ok(html.includes('<pre><code class="language-js">'));
    assert.ok(html.includes("&lt;b&gt;hi&lt;/b&gt;"));
  });

  test("renders tables, task lists and blockquotes", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n> quoted");
    assert.ok(html.includes("<table>") && html.includes("<th>a</th>") && html.includes("<td>2</td>"));
    assert.ok(html.includes('<input type="checkbox" disabled checked>'));
    assert.ok(html.includes("<blockquote>"));
  });

  test("handles empty and non-string input without throwing", () => {
    assert.strictEqual(renderMarkdown(""), "");
    assert.doesNotThrow(() => renderMarkdown(undefined as unknown as string));
  });
});
