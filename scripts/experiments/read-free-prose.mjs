/**
 * A CLOSED operation over real artifact tables. Only fixed-source-width ASCII prose in a
 * server-certified plain HTML document is admitted. Other edits retain the existing service.
 * One statement owns permission checks, dependency guards, AST/cache/hash, history and NOTIFY.
 * No request-time document SELECT, publisher invocation, SQL UDF or explicit transaction.
 * AST topology, authored IDs, refs, CSS and annotation operations cannot change in this contract;
 * updating unchanged identity rows would be a provable no-op. Existing annotation behavior for
 * requests without annotationOps is preserved. Certification happens after normal publication.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseJsx} from '../../services/app/lib/jsx/parse.ts';
import {editorScope} from '../../services/app/lib/artifacts.ts';
import {newEditId} from '../../services/app/lib/story/splice.ts';
import {trackEvent} from '../../services/app/lib/analytics.ts';
import {storyCssCompileVersion} from '../../services/app/lib/data/story/story-css.server.ts';
import {encodeSource,decodeSource,certifyPlainDocument,encodeProseText} from './validated-operations.mjs';

const ascii=source=>/^[\x00-\x7f]*$/.test(source)&&!source.includes('/people/');
const POLICY='fixed-ascii-prose-v1';
export function certifyReadFreeSource(source){
 if(!ascii(source)||!certifyPlainDocument(encodeSource(source)))return {};
 const parsed=parseJsx(source);assert.ok(parsed.ok);const entries=[];
 const visit=(node,path)=>{
  if(node.type==='text'){
   const raw=encodeProseText(node.value);assert.equal(source.slice(node.start,node.end),raw);
   // Replacing a complete text leaf touches exactly its own interval; its endpoints are
   // child boundaries in the current splice contract. Differentially tested against it.
   entries.push([JSON.stringify([...path,'value']),{start:node.start,end:node.end,spanStart:node.start,spanEnd:node.end}]);
  }else if(node.type==='element')node.children.forEach((child,i)=>visit(child,[...path,'children',String(i)]));
 };
 parsed.nodes.forEach((node,i)=>visit(node,['roots',String(i)]));return {__policy:POLICY,...Object.fromEntries(entries)};
}

export async function createReadFreeWriter(pool){
 const compilerVersion=storyCssCompileVersion();
 const columns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='artifacts' AND table_schema='public' ORDER BY ordinal_position")).rows.map(r=>`u."${r.column_name}"`).join(',');
 return async(actor,id,input)=>{
  assert.deepEqual(Object.keys(input).sort(),['baseVersion','epoch','newText','oldText','path','sharingRevision']);
  const {path,oldText,newText,baseVersion,epoch,sharingRevision}=input;
  assert.ok(Array.isArray(path)&&path.every(k=>typeof k==='string'));
  assert.ok([baseVersion,epoch,sharingRevision].every(Number.isSafeInteger)&&baseVersion>=1&&epoch>=1&&sharingRevision>=0);
  const oldRaw=encodeProseText(oldText),newRaw=encodeProseText(newText);
  assert.ok(ascii(oldRaw)&&ascii(newRaw)&&oldRaw.length===newRaw.length&&oldRaw!==newRaw,'Requires general edit path');
  const scope=editorScope(actor),editId=newEditId();
  const start="(bench_capabilities->$3::text->>'start')::int";
  const nextSource=`overlay(bench_canonical_source placing $4::text from (${start}+1) for length($5::text))`;
  const previous=['id','version','title','description','format','content','source','meta','actor_user_id','actor_token_id','bench_archived_at'];
  const result=await pool.query(`WITH updated AS (
   UPDATE artifacts SET source=jsonb_set(source,$6::text[],to_jsonb($7::text),false),
    bench_canonical_source=${nextSource},
    meta=jsonb_set(meta,'{parsedArtifact,sourceHash}',to_jsonb(encode(sha256(convert_to(${nextSource},'UTF8')),'hex')),false),
    bench_revisions=jsonb_set(bench_revisions,ARRAY[$3::text],to_jsonb(version+1),true),
    bench_archived_at=CASE WHEN bench_archived_at IS NULL OR bench_archived_at<=now()-interval '120 seconds' THEN now() ELSE bench_archived_at END,
    version=version+1,edit_id=$8,actor_user_id=$9,actor_token_id=$10,updated_at=now()
   WHERE id=$1 AND ${scope.where('$2')} AND format='markup' AND sharing_revision=$11
    AND bench_epoch=$12 AND version >= $13 AND bench_capabilities ? $3
    AND COALESCE((bench_revisions->>$3)::int,0)<=$13
    AND source#>>$6::text[]=$14 AND meta ? 'parsedArtifact'
    AND meta->>'cssCompileVersion'=$15 AND bench_capabilities->>'__policy'=$16
    AND substring(bench_canonical_source from (${start}+1) for length($5::text))=$5
   RETURNING WITH (OLD AS o,NEW AS n) n.*,${previous.map(k=>`o.${k} AS previous_${k}`).join(',')}
  ), archived AS (
   INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,meta,actor_user_id,actor_token_id)
   SELECT ${previous.slice(0,-1).map(k=>`previous_${k}`).join(',')} FROM updated
   WHERE previous_bench_archived_at IS NULL OR previous_bench_archived_at<=now()-interval '120 seconds'
   ON CONFLICT DO NOTHING
  ), logged AS (
   INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id)
   SELECT id,edit_id,(bench_capabilities->$3::text->>'start')::int,$5,$4,
    (bench_capabilities->$3::text->>'spanStart')::int,(bench_capabilities->$3::text->>'spanEnd')::int,$9,$10 FROM updated
   RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
  ) SELECT ${columns},COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=u.id),'[]'::jsonb) AS shares
   FROM updated u WHERE EXISTS(SELECT 1 FROM logged)`,
   [id,scope.val,JSON.stringify(path),newRaw,oldRaw,path,newText,editId,actor.userId,actor.tokenId||null,sharingRevision,epoch,baseVersion,oldText,compilerVersion,POLICY]);
  const row=result.rows[0];if(!row)return null;
  row.source=decodeSource(row.source);
  assert.equal(row.source,row.bench_canonical_source);
  assert.equal(row.meta.parsedArtifact.sourceHash,createHash('sha256').update(row.source).digest('hex'));
  void trackEvent('edit',row.id,{userId:row.user_id});return row;
 };
}
