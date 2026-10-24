import {mkdir, readdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';

/** Compile the optional author components, never their development tests/fixtures.
 * Each JS file is self-contained ESM so publication can carry it offline without
 * a package manager, CDN or hidden runtime dependency. Source stays readable. */
export async function buildComponentAssets({sourceDir,outputDir}) {
  const names=(await readdir(sourceDir,{withFileTypes:true}))
    .filter(entry=>entry.isFile() && /^[a-z][a-z0-9-]*\.ts$/.test(entry.name))
    .map(entry=>entry.name).sort();
  if(!names.length) throw new Error('No HTML component sources found');
  // Finish all compilation before touching the installed skill assets.
  const assets=await Promise.all(names.map(async name=>{
    const filename=path.join(sourceDir,name);
    const result=await build({entryPoints:[filename],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',logLevel:'silent'});
    return {name,source:await readFile(filename,'utf8'),compiled:result.outputFiles[0].text};
  }));
  const stage=`${outputDir}.stage-${process.pid}`;
  await rm(stage,{recursive:true,force:true});
  await mkdir(stage,{recursive:true});
  try {
    await Promise.all(assets.flatMap(({name,source,compiled})=>[
      writeFile(path.join(stage,name),source),
      writeFile(path.join(stage,name.replace(/\.ts$/,'.js')),compiled),
    ]));
    await mkdir(outputDir,{recursive:true});
    for(const file of await readdir(stage)) await rename(path.join(stage,file),path.join(outputDir,file));
    const expected=new Set(assets.flatMap(({name})=>[name,name.replace(/\.ts$/,'.js')]));
    for(const file of await readdir(outputDir)) {
      if(/^[a-z][a-z0-9-]*\.(?:ts|js)$/.test(file) && !expected.has(file)) await rm(path.join(outputDir,file));
    }
  } finally { await rm(stage,{recursive:true,force:true}); }
  return assets.map(({name})=>name.replace(/\.ts$/,''));
}
