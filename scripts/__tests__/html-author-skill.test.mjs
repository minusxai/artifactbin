import {installGateSkill} from '../lib/installed-gate-skill.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {nativeSystemCss} from '../../design-systems/lib/html-skill.mjs';
import {ROSTER} from '../../design-systems/lib/pages.mjs';
import {GET as skillArchive} from '../../services/app/app/skills/artifactbin.zip/route.ts';
import {pathToFileURL} from 'node:url';
const ROOT=path.resolve(import.meta.dirname,'../../services/app/skills/artifactbin'),BASE='https://example.test';
let installedDir,prepareSample,sendPublication;
beforeAll(async()=>{
 installedDir=await mkdtemp(path.join(tmpdir(),'native-author-installed-'));
 const zip=path.join(installedDir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request(BASE+'/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',installedDir]);
 ({prepareSample,sendPublication}=await import(pathToFileURL(path.join(installedDir,'artifactbin/scripts/publish.mjs')).href));
});
afterAll(async()=>{if(installedDir)await rm(installedDir,{recursive:true,force:true});});
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
  const dir=await mkdtemp(path.join(tmpdir(),'native-author-'));
  try{
   const output=path.join(dir,'request.json'),helper=path.join(installedDir,'artifactbin/scripts/publish.mjs');
   execFileSync(process.execPath,[helper,'--prepare','report','--server',BASE,'--output',output]);
   const original=await readFile(output,'utf8');
   expect(()=>execFileSync(process.execPath,[helper,'--prepare','report','--server',BASE,'--output',output],{stdio:'pipe'})).toThrow();
   expect(await readFile(output,'utf8')).toBe(original);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('generates every shipped design-system stylesheet from the retained specification',async()=>{
  for(const slug of ROSTER){
   expect(await readFile(path.join(ROOT,`design-systems/${slug}.css`),'utf8')).toBe(nativeSystemCss(slug));
   await expect(readFile(path.join(ROOT,`references/html-system-${slug}.md`),'utf8')).rejects.toThrow();
  }
 });
});

it('prepares an installed design-system stylesheet whose fonts stay on the platform /af/fonts/ addresses',async()=>{
 const archive=new Uint8Array(await (await skillArchive(new Request(BASE+'/skills/artifactbin.zip'))).arrayBuffer());
 const installed=await installGateSkill(archive,BASE);
 try{
  expect([...installed.files.keys()].some(name=>name.startsWith('fonts/'))).toBe(false);
  const sheet=Buffer.from(installed.files.get('design-systems/almanac.css')).toString();
  const refs=[...sheet.matchAll(/url\(['"]?([^)'"\s]+\.woff2)['"]?\)/g)].map(match=>match[1]);
  expect(refs.length).toBeGreaterThan(0);for(const ref of refs)expect(ref).toMatch(/^\/af\/fonts\/[a-z0-9-]+\.woff2$/);
  const html=`<!doctype html><html><head><link data-af="design-system" rel="stylesheet" href="./almanac.css"></head><body><h1>Platform fonts</h1></body></html>`;
  const prepared=await installed.prepare(html,'design-systems/gate-almanac.html');
  expect(prepared.body.publicationBundle.files.map(file=>file.path)).toEqual(['design-systems/almanac.css']);
 }finally{await installed.dispose();}
});
