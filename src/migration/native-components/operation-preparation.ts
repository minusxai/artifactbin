import {createHash} from 'node:crypto';
import {nativeDigest} from './selection.ts';
import type {NativeOperationPreparationInput,NativeOperationPreparationPorts,NativeOperationPreparationResult} from './operation-preparation-contracts.ts';
import type {NativeCachedCatalogReceipt} from './operation-producer-contracts.ts';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const fail=(reason:string):never=>{throw Error('native_operation_preparation_'+reason);};
/** Exact declarations select captured schemas; compilation and registration remain the existing retained/target ports. */
export async function prepareNativeSourceOperationRecipe(raw:NativeOperationPreparationInput,ports:NativeOperationPreparationPorts):Promise<NativeOperationPreparationResult>{
 // Capture before the first authority await, including byte buffers and ID mappings.
 const input=structuredClone(raw),{revision,analysis}=input;
 if(nativeDigest(revision.key)!==nativeDigest(analysis.key)||nativeDigest(revision.original)!==revision.rowSha256||nativeDigest(revision.original.document)!==revision.documentSha256||analysis.documentSha256!==revision.documentSha256||revision.original.id!==revision.key.sourceId||revision.original.version!==revision.key.version)fail('source_changed');
 const origin=new URL(input.targetOrigin);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('target_origin');
 if(!input.artifactIds[revision.key.sourceId])fail('target_page_missing');
 const epoch=Date.parse(input.probeClockIso);if(!Number.isFinite(epoch)||new Date(epoch).toISOString()!==input.probeClockIso)fail('clock_invalid');
 if(analysis.flow.notifications?.length)fail('notifications_not_admitted');
 const refs=[...new Set([...analysis.flow.imports.map(item=>item.ref),...[...analysis.flow.queries,...analysis.flow.values].map(item=>item.source)].filter((ref):ref is string=>typeof ref==='string'&&!!ref))];
 if(refs.length>256||input.catalogs.length>512)fail('limit');
 const catalogs:NativeCachedCatalogReceipt[]=[],datasets:NativeOperationPreparationResult['recipe']['datasets'][number][]=[],sources:{sourceId:string;sha256:string}[]=[];
 for(const ref of refs){
  const matches=input.catalogs.filter(capture=>capture.sourceId===ref);if(matches.length!==1)fail('catalog_missing_or_ambiguous');const capture=matches[0]!;
  if(hash(capture.source.bytes)!==capture.source.sha256)fail('catalog_bytes_changed');
  const parsed=JSON.parse(Buffer.from(capture.source.bytes).toString('utf8')),heads=parsed.heads?.filter((head:any)=>head.id===ref);if(!Array.isArray(heads)||heads.length!==1)fail('catalog_head_missing');const head=heads[0],catalog=head.meta?.catalog;
  if(head.format!=='dataset'||head.version!==capture.version||!Number.isSafeInteger(capture.version)||capture.version<1||nativeDigest(head)!==capture.headSha256||!catalog||nativeDigest(catalog)!==capture.catalogSha256||nativeDigest({datasetPolicy:head.dataset_policy,policyRevision:head.policy_revision,sharingRevision:head.sharing_revision,visibility:head.visibility,owner:head.user_id})!==capture.policySha256)fail('catalog_head_changed');
  const targetDatasetId=input.artifactIds[ref];if(!targetDatasetId)fail('target_dataset_missing');
  if(!['stored','postgres'].includes(catalog.kind)||!Array.isArray(catalog.tables))fail('catalog_kind');
  const schema={kind:catalog.kind==='postgres'?'postgres':'dataset',tables:catalog.tables.map((table:any)=>({name:table.name,columns:table.columns}))};
  let body={sourceRef:ref,catalog:schema,probes:[]} as Omit<NativeCachedCatalogReceipt,'sha256'>;
  if(catalog.kind==='postgres'){
   const matches=input.externalCatalogs?.filter(receipt=>receipt.sourceRef===ref)??[];if(matches.length!==1)fail('external_probe_missing');const {sha256,...external}=matches[0]!;
   if(nativeDigest(external)!==sha256||nativeDigest(external.catalog)!==nativeDigest(schema)||external.probes.some(probe=>probe.truncated))fail('external_probe_changed');body=external;
  }
  catalogs.push({...body,sha256:nativeDigest(body)});datasets.push({sourceRef:ref,targetDatasetId:targetDatasetId!,version:capture.version,catalogSha256:capture.catalogSha256,policySha256:capture.policySha256,selection:'live-current'});sources.push({sourceId:ref,sha256:capture.source.sha256});
 }
 const fingerprint=await ports.fingerprint();if(fingerprint.compilerSourceSha256!==analysis.compilerSourceSha256)fail('compiler_changed');
 const serialized={document:revision.original.document,analysis,sqlEngineSha256:fingerprint.sqlEngineSha256,probeClockIso:input.probeClockIso,catalogs,queryFunctions:[]};
 const compilation=await ports.compile(serialized);
 if(nativeDigest(await ports.fingerprint())!==nativeDigest(fingerprint)||compilation.compilerSourceSha256!==fingerprint.compilerSourceSha256||compilation.sqlEngineSha256!==fingerprint.sqlEngineSha256||compilation.sourceSha256!==analysis.sourceSha256)fail('compiler_changed');
 const queryFunctions=(compilation.statementFacts??[]).map(fact=>({sqlSha256:fact.sqlSha256,functions:fact.functions}));
 const recipe={key:revision.key,targetPageId:input.artifactIds[revision.key.sourceId]!,targetOrigin:input.targetOrigin,sqlEngineSha256:fingerprint.sqlEngineSha256,probeClockIso:input.probeClockIso,catalogs,queryFunctions,datasets};
 const payload={sourceRowSha256:revision.rowSha256,analysisSha256:analysis.analysisSha256,recipeSha256:nativeDigest(recipe),compilationSha256:nativeDigest(compilation),catalogSourceSha256:sources};
 return {recipe,compilation,proof:{...payload,sha256:nativeDigest(payload)}};
}
/** Default offline composition. No database connection, schema guessing, or page-specific declaration substitutes. */
export async function retainedNativeOperationPreparationPorts(legacyRoot:string):Promise<NativeOperationPreparationPorts>{
 const {retainedNativeFlowFingerprint}=await import('./flow-fingerprint.ts'),{compileNativeFlowOffline}=await import('./flow-producer.ts');
 return {fingerprint:()=>retainedNativeFlowFingerprint(legacyRoot),compile:input=>compileNativeFlowOffline(input,{legacyRoot})};
}
