import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { captureBrowserBaseline, compareBrowserBaselines, candidateCaptureIssues, comparableBehavior } from '../lib/component-browser-baseline.mjs';
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
    expect(entries).toHaveLength(12);
    expect(bodies.filter(body=>body.dataset)).toHaveLength(1);
    const upload=bodies.find(body=>body.markup?.includes('<FileUpload'));
    expect(upload.markup).toContain('src="ref:Dataset123"');
    expect(upload.markup).toContain('name="refs" type="string"');
    expect(upload.markup).not.toContain('{{uploadDataset}}');
    expect(upload.theme).toBe('almanac');
  });
  it('builds candidate fixtures with the installed retained theme and actual modules',async()=>{
    const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
    const repo=path.resolve(import.meta.dirname,'../..');
    const css=await readFile(path.join(repo,'services/app/skills/artifactbin/design-systems/almanac.css'),'utf8');
    const bodies=[];
    await publishBaselineFixtures({implementation:'html',repo,themeCss:()=>css,publish:async body=>{bodies.push(body);return {id:'Page123'};}});
    expect(bodies).toHaveLength(12);
    expect(bodies.every(body=>body.html.includes('data-af-design-system="almanac"')&&body.html.includes('baselineReady'))).toBe(true);
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
