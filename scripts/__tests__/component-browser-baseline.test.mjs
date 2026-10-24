import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {JSDOM} from 'jsdom';
import {browserParityFixtures,parityThemes} from '../fixtures/component-baseline/index.mjs';
import { captureBrowserBaseline, compareBrowserBaselines, candidateCaptureIssues, comparableBehavior, stateExpectationIssues } from '../lib/component-browser-baseline.mjs';
const directories=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
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

describe('actual fixture publication payloads',()=>{
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
  it('publishes every candidate through the installed component graph within the real API limits',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const repo=path.resolve(import.meta.dirname,'../..');
    const css=await readFile(path.join(repo,'services/app/skills/artifactbin/design-systems/almanac.css'),'utf8');
    const {planPublicationBundle}=await import('../../services/app/lib/html-publication-bundle/plan.ts');
    const bodies=[],keys=new Set();
    await publishBaselineFixtures({implementation:'html',repo,serverOrigin:'https://example.test',themeCss:()=>css,publish:async(body,request)=>{
      expect(body.publicationBundle).toBeDefined();expect(request.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);keys.add(request.idempotencyKey);
      const plan=planPublicationBundle(body.html,body.publicationBundle);expect(plan.dependencies.length).toBeGreaterThan(0);expect(Buffer.byteLength(body.html)).toBeLessThan(4_000_000);
      for(const file of body.publicationBundle.files){expect(file.path).toMatch(/^components\/[a-z0-9-]+\.js$/);expect(Buffer.from(file.base64,'base64')).toEqual(await readFile(path.join(repo,'services/app/skills/artifactbin',file.path)));}
      bodies.push(body);return {id:'Page123'};
    }});
    expect(keys.size).toBe(browserParityFixtures.length*parityThemes.length);
    expect(bodies).toHaveLength(browserParityFixtures.length*parityThemes.length);
    expect(bodies.every(body=>body.html.includes('data-af-design-system="almanac"')&&body.html.includes('baselineReady'))).toBe(true);
  },30_000);
  it('removes the staged project and identifies the fixture when publication fails',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const before=new Set(await readdir(tmpdir())),repo=path.resolve(import.meta.dirname,'../..');
    await expect(publishBaselineFixtures({implementation:'html',repo,serverOrigin:'https://example.test',themeCss:()=>'',publish:async()=>{throw Error('publication refused');}})).rejects.toThrow('Component fixture button light failed: publication refused');
    expect((await readdir(tmpdir())).filter(name=>name.startsWith('component-publication-')&&!before.has(name))).toEqual([]);
  });
});

describe('reader screenshot contract',()=>{
  it('captures the configured page viewport rather than cropping the html element',async()=>{
    const directory=await setup();const calls=[];
    const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:undefined,locator:()=>{throw Error('Element screenshot would clip native top-layer UI');}};
    const browser={newContext:async options=>({newPage:async()=>({on:()=>{},screenshot:async screenshotOptions=>{calls.push({viewport:options.viewport,...screenshotOptions});return bytes;}}),close:async()=>{}})};
    const captures=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'dialog',states:[{id:'open',actions:[]}]}]});
    expect(calls).toEqual(expect.arrayContaining([{viewport:{width:800,height:600},fullPage:false,animations:'disabled',caret:'hide'},{viewport:{width:390,height:844},fullPage:false,animations:'disabled',caret:'hide'}]));
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
      const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='browserState'?fn():undefined};
      const browser={newContext:async()=>({newPage:async()=>({on:()=>{},screenshot:async()=>bytes}),close:async()=>{}})};
      const captures=await captureBrowserBaseline({browser,mount:async()=>({frame}),implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'controls',states:[{id:'initial',actions:[]}]}]});
      expect(captures[0].semantics.controls).toEqual(expect.arrayContaining([expect.objectContaining({role:'checkbox',name:'Accept terms',checked:'true'}),expect.objectContaining({role:'switch',name:'Notifications',checked:'true'}),expect.objectContaining({role:'button',name:'Later',pressed:'true'}),expect.objectContaining({role:'file-input',name:'Attachment'})]));
    } finally {for(const [key,descriptor] of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];dom.window.close();}
  });
});

describe('bounded independent reader capture',()=>{
  it('runs at most two contexts and returns fixture order despite completion order',async()=>{
    const directory=await setup();let active=0,peak=0,sequence=0;const completed=[];
    const bytes=await sharp({create:{width:2,height:2,channels:4,background:'white'}}).png().toBuffer();
    const browser={newContext:async()=>{const id=sequence++;active++;peak=Math.max(peak,active);return {newPage:async()=>({id,on:()=>{},screenshot:async()=>{completed.push(id);return bytes;}}),close:async()=>{active--;}};}};
    const mount=async({page})=>{if(page.id===0)await new Promise(resolve=>setTimeout(resolve,20));return {frame:{url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='browserState'?{text:String(page.id),controls:[],rows:[],overflow:0}:undefined}};};
    const captures=await captureBrowserBaseline({browser,workerBrowsers:[browser,browser],mount,implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'one',states:[{id:'initial',actions:[]}]}]});
    expect(peak).toBe(2);expect(active).toBe(0);expect(completed[0]).toBe(1);expect(captures.map(capture=>capture.semantics.text)).toEqual(['0','1','2','3']);
  });
  it('closes every started context and waits for in-flight cleanup on failure',async()=>{
    const directory=await setup();let started=0,closed=0;
    const browser={newContext:async()=>{const id=started++;return {newPage:async()=>({id,on:()=>{}}),close:async()=>{await new Promise(resolve=>setTimeout(resolve,5));closed++;}};}};
    await expect(captureBrowserBaseline({browser,workerBrowsers:[browser,browser],mount:async()=>{throw Error('mount failed');},implementation:'jsx',sourceRevision:'a'.repeat(40),output:directory,fixtures:[{id:'one',states:[{id:'initial',actions:[]}]}]})).rejects.toThrow('mount failed');
    expect(started).toBe(2);expect(closed).toBe(started);
  });
});
