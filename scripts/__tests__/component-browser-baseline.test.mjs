import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { compareBrowserBaselines, candidateCaptureIssues } from '../lib/component-browser-baseline.mjs';
const directories=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function capture(directory,implementation,color,overrides={}){
  const screenshot=`${implementation}.png`;
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:color}}).png().toBuffer();
  await writeFile(path.join(directory,screenshot),bytes);
  return {fixture:'button',theme:'light',viewport:{width:800,height:600},state:'initial',implementation,fixtureHash:'same-input',sourceRevision:'a'.repeat(40),screenshot,screenshotSha256:createHash('sha256').update(bytes).digest('hex'),semantics:{text:'Continue'},errors:[],...overrides};
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
