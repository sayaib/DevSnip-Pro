/**
 * Small dependency-free test runner for the extension's pure logic.
 *
 * These tests run in a plain Node process (no VS Code download, no display),
 * so they can run in CI and before every package. The VS Code integration
 * tests still live in src/test and run through `npm test`.
 */
import { installVscodeStub } from "./vscode-stub";

installVscodeStub();

type TestCase = { name: string; run: () => void | Promise<void> };

const tests: TestCase[] = [];
let currentSuite = "";

export function suite(name: string, body: () => void): void {
  currentSuite = name;
  body();
  currentSuite = "";
}

export function test(name: string, run: () => void | Promise<void>): void {
  tests.push({ name: currentSuite ? `${currentSuite} > ${name}` : name, run });
}

async function main(): Promise<void> {
  // Registering the suites has to happen after the stub is installed.
  /* eslint-disable @typescript-eslint/no-var-requires */
  require("./markdown.unit");
  require("./webview-ui.unit");
  require("./milestone.unit");
  require("./analysis.unit");
  require("./api-client.unit");
  /* eslint-enable @typescript-eslint/no-var-requires */

  let passed = 0;
  const failures: { name: string; error: unknown }[] = [];

  for (const testCase of tests) {
    try {
      await testCase.run();
      passed++;
      console.log(`  ok  ${testCase.name}`);
    } catch (error) {
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
