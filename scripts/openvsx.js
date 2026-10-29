#!/usr/bin/env node
// Prepare the same universal VSIX for both registries; publication is explicit.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const manifest = require(path.join(root, 'package.json'));
const registry = 'https://open-vsx.org';
const artifact = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
function cli(packageName, binary) {
  const metadata = require.resolve(`${packageName}/package.json`);
  const pkg = require(metadata);
  const target = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[binary];
  return path.resolve(path.dirname(metadata), target);
}
function run(binary, args) {
  const result = spawnSync(process.execPath, [binary, ...args], { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Release command failed (${result.status ?? result.signal}).`);
}
function main() {
  const mode = process.argv[2];
  if (!['prepare', 'publish'].includes(mode)) throw new Error('Use npm run package:openvsx or npm run publish:openvsx.');
  if (mode === 'publish' && !process.env.OVSX_PAT?.trim()) {
    throw new Error('OVSX_PAT is not configured. Set an Open VSX publisher token in your environment; do not put it in package.json or pass it on the command line. See docs/OPEN_VSX.md.');
  }
  if (!manifest.browser || !manifest.main) throw new Error('The release must contain Desktop and browser entry points.');
  if (mode === 'publish') {
    // Check access before building, using the environment token (never an argv value).
    run(cli('ovsx', 'ovsx'), ['--registryUrl', registry, 'verify-pat', manifest.publisher]);
  }
  run(cli('@vscode/vsce', 'vsce'), ['package', '--out', artifact]);
  for (const entry of [manifest.main, manifest.browser]) if (!fs.existsSync(path.resolve(root, entry))) throw new Error(`Missing runtime entry point: ${entry}`);
  console.log(`Prepared ${path.basename(artifact)} for ${manifest.publisher}.${manifest.name} on ${registry}.`);
  if (mode === 'publish') run(cli('ovsx', 'ovsx'), ['--registryUrl', registry, 'publish', artifact]);
  else console.log('Nothing uploaded. Run npm run publish:openvsx when your Open VSX publisher account is configured.');
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
