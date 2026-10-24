/** Optional paired reader evidence. Must run inside scripts/gate-container.mjs.
 * COMPONENT_BASELINE__INPUT names a JSON file with implementation, sourceRevision,
 * output and entries [{fixture,theme,url}]. Every URL must be a real local /raw
 * reader produced by that revision's normal HTTP publication API. */
import { readFile } from 'node:fs/promises';
import { launchChromium } from './lib/browser.mjs';
import { captureBrowserBaseline, compareBrowserBaselines } from '../lib/component-browser-baseline.mjs';
const inputFile=process.env.COMPONENT_BASELINE__INPUT;
if(!inputFile)throw Error('COMPONENT_BASELINE__INPUT manifest is required; this gate does not fabricate baseline fixtures');
const input=JSON.parse(await readFile(inputFile,'utf8'));
if(input.mode==='publish') {
  const {publishReaderManifest}=await import('../component-baseline-publish.mjs');
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
  if(captures.some(capture=>capture.errors.length))throw Error('Reader captures contain page errors; inspect capture manifest');
  console.log(`Captured ${captures.length} actual ${input.implementation} reader states; no visual parity claim made.`);
} finally {await browser.close();}
