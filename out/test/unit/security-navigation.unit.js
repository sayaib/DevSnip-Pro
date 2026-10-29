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
const vm = __importStar(require("vm"));
const securityTools_1 = require("../../commands/securityTools");
const run_unit_tests_1 = require("./run-unit-tests");
class Element {
    constructor() {
        this.children = [];
        this.listeners = new Map();
        this.classList = { add: (_value) => undefined };
    }
    appendChild(child) { this.children.push(child); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
}
(0, run_unit_tests_1.suite)("security finding navigation", () => {
    (0, run_unit_tests_1.test)("row and Open button send the source location without double dispatch", () => {
        const html = (0, securityTools_1.securityHubHtml)("test", { url: "", timeoutMs: 1000, activeChecks: false });
        const start = html.indexOf("function resultNode(");
        const end = html.indexOf("/* ---- host messages ---- */", start);
        assert.ok(start > 0 && end > start);
        const messages = [];
        let selection = "";
        const context = vm.createContext({
            document: { createElement: () => new Element() },
            window: { getSelection: () => ({ toString: () => selection }) },
            vscode: { postMessage: (value) => messages.push(value) },
            STATUS_META: { fail: { klass: "fail", label: "Fail" } }
        });
        vm.runInContext(html.slice(start, end), context);
        const check = { title: "Unsafe code", detail: "Fix this", status: "fail", location: { file: "src/app.ts", line: 7 }, resource: "file:///workspace/src/app.ts" };
        context.check = check;
        const row = vm.runInContext("resultNode('workspace', check)", context);
        const click = (interactive) => row.listeners.get("click")({ target: { closest: () => interactive } });
        click(false);
        assert.strictEqual(messages.length, 1);
        assert.strictEqual(JSON.stringify(messages[0]), JSON.stringify({ type: "openLocation", file: "src/app.ts", line: 7, resource: check.resource }));
        selection = "selected evidence";
        click(false);
        assert.strictEqual(messages.length, 1, "selecting evidence must not switch editors");
        selection = "";
        const body = row.children[row.children.length - 1];
        body.children[body.children.length - 1].listeners.get("click")({});
        click(true); // the button click bubbles to the row
        assert.strictEqual(messages.length, 2);
    });
});
//# sourceMappingURL=security-navigation.unit.js.map