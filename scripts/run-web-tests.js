const path = require('path');
const fs = require('fs');
const { bundle } = require('./build-web');
const { runTests } = require('@vscode/test-web');
async function main() {
  const root = path.resolve(__dirname, '..');
  const developmentRoot = process.env.DEVSNIP_TEST_EXTENSION_PATH || root;
  const tests = path.join(developmentRoot, 'out/test/web/extension-tests.js');
  await bundle('src/test/web/smoke.ts', tests);
  const fixture = path.join(root, '.vscode-test-web/workspace');
  fs.mkdirSync(fixture, {recursive:true});
  await runTests({ browserType: process.env.DEVSNIP_TEST_BROWSER || 'chromium', quality: 'stable', commit: process.env.DEVSNIP_VSCODE_COMMIT, headless: true,
    extensionDevelopmentPath: developmentRoot, extensionTestsPath: tests, folderPath: fixture,
    testRunnerDataDir: path.join(root, '.vscode-test-web'), port: 3017 });
}
main().catch(error => {console.error(error); process.exitCode=1;});
