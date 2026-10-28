import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import yaml from 'yaml';
const workflow=()=>yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));

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
 for(const name of ['api','integration']){
  const chromium=jobs[name].steps.find(step=>step.id==='playwright');
  expect(chromium.with).toEqual(warm.find(step=>step.id==='browser-chromium').with);
 }
 const selection=jobs.gates.steps.findIndex(step=>step.id==='gate-browsers');
 expect(selection).toBeLessThan(jobs.gates.steps.findIndex(step=>step.id==='browser-chromium'));
 const install=warm.find(step=>step.run?.includes('install --with-deps chromium firefox webkit'));
 for(const browser of browsers)expect(install.if).toContain(`steps.browser-${browser}.outputs.cache-hit != 'true'`);
});

