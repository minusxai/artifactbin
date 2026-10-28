import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {JSDOM} from 'jsdom';
import {browserParityFixtures,parityThemes} from '../fixtures/component-baseline/index.mjs';
import { actionTarget, captureBrowserBaseline, compareBrowserBaselines, candidateCaptureIssues, comparableBehavior, stateExpectationIssues, fontLoadingEvidence, fontByteProof, settleFiniteFrameAnimations } from '../lib/component-browser-baseline.mjs';
import {builtComponentFiles,verifyComponentAssetArchive} from '../lib/component-asset-proof.mjs';
import {installedFiles,componentImport} from '../fixtures/component-baseline/publication.mjs';
const repo=path.resolve(import.meta.dirname,'../..');
const directories=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
const noAnimations=()=>({format:'frame-animation-settlement-v1',policy:'document-and-open-shadow-roots;finite-current-and-chained;two-frame-quiescence',shadowCoverage:'open-shadow-roots-only',shadowRoots:0,reducedMotion:false,startedAtMs:0,completedAtMs:0,elapsedMs:0,observed:0,uniqueAnimations:0,rounds:1,alreadyFinished:0,alreadyIdle:0,paused:[],infinite:[],counts:{finished:0,canceled:0,detached:0},timedOut:[]});
async function capture(directory,implementation,color,overrides={}){
  const screenshot=`${implementation}.png`;
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:color}}).png().toBuffer();
  await writeFile(path.join(directory,screenshot),bytes);
  return {fixture:'button',theme:'light',viewport:{width:800,height:600},state:'initial',implementation,fixtureHash:'same-input',sourceRevision:'a'.repeat(40),screenshotMode:'viewport',screenshot,screenshotSha256:createHash('sha256').update(bytes).digest('hex'),semantics:{text:'Continue'},errors:[],...overrides};
}
async function setup(){const directory=await mkdtemp(path.join(tmpdir(),'component-baseline-'));directories.push(directory);return directory;}
describe('paired real reader evidence comparison',()=>{
  it('reports actual pixel and behavior differences and saves a diagnostic diff',async()=>{
    const directory=await setup();
    const original=await capture(directory,'jsx','white');
    const candidate=await capture(directory,'html','black',{semantics:{text:'Changed'}});
    const [result]=await compareBrowserBaselines({baseline:[original],candidate:[candidate],baselineDirectory:directory,candidateDirectory:directory,output:directory});
    expect(result).toMatchObject({changedPixels:4,changedFraction:1,behaviorEqual:false,sizeEqual:true});
    expect((await readFile(path.join(directory,'button-light-800x600-initial-diff.png'))).length).toBeGreaterThan(0);
  });
  it('refuses missing cases and changed fixture inputs as parity evidence',async()=>{
    const directory=await setup();const original=await capture(directory,'jsx','white');const candidate=await capture(directory,'html','white',{fixtureHash:'different-input'});
    const options={baseline:[original],baselineDirectory:directory,candidateDirectory:directory,output:directory};
    expect((await compareBrowserBaselines({...options,candidate:[]}))[0].error).toContain('Missing candidate');
    expect((await compareBrowserBaselines({...options,candidate:[candidate]}))[0].error).toContain('Unmatched');
  });
  it('rejects modified images rather than trusting the evidence manifest',async()=>{
    const directory=await setup();const original=await capture(directory,'jsx','white');const candidate=await capture(directory,'html','white');
    await writeFile(path.join(directory,candidate.screenshot),'changed');
    await expect(compareBrowserBaselines({baseline:[original],candidate:[candidate],baselineDirectory:directory,candidateDirectory:directory,output:directory})).rejects.toThrow('hash mismatch');
  });
});

describe('default candidate reader gate',()=>{
  it('uses the accessible select name when the theme uppercases its visible label',()=>{
    expect(candidateCaptureIssues([{fixture:'select',state:'initial',errors:[],semantics:{text:'PERSON Ada',controls:[{role:'button',name:'Person'}],rows:[],overflow:0}}])).toEqual([]);
  });
  it('fails when the real reader does not open a dialog or render table rows',()=>{
    const empty={text:'',controls:[],rows:[],overflow:0};
    expect(candidateCaptureIssues([{fixture:'dialog',state:'open',semantics:empty,errors:[]}])).toContain('dialog: did not open');
    expect(candidateCaptureIssues([{fixture:'data-table',state:'initial',semantics:{...empty,text:'Ada Grace Linus'},errors:[]}])).toContain('data-table: expected header and three rows');
  });
  it('checks the result of tab keyboard navigation rather than only page errors',()=>{
    const capture={fixture:'tabs',state:'arrow-right',semantics:{text:'First panel',controls:[],rows:[],overflow:0},errors:[]};
    expect(candidateCaptureIssues([capture])).toContain('tabs/arrow-right: missing Second panel');
    capture.semantics.text='Second panel';
    expect(candidateCaptureIssues([capture])).toEqual([]);
  });
});

let actualArchive;
async function loadCandidateArchive(){
  const {GET}=await import('../../services/app/app/skills/artifactbin.zip/route.ts');
  const response=await GET(new Request('https://example.test/skills/artifactbin.zip'));
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}
async function candidateArchive(){
  if(!actualArchive)actualArchive=(async()=>{
    // Components are platform-hosted: prove the local hosted modules match their sources, then load the
    // (component-free) archive whose publication helper the fixtures run.
    const verify=async()=>verifyComponentAssetArchive({root:repo,files:await builtComponentFiles({root:repo})});
    try{await verify();}
    catch(error){
      if(!/^(?:Missing component build proof|Stale component build:|Served component module closure differs from build|Served component bytes differ from build:)/.test(error.message))throw error;
      // Refresh only a missing or stale component build; any other proof failure stays fatal.
      execFileSync(process.execPath,[path.join(repo,'scripts/build/build-html-components.mjs')],{cwd:repo,stdio:'pipe'});
      await verify();
    }
    const archive=await loadCandidateArchive();
    expect([...installedFiles(archive).keys()].filter(name=>/^components\/.+\.js$/.test(name))).toEqual([]);
    return archive;
  })();
  return actualArchive;
}

describe('actual fixture publication payloads',()=>{
  // A missing or source-stale component build is rebuilt once here, outside the per-test publication budgets.
  beforeAll(()=>candidateArchive(),180_000);
  it('declares an actual dataset and string state for original upload markup',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const bodies=[];
    const entries=await publishBaselineFixtures({implementation:'jsx',publish:async body=>{bodies.push(body);return {id:body.dataset?'Dataset123':'Page123'};}});
    expect(entries).toHaveLength(browserParityFixtures.length*parityThemes.length);
    expect(bodies.filter(body=>body.dataset)).toHaveLength(1);
    const upload=bodies.find(body=>body.markup?.includes('<FileUpload'));
    expect(upload.markup).toContain('src="ref:Dataset123"');
    expect(upload.markup).toContain('name="refs" type="string"');
    expect(upload.markup).not.toContain('{{uploadDataset}}');
    expect(upload.theme).toBe('almanac');
  });
  it('publishes every candidate importing the hosted components and uploading none of them, within the real API limits',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const skillArchive=await candidateArchive();
    const {planPublicationBundle}=await import('../../services/app/lib/html-publication-bundle/plan.ts');
    const {publishBundleDependencies}=await import('../../services/app/lib/html-publication-bundle/execute.ts');
    const bodies=[],keys=new Set();let created=0,reused=0;
    await publishBaselineFixtures({implementation:'html',skillArchive,serverOrigin:'https://example.test',publish:async(body,request)=>{
      expect(body.publicationBundle).toBeDefined();expect(request.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);keys.add(request.idempotencyKey);
      const plan=planPublicationBundle(body.html,body.publicationBundle);expect(Buffer.byteLength(body.html)).toBeLessThan(4_000_000);
      // Each fixture module loads by its hosted name (legacy wrappers by /af/components/ URL); nothing component-shaped is uploaded.
      const fixture=browserParityFixtures[Math.floor(bodies.length/parityThemes.length)];
      for(const name of fixture.modules)expect(body.html).toContain(componentImport(name));
      expect(body.html).not.toMatch(/\bregister[A-Z]|\.\/components\//);
      expect(body.publicationBundle.files.map(file=>file.path)).toEqual([]);expect(plan.dependencies).toEqual([]);
      // The platform serves the design system and its fonts: the page names it and uploads neither.
      expect(body.publicationBundle.files.filter(file=>file.path.startsWith('fonts/')||file.path.startsWith('design-systems/'))).toHaveLength(0);
      expect(body.html).toContain('<meta name="artifactbin:design-system" content="almanac">');expect(body.html).not.toContain('design-systems/almanac.css');
      expect(Object.keys(body.publicationBundle.mappings).every(name=>body.publicationBundle.files.some(file=>file.path===name))).toBe(true);
      const result=await publishBundleDependencies(plan,request.idempotencyKey,{create:async()=>{const id='Asset'+(++created);return {id,revision:'v1',address:'/assets/'+id};},reuse:async(name,mapping)=>{reused++;return '/assets/'+mapping.id;}},body.publicationBundle.mappings);
      bodies.push(body);return {id:'Page123',dependencyReceipts:result.receipts};
    }});
    expect({created,reused}).toEqual({created:0,reused:0});
    expect(keys.size).toBe(browserParityFixtures.length*parityThemes.length);
    expect(bodies).toHaveLength(browserParityFixtures.length*parityThemes.length);
    expect(bodies.every(body=>body.html.includes('content="almanac"')&&!body.html.includes('data-af-design-system')&&body.html.includes('baselineReady'))).toBe(true);
  },30_000);
  it('reuses successful receipts only for reachable unchanged dependency closures',async()=>{
    const {dependencyReceiptCache}=await import('../fixtures/component-baseline/publication.mjs');
    const {publicationLocalReferences}=await import('../../services/app/skills/artifactbin/scripts/preview-html.mjs');
    const {createHash}=await import('node:crypto');const cache=dependencyReceiptCache(publicationLocalReferences);
    const file=(name,text,type='text/javascript')=>({path:name,contentType:type,base64:Buffer.from(text).toString('base64')});
    const first={files:[file('parent.js','import "./leaf.js"'),file('leaf.js','export const n=1'),file('other.js','export const n=0')]};
    const receipts=first.files.map(item=>({path:item.path,kind:'asset',id:item.path,revision:'v1',sha256:createHash('sha256').update(Buffer.from(item.base64,'base64')).digest('hex')}));
    expect(cache.mappings(first)).toEqual({});cache.record(first,{dependencyReceipts:receipts});
    const reachable={files:first.files.slice(0,2)};expect(Object.keys(cache.mappings(reachable))).toEqual(['parent.js','leaf.js']);
    const changed={files:[first.files[0],file('leaf.js','export const n=2')]};expect(cache.mappings(changed)).toEqual({});
    cache.record(changed,{dependencyReceipts:[{...receipts[1],revision:'bad'}]});expect(cache.mappings(changed)).toEqual({});
    expect(Object.keys(cache.mappings(reachable))).toEqual(['parent.js','leaf.js']);
    const fresh=dependencyReceiptCache(publicationLocalReferences);fresh.record(first,{});expect(fresh.mappings(first)).toEqual({});
  });
  it('refuses missing or malformed archives without falling back to source helpers or fonts',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');const publish=()=>{throw Error('must not publish');};
    for(const skillArchive of [undefined,new Uint8Array([1,2,3]),(await candidateArchive()).slice(0,100)])await expect(publishBaselineFixtures({implementation:'html',serverOrigin:'https://example.test',skillArchive,publish})).rejects.toThrow(/archive|ZIP/);
  });
  it('rejects traversal members before installing the archive',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const name=Buffer.from('artifactbin/../escape.mjs'),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(name.length,26);
    const skillArchive=Buffer.concat([header,name,Buffer.from([0x50,0x4b,0x01,0x02])]);
    await expect(publishBaselineFixtures({implementation:'html',skillArchive,publish:async()=>{throw Error('must not publish');}})).rejects.toThrow('Unsafe skill ZIP member');
  });
  it('publishes original JSX in an isolated old tree with no candidate helper or packages',async()=>{
    const {execFileSync}=await import('node:child_process'),root=await mkdtemp(path.join(tmpdir(),'old-component-publisher-'));try{
      const fixtureDir=path.join(root,'scripts/fixtures/component-baseline');await mkdir(fixtureDir,{recursive:true});
      for(const name of ['publication.mjs','index.mjs','controls.mjs','rich.mjs','interaction.mjs'])await copyFile(new URL('../fixtures/component-baseline/'+name,import.meta.url),path.join(fixtureDir,name));
      await writeFile(path.join(root,'verify.mjs'),'import {publishBaselineFixtures} from "./scripts/fixtures/component-baseline/publication.mjs";let count=0;const entries=await publishBaselineFixtures({implementation:"jsx",publish:async body=>{if(body.publicationBundle)throw Error("candidate payload entered old path");count++;return {id:body.dataset?"Dataset123":"Page123"};}});if(entries.length!==56||count!==57)throw Error("original fixture publication missing");process.stdout.write("original-complete");');
      expect(execFileSync(process.execPath,[path.join(root,'verify.mjs')],{cwd:root,encoding:'utf8'})).toContain('original-complete');
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('does not carry dependency receipts from a failed run into another publication',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');const skillArchive=await candidateArchive();
    let calls=0;
    await expect(publishBaselineFixtures({implementation:'html',skillArchive,serverOrigin:'https://example.test',publish:async body=>{calls++;expect(body.publicationBundle.mappings).toEqual({});throw Object.assign(Error('response failed'),{dependencyReceipts:[{path:'design-systems/almanac.css',kind:'asset',id:'Unconfirmed',revision:'v1'}]});}})).rejects.toThrow('response failed');
    await expect(publishBaselineFixtures({implementation:'html',skillArchive,serverOrigin:'https://example.test',publish:async body=>{calls++;expect(body.publicationBundle.mappings).toEqual({});throw Error('stopped before write');}})).rejects.toThrow('stopped before write');
    expect(calls).toBe(2);
  });
  it('removes the staged project and identifies the fixture when publication fails',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const before=new Set(await readdir(tmpdir())),skillArchive=await candidateArchive();
    await expect(publishBaselineFixtures({implementation:'html',skillArchive,serverOrigin:'https://example.test',publish:async()=>{throw Error('publication refused');}})).rejects.toThrow('Component fixture button light failed: publication refused');
    expect((await readdir(tmpdir())).filter(name=>name.startsWith('component-publication-')&&!before.has(name))).toEqual([]);
  });
});

describe('reader screenshot contract',()=>{
  it('waits for finite document animations and records completion, cancellation, reduced motion, and infinite motion',async()=>{
    const dom=new JSDOM('<div id="a"></div>',{url:'http://localhost/reader'}),target=dom.window.document.querySelector('#a');
    const make=(finished,iterations=1)=>({animationName:'fade-up',playState:'running',effect:{target,getComputedTiming:()=>({duration:100,iterations})},finished});
    const finished=make(Promise.resolve()),canceled=make(Promise.reject(Error('animation canceled'))),infinite=make(new Promise(()=>{}),Infinity);
    dom.window.document.getAnimations=()=>[finished,canceled,infinite];
    const oldDocument=globalThis.document,oldMatchMedia=globalThis.matchMedia;
    globalThis.document=dom.window.document;globalThis.matchMedia=()=>({matches:true});
    try{
      const evidence=await settleFiniteFrameAnimations({timeoutMs:50});
      expect(evidence).toMatchObject({format:'frame-animation-settlement-v1',reducedMotion:true,counts:{finished:1,canceled:1,detached:0},infinite:[{name:'fade-up',playState:'running',iterations:'infinite'}],timedOut:[]});
      expect(evidence.elapsedMs).toBeGreaterThanOrEqual(0);
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;if(oldMatchMedia)globalThis.matchMedia=oldMatchMedia;else delete globalThis.matchMedia;dom.window.close();}
  });

  it('does not wait for a detached target, including a target detached while finite animation is running',async()=>{
    const dom=new JSDOM('<div id="before"></div><div id="during"></div>',{url:'http://localhost/reader'}),doc=dom.window.document;
    const before=doc.querySelector('#before'),during=doc.querySelector('#during');let release;
    const animation=target=>({animationName:'fade-up',playState:'running',effect:{target,getComputedTiming:()=>({duration:100,iterations:1})},finished:new Promise(resolve=>{if(target===during)release=resolve;else resolve();})});
    const animations=[animation(before),animation(during)];doc.getAnimations=()=>animations;const oldDocument=globalThis.document;globalThis.document=doc;
    try{
      const pending=settleFiniteFrameAnimations({timeoutMs:100});during.remove();
      const evidence=await pending;expect(evidence.counts.detached).toBe(1);expect(evidence.counts.finished).toBe(1);expect(evidence.timedOut).toEqual([]);
      release?.();
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;dom.window.close();}
  });

  it('settles finite animations targeting connected shadow-root elements',async()=>{
    const dom=new JSDOM('<div id="host"></div>',{url:'http://localhost/reader'}),host=dom.window.document.querySelector('#host'),shadow=host.attachShadow({mode:'open'}),target=dom.window.document.createElement('span');shadow.append(target);
    const animation={animationName:'shadow-fade',playState:'running',effect:{target,getComputedTiming:()=>({duration:10,iterations:1})},finished:Promise.resolve()};
    dom.window.document.getAnimations=()=>[];shadow.getAnimations=()=>[animation];const oldDocument=globalThis.document;globalThis.document=dom.window.document;
    try{
      const evidence=await settleFiniteFrameAnimations({timeoutMs:100});
      expect(target.isConnected).toBe(true);
      expect(evidence).toMatchObject({policy:'document-and-open-shadow-roots;finite-current-and-chained;two-frame-quiescence',shadowCoverage:'open-shadow-roots-only',shadowRoots:1,uniqueAnimations:1,counts:{finished:1,detached:0},timedOut:[]});
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;dom.window.close();}
  });

  it('discovers animations recursively in nested open shadow roots',async()=>{
    const dom=new JSDOM('<div id="host"></div>',{url:'http://localhost/reader'}),outerHost=dom.window.document.querySelector('#host'),outer=outerHost.attachShadow({mode:'open'}),innerHost=dom.window.document.createElement('div');outer.append(innerHost);const inner=innerHost.attachShadow({mode:'open'}),nestedHost=dom.window.document.createElement('div');inner.append(nestedHost);const nested= nestedHost.attachShadow({mode:'open'}),target=dom.window.document.createElement('span');nested.append(target);
    const animation={animationName:'deep-shadow-fade',playState:'running',effect:{target,getComputedTiming:()=>({duration:10,iterations:1})},finished:Promise.resolve()};
    dom.window.document.getAnimations=()=>[];outer.getAnimations=()=>[];inner.getAnimations=()=>[];nested.getAnimations=()=>[animation];const oldDocument=globalThis.document;globalThis.document=dom.window.document;
    try{
      const evidence=await settleFiniteFrameAnimations({timeoutMs:100});
      expect(evidence).toMatchObject({shadowRoots:3,uniqueAnimations:1,counts:{finished:1,detached:0},timedOut:[]});
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;dom.window.close();}
  });

  it('observes removal inside an open shadow root while a finite animation is pending',async()=>{
    const dom=new JSDOM('<div id="host"></div>',{url:'http://localhost/reader'}),host=dom.window.document.querySelector('#host'),shadow=host.attachShadow({mode:'open'}),target=dom.window.document.createElement('span');shadow.append(target);
    const animation={animationName:'removed-shadow-fade',playState:'running',effect:{target,getComputedTiming:()=>({duration:1000,iterations:1})},finished:new Promise(()=>{})};
    dom.window.document.getAnimations=()=>[];shadow.getAnimations=()=>[animation];const oldDocument=globalThis.document;globalThis.document=dom.window.document;
    try{
      const pending=settleFiniteFrameAnimations({timeoutMs:100});target.remove();
      const evidence=await pending;
      expect(evidence.counts.detached).toBe(1);expect(evidence.timedOut).toEqual([]);
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;dom.window.close();}
  });

  it('resurveys animations after completion and waits for a chained finite animation',async()=>{
    const dom=new JSDOM('<div id="host"></div>',{url:'http://localhost/reader'}),target=dom.window.document.querySelector('#host');let calls=0,releaseChained;
    const first={animationName:'first',playState:'running',effect:{target,getComputedTiming:()=>({duration:10,iterations:1})},finished:Promise.resolve()};
    const chained={animationName:'chained',playState:'running',effect:{target,getComputedTiming:()=>({duration:10,iterations:1})},finished:new Promise(resolve=>{releaseChained=resolve;})};
    dom.window.document.getAnimations=()=>{calls++;if(calls===2)releaseChained();return calls<2?[first]:[first,chained];};
    const oldDocument=globalThis.document;globalThis.document=dom.window.document;
    try{
      const evidence=await settleFiniteFrameAnimations({timeoutMs:100});
      expect(calls).toBeGreaterThanOrEqual(3);
      expect(evidence).toMatchObject({uniqueAnimations:2,counts:{finished:2,detached:0},timedOut:[]});
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;dom.window.close();}
  });

  it('reports finite-animation timeout instead of finishing or freezing an animation',async()=>{
    const dom=new JSDOM('<div id="a"></div>',{url:'http://localhost/reader'}),target=dom.window.document.querySelector('#a');
    const animation={animationName:'stuck',playState:'running',effect:{target,getComputedTiming:()=>({duration:10000,iterations:1})},finished:new Promise(()=>{})};
    dom.window.document.getAnimations=()=>[animation];const oldDocument=globalThis.document;globalThis.document=dom.window.document;
    try{
      const evidence=await settleFiniteFrameAnimations({timeoutMs:10});
      expect(evidence.timedOut).toEqual([{name:'stuck',playState:'running',duration:10000,iterations:1}]);
      expect(animation.playState).toBe('running');
    }finally{if(oldDocument)globalThis.document=oldDocument;else delete globalThis.document;dom.window.close();}
  });

  it('fails the capture with source-bound timeout evidence before taking a screenshot',async()=>{
    const directory=await setup(),bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer(),screenshot=vi.fn(async()=>bytes);
    const timeout={...noAnimations(),observed:1,timedOut:[{name:'stuck',playState:'running',duration:10000,iterations:1}]};
    const frame={url:()=> 'http://fixture.lvh.me/reader',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?timeout:fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{stylesheets:[]}};
    const browser={newContext:async()=>({newPage:async()=>({on:()=>{},screenshot}),close:async()=>{}})};
    await expect(captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'html',sourceRevision:'a'.repeat(40),output:directory,animationSettleTimeoutMs:10,themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'timeout',states:[{id:'initial',actions:[]}]}]})).rejects.toThrow('finite-frame-animations-timeout:1');
    expect(screenshot).not.toHaveBeenCalled();
    const status=JSON.parse(await readFile(path.join(directory,'capture-status.json'),'utf8'));
    expect(status.failures[0]).toMatchObject({phase:'finite-animations',message:expect.stringContaining('finite-frame-animations-timeout:1')});
    const failure=JSON.parse(await readFile(path.join(directory,'timeout-light-800-initial-html-failure.json'),'utf8'));
    expect(failure.diagnostics.animationEvidence).toMatchObject({timedOut:timeout.timedOut,startedAtMs:0,completedAtMs:0});
  });

  it.each(['jsx','html'])('settles the actual frame before either %s camera screenshot',async implementation=>{
    const directory=await setup(),order=[],bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const frame={url:()=> 'http://fixture.lvh.me/reader',evaluate:async fn=>{if(fn.name==='settleFiniteFrameAnimations'){order.push('settled');return noAnimations();}if(fn.name==='browserState')return {text:'Ready',controls:[],rows:[],overflow:0};return {faces:[],used:[],errors:[]};}};
    const captures=await captureBrowserBaseline({browser:{newContext:async()=>({newPage:async()=>({on:()=>{},evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():undefined}),close:async()=>{}})},mount:async()=>({frame,screenshot:async()=>{order.push('screenshot');return bytes;}}),implementation,sourceRevision:'a'.repeat(40),output:directory,screenshotMode:'document-frame',themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'animation',states:[{id:'initial',actions:[]}]}]});
    expect(order).toEqual(['settled','settled','screenshot']);expect(captures[0].animationEvidence).toMatchObject({format:'frame-animation-settlement-v1',infinite:[],timedOut:[]});
  });

  it('waits for parent comment transitions after frame font work before the frame camera',async()=>{
    const directory=await setup(),order=[],bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    let finishParent;const parentFinished=new Promise(resolve=>{finishParent=resolve;});
    const frame={url:()=> 'http://fixture.lvh.me/reader',evaluate:async fn=>{if(fn.name==='settleFiniteFrameAnimations'){order.push('frame');return noAnimations();}if(fn.name==='browserState')return {text:'Ready',controls:[],rows:[],overflow:0};return {faces:[],used:[],errors:[]};}};
    const page={on:()=>{},evaluate:async fn=>{if(fn.name==='settleFiniteFrameAnimations'){order.push('parent-start');await parentFinished;order.push('parent-finished');return {...noAnimations(),observed:1,counts:{finished:1,canceled:0,detached:0}};}}};
    const task=captureBrowserBaseline({browser:{newContext:async()=>({newPage:async()=>page,close:async()=>{}})},mount:async()=>({frame,screenshot:async()=>{order.push('screenshot');return bytes;}}),implementation:'html',sourceRevision:'a'.repeat(40),output:directory,screenshotMode:'document-frame',themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'parent-animation',states:[{id:'initial',actions:[]}]}]});
    await vi.waitFor(()=>expect(order).toContain('parent-start'));expect(order).not.toContain('screenshot');finishParent();const captures=await task;
    expect(order.slice(-3)).toEqual(['parent-start','parent-finished','screenshot']);expect(captures[0].animationEvidence.parentDocument.counts.finished).toBe(1);
  });

  it('rejects unsettled parent transitions with evidence before any camera screenshot',async()=>{
    const directory=await setup(),screenshot=vi.fn(),timeout={...noAnimations(),observed:1,timedOut:[{name:'top',playState:'running',duration:10000,iterations:1}]};
    const frame={url:()=> 'http://fixture.lvh.me/reader',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}};
    const page={on:()=>{},screenshot,evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?timeout:undefined};
    await expect(captureBrowserBaseline({browser:{newContext:async()=>({newPage:async()=>page,close:async()=>{}})},mount:async()=>({frame,screenshot}),implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,screenshotMode:'document-frame',animationSettleTimeoutMs:10,themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'parent-timeout',states:[{id:'initial',actions:[]}]}]})).rejects.toThrow('finite-parent-animations-timeout:1');
    expect(screenshot).not.toHaveBeenCalled();const failure=JSON.parse(await readFile(path.join(directory,'parent-timeout-light-800-initial-jsx-failure.json'),'utf8'));expect(failure.diagnostics.animationEvidence.parentDocument.timedOut).toEqual(timeout.timedOut);
  });

  it('rejects a missing linked theme stylesheet even when no font faces were declared',async()=>{
    const directory=await setup(),dom=new JSDOM('<html><head><link rel="stylesheet" href="/a/Page123/assets?dependency=Missing"></head><body>Ready</body></html>',{url:'http://app.lvh.me/a/Page123/raw'});
    const saved=Object.getOwnPropertyDescriptor(globalThis,'document');globalThis.document=dom.window.document;
    try{
      const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
      const frame={url:()=> 'http://app.lvh.me/a/Page123/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserResources'?fn():fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}};
      const browser={newContext:async()=>({newPage:async()=>({on:()=>{},screenshot:async()=>bytes}),close:async()=>{}})};
      const captures=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'html',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'theme',states:[{id:'initial',actions:[]}]}]});
      expect(captures[0].fontEvidence.faces).toEqual([]);expect(candidateCaptureIssues(captures)).toContain('Stylesheet did not load: http://app.lvh.me/a/Page123/assets');
    }finally{if(saved)Object.defineProperty(globalThis,'document',saved);else delete globalThis.document;dom.window.close();}
  });

  it('preserves bounded runtime and network diagnostics when readiness fails',async()=>{
    const directory=await setup(),listeners=new Map();let closed=0;
    const page={on:(event,callback)=>listeners.set(event,[...(listeners.get(event)||[]),callback])};const emit=(event,value)=>{for(const listener of listeners.get(event)||[])listener(value);};
    const browser={newContext:async()=>({newPage:async()=>page,close:async()=>{closed++;}})};
    const task=captureBrowserBaseline({browser,implementation:'html',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'button',states:[{id:'initial',actions:[]}]}],mount:async()=>{
      emit('pageerror',Error('Module failed'));
      emit('console',{type:()=> 'error',text:()=> 'CORS blocked http://app.lvh.me/a/Page123/assets?key=secret&dependency=Asset123'});
      emit('requestfailed',{resourceType:()=> 'script',url:()=> 'http://app.lvh.me/a/Page123/assets?key=secret',failure:()=>({errorText:'net::ERR_FAILED'})});
      emit('response',{request:()=>({resourceType:()=> 'script'}),status:()=>404,url:()=> 'http://app.lvh.me/a/Page123/assets?key=secret',headers:()=>({'content-type':'text/plain'})});
      return {frame:{url:()=> 'http://app.lvh.me/a/Page123/raw?key=secret'},ready:async()=>{throw Error('readiness timeout');}};
    }});
    await expect(task).rejects.toThrow(/readiness timeout.*reader diagnostics:.*Module failed.*CORS blocked.*net::ERR_FAILED.*404/s);
    try{await task;}catch(error){expect(error.message).not.toContain('secret');expect(error.message).toContain('"phase":"ready"');}
    expect(closed).toBeGreaterThan(0);
  });

  it('captures a real mounted document frame only in explicit frame mode',async()=>{
    const directory=await setup(),bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const performAction=vi.fn(async()=>{}),screenshot=vi.fn(async()=>bytes),pageScreenshot=vi.fn(async()=>bytes);
    const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:fn.toString().includes('requestAnimationFrame')?undefined:{faces:[],used:[],errors:[]}};
    const browser={newContext:async()=>({newPage:async()=>({on:()=>{},evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():undefined,screenshot:pageScreenshot}),close:async()=>{}})};
    const captures=await captureBrowserBaseline({browser,mount:async()=>({frame,screenshot,performAction}),screenshotMode:'document-frame',implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'identity',states:[{id:'loaded',actions:[{action:'upload',role:'button',name:'Upload',files:[{name:'sample.txt',mimeType:'text/plain',text:'Actual upload'}]}]}]}]});
    expect(captures).toHaveLength(1);
    expect(performAction).toHaveBeenCalledWith({action:'upload',role:'button',name:'Upload',files:[{name:'sample.txt',mimeType:'text/plain',text:'Actual upload'}]});
    expect(screenshot).toHaveBeenCalledOnce();expect(screenshot).toHaveBeenCalledWith();expect(pageScreenshot).not.toHaveBeenCalled();
    expect(captures[0].screenshotMode).toBe('document-frame');
  });

  it('captures the configured page viewport rather than cropping the html element',async()=>{
    const directory=await setup();const calls=[];
    const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]},locator:()=>{throw Error('Element screenshot would clip native top-layer UI');}};
    const browser={newContext:async options=>({newPage:async()=>({on:()=>{},screenshot:async screenshotOptions=>{calls.push({viewport:options.viewport,...screenshotOptions});return bytes;}}),close:async()=>{}})};
    const captures=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'dialog',states:[{id:'open',actions:[]}]}]});
    expect(calls).toEqual(expect.arrayContaining([{viewport:{width:800,height:600},fullPage:false,caret:'hide'},{viewport:{width:390,height:844},fullPage:false,caret:'hide'}]));
    expect(captures.every(capture=>capture.screenshotMode==='viewport')).toBe(true);
  });
});

describe('explicit semantic serialization normalization',()=>{
  it('preserves raw state and real labels while ignoring empty button value and interbutton whitespace',()=>{
    const old={text:'OneTwo',controls:[{role:'button',name:'One',value:''},{role:'button',name:'Two',value:''}]};
    const current={text:'One Two',controls:[{role:'button',name:'One'},{role:'button',name:'Two'}]};
    expect(comparableBehavior(old)).toEqual(comparableBehavior(current));
    expect(old.controls[0].value).toBe('');
    expect(comparableBehavior({text:'PERSON Ada',controls:[]})).not.toEqual(comparableBehavior({text:'Person Ada',controls:[]}));
  });
});

describe('expanded fixture state expectations',()=>{
  it('rejects incorrect checked, pressed, expanded and native field values',()=>{
    const expected={roles:[{role:'switch',name:'Notifications',checked:true},{role:'button',name:'Later',pressed:true},{role:'button',name:'More details',expanded:true},{role:'textbox',name:'Notes',value:'Review details\nx'}],textIncludes:['Additional information'],hiddenText:['Hidden information']};
    const actual={text:'Additional information',controls:[{role:'switch',name:'Notifications',checked:'false'},{role:'button',name:'Later',pressed:'false'},{role:'button',name:'More details',expanded:'false'},{role:'textbox',name:'Notes',value:'Review details'}]};
    expect(stateExpectationIssues(expected,actual)).toHaveLength(4);
    actual.controls[0].checked='true';actual.controls[1].pressed='true';actual.controls[2].expanded='true';actual.controls[3].value='Review details\nx';
    expect(stateExpectationIssues(expected,actual)).toEqual([]);
  });
  it('fails missing or unexpectedly visible roles and preserves real text case',()=>{
    expect(stateExpectationIssues({roles:[{role:'slider',name:'Level',value:50}],rolesAbsent:[{role:'dialog',name:'Details'}],textIncludes:['PERSON']},{text:'Person',controls:[{role:'dialog',name:'Details'}]})).toHaveLength(3);
  });
});

describe('browser semantic collection',()=>{
  it('reads associated labels, ARIA name precedence, checked and pressed state without calling file inputs textboxes',async()=>{
    const directory=await setup();
    const dom=new JSDOM('<body><label for="terms">Accept terms</label><input id="terms" type="checkbox" checked><span id="switch-label">Notifications</span><button role="switch" aria-label="Wrong" aria-labelledby="switch-label" aria-checked="true">Toggle</button><button aria-pressed="true">Later</button><input type="file" aria-label="Attachment"></body>');
    Object.defineProperty(dom.window.HTMLElement.prototype,'getClientRects',{value:()=>[{}]});
    Object.defineProperty(dom.window.document.body,'innerText',{value:dom.window.document.body.textContent});
    const saved=Object.fromEntries(['document','getComputedStyle','innerWidth'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    Object.assign(globalThis,{document:dom.window.document,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),innerWidth:800});
    try {
      const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
      const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?fn():{faces:[],used:[],errors:[]}};
      const browser={newContext:async()=>({newPage:async()=>({on:()=>{},screenshot:async()=>bytes}),close:async()=>{}})};
      const captures=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'controls',states:[{id:'initial',actions:[]}]}]});
      expect(captures[0].semantics.controls).toEqual(expect.arrayContaining([expect.objectContaining({role:'checkbox',name:'Accept terms',checked:'true'}),expect.objectContaining({role:'switch',name:'Notifications',checked:'true'}),expect.objectContaining({role:'button',name:'Later',pressed:'true'}),expect.objectContaining({role:'file-input',name:'Attachment'})]));
    } finally {for(const [key,descriptor] of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];dom.window.close();}
  });
});

describe('bounded independent reader capture',()=>{
  it('runs at most two contexts and returns fixture order despite completion order',async()=>{
    const directory=await setup();let active=0,peak=0,sequence=0;const completed=[];
    let releaseFirst;const secondScreenshot=new Promise(resolve=>{releaseFirst=resolve;});
    const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const browser={newContext:async()=>{const id=sequence++;active++;peak=Math.max(peak,active);return {newPage:async()=>({id,on:()=>{},screenshot:async()=>{completed.push(id);if(id===1)releaseFirst();return bytes;}}),close:async()=>{active--;}};}};
    const mount=async({page})=>{if(page.id===0)await secondScreenshot;return {frame:{url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:String(page.id),controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}}};};
    const captures=await captureBrowserBaseline({browser,workerBrowsers:[browser,browser],mount,implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'one',states:[{id:'initial',actions:[]}]}]});
    expect(peak).toBe(2);expect(active).toBe(0);expect(completed[0]).toBe(1);expect(captures.map(capture=>capture.semantics.text)).toEqual(['0','1','2','3']);
  });
  it('closes every started context and waits for in-flight cleanup on failure',async()=>{
    const directory=await setup();let started=0,closed=0;
    const browser={newContext:async()=>{const id=started++;return {newPage:async()=>({id,on:()=>{}}),close:async()=>{await new Promise(resolve=>setTimeout(resolve,5));closed++;}};}};
    await expect(captureBrowserBaseline({browser,workerBrowsers:[browser,browser],mount:async()=>{throw Error('mount failed');},implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'one',states:[{id:'initial',actions:[]}]}]})).rejects.toThrow('mount failed');
    expect(started).toBe(4);expect(closed).toBe(started);
  });
});


describe('used font evidence',()=>{
  const genericFontFamilies=['serif','sans-serif','cursive','fantasy','monospace','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong'];
  it.each(genericFontFamilies)('does not require a declared face for generic family %s',async family=>{
    const dom=new JSDOM('<p>Visible generic text</p>',{url:'http://localhost/reader'});
    const root=dom.window.document.documentElement,paragraph=dom.window.document.querySelector('p');
    root.style.setProperty('--font-body',family);paragraph.style.fontFamily=family;
    const original=globalThis.document,fonts=[];fonts.ready=Promise.resolve();fonts.load=vi.fn();
    Object.defineProperty(dom.window.document,'fonts',{value:fonts});
    dom.window.HTMLElement.prototype.getClientRects=()=>[{}];globalThis.document=dom.window.document;
    try{
      const evidence=await fontLoadingEvidence();
      expect(evidence.errors).toEqual([]);
      expect(evidence.used).toMatchObject([{family,generic:true,declared:false,sources:[]}]);
      expect(fonts.load).not.toHaveBeenCalled();
      expect(fontByteProof(evidence)).toMatchObject({used:[],errors:[]});
    }finally{globalThis.document=original;dom.window.close();}
  });
  it('still rejects a missing custom font selected by a theme',async()=>{
    const dom=new JSDOM('<p>Visible custom font text</p>',{url:'http://localhost/reader'});
    const root=dom.window.document.documentElement,paragraph=dom.window.document.querySelector('p');
    root.style.setProperty('--font-body','Missing Theme Typeface');paragraph.style.fontFamily='Missing Theme Typeface';
    const original=globalThis.document,fonts=[];fonts.ready=Promise.resolve();fonts.load=vi.fn();
    Object.defineProperty(dom.window.document,'fonts',{value:fonts});
    dom.window.HTMLElement.prototype.getClientRects=()=>[{}];globalThis.document=dom.window.document;
    try{
      const evidence=await fontLoadingEvidence();
      expect(evidence.errors).toContain('Used theme font Missing Theme Typeface has no declared font face');
      expect(evidence.used).toMatchObject([{family:'Missing Theme Typeface',generic:false,declared:false,sources:[]}]);
    }finally{globalThis.document=original;dom.window.close();}
  });
  it.each([false,true])('binds stylesheet body waits to the inspected frame (blocked reader=%s)',async blockedReader=>{
    const output=await setup(),body=Buffer.from('font bytes'),fontSha256=createHash('sha256').update(body).digest('hex');
    const parentFrame={},handlers=new Map();let targetFrame,inspectedStylesheets;
    const emit=(type,response)=>{for(const handler of handlers.get(type)||[])handler(response);};
    const response=(type,url,frame,content)=>({request:()=>({resourceType:()=>type}),url:()=>url,status:()=>200,frame:()=>frame,headers:()=>({'content-type':type==='stylesheet'?'text/css':'font/woff2'}),text:async()=>content,body:async()=>{await new Promise(resolve=>setTimeout(resolve,10));return body;}});
    const frame={url:()=> 'http://localhost/reader',evaluate:async(fn,...args)=>{
      if(fn.name==='settleFiniteFrameAnimations')return noAnimations();
      if(fn.name==='fontLoadingEvidence'){
        inspectedStylesheets=args[0];
        emit('response',response('font','http://localhost/font.woff2',targetFrame,''));
        return {faces:[],used:[{family:'Capture Font',style:'normal',weight:'400',declared:true,loaded:true,sources:['http://localhost/font.woff2']}],errors:[]};
      }
      if(fn.name==='browserResources')return {stylesheets:[],errors:[]};
      if(fn.name==='browserState')return {text:'Actual font',controls:[],rows:[],overflow:0};
      return undefined;
    }};
    targetFrame=frame;
    const png=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const page={on:(type,handler)=>{const group=handlers.get(type)||[];group.push(handler);handlers.set(type,group);},screenshot:async()=>png};
    const browser={version:()=> 'test-browser',newContext:async()=>({newPage:async()=>page,close:async()=>{}})};
    const stylesheet=`@font-face{font-family:Capture Font;src:url("font.woff2");}`;
    const task=captureBrowserBaseline({browser,mount:async()=>{
      const stale=response('stylesheet','http://localhost/parent.css',parentFrame,'');stale.text=()=>new Promise(()=>{});emit('response',stale);
      const actual=response('stylesheet','http://localhost/frame.css',targetFrame,stylesheet);if(blockedReader)actual.text=()=>new Promise(()=>{});emit('response',actual);
      return {frame};
    },implementation:'html',sourceRevision:'a'.repeat(40),output,captureStepTimeoutMs:40,fixtures:[{id:'frame-font',states:[{id:'initial',actions:[]}]}],themes:['light'],viewports:[{width:800,height:600}]});
    if(blockedReader){await expect(task).rejects.toThrow(/stylesheet-responses exceeded.*frame.css.*capturedFrame.*true/);return;}
    const captures=await task;
    expect(inspectedStylesheets).toEqual([{url:'http://localhost/frame.css',status:200,css:stylesheet}]);
    expect(captures[0].fontEvidence.resources).toEqual([{url:'http://localhost/font.woff2',status:200,sha256:fontSha256}]);
    expect(fontByteProof(captures[0].fontEvidence).errors).toEqual([]);
  });
  it('accepts variable weight matching while leaving unused italic faces unloaded',async()=>{
    const dom=new JSDOM('<style>@font-face{font-family:"DM Sans";font-style:normal;font-weight:400;src:url(/fonts/body.woff2)}@font-face{font-family:"DM Sans";font-style:italic;font-weight:400;src:url(/fonts/italic.woff2)}</style><p style="font-family:DM Sans;font-weight:500">Actual text</p>',{url:'http://localhost/reader'});
    for(const rule of dom.window.document.styleSheets[0].cssRules){const get=rule.style.getPropertyValue.bind(rule.style);rule.style.getPropertyValue=key=>key==='font-weight'?'100 1000':key==='src'?`url(/fonts/${get('font-style')==='italic'?'italic':'body'}.woff2)`:get(key);}
    const original=globalThis.document;
    const normal={family:'DM Sans',style:'normal',weight:'100 1000',status:'loaded',unicodeRange:'U+0-10FFFF'};
    const italic={...normal,style:'italic',status:'unloaded'};
    const fonts=[normal,italic];fonts.ready=Promise.resolve();fonts.load=async query=>{expect(query).toContain('500');return [normal];};
    Object.defineProperty(dom.window.document,'fonts',{value:fonts});
    dom.window.HTMLElement.prototype.getClientRects=()=>[{}];
    globalThis.document=dom.window.document;
    try{
      const evidence=await fontLoadingEvidence();expect(evidence.errors).toEqual([]);
      expect(evidence.used).toMatchObject([{family:'DM Sans',loaded:true,sources:['http://localhost/fonts/body.woff2']}]);
      fonts.load=async()=>{throw Error('network unavailable');};
      expect((await fontLoadingEvidence()).errors[0]).toContain('network unavailable');
    }finally{globalThis.document=original;dom.window.close();}
  });
  it('compares actual used bytes independently of asset URLs and ignores unused resources',()=>{
    const face={family:'DM Sans',style:'normal',weight:'500',declared:true,sources:['http://localhost/body.woff2']};
    const evidence={used:[face],resources:[{url:face.sources[0],status:200,sha256:'a'.repeat(64)},{url:'http://localhost/unused.woff2',status:404,sha256:'b'.repeat(64)}]};
    const proof=fontByteProof(evidence);expect(proof.errors).toEqual([]);expect(proof.used[0].hashes).toEqual(['a'.repeat(64)]);
    expect(fontByteProof({...evidence,used:[{...face,sources:['http://localhost/missing.woff2']}]}).errors[0]).toContain('no verified response bytes');
    expect(fontByteProof({used:[{declared:false}],resources:[]}).errors).toEqual([]);
  });
  it('joins a used shadow-root face to the exact reader asset response URL',async()=>{
    const face={family:'DM Sans',style:'normal',weight:'100 1000',status:'loaded',unicodeRange:'U+0-10FFFF'};
    const requestUrl='http://localhost/a/reader/assets?dependency=06Cd7K&revision=1';
    const values={'font-family':'DM Sans','font-style':'normal','font-weight':'100 1000','unicode-range':'U+0-10FFFF','src':'url("/a/reader/assets?dependency=06Cd7K&revision=1")'};
    const declaration={getPropertyValue:name=>values[name]||''};
    const shadowSheet={href:null,cssRules:[{type:5,style:declaration}]};
    const shadowStyle={sheet:shadowSheet};
    const shadowParagraph={getClientRects:()=>[{}],tagName:'P'};
    const shadowRoot={querySelectorAll:selector=>selector==='style, link[rel~="stylesheet"]'?[shadowStyle]:selector==='*'?[shadowParagraph]:[],styleSheets:[]};
    const host={shadowRoot};
    const original=globalThis.document;
    const fonts=[face];fonts.ready=Promise.resolve();fonts.load=async()=>[face];
    const text={parentElement:shadowParagraph,textContent:'Actual text'};
    globalThis.document={baseURI:'http://localhost/a/reader/page',body:{querySelectorAll:selector=>selector==='*'?[host]:[]},documentElement:{},fonts,styleSheets:[],querySelectorAll:selector=>selector==='*'?[host]:[],createTreeWalker:root=>{let read=false;return {nextNode:()=>root===shadowRoot&&!read?(read=true,text):null};},defaultView:{NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>({fontFamily:'DM Sans',fontStyle:'normal',fontWeight:'500',visibility:'visible',getPropertyValue:()=>''})}};
    try{
      const evidence=await fontLoadingEvidence();
      expect(evidence.errors).toEqual([]);
      expect(evidence.used).toMatchObject([{family:'DM Sans',weight:'500',loaded:true,sources:[requestUrl]}]);
      const proof=fontByteProof({...evidence,resources:[{url:requestUrl,status:200,sha256:'a'.repeat(64)}]});
      expect(proof.errors).toEqual([]);expect(proof.used[0].hashes).toEqual(['a'.repeat(64)]);
      expect(fontByteProof({...evidence,resources:[{url:'http://localhost/unrelated.woff2',status:200,sha256:'a'.repeat(64)}]}).errors).toContain('Used declared font DM Sans normal 500 has no verified response bytes');
    }finally{globalThis.document=original;}
  });
  it('joins a used face in a CORS stylesheet to its actual external font response URL',async()=>{
    const dom=new JSDOM('<p style="font-family: Remote Font; font-weight: 500">Cross-origin text</p>',{url:'http://localhost/reader'});
    const original=globalThis.document;
    const face={family:'Remote Font',style:'normal',weight:'100 900',status:'loaded',unicodeRange:'U+0-10FFFF'};
    const fonts=[face];fonts.ready=Promise.resolve();fonts.load=async()=>[face];
    Object.defineProperty(dom.window.document,'fonts',{value:fonts});
    Object.defineProperty(dom.window.document,'styleSheets',{value:[{get cssRules(){throw new dom.window.DOMException('Blocked by CORS','SecurityError');}}]});
    dom.window.HTMLElement.prototype.getClientRects=()=>[{}];
    dom.window.document.defaultView.CSSStyleSheet=class {
      replaceSync(css){
        expect(css).toContain('font-family: "Remote Font"');
        const values={'font-family':'"Remote Font"','font-style':'normal','font-weight':'100 900','unicode-range':'U+0-10FFFF','src':/src:\s*(.*?);/.exec(css)?.[1]||''};
        this.cssRules=[{type:5,style:{getPropertyValue:name=>values[name]||''}}];
      }
    };
    globalThis.document=dom.window.document;
    const stylesheetUrl='https://fonts.example.test/css/reader.css';
    const stylesheetResponses=[{url:stylesheetUrl,status:200,css:'@font-face { font-family: "Remote Font"; font-style: normal; font-weight: 100 900; unicode-range: U+0-10FFFF; src: url("../files/remote.woff2") format("woff2"); }'}];
    try{
      const evidence=await fontLoadingEvidence(stylesheetResponses);
      expect(evidence.used).toMatchObject([{family:'Remote Font',weight:'500',loaded:true,sources:['https://fonts.example.test/files/remote.woff2']}]);
      expect(evidence.errors).toEqual([]);
      const source=evidence.used[0].sources[0];
      const proof=fontByteProof({...evidence,resources:[{url:source,status:200,sha256:'a'.repeat(64)}]});
      expect(proof.errors).toEqual([]);expect(proof.used[0].hashes).toEqual(['a'.repeat(64)]);
      expect(fontByteProof({...evidence,resources:[{url:'https://fonts.example.test/unrelated.woff2',status:200,sha256:'a'.repeat(64)}]}).errors).toContain('Used declared font Remote Font normal 500 has no verified response bytes');
      const ambiguous=await fontLoadingEvidence([{...stylesheetResponses[0],css:stylesheetResponses[0].css.replace('../files/remote.woff2','../files/first.woff2')},{...stylesheetResponses[0],url:'https://fonts.example.test/css/other.css',css:stylesheetResponses[0].css.replace('../files/remote.woff2','../files/second.woff2')}]);
      expect(ambiguous.used[0].sources).toEqual([]);
      expect(fontByteProof({...ambiguous,resources:[{url:'https://fonts.example.test/files/first.woff2',status:200,sha256:'a'.repeat(64)},{url:'https://fonts.example.test/files/second.woff2',status:200,sha256:'b'.repeat(64)}]}).errors).toContain('Used declared font Remote Font normal 500 has no verified response bytes');
    }finally{globalThis.document=original;dom.window.close();}
  });
  it('resolves imported font URLs against the imported stylesheet URL and rejects wrong bytes',async()=>{
    const face={family:'Pilot Font',style:'normal',weight:'400',status:'loaded',unicodeRange:'U+0-10FFFF'};
    const values={'font-family':'Pilot Font','font-style':'normal','font-weight':'400','unicode-range':'U+0-10FFFF','src':'url("fonts/pilot.woff2")'};
    const imported={href:null,cssRules:[{type:5,style:{getPropertyValue:name=>values[name]||''}}]};
    const originalDocument=globalThis.document;
    const fonts=[face];fonts.ready=Promise.resolve();fonts.load=async()=>[face];
    const css={fontFamily:'Pilot Font',fontStyle:'normal',fontWeight:'400',visibility:'visible',getPropertyValue:()=>''};
    const text={parentElement:{getClientRects:()=>[{}]},textContent:'Actual font sample'};
    globalThis.document={baseURI:'http://localhost/reader',body:{},documentElement:{},fonts,styleSheets:[{href:'http://localhost/a/design/main.css',cssRules:[{type:3,href:'../shared/fonts.css',styleSheet:imported}]}],querySelectorAll:()=>[],createTreeWalker:()=>{let read=false;return {nextNode:()=>read?null:(read=true,text)};},defaultView:{NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>css}};
    try{
      const evidence=await fontLoadingEvidence();
      expect(evidence.used[0].sources).toEqual(['http://localhost/a/shared/fonts/pilot.woff2']);
      const proof=fontByteProof({...evidence,resources:[{url:evidence.used[0].sources[0],status:200,sha256:'b'.repeat(64)}]});
      expect(proof.errors).toEqual([]);expect(proof.used[0].hashes).toEqual(['b'.repeat(64)]);
      expect(proof.used[0].hashes).not.toEqual(['a'.repeat(64)]);
      const directory=await setup(),source=evidence.used[0].sources[0];
      const oldCapture=await capture(directory,'jsx','white',{fontEvidence:{used:evidence.used,resources:[{url:source,status:200,sha256:'a'.repeat(64)}]}});
      const newCapture=await capture(directory,'html','white',{fontEvidence:{used:evidence.used,resources:[{url:source,status:200,sha256:'b'.repeat(64)}]}});
      const [comparison]=await compareBrowserBaselines({baseline:[oldCapture],candidate:[newCapture],baselineDirectory:directory,candidateDirectory:directory,output:directory});
      expect(comparison.fontBytesEqual).toBe(false);
    }finally{globalThis.document=originalDocument;}
  });
  it('does not count a declared and already-loaded face as used without rendered text using it',async()=>{
    const face={family:'Unused Font',style:'normal',weight:'400',status:'loaded',unicodeRange:'U+0-10FFFF'};
    const original=globalThis.document,fonts=[face];fonts.ready=Promise.resolve();fonts.load=async()=>[face];
    const element={getClientRects:()=>[{}],tagName:'P'};
    const text={parentElement:element,textContent:'Rendered in system Arial'};
    const css={fontFamily:'Arial, sans-serif',fontStyle:'normal',fontWeight:'400',visibility:'visible',getPropertyValue:()=>''};
    globalThis.document={baseURI:'http://localhost/reader',body:{},documentElement:{},fonts,styleSheets:[],querySelectorAll:()=>[],createTreeWalker:()=>{let read=false;return {nextNode:()=>read?null:(read=true,text)};},defaultView:{NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>css}};
    try{
      const evidence=await fontLoadingEvidence();
      expect(evidence.faces).toContainEqual(expect.objectContaining({family:'Unused Font',status:'loaded'}));
      expect(evidence.used).toMatchObject([{family:'Arial',declared:false,sources:[]}]);
      expect(fontByteProof({...evidence,resources:[{url:'http://localhost/unused.woff2',status:200,sha256:'c'.repeat(64)}]}).used).toEqual([]);
    }finally{globalThis.document=original;}
  });
});


describe('component gate resource acceptance',()=>{
  it('rejects missing stylesheets in explicit input and default candidate validation',async()=>{
    const output=await setup(),config=path.join(output,'run.json'),prior=process.env.COMPONENT_BASELINE__INPUT;
    const archive=await candidateArchive(),originalFetch=globalThis.fetch;
    const broken={fixture:'theme',state:'initial',errors:[],assertionErrors:[],fontEvidence:{errors:[]},resourceEvidence:{errors:['Stylesheet did not load: /theme.css']},semantics:{text:'Ready',controls:[],overflow:0}};
    vi.doMock('../gates/lib/browser.mjs',()=>({launchChromium:async()=>({close:async()=>{}})}));
    vi.doMock('../lib/component-browser-baseline.mjs',()=>({captureBrowserBaseline:async()=>[broken],compareBrowserBaselines,candidateCaptureIssues}));
    vi.stubGlobal('fetch',async(input,init)=>{
      const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
      const {pathname}=new URL(url);
      if(pathname==='/skills/artifactbin.zip')return new Response(archive,{status:200});
      // The candidate server's hosted modules: this checkout's verified build output.
      if(/^\/af\/components\/[a-z0-9-]+\.js$/.test(pathname))return new Response(await readFile(path.join(repo,'services/app/lib/build-assets',pathname.slice('/af/'.length))),{status:200});
      return originalFetch(input,init);
    });
    process.env.COMPONENT_BASELINE__INPUT=config;
    try{
      for(const defaultCandidateValidation of [false,true]){
        await writeFile(config,JSON.stringify({implementation:'html',sourceRevision:'a'.repeat(40),output,entries:[],defaultCandidateValidation}));
        await expect(import('../gates/gate-component-baseline.mjs?resource-acceptance='+defaultCandidateValidation)).rejects.toThrow('Reader capture failures: Stylesheet did not load: /theme.css');
      }
    }finally{if(prior===undefined)delete process.env.COMPONENT_BASELINE__INPUT;else process.env.COMPONENT_BASELINE__INPUT=prior;vi.unstubAllGlobals();vi.doUnmock('../gates/lib/browser.mjs');vi.doUnmock('../lib/component-browser-baseline.mjs');}
  });
});

it('persists successful partial captures and a diagnostic failed state before rejecting',async()=>{
  const directory=await setup();let sequence=0,closed=0;
  await writeFile(path.join(directory,'html-captures.json'),'[{"state":"stale prior run"}]');
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
  const browser={newContext:async()=>{const id=sequence++;return {newPage:async()=>({id,on:()=>{},screenshot:async()=>bytes}),close:async()=>{closed++;}};}};
  const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Completed',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}};
  await expect(captureBrowserBaseline({browser,mount:async({page})=>{if(page.id===1)throw Error('actual state failed');return {frame};},implementation:'html',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'one',states:[{id:'initial',actions:[]}]}]})).rejects.toThrow('one/light/390/initial: actual state failed');
  const partial=JSON.parse(await readFile(path.join(directory,'html-partial-captures.json'),'utf8'));
  expect(partial).toHaveLength(3);expect(partial[0].semantics.text).toBe('Completed');
  const status=JSON.parse(await readFile(path.join(directory,'capture-status.json'),'utf8'));
  expect(status).toMatchObject({complete:false,planned:4,fixtureIds:['one'],completed:3,failures:[{fixture:'one',state:'initial',theme:'light',viewport:{width:390,height:844},phase:'mount',message:'actual state failed'}]});
  expect(await readFile(path.join(directory,'one-light-390-initial-html-failure.png'))).toEqual(bytes);
  await expect(readFile(path.join(directory,'html-captures.json'))).rejects.toMatchObject({code:'ENOENT'});
  expect(closed).toBe(4);
});

it('captures later independent fixture groups after early failure and rejects the entire run',async()=>{
  const directory=await setup();let sequence=0,active=0,peak=0,closed=0;
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
  const browser={newContext:async()=>{const id=sequence++;active++;peak=Math.max(peak,active);return {newPage:async()=>({id,on:()=>{},screenshot:async()=>bytes}),close:async()=>{active--;closed++;}};}};
  const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Later independent success',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}};
  let failure;
  try{await captureBrowserBaseline({browser,workerBrowsers:[browser,browser],mount:async({page})=>{if(page.id===0)throw Error('early failure');if(page.id===2)throw Error('second failure');return {frame};},implementation:'html',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'first',states:[{id:'initial',actions:[]}]},{id:'later',states:[{id:'initial',actions:[]}]}]});}catch(error){failure=error;}
  expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toHaveLength(2);expect(failure.message).toContain('early failure');expect(failure.message).toContain('second failure');
  const partial=JSON.parse(await readFile(path.join(directory,'html-partial-captures.json'),'utf8'));
  expect(partial).toHaveLength(6);expect(partial.filter(capture=>capture.fixture==='later')).toHaveLength(4);
  const status=JSON.parse(await readFile(path.join(directory,'capture-status.json'),'utf8'));
  expect(status).toMatchObject({complete:false,planned:8,completed:6});expect(status.failures).toHaveLength(2);
  expect(peak).toBe(2);expect(closed).toBe(8);expect(active).toBe(0);
  await expect(readFile(path.join(directory,'html-captures.json'))).rejects.toMatchObject({code:'ENOENT'});
});

it('captures only the explicit retained theme and viewport plan for a private migration pilot',async()=>{
 const directory=await setup(),contexts=[];
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
 const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}};
 const browser={newContext:async options=>{contexts.push(options);return {newPage:async()=>({on:()=>{},screenshot:async()=>bytes}),close:async()=>{}};}};
 const captures=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,themes:['light'],viewports:[{width:1280,height:900}],fixtures:[{id:'pilot',states:[{id:'initial',actions:[]}]}]});
 expect(captures).toHaveLength(1);expect(contexts).toHaveLength(1);expect(contexts[0]).toMatchObject({colorScheme:'light',viewport:{width:1280,height:900}});
});

it('proves used font bytes through imported stylesheet URLs rather than losing their source base',async()=>{
 const prior=globalThis.document;
 const face={family:'Pilot Font',style:'normal',weight:'400',unicodeRange:'U+0-10FFFF',status:'loaded'};
 const fonts=[face];fonts.ready=Promise.resolve();fonts.load=async()=>[face];
 const css={fontFamily:'Pilot Font',fontStyle:'normal',fontWeight:'400',visibility:'visible',getPropertyValue:()=>''};
 const element={getClientRects:()=>[{}]},text={parentElement:element,textContent:'Actual font sample'};
 const declarations={'font-family':'Pilot Font','font-style':'normal','font-weight':'400','unicode-range':'U+0-10FFFF',src:'url("../fonts/body.woff2")'};
 const imported={href:'http://localhost/assets/fonts.css',cssRules:[{type:5,style:{getPropertyValue:name=>declarations[name]||''}}]};
 globalThis.document={body:{},documentElement:{},fonts,styleSheets:[{href:'http://localhost/main.css',cssRules:[{type:3,styleSheet:imported}]}],querySelectorAll:()=>[],createTreeWalker:()=>{let done=false;return {nextNode:()=>done?null:(done=true,text)};},defaultView:{NodeFilter:{SHOW_TEXT:4},getComputedStyle:()=>css}};
 try{const evidence=await fontLoadingEvidence();expect(evidence.errors).toEqual([]);expect(evidence.used[0].sources).toEqual(['http://localhost/fonts/body.woff2']);}
 finally{globalThis.document=prior;}
});

it('clicks the exact retained authored target when the browser exposes no native role',()=>{const frame={getByRole:vi.fn(),locator:vi.fn().mockReturnValue('retained-target')};expect(actionTarget(frame,{role:'button',name:'Summary',authoredId:'summary-1'})).toBe('retained-target');expect(frame.locator).toHaveBeenCalledWith('[id=\"summary-1\"]');expect(frame.getByRole).not.toHaveBeenCalled();});

it('bounds a stuck readiness hook, records its phase, and closes the context to cancel its poll',async()=>{
 const directory=await setup();let cancel,closed=0;
 const blocked=new Promise((_,reject)=>{cancel=()=>reject(Error('context closed'));});
 const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async()=>({text:'Present',controls:[],rows:[],overflow:0})};
 const browser={newContext:async()=>({newPage:async()=>({on:()=>{}}),close:async()=>{closed++;cancel();}})};
 const run=captureBrowserBaseline({browser,mount:async()=>({frame,ready:()=>blocked}),implementation:'html',sourceRevision:'a'.repeat(40),output:directory,readyTimeoutMs:20,captureStepTimeoutMs:20,themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'bounded',states:[{id:'initial',actions:[]}]}]});
 try{const error=await Promise.race([run.catch(error=>error),new Promise(resolve=>setTimeout(()=>resolve(Error('missing bounded readiness')),200))]);expect(error.message).toContain('Reader ready exceeded 20ms');expect(closed).toBe(1);const status=JSON.parse(await readFile(path.join(directory,'capture-status.json'),'utf8'));expect(status.failures[0]).toMatchObject({phase:'ready'});}finally{cancel();await run.catch(()=>{});}
});
it('bounds an unresolved font evaluation and retains the specific camera phase',async()=>{
 const directory=await setup();let cancel,closed=0;
 const blocked=new Promise((_,reject)=>{cancel=()=>reject(Error('context closed'));});
 const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='settleFiniteFrameAnimations'?noAnimations():fn.name==='browserState'?{text:'Present',controls:[],rows:[],overflow:0}:blocked};
 const browser={newContext:async()=>({newPage:async()=>({on:()=>{}}),close:async()=>{closed++;cancel();}})};
 const run=captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'html',sourceRevision:'a'.repeat(40),output:directory,captureStepTimeoutMs:20,themes:['light'],viewports:[{width:800,height:600}],fixtures:[{id:'bounded-font',states:[{id:'initial',actions:[]}]}]});
 try{const error=await Promise.race([run.catch(error=>error),new Promise(resolve=>setTimeout(()=>resolve(Error('missing bounded font wait')),200))]);expect(error.message).toContain('Reader fonts-ready exceeded 20ms');expect(closed).toBe(1);const status=JSON.parse(await readFile(path.join(directory,'capture-status.json'),'utf8'));expect(status.failures[0]).toMatchObject({phase:'fonts-ready'});}finally{cancel();await run.catch(()=>{});}
});

it('proves fonts on visible text inside display-contents identities without counting hidden text',async()=>{
 const dom=new JSDOM('<style>@font-face{font-family:"Body Font";font-style:normal;font-weight:400;src:url(/body.woff2)}</style><span id="visible" style="display:contents;font-family:Body Font;font-weight:400">Visible identity text</span><span id="hidden" style="display:none;font-family:Body Font">Hidden text</span><span id="invisible" style="display:contents;visibility:hidden;font-family:Body Font">Invisible text</span>',{url:'http://localhost/reader'});
 const rule=dom.window.document.styleSheets[0].cssRules[0],get=rule.style.getPropertyValue.bind(rule.style);rule.style.getPropertyValue=key=>key==='src'?'url(/body.woff2)':get(key);
 const prior=globalThis.document,face={family:'Body Font',style:'normal',weight:'400',status:'loaded',unicodeRange:'U+0-10FFFF'},fonts=[face];fonts.ready=Promise.resolve();fonts.load=async()=>[face];Object.defineProperty(dom.window.document,'fonts',{value:fonts});
 dom.window.HTMLElement.prototype.getClientRects=()=>[];
 dom.window.document.createRange=()=>{let node;return {selectNodeContents:value=>{node=value;},getClientRects:()=>node.parentElement.id==='hidden'?[]:[{}],detach:()=>{}};};
 globalThis.document=dom.window.document;
 try{const evidence=await fontLoadingEvidence();expect(evidence.used).toMatchObject([{family:'Body Font',weight:'400',text:'Visible identity text',loaded:true}]);expect(fontByteProof({...evidence,resources:[{url:'http://localhost/body.woff2',status:200,sha256:'d'.repeat(64)}]})).toEqual({used:[{family:'Body Font',style:'normal',weight:'400',hashes:['d'.repeat(64)]}],errors:[]});expect(fontByteProof({...evidence,resources:[]} ).errors).toContain('Used declared font Body Font normal 400 has no verified response bytes');}
 finally{globalThis.document=prior;dom.window.close();}
});
