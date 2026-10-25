import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {nativeDigest} from './selection.ts';
import {prepareNativeSourceOperationRecipe} from './operation-preparation.ts';
import type {NativeOperationPreparationInput,NativeOperationPreparationPorts} from './operation-preparation-contracts.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function fixture(imported=true){
 const document={kind:'synthetic'},key={sourceNamespace:'fixture',sourceId:'page',version:2},original={id:'page',version:2,document,format:'jsx'};
 const head={id:'dataset',version:3,format:'dataset',meta:{catalog:{kind:'stored',tables:[{name:'rows',columns:[{name:'id',type:'string'}]}]}},dataset_policy:{},policy_revision:1,sharing_revision:2,visibility:'private',user_id:'owner'};
 const bytes=Buffer.from(JSON.stringify({heads:[head]}));
 const input:NativeOperationPreparationInput={revision:{key,rowSha256:nativeDigest(original),documentSha256:nativeDigest(document),original,matchingArchives:[]},analysis:{key,documentSha256:nativeDigest(document),sourceSha256:'b'.repeat(64),analysisSha256:'c'.repeat(64),compilerSourceSha256:'d'.repeat(64),nodes:[],sourceSpans:[],flow:{values:[],queries:[{name:'rows',start:0,end:1,...(!imported?{source:'dataset'}:{})}],mutations:[],imports:imported?[{name:'records',ref:'dataset',start:0,end:1}]:[]}},targetOrigin:'https://example.invalid',artifactIds:{page:'target-page',dataset:'target-dataset'},probeClockIso:'2026-01-01T00:00:00.000Z',catalogs:[{sourceId:'dataset',version:3,headSha256:nativeDigest(head),catalogSha256:nativeDigest(head.meta.catalog),policySha256:nativeDigest({datasetPolicy:head.dataset_policy,policyRevision:1,sharingRevision:2,visibility:'private',owner:'owner'}),source:{bytes,sha256:sha(bytes)}}]};
 const compilation={sourceSha256:input.analysis.sourceSha256,compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'e'.repeat(64),imports:[],values:[],queries:[],mutations:[]};
 const calls:any[]=[];const ports:NativeOperationPreparationPorts={fingerprint:async()=>({compilerSourceSha256:input.analysis.compilerSourceSha256,sqlEngineSha256:'e'.repeat(64)}),compile:async source=>{calls.push(source);return compilation;}};
 return{input,ports,calls};
}
for(const imported of [true,false])test(`prepares exact current catalog from source declarations (${imported?'import':'direct source'})`,async()=>{
 const {input,ports,calls}=fixture(imported),result=await prepareNativeSourceOperationRecipe(input,ports);
 assert.equal(calls.length,1);assert.equal(calls[0].catalogs[0].catalog.kind,'dataset');assert.deepEqual(calls[0].catalogs[0].catalog.tables,[{name:'rows',columns:[{name:'id',type:'string'}]}]);
 assert.equal(result.recipe.targetPageId,'target-page');assert.equal(result.recipe.datasets[0]!.targetDatasetId,'target-dataset');assert.equal(result.recipe.datasets[0]!.selection,'live-current');assert.equal(result.recipe.datasets[0]!.version,3);assert.equal(result.proof.recipeSha256,nativeDigest(result.recipe));assert.equal(result.proof.catalogSourceSha256.length,1);
});
test('refuses changed source bytes, policy, missing mappings, duplicate receipts and compiler drift before issuing recipe',async()=>{
 for(const mutate of [(x:NativeOperationPreparationInput)=>x.catalogs[0]!.source.bytes[0]=0,(x:NativeOperationPreparationInput)=>x.catalogs[0]!.policySha256='0'.repeat(64),(x:NativeOperationPreparationInput)=>delete (x.artifactIds as any).dataset,(x:NativeOperationPreparationInput)=>(x.catalogs as any[]).push(x.catalogs[0]),(x:NativeOperationPreparationInput)=>x.revision.rowSha256='0'.repeat(64)]){const f=fixture();mutate(f.input);await assert.rejects(prepareNativeSourceOperationRecipe(f.input,f.ports));assert.equal(f.calls.length,0);}
 const f=fixture();let checks=0;f.ports.fingerprint=async()=>({compilerSourceSha256:f.input.analysis.compilerSourceSha256,sqlEngineSha256:(++checks===1?'e':'f').repeat(64)});await assert.rejects(prepareNativeSourceOperationRecipe(f.input,f.ports),/compiler_changed/);
});
test('captures caller source and mappings before waiting on compiler authority',async()=>{
 const f=fixture();let release=()=>{};const gate=new Promise<void>(resolve=>release=resolve),fp=f.ports.fingerprint;f.ports.fingerprint=async()=>{await gate;return fp();};
 const pending=prepareNativeSourceOperationRecipe(f.input,f.ports);(f.input.artifactIds as any).dataset='wrong';f.input.catalogs[0]!.source.bytes[0]=0;release();const result=await pending;assert.equal(result.recipe.datasets[0]!.targetDatasetId,'target-dataset');
});
test('serialized worker preparation verifies input files and writes exclusive pipeline recipe references',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path'),{prepareNativeSourceOperationFiles}=await import('./operation-preparation-files.ts');
 const f=fixture(),root=await mkdtemp(path.join(tmpdir(),'native-operation-files-'));
 const put=async(name:string,value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value)),file=path.join(root,name);await writeFile(file,bytes);return {path:file,sha256:sha(bytes)};};
 try{
  const capture=f.input.catalogs[0]!,source=await put('source.json',JSON.parse(Buffer.from(capture.source.bytes).toString()));
  const request={legacyRoot:'unused-injected',revision:await put('revision.json',f.input.revision),analysis:await put('analysis.json',f.input.analysis),catalogIndex:await put('catalogs.json',{captures:[{...capture,source}]}),identityPlan:await put('identity.json',{artifactIds:f.input.artifactIds}),targetOrigin:f.input.targetOrigin,probeClockIso:f.input.probeClockIso,output:path.join(root,'prepared')};
  const output=await prepareNativeSourceOperationFiles(request,f.ports);assert.equal(sha(await readFile(output.path)),output.sha256);assert.equal(JSON.parse(await readFile(output.path,'utf8')).targetPageId,'target-page');await assert.rejects(prepareNativeSourceOperationFiles(request,f.ports),/EEXIST/);
  await writeFile(source.path,'changed');await assert.rejects(prepareNativeSourceOperationFiles({...request,output:path.join(root,'changed')},f.ports),/file_changed/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('external preparation accepts only exact captured nontruncated probes and never contacts a database',async()=>{
 const f=fixture(false),capture=f.input.catalogs[0]!,source=JSON.parse(Buffer.from(capture.source.bytes).toString()),head=source.heads[0];head.meta.catalog.kind='postgres';capture.source.bytes=Buffer.from(JSON.stringify(source));capture.source.sha256=sha(capture.source.bytes);capture.headSha256=nativeDigest(head);capture.catalogSha256=nativeDigest(head.meta.catalog);
 const body={sourceRef:'dataset',catalog:{kind:'postgres',tables:head.meta.catalog.tables},probes:[{sql:'select id from rows',params:{},types:{},columns:[{name:'id',type:'string'}],paramNames:[],truncated:false}]};
 await assert.rejects(prepareNativeSourceOperationRecipe(f.input,f.ports),/external_probe_missing/);assert.equal(f.calls.length,0);
 f.input.externalCatalogs=[{...body,sha256:nativeDigest(body)}];const result=await prepareNativeSourceOperationRecipe(f.input,f.ports);assert.deepEqual(result.recipe.catalogs[0]!.probes,body.probes);
 f.input.externalCatalogs[0]!.probes[0]!.truncated=true;await assert.rejects(prepareNativeSourceOperationRecipe(f.input,f.ports),/external_probe_changed/);
});
