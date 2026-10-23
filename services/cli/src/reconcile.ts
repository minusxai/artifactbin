import {isDeepStrictEqual} from 'node:util';
import {sourceChanges,rebaseEditBatch} from '../../app/lib/cli-toolkit';
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
 const body=mergeSource(base.body,local.body,remote.body);
 if(body===null)fields.push('content');
 return fields.length||body===null?{ok:false,fields}:{ok:true,document:{metadata,body}};
}

/** Both sides' changes to one base source, or null when they touch the same part. */
function mergeSource(base:string,local:string,remote:string):string|null{
 if(local===base||remote===base||local===remote)return local===base?remote:local;
 // Descending base-coordinate changes are an executable intervening edit log.
 // Earlier replacements to the right do not move the remaining left-hand spans.
 const intervening=sourceChanges(base,remote).reverse().map((change,seq)=>({...change,seq,editId:`remote-${seq}`}));
 const merged=rebaseEditBatch(remote,sourceChanges(base,local),intervening);
 return merged.ok?merged.source:null;
}
