import { afterEach, describe, expect, it } from 'vitest';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {JSDOM} from 'jsdom';
import {browserParityFixtures,parityThemes} from '../fixtures/component-baseline/index.mjs';
import { captureBrowserBaseline, compareBrowserBaselines, candidateCaptureIssues, comparableBehavior, stateExpectationIssues, fontLoadingEvidence, fontByteProof } from '../lib/component-browser-baseline.mjs';
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
      for(const file of body.publicationBundle.files){expect(file.path).toMatch(/^(?:components\/[a-z0-9-]+\.js|design-systems\/almanac\.css|fonts\/[a-zA-Z0-9._-]+\.woff2)$/);expect(Buffer.from(file.base64,'base64')).toEqual(await readFile(path.join(repo,'services/app/skills/artifactbin',file.path)));}
      expect(body.publicationBundle.files.some(file=>file.path==='design-systems/almanac.css')).toBe(true);expect(body.html).toContain('href="./design-systems/almanac.css"');
      bodies.push(body);return {id:'Page123'};
    }});
    expect(keys.size).toBe(browserParityFixtures.length*parityThemes.length);
    expect(bodies).toHaveLength(browserParityFixtures.length*parityThemes.length);
    expect(bodies.every(body=>body.html.includes('data-af-design-system="almanac"')&&body.html.includes('baselineReady'))).toBe(true);
  },30_000);
  it('stages real font bytes beside linked skill CSS and lets the normal helper discover them',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs'),{planPublicationBundle}=await import('../../services/app/lib/html-publication-bundle/plan.ts');
    const repo=path.resolve(import.meta.dirname,'../..'),fixtureRepo=await mkdtemp(path.join(tmpdir(),'font-component-publisher-'));try{
      const target=path.join(fixtureRepo,'services/app/skills/artifactbin');await mkdir(path.join(target,'components'),{recursive:true});await mkdir(path.join(target,'fonts'));
      const modules=path.join(repo,'services/app/skills/artifactbin/components');for(const name of await readdir(modules))if(name.endsWith('.js'))await copyFile(path.join(modules,name),path.join(target,'components',name));
      const manifest=JSON.parse(await readFile(path.join(repo,'services/app/lib/data/story/story-font-manifest.json'),'utf8')),face=manifest.systems['DM Sans'].find(face=>face.style==='normal'),name=path.basename(face.url),bytes=await readFile(path.join(repo,'services/app/public',face.url));await writeFile(path.join(target,'fonts',name),bytes);
      let verified=false;
      await expect(publishBaselineFixtures({implementation:'html',repo:fixtureRepo,serverOrigin:'https://example.test',themeCss:()=>`@font-face{font-family:"DM Sans";font-style:${face.style};font-weight:${face.weight};src:url("../fonts/${name}") format("woff2");unicode-range:${face.unicodeRange}}`,publish:async body=>{const plan=planPublicationBundle(body.html,body.publicationBundle),font=plan.dependencies.find(file=>file.path==='fonts/'+name);expect(Buffer.from(font.bytes)).toEqual(bytes);expect(body.html).not.toContain('fonts.gstatic');verified=true;throw Error('font graph verified');}})).rejects.toThrow('font graph verified');expect(verified).toBe(true);
    }finally{await rm(fixtureRepo,{recursive:true,force:true});}
  });
  it('publishes original JSX in an isolated old tree with no candidate helper or packages',async()=>{
    const {execFileSync}=await import('node:child_process'),root=await mkdtemp(path.join(tmpdir(),'old-component-publisher-'));try{
      const fixtureDir=path.join(root,'scripts/fixtures/component-baseline');await mkdir(fixtureDir,{recursive:true});
      for(const name of ['publication.mjs','index.mjs','controls.mjs','rich.mjs'])await copyFile(new URL('../fixtures/component-baseline/'+name,import.meta.url),path.join(fixtureDir,name));
      await writeFile(path.join(root,'verify.mjs'),'import {publishBaselineFixtures} from "./scripts/fixtures/component-baseline/publication.mjs";let count=0;const entries=await publishBaselineFixtures({implementation:"jsx",publish:async body=>{if(body.publicationBundle)throw Error("candidate payload entered old path");count++;return {id:body.dataset?"Dataset123":"Page123"};}});if(entries.length!==50||count!==51)throw Error("original fixture publication missing");process.stdout.write("original-complete");');
      expect(execFileSync(process.execPath,[path.join(root,'verify.mjs')],{cwd:root,encoding:'utf8'})).toContain('original-complete');
    }finally{await rm(root,{recursive:true,force:true});}
  });
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
    const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='browserState'?{text:'Ready',controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]},locator:()=>{throw Error('Element screenshot would clip native top-layer UI');}};
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
      const frame={url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='browserState'?fn():{faces:[],used:[],errors:[]}};
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
    const mount=async({page})=>{if(page.id===0)await new Promise(resolve=>setTimeout(resolve,20));return {frame:{url:()=> 'http://fixture.lvh.me/a/Example1/raw',evaluate:async fn=>fn.name==='browserState'?{text:String(page.id),controls:[],rows:[],overflow:0}:{faces:[],used:[],errors:[]}}};};
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


describe('used font evidence',()=>{
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
});
