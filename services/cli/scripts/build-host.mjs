/** CI build boundary: reuse the application build and ESM server bundler, then gather runtime files. */
import {buildPreview} from './build-preview.mjs';
import {execFileSync} from 'node:child_process';
import {cp,mkdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(cli,'../..');
const runtime=join(cli,'dist/runtime'),app=join(repo,'services/app');
execFileSync(process.execPath,[process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'run','build','-w','services/app'],{cwd:repo,stdio:'inherit'});
await rm(runtime,{recursive:true,force:true});await mkdir(runtime,{recursive:true});
execFileSync(process.execPath,[join(repo,'scripts/build/build-server.mjs'),join(runtime,'host.mjs'),join(cli,'src/team-entry.ts'),'sharp','--remote-runner'],{cwd:repo,stdio:'inherit'});
execFileSync(process.execPath,[join(repo,'scripts/build/build-server.mjs'),join(runtime,'preview.mjs'),join(cli,'src/preview-entry.ts'),'sharp','--remote-runner'],{cwd:repo,stdio:'inherit'});
await buildPreview(join(runtime,'preview'));
for(const name of ['public','skills','orchestrator','lib/build-assets','dist/web','package.json']){
 await mkdir(dirname(join(runtime,name)),{recursive:true});await cp(join(app,name),join(runtime,name),{recursive:true});
}
await writeFile(join(runtime,'bootstrap.cjs'),"exports.html=(options,assets)=>import('./preview.mjs').then(host=>host.exportLocalHtml(options,assets));\nexports.image=(options,assets)=>import('./preview.mjs').then(host=>host.exportPreviewImage(options,assets));\nexports.preview=(options,assets)=>import('./preview.mjs').then(host=>host.startPreviewHost(options,assets));\nexports.team=(config,assets,overrides)=>import('./host.mjs').then(host=>host.startTeamHost(config,assets,overrides));\n");
// npm resolves platform-specific optional dependencies on the consumer machine.
// Never embed build-machine node_modules in the universal npm tarball.
console.log('Host runtime assets prepared; execution dependencies are owned by the npm package.');
