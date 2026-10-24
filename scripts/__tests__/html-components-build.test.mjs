import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {afterEach, expect, it} from 'vitest';
import {build} from 'esbuild';
import {buildComponentAssets} from '../lib/html-components-build.mjs';

const roots=[];
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'html-components-')); roots.push(root);
  const sourceDir=path.join(root,'source'), outputDir=path.join(root,'output'), appDir=path.join(root,'app');
  await mkdir(sourceDir); await mkdir(appDir); return {sourceDir,outputDir,appDir};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
// Follow emitted static and dynamic import edges, rather than inspecting only the entry.
async function closure(outputDir, entry){
 const graph=await build({entryPoints:[path.join(outputDir,entry)],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',logLevel:'silent'});
 const files=new Map();
 for(const input of Object.keys(graph.metafile.inputs)) {
  const name=path.basename(input); expect(name).toMatch(/^[a-z][a-z0-9-]*\.js$/);
  files.set(name,await readFile(path.resolve(input),'utf8'));
 }
 return files;
}
it('ships readable source and a closed browser ESM graph excluding tests and fixtures',async()=>{
 const dirs=await fixture();
 await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'import {label} from "./labels"; export const title:string=label;');
 await writeFile(path.join(dirs.sourceDir,'labels.ts'),'export const label="Tabs";');
 await writeFile(path.join(dirs.sourceDir,'tabs.test.ts'),'throw Error("test code must never ship");');
 await writeFile(path.join(dirs.sourceDir,'tabs.fixture.ts'),'throw Error("fixture must never ship");');
 expect(await buildComponentAssets(dirs)).toEqual(['labels','tabs']);
 const files=await readdir(dirs.outputDir); expect(files).toContain('tabs.ts'); expect(files.every(name=>/^[a-z][a-z0-9-]*\.(?:ts|js)$/.test(name))).toBe(true);
 expect(files.some(name=>name.includes('fixture')||name.includes('test'))).toBe(false);
 expect(await readFile(path.join(dirs.outputDir,'tabs.ts'),'utf8')).toContain('title:string');
 await closure(dirs.outputDir,'tabs.js'); expect((await import(pathToFileURL(path.join(dirs.outputDir,'tabs.js')).href)).title).toBe('Tabs');
});
it('keeps engines lazy, shares flat chunks, resolves the app alias, and removes stale chunks deterministically',async()=>{
 const dirs=await fixture();
 await mkdir(path.join(dirs.sourceDir,'internal'));
 await writeFile(path.join(dirs.appDir,'label.ts'),'export const label="local alias";');
 await writeFile(path.join(dirs.sourceDir,'first.ts'),'export async function load(){return (await import("./internal/engine")).result;}');
 await writeFile(path.join(dirs.sourceDir,'second.ts'),'export async function load(){return (await import("./internal/engine")).result;}');
 await writeFile(path.join(dirs.sourceDir,'internal/engine.ts'),'import {label} from "@/label"; export const result="LAZY_ENGINE_MARKER:"+label;');
 await buildComponentAssets(dirs);
 const first=await readFile(path.join(dirs.outputDir,'first.js'),'utf8'); expect(first).toMatch(/import\("\.\/chunk-[a-z0-9]+\.js"\)/); expect(first).not.toContain('LAZY_ENGINE_MARKER');
 const a=await closure(dirs.outputDir,'first.js'), b=await closure(dirs.outputDir,'second.js');
 expect([...a.keys()].filter(name=>b.has(name)&&name.startsWith('chunk-')).length).toBeGreaterThan(0);
 expect([...a.values()].join('\n')).toContain('LAZY_ENGINE_MARKER'); await expect((await import(pathToFileURL(path.join(dirs.outputDir,'first.js')).href)).load()).resolves.toBe('LAZY_ENGINE_MARKER:local alias');
 const original=(await readdir(dirs.outputDir)).sort(); await buildComponentAssets(dirs); expect((await readdir(dirs.outputDir)).sort()).toEqual(original);
 await writeFile(path.join(dirs.outputDir,'chunk-stale.js'),'old'); await writeFile(path.join(dirs.outputDir,'README.md'),'preserved');
 await writeFile(path.join(dirs.sourceDir,'first.ts'),'export const value=1;'); await writeFile(path.join(dirs.sourceDir,'second.ts'),'export const value=2;');
 await buildComponentAssets(dirs); expect((await readdir(dirs.outputDir)).some(name=>name.startsWith('chunk-'))).toBe(false); expect(await readFile(path.join(dirs.outputDir,'README.md'),'utf8')).toBe('preserved');
});
it('does not replace any installed output when an entry or lazy dependency fails compilation',async()=>{
 const dirs=await fixture(); await mkdir(dirs.outputDir);
 await writeFile(path.join(dirs.outputDir,'tabs.js'),'previous working output'); await writeFile(path.join(dirs.outputDir,'chunk-old.js'),'previous shared chunk');
 await writeFile(path.join(dirs.sourceDir,'valid.ts'),'export const good=true;'); await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'export const = ;');
 await expect(buildComponentAssets(dirs)).rejects.toThrow();
 expect(await readFile(path.join(dirs.outputDir,'tabs.js'),'utf8')).toBe('previous working output'); expect(await readFile(path.join(dirs.outputDir,'chunk-old.js'),'utf8')).toBe('previous shared chunk');
 await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'export const load=()=>import("./missing-engine");'); await expect(buildComponentAssets(dirs)).rejects.toThrow();
 expect((await readdir(dirs.outputDir)).sort()).toEqual(['chunk-old.js','tabs.js']);
});
it('refuses unresolved remote module dependencies without touching installed assets',async()=>{
 const dirs=await fixture(); await mkdir(dirs.outputDir); await writeFile(path.join(dirs.outputDir,'kept.js'),'kept');
 await writeFile(path.join(dirs.sourceDir,'remote.ts'),'export const load=()=>import("https://example.invalid/engine.js");'); await expect(buildComponentAssets(dirs)).rejects.toThrow();
 expect(await readFile(path.join(dirs.outputDir,'kept.js'),'utf8')).toBe('kept');
});
it('accepts the build wrapper trailing output separator without staging inside the installed directory',async()=>{
 const dirs=await fixture(); await mkdir(dirs.outputDir); await writeFile(path.join(dirs.outputDir,'README.md'),'keep'); await writeFile(path.join(dirs.outputDir,'tabs.js'),'old');
 await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'export const value="new";');
 const options={...dirs,outputDir:`${dirs.outputDir}${path.sep}`};
 await buildComponentAssets(options); expect(await readFile(path.join(dirs.outputDir,'tabs.js'),'utf8')).toContain('new'); expect(await readFile(path.join(dirs.outputDir,'README.md'),'utf8')).toBe('keep');
 const installed=await readFile(path.join(dirs.outputDir,'tabs.js'),'utf8');
 await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'export const = ;'); await expect(buildComponentAssets(options)).rejects.toThrow();
 expect(await readFile(path.join(dirs.outputDir,'tabs.js'),'utf8')).toBe(installed); expect((await readdir(dirs.outputDir)).some(name=>name.includes('stage-'))).toBe(false);
});
it('fits actual Mermaid, DeckGL and controls under publication limits with lazy engines retained',async()=>{
 const dirs=await fixture();
 const appDir=fileURLToPath(new URL('../../services/app/',import.meta.url));
 await buildComponentAssets({sourceDir:path.join(appDir,'lib/html-components'),outputDir:dirs.outputDir,appDir});
 const files=new Map();for(const entry of ['mermaid.js','deck-gl.js','button.js','slider.js','tabs.js'])for(const [name,text] of await closure(dirs.outputDir,entry))files.set(name,text);
 expect(files.size).toBeLessThanOrEqual(99);expect([...files.values()].reduce((total,text)=>total+Buffer.byteLength(text),0)).toBeLessThan(16_000_000);
 expect(Math.max(...[...files.values()].map(text=>Buffer.byteLength(text)))).toBeLessThanOrEqual(4_000_000);
 expect(files.has('engine-mermaid-elk.js')).toBe(true);
 expect(files.get('mermaid.js')).toMatch(/import\("\.\/chunk-[a-z0-9]+\.js"\)/);expect(files.get('deck-gl.js')).toMatch(/import\("\.\/deck-gl-engine\.js"\)/);
 expect(Buffer.byteLength(files.get('mermaid.js'))).toBeLessThan(30_000);expect(Buffer.byteLength(files.get('deck-gl.js'))).toBeLessThan(30_000);
 const {planPublicationBundle}=await import('../../services/app/lib/html-publication-bundle/plan');
 const html='<html><head><script type="module">import "./mermaid.js";import "./deck-gl.js";import "./button.js";import "./slider.js";import "./tabs.js";</script></head><body><af-mermaid></af-mermaid><af-deck-gl></af-deck-gl></body></html>';
 const bundle={entryPath:'index.html',files:[{path:'index.html',base64:Buffer.from(html).toString('base64'),contentType:'text/html'},...[...files].map(([name,text])=>({path:name,base64:Buffer.from(text).toString('base64'),contentType:'text/javascript'}))]};
 expect(()=>planPublicationBundle(html,bundle)).not.toThrow();
},30000);
