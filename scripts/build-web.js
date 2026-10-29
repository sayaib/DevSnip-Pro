const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { builtinModules } = require('module');
const root = path.resolve(__dirname, '..');
const aliases = new Map([
  ['src/toolkits/desktop.ts', 'src/web/desktop-tools.ts'],
  ['src/platform/random.ts', 'src/web/random.ts'],
  ['src/platform/oauth.ts', 'src/web/oauth.ts'],
  ['src/platform/network.ts', 'src/web/network.ts'],
  ['src/analytics/index.ts', 'src/web/analytics.ts']
].map(([a,b]) => [path.join(root,a), path.join(root,b)]));
const boundaries = {
  name: 'browser-boundaries',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'buffer') return { path: require.resolve('buffer/') };
      if (builtinModules.includes(args.path) || args.path.startsWith('node:')) {
        // Unused Node-only exports can be removed, but any surviving import fails the build below.
        return { path: args.path, external: true, sideEffects: false };
      }
      if (!args.path.startsWith('.')) return;
      const candidate = path.resolve(args.resolveDir, args.path);
      const target = aliases.get(candidate + '.ts') || aliases.get(path.join(candidate, 'index.ts'));
      if (target) return { path: target };
    });
  }
};
async function bundle(entry, outfile) {
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, platform: 'browser', format: 'cjs', target: 'es2020',
    external: ['vscode'], inject: ['src/web/buffer.ts'], plugins: [boundaries], minify: true, metafile: true, write: false
  });
  for (const output of Object.values(result.metafile.outputs)) {
    const forbidden = output.imports.filter(i => i.external && i.path !== 'vscode');
    if (forbidden.length) throw new Error(`Web bundle contains runtime dependencies: ${forbidden.map(i=>i.path).join(', ')}`);
  }
  for (const output of result.outputFiles) { fs.mkdirSync(path.dirname(output.path), {recursive:true}); fs.writeFileSync(output.path, output.contents); }
  return result;
}
module.exports = { bundle };
if (require.main === module) bundle('src/web/extension.ts', 'out/browser/extension.js').then(result => {
  const output = result.outputFiles[0];
  console.log(`Browser extension: ${(output.contents.length / 1024).toFixed(0)} KiB; only vscode remains external.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
