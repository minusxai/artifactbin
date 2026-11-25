/**
 * Transfer safety without loading unrelated users' document graphs into the app.
 *
 * The transfer set starts as the selected closure (the target and its descendants) and grows along OUTGOING
 * dependency edges: a dependency with exactly the target's current owner joins with its own descendant closure,
 * locked like the closure, until nothing new is reached. A dependency with another owner (or none to be found)
 * refuses. Then nothing outside the set may reference a moved row (inbound). Refusals name the blocking work the
 * actor may read; the rest is only counted.
 */
import type { Queryable } from '../platform';
import {DatasetError} from '../datasets';
import { ownerPredicate, reactionScope, type ArtifactRow } from '@/lib/artifact-access';
import type { AccessActor } from '@/lib/accounts';

const dependencies=(row:ArtifactRow):string[]=>[
 ...((row.meta.refs as Array<{id:string}>|undefined)??[]).map(ref=>ref.id),
 ...((Array.isArray(row.meta.htmlLinks)?row.meta.htmlLinks:[]) as Array<{kind?:string;datasetId?:string}>).flatMap(link=>(link.kind==='dataset'||link.kind==='live-dataset')&&typeof link.datasetId==='string'?[link.datasetId]:[]),
 ...(typeof row.meta.userScopeDocument==='string'?[row.meta.userScopeDocument]:[]),
 ...[...JSON.stringify({source:row.source,document:row.document,meta:row.meta,dataset_policy:row.dataset_policy}).matchAll(/ref:([A-Za-z0-9]{6,12})/g)].map(match=>match[1]!),
];

/** A refusal that names what blocks: `details` is the message with every blocker, then one line per blocker. */
export class TransferConflict extends DatasetError{
 constructor(message:string,public details:string[]){super(message,409);}
}

export const sameOwner=(row:ArtifactRow,owner:ArtifactRow):boolean=>row.group_id===owner.group_id&&row.user_id===owner.user_id&&(!!owner.group_id||!!owner.user_id||row.token_id===owner.token_id);

/** The old greedy tokenizer captures a twelve-character prefix even if more letters follow. */
function inboundRefPattern(ids:string[]):string{
 const alternatives=ids.filter(id=>/^[A-Za-z0-9]{6,12}$/.test(id)).map(id=>id.length===12?id:`${id}(?=[^A-Za-z0-9]|$)`);
 return alternatives.length?`ref:(${alternatives.join('|')})`:'$^';
}

/**
 * Names the blockers: a title where the actor may read the row or owns it (even trashed). An id the actor's own work
 * already names (an outgoing edge) is always listed; an inbound referrer the actor cannot see is only counted.
 */
async function refuse(tx:Queryable,actor:AccessActor,ids:string[],message:string,idsKnown:boolean):Promise<never>{
 const reader=reactionScope(actor),owner=ownerPredicate(actor);
 const seen=new Map((await tx.query<{id:string;title:string|null}>(`SELECT id,title FROM artifacts WHERE id=ANY($1::text[]) AND ((${reader.where('$2')}) OR (${owner.where('$3')}))`,[ids,reader.val,owner.val])).rows.map(row=>[row.id,row.title]));
 const named=ids.filter(id=>idsKnown||seen.has(id)),hidden=ids.length-named.length;
 const items=[...named.map(id=>seen.has(id)?`${seen.get(id)?JSON.stringify(seen.get(id)):'Untitled'} (${id})`:id),...(hidden>0?[`${hidden} more item${hidden===1?'':'s'} you cannot see`]:[])];
 // The first line stands alone (the app shows only it); one line per blocker follows.
 throw new TransferConflict(message,[`${message} Blocking: ${items.join('; ')}.`,...items]);
}

/**
 * Grows `closure` (already locked) by the same-owner work it depends on, locking each added row FOR UPDATE NOWAIT,
 * then refuses if anything else still crosses the set's edge. Returns the whole set to move.
 */
export async function transferSet(tx:Queryable,actor:AccessActor,target:ArtifactRow,closure:ArtifactRow[]):Promise<ArtifactRow[]>{
 const set=new Map(closure.map(row=>[row.id,row]));
 const foreign=new Set<string>();
 let frontier=closure;
 while(frontier.length){
  const wanted=[...new Set(frontier.filter(row=>['html','dataset','viz'].includes(row.format)).flatMap(dependencies))].filter(id=>!set.has(id)&&!foreign.has(id)).sort();
  if(!wanted.length)break;
  const found=(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C" FOR UPDATE NOWAIT',[wanted])).rows;
  const roots=found.filter(row=>sameOwner(row,target)).map(row=>row.id);
  for(const id of wanted)if(!roots.includes(id))foreign.add(id);
  const added=roots.length?(await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE (id=ANY($1::text[]) OR ancestor_ids && $1::text[]) AND NOT (id=ANY($2::text[])) ORDER BY id COLLATE "C" FOR UPDATE NOWAIT',[roots,[...set.keys()]])).rows:[];
  if(added.some(row=>!sameOwner(row,target)))throw new DatasetError('Folder contains work with a different owner',409);
  for(const row of added)set.set(row.id,row);
  frontier=added;
 }
 if(foreign.size)await refuse(tx,actor,[...foreign].sort(),'Transfer includes dependencies outside the selected owner closure: it uses work with a different owner. Transfer that work to the same owner first, or remove the reference.',true);
 await assertNoInbound(tx,actor,[...set.keys()]);
 return [...set.values()];
}

async function assertNoInbound(tx:Queryable,actor:AccessActor,ids:string[]):Promise<void>{
 const pattern=inboundRefPattern(ids),needle=ids.length===1?`ref:${ids[0]}`:'ref:';
 // Keep serialized-key and escaped JSON semantics of the legacy scanner. Only
 // potential ref-bearing fields run the tokenizer regex; no graph crosses the wire.
 const inbound=await tx.query<{id:string}>(`SELECT id
  FROM artifacts WHERE NOT (id=ANY($1::text[])) AND format IN ('html','dataset','viz') AND (
   EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'refs')='array' THEN meta->'refs' ELSE '[]'::jsonb END) ref WHERE ref->>'id'=ANY($1::text[]))
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(meta->'htmlLinks')='array' THEN meta->'htmlLinks' ELSE '[]'::jsonb END) link WHERE link->>'kind' IN ('dataset','live-dataset') AND link->>'datasetId'=ANY($1::text[]))
   OR meta->>'userScopeDocument'=ANY($1::text[])
   OR CASE WHEN strpos(source,$3)>0 THEN source ~ $2 ELSE false END
   OR CASE WHEN strpos(meta::text,$3)>0 THEN meta::text ~ $2 ELSE false END
   OR CASE WHEN strpos(dataset_policy::text,$3)>0 THEN dataset_policy::text ~ $2 ELSE false END
  ) ORDER BY id COLLATE "C" LIMIT 20`,[ids,pattern,needle]);
 if(inbound.rows.length)await refuse(tx,actor,inbound.rows.map(row=>row.id),'Transfer includes dependencies outside the selected owner closure: work that stays behind uses moved items. Transfer them together in one folder, or include that work in the transfer.',false);
}
