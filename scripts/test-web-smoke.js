const assert = require('assert/strict');
const vm = require('vm');
const fs = require('fs');
const { webcrypto } = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
const { bundle } = require('./build-web');
async function main() {
  const output = 'out/test/web-smoke.js';
  await bundle('src/test/web/smoke.ts', output);
  // VS Code is the only host import. No Node globals are supplied to the extension.
  const api = require('../out/test/unit/vscode-shim');
  const { createExtensionContext } = require('../out/test/unit/vscode-stub');
  const vscode = api.default || api;
  const disposable = () => ({dispose() {}});
  vscode.window.onDidChangeActiveTextEditor = disposable;
  vscode.window.registerWebviewViewProvider = disposable;
  const sandbox = { module: { exports: {} }, console, crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, Uint8Array, ArrayBuffer, DataView,
    require(name) { assert.equal(name, 'vscode', 'Unexpected browser runtime dependency'); return vscode; } };
  vm.runInNewContext(fs.readFileSync(output, 'utf8'), sandbox, {filename: output, timeout: 10000});
  const test = sandbox.module.exports;
  const context = createExtensionContext();
  context.extension = {packageJSON: require('../package.json')};
  context.extensionUri = vscode.Uri.parse('https://example.invalid/extensions/devsnip');
  context.globalState.update('devsnip.web.lastVersion', context.extension.packageJSON.version);
  await test.activate(context);
  const result = await test.runBrowserTools();
  const registered = test.knownCommands();
  for (const id of ['openGUI','databaseClient','dependencyManager','networkTools','jwtDecoder','hashGenerator','certInspector','llmTester','csvViewer']) assert(!registered.includes('sayaib.hue-console.'+id), `Desktop command registered: ${id}`);
  for (const section of test.navigationFor(true)) for (const entry of section.entries) assert(registered.includes('sayaib.hue-console.'+entry.command), `Unregistered visible command: ${entry.command}`);
  for (const c of require('../package.json').contributes.commands) if (!registered.includes(c.command)) assert(c.enablement?.includes('!isWeb'), `Desktop command not gated in manifest: ${c.command}`);
  assert.equal(test.createToolContext(context).network, undefined);
  assert.equal(test.buildMilestoneView(context).spend.total, 0);
  vscode.workspace.fs = { isWritableFileSystem: scheme => !['github1s', 'gitlab1s'].includes(scheme) };
  for (const scheme of ['github1s', 'gitlab1s']) {
    const uri = { scheme, path: '/repo/file.js' };
    const caps = test.outputCapabilities({ document: { uri } }, uri);
    assert(!caps.writeWorkspace && !caps.insert && !caps.saveAs, `Read-only capabilities failed: ${scheme}`);
  }
  const writable = { scheme: 'vscode-test-web', path: '/repo' };
  assert(test.outputCapabilities(undefined, writable).writeWorkspace);
  assert(test.outputCapabilities(undefined, writable).saveAs);
  test.deactivate();
  context.subscriptions.forEach(s => s.dispose());
  console.log(`Browser sandbox passed: ${result.tools} tools, ${result.variants} defaults/presets/select variants; activation, navigation, manifest and dashboard checked without Node globals.`);
}
main().catch(error => {console.error(error); process.exitCode=1;});
