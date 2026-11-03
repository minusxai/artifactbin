/** Self-contained candidate reader gate. Must run inside scripts/gate-container.mjs.
 * COMPONENT_BASELINE__INPUT optionally names a JSON file with implementation, sourceRevision,
 * output and entries [{fixture,theme,url}]; without one the gate publishes the catalogue through
 * the normal HTTP publication API. Every fixture is captured from its real local /raw reader. */
import assert from 'node:assert/strict';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {publishReaderManifest} from '../component-baseline-publish.mjs';
import {attachVerifiedComponentAssets,writeBaselineComponentAssets} from '../lib/component-baseline-input.mjs';
import {selectBaselineFixtures} from '../fixtures/component-baseline/publication.mjs';
import {browserParityFixtures} from '../fixtures/component-baseline/index.mjs';
import {settleInteraction} from '../fixtures/component-baseline/interaction.mjs';
import {richBaselineReadiness} from '../fixtures/component-baseline/rich.mjs';
import { launchChromium } from './lib/browser.mjs';
import { captureBrowserBaseline, candidateCaptureIssues } from '../lib/component-browser-baseline.mjs';
const repo=path.resolve(import.meta.dirname,'../..');
let input;
if(process.env.COMPONENT_BASELINE__INPUT)input=JSON.parse(await readFile(process.env.COMPONENT_BASELINE__INPUT,'utf8'));
else {
  const output=path.join(repo,'tmp/component-baseline');
  await mkdir(output,{recursive:true});
  // Containers carry a source snapshot without Git metadata. This identity is
  // deliberately not called a Git revision.
  const sourceHash=createHash('sha256');
  for(const file of [...((await readdir(path.join(repo,'scripts/fixtures/component-baseline'))).filter(name=>/\.(mjs|ts)$/.test(name)).sort().map(name=>'scripts/fixtures/component-baseline/'+name)),...((await readdir(path.join(repo,'services/app/lib/html-components'))).filter(name=>name.endsWith('.ts')).sort().map(name=>'services/app/lib/html-components/'+name))])sourceHash.update(file).update(await readFile(path.join(repo,file)));
  input=await publishReaderManifest({implementation:'html',base:process.argv[2]||'http://localhost:3030',source:repo,sourceRevision:'candidate-source-sha256:'+sourceHash.digest('hex'),output:path.join(output,'candidate-readers.json')});
  input.defaultCandidateValidation=true;
}
if(process.env.COMPONENT_BASELINE__OUTPUT)input.output=process.env.COMPONENT_BASELINE__OUTPUT;
input=await attachVerifiedComponentAssets(input,{source:input.source||repo,base:process.argv[2]||input.base||'http://localhost:3030'});
await writeBaselineComponentAssets(input);
// Match the existing real-library gate's software WebGL configuration.
const browsers=[];
try {
  for(let worker=0;worker<2;worker++)browsers.push(await launchChromium({args:['--enable-unsafe-swiftshader']}));
  const browser=browsers[0];
  const fixtures=selectBaselineFixtures(browserParityFixtures,input.fixtureIds);
  const captures=await captureBrowserBaseline({...input,browser,workerBrowsers:browsers,fixtures,mount:async({fixture,theme,page})=>{
    const entry=input.entries.find(entry=>entry.fixture===fixture.id&&entry.theme===theme);
    if(!entry)throw Error(`Missing real reader URL for ${fixture.id}/${theme}`);
    const url=new URL(entry.url);
    // The viewer's light/dark choice, as the reader hands it to a framed page (the core reads ?mx-mode=).
    if(input.implementation==='html')url.searchParams.set('mx-mode',theme);
    if(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me'))throw Error('Only isolated local reader URLs are allowed');
    if(!url.pathname.endsWith('/raw'))throw Error('Capture the declared real reader mode');
    await page.goto(url.href,{waitUntil:'networkidle'});
    const frame=page.mainFrame();
    return {frame,ready:async()=>{
      if(input.implementation==='html')await frame.waitForFunction(()=>document.documentElement.dataset.baselineReady==='yes');
      else await frame.waitForFunction(()=>document.querySelector('[data-mx-inline-story]'));
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
  console.log(`Captured ${captures.length} actual ${input.implementation} reader states.`);
} finally {await Promise.allSettled(browsers.map(browser=>browser.close()));}
