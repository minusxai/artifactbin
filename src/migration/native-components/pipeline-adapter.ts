import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';import {pathToFileURL} from 'node:url';
import {nativeReceiptDigest} from './receipt-digest.ts';
import {nativeDigest} from './selection.ts';
import {decodeNativePublicationBytes,encodeNativePublicationBytes} from './pipeline-publication.ts';
import {verifyReceipt,selectLatestHead} from './latest-batch-prepare.ts';
import type {LatestBatchPreparation} from './latest-batch-contracts.ts';
import {createNativePipelinePublication,selectNativePipelinePublicationPage,nativePipelineAncillaryInput} from './pipeline-publication-adapter.ts';
import type {NativePipelineRequest,NativePipelinePorts,NativePipelineHostContext,NativePipelineImport} from './pipeline-contracts.ts';
import type {NativePipelineAdapterConfiguration,NativePipelineAdapterPorts,NativePipelineLifecycle} from './pipeline-adapter-contracts.ts';
import type {NativePipelinePublicationConfiguration} from './pipeline-publication-adapter-contracts.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const execute=promisify(execFile);
async function contained(root:string,relative:string){
 if(path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw Error('native_pipeline_adapter_path');
 const base=await realpath(root),file=await realpath(path.resolve(base,relative));if(!file.startsWith(base+path.sep))throw Error('native_pipeline_adapter_path');return file;
}
async function checked(root:string,reference:{path:string;sha256:string}){const file=await contained(root,reference.path),bytes=await readFile(file);if(sha(bytes)!==reference.sha256)throw Error('native_pipeline_adapter_file_digest');return {file,bytes};}
/** Default ports load the reviewed product provider and actual bootstrap; no duplicated SQL/import/camera implementation. */
export function nativePipelineAdapterFilePorts():NativePipelineAdapterPorts {
 return {
  configuration:async request=>{
   const configuration=JSON.parse(await readFile(await contained(request.receiptRoot,'pipeline-host.json'),'utf8')) as NativePipelineAdapterConfiguration;
   const {sha256,...body}=configuration;
   if(configuration.format!=='native-pipeline-host-v1'||configuration.revisionScope!=='latest'||nativeDigest(body)!==sha256||!path.isAbsolute(configuration.targetRoot)||!/^([a-f0-9]{40})$/.test(configuration.targetRevision))throw Error('native_pipeline_adapter_configuration');
   const current=(await execute('git',['rev-parse','HEAD'],{cwd:configuration.targetRoot})).stdout.trim();if(current!==configuration.targetRevision)throw Error('native_pipeline_adapter_target_changed');
   const reference=await checked(request.receiptRoot,configuration.publication);
   const publication=JSON.parse(reference.bytes.toString('utf8')) as NativePipelinePublicationConfiguration;
   if(configuration.ancillaryFolders){const proof=await checked(request.receiptRoot,configuration.ancillaryFolders);if(publication.ancillaryFolders&&!Buffer.from(decodeNativePublicationBytes(publication.ancillaryFolders)).equals(proof.bytes))throw Error('native_pipeline_adapter_ancillary_configuration');publication.ancillaryFolders=encodeNativePublicationBytes(proof.bytes);}
   await checked(configuration.targetRoot,configuration.lifecycle);
   if(configuration.lifecycleConfiguration)await checked(request.receiptRoot,configuration.lifecycleConfiguration);
   return {configuration,publication};
  },
  materialize:materializeNativePipelineAuthority,
  open:async(request,context,configuration)=>{
   const verified=await checked(configuration.targetRoot,configuration.lifecycle);
   if(configuration.lifecycleConfiguration)await checked(request.receiptRoot,configuration.lifecycleConfiguration);
   const provider=await import(pathToFileURL(verified.file).href) as {openNativePipelineLifecycle?:NativePipelineAdapterPorts['open']};
   if(typeof provider.openNativePipelineLifecycle!=='function')throw Error('native_pipeline_adapter_provider_export');
   return provider.openNativePipelineLifecycle(request,context,structuredClone(configuration));
  },
  createProductHost:async(options,configuration)=>{
   const file=await contained(configuration.targetRoot,'scripts/lib/native-migration-bootstrap.ts');
   const product=await import(pathToFileURL(file).href) as {createNativeProductMigrationHost?:(options:unknown)=>ReturnType<NativePipelineAdapterPorts['createProductHost']>};
   if(typeof product.createNativeProductMigrationHost!=='function')throw Error('native_pipeline_adapter_product_export');
   return product.createNativeProductMigrationHost(options);
  },
 };
}
/** Common CLI entrypoint. Each import owns a lifecycle; camera completion/error closes that same lifecycle. */
export async function createNativePipelineAdapter(request:NativePipelineRequest,ports:NativePipelineAdapterPorts=nativePipelineAdapterFilePorts()):Promise<Pick<NativePipelinePorts,'host'>> {
 if(request.revisionScope!=='latest')throw Error('native_pipeline_adapter_latest_required');
 if(request.stage==='assemble')return {};
 const loaded=await ports.configuration(request),configuration=structuredClone(loaded.configuration),sharedPublication=structuredClone(loaded.publication);
 type Active={binding:string;lifecycle:NativePipelineLifecycle;host:NonNullable<NativePipelinePorts['host']>;imported?:NativePipelineImport};
 const active=new Map<string,Active>();const opening=new Set<string>();
 const owner=(context:NativePipelineHostContext)=>nativeDigest({key:context.revision.key,output:path.resolve(context.outputDirectory)});
 const binding=(context:NativePipelineHostContext)=>nativeDigest({key:context.revision.key,assemblyKey:context.assembly.key,assembly:context.assembly.sha256,output:context.outputDirectory});
 async function release(key:string,state:Active){if(active.get(key)===state)active.delete(key);await state.lifecycle.dispose();}
 return {host:{
  importAndPrepare:async context=>{
   const key=owner(context);if(active.has(key)||opening.has(key))throw Error('native_pipeline_adapter_lifecycle_occupied');
   opening.add(key);let lifecycle:NativePipelineLifecycle|undefined;let state:Active|undefined;
   try{
    const admitted=ports.materialize?await ports.materialize(request,context,configuration,structuredClone(sharedPublication)):context;
    lifecycle=await ports.open(structuredClone(request),admitted,structuredClone(configuration));
    if(ports.materialize&&await realpath(lifecycle.objectsDirectory)!==path.join(await realpath(context.outputDirectory),'disposable-target','objects'))throw Error('native_pipeline_adapter_objects_scope');
    const publicationConfiguration=structuredClone(sharedPublication);
    if(ports.materialize)publicationConfiguration.shared.catalog.sinkDirectory=path.join(await realpath(context.outputDirectory),'disposable-target','objects');
    const publication=createNativePipelinePublication(publicationConfiguration);
    const host=await ports.createProductHost({db:lifecycle.db,objectsDirectory:lifecycle.objectsDirectory,...(lifecycle.fixtureAuthSecret?{fixtureAuthSecret:lifecycle.fixtureAuthSecret}:{}),publication,captureAndCompare:lifecycle.captureAndCompare},structuredClone(configuration));
    state={binding:binding(context),lifecycle,host};active.set(key,state);
    const imported=await host.importAndPrepare(admitted);
    if(nativeDigest(imported.key)!==nativeDigest(context.revision.key)||imported.assemblySha256!==context.assembly.sha256)throw Error('native_pipeline_adapter_import_binding');
    state.imported=structuredClone(imported);
    if(request.stage==='import')await release(key,state);
    return imported;
   }catch(error){if(state){if(active.get(key)===state)await release(key,state);}else if(lifecycle)await lifecycle.dispose();throw error;}finally{opening.delete(key);}
  },
  captureAndCompare:async context=>{
   const key=owner(context),state=active.get(key);
   if(!state)throw Error('native_pipeline_adapter_lifecycle_binding');
   if(state.binding!==binding(context)||!state.imported||nativeDigest(context.imported)!==nativeDigest(state.imported)){await release(key,state);throw Error('native_pipeline_adapter_lifecycle_binding');}
   try{return await state.host.captureAndCompare(context);}finally{await release(key,state);}
  },
 }};
}
/** Materialize operator authority only after exact source/assembly admission, before opening a destination. */
export async function materializeNativePipelineAuthority(request:NativePipelineRequest,context:NativePipelineHostContext,configuration:NativePipelineAdapterConfiguration,publication:NativePipelinePublicationConfiguration,options:{objectsDirectory?:string}={}):Promise<NativePipelineHostContext>{
 const authority=configuration.authority;
 if(!authority||!/^([a-f0-9]{40})$/.test(authority.sourceRevision)||!authority.capabilities.length||authority.capabilities.some(c=>typeof c!=='string'||!c)||(!authority.runtime.actor&&!authority.runtime.runtimeActorBySourceUserId)||typeof authority.runtime.origin!=='string')throw Error('native_pipeline_adapter_authority_configuration');
 if(nativeDigest(context.assembly.key)!==nativeDigest(context.revision.key)||context.revision.key.sourceId!==request.head||context.assembly.result.status!=='complete'||!context.assembly.result.html)throw Error('native_pipeline_adapter_assembly_binding');
 const {sha256:assemblySha,...assemblyBody}=context.assembly;
 if(nativeReceiptDigest(assemblyBody)!==assemblySha||context.assembly.sourceRowSha256!==context.revision.rowSha256||sha(Buffer.from(context.assembly.result.html))!==context.assembly.result.htmlSha256)throw Error('native_pipeline_adapter_assembly_digest');
 const batch=JSON.parse(await readFile(request.manifest,'utf8')) as LatestBatchPreparation;verifyReceipt(batch);
 if(batch.sha256!==request.manifestSha256||batch.revisionScope!=='latest'||batch.approvalManifestSha256!==publication.approvedSelectionManifestSha256||batch.identityPlanSha256!==publication.shared.identity.approvedPlanSha256)throw Error('native_pipeline_adapter_batch_binding');
 const heads=batch.heads.filter(h=>h.key.sourceId===request.head);if(heads.length!==1)throw Error('native_pipeline_adapter_head');
 if(authority.runtime.actor&&authority.runtime.runtimeActorBySourceUserId)throw Error('native_pipeline_adapter_runtime_authority_ambiguous');
 const runtimeActor=authority.runtime.runtimeActorBySourceUserId?authority.runtime.runtimeActorBySourceUserId[heads[0]!.ownerPlanRef.sourceUserId]:authority.runtime.actor;
 if(!runtimeActor)throw Error('native_pipeline_adapter_runtime_authority_missing');
 const canonical=await readFile(heads[0]!.sourceFile.path),revision=selectLatestHead(heads[0]!,canonical,batch.identityPlanSha256);
 if(nativeDigest(revision.key)!==nativeDigest(context.revision.key)||revision.rowSha256!==context.revision.rowSha256||revision.documentSha256!==context.revision.documentSha256)throw Error('native_pipeline_adapter_source_binding');
 await selectNativePipelinePublicationPage(publication,canonical,revision);
 const catalog=publication.shared.catalog.projection,{sha256:catalogSha,...catalogBody}=catalog;
 if(nativeDigest(catalogBody)!==catalogSha||catalog.identityPlanSha256!==batch.identityPlanSha256||catalog.selectionSha256!==batch.approvalManifestSha256||catalog.sourceNamespace!==revision.key.sourceNamespace||publication.shared.identity.plan.sha256!==batch.identityPlanSha256)throw Error('native_pipeline_adapter_shared_binding');
 const ancillary=nativePipelineAncillaryInput(publication);
 const rawRelations=decodeNativePublicationBytes(publication.relations);
 const membership={...publication.shared.membership,source:{...publication.shared.membership.source,canonicalSource:encodeNativePublicationBytes(canonical)}};
 for(const [name,bytes]of Object.entries(membership.source)){
  decodeNativePublicationBytes(bytes);const approved=membership.approved[name+'Sha256'];
  if(approved&&approved!==bytes.sha256)throw Error('native_pipeline_adapter_membership_binding');
 }
 const expected=path.resolve(context.outputDirectory,'operator-inputs','authority.json');
 const directory=path.join(await realpath(context.outputDirectory),'operator-inputs'),authorityPath=path.join(directory,'authority.json');
 if(path.resolve(context.authorityRecipePath)!==expected)throw Error('native_pipeline_adapter_authority_output');
 const receiptRoot=await realpath(context.receiptRoot);if(!directory.startsWith(receiptRoot+path.sep))throw Error('native_pipeline_adapter_output_scope');
 const objectsDirectory=options.objectsDirectory??path.join(await realpath(context.outputDirectory),'disposable-target','objects');
 if(!path.isAbsolute(objectsDirectory)||!objectsDirectory.startsWith(receiptRoot+path.sep)||!objectsDirectory.endsWith(path.sep+'disposable-target'+path.sep+'objects'))throw Error('native_pipeline_adapter_objects_scope');
 const values:Record<string,Uint8Array>={sourceHead:canonical,compiledHtml:Buffer.from(context.assembly.result.html),datasetCatalog:Buffer.from(JSON.stringify({...publication.shared.catalog,sinkDirectory:objectsDirectory})),identity:Buffer.from(JSON.stringify(publication.shared.identity)),authSchemaCapability:Buffer.from(JSON.stringify({schemas:publication.shared.schemas,runtime:{actor:runtimeActor,origin:authority.runtime.origin}})),membership:Buffer.from(JSON.stringify(membership)),comments:rawRelations,...(ancillary?{ancillaryFolders:ancillary.bytes}:{})};
 await mkdir(directory,{mode:0o700});const inputs:Record<string,{path:string;sha256:string}>={};
 for(const [name,bytes]of Object.entries(values)){
  const file=path.join(directory,name+'.input');if(!file.startsWith(receiptRoot+path.sep))throw Error('native_pipeline_adapter_output_scope');
  await writeFile(file,bytes,{flag:'wx',mode:0o600});inputs[name]={path:path.relative(receiptRoot,file),sha256:sha(bytes)};
 }
 const recipe={format:'native-migration-host-v1',revisionScope:'latest',key:revision.key,assemblySha256:context.assembly.sha256,sourceRevision:authority.sourceRevision,targetRevision:configuration.targetRevision,inputs,authority:{...publication.shared.schemas,capabilities:[...authority.capabilities]}};
 await writeFile(authorityPath,JSON.stringify(recipe),{flag:'wx',mode:0o600});return {...context,authorityRecipePath:authorityPath};
}
