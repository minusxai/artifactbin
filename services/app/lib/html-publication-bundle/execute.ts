import {createHash} from 'node:crypto';
import type {BundlePlan,PublicationBundleMapping} from './contracts';
export interface BundleReceipt extends PublicationBundleMapping { path:string }
export interface BundlePublisher {
 reuse(path:string,mapping:PublicationBundleMapping):Promise<string>;
 create(input:{path:string;kind:'asset'|'dataset';contentType:string;base64:string;key:string}):Promise<{id:string;revision:string;address:string}>;
}
/** Dependency receipts are committed independently. A retry uses the same per-path key. */
export async function publishBundleDependencies(plan:BundlePlan,key:string,publisher:BundlePublisher,mappings:Readonly<Record<string,PublicationBundleMapping>>={}):Promise<{html:string;receipts:BundleReceipt[]}>{
 const addresses=new Map<string,string>(),receipts:BundleReceipt[]=[],uploaded=new Map<string,{id:string;revision:string;address:string}>();
 try{
  for(const [name,mapping] of Object.entries(mappings)){const local=plan.dependencies.find(dependency=>dependency.path===name);if(local&&mapping.sha256!==createHash('sha256').update(local.bytes).digest('hex'))throw Error('Changed local dependency requires a separate conditional update: '+name);addresses.set(name,await publisher.reuse(name,mapping));receipts.push({path:name,...mapping});}
  for(const dependency of plan.dependencies){
   if(addresses.has(dependency.path))continue;
   const base64=/^(?:text\/css|(?:text|application)\/javascript)$/.test(dependency.contentType)?Buffer.from(plan.rewrite(Buffer.from(dependency.bytes).toString('utf8'),dependency.path,addresses)).toString('base64'):Buffer.from(dependency.bytes).toString('base64');
   const fingerprint=createHash('sha256').update(JSON.stringify([dependency.kind,dependency.contentType,base64])).digest('hex');
   let saved=uploaded.get(fingerprint);
   if(!saved){saved=await publisher.create({...dependency,base64,key:key+'_'+Buffer.from(dependency.path).toString('base64url')});uploaded.set(fingerprint,saved);}
   addresses.set(dependency.path,saved.address);receipts.push({path:dependency.path,kind:dependency.kind,id:saved.id,revision:saved.revision,sha256:createHash('sha256').update(dependency.bytes).digest('hex')});
  }
  return {html:plan.rewrite(plan.html,plan.entryPath,addresses),receipts};
 }catch(cause){throw Object.assign(Error('Dependency publication incomplete',{cause}),{receipts});}
}
