import * as assert from "assert";
import { suite, test } from "./run-unit-tests";

/**
 * Structural and accessibility invariants for the REST API Client page.
 *
 * These assert on the markup the extension host actually produces, so a future
 * edit that drops a label, desynchronises a tab's accessible state, or removes
 * the large-response guard fails the build rather than shipping.
 */

function renderClient(allowWebSockets = false): string {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { getWebviewContent } = require("../../commands/api-test");
  /* eslint-enable @typescript-eslint/no-var-requires */
  return getWebviewContent([], allowWebSockets) as string;
}

/** Crude element scan; enough to assert on attributes without a DOM library. */
function elementsWith(html: string, pattern: RegExp): string[] {
  return html.match(pattern) ?? [];
}

suite("REST API Client markup", () => {
  test("the core request controls are present", () => {
    const html = renderClient();
    for (const id of ["method", "url", "sendRequest", "cancelRequest", "responseOutput", "statusCode"]) {
      assert.ok(html.includes(`id="${id}"`), `the ${id} control is missing`);
    }
  });

  test("every tab exposes an accessible selected state", () => {
    const html = renderClient();
    const tabs = elementsWith(html, /<button[^>]*role="tab"[^>]*>/g);
    assert.ok(tabs.length >= 10, `expected the request and response tabs, found ${tabs.length}`);
    const missing = tabs.filter(tab => !/aria-selected="(true|false)"/.test(tab));
    assert.deepStrictEqual(missing, [], "these tabs have no aria-selected, so assistive tech cannot tell which is active");
  });

  test("every tab list is labelled and holds tabs", () => {
    const html = renderClient();
    const lists = elementsWith(html, /<div[^>]*role="tablist"[^>]*>/g);
    assert.ok(lists.length >= 3, `expected at least three tab lists, found ${lists.length}`);
    const unlabelled = lists.filter(list => !/aria-label="/.test(list));
    assert.deepStrictEqual(unlabelled, [], "a tab list needs an aria-label to be identifiable");
  });

  test("inputs are labelled for screen readers", () => {
    const html = renderClient();
    // Every text-like input carries either an aria-label or a matching <label>.
    const inputs = elementsWith(html, /<input[^>]*type="(?:text|search|number|password)"[^>]*>/g);
    const unlabelled = inputs.filter(input => {
      if (/aria-label="/.test(input)) return false;
      const id = /id="([^"]+)"/.exec(input)?.[1];
      return !(id && html.includes(`for="${id}"`));
    });
    assert.deepStrictEqual(unlabelled.map(i => i.slice(0, 60)), [], "these inputs have no accessible name");
  });

  test("the URL error hint is a live region the field can point at", () => {
    const html = renderClient();
    assert.ok(/id="urlError"[^>]*aria-live="polite"/.test(html), "the URL hint must announce itself when it changes");
    assert.ok(html.includes('aria-describedby'), "the URL field must be able to reference its hint");
    assert.ok(html.includes("aria-invalid"), "URL validity must be exposed, not only coloured");
  });

  test("status is conveyed with a glyph and text, never colour alone", () => {
    const html = renderClient();
    // The renderer prefixes the status with a check, warning or cross glyph.
    for (const [name, glyph] of [["check", "\u2713"], ["warning", "\u26A0"], ["cross", "\u2717"]]) {
      assert.ok(html.includes(glyph), `the status renderer is missing its ${name} indicator`);
    }
  });

  test("large responses are bounded so the panel stays responsive", () => {
    const html = renderClient();
    assert.ok(/HIGHLIGHT_CHAR_BUDGET\s*=\s*\d+/.test(html), "the response render budget is gone");
    assert.ok(html.includes("renderFullResponse"), "there must be a way to opt into rendering the whole payload");
  });

  test("tab lists support arrow-key navigation", () => {
    const html = renderClient();
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
      assert.ok(html.includes(key), `tab keyboard navigation is missing ${key}`);
    }
    assert.ok(html.includes("wireTabList"), "the tab list keyboard wiring is gone");
  });

  test("colours come from the VS Code theme rather than being hardcoded", () => {
    const html = renderClient();
    const styles = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    // Custom property declarations must resolve through the theme.
    const declarations = styles.match(/--[a-z0-9-]+\s*:\s*[^;]+;/gi) ?? [];
    const literal = declarations.filter(
      decl => /:\s*(#[0-9a-f]{3,8}|rgb|hsl)/i.test(decl) && !/var\(--vscode/.test(decl)
    );
    assert.deepStrictEqual(
      literal.map(d => d.trim()),
      [],
      "these palette entries ignore the VS Code theme and will look wrong in light or high-contrast themes"
    );
  });

  test("empty states explain what to do instead of showing a blank panel", () => {
    const html = renderClient();
    assert.ok(html.includes("No response yet"), "the response panel needs an empty state");
    assert.ok(/Configure your request/.test(html), "the empty state should say what to do next");
  });

  test("the WebSocket allowance still tracks entitlement", () => {
    assert.ok(!/connect-src/.test(renderClient(false)), "a free page must not be allowed to open a socket");
    assert.ok(/connect-src ws: wss:/.test(renderClient(true)), "an entitled page needs the allowance");
  });
});
