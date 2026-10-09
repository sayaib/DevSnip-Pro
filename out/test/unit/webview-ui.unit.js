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
const webview_ui_1 = require("../../utils/webview-ui");
const command_registry_1 = require("../../utils/command-registry");
const command_dispatch_1 = require("../../utils/command-dispatch");
const run_unit_tests_1 = require("./run-unit-tests");
(0, run_unit_tests_1.suite)("webview helpers", () => {
    (0, run_unit_tests_1.test)("escapeHtml neutralises every markup character", () => {
        assert.strictEqual((0, webview_ui_1.escapeHtml)(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;");
    });
    (0, run_unit_tests_1.test)("embedJson cannot terminate the surrounding script element", () => {
        const embedded = (0, webview_ui_1.embedJson)({ text: "</script><script>alert(1)</script>" });
        assert.ok(!embedded.includes("</script>"));
        assert.ok(embedded.includes("\\u003c"));
        // It still parses back to the original value.
        assert.strictEqual(JSON.parse(embedded).text, "</script><script>alert(1)</script>");
    });
    (0, run_unit_tests_1.test)("nonces are 32 characters and not reused", () => {
        const first = (0, webview_ui_1.getNonce)();
        const second = (0, webview_ui_1.getNonce)();
        assert.strictEqual(first.length, 32);
        assert.notStrictEqual(first, second);
    });
});
(0, run_unit_tests_1.suite)("command registry", () => {
    (0, run_unit_tests_1.test)("records usage exactly once per invocation", async () => {
        const recorded = [];
        (0, command_registry_1.setUsageRecorder)(command => recorded.push(command));
        let handlerCalls = 0;
        (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.unitTestCommand", () => { handlerCalls++; });
        const vscode = require("vscode");
        await vscode.commands.executeCommand("sayaib.hue-console.unitTestCommand");
        assert.strictEqual(handlerCalls, 1);
        assert.deepStrictEqual(recorded, ["sayaib.hue-console.unitTestCommand"]);
    });
    (0, run_unit_tests_1.test)("the milestone tracker itself does not award points", async () => {
        const recorded = [];
        (0, command_registry_1.setUsageRecorder)(command => recorded.push(command));
        (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.milestoneTracker", () => undefined);
        const vscode = require("vscode");
        await vscode.commands.executeCommand("sayaib.hue-console.milestoneTracker");
        assert.deepStrictEqual(recorded, []);
    });
    (0, run_unit_tests_1.test)("known commands are tracked and unknown ids are rejected", () => {
        assert.ok((0, command_registry_1.isKnownCommand)("sayaib.hue-console.unitTestCommand"));
        assert.ok(!(0, command_registry_1.isKnownCommand)("workbench.action.reloadWindow"));
        assert.ok(!(0, command_registry_1.isKnownCommand)(undefined));
        assert.ok((0, command_registry_1.knownCommands)().includes("sayaib.hue-console.unitTestCommand"));
    });
    (0, run_unit_tests_1.test)("a webview cannot dispatch a command the extension did not register", async () => {
        let dangerous = 0;
        const vscode = require("vscode");
        vscode.commands.registerCommand("workbench.action.reloadWindow", () => { dangerous++; });
        await (0, command_dispatch_1.executeQueuedCommand)("workbench.action.reloadWindow");
        await (0, command_dispatch_1.executeQueuedCommand)({ evil: true });
        assert.strictEqual(dangerous, 0, "unregistered commands must never be executed from a webview");
    });
    (0, run_unit_tests_1.test)("queued dispatch runs registered commands in order", async () => {
        const order = [];
        (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.queueA", async () => {
            await new Promise(resolve => setTimeout(resolve, 15));
            order.push("a");
        });
        (0, command_registry_1.registerTrackedCommand)("sayaib.hue-console.queueB", () => { order.push("b"); });
        (0, command_registry_1.setUsageRecorder)(() => undefined);
        const first = (0, command_dispatch_1.executeQueuedCommand)("sayaib.hue-console.queueA");
        const second = (0, command_dispatch_1.executeQueuedCommand)("sayaib.hue-console.queueB");
        await Promise.all([first, second]);
        assert.deepStrictEqual(order, ["a", "b"]);
    });
});
//# sourceMappingURL=webview-ui.unit.js.map