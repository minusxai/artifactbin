import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeMigrationHost} from '../lib/native-migration-host.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>sha(JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value));
async function fixture(run){
 const root=await mkdtemp(path.join(tmpdir(),'native-host-'));
 try{
  const key={sourceNamespace:'synthetic',sourceId:'example',version:7},events=[];
  const inputs={};for(const name of ['sourceHead','compiledHtml','datasetCatalog','identity','authSchemaCapability','membership','comments']){await writeFile(path.join(root,name),name);inputs[name]={path:name,sha256:sha(name)};}
  const recipe={format:'native-migration-host-v1',revisionScope:'latest',key,assemblySha256:sha('assembly'),sourceRevision:'a'.repeat(40),targetRevision:'b'.repeat(40),inputs,authority:{appSchema:'app',authSchema:'auth',capabilities:['reviewed-write']}};
  const recipePath=path.join(root,'recipe.json');await writeFile(recipePath,JSON.stringify(recipe));
  const context={revision:{key},assembly:{key,sha256:recipe.assemblySha256,result:{htmlSha256:inputs.compiledHtml.sha256}},receiptRoot:root,outputDirectory:path.join(root,'output'),authorityRecipePath:recipePath};
  const ports={stage:async value=>{events.push('stage');return value;},transaction:async(_authority,work)=>{events.push('begin');const result=await work({});events.push('commit');return result;},importHistory:async()=>{events.push('import');return {historyProjectionSha256:sha('projection')};},verify:async()=>{events.push('verify');},snapshot:async()=>{events.push('snapshot');await mkdir(context.outputDirectory,{recursive:true});const value={};for(const name of ['preparedStorePath','pilotInputPath','canonicalPath','recoveryPath','bundleDirectory']){value[name]=path.join(context.outputDirectory,name);await mkdir(value[name]);}return value;},captureAndCompare:async input=>{events.push('capture');return {key,assemblySha256:recipe.assemblySha256,status:'verified',comparisonPath:path.join(root,'comparison'),comparisonSha256:sha('report'),baselineEvidencePath:'baseline',candidateEvidencePath:'candidate'};}};
  await run({root,recipe,context,ports,events,save:()=>writeFile(recipePath,JSON.stringify(recipe))});
 }finally{await rm(root,{recursive:true,force:true});}
}
it('imports and verifies within the authorized transaction before snapshotting',()=>fixture(async x=>{
 const host=createNativeMigrationHost({ports:x.ports});const result=await host.importAndPrepare(x.context);
 expect(x.events).toEqual(['stage','begin','import','verify','commit','snapshot']);expect(result).toMatchObject({key:x.recipe.key,assemblySha256:x.recipe.assemblySha256,stage:'imported'});
}));
it('rejects another page, changed input, empty authority and nonlatest scope before staging',()=>fixture(async x=>{
 const host=createNativeMigrationHost({ports:x.ports});
 await expect(host.importAndPrepare({...x.context,revision:{key:{...x.recipe.key,sourceId:'other'}}})).rejects.toThrow('binding');
 await expect(host.importAndPrepare({...x.context,assembly:{...x.context.assembly,result:{htmlSha256:sha('other-html')}}})).rejects.toThrow('compiled-html-binding');
 x.recipe.authority.capabilities=[];await x.save();await expect(host.importAndPrepare(x.context)).rejects.toThrow('authority');
 x.recipe.authority.capabilities=['reviewed-write'];x.recipe.revisionScope='all';await x.save();await expect(host.importAndPrepare(x.context)).rejects.toThrow('recipe');
 x.recipe.revisionScope='latest';await x.save();await writeFile(path.join(x.root,'comments'),'changed');await expect(host.importAndPrepare(x.context)).rejects.toThrow('digest');expect(x.events).toEqual([]);
}));
it('does not snapshot failed transactions or accept a snapshot escaping its output directory',()=>fixture(async x=>{
 x.ports.verify=async()=>{throw Error('readback');};await expect(createNativeMigrationHost({ports:x.ports}).importAndPrepare(x.context)).rejects.toThrow('readback');expect(x.events).not.toContain('snapshot');
 x.ports.verify=async()=>{};x.ports.snapshot=async()=>({preparedStorePath:x.root});await expect(createNativeMigrationHost({ports:x.ports}).importAndPrepare(x.context)).rejects.toThrow('snapshot');
}));
it('requires actual source-bound paired evidence and never invents a successful comparison',()=>fixture(async x=>{
 const host=createNativeMigrationHost({ports:x.ports}),imported=await host.importAndPrepare(x.context);
 await expect(host.captureAndCompare({...x.context,imported:{...imported,assemblySha256:sha('other')},baselineRecipePath:'a',candidateRecipePath:'b'})).rejects.toThrow('binding');
 await expect(host.captureAndCompare({...x.context,imported,baselineRecipePath:'a',candidateRecipePath:'b'})).rejects.toThrow('comparison');
}));

it('the actual camera rejects an unrelated page before opening either reader',async()=>{
 const {createNativeMigrationCamera}=await import('../lib/native-migration-camera.mjs');
 await fixture(async x=>{
  const recipePath=path.join(x.root,'camera.json');await writeFile(recipePath,JSON.stringify({format:'native-migration-camera-recipe-v1',base:'http://localhost:3000',paths:{input:x.context.authorityRecipePath}}));
  const camera=createNativeMigrationCamera({browser:{},connectAgent:()=>{throw Error('must not authenticate');}});
  await expect(camera({...x.context,imported:{assemblySha256:x.recipe.assemblySha256},baselineRecipePath:recipePath,candidateRecipePath:recipePath})).rejects.toThrow('source-binding');
 });
});

it('admits only byte-bound immutable source reuse with complete paired comparison evidence',()=>fixture(async x=>{
 const directory=path.join(x.root,'reuse');await mkdir(directory);
 const baselineEvidencePath=path.join(directory,'migration-pilot.json'),candidateEvidencePath=path.join(x.root,'candidate-proof.json'),baselineInputPath=path.join(x.root,'old-input.json'),candidateInputPath=path.join(x.root,'new-input.json'),comparisonPath=path.join(x.root,'comparison.json');
 const baseline={implementation:'jsx',sourceRevision:'a'.repeat(40),bundleManifestSha256:sha('old-proposal')},candidate={implementation:'html',sourceRevision:'b'.repeat(40),bundleManifestSha256:sha('new-proposal')};
 const write=async(file,value)=>{const bytes=JSON.stringify(value);await writeFile(file,bytes);return sha(bytes);};
 const common={key:x.recipe.key,rowSha256:sha('row'),sourceSha256:sha('source'),documentSha256:sha('document'),canonicalSha256:x.recipe.inputs.sourceHead.sha256,recoverySha256:sha('recovery'),harnessSha256:sha('harness'),originalRevision:x.recipe.sourceRevision,theme:'light',viewports:[{width:390,height:844}],states:[{id:'initial',actions:[]}]};
 const oldInput={...common,bundleFiles:[{path:'index.html',sha256:sha('old-html')}]},newInput={...common,candidateRevision:x.recipe.targetRevision,bundleFiles:[{path:'index.html',sha256:x.context.assembly.result.htmlSha256}]};
 baseline.bundleManifestSha256=digest(oldInput.bundleFiles);candidate.bundleManifestSha256=digest(newInput.bundleFiles);for(const key of ['sourceSha256','documentSha256','canonicalSha256']){baseline[key]=common[key];candidate[key]=common[key];}
 const reuse={baselineInputPath,candidateInputPath,baselineInputSha256:await write(baselineInputPath,oldInput),candidateInputSha256:await write(candidateInputPath,newInput),baselineProofSha256:await write(baselineEvidencePath,baseline),baselineCapturesSha256:await write(path.join(directory,'jsx-captures.json'),[{state:'initial'}])};await write(candidateEvidencePath,candidate);
 const report={format:'native-migration-pilot-reused-source-comparison-v1',passed:true,sourceCaptureReused:true,sourceCaptureRerun:false,reuse,previousProposalSha256:baseline.bundleManifestSha256,newProposalSha256:candidate.bundleManifestSha256,baselineRevision:baseline.sourceRevision,candidateRevision:candidate.sourceRevision,pairedStates:1,control:{detected:true},issues:[],results:[{sizeEqual:true,changedPixels:0,behaviorEqual:true,fontBytesEqual:true,baselineErrors:[],candidateErrors:[],fontProofErrors:[]}]};
 let current=report;
 x.ports.captureAndCompare=async()=>({key:x.recipe.key,assemblySha256:x.recipe.assemblySha256,status:'verified',comparisonPath,comparisonSha256:await write(comparisonPath,current),baselineEvidencePath,candidateEvidencePath});
 const host=createNativeMigrationHost({ports:x.ports}),imported=await host.importAndPrepare(x.context),context={...x.context,imported,baselineRecipePath:'reviewed-baseline',candidateRecipePath:'reviewed-candidate'};
 expect(await host.captureAndCompare(context)).toMatchObject({status:'verified'});
 for(const alter of [r=>{r.sourceCaptureReused=false;},r=>{r.sourceCaptureRerun=true;},r=>{r.previousProposalSha256=sha('other');},r=>{r.newProposalSha256=sha('other');},r=>{r.results=[];},r=>{r.results[0].fontBytesEqual=false;},...['baselineInputSha256','candidateInputSha256','baselineProofSha256','baselineCapturesSha256'].map(field=>r=>{r.reuse[field]=sha('other');})]){current=structuredClone(report);alter(current);await expect(host.captureAndCompare(context)).rejects.toThrow(/native-host-(?:comparison|reuse)/);}
 for(const change of [{key:{...x.recipe.key,sourceId:'other'}},{sourceSha256:sha('another-source')},{viewports:[{width:500,height:844}]}]){current=structuredClone(report);current.reuse.candidateInputSha256=await write(candidateInputPath,{...newInput,...change});await expect(host.captureAndCompare(context)).rejects.toThrow('reuse-binding');}
 oldInput.probe={path:'original-probe.mjs',sha256:sha('original-probe')};newInput.probe={path:'candidate-probe.mjs',sha256:sha('candidate-probe')};baseline.probeSha256=oldInput.probe.sha256;candidate.probeSha256=newInput.probe.sha256;
 const extra={probeSha256:newInput.probe.sha256,ids:['keyboard-selected-name']};
 const extended={...report,originalProbeSha256:oldInput.probe.sha256,candidateProbeSha256:newInput.probe.sha256,additionalCandidateAssertions:extra.ids,reuse:{...reuse,additionalCandidateAssertions:extra,baselineInputSha256:await write(baselineInputPath,oldInput),candidateInputSha256:await write(candidateInputPath,newInput),baselineProofSha256:await write(baselineEvidencePath,baseline)}};await write(candidateEvidencePath,candidate);
 current=extended;expect(await host.captureAndCompare(context)).toMatchObject({status:'verified'});
 for(const alter of [r=>{r.candidateProbeSha256=sha('other');},r=>{r.originalProbeSha256=sha('other');},r=>{r.reuse.additionalCandidateAssertions.probeSha256=sha('other');},r=>{r.reuse.additionalCandidateAssertions.ids=['duplicate','duplicate'];r.additionalCandidateAssertions=['duplicate','duplicate'];},r=>{r.additionalCandidateAssertions=[];}]){current=structuredClone(extended);alter(current);await expect(host.captureAndCompare(context)).rejects.toThrow('reuse-assertions');}

}));
