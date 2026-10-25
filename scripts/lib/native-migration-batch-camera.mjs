/** Reuse one actual imported store/server/browser across independently bound heads. */
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {preparedPilotStoreDigest as digest} from './native-prepared-pilot-store.mjs';
import {validatePilotInputs,runNativeMigrationPilot} from './native-migration-pilot.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const validHash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const safe=x=>typeof x==='string'&&!path.isAbsolute(x)&&x.split(/[\\/]/).every(p=>p&&p!=='.'&&p!=='..');
const overlap=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
/** Reader metadata is per head; all actual DB/object bytes and auth key must be identical. */
function nativeBatchStoreContentSha256(store){
 const {sha256,reader,...content}=store??{};
 if(!reader||digest({...content,reader})!==sha256)throw Error('native-batch-store-receipt');
 return digest(content);
}
/** @param {import('./native-migration-batch-camera-contract').NativeMigrationCaptureBatch} manifest
 * @returns {import('./native-migration-batch-camera-contract').NativeMigrationAdmittedCaptureBatch} */
export function admitNativeMigrationBatch(manifest,entries){
 const {sha256,...body}=manifest??{};
 if(manifest?.format!=='native-migration-capture-batch-v1'||manifest.revisionScope!=='latest'||!['jsx','html'].includes(manifest.implementation)||digest(body)!==sha256||!Array.isArray(entries)||!entries.length||entries.length!==manifest.entries.length)throw Error('native-batch-manifest');
 const keys=new Set(),outputs=[],pages=new Set();let storeContentSha256,identity,revision,harness;
 for(const [index,{input,paths}] of entries.entries()){
  const ref=manifest.entries[index];
  if(!ref||!['input','canonical','recovery'].every(k=>safe(ref[k]?.path)&&validHash(ref[k]?.sha256))||!safe(ref.bundle)||!safe(ref.output))throw Error('native-batch-path');
  const key=digest([input.key?.sourceNamespace,input.key?.sourceId]),reader=input.preparedStore?.reader,store=nativeBatchStoreContentSha256(input.preparedStore);
  if(!Array.isArray(ref.mutableDatasetIds)||new Set(ref.mutableDatasetIds).size!==ref.mutableDatasetIds.length||ref.mutableDatasetIds.some(id=>!reader?.datasetIds?.includes(id))||ref.mutableDatasetIds.length&&(!safe(ref.mutationReset?.path)||!validHash(ref.mutationReset?.sha256)))throw Error('native-batch-mutation-reset-required');
  if(input.implementation!==manifest.implementation||!input.probe||!reader||reader.version!==input.key.version||keys.has(key)||pages.has(reader.pageId)||outputs.some(p=>overlap(p,paths.output)))throw Error('native-batch-head-binding');
  const currentRevision=input.implementation==='jsx'?input.originalRevision:input.candidateRevision;
  const currentHarness=digest([input.harnessSha256,input.gateManifestSha256]);
  if(storeContentSha256&&(store!==storeContentSha256||identity!==reader.identityPlanSha256||revision!==currentRevision||harness!==currentHarness))throw Error('native-batch-store-mismatch');
  storeContentSha256=store;identity=reader.identityPlanSha256;revision=currentRevision;harness=currentHarness;keys.add(key);pages.add(reader.pageId);outputs.push(paths.output);
 }
 return {manifest:structuredClone(manifest),storeContentSha256,entries:structuredClone(entries)};
}
async function contained(root,relative){if(!safe(relative))throw Error('native-batch-path');const base=await realpath(root),file=await realpath(path.join(base,relative));if(!file.startsWith(base+path.sep))throw Error('native-batch-path');return file;}
/** Admit every source/receipt before the gate boots the first prepared-store server. */
export async function loadNativeMigrationCaptureBatch({root,output}){
 const sourceRoot=await realpath(root),outputRoot=await realpath(output);
 if(overlap(sourceRoot,outputRoot))throw Error('native-batch-output-overlap');
 const manifest=JSON.parse(await readFile(path.join(root,'batch.json'),'utf8')),entries=[];
 for(const entry of manifest.entries??[]){
  const values={};for(const name of ['input','canonical','recovery']){const file=await contained(root,entry[name]?.path),bytes=await readFile(file);if(sha(bytes)!==entry[name]?.sha256)throw Error('native-batch-file-digest');values[name]={file,bytes};}
  const input=JSON.parse(values.input.bytes);validatePilotInputs(input,values.canonical.bytes,values.recovery.bytes);
  if(!safe(entry.output))throw Error('native-batch-output');
  let mutationResetPath;if(entry.mutationReset){mutationResetPath=await contained(root,entry.mutationReset.path);if(sha(await readFile(mutationResetPath))!==entry.mutationReset.sha256)throw Error('native-batch-reset-digest');}
  entries.push({input,...(mutationResetPath?{mutationResetPath}:{}),paths:{input:values.input.file,canonical:values.canonical.file,recovery:values.recovery.file,bundle:await contained(root,entry.bundle),output:path.resolve(output,entry.output)}});
 }
 return admitNativeMigrationBatch(manifest,entries);
}
/** One caller-owned browser/server. Each real pilot keeps normal account login/probe/regression checks.
 * @param {import('./native-migration-batch-camera-contract').NativeMigrationAdmittedCaptureBatch} admitted
 * @param {import('./native-migration-batch-camera-contract').NativeMigrationBatchCapturePorts} ports */
export async function runNativeMigrationCaptureBatch(admitted,{browser,connectAgent,base,capture=runNativeMigrationPilot,state,now=()=>performance.now()}){
 const checked=admitNativeMigrationBatch(admitted.manifest,admitted.entries),started=now(),results=[],dirty=new Set();
 const groupOf=ids=>{const group=new Set(ids);let changed=true;while(changed){changed=false;for(const entry of checked.entries){const deps=entry.input.preparedStore.reader.datasetIds;if(deps.some(id=>group.has(id)))for(const id of deps)if(!group.has(id)){group.add(id);changed=true;}}}return [...group].sort();};
 for(const [index,entry] of checked.entries.entries()){
  const {input,paths}=entry,ref=checked.manifest.entries[index],dependencyGroup=groupOf(input.preparedStore.reader.datasetIds),start=now();
  const item={key:input.key,reader:input.preparedStore.reader,output:paths.output,dependencyGroup};
  if(dependencyGroup.some(id=>dirty.has(id))){results.push({...item,status:'blocked',error:'native-batch-dirty-dependency-group',elapsedMs:now()-start});continue;}
  let reset=state,before,receipt,error,stateRestoration;
  const context={base,browser,connectAgent,input,paths,datasetIds:ref.mutableDatasetIds};
  const checkedState=value=>{if(!value||typeof value!=='object'||Array.isArray(value)||digest(Object.keys(value).sort())!==digest([...ref.mutableDatasetIds].sort()))throw Error('native-batch-state-coverage');return structuredClone(value);};
  try{
   if(ref.mutableDatasetIds.length){
    if(!reset){if(!entry.mutationResetPath||sha(await readFile(entry.mutationResetPath))!==ref.mutationReset.sha256)throw Error('native-batch-reset-digest');const module=await import(pathToFileURL(entry.mutationResetPath).href);reset={read:module.readMutableDatasets,restore:module.restoreMutableDatasets};}
    if(typeof reset?.read!=='function'||typeof reset.restore!=='function')throw Error('native-batch-reset-port-required');
    before=checkedState(await reset.read(context));
   }
   receipt=await capture({base,paths,browser,connectAgent});
  }catch(cause){error=cause instanceof Error?cause.message:'native-batch-capture-failed';}
  if(ref.mutableDatasetIds.length){
   try{if(!before)throw Error('native-batch-state-baseline-missing');await reset.restore(context,structuredClone(before));const after=checkedState(await reset.read(context));stateRestoration={datasetIds:ref.mutableDatasetIds,beforeSha256:digest(before),afterSha256:digest(after)};if(stateRestoration.beforeSha256!==stateRestoration.afterSha256)throw Error('native-batch-state-not-restored');}
   catch(cause){error=cause instanceof Error?cause.message:'native-batch-state-restore-failed';for(const id of dependencyGroup)dirty.add(id);}
  }
  results.push({...item,status:error?'failed':'captured',elapsedMs:now()-start,...(error?{error}:{receipt}),...(stateRestoration?{stateRestoration}:{})});
 }
 return {format:'native-migration-batch-capture-v1',batchSha256:checked.manifest.sha256,storeContentSha256:checked.storeContentSha256,implementation:checked.manifest.implementation,elapsedMs:now()-started,entries:results,complete:results.every(r=>r.status==='captured')};
}
/** Produce one sealed manifest from existing exact per-head camera paths; no copied source or hand-built receipts. */
export async function prepareNativeMigrationCaptureBatch({root,output,paths,mutableDatasetIdsBySourceId,mutationResetBySourceId={}}){
 const base=await realpath(root),entries=[],admitted=[];
 for(const item of paths){
  const entry={};const values={};
  for(const name of ['input','canonical','recovery']){const file=await realpath(item[name]);const relative=path.relative(base,file);if(!safe(relative))throw Error('native-batch-path');const bytes=await readFile(file);entry[name]={path:relative,sha256:sha(bytes)};values[name]=bytes;}
  entry.bundle=path.relative(base,await realpath(item.bundle));entry.output=path.relative(path.resolve(output),path.resolve(item.output));if(!safe(entry.bundle)||!safe(entry.output))throw Error('native-batch-path');
  const input=JSON.parse(values.input);validatePilotInputs(input,values.canonical,values.recovery);entry.mutableDatasetIds=mutableDatasetIdsBySourceId?.[input.key.sourceId];if(mutationResetBySourceId[input.key.sourceId])entry.mutationReset=mutationResetBySourceId[input.key.sourceId];entries.push(entry);admitted.push({input,paths:item});
 }
 const body={format:'native-migration-capture-batch-v1',revisionScope:'latest',implementation:admitted[0]?.input.implementation,entries},manifest={...body,sha256:digest(body)};
 admitNativeMigrationBatch(manifest,admitted);return manifest;
}
