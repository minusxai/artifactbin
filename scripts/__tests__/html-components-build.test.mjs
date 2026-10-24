import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, expect, it} from 'vitest';
import {buildComponentAssets} from '../lib/html-components-build.mjs';

const roots=[];
async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'html-components-'));
  roots.push(root);
  const sourceDir=path.join(root,'source'), outputDir=path.join(root,'output');
  await mkdir(sourceDir);
  return {sourceDir,outputDir};
}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('ships readable source and self-contained browser ESM while excluding tests and fixtures',async()=>{
  const dirs=await fixture();
  await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'import {label} from "./labels"; export const title:string=label;');
  await writeFile(path.join(dirs.sourceDir,'labels.ts'),'export const label="Tabs";');
  await writeFile(path.join(dirs.sourceDir,'tabs.test.ts'),'throw Error("test code must never ship");');
  await writeFile(path.join(dirs.sourceDir,'tabs.fixture.ts'),'throw Error("fixture must never ship");');
  await buildComponentAssets(dirs);
  expect((await readdir(dirs.outputDir)).sort()).toEqual(['labels.js','labels.ts','tabs.js','tabs.ts']);
  expect(await readFile(path.join(dirs.outputDir,'tabs.ts'),'utf8')).toContain('title:string');
  const bundle=await readFile(path.join(dirs.outputDir,'tabs.js'),'utf8');
  expect(bundle).not.toContain('from "./labels"');
  expect((await import(`data:text/javascript,${encodeURIComponent(bundle)}`)).title).toBe('Tabs');
});
it('does not replace existing output when any component fails compilation',async()=>{
  const dirs=await fixture();
  await mkdir(dirs.outputDir);
  await writeFile(path.join(dirs.outputDir,'tabs.js'),'previous working output');
  await writeFile(path.join(dirs.sourceDir,'tabs.ts'),'export const = ;');
  await expect(buildComponentAssets(dirs)).rejects.toThrow();
  expect(await readFile(path.join(dirs.outputDir,'tabs.js'),'utf8')).toBe('previous working output');
});
