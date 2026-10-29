import * as assert from "assert";
import { embedJson, escapeHtml, getNonce, safePostMessage, setToolPanelLogo, openToolPanel, disposeAllToolPanels } from "../../utils/webview-ui";
import { isKnownCommand, knownCommands, registerTrackedCommand, setUsageRecorder } from "../../utils/command-registry";
import { executeQueuedCommand } from "../../utils/command-dispatch";
import { suite, test } from "./run-unit-tests";

suite("webview helpers", () => {
  test("escapeHtml neutralises every markup character", () => {
    assert.strictEqual(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;");
  });

  test("embedJson cannot terminate the surrounding script element", () => {
    const embedded = embedJson({ text: "</script><script>alert(1)</script>" });
    assert.ok(!embedded.includes("</script>"));
    assert.ok(embedded.includes("\\u003c"));
    // It still parses back to the original value.
    assert.strictEqual(JSON.parse(embedded).text, "</script><script>alert(1)</script>");
  });

  test("webview delivery handles asynchronous rejection without an unhandled promise", async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const panel = { webview: { postMessage: () => Promise.reject(new Error("closed transport")) } };
      safePostMessage(panel as unknown as import("vscode").WebviewPanel, { type: "result" });
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(warnings.length, 1);
    } finally { console.warn = warn; }
  });

  test("every shared tool tab receives the brand logo, including reused tabs", () => {
    const vscode = require("vscode");
    const original = vscode.window.createWebviewPanel;
    const callbacks: Array<() => void> = [];
    vscode.window.createWebviewPanel = () => ({
      iconPath: undefined,
      reveal() {},
      onDidDispose(callback: () => void) { callbacks.push(callback); },
      dispose() { callbacks.forEach(callback => callback()); }
    });
    try {
      setToolPanelLogo(vscode.Uri.file("/extension"));
      const first = openToolPanel("logo-test", "Test", {});
      assert.ok(first.panel.iconPath);
      assert.match(String(first.panel.iconPath), /logo\.png$/);
      assert.strictEqual(openToolPanel("logo-test", "Test", {}).panel, first.panel);
      const second = openToolPanel("logo-test-second", "Test", {});
      assert.strictEqual(second.panel.iconPath, first.panel.iconPath);
    } finally {
      disposeAllToolPanels();
      vscode.window.createWebviewPanel = original;
    }
  });

  test("nonces are 32 characters and not reused", () => {
    const first = getNonce();
    const second = getNonce();
    assert.match(first, /^[a-f0-9]{32}$/);
    assert.strictEqual(first.length, 32);
    assert.notStrictEqual(first, second);
  });
});

suite("command registry", () => {
  test("records usage exactly once per invocation", async () => {
    const recorded: string[] = [];
    setUsageRecorder(command => recorded.push(command));

    let handlerCalls = 0;
    registerTrackedCommand("sayaib.hue-console.unitTestCommand", () => { handlerCalls++; });

    const vscode = require("vscode");
    await vscode.commands.executeCommand("sayaib.hue-console.unitTestCommand");

    assert.strictEqual(handlerCalls, 1);
    assert.deepStrictEqual(recorded, ["sayaib.hue-console.unitTestCommand"]);
  });

  test("the milestone tracker itself does not award points", async () => {
    const recorded: string[] = [];
    setUsageRecorder(command => recorded.push(command));
    registerTrackedCommand("sayaib.hue-console.milestoneTracker", () => undefined);

    const vscode = require("vscode");
    await vscode.commands.executeCommand("sayaib.hue-console.milestoneTracker");
    assert.deepStrictEqual(recorded, []);
  });

  test("known commands are tracked and unknown ids are rejected", () => {
    assert.ok(isKnownCommand("sayaib.hue-console.unitTestCommand"));
    assert.ok(!isKnownCommand("workbench.action.reloadWindow"));
    assert.ok(!isKnownCommand(undefined));
    assert.ok(knownCommands().includes("sayaib.hue-console.unitTestCommand"));
  });

  test("a webview cannot dispatch a command the extension did not register", async () => {
    let dangerous = 0;
    const vscode = require("vscode");
    vscode.commands.registerCommand("workbench.action.reloadWindow", () => { dangerous++; });

    await executeQueuedCommand("workbench.action.reloadWindow");
    await executeQueuedCommand({ evil: true });

    assert.strictEqual(dangerous, 0, "unregistered commands must never be executed from a webview");
  });

  test("queued dispatch runs registered commands in order", async () => {
    const order: string[] = [];
    registerTrackedCommand("sayaib.hue-console.queueA", async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      order.push("a");
    });
    registerTrackedCommand("sayaib.hue-console.queueB", () => { order.push("b"); });

    setUsageRecorder(() => undefined);
    const first = executeQueuedCommand("sayaib.hue-console.queueA");
    const second = executeQueuedCommand("sayaib.hue-console.queueB");
    await Promise.all([first, second]);

    assert.deepStrictEqual(order, ["a", "b"]);
  });
});
