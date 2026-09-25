/** One statement owns the lock, admission guards, JSONB transforms, preimage,
 * invertible UTF-16 source log and notification. No document pre-read or retry.
 * Generic/structural publications mint a new epoch; unrelated prose keeps it.
 */
import type {Queryable} from '@artifactbin/contracts';
import type {ArtifactRow,TokenActor,Scope,EditOutcome} from '../artifacts';
import {decodeArtifactDocument} from '../artifact-document';
import {inertProse,proseSource,type ProseOperation} from './document-prose';
import {SEMANTIC_POLICY} from './document-semantic';
import {newEditId} from './splice';
import {storyCssCompileVersion} from '../data/story/story-css.server';
import {MAX_CONTENT_BYTES} from './input';
import {trackEvent} from '../analytics';
export async function commitProseOperation(db:Queryable,actor:TokenActor,id:string,baseEditId:string,op:ProseOperation,scope:Scope,shares:string):Promise<EditOutcome|null>{
 if(!Array.isArray(op.path)||!op.path.every(x=>typeof x==='string')||!inertProse(op.oldText)||!inertProse(op.newText)||!op.newText.length||op.oldText===op.newText)return null;
 const before=proseSource(op.oldText),after=proseSource(op.newText),editId=newEditId();
 if(op.path.at(-1)!=='value')return null;
 const slot="l.document#>ARRAY['prose',l.slot_id]";
 const position=`l.fixed_start+COALESCE((SELECT sum((entry.value->>'units')::int)::int FROM jsonb_each(l.document->'prose') entry WHERE (entry.value->>'order')::int<l.text_order),0)`;
 const next=`jsonb_set(jsonb_set(l.document,ARRAY['prose',l.slot_id],(${slot})||jsonb_build_object('value',$5::text,'source',$16::text,'bytes',$19::int,'units',$6::int,'revision',l.version+1),false),'{bytes}',to_jsonb((l.document->>'bytes')::int+$7::int),false)`;
 const result=await db.query<{artifact:ArtifactRow}>(`WITH observed AS MATERIALIZED (
  SELECT id,sharing_revision FROM artifacts WHERE id=$1 AND ${scope.where('$2')}
 ), locked AS MATERIALIZED (
  SELECT artifacts.*, ${shares} FROM artifacts WHERE id=$1 AND ${scope.where('$2')} AND sharing_revision=(SELECT sharing_revision FROM observed) FOR UPDATE OF artifacts
 ), slotted AS MATERIALIZED (
  SELECT l.*,l.document#>>$4::text[] AS slot_id FROM locked l
 ), positioned AS MATERIALIZED (
  SELECT l.*, ((${slot})->>'fixedStart')::int AS fixed_start, ((${slot})->>'order')::int AS text_order FROM slotted l
 ), base AS (
  SELECT document_state FROM artifact_edits WHERE artifact_id=$1 AND edit_id=$8
 ), updated AS (
  UPDATE artifacts SET document=${next},source=NULL,meta=l.meta-'parsedArtifact',document_archived_at=CASE WHEN l.document_archived_at IS NULL OR l.document_archived_at<=now()-interval '120 seconds' THEN now() ELSE l.document_archived_at END,version=l.version+1,edit_id=$9,actor_user_id=$10,actor_token_id=$11,updated_at=now()
  FROM positioned l,base b
  WHERE artifacts.id=l.id AND l.format='markup' AND l.document->>'epoch'=b.document_state->>'epoch'
   AND l.document->'prose' ? l.slot_id AND (${slot})->>'value'=$12 AND $3::boolean
   AND ((${slot})->>'revision')::int<=(b.document_state->>'version')::int
   AND l.version-(b.document_state->>'version')::int BETWEEN 0 AND 200
   AND (l.document->>'bytes')::int+$7::int BETWEEN 0 AND $13::int
   AND l.meta->>'cssCompileVersion'=$14 AND l.document->>'policy'=$18 AND l.document->>'contextRequired'='false'
  RETURNING artifacts.*,l.shares,${position} AS text_start,l.document AS old_document,l.meta AS old_meta,l.version AS old_version,l.document_archived_at AS old_archived_at,l.actor_user_id AS old_actor_user_id,l.actor_token_id AS old_actor_token_id
 ), archived AS (
  INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,meta,actor_user_id,actor_token_id,document)
  SELECT id,old_version,title,description,format,content,NULL,old_meta,old_actor_user_id,old_actor_token_id,old_document FROM updated
  WHERE old_archived_at IS NULL OR old_archived_at<=now()-interval '120 seconds' ON CONFLICT DO NOTHING
 ), logged AS (
  INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id,document_state)
  SELECT id,edit_id,text_start,$15,$16,text_start,text_start+$17::int,$10,$11,jsonb_build_object('epoch',document->>'epoch','version',version) FROM updated
  RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
 ) SELECT to_jsonb(u)-ARRAY['text_start','old_document','old_meta','old_version','old_archived_at','old_actor_user_id','old_actor_token_id'] AS artifact FROM updated u WHERE EXISTS(SELECT 1 FROM logged)`,
 [id,scope.val,true,['tree',...op.path.slice(0,-1),'slot'],op.newText,after.length,Buffer.byteLength(after)-Buffer.byteLength(before),baseEditId,editId,actor.userId,actor.tokenId||null,op.oldText,MAX_CONTENT_BYTES,storyCssCompileVersion(),before,after,before.length,SEMANTIC_POLICY,Buffer.byteLength(after)]);
 const row=result.rows[0];if(!row)return null;
 const artifact=decodeArtifactDocument(row.artifact);void trackEvent('edit',artifact.id,{userId:artifact.user_id});return {applied:true,row:artifact};
}
