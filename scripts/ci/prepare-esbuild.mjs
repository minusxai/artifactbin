/** Prepare local compiler copies, or the universal CLI payload before candidate packing. */
import {readFile,access,mkdir,cp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareCompilerAssets,repositoryRoot} from '../lib/esbuild-toolchain.mjs';
import {COMPILER_TARGETS,installCompiler} from '../../services/cli/scripts/prepare-esbuild.mjs';

export async function prepareInstalledCompilers(root=repositoryRoot,{packagePayload=false}={}){
 root=resolve(root);
 const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
 const packages=[];
 for(const [path,metadata]of Object.entries(lock.packages)){
  if(!path.endsWith('/node_modules/esbuild')&&path!=='node_modules/esbuild')continue;
  try{await access(join(root,path,'package.json'));}catch{continue;}
  packages.push({root:join(root,path),version:metadata.version});
 }
 const versions=[...new Set(packages.map(value=>value.version))];
 const output=join(root,'node_modules/.cache/esbuild-compilers'),host=`${process.platform}-${process.arch}`;
 if(versions.length)await prepareCompilerAssets(output,{versions,targets:[host]});
 for(const entry of packages)await installCompiler(entry.root,output);
 if(packagePayload){
  const cli=join(root,'services/cli'),version=JSON.parse(await readFile(join(cli,'package.json'),'utf8')).dependencies.esbuild;
  await prepareCompilerAssets(output,{versions:[version],targets:COMPILER_TARGETS});
  const destination=join(cli,'dist/compiler');await mkdir(destination,{recursive:true});
  await cp(join(output,version),join(destination,version),{recursive:true});
  const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  manifest.compilers={[version]:manifest.compilers[version]};
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 }
 console.log(versions.length?`Prepared esbuild ${versions.join(', ')} with go1.27.3 and x/sys v0.44.0${packagePayload?' and universal CLI payload':''}`:'No installed esbuild packages');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(process.argv.find(value=>value.startsWith('--root='))?.slice(7)??repositoryRoot);
 if(process.argv.includes('--cache-package')){
  // This producer may run beside the CLI build: touch only the compiler cache, never installed executables or dist.
  const version=JSON.parse(await readFile(join(root,'services/cli/package.json'),'utf8')).dependencies.esbuild;
  await prepareCompilerAssets(join(root,'node_modules/.cache/esbuild-compilers'),{versions:[version],targets:COMPILER_TARGETS});
 }else await prepareInstalledCompilers(root,{packagePayload:process.argv.includes('--package')});
}
