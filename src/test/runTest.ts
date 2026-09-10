import * as path from "path";
import { runTests } from "vscode-test";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  try {
    await runTests({ extensionDevelopmentPath, extensionTestsPath });
  } catch (error) {
    console.error("VS Code extension tests failed:", error);
    process.exitCode = 1;
  }
}

void main();
