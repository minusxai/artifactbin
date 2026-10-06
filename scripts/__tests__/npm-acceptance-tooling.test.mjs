import {it,expect} from 'vitest';
import {mkdtemp,mkdir,cp,rm,access,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {copyInstalledPackage} from './npm-installed-fixture.mjs';
const repository=fileURLToPath(new URL('../../',import.meta.url));
it('isolated acceptance tooling loads the real runner boundary and browser without app/native execution engines',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-acceptance-tools-'));
 try{
  for(const relative of ['scripts/ci/npm-acceptance/package.json','scripts/ci/npm-acceptance/package-lock.json','scripts/ci/link-npm-acceptance.mjs','services/utils','services/contracts','services/runner/src/http.ts','package.json','tsconfig.json','services/app/lib','scripts/gates/lib','scripts/lib']){
   const target=join(root,relative);await mkdir(dirname(target),{recursive:true});
   await cp(join(repository,relative),target,{recursive:true,filter:source=>!source.includes('/node_modules/')&&!source.endsWith('/node_modules')&&!source.includes('/__tests__/')});
  }
  const tooling=join(root,'scripts/ci/npm-acceptance');
  const manifest=JSON.parse(await readFile(join(tooling,'package.json'),'utf8'));
  for(const [name,version] of Object.entries(manifest.dependencies)){
   if(version.startsWith('file:'))continue;
   const installedName=name==='playwright'?'playwright-core':name;
   const copied=await copyInstalledPackage(installedName,repository,tooling);
   const pkg=JSON.parse(await readFile(join(copied,'package.json'),'utf8'));
   expect(pkg.version,name).toBe(version.replace('npm:playwright-core@',''));
   if(name!==installedName)await cp(copied,join(tooling,'node_modules',name),{recursive:true});
  }
  await mkdir(join(tooling,'node_modules/@artifactbin'),{recursive:true});
  for(const name of ['utils','contracts'])await cp(join(root,'services',name),join(tooling,'node_modules/@artifactbin',name),{recursive:true});
  const linked=spawnSync(process.execPath,[join(root,'scripts/ci/link-npm-acceptance.mjs')],{encoding:'utf8'});expect(linked.status,linked.stderr).toBe(0);
  const proof=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import{runnerHttp}from'./services/runner/src/http.ts';import{getRequestListener}from'@hono/node-server';import{chromium}from'playwright';import sharp from'sharp';import{parse}from'parse5';import ts from'typescript';import assert from'node:assert/strict';assert.equal((await runnerHttp({}).request('/v1/runs/proof')).status,401);assert.equal(typeof getRequestListener,'function');assert.equal(typeof chromium.launch,'function');assert.ok(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer());assert.ok(parse('<p>Proof</p>'));assert.ok(ts.version);await import('./services/app/lib/validation/atlas-schemas.ts');await import('./scripts/gates/lib/cli-conformance.mjs');"],{cwd:root,encoding:'utf8',timeout:15000});
  expect(proof.status,proof.stderr).toBe(0);
  for(const unavailable of ['node_modules/isolated-vm','services/app/node_modules','services/app/dist'])await expect(access(join(root,unavailable))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},45000);
