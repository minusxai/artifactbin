/** Replace each installed compiler with exact source-built bytes for the active host. */
import {readFile,access,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareCompilerAssets,repositoryRoot} from '../lib/esbuild-toolchain.mjs';
import {compilerPayload,installCompiler} from '../lib/compiler-payload.mjs';

export async function prepareInstalledCompilers(root=repositoryRoot){
 if(process.env.ESBUILD_BINARY_PATH)throw new Error('External compiler binary override is not admitted');
 root=resolve(root);
 const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8')),packages=[];
 for(const [path,metadata]of Object.entries(lock.packages)){
  if(path!=='node_modules/esbuild'&&!path.endsWith('/node_modules/esbuild'))continue;
  const packageRoot=join(root,path);try{await access(join(packageRoot,'package.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  if(JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8')).version!==metadata.version)throw new Error('Installed compiler version differs from lock');
  packages.push({path,root:packageRoot,version:metadata.version});
 }
 if(!packages.length)throw new Error('No installed esbuild compiler');
 const target=`${process.platform}-${process.arch}`,output=join(root,'node_modules/.cache/esbuild-compilers');
 await prepareCompilerAssets(output,{versions:[...new Set(packages.map(p=>p.version))],targets:[target]});
 const receipt={schema:1,target,go:'go1.27.3',sys:'v0.44.0',packages:[]};
 for(const entry of packages){
  const source=await compilerPayload(output,entry.version,target),expected=await readFile(source);
  const require=createRequire(join(entry.root,'package.json'));
  const subpath=process.platform==='win32'?'esbuild.exe':'bin/esbuild';
  let native;try{native=require.resolve(`@esbuild/${target}/${subpath}`);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;native=join(entry.root,'lib',`downloaded-@esbuild-${target}-${process.platform==='win32'?'esbuild.exe':'esbuild'}`);}
  await installCompiler(entry.root,output);
  const destinations=[native,...(process.platform==='win32'?[]:[join(entry.root,'bin/esbuild')])];
  for(const path of destinations)if(!(await readFile(path)).equals(expected))throw new Error('Installed compiler bytes differ from qualified source build');
  const actual=await readFile(native);
  receipt.packages.push({path:entry.path,version:entry.version,sha256:createHash('sha256').update(actual).digest('hex')});
 }
 await mkdir(dirname(join(root,'node_modules/.cache/esbuild-installed.json')),{recursive:true});
 await writeFile(join(root,'node_modules/.cache/esbuild-installed.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log('PASS source-built installed compiler '+JSON.stringify(receipt));return receipt;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await prepareInstalledCompilers();
