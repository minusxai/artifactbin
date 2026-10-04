import {it,expect} from 'vitest';
import {mkdtemp,mkdir,cp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {npmDriver} from '../ci/npm-driver.mjs';
const repository=fileURLToPath(new URL('../../',import.meta.url));
it('cold isolated acceptance tooling loads the real runner boundary and browser without app/native execution engines',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-acceptance-tools-'));
 try{
  for(const relative of ['scripts/ci/npm-acceptance/package.json','scripts/ci/npm-acceptance/package-lock.json','scripts/ci/link-npm-acceptance.mjs','services/utils','services/contracts','services/runner/src/http.ts']){
   const target=join(root,relative);await mkdir(dirname(target),{recursive:true});
   await cp(join(repository,relative),target,{recursive:true,filter:source=>!source.includes('/node_modules/')&&!source.endsWith('/node_modules')&&!source.includes('/__tests__/')});
  }
  const npm=npmDriver();
  const installed=spawnSync(process.execPath,[npm,'ci','--prefix',join(root,'scripts/ci/npm-acceptance'),'--offline','--no-audit','--no-fund'],{encoding:'utf8',timeout:30000});
  expect(installed.status,installed.stderr).toBe(0);
  const linked=spawnSync(process.execPath,[join(root,'scripts/ci/link-npm-acceptance.mjs')],{encoding:'utf8'});expect(linked.status,linked.stderr).toBe(0);
  const proof=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import{runnerHttp}from'./services/runner/src/http.ts';import{getRequestListener}from'@hono/node-server';import{chromium}from'playwright';import sharp from'sharp';import{parse}from'parse5';import ts from'typescript';import assert from'node:assert/strict';assert.equal((await runnerHttp({}).request('/v1/runs/proof')).status,401);assert.equal(typeof getRequestListener,'function');assert.equal(typeof chromium.launch,'function');assert.ok(await sharp({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer());assert.ok(parse('<p>Proof</p>'));assert.ok(ts.version);"],{cwd:root,encoding:'utf8',timeout:15000});
  expect(proof.status,proof.stderr).toBe(0);
  for(const unavailable of ['node_modules/isolated-vm','services/app/node_modules','services/app/dist'])await expect(access(join(root,unavailable))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},45000);
