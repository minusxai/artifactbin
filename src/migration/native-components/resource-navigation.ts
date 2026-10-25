import {nativeDigest} from './selection.ts';
import {resourceSha256} from './resources.ts';
import type {NativeNavigationPolicy,NativeNavigationPreparation} from './resource-navigation-contracts.ts';
export function prepareNativeNavigation(input:NativeNavigationPreparation):NativeNavigationPolicy{
 const origin=new URL(input.sourceOrigin);
 if(origin.protocol!=='https:'||origin.origin!==input.sourceOrigin||origin.username||origin.password||nativeDigest(input.identityPlan)!==input.approvedPlanSha256)throw Error('native_navigation_authority');
 const seen=new Set<string>();const pages=input.imports.map(entry=>{
  if(!/^[A-Za-z0-9_-]+$/.test(entry.sourceId)||!/^[A-Za-z0-9_-]+$/.test(entry.targetId)||seen.has(entry.sourceId)||!Object.hasOwn(input.identityPlan.artifactIds,entry.sourceId)||input.identityPlan.artifactIds[entry.sourceId]!==entry.targetId||resourceSha256(entry.receiptBytes)!==entry.receiptSha256)throw Error('native_navigation_import');
  seen.add(entry.sourceId);const receipt=JSON.parse(new TextDecoder().decode(entry.receiptBytes));
  if(!['imported','imported-unsnapshotted'].includes(receipt.stage)||receipt.key?.sourceId!==entry.sourceId||receipt.identityPlanSha256!==input.approvedPlanSha256||!['assemblySha256','historyProjectionSha256'].every(key=>/^[a-f0-9]{64}$/.test(receipt[key])))throw Error('native_navigation_import_receipt');
  return {sourceId:entry.sourceId,targetId:entry.targetId,importReceiptSha256:entry.receiptSha256};
 });
 const body={sourceOrigin:origin.origin,identityPlanSha256:input.approvedPlanSha256,pages};return {...body,sha256:nativeDigest(body)};
}
export function verifyNativeNavigation(policy:NativeNavigationPolicy):boolean{
 try{const {sha256,...body}=policy,origin=new URL(policy.sourceOrigin);return nativeDigest(body)===sha256&&origin.protocol==='https:'&&origin.origin===policy.sourceOrigin&&/^[a-f0-9]{64}$/.test(policy.identityPlanSha256)&&new Set(policy.pages.map(page=>page.sourceId)).size===policy.pages.length&&policy.pages.every(page=>/^[A-Za-z0-9_-]+$/.test(page.sourceId)&&/^[A-Za-z0-9_-]+$/.test(page.targetId)&&/^[a-f0-9]{64}$/.test(page.importReceiptSha256));}catch{return false;}
}
/** Shared by static admission and emitted row URL bindings; no network or credentials. */
export function projectNativeUrl(value:unknown,attribute:'href'|'src'|'poster',policy?:NativeNavigationPolicy,urls:readonly {source:string;target:string}[]=[]):string|null{
 if(typeof value!=='string'||!value||/[\u0000-\u0020\u007f\\]/.test(value)||value.startsWith('//'))return null;
 const mapped=urls.find(entry=>entry.source===value);if(mapped)value=mapped.target;
 const source=value as string;
 if(source.startsWith('#'))return attribute==='href'?source:null;
 if(source.startsWith('./assets/')&&!source.slice(2).split('/').some(part=>part==='.'||part==='..'))return mapped?source:null;
 const local=policy&&source.startsWith(policy.sourceOrigin+"/a/")?source.slice(policy.sourceOrigin.length):source;
 const page=/^\/a\/([A-Za-z0-9_-]+)([?#][^\\\s]*)?$/.exec(local);
 if(page){if(mapped)return source;if(!policy)return null;const imported=policy.pages.find(entry=>entry.sourceId===page[1]);return imported?'/a/'+encodeURIComponent(imported.targetId)+(page[2]??''):policy.sourceOrigin+local;}
 try{const url=new URL(source);return !url.username&&!url.password&&(['https:','http:'].includes(url.protocol)||attribute==='href'&&['mailto:','tel:'].includes(url.protocol))?source:null;}catch{return null;}
}
