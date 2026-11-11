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
 // The dashboard links its CSV by path; the skill ships the generator, so write the sample beside the page.
 if(name==='csv-dashboard')await writeFile(path.join(root,'examples/deliveries.csv'),execFileSync(process.execPath,[path.join(root,'examples/gen-deliveries.mjs')],{stdio:['ignore','pipe','ignore']}));
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
  for(const name of ['report','csv-dashboard','tracker']){
   const saved=await prepareSample(name);
   expect(saved).toMatchObject({server:BASE,method:'POST',idempotencyKey:expect.stringMatching(/^[a-z0-9-]{36}$/)});
   expect(JSON.stringify(saved)).not.toContain('ARTIFACTBIN_TOKEN');
   expect(saved.body.html).toMatch(/^<!doctype html>/);
   expect(saved.body.html).not.toMatch(/\sclassName="|<Helmet>|DATASET_ID/);
   expect(saved.body.html).not.toContain('core.js');expect(saved.body.html).toContain('artifactbin:design-system');
   // The dashboard's script is its own module, bundled beside the page it loads from.
   const script=name==='csv-dashboard'?Buffer.from(saved.body.publicationBundle.files.find(file=>file.path==='examples/csv-dashboard.mjs').base64,'base64').toString():saved.body.html;
   if(name==='csv-dashboard')expect(saved.body.html).toContain('<script type="module" src="./csv-dashboard.mjs"');
   // Data starters read with sql from @afbin/apollo; the report keeps its viewer state in @afbin/state.
   expect(script).toContain(name==='report'?"from '@afbin/state'":"from '@afbin/apollo'");
   const document=new JSDOM(saved.body.html).window.document;expect(document.doctype?.name).toBe('html');expect(document.documentElement.lang).toBe('en');
   if(name==='csv-dashboard')expect(saved.body.publicationBundle.files.map(file=>file.path)).toContain('examples/deliveries.csv');
   if(name==='tracker'){expect(saved.body.publicationBundle.files.map(file=>file.path)).not.toContain('examples/tracker.ts');expect(saved.body.html).toContain('href="ref:abc123"');}
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
