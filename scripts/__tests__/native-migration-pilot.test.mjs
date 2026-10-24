import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {validatePilotInputs,pilotFixture,pilotComparisonIssues,stylingRegressionEvidence,pilotHarnessSha256,compareNativeMigrationPilot} from '../lib/native-migration-pilot.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
const digest=value=>sha(canonical(value));
function input(){
 const row={version:3,document:{kind:'graph',nodes:{}},title:'Synthetic',meta:{theme:'almanac',colorMode:'light'}};
 const page=Buffer.from(JSON.stringify({heads:[row],versions:[]}));
 const recovery=Buffer.from(JSON.stringify({key:{sourceNamespace:'synthetic',sourceId:'source',version:3},documentSha256:digest(row.document),sourceSha256:sha('<p>Actual</p>'),source:'<p>Actual</p>'}));
 const manifest={format:'native-migration-pilot-v1',harnessSha256:'c'.repeat(64),implementation:'jsx',originalRevision:'a'.repeat(40),candidateRevision:'b'.repeat(40),canonicalSha256:sha(page),recoverySha256:sha(recovery),key:{sourceNamespace:'synthetic',sourceId:'source',version:3},rowSha256:digest(row),documentSha256:digest(row.document),sourceSha256:sha('<p>Actual</p>'),bundleFiles:[{path:'index.html',sha256:sha('native')}],theme:'light',viewports:[{width:1280,height:900}],states:[{id:'initial',actions:[]}]};
 return {manifest,page,recovery};
}
describe('private native migration pilot admission',()=>{
 it('selects exact canonical revision and digest-bound recovered bytes without rendering replacement source',()=>{
  const x=input(),result=validatePilotInputs(x.manifest,x.page,x.recovery);
  expect(result.markup).toBe('<p>Actual</p>');expect(result.row.version).toBe(3);
  expect(pilotFixture(x.manifest).oldJsx).toBe('');expect(pilotFixture(x.manifest).newHtml).toBe('');
 });
 it('rejects changed exports/recovery/rows, mismatched versions and ambiguous canonical rows',()=>{
  const x=input();expect(()=>validatePilotInputs(x.manifest,Buffer.from('changed'),x.recovery)).toThrow('canonical');
  expect(()=>validatePilotInputs({...x.manifest,rowSha256:'f'.repeat(64)},x.page,x.recovery)).toThrow('row');
  expect(()=>validatePilotInputs({...x.manifest,key:{...x.manifest.key,version:2}},x.page,x.recovery)).toThrow('revision');
  const repeated=JSON.parse(x.page);repeated.versions=[repeated.heads[0]];const bytes=Buffer.from(JSON.stringify(repeated));expect(()=>validatePilotInputs({...x.manifest,canonicalSha256:sha(bytes)},bytes,x.recovery)).toThrow('ambiguous');
 });
 it('does not treat missing paired evidence or the absence of a regression signal as a pass',()=>{
  expect(pilotComparisonIssues([],{detected:true})).toContain('missing-paired-states');
  expect(pilotComparisonIssues([{changedPixels:0,sizeEqual:true,behaviorEqual:true,fontBytesEqual:true,baselineErrors:[],candidateErrors:[],fontProofErrors:[]}],{detected:false})).toContain('styling-regression-control-not-detected');
 });
});

it('detects a deliberate styling pixel regression and rejects changed screenshot receipts',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'pilot-regression-'));
 try{
  const image=async(name,color)=>{const bytes=await sharp({create:{width:2,height:2,channels:4,background:color}}).png().toBuffer();await writeFile(path.join(directory,name),bytes);return {state:'initial',theme:'light',viewport:{width:2,height:2},screenshot:name,screenshotSha256:sha(bytes)};};
  const candidate=await image('candidate.png','white'),regression=await image('regression.png','black');
  expect(await stylingRegressionEvidence({candidate:[candidate],regression:[candidate],directory,regressionDirectory:directory})).toMatchObject({detected:false});
  expect(await stylingRegressionEvidence({candidate:[candidate],regression:[regression],directory,regressionDirectory:directory})).toMatchObject({detected:true,states:[{changedPixels:4}]});
  await expect(stylingRegressionEvidence({candidate:[candidate],regression:[{...regression,screenshotSha256:'f'.repeat(64)}],directory,regressionDirectory:directory})).rejects.toThrow('image-digest');
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('binds harness files and refuses unmatched paired source evidence before comparing screenshots',async()=>{
 expect(await pilotHarnessSha256(path.resolve(import.meta.dirname,'../..'))).toMatch(/^[a-f0-9]{64}$/);
 const directory=await mkdtemp(path.join(tmpdir(),'pilot-pair-'));
 try{
  const proof={format:'native-migration-pilot-capture-v1',implementation:'jsx',sourceSha256:'a'};
  await writeFile(path.join(directory,'migration-pilot.json'),JSON.stringify(proof));await writeFile(path.join(directory,'jsx-captures.json'),'[]');await writeFile(path.join(directory,'html-captures.json'),'[]');
  await expect(compareNativeMigrationPilot({baselineDirectory:directory,candidateDirectory:directory,output:directory})).rejects.toThrow('unmatched');
 }finally{await rm(directory,{recursive:true,force:true});}
});
