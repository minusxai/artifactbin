/** CI build boundary: reuse the application build and ESM server bundler, then gather runtime files. */
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {packageRoot} from './package-root.mjs';
import {cp,mkdir,readFile,rm,writeFile,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EXTERNALS} from '../../../scripts/runtime-externals.mjs';
import {runtimePackageFile} from './runtime-package-files.mjs';
import {archiveDirectory} from './runtime-archive.mjs';
const cli=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(cli,'../..');
const runtime=join(cli,'dist/runtime'),app=join(repo,'services/app');
execFileSync(process.execPath,[process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'run','build','-w','services/app'],{cwd:repo,stdio:'inherit'});
await rm(runtime,{recursive:true,force:true});await mkdir(runtime,{recursive:true});
execFileSync(process.execPath,[join(repo,'scripts/build-server.mjs'),join(runtime,'host.mjs'),join(cli,'src/team-entry.ts'),'sharp'],{cwd:repo,stdio:'inherit'});
execFileSync(process.execPath,[join(repo,'scripts/build-server.mjs'),join(runtime,'preview.mjs'),join(cli,'src/preview-entry.ts'),'sharp'],{cwd:repo,stdio:'inherit'});
await build({entryPoints:[join(cli,'src/preview/client.tsx')],bundle:true,format:'esm',splitting:true,outdir:join(runtime,'preview'),platform:'browser',target:'es2022',jsx:'automatic',alias:{'@':app},define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff2':'dataurl','.css':'empty'}});
for(const name of ['public','skills','orchestrator','lib/story-runtime/dist','dist/web','package.json']){
 await mkdir(dirname(join(runtime,name)),{recursive:true});await cp(join(app,name),join(runtime,name),{recursive:true});
}
await writeFile(join(runtime,'bootstrap.cjs'),"exports.image=(options,assets)=>import('./preview.mjs').then(host=>host.exportPreviewImage(options,assets));\nexports.preview=(options,assets)=>import('./preview.mjs').then(host=>host.startPreviewHost(options,assets));\nexports.team=(config,assets,overrides)=>import('./host.mjs').then(host=>host.startTeamHost(config,assets,overrides));\n");
const installed=new Map();
async function install(name,from,parent=runtime){
 const {directory,pkg}=await packageRoot(name,from);
 let destination=join(runtime,'node_modules',name);
 if(installed.has(destination)&&installed.get(destination)!==pkg.version)destination=join(parent,'node_modules',name);
 if(installed.get(destination)===pkg.version)return;
 if(installed.has(destination))throw new Error('Runtime dependency collision: '+name);
 installed.set(destination,pkg.version);
 await mkdir(dirname(destination),{recursive:true});
 await cp(directory,destination,{recursive:true,verbatimSymlinks:true,filter:source=>!source.slice(directory.length).split(/[\\/]/).includes('node_modules')&&runtimePackageFile(name,source.slice(directory.length).replace(/^[\\/]/,''))});
 for(const dependency of Object.keys(pkg.dependencies??{}))await install(dependency,directory,destination);
 for(const dependency of Object.keys(pkg.optionalDependencies??{})){
  try{await packageRoot(dependency,directory);}catch(error){if(error.code==='MODULE_NOT_FOUND')continue;throw error;}
  await install(dependency,directory,destination);
 }
}
// Vite is development-only.
for(const name of [...EXTERNALS.filter(name=>name!=='vite'),'sharp'])await install(name,repo);
const {version}=JSON.parse(await readFile(join(cli,'package.json'),'utf8'));
const archive=`afbin-runtime-${process.platform}-${process.arch}.gz`;
const manifest=await archiveDirectory(runtime,{prefix:'node_modules/@artifactbin/host-runtime',out:join(cli,'dist',archive),url:`https://github.com/minusxai/artifactbin/releases/download/afbin-v${version}/${archive}`});
await writeFile(join(cli,'dist/runtime.manifest.json'),JSON.stringify(manifest)+'\n');
console.log(`Host runtime: ${manifest.files.length} files, ${(await stat(join(cli,'dist',archive))).size} compressed bytes`);
