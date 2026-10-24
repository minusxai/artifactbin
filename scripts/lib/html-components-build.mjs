import {cp, mkdir, mkdtemp, readdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
/** @typedef {{sourceDir: string, outputDir: string, appDir?: string}} ComponentBuildOptions */
const ASSET_NAME=/^[a-z][a-z0-9-]*\.(?:ts|js)$/;
const APP_DIR=fileURLToPath(new URL('../../services/app/',import.meta.url));
const ELK_ASSET='engine-mermaid-elk.js';
/** Keep the author-facing lazy engine boundary, but flatten third-party internal
 * chunks. Mermaid otherwise exceeds publication's 99-file cap; its complete
 * renderer exceeds 4MB even minified, so its large ELK solver stays a separate
 * local module. No chart/layout registration is removed. */
function boundedEngines(appDir, packed) {
  const renderer=path.resolve(appDir,'lib/mermaid-images/reader-draw.ts');
  const deck=path.resolve(appDir,'lib/html-components/deck-gl-engine.ts');
  return {name:'bounded-component-engines',setup(builder){
    builder.onResolve({filter:/^\.\/engine-mermaid-elk\.js$/},()=>({path:`./${ELK_ASSET}`,external:true}));
    builder.onLoad({filter:/(?:reader-draw|deck-gl-engine)\.ts$/},async ({path:filename})=>{
      if(filename!==renderer && filename!==deck) return;
      const mermaid=filename===renderer;
      const options={bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'silent',alias:{'@':path.resolve(appDir)}};
      const result=await build({...options,entryPoints:[filename],external:mermaid?['elkjs/lib/elk.bundled.js']:[]});
      if(mermaid){
        const elk=await build({...options,entryPoints:['elkjs/lib/elk.bundled.js'],absWorkingDir:path.resolve(appDir,'../..')});
        packed.set(ELK_ASSET,elk.outputFiles[0].text);
      }
      return {contents:result.outputFiles[0].text.replaceAll('"elkjs/lib/elk.bundled.js"',`"./${ELK_ASSET}"`),loader:'js',resolveDir:path.dirname(filename)};
    });
  }};
}

/** Compile one closed ESM graph, preserving lazy engines and sharing their chunks.
 * Flat lowercase names obey the installed skill asset contract. Compile and validate
 * every output before replacing the previous installation; readable sources remain. */
/** @param {ComponentBuildOptions} options */
export async function buildComponentAssets({sourceDir,outputDir,appDir=APP_DIR}) {
  // fileURLToPath(directoryURL) retains a trailing separator. Staging must be a
  // sibling of the installation, never a directory inside it.
  outputDir=path.resolve(outputDir);
  const names=(await readdir(sourceDir,{withFileTypes:true}))
    .filter(entry=>entry.isFile() && /^[a-z][a-z0-9-]*\.ts$/.test(entry.name))
    .map(entry=>entry.name).sort();
  if(!names.length) throw new Error('No HTML component sources found');
  const sources=await Promise.all(names.map(async name=>({name,content:await readFile(path.join(sourceDir,name),'utf8')})));
  const packed=new Map();
  const result=await build({entryPoints:names.map(name=>path.join(sourceDir,name)),outdir:outputDir,
    bundle:true,splitting:true,minify:true,plugins:[boundedEngines(appDir,packed)],write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',
    entryNames:'[name]',chunkNames:'chunk-[hash]',alias:{'@':path.resolve(appDir)},logLevel:'silent'});
  for(const output of Object.values(result.metafile.outputs)) for(const dependency of output.imports) {
    if(dependency.external && !packed.has(dependency.path.replace(/^\.\//,''))) throw new Error(`HTML components must bundle module dependency: ${dependency.path}`);
  }
  // esbuild hashes use uppercase ASCII. Lowercase that alphabet (a bijection), and
  // rewrite only emitted relative module references so entry/chunk names all match
  // the same publication allowlist without allowing extra paths or URL schemes.
  const renamed=new Map(result.outputFiles.map(file=>{
    const name=path.basename(file.path); return [name,name.toLowerCase()];
  }));
  if(new Set(renamed.values()).size!==renamed.size) throw new Error('Component output filenames collide after lowercase normalization');
  const compiled=result.outputFiles.map(file=>{
    const name=renamed.get(path.basename(file.path));
    if(!ASSET_NAME.test(name) || !name.endsWith('.js')) throw new Error(`Unsupported component build output: ${name}`);
    const content=file.text.replace(/(["'])\.\/([a-zA-Z0-9-]+\.js)\1/g,(reference,quote,target)=>{
      const emitted=renamed.get(target); if(!emitted) return reference;
      return `${quote}./${emitted}${quote}`;
    });
    return {name,content};
  });
  compiled.push(...[...packed].map(([name,content])=>({name,content})));
  for(const {name,content} of compiled) if(Buffer.byteLength(content)>4_000_000) throw new Error(`Component exceeds publication file limit: ${name}`);
  // Preserve unrelated files but replace all owned entries/chunks in one directory
  // swap. Compilation, remote-dependency errors and staging errors leave the old
  // installation intact; a failed final rename restores the previous directory.
  await mkdir(path.dirname(outputDir),{recursive:true});
  const stage=await mkdtemp(`${outputDir}.stage-`), backup=`${stage}.previous`;
  let movedPrevious=false;
  try {
    let existing=[];
    try { existing=await readdir(outputDir); } catch(error) { if(error.code!=='ENOENT') throw error; }
    for(const name of existing) if(!ASSET_NAME.test(name)) await cp(path.join(outputDir,name),path.join(stage,name),{recursive:true});
    await Promise.all([...sources,...compiled].map(({name,content})=>writeFile(path.join(stage,name),content)));
    try { await rename(outputDir,backup); movedPrevious=true; } catch(error) { if(error.code!=='ENOENT') throw error; }
    try { await rename(stage,outputDir); } catch(error) { if(movedPrevious) { await rename(backup,outputDir); movedPrevious=false; } throw error; }
    if(movedPrevious) { await rm(backup,{recursive:true,force:true}); movedPrevious=false; }
  } finally { await rm(stage,{recursive:true,force:true}); }
  return names.map(name=>name.replace(/\.ts$/,''));
}
