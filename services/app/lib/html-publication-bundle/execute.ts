import {createHash} from 'node:crypto';
import type {BundlePlan,PublicationBundleMapping} from './contracts';
export interface BundleReceipt extends PublicationBundleMapping { path:string }
interface DependencyWrite {path:string;kind:'asset'|'dataset';contentType:string;base64:string;key:string;/** Stable canonical path slot, including mapped paths whose bytes are omitted on retry. */ reservationIndex:number}
interface SavedDependency {id:string;revision:string;address:string;state?:string}
export interface BundlePublisher {
 reuse(path:string,mapping:PublicationBundleMapping):Promise<string>;
 create(input:DependencyWrite):Promise<SavedDependency>;
 update?(input:DependencyWrite,mapping:PublicationBundleMapping):Promise<SavedDependency>;
}
/** Four independent resources per wave; settle every started write before returning receipts. */
const PUBLICATION_CONCURRENCY=4;
/** Per-resource conditional writes retain their identities and durable receipts across retries. */
export async function publishBundleDependencies(plan:BundlePlan,key:string,publisher:BundlePublisher,mappings:Readonly<Record<string,PublicationBundleMapping>>={}):Promise<{html:string;receipts:BundleReceipt[]}>{
 const addresses=new Map<string,string>(),receipts=new Map<string,BundleReceipt>(),uploaded=new Map<string,Promise<SavedDependency>>(),changed=new Set<string>();
 const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const orderedReceipts=()=>[...new Set([...plan.dependencies.map(dependency=>dependency.path),...Object.keys(mappings)])].flatMap(path=>{const receipt=receipts.get(path);return receipt?[receipt]:[];});
 const settle=async(tasks:readonly (()=>Promise<void>)[])=>{
  const results=await Promise.allSettled(tasks.map(task=>task()));
  const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
  if(failure)throw failure.reason;
 };
 // A changed nested URL also updates its containing CSS/module, even when its author bytes are unchanged.
 for(const dependency of plan.dependencies){const mapping=mappings[dependency.path];if(mapping&&(mapping.sha256!==digest(dependency.bytes)||dependency.dependencies.some(path=>changed.has(path))))changed.add(dependency.path);}
 try{
  const reused=Object.entries(mappings).filter(([name])=>!changed.has(name));
  for(let offset=0;offset<reused.length;offset+=PUBLICATION_CONCURRENCY){
   await settle(reused.slice(offset,offset+PUBLICATION_CONCURRENCY).map(([name,mapping])=>async()=>{addresses.set(name,await publisher.reuse(name,mapping));receipts.set(name,{path:name,...mapping});}));
  }
  const slots=new Map([...new Set([...plan.dependencies.map(dependency=>dependency.path),...Object.keys(mappings)])].sort().map((path,index)=>[path,index]));
  const pending=new Map(plan.dependencies.map(dependency=>[dependency.path,{dependency,reservationIndex:slots.get(dependency.path)!}] as const).filter(([path])=>!addresses.has(path)));
  while(pending.size){
   const ready=[...pending.values()].filter(({dependency})=>dependency.dependencies.every(path=>addresses.has(path))).slice(0,PUBLICATION_CONCURRENCY);
   if(!ready.length)throw Error('Unresolved publication dependency order');
   await settle(ready.map(({dependency,reservationIndex})=>async()=>{
    const base64=/^(?:text\/css|(?:text|application)\/javascript)$/.test(dependency.contentType)?Buffer.from(plan.rewrite(Buffer.from(dependency.bytes).toString('utf8'),dependency.path,addresses)).toString('base64'):Buffer.from(dependency.bytes).toString('base64');
    const input={...dependency,base64,key:key+'_'+Buffer.from(dependency.path).toString('base64url'),reservationIndex},mapping=mappings[dependency.path];let saved:SavedDependency;
    if(mapping){if(!publisher.update)throw Error('Conditional dependency updates unavailable');saved=await publisher.update(input,mapping);}
    else {
     const fingerprint=digest(Buffer.from(JSON.stringify([dependency.kind,dependency.contentType,base64])));
     let write=uploaded.get(fingerprint);
     if(!write){write=publisher.create(input);uploaded.set(fingerprint,write);}
     saved=await write;
    }
    addresses.set(dependency.path,saved.address);receipts.set(dependency.path,{path:dependency.path,kind:dependency.kind,id:saved.id,revision:saved.revision,...(saved.state?{state:saved.state}:{}),sha256:digest(dependency.bytes)});
   }));
   for(const {dependency} of ready)pending.delete(dependency.path);
  }
  return {html:plan.rewrite(plan.html,plan.entryPath,addresses),receipts:orderedReceipts()};
 }catch(cause){throw Object.assign(Error('Dependency publication incomplete',{cause}),{receipts:orderedReceipts()});}
}
