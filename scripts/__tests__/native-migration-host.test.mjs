import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createNativeMigrationHost} from '../lib/native-migration-host.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
async function fixture(run){
 const root=await mkdtemp(path.join(tmpdir(),'native-host-'));
 try{
  const key={sourceNamespace:'synthetic',sourceId:'example',version:7},events=[];
  const inputs={};for(const name of ['sourceHead','compiledHtml','datasetCatalog','identity','authSchemaCapability','membership','comments']){await writeFile(path.join(root,name),name);inputs[name]={path:name,sha256:sha(name)};}
  const recipe={format:'native-migration-host-v1',revisionScope:'latest',key,assemblySha256:sha('assembly'),sourceRevision:'a'.repeat(40),targetRevision:'b'.repeat(40),inputs,authority:{appSchema:'app',authSchema:'auth',capabilities:['reviewed-write']}};
  const recipePath=path.join(root,'recipe.json');await writeFile(recipePath,JSON.stringify(recipe));
  const context={revision:{key},assembly:{key,sha256:recipe.assemblySha256},receiptRoot:root,outputDirectory:path.join(root,'output'),authorityRecipePath:recipePath};
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
