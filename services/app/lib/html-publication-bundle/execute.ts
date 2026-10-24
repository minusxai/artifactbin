import {createHash} from 'node:crypto';
import type {BundlePlan,PublicationBundleMapping} from './contracts';
export interface BundleReceipt extends PublicationBundleMapping { path:string }
interface DependencyWrite {path:string;kind:'asset'|'dataset';contentType:string;base64:string;key:string}
interface SavedDependency {id:string;revision:string;address:string;state?:string}
export interface BundlePublisher {
 reuse(path:string,mapping:PublicationBundleMapping):Promise<string>;
 create(input:DependencyWrite):Promise<SavedDependency>;
 update?(input:DependencyWrite,mapping:PublicationBundleMapping):Promise<SavedDependency>;
}
/** Per-resource conditional writes retain their identities and durable receipts across retries. */
export async function publishBundleDependencies(plan:BundlePlan,key:string,publisher:BundlePublisher,mappings:Readonly<Record<string,PublicationBundleMapping>>={}):Promise<{html:string;receipts:BundleReceipt[]}>{
 const addresses=new Map<string,string>(),receipts:BundleReceipt[]=[],uploaded=new Map<string,SavedDependency>(),changed=new Set<string>();
 const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 // A changed nested URL also updates its containing CSS/module, even when its author bytes are unchanged.
 for(const dependency of plan.dependencies){const mapping=mappings[dependency.path];if(mapping&&(mapping.sha256!==digest(dependency.bytes)||dependency.dependencies.some(path=>changed.has(path))))changed.add(dependency.path);}
 try{
  for(const [name,mapping] of Object.entries(mappings)){if(changed.has(name))continue;addresses.set(name,await publisher.reuse(name,mapping));receipts.push({path:name,...mapping});}
  for(const dependency of plan.dependencies){
   if(addresses.has(dependency.path))continue;
   const base64=/^(?:text\/css|(?:text|application)\/javascript)$/.test(dependency.contentType)?Buffer.from(plan.rewrite(Buffer.from(dependency.bytes).toString('utf8'),dependency.path,addresses)).toString('base64'):Buffer.from(dependency.bytes).toString('base64');
   const input={...dependency,base64,key:key+'_'+Buffer.from(dependency.path).toString('base64url')},mapping=mappings[dependency.path];let saved:SavedDependency;
   if(mapping){if(!publisher.update)throw Error('Conditional dependency updates unavailable');saved=await publisher.update(input,mapping);}
   else {const fingerprint=digest(Buffer.from(JSON.stringify([dependency.kind,dependency.contentType,base64])));const existing=uploaded.get(fingerprint);saved=existing??await publisher.create(input);if(!existing)uploaded.set(fingerprint,saved);}
   addresses.set(dependency.path,saved.address);receipts.push({path:dependency.path,kind:dependency.kind,id:saved.id,revision:saved.revision,...(saved.state?{state:saved.state}:{}),sha256:digest(dependency.bytes)});
  }
  return {html:plan.rewrite(plan.html,plan.entryPath,addresses),receipts};
 }catch(cause){throw Object.assign(Error('Dependency publication incomplete',{cause}),{receipts});}
}
