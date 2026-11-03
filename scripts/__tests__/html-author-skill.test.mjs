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
let installedDir,prepareBundle;
/** A documented HTML sample as a saved publication request, its dataset links pointing at `datasetId`. */
const prepareSample=async(name,datasetId='abc123')=>{
 const root=path.join(installedDir,'artifactbin'),entry=`examples/${name}.html`;
 const html=(await readFile(path.join(root,entry),'utf8')).replaceAll('ref:DATASET_ID',`ref:${datasetId}`).replaceAll('ref:TARGETS_ID',`ref:${datasetId}`);
 return prepareBundle({root,entry,server:BASE,entryHtml:html});
};
beforeAll(async()=>{
 installedDir=await mkdtemp(path.join(tmpdir(),'native-author-installed-'));
 const zip=path.join(installedDir,'skill.zip');await writeFile(zip,new Uint8Array(await (await skillArchive(new Request(BASE+'/skills/artifactbin.zip'))).arrayBuffer()));execFileSync('unzip',['-q',zip,'-d',installedDir]);
 ({prepareBundle}=await import(pathToFileURL(path.join(installedDir,'artifactbin/scripts/toolbox-publication-bundle.mjs')).href));
});
afterAll(async()=>{if(installedDir)await rm(installedDir,{recursive:true,force:true});});
describe('native author resources',()=>{
 it('prepares real HTML and paired resolver requests without leaking a credential',async()=>{
  for(const name of ['report','csv-dashboard','shared-app']){
   const saved=await prepareSample(name);
   expect(saved).toMatchObject({server:BASE,method:'POST',idempotencyKey:expect.stringMatching(/^[a-z0-9-]{36}$/)});
   expect(JSON.stringify(saved)).not.toContain('ARTIFACTBIN_TOKEN');
   expect(saved.body.html).toMatch(/^<!doctype html>/);
   expect(saved.body.html).not.toMatch(/\sclassName="|<Helmet>|DATASET_ID/);
   expect(saved.body.html).not.toContain('core.js');expect(saved.body.html).toContain('artifactbin:design-system');
   expect(saved.body.html).toContain("from '@afbin/apollo'");
   const document=new JSDOM(saved.body.html).window.document;expect(document.doctype?.name).toBe('html');expect(document.documentElement.lang).toBe('en');
   if(name==='csv-dashboard')expect(saved.body.html).toContain('href="ref:abc123"');
   if(name==='shared-app'){const budget=saved.body.publicationBundle.files.find(file=>file.path==='examples/budget.ts');expect(Buffer.from(budget.base64,'base64').toString()).toContain('@auth(role:signed_in)');expect(saved.body.html).toContain('href="ref:abc123"');}
  }
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
