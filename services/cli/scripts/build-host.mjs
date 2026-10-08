/** CI build boundary: reuse the application build and ESM server bundler, then gather runtime files. */
import {buildPreview} from './build-preview.mjs';
import {execFileSync} from 'node:child_process';
import {access,cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(cli,'../..');
const runtime=join(cli,'dist/runtime'),app=join(repo,'services/app');
/** Package the current reader graph without carrying deployment history into
 * each fresh npm consumer. The app's immutable public assets remain untouched. */
export async function copyRuntimePublic(source,destination){
 const manifest=JSON.parse(await readFile(join(source,'islands/manifest.json'),'utf8'));
 if(!manifest.manifest||!manifest.files||!manifest.ssr?.url||!manifest.offline||!manifest.sqliteWasm)throw Error('CLI reader package needs a complete current manifest');
 const graph=new Set(Object.keys(manifest.files));
 if(!graph.size||!Object.keys(manifest.manifest).length)throw Error('CLI reader package needs a nonempty current graph');
 for(const url of Object.values(manifest.manifest)){
  if(!graph.has(url))throw Error(`CLI reader entry is missing from the current graph: ${url}`);
 }
 for(const [url,file] of Object.entries(manifest.files)){
  for(const imported of file.imports??[]){
   if(!graph.has(imported))throw Error(`CLI reader import is missing from the current graph: ${url} -> ${imported}`);
  }
 }
 const current=new Set([...graph,...Object.values(manifest.manifest),manifest.ssr.url,manifest.offline,manifest.sqliteWasm]);
 const allowed=new Set(['islands','islands/manifest.json','islands/manifest.json.gz','islands/manifest.json.br']);
 for(const url of current){
  if(typeof url!=='string'||!/^\/islands\/[\w-]+\.(?:js|wasm|json\.gzip)$/.test(url))throw Error(`Invalid CLI reader asset path: ${url}`);
  const name=url.slice(1);
  try{await access(join(source,name));}catch{throw Error(`CLI reader asset is missing: ${url}`);}
  for(const suffix of ['', '.gz', '.br'])allowed.add(name+suffix);
 }
 await cp(source,destination,{recursive:true,filter:file=>{
  const name=relative(source,file).split(sep).join('/');
  return (name!=='islands'&&!name.startsWith('islands/'))||allowed.has(name);
 }});
}

async function buildHost(){
 execFileSync(process.execPath,[process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'run','build','-w','services/app'],{cwd:repo,stdio:'inherit'});
 await rm(runtime,{recursive:true,force:true});await mkdir(runtime,{recursive:true});
 execFileSync(process.execPath,[join(repo,'scripts/build/build-server.mjs'),join(runtime,'host.mjs'),join(app,'server/team-host.ts'),'sharp','--remote-runner'],{cwd:repo,stdio:'inherit'});
 execFileSync(process.execPath,[join(repo,'scripts/build/build-server.mjs'),join(runtime,'preview.mjs'),join(cli,'src/preview-entry.ts'),'sharp','--remote-runner'],{cwd:repo,stdio:'inherit'});
 await buildPreview(join(runtime,'preview'));
 await copyRuntimePublic(join(app,'public'),join(runtime,'public'));
 for(const name of ['skills','orchestrator','lib/build-assets','dist/web','package.json']){
  await mkdir(dirname(join(runtime,name)),{recursive:true});await cp(join(app,name),join(runtime,name),{recursive:true});
 }
 await writeFile(join(runtime,'bootstrap.cjs'),"exports.html=(options,assets)=>import('./preview.mjs').then(host=>host.exportLocalHtml(options,assets));\nexports.image=(options,assets)=>import('./preview.mjs').then(host=>host.exportPreviewImage(options,assets));\nexports.preview=(options,assets)=>import('./preview.mjs').then(host=>host.startPreviewHost(options,assets));\nexports.team=(config,assets,overrides)=>import('./host.mjs').then(host=>host.startTeamHost(config,assets,overrides));\n");
 // npm resolves platform-specific optional dependencies on the consumer machine.
 // Never embed build-machine node_modules in the universal npm tarball.
 console.log('Host runtime assets prepared; execution dependencies are owned by the npm package.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildHost();
