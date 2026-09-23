"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.test = exports.suite = void 0;
/**
 * Small dependency-free test runner for the extension's pure logic.
 *
 * These tests run in a plain Node process (no VS Code download, no display),
 * so they can run in CI and before every package. The VS Code integration
 * tests still live in src/test and run through `npm test`.
 */
const vscode_stub_1 = require("./vscode-stub");
(0, vscode_stub_1.installVscodeStub)();
const tests = [];
let currentSuite = "";
function suite(name, body) {
    currentSuite = name;
    body();
    currentSuite = "";
}
exports.suite = suite;
function test(name, run) {
    tests.push({ name: currentSuite ? `${currentSuite} > ${name}` : name, run });
}
exports.test = test;
async function main() {
    // Registering the suites has to happen after the stub is installed.
    /* eslint-disable @typescript-eslint/no-var-requires */
    require("./markdown.unit");
    require("./webview-ui.unit");
    require("./milestone.unit");
    require("./analysis.unit");
    require("./api-client.unit");
    require("./premium.unit");
    require("./feature-services.unit");
    require("./webview-scripts.unit");
    require("./api-client-ui.unit");
    require("./security.unit");
    /* eslint-enable @typescript-eslint/no-var-requires */
    let passed = 0;
    const failures = [];
    for (const testCase of tests) {
        try {
            await testCase.run();
            passed++;
            console.log(`  ok  ${testCase.name}`);
        }
        catch (error) {
            failures.push({ name: testCase.name, error });
            console.log(`  FAIL ${testCase.name}`);
        }
    }
    console.log(`\n${passed}/${tests.length} unit tests passed.`);
    if (failures.length) {
        for (const failure of failures) {
            console.error(`\n${failure.name}\n${failure.error instanceof Error ? failure.error.stack : String(failure.error)}`);
        }
        process.exitCode = 1;
    }
}
void main();
//# sourceMappingURL=run-unit-tests.js.map