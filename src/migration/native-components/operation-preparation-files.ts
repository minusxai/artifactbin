import {readFile,mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {prepareNativeSourceOperationRecipe,retainedNativeOperationPreparationPorts} from './operation-preparation.ts';
import type {NativeOperationPreparationFileReference,NativeOperationPreparationFileRequest,NativeOperationPreparationPorts} from './operation-preparation-contracts.ts';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** Reusable batch entry: reads only referenced current catalog files, never scans/query-executes a source service. */
export async function prepareNativeSourceOperationFiles(raw:NativeOperationPreparationFileRequest,injected?:NativeOperationPreparationPorts){
 const request=structuredClone(raw);
 async function checked(ref:NativeOperationPreparationFileReference){const bytes=await readFile(ref.path);if(hash(bytes)!==ref.sha256)throw Error('native_operation_preparation_file_changed');return bytes;}
 const [revision,analysis,index,plan,externalCatalogs]=await Promise.all([checked(request.revision).then(b=>JSON.parse(b.toString())),checked(request.analysis).then(b=>JSON.parse(b.toString())),checked(request.catalogIndex).then(b=>JSON.parse(b.toString())),checked(request.identityPlan).then(b=>JSON.parse(b.toString())),request.externalCatalogs?checked(request.externalCatalogs).then(b=>JSON.parse(b.toString())):undefined]);
 const refs=new Set([...analysis.flow.imports.map((item:any)=>item.ref),...[...analysis.flow.queries,...analysis.flow.values].map((item:any)=>item.source)].filter((ref:unknown)=>typeof ref==='string'&&ref));
 const captures=index.captures.filter((capture:any)=>refs.has(capture.sourceId));
 const catalogs=await Promise.all(captures.map(async(capture:any)=>({...capture,source:{bytes:await checked(capture.source),sha256:capture.source.sha256}})));
 const result=await prepareNativeSourceOperationRecipe({revision,analysis,artifactIds:plan.artifactIds,targetOrigin:request.targetOrigin,probeClockIso:request.probeClockIso,catalogs,externalCatalogs},injected??await retainedNativeOperationPreparationPorts(request.legacyRoot));
 await mkdir(request.output,{mode:0o700});
 async function save(name:string,value:unknown){const bytes=Buffer.from(JSON.stringify(value)),file=path.join(request.output,name);await writeFile(file,bytes,{flag:'wx',mode:0o600});return {path:file,sha256:hash(bytes)};}
 const recipe=await save('recipe.json',result.recipe),compilation=await save('compilation.json',result.compilation);
 const proof=await save('proof.json',{format:'native-source-operation-preparation-v1',key:result.recipe.key,...result.proof,inputs:{revision:request.revision,analysis:request.analysis,catalogIndex:request.catalogIndex,identityPlan:request.identityPlan,...(request.externalCatalogs?{externalCatalogs:request.externalCatalogs}:{})},recipe,compilation,productionWrites:false});
 return {key:result.recipe.key,...recipe,proof};
}
