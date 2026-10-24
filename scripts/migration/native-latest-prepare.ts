/** Offline only: no importer, remote probe, page evaluation or publication port. */
import {readFile,writeFile,mkdir,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {nativeDigest} from '../../src/migration/native-components/selection.ts';
import {prepareLatestBatch,verifyReceipt,assembleLatestPreparedHead} from '../../src/migration/native-components/latest-batch-prepare.ts';
import {retainedCompilerFingerprint} from '../../src/migration/native-components/analyze.ts';
import {externalCompile} from '../../src/migration/conversion/compiled/index.ts';
import type {NativeV3AssemblyReceipt} from '../../src/migration/native-components/v3-publication-contracts.ts';
import type {RetainedCompilerSnapshot} from '../../src/migration/native-components/analyze-contracts.ts';
import type {LatestBatchPreparation,LatestSharedVerification} from '../../src/migration/native-components/latest-batch-contracts.ts';
interface Reference {path:string;sha256:string}
interface Index {sha256:string;revisionScope:string;approvalInventory:Reference&{count:number};identityPlan:Reference;sharedPreparation:Reference;batches:(Reference&{batch:number;heads:number})[]}
const load=async<T>(file:string):Promise<T>=>JSON.parse(await readFile(file,'utf8')) as T;
const seal=<T extends object>(payload:T)=>({...payload,sha256:nativeDigest(payload)});
const save=async(file:string,value:unknown)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const [mode,input,output,legacyRoot,pin,outputDirectory,assemblyDirectory,reuseDirectory]=process.argv.slice(2);
if(mode==='shared'&&input&&output){
 const index=await load<Index>(input);verifyReceipt(index);
 if(index.revisionScope!=='latest'||index.approvalInventory.count!==393||index.batches.length!==6)throw Error('native_latest_approval_scope');
 const approval=await readFile(index.approvalInventory.path);
 if(createHash('sha256').update(approval).digest('hex')!==index.approvalInventory.sha256)throw Error('native_latest_approval_digest');
 const manifest=JSON.parse(approval.toString()) as {receipts:{id:string;expectedVersion:number}[]};
 const plan=await load<{sha256:string}>(index.identityPlan.path);verifyReceipt(plan);
 if(plan.sha256!==index.identityPlan.sha256)throw Error('native_latest_plan_digest');
 const shared=await load<{sha256:string;identityPlan:Reference;datasets:{sourceFile:Reference}[];assets:{sourceFile:Reference}[];typedUserRemaps:Reference;objects:{path:string;sha256:string;bytes:number}[]}>(index.sharedPreparation.path);verifyReceipt(shared);
 if(shared.sha256!==index.sharedPreparation.sha256||shared.identityPlan.sha256!==plan.sha256)throw Error('native_latest_shared_digest');
 const remaps=await load<{sha256:string;identityPlanSha256:string}>(shared.typedUserRemaps.path);verifyReceipt(remaps);
 if(remaps.sha256!==shared.typedUserRemaps.sha256||remaps.identityPlanSha256!==plan.sha256)throw Error('native_latest_remap_digest');
 const sourceFiles=new Map<string,string>();
 for(const item of [...shared.datasets,...shared.assets]){
  const file=path.isAbsolute(item.sourceFile.path)?item.sourceFile.path:path.resolve(path.dirname(index.approvalInventory.path),'closure',item.sourceFile.path);
  if(sourceFiles.has(file)&&sourceFiles.get(file)!==item.sourceFile.sha256)throw Error('native_latest_shared_file_conflict');
  sourceFiles.set(file,item.sourceFile.sha256);
 }
 for(const [file,digest] of sourceFiles)if(createHash('sha256').update(await readFile(file)).digest('hex')!==digest)throw Error('native_latest_shared_file_digest');
 const selected=new Set<string>();
 for(const ref of index.batches){const batch=await load<LatestBatchPreparation>(ref.path);verifyReceipt(batch);
  if(batch.sha256!==ref.sha256||batch.heads.length!==ref.heads||batch.identityPlanSha256!==plan.sha256||batch.approvalManifestSha256!==index.approvalInventory.sha256)throw Error('native_latest_batch_digest');
  for(const head of batch.heads){if(selected.has(head.key.sourceId)||!manifest.receipts.some(r=>r.id===head.key.sourceId&&r.expectedVersion===head.key.version))throw Error('native_latest_selection');selected.add(head.key.sourceId);}
 }
 if(selected.size!==393||manifest.receipts.length!==393)throw Error('native_latest_selection_count');
 for(const object of shared.objects){let bytes=0;const hash=createHash('sha256');for await(const chunk of createReadStream(object.path)){bytes+=chunk.length;hash.update(chunk);}if(bytes!==object.bytes||hash.digest('hex')!==object.sha256)throw Error('native_latest_object_digest');}
 await save(output,seal({format:'native-latest-shared-verified-v1',stage:'preparation-only',indexSha256:index.sha256,sharedSha256:shared.sha256,identityPlanSha256:plan.sha256,batches:index.batches.map(({batch,sha256,heads})=>({batch,sha256,heads})),verifiedObjects:shared.objects.length}));
 console.log(JSON.stringify({stage:'shared-verified',heads:selected.size,objects:shared.objects.length}));
}else if(mode==='batch'&&input&&output&&legacyRoot&&pin&&outputDirectory){
 const batch=await load<LatestBatchPreparation>(input),shared=await load<LatestSharedVerification>(output);
 const results=await prepareLatestBatch(batch,shared,pin,{fingerprint:()=>retainedCompilerFingerprint(legacyRoot),extract:document=>externalCompile<RetainedCompilerSnapshot,{document:unknown}>({document},{legacyRoot},'../../native-components/analyze-runner.mts')},undefined,reuseDirectory&&reuseDirectory!=='-'?async head=>{try{return await load<import('../../src/migration/native-components/latest-batch-contracts.ts').LatestPreparedHead&{sha256:string}>(path.join(reuseDirectory,head.key.sourceId+'.json'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}:undefined);
 const temporary=outputDirectory+'.preparing-'+process.pid;
 await mkdir(path.dirname(outputDirectory),{recursive:true});await mkdir(temporary);
 let assembled=0;try {for(const result of results){await save(path.join(temporary,result.key.sourceId+'.json'),seal(result));
 if(assemblyDirectory&&assemblyDirectory!=='-'){
  const receiptPath=path.join(assemblyDirectory,result.key.sourceId+'.json');
  let receipt:NativeV3AssemblyReceipt;
  try{receipt=await load<NativeV3AssemblyReceipt>(receiptPath);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  for(const files of [receipt.input.files,receipt.result.status==='complete'?receipt.result.files:undefined])for(const file of files??[]){
   const raw=file.bytes as unknown;
   if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&!ArrayBuffer.isView(raw)){
    const object=raw as {type?:unknown;data?:unknown};
    const values=object.type==='Buffer'&&Array.isArray(object.data)&&Object.keys(object).length===2?object.data:Object.entries(raw).map(([k,v],i)=>{if(k!==String(i))throw Error('native_latest_assembly_bytes');return v;});
    if(values.some(v=>!Number.isInteger(v)||Number(v)<0||Number(v)>255))throw Error('native_latest_assembly_bytes');
    file.bytes=Uint8Array.from(values.map(Number));
   }
  }
  const attempt=assembleLatestPreparedHead(result,receipt);if(attempt.status==='assembled')assembled++;
  await save(path.join(temporary,result.key.sourceId+'.assembly.json'),seal(attempt));
 }
}
 await save(path.join(temporary,'index.json'),seal({format:'native-latest-prepared-inputs-v1',batchSha256:batch.sha256,sharedVerificationSha256:shared.sha256,compilerSourceSha256:pin,heads:results.map(r=>({key:r.key,status:r.status,sha256:nativeDigest(r)})),stage:'preparation-only',assembled}));
 await rename(temporary,outputDirectory);
 }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
 console.log(JSON.stringify({batch:batch.batch,prepared:results.filter(r=>r.status==='prepared-input').length,blocked:results.filter(r=>r.status==='source-analysis-blocked').length,assembled}));
}else throw Error('usage: native-latest-prepare.ts shared INDEX NEW_RECEIPT | batch BATCH SHARED_RECEIPT LEGACY_ROOT COMPILER_SHA NEW_OUTPUT_DIRECTORY [EXISTING_ASSEMBLY_RECEIPTS_DIRECTORY_OR_DASH] [EXACT_PREPARED_INPUTS_REUSE_DIRECTORY]');
