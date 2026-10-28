import {chmod, cp, mkdir, mkdtemp, readdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {writeComponentAssetReceipt} from './component-asset-proof.mjs';
/** `entries` limits the compiled entry points (default: every source). With `readableDir`, compiled modules go to
 * `outputDir` and the readable `.ts` sources reached from `readableEntries` (default: every entry) go to `readableDir`
 * (the skill's reference copy), minus `readableOmit`; without it both land in `outputDir`.
 * @typedef {{sourceDir: string, outputDir: string, readableDir?: string, entries?: readonly string[], readableEntries?: readonly string[], readableOmit?: readonly string[], appDir?: string, receipt?:{root:string,path?:string}}} ComponentBuildOptions */
const ASSET_NAME=/^[a-z][a-z0-9-]*\.(?:ts|js)$/;
const APP_DIR=fileURLToPath(new URL('../../services/app/',import.meta.url));
/** Flatten optional engines while retaining the author-facing lazy boundary.
 * Pele's complete graph fits a single portable module without external solvers. */
function boundedEngines(appDir) {
  const renderer=path.resolve(appDir,'lib/mermaid-images/reader-draw.ts');
  const deck=path.resolve(appDir,'lib/html-components/deck-gl-engine.ts');
  return {name:'bounded-component-engines',setup(builder){
    builder.onLoad({filter:/(?:reader-draw|deck-gl-engine)\.ts$/},async ({path:filename})=>{
      if(filename!==renderer && filename!==deck) return;
      const result=await build({bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'silent',alias:{'@':path.resolve(appDir)},entryPoints:[filename]});
      return {contents:result.outputFiles[0].text,loader:'js',resolveDir:path.dirname(filename)};
    });
  }};
}

/** Compile one closed ESM graph, preserving lazy engines and sharing their chunks.
 * Flat lowercase names obey the installed skill asset contract. Compile and validate
 * every output before replacing the previous installation; readable sources remain. */
/** @param {ComponentBuildOptions} options */
export async function buildComponentAssets({sourceDir,outputDir,readableDir,entries,readableEntries,readableOmit=[],appDir=APP_DIR,receipt}) {
  // fileURLToPath(directoryURL) retains a trailing separator. Staging must be a
  // sibling of the installation, never a directory inside it.
  outputDir=path.resolve(outputDir);
  const available=(await readdir(sourceDir,{withFileTypes:true}))
    .filter(entry=>entry.isFile() && /^[a-z][a-z0-9-]*\.ts$/.test(entry.name))
    .map(entry=>entry.name).sort();
  const names=entries?entries.map(name=>name+'.ts').sort():available;
  for(const name of names)if(!available.includes(name))throw new Error(`Missing HTML component entry: ${name}`);
  if(!names.length) throw new Error('No HTML component sources found');
  const packed=new Map();
  const result=await build({entryPoints:names.map(name=>path.join(sourceDir,name)),outdir:outputDir,
    bundle:true,splitting:true,minify:true,plugins:[boundedEngines(appDir)],write:false,metafile:true,format:'esm',platform:'browser',target:'es2022',
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
  // Readable sources: every source with readableDir unset; otherwise only the ones the entries reach.
  const graph=new Map(Object.entries(result.metafile.inputs).map(([name,input])=>[path.resolve(name),input.imports.map(item=>path.resolve(item.path))]));
  const reached=new Set(),pending=(readableEntries??names.map(name=>name.replace(/\.ts$/,''))).map(name=>path.resolve(sourceDir,name+'.ts'));
  while(pending.length){const file=pending.pop();if(reached.has(file))continue;reached.add(file);pending.push(...(graph.get(file)??[]));}
  const readable=readableDir?available.filter(name=>reached.has(path.resolve(sourceDir,name))&&!readableOmit.includes(name.replace(/\.ts$/,''))):available;
  const sources=await Promise.all(readable.map(async name=>({name,content:await readFile(path.join(sourceDir,name),'utf8')})));
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
  const installs=readableDir?[{dir:outputDir,files:compiled},{dir:path.resolve(readableDir),files:sources}]:[{dir:outputDir,files:[...sources,...compiled]}];
  for(const {dir,files} of installs)await install(dir,files);
  if(receipt)await writeComponentAssetReceipt({root:receipt.root,receiptPath:receipt.path,inputs:[...Object.keys(result.metafile.inputs).map(name=>path.resolve(name)),fileURLToPath(import.meta.url),fileURLToPath(new URL('./component-asset-proof.mjs',import.meta.url)),path.join(receipt.root,'package-lock.json')],outputs:installs.flatMap(({dir,files})=>files.map(({name})=>path.join(dir,name)))});
  return names.map(name=>name.replace(/\.ts$/,''));
}
/** Replace every owned (component-named) file of `dir` in one directory swap, keeping unrelated files. */
async function install(dir,files){
  await mkdir(path.dirname(dir),{recursive:true});
  const stage=await mkdtemp(`${dir}.stage-`), backup=`${stage}.previous`;
  // mkdtemp creates 0700; the installed directory is read by the app's own (often different) user in production images.
  await chmod(stage,0o755);
  let movedPrevious=false;
  try {
    let existing=[];
    try { existing=await readdir(dir); } catch(error) { if(error.code!=='ENOENT') throw error; }
    for(const name of existing) if(!ASSET_NAME.test(name)) await cp(path.join(dir,name),path.join(stage,name),{recursive:true});
    await Promise.all(files.map(({name,content})=>writeFile(path.join(stage,name),content)));
    try { await rename(dir,backup); movedPrevious=true; } catch(error) { if(error.code!=='ENOENT') throw error; }
    try { await rename(stage,dir); } catch(error) { if(movedPrevious) { await rename(backup,dir); movedPrevious=false; } throw error; }
    if(movedPrevious) { await rm(backup,{recursive:true,force:true}); movedPrevious=false; }
  } finally { await rm(stage,{recursive:true,force:true}); }
}
