import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterEach, expect, it} from 'vitest';
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
 const files=new Map();
 async function visit(name){
  if(files.has(name)) return;
  expect(name).toMatch(/^[a-z][a-z0-9-]*\.js$/);
  const text=await readFile(path.join(outputDir,name),'utf8'); files.set(name,text);
  const imports=[...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(match=>match[1]);
  for(const specifier of imports){ expect(specifier).toMatch(/^\.\/[a-z][a-z0-9-]*\.js$/); await visit(specifier.slice(2)); }
 }
 await visit(entry); return files;
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
