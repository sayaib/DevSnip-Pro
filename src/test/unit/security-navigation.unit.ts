import * as assert from "assert";
import * as vm from "vm";
import { securityHubHtml } from "../../commands/securityTools";
import { suite, test } from "./run-unit-tests";

class Element {
  children: Element[] = [];
  listeners = new Map<string, (event: unknown) => void>();
  classList = { add: (_value: string) => undefined };
  appendChild(child: Element) { this.children.push(child); }
  addEventListener(type: string, handler: (event: unknown) => void) { this.listeners.set(type, handler); }
}

suite("security finding navigation", () => {
  test("row and Open button send the source location without double dispatch", () => {
    const html = securityHubHtml("test", { url: "", timeoutMs: 1000, activeChecks: false });
    const start = html.indexOf("function resultNode(");
    const end = html.indexOf("/* ---- host messages ---- */", start);
    assert.ok(start > 0 && end > start);
    const messages: unknown[] = [];
    let selection = "";
    const context = vm.createContext({
      document: { createElement: () => new Element() },
      window: { getSelection: () => ({ toString: () => selection }) },
      vscode: { postMessage: (value: unknown) => messages.push(value) },
      STATUS_META: { fail: { klass: "fail", label: "Fail" } }
    });
    vm.runInContext(html.slice(start, end), context);
    const check = { title: "Unsafe code", detail: "Fix this", status: "fail", location: { file: "src/app.ts", line: 7 }, resource: "file:///workspace/src/app.ts" };
    context.check = check;
    const row = vm.runInContext("resultNode('workspace', check)", context) as Element;
    const click = (interactive: boolean) => row.listeners.get("click")!({ target: { closest: () => interactive } });
    click(false);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(JSON.stringify(messages[0]), JSON.stringify({ type: "openLocation", file: "src/app.ts", line: 7, resource: check.resource }));
    selection = "selected evidence";
    click(false);
    assert.strictEqual(messages.length, 1, "selecting evidence must not switch editors");
    selection = "";
    const body = row.children[row.children.length - 1];
    body.children[body.children.length - 1].listeners.get("click")!({});
    click(true); // the button click bubbles to the row
    assert.strictEqual(messages.length, 2);
  });
});
