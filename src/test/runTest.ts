import * as path from "path";
import { runTests } from "@vscode/test-electron";

/**
 * Downloads (or reuses) a VS Code build and runs the integration suite inside
 * it. The previous `vscode-test` package looked for an `Electron` binary that
 * current VS Code builds no longer ship, so the suite never actually started.
 */
async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // Other installed extensions must not interfere with the results.
      // A workspace folder is required by the audit and workspace-scan suites.
      launchArgs: [path.resolve(__dirname, "../../.vscode-test/workspace"), "--disable-extensions", "--disable-gpu"]
    });
  } catch (error) {
    console.error("VS Code extension tests failed:", error);
    process.exitCode = 1;
  }
}

void main();
