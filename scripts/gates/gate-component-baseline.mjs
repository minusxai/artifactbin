/** Self-contained candidate reader gate, with optional paired reader evidence.
 * Must run inside scripts/gate-container.mjs.
 * COMPONENT_BASELINE__INPUT names a JSON file with implementation, sourceRevision,
 * output and entries [{fixture,theme,url}]. Static fixtures use real local /raw
 * readers; authenticated identity fixtures use the real app shell and document
 * iframe. Every reader comes from the normal HTTP publication API. */
import assert from 'node:assert/strict';
import {loadNativeMigrationCaptureBatch,runNativeMigrationCaptureBatch} from '../lib/native-migration-batch-camera.mjs';
import {runNativeMigrationPilot} from '../lib/native-migration-pilot.mjs';
import {nativeMigrationBrowserContext} from '../lib/native-migration-browser-context.mjs';
import {createBaselineSession} from '../lib/component-baseline-session.mjs';
import {connectAgent,signInAccount} from './lib/account-connection.mjs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publishReaderManifest} from '../component-baseline-publish.mjs';
import {attachVerifiedComponentAssets,writeBaselineComponentAssets} from '../lib/component-baseline-input.mjs';
import {selectBaselineFixtures} from '../fixtures/component-baseline/publication.mjs';
import {browserParityFixtures} from '../fixtures/component-baseline/index.mjs';
import {settleInteraction} from '../fixtures/component-baseline/interaction.mjs';
import {identityBrowserParityFixtures,identityBaselineReadiness} from '../fixtures/component-baseline/identity.mjs';
import {richBaselineReadiness} from '../fixtures/component-baseline/rich.mjs';
import {withComponentBaselineEvidence} from '../lib/component-baseline-evidence.mjs';
import {documentFrame,DOCUMENT_FRAME} from './lib/page-facts.mjs';
import { launchChromium } from './lib/browser.mjs';
import { captureBrowserBaseline, compareBrowserBaselines, candidateCaptureIssues } from '../lib/component-browser-baseline.mjs';
if(process.env.NATIVE_MIGRATION_BATCH__ROOT){
 const output=process.env.NATIVE_MIGRATION_BATCH__OUTPUT;
 await mkdir(output,{recursive:true,mode:0o700});
 const admitted=await loadNativeMigrationCaptureBatch({root:process.env.NATIVE_MIGRATION_BATCH__ROOT,output});
 const browserContext=nativeMigrationBrowserContext(process.argv[2]||'http://localhost:3030',admitted.entries.map(entry=>entry.input.preparedStore.reader.pageId));
 await writeFile(path.join(output,'browser-context.json'),JSON.stringify(browserContext,null,2),{flag:'wx',mode:0o600});
 const browser=await launchChromium({channel:browserContext.channel,args:['--enable-unsafe-swiftshader',...browserContext.args]});
 try{
  const report=await runNativeMigrationCaptureBatch(admitted,{base:process.argv[2]||'http://localhost:3030',browser,connectAgent});
  await mkdir(output,{recursive:true,mode:0o700});await writeFile(path.join(output,'batch-capture.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  if(!report.complete)throw Error('Native migration batch incomplete; consult private per-head evidence');
 }finally{await browser.close();}
 process.exit(0);
}
if(process.env.NATIVE_MIGRATION_PILOT__INPUT){
 const input=JSON.parse(await readFile(process.env.NATIVE_MIGRATION_PILOT__INPUT,'utf8'));
 const browserContext=nativeMigrationBrowserContext(process.argv[2]||'http://localhost:3030',input.preparedStore?[input.preparedStore.reader.pageId]:[]);
 await mkdir(process.env.NATIVE_MIGRATION_PILOT__OUTPUT,{recursive:true,mode:0o700});
 await writeFile(path.join(process.env.NATIVE_MIGRATION_PILOT__OUTPUT,'browser-context.json'),JSON.stringify(browserContext,null,2),{flag:'wx',mode:0o600});
 const browser=await launchChromium({channel:browserContext.channel,args:['--enable-unsafe-swiftshader',...browserContext.args]});
 try{await runNativeMigrationPilot({base:process.argv[2]||'http://localhost:3030',browser,connectAgent,paths:{input:process.env.NATIVE_MIGRATION_PILOT__INPUT,canonical:process.env.NATIVE_MIGRATION_PILOT__CANONICAL,recovery:process.env.NATIVE_MIGRATION_PILOT__RECOVERY,bundle:process.env.NATIVE_MIGRATION_PILOT__BUNDLE,output:process.env.NATIVE_MIGRATION_PILOT__OUTPUT}});console.log('Native migration pilot capture complete; private evidence written to the explicit output directory. No paired parity claim made.');}
 catch(error){const output=process.env.NATIVE_MIGRATION_PILOT__OUTPUT;if(output){await mkdir(output,{recursive:true,mode:0o700});await writeFile(path.join(output,'migration-pilot-failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2),{mode:0o600});}throw Error('Native migration pilot failed; consult the explicit private evidence directory');}
 finally{await browser.close();}
 process.exit(0);
}
const repo=path.resolve(import.meta.dirname,'../..');
const optionalConfig=path.join(repo,'scripts/fixtures/component-baseline/run.json');
let input;
try { input=JSON.parse(await readFile(process.env.COMPONENT_BASELINE__INPUT||optionalConfig,'utf8')); }
catch(error) {
  if(process.env.COMPONENT_BASELINE__INPUT||error.code!=='ENOENT')throw error;
  const output=path.join(repo,'tmp/component-baseline');
  await mkdir(output,{recursive:true});
  // Containers carry a source snapshot without Git metadata. This identity is
  // deliberately not called a Git revision and is ineligible for paired proof.
  const sourceHash=createHash('sha256');
  for(const file of [...((await readdir(path.join(repo,'scripts/fixtures/component-baseline'))).filter(name=>/\.(mjs|ts)$/.test(name)).sort().map(name=>'scripts/fixtures/component-baseline/'+name)),...((await readdir(path.join(repo,'services/app/lib/html-components'))).filter(name=>name.endsWith('.ts')).sort().map(name=>'services/app/lib/html-components/'+name))])sourceHash.update(file).update(await readFile(path.join(repo,file)));
  input=await publishReaderManifest({implementation:'html',base:process.argv[2]||'http://localhost:3030',source:repo,sourceRevision:'candidate-source-sha256:'+sourceHash.digest('hex'),output:path.join(output,'candidate-readers.json')});
  input.defaultCandidateValidation=true;
}
const importedReaderEntries=Boolean(input.entries);
if(process.env.COMPONENT_BASELINE__OUTPUT)input.output=process.env.COMPONENT_BASELINE__OUTPUT;
if(input.mode==='publish') {
  await publishReaderManifest(input);
  process.exit(0);
}
if(input.mode==='upload') {
 const {runUploadBaseline}=await import('../lib/component-upload-baseline.mjs');
 const {signInAccount}=await import('./lib/account-connection.mjs');
 const browser=await launchChromium();
 try{await runUploadBaseline({...input,base:process.argv[2]||input.base||'http://localhost:3030',browser,connectAgent,signInAccount});}
 finally{await browser.close();}
 process.exit(0);
}
if(input.mode==='compare') {
  const [baseline,candidate]=await Promise.all([readFile(input.baseline,'utf8').then(JSON.parse),readFile(input.candidate,'utf8').then(JSON.parse)]);
  const results=await compareBrowserBaselines({...input,baseline,candidate});
  const unequal=results.filter(result=>result.error||!result.sizeEqual||result.changedPixels!==0||!result.behaviorEqual||result.baselineErrors.length||result.candidateErrors.length);
  console.log(`${results.length} paired states; ${unequal.length} unequal or incomplete.`);
  process.exit(unequal.length?1:0);
}
if(!input.entries) {
  const evidenceOutput=input.output;
  await mkdir(evidenceOutput,{recursive:true});
  input=await publishReaderManifest({...input,base:process.argv[2]||input.base||'http://localhost:3030',source:input.source||repo,output:path.join(evidenceOutput,'readers.json')});
  input.output=evidenceOutput;
}
if(importedReaderEntries)input=await attachVerifiedComponentAssets(input,{source:input.source||repo,base:process.argv[2]||input.base||'http://localhost:3030'});
await writeBaselineComponentAssets(input);
// Match the existing real-library gate's software WebGL configuration.
await withComponentBaselineEvidence({output:input.output,run:async()=>{
const browsers=[];
try {
  for(let worker=0;worker<2;worker++)browsers.push(await launchChromium({args:['--enable-unsafe-swiftshader']}));
  const browser=browsers[0];
  if(input.fixtureSet==='identity'&&!input.account)throw Error('Real identity fixtures require a verified disposable account');
  const session=input.account?await createBaselineSession({base:new URL(input.entries[0].url).origin,account:input.account,signIn:signInAccount}):null;
  const fixtures=selectBaselineFixtures(input.fixtureSet==='identity'?identityBrowserParityFixtures:browserParityFixtures,input.fixtureIds);
  const captures=await captureBrowserBaseline({...input,browser,workerBrowsers:browsers,fixtures,mount:async({fixture,theme,page})=>{
    const entry=input.entries.find(entry=>entry.fixture===fixture.id&&entry.theme===theme);
    if(!entry)throw Error(`Missing real reader URL for ${fixture.id}/${theme}`);
    const url=new URL(entry.url);
    // The viewer's light/dark choice, as the reader hands it to a framed page (the core reads ?mx-mode=).
    if(input.implementation==='html')url.searchParams.set('mx-mode',theme);
    if(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me'))throw Error('Only isolated local reader URLs are allowed');
    const framed=input.fixtureSet==='identity';
    if(framed?!/^\/a\/[a-zA-Z0-9]+$/.test(url.pathname):!url.pathname.endsWith('/raw'))throw Error('Capture the declared real reader mode');
    if(session){if(url.origin!==new URL(input.entries[0].url).origin)throw Error('Authenticated readers must share the login origin');await session.mount(page);}
    // The trusted shell starts live readers; document/frame readiness, below,
    // owns completion rather than waiting for those transports to become idle.
    await page.goto(url.href,{waitUntil:framed?'domcontentloaded':'networkidle'});
    const frame=framed?await documentFrame(page):page.mainFrame();
    if(framed&&frame===page.mainFrame())throw Error('Authenticated identity requires the real isolated document frame');
    return {frame,...(framed?{screenshot:()=>page.locator(DOCUMENT_FRAME).screenshot({animations:'disabled',caret:'hide'})}:{}),ready:async()=>{
      if(input.implementation==='html')await frame.waitForFunction(()=>document.documentElement.dataset.baselineReady==='yes');
      else await frame.waitForFunction(()=>document.querySelector('[data-mx-inline-story]'));
      if(input.fixtureSet==='identity')await frame.waitForFunction(identityBaselineReadiness[fixture.id],undefined,{timeout:30_000});
      const engineReady=richBaselineReadiness[fixture.id]?.[input.implementation];
      if(engineReady)await frame.waitForFunction(engineReady,undefined,{timeout:30_000});
    },afterAction:async action=>{
      await settleInteraction({fixture,action,frame,implementation:input.implementation});
      if(fixture.id==='date-picker-fixed'&&action.action==='click'&&action.name==='')await frame.getByRole('button',{name:'2024-06-16',exact:true}).waitFor();
      if(fixture.id==='tooltip-keyboard'&&action.action==='focus')await frame.getByRole('tooltip').waitFor();
    }};
  }});
  const issues=input.defaultCandidateValidation?candidateCaptureIssues(captures):captures.flatMap(capture=>[...capture.errors,...(capture.assertionErrors||[]),...(capture.fontEvidence?.errors||[]),...(capture.resourceEvidence?.errors||[])]);
  assert.equal(issues.length,0,'Reader capture failures: '+issues.join('; '));
  console.log(`Captured ${captures.length} actual ${input.implementation} reader states; no visual parity claim made.`);
} finally {await Promise.allSettled(browsers.map(browser=>browser.close()));}
}});
