/** Self-contained candidate reader gate, with optional paired reader evidence.
 * Must run inside scripts/gate-container.mjs.
 * COMPONENT_BASELINE__INPUT names a JSON file with implementation, sourceRevision,
 * output and entries [{fixture,theme,url}]. Every URL must be a real local /raw
 * reader produced by that revision's normal HTTP publication API. */
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {publishReaderManifest} from '../component-baseline-publish.mjs';
import { launchChromium } from './lib/browser.mjs';
import { captureBrowserBaseline, compareBrowserBaselines, candidateCaptureIssues } from '../lib/component-browser-baseline.mjs';
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
  for(const file of ['scripts/fixtures/component-baseline/index.mjs','scripts/fixtures/component-baseline/publication.mjs',...((await readdir(path.join(repo,'services/app/lib/html-components'))).filter(name=>name.endsWith('.ts')).sort().map(name=>'services/app/lib/html-components/'+name))])sourceHash.update(file).update(await readFile(path.join(repo,file)));
  input=await publishReaderManifest({implementation:'html',base:process.argv[2]||'http://localhost:3030',source:repo,sourceRevision:'candidate-source-sha256:'+sourceHash.digest('hex'),output:path.join(output,'candidate-readers.json')});
  input.defaultCandidateValidation=true;
}
if(input.mode==='publish') {
  await publishReaderManifest(input);
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
const browser=await launchChromium();
try {
  const captures=await captureBrowserBaseline({...input,browser,mount:async({fixture,theme,page})=>{
    const entry=input.entries.find(entry=>entry.fixture===fixture.id&&entry.theme===theme);
    if(!entry)throw Error(`Missing real reader URL for ${fixture.id}/${theme}`);
    const url=new URL(entry.url);
    if(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me'))throw Error('Only isolated local reader URLs are allowed');
    if(!url.pathname.endsWith('/raw'))throw Error('Capture the raw production reader without platform chrome');
    await page.goto(url.href,{waitUntil:'networkidle'});
    return {frame:page.mainFrame(),ready:async()=>{
      if(input.implementation==='html')await page.waitForFunction(()=>document.documentElement.dataset.baselineReady==='yes');
      else await page.waitForFunction(()=>document.querySelector('[data-mx-inline-story]'));
    }};
  }});
  const files=await readdir(input.output);
  const evidence=await Promise.all(files.filter(file=>file.endsWith('.png')||file.endsWith('-captures.json')).map(async name=>({name,base64:(await readFile(path.join(input.output,name))).toString('base64')})));
  console.log('COMPONENT_BASELINE_EVIDENCE_GZIP_BASE64 '+gzipSync(Buffer.from(JSON.stringify({format:'component-baseline-files-v1',files:evidence}))).toString('base64'));
  const issues=input.defaultCandidateValidation?candidateCaptureIssues(captures):captures.flatMap(capture=>capture.errors);
  if(issues.length)throw Error('Reader capture failures: '+issues.join('; '));
  console.log(`Captured ${captures.length} actual ${input.implementation} reader states; no visual parity claim made.`);
} finally {await browser.close();}
