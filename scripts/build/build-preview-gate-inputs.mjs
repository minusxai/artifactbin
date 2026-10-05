/** CI gate boundary: build only the packaged preview runtime, reusing the already-built app assets. */
import {execFileSync} from 'node:child_process';
import {cp,mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPreview} from '../../services/cli/scripts/build-preview.mjs';

const repo=join(dirname(fileURLToPath(import.meta.url)),'../..');
const cli=join(repo,'services/cli'),app=join(repo,'services/app'),runtime=join(cli,'dist/runtime');
await mkdir(runtime,{recursive:true});
execFileSync(process.execPath,[join(repo,'scripts/build/build-server.mjs'),join(runtime,'preview.mjs'),join(cli,'src/preview-entry.ts'),'sharp','--remote-runner'],{cwd:repo,stdio:'inherit'});
await buildPreview(join(runtime,'preview'));
for(const name of ['public','lib/build-assets','package.json']){
  await mkdir(dirname(join(runtime,name)),{recursive:true});
  await cp(join(app,name),join(runtime,name),{recursive:true});
}
await writeFile(join(runtime,'bootstrap.cjs'),"exports.preview=(options,assets)=>import('./preview.mjs').then(host=>host.startPreviewHost(options,assets));\n");
