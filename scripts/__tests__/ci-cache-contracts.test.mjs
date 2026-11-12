import {it,expect} from 'vitest';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installFingerprint} from '../lib/lock-fingerprint.mjs';
import yaml from 'yaml';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));

it('keeps auth release compatibility metadata out of the install key while retaining dependency and hook changes',()=>{
 const root=mkdtempSync(join(tmpdir(),'role-install-key-'));
 try{
  mkdirSync(join(root,'services/auth'),{recursive:true});
  writeFileSync(join(root,'package-lock.json'),JSON.stringify({packages:{'':{},'services/auth':{}}}));
  writeFileSync(join(root,'package.json'),'{}');
  const put=value=>writeFileSync(join(root,'services/auth/package.json'),JSON.stringify(value));
  const original={name:'@artifactbin/auth',version:'0.1.0',dependencies:{pg:'8.23.0'},scripts:{postinstall:'prepare'}};
  put(original);const key=installFingerprint(root);
  put({...original,groupRoleModelVersion:2});expect(installFingerprint(root)).toBe(key);
  put({...original,dependencies:{pg:'8.24.0'}});expect(installFingerprint(root)).not.toBe(key);
  put({...original,scripts:{postinstall:'different'}});expect(installFingerprint(root)).not.toBe(key);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('gives every browser a disjoint immutable cache that the main warmer also populates',()=>{
 const jobs=workflow().jobs;
 const warm=jobs['warm-caches'].steps;
 const browsers=['chromium','firefox','webkit'];
 for(const browser of browsers){
  const reader=jobs.gates.steps.find(step=>step.id===`browser-${browser}`);
  const writer=warm.find(step=>step.id===`browser-${browser}`);
  expect(reader,`${browser} must have its own cache`).toBeDefined();
  expect(reader.with).toEqual(writer.with);
  expect(reader.with.key).toContain(`playwright-v2-${browser}-`);
  expect(reader.with.path).toContain(`/${browser}-*`);
  for(const other of browsers.filter(name=>name!==browser))expect(reader.with.path).not.toContain(`/${other}-*`);
  if(browser!=='chromium')expect(reader.if).toContain(`'${browser}'`);
 }
 const chromium=jobs.integration.steps.find(step=>step.id==='playwright');
 expect(chromium.with).toEqual(warm.find(step=>step.id==='browser-chromium').with);
 const selection=jobs.gates.steps.findIndex(step=>step.id==='gate-browsers');
 expect(selection).toBeLessThan(jobs.gates.steps.findIndex(step=>step.id==='browser-chromium'));
 const install=warm.find(step=>step.run?.includes('npx playwright install chromium firefox webkit'));
 for(const browser of browsers)expect(install.if).toContain(`steps.browser-${browser}.outputs.cache-hit != 'true'`);
});

