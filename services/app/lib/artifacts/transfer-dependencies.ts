/** Transfer safety without loading unrelated users' document graphs into the app. */
import type {Queryable} from '../platform/db';
import {DatasetError} from '../datasets/errors';
import type { ArtifactRow } from './table';

const dependencies=(row:ArtifactRow):string[]=>[
 ...((row.meta.refs as Array<{id:string}>|undefined)??[]).map(ref=>ref.id),
 ...(typeof row.meta.userScopeDocument==='string'?[row.meta.userScopeDocument]:[]),
 ...[...JSON.stringify({source:row.source,document:row.document,meta:row.meta,dataset_policy:row.dataset_policy}).matchAll(/ref:([A-Za-z0-9]{6,12})/g)].map(match=>match[1]!),
];

/** The old greedy tokenizer captures a twelve-character prefix even if more letters follow. */
function inboundRefPattern(ids:string[]):string{
 const alternatives=ids.filter(id=>/^[A-Za-z0-9]{6,12}$/.test(id)).map(id=>id.length===12?id:`${id}(?=[^A-Za-z0-9]|$)`);
 return alternatives.length?`ref:(${alternatives.join('|')})`:'$^';
}

export async function assertTransferDependencies(tx:Queryable,closure:ArtifactRow[]):Promise<void>{
 const ids=closure.map(row=>row.id),selected=new Set(ids);
 // Only selected rows cross the wire with content. Their outgoing edges must stay inside.
 if(closure.some(row=>['markup','dataset','viz'].includes(row.format)&&dependencies(row).some(id=>!selected.has(id))))throw new DatasetError('Transfer includes dependencies outside the selected owner closure',409);
 const pattern=inboundRefPattern(ids),needle=ids.length===1?`ref:${ids[0]}`:'ref:';
 // Keep serialized-key and escaped JSON semantics of the legacy scanner. Only
 // potential ref-bearing fields run the tokenizer regex; no graph crosses the wire.
 const inbound=await tx.query<{id:string;grant:boolean}>(`SELECT id,
   (dataset_policy::text ~ '"artifact"[[:space:]]*:' AND EXISTS (
     SELECT 1 FROM unnest($1::text[]) selected(id) WHERE strpos(dataset_policy::text,'"' || selected.id || '"') > 0
   )) AS grant
  FROM artifacts WHERE NOT (id=ANY($1::text[])) AND format IN ('markup','dataset','viz') AND (
   EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'refs')='array' THEN meta->'refs' ELSE '[]'::jsonb END) ref WHERE ref->>'id'=ANY($1::text[]))
   OR meta->>'userScopeDocument'=ANY($1::text[])
   OR CASE WHEN strpos(source,$3)>0 THEN source ~ $2 ELSE false END
   OR CASE WHEN strpos(meta::text,$3)>0 THEN meta::text ~ $2 ELSE false END
   OR CASE WHEN strpos(dataset_policy::text,$3)>0 THEN dataset_policy::text ~ $2 ELSE false END
   OR CASE WHEN strpos(document::text,$3)>0 THEN document::text ~ $2 ELSE false END
   OR (dataset_policy::text ~ '"artifact"[[:space:]]*:' AND EXISTS (
     SELECT 1 FROM unnest($1::text[]) selected(id) WHERE strpos(dataset_policy::text,'"' || selected.id || '"') > 0
   ))
  ) LIMIT 1`,[ids,pattern,needle]);
 if(inbound.rows.length)throw new DatasetError(inbound.rows[0]!.grant?'Transfer would change a dataset grant outside the closure':'Transfer includes dependencies outside the selected owner closure',409);
}
