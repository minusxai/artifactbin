import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { precompressFile } from './precompress.mjs';
import {removeRetiredLibraryOutput} from './library-output.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** @typedef {{package:string,version:string,entry:string,bundledPackages?:Record<string,string>,aliases?:Record<string,{package:string,version:string}>}} LibrarySpec */
/** @type {Record<string, LibrarySpec>} */
const registry = JSON.parse(readFileSync(path.join(root, 'lib/libraries/registry.json'), 'utf8'));
const require = createRequire(import.meta.url);
// Remove the exact retired platform runtime even on incremental builds.
removeRetiredLibraryOutput(path.join(root,'public/libraries'));

// These packages are bundled here; production serves only the emitted modules.
const packageSpec = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
// Some libraries also power server SVG rendering; those retain their runtime pin.
const dependencies = {...packageSpec.dependencies,...packageSpec.devDependencies};
for (const [name, spec] of Object.entries(registry)) {
  if (dependencies[spec.package] !== spec.version) throw new Error(`${name}: registry and dependency versions must match`);
  for(const [dependency,version] of Object.entries(spec.bundledPackages ?? {})) {
    if(dependencies[dependency] !== version) throw new Error(`${name}: bundled dependency versions must match`);
  }
  const alias = {};
  for(const [source,target] of Object.entries(spec.aliases ?? {})) {
    // Pinned VL imports exactly four utility reexports from Vega. Redirect those
    // to the same pinned utility package, avoiding Vega's transform-registration
    // side effects and a second full rendering runtime inside the compiler.
    if(name!=='vega-lite' || spec.package!=='vega-lite' || spec.version!=='6.4.3' || source!=='vega' || target.package!=='vega-util' || target.version!=='2.1.3') throw new Error(`${name}: unsupported library alias`);
    const packageFile=path.resolve(path.dirname(require.resolve(target.package)),'../package.json');
    if(JSON.parse(readFileSync(packageFile,'utf8')).version!==target.version) throw new Error(`${name}: alias dependency version must match`);
    alias[source]=target.package;
  }
  // The wrapper and its complete dependency graph ship as one browser module.
  // No registry entry is imported by the document runtime itself.
  const outfile = path.join(root, 'public/libraries', `${name}-${spec.version}`, 'index.js');
  await esbuild.build({
    entryPoints: [path.join(root, 'lib/libraries', spec.entry)],
    outfile,
    bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'info',
    alias,
  });
  // Version-addressed, not content-addressed: the siblings are rewritten with the file, every build.
  await precompressFile(outfile);
}
