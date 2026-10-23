import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {describe,it,expect} from 'vitest';
import {nativeSystemCss,nativeSystemMd} from '../../design-systems/lib/html-skill.mjs';
import {ROSTER} from '../../design-systems/lib/pages.mjs';
import {prepareSample,sendPublication} from '../../services/app/skills/artifactbin/scripts/publish.mjs';
const ROOT=path.resolve(import.meta.dirname,'../../services/app/skills/artifactbin'),BASE='https://example.test';
describe('native author resources',()=>{
 it('prepares real HTML, CSV and paired backend requests without leaking a credential',async()=>{
  for(const name of ['report','repairs-data','csv-dashboard','shared-app']){
   const saved=await prepareSample(name,BASE,'abc123');
   expect(saved).toMatchObject({server:BASE,method:'POST',idempotencyKey:expect.stringMatching(/^[a-z0-9-]{36}$/)});
   expect(JSON.stringify(saved)).not.toContain('ARTIFACTBIN_TOKEN');
   if(name==='repairs-data'){expect(saved.body.dataset).toContain('week,completed,waiting');continue;}
   expect(saved.body.html).toMatch(/^<!doctype html>/);
   expect(saved.body.html).not.toMatch(/\sclassName="|<Helmet>|DATASET_ID/);
   expect(saved.body.html).toContain('data-af="core"');
   expect(saved.body.html).toContain("from '@afbin/apollo'");
   const document=new JSDOM(saved.body.html).window.document;expect(document.doctype?.name).toBe('html');expect(document.documentElement.lang).toBe('en');
   if(name==='csv-dashboard')expect(saved.body.html).toContain('href="ref:abc123"');
   if(name==='shared-app')expect(saved.body.backendSources.garden).toContain('@auth(role:EDITOR)');
  }
  await expect(prepareSample('csv-dashboard',BASE)).rejects.toThrow('real returned dataset ID');
 });
 it('replays the exact saved request and blocks cross-origin credentials or redirects',async()=>{
  const saved=await prepareSample('report',BASE),requests=[];
  const fetcher=async(url,input)=>{requests.push({url,input});return Response.json({id:'abc123',url:BASE+'/a/abc123'});};
  const env={ARTIFACTBIN_URL:BASE,ARTIFACTBIN_TOKEN:'test-only-token'};
  await sendPublication(saved,env,fetcher);await sendPublication(saved,env,fetcher);
  expect(requests[0]).toEqual(requests[1]);expect(requests[0].input.redirect).toBe('error');
  expect(requests[0].input.headers['Idempotency-Key']).toBe(saved.idempotencyKey);
  await expect(sendPublication(saved,{...env,ARTIFACTBIN_URL:'https://other.example'},fetcher)).rejects.toThrow('origin-matched');
  expect(requests).toHaveLength(2);
 });
 it('refuses to overwrite a prepared request so retries keep their identity',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-author-')),output=path.join(dir,'request.json'),helper=path.join(ROOT,'scripts/publish.mjs');
  try{
   execFileSync(process.execPath,[helper,'--prepare','report','--server',BASE,'--output',output]);
   const original=await readFile(output,'utf8');
   expect(()=>execFileSync(process.execPath,[helper,'--prepare','report','--server',BASE,'--output',output],{stdio:'pipe'})).toThrow();
   expect(await readFile(output,'utf8')).toBe(original);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('generates every native design guide and stylesheet from the retained specification',async()=>{
  for(const slug of ROSTER){
   const guide=nativeSystemMd(slug);expect(Buffer.byteLength(guide)).toBeLessThanOrEqual(8192);
   expect(await readFile(path.join(ROOT,`references/html-system-${slug}.md`),'utf8')).toBe(guide);
   expect(await readFile(path.join(ROOT,`design-systems/${slug}.css`),'utf8')).toBe(nativeSystemCss(slug));
  }
 });
});
