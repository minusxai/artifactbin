import {isDeepStrictEqual} from 'node:util';
import {sourceChanges} from '../../app/lib/story/source-changes';
import {rebaseEditBatch} from '../../app/lib/story/edit-batch';
import {metadataFields,type LocalDocument} from './document';

/** Pure local reconciliation. Identity comes from remote; permission lists are indivisible fields. */
export type Reconciliation = {ok:true;document:LocalDocument}|{ok:false;fields:string[]};
export function reconcileDocument(base:LocalDocument,local:LocalDocument,remote:LocalDocument):Reconciliation{
 const fields:string[]=[];
 const metadata={...remote.metadata};
 for(const key of metadataFields){
  const desired=local.metadata[key];
  // Omitted editable metadata preserves server state, just like push.
  if(desired===undefined||isDeepStrictEqual(desired,base.metadata[key]))continue;
  if(!isDeepStrictEqual(remote.metadata[key],base.metadata[key])&&!isDeepStrictEqual(desired,remote.metadata[key]))fields.push(key);
  else Object.assign(metadata,{[key]:desired});
 }
 let body=remote.body;
 if(local.body!==base.body){
  if(remote.body===base.body||local.body===remote.body)body=local.body;
  else{
   // Descending base-coordinate changes are an executable intervening edit log.
   // Earlier replacements to the right do not move the remaining left-hand spans.
   const intervening=sourceChanges(base.body,remote.body).reverse().map((change,seq)=>({...change,seq,editId:`remote-${seq}`}));
   const merged=rebaseEditBatch(remote.body,sourceChanges(base.body,local.body),intervening);
   if(merged.ok)body=merged.source;else fields.push('content');
  }
 }
 return fields.length?{ok:false,fields}:{ok:true,document:{metadata,body}};
}
