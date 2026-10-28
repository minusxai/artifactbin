#!/usr/bin/env node
/**
 * The hosted-agent runtime as one ESM file, dist/index.mjs: what a compute job's image copies and imports.
 * Everything but node-pty is inside it; node-pty is native and resolves from the image's own node_modules.
 *
 *   node services/hosted-agent/scripts/build.mjs [--outfile <path>]
 */
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const at=process.argv.indexOf('--outfile');
const outfile=at>0?process.argv[at+1]:'dist/index.mjs';
await build({
 entryPoints:['src/index.ts'],absWorkingDir:root,outfile,bundle:true,platform:'node',format:'esm',target:'node22',
 external:['node-pty'],
 banner:{js:"import {createRequire as __hostedAgentCreateRequire} from 'node:module'; const require=__hostedAgentCreateRequire(import.meta.url);"},
});
console.log(`hosted-agent: wrote ${outfile}`);
