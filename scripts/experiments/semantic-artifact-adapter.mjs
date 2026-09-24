/** Research adapter for the real artifacts/versions/edits tables. Full app writes retain
 * their preparation, identity, annotation and reference machinery. Source storage alone
 * changes. The direct prose writer uses the validated semantic contract and the EXISTING
 * source-splice log, including variable-length UTF-16 offsets and unchanged public IDs.
 */
import assert from 'node:assert/strict';
import {parseJsx} from '../../services/app/lib/jsx/parse.ts';
import {finalizeArtifactMetadata} from '../../services/app/lib/story/parsed-artifact-metadata.ts';
import {storyCssCompileVersion} from '../../services/app/lib/data/story/story-css.server.ts';
import {editorScope} from '../../services/app/lib/artifacts.ts';
import {newEditId} from '../../services/app/lib/story/splice.ts';
import {trackEvent} from '../../services/app/lib/analytics.ts';
import {encodeProseText} from './validated-operations.mjs';
import {createSemanticState,renderState} from './semantic-kernel.mjs';
const POLICY='semantic-artifact-prose-v1';
const encode=(source,meta)=>{
 const {document,contextRequired}=createSemanticState(source,typeof meta==='string'?JSON.parse(meta):meta);
 const parsed=parseJsx(source);assert.ok(parsed.ok);let beforeUnits=0,order=0;
 const visit=(a,b)=>{if(a.slot){const raw=encodeProseText(document.prose[a.slot].value);assert.equal(source.slice(b.start,b.end),raw);Object.assign(document.prose[a.slot],{fixedStart:b.start-beforeUnits,order:order++,units:raw.length});beforeUnits+=raw.length;}if(a.children)a.children.forEach((n,i)=>visit(n,b.children[i]));};
 document.tree.roots.forEach((n,i)=>visit(n,parsed.nodes[i]));
 return {...document,policy:POLICY,contextRequired};
};
export function decodeArtifactRow(row){
 if(row.source&&typeof row.source==='object'){
  row.bench_semantic_state=row.source;row.source=renderState(row.source);
  // Parsed metadata is a derived cache. A prose update invalidates it; rebuilding the
  // same response as the current service is inside the measured writer/read path.
  if(!row.meta?.parsedArtifact)row.meta=finalizeArtifactMetadata('markup',row.source,row.meta??{});
 }
 return row;
}
export async function installSemanticArtifactStorage(db){
 const original=db.query.bind(db),transaction=db.transaction.bind(db),counts={general:0};
 assert.equal((await original('SELECT count(*)::int n FROM artifacts')).rows[0].n,0);
 await original('ALTER TABLE artifacts ALTER COLUMN source TYPE jsonb USING NULL::jsonb');
 await original('ALTER TABLE artifact_versions ALTER COLUMN source TYPE jsonb USING NULL::jsonb');
 await original('ALTER TABLE artifacts ADD COLUMN bench_epoch int NOT NULL DEFAULT 1, ADD COLUMN bench_source_bytes int NOT NULL DEFAULT 0, ADD COLUMN bench_last_start int NOT NULL DEFAULT 0, ADD COLUMN bench_archived_at timestamptz');
 const columns=(await original("SELECT column_name FROM information_schema.columns WHERE table_name='artifacts' AND table_schema='public' ORDER BY ordinal_position")).rows.map(r=>`u."${r.column_name}"`).join(',');
 const wrap=query=>async(sql,input=[])=>{
  const params=[...input];
  if(sql.includes('WITH updated AS (')&&sql.includes('UPDATE artifacts SET')){
   counts.general++;params[3]=JSON.stringify(encode(input[3],input[4]));params[12]=JSON.stringify(encode(input[12],input[13]));
   params.push(Buffer.byteLength(input[3]));sql=sql.replace('version = version + 1,',`bench_epoch=bench_epoch+1,bench_source_bytes=$${params.length}::int,version = version + 1,`);
   sql=sql.replace('meta = $14::jsonb',"(meta-'parsedArtifact') = ($14::jsonb-'parsedArtifact')");
   sql=sql.replace('updated_at = now()',"bench_archived_at=CASE WHEN bench_archived_at IS NULL OR bench_archived_at<=now()-($15::int*interval '1 millisecond') THEN now() ELSE bench_archived_at END,updated_at = now()");
   const archived=[['id',1,'text'],['version',8,'int'],['title',9,'text'],['description',10,'text'],['format',11,'text'],['content',12,'text'],['source',13,'jsonb'],['meta',14,'jsonb'],['actor_user_id',24,'text'],['actor_token_id',25,'text']];
   sql=sql.replace('RETURNING *',`RETURNING WITH (OLD AS o,NEW AS n) n.*,${archived.map(([name])=>`o.${name} AS bench_old_${name}`).join(',')},o.bench_archived_at AS bench_old_archived_at`);
   sql=sql.replace('SELECT $1, $8, $9, $10, $11, $12, $13, $14::jsonb, $24, $25\n         WHERE EXISTS (SELECT 1 FROM updated)',`SELECT ${archived.map(([name,p,type])=>`CASE WHEN true THEN bench_old_${name} ELSE $${p}::${type} END`).join(',')} FROM updated WHERE true`);
   sql=sql.replace(/AND NOT EXISTS \(\s*SELECT 1 FROM artifact_versions\s*WHERE artifact_id = \$1 AND created_at > now\(\) - \(\$15::int \* interval '1 millisecond'\)\s*\)/,"AND (bench_old_archived_at IS NULL OR bench_old_archived_at<=now()-($15::int*interval '1 millisecond'))");
   sql=sql.replace('SELECT u.* FROM updated u',`SELECT ${columns} FROM updated u`);
  }else if(/INSERT INTO artifacts \(/.test(sql)){
   params.push(input[7],Buffer.byteLength(input[7]));params[7]=JSON.stringify(encode(input[7],input[8]));
   sql=sql.replace('COALESCE(source, content)',`COALESCE($${params.length-1}::text,content)`);
   sql=sql.replace('dataset_policy, policy_revision)','dataset_policy, policy_revision,bench_source_bytes)').replace('$18::int) RETURNING',`$18::int,$${params.length}::int) RETURNING`);
  }else if(/INSERT INTO artifact_versions/.test(sql)&&/VALUES/.test(sql))params[6]=JSON.stringify(encode(input[6],input[7]));
  else if(/UPDATE artifacts/.test(sql)&&/source\s*=\s*\$(\d+)/.test(sql)){
   const index=Number(/source\s*=\s*\$(\d+)/.exec(sql)[1])-1;
   const metaIndex=Number(/meta\s*=\s*\$(\d+)/.exec(sql)?.[1])-1;
   params[index]=JSON.stringify(encode(input[index],input[metaIndex]));params.push(Buffer.byteLength(input[index]));
   sql=sql.replace(/source\s*=\s*\$(\d+)/,(_,index)=>`bench_epoch=bench_epoch+1,bench_source_bytes=$${params.length}::int,source=$${index}`);
  }
  const result=await query(sql,params);
  if(/INSERT INTO artifact_versions/.test(sql)&&/VALUES/.test(sql))await query('UPDATE artifacts SET bench_archived_at=now() WHERE id=$1',[params[0]]);
  result.rows.forEach(decodeArtifactRow);return result;
 };
 db.query=wrap(original);db.transaction=fn=>transaction(tx=>fn({...tx,query:wrap(tx.query.bind(tx))}));return counts;
}
export async function createSemanticArtifactWriter(pool){
 const compiler=storyCssCompileVersion();
 const columns=(await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='artifacts' AND table_schema='public' ORDER BY ordinal_position")).rows.map(r=>`u."${r.column_name}"`).join(',');
 return async(actor,id,input)=>{
  assert.deepEqual(Object.keys(input).sort(),['baseVersion','epoch','newText','oldText','sharingRevision','slot']);
  const {slot,oldText,newText,baseVersion,epoch,sharingRevision}=input;
  assert.ok([baseVersion,epoch,sharingRevision].every(Number.isSafeInteger)&&baseVersion>=1&&epoch>=1&&sharingRevision>=0);
  const before=encodeProseText(oldText),after=encodeProseText(newText);assert.notEqual(before,after);
  const scope=editorScope(actor),editId=newEditId();
  // Offsets are UTF-16 code units, exactly like the existing app log. The fixed part
  // excludes all prose; current preceding leaf lengths are summed on the locked row.
  const start=`(source#>>ARRAY['prose',$3,'fixedStart'])::int+COALESCE((SELECT sum((p.value->>'units')::int)::int FROM jsonb_each(source->'prose') p WHERE (p.value->>'order')::int<(source#>>ARRAY['prose',$3,'order'])::int),0)`;
  const old=['id','version','title','description','format','content','source','meta','actor_user_id','actor_token_id','bench_archived_at'];
  const result=await pool.query(`WITH updated AS (
   UPDATE artifacts SET source=jsonb_set(source,ARRAY['prose',$3],(source#>ARRAY['prose',$3])||jsonb_build_object('value',$4::text,'bytes',$5::int,'units',$6::int,'revision',version+1),false),
    bench_last_start=${start},bench_source_bytes=bench_source_bytes+$7::int,meta=meta-'parsedArtifact',
    bench_archived_at=CASE WHEN bench_archived_at IS NULL OR bench_archived_at<=now()-interval '120 seconds' THEN now() ELSE bench_archived_at END,
    version=version+1,edit_id=$8,actor_user_id=$9,actor_token_id=$10,updated_at=now()
   WHERE id=$1 AND ${scope.where('$2')} AND format='markup' AND sharing_revision=$11 AND bench_epoch=$12 AND version>=$13
    AND source->'prose' ? $3 AND source#>>ARRAY['prose',$3,'value']=$14
    AND (source#>>ARRAY['prose',$3,'revision'])::int<=$13
    AND source->>'policy'=$15 AND source->>'contextRequired'='false' AND meta->>'cssCompileVersion'=$16
    AND bench_source_bytes+$7::int BETWEEN 0 AND 2000000
   RETURNING WITH (OLD AS o,NEW AS n) n.*,${old.map(k=>`o.${k} AS previous_${k}`).join(',')}
  ), archived AS (
   INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,meta,actor_user_id,actor_token_id)
   SELECT ${old.slice(0,-1).map(k=>`previous_${k}`).join(',')} FROM updated
   WHERE previous_bench_archived_at IS NULL OR previous_bench_archived_at<=now()-interval '120 seconds'
   ON CONFLICT DO NOTHING
  ), logged AS (
   INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id)
   SELECT id,edit_id,bench_last_start,$17,$18,bench_last_start,bench_last_start+$19::int,$9,$10 FROM updated
   RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
  ) SELECT ${columns},COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=u.id),'[]'::jsonb) shares FROM updated u WHERE EXISTS(SELECT 1 FROM logged)`,
  [id,scope.val,slot,newText,Buffer.byteLength(after),after.length,Buffer.byteLength(after)-Buffer.byteLength(before),editId,actor.userId,actor.tokenId||null,sharingRevision,epoch,baseVersion,oldText,POLICY,compiler,before,after,before.length]);
  const row=result.rows[0];if(!row)return null;decodeArtifactRow(row);void trackEvent('edit',row.id,{userId:row.user_id});return row;
 };
}
