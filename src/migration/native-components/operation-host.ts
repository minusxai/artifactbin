import {nativeDigest} from './selection.ts';
import type {NativeCachedCatalogReceipt,NativeOperationProducerHost} from './operation-producer-contracts.ts';
/** Exact cached probe inputs only. A changed/missing probe is a refusal, never an inferred schema. */
export function cachedNativeCatalogResolver(receipts:readonly NativeCachedCatalogReceipt[]):(ref:string)=>Promise<unknown>{
 const catalogs=new Map<string,NativeCachedCatalogReceipt>();
 for(const receipt of receipts){const {sha256,...body}=receipt;if(catalogs.has(receipt.sourceRef)||nativeDigest(body)!==sha256)throw Error('cached_catalog_receipt_changed');catalogs.set(receipt.sourceRef,structuredClone(receipt));}
 return async ref=>{
  const receipt=catalogs.get(ref);if(!receipt)throw Error('cached_catalog_missing');
  return {...structuredClone(receipt.catalog),probe:async(sql:string,params:unknown,types:unknown)=>{
   const found=receipt.probes.filter(p=>p.sql===sql&&nativeDigest(p.params)===nativeDigest(params)&&nativeDigest(p.types)===nativeDigest(types));
   if(found.length!==1||found[0]!.truncated)throw Error('cached_query_probe_missing');
   return {columns:structuredClone(found[0]!.columns),params:[...found[0]!.paramNames]};
  }};
 };
}
/** Actual target descriptor/schema/roundtrip adapter. No persistence or network calls. */
export async function registeredNativeOperationHost(options:{targetRoot:string;targetPageId:string;version:number}):Promise<NativeOperationProducerHost>{
 const {pathToFileURL}=await import('node:url'),{resolve}=await import('node:path');
 const load=(relative:string)=>import(pathToFileURL(resolve(options.targetRoot,'services/app/lib',relative)).href);
 const [queries,queryRegistry,mutations,mutationRegistry]=await Promise.all([load('registered-page-queries/namespace.ts'),load('registered-page-queries/registry.ts'),load('registered-page-mutations/namespace.ts'),load('registered-page-mutations/registry.ts')]);
 return {query:queries.registeredQueryDescriptor,mutation:mutations.registeredMutationDescriptor,viewer:queries.registeredViewerDescriptor,verify(receipt){
  const page={pageId:options.targetPageId,version:options.version,html:'<!doctype html><html><head></head><body></body></html>'};
  const registry=receipt.kind==='query'?queryRegistry:mutationRegistry;
  const prepared=(receipt.kind==='query'?registry.prepareRegisteredQueryBackend:registry.prepareRegisteredMutationBackend)(receipt.namespace,receipt.backendId,page,receipt.program,receipt.provenance);
  const restored=(receipt.kind==='query'?registry.registeredPlan:registry.registeredMutationPlan)({...page,links:[prepared.link]},prepared.link,{...prepared.backend,backendId:receipt.backendId,pageId:page.pageId,version:prepared.link.version,secretBindings:[],files:[]});
  if(!restored)throw Error('operation_registered_roundtrip_failed');
  const {registration,...program}=restored;void registration;
  if(nativeDigest(program)!==nativeDigest(receipt.program))throw Error('operation_registered_program_changed');
 }};
}
