/** Research-only storage substitution. Runs the ACTUAL app service and all its side effects.
 * No product SQL/validation/conflict rule is relaxed. Source columns become JSONB ASTs in this
 * disposable cluster. The adapter encodes writes, decodes responses, and lowers the inline
 * service's already-validated delta to jsonb_set. Default mode retains head CAS/retries;
 * certified mode admits commuting, fixed-width prose with same-row dependency guards.
 * Both modes retain full application preparation. read-free-prose.mjs is the separate
 * operation-admission path, sharing these rows and capability-invalidation boundaries.
 */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {encodeSource,decodeSource,diff,certifyPlainDocument} from './validated-operations.mjs';
import {certifyReadFreeSource} from './read-free-prose.mjs';

export async function installJsonbStorage(db,{certified=false}={}){
 const original=db.query.bind(db);const transaction=db.transaction.bind(db);
 assert.equal((await original('SELECT count(*)::int n FROM artifacts')).rows[0].n,0);
 await original('ALTER TABLE artifacts ALTER COLUMN source TYPE jsonb USING NULL::jsonb');
 await original('ALTER TABLE artifact_versions ALTER COLUMN source TYPE jsonb USING NULL::jsonb');
 await original('ALTER TABLE artifacts ADD COLUMN bench_epoch integer NOT NULL DEFAULT 1, ADD COLUMN bench_revisions jsonb NOT NULL DEFAULT \'{}\', ADD COLUMN bench_archived_at timestamptz, ADD COLUMN bench_canonical_source text, ADD COLUMN bench_capabilities jsonb NOT NULL DEFAULT \'{}\'');
 const columns=(await original("SELECT column_name FROM information_schema.columns WHERE table_name='artifacts' AND table_schema='public' ORDER BY ordinal_position")).rows.map(r=>`u."${r.column_name}"`).join(',');
 const heads=new Map();const counts={fast:0,general:0};
 const encode=source=>source==null?null:JSON.stringify(encodeSource(source));
 const wrap=query=>async(sql,input=[])=>{
  const params=[...input];
  if(sql.includes('WITH updated AS (')&&sql.includes('UPDATE artifacts SET')){
   const canonical=params[3];
   const before=encodeSource(params[12]);const after=encodeSource(params[3]);
   const patches=diff(before,after);let expression='source';
   const context=heads.get(params[6]);
   const paths=certifyPlainDocument(before);
   const withoutHash=value=>{const object=JSON.parse(value);delete object.parsedArtifact?.sourceHash;return object;};
   const fast=certified&&context&&patches.length===1&&paths?.some(p=>JSON.stringify(p)===JSON.stringify(patches[0].path))
    &&certifyPlainDocument(after)&&isDeepStrictEqual(withoutHash(params[4]),withoutHash(params[13]))&&params[3].length===params[12].length&&/^[\x00-\x7f]*$/.test(params[3])&&/^[\x00-\x7f]*$/.test(params[12])
    &&params[29]==='[]'&&params[30]==='[]'&&!params[3].includes('/people/')&&!params[12].includes('/people/');
   const oldText=fast?patches[0].path.reduce((v,k)=>v[k],before):null;
   params[3]=JSON.stringify(patches.map(p=>p.value));params[12]=JSON.stringify(before);
   patches.forEach((patch,i)=>{
    params.push(patch.path);
    expression=patch.path.length?`jsonb_set(${expression},$${params.length}::text[],$4::jsonb->${i},false)`:`($4::jsonb->${i})`;
   });
   sql=sql.replace('source = $4',`source = ${expression}`).replace('WHERE id = $1 AND','WHERE $4::jsonb IS NOT NULL AND id = $1 AND');
   if(fast){
    counts.fast++;
    params.push(JSON.stringify(patches[0].path),oldText,context.epoch);
    const key=`$${params.length-2}::text`,old=`$${params.length-1}::text`,epoch=`$${params.length}::int`;
    const path=`$33::text[]`;
    sql=sql.replace('edit_id = $7 AND',`$7::text IS NOT NULL AND bench_epoch=${epoch} AND source#>>${path}=${old} AND COALESCE((bench_revisions->>${key})::int,0)<=$8 AND`);
    sql=sql.replace('version = version + 1,',`bench_revisions=jsonb_set(bench_revisions,ARRAY[${key}],to_jsonb(version+1),true),version = version + 1,`);
    const source="overlay(bench_canonical_source placing $18::text from ($16::int+1) for length($17::text))";
    sql=sql.replace('meta = $5,',`bench_canonical_source=${source},meta=jsonb_set($5::jsonb,'{parsedArtifact,sourceHash}',to_jsonb(encode(sha256(convert_to(${source},'UTF8')),'hex')),false),`);
    sql=sql.replace('meta = $14::jsonb',"(meta #- '{parsedArtifact,sourceHash}') = ($14::jsonb #- '{parsedArtifact,sourceHash}')");
   }else{
    counts.general++;sql=sql.replace('version = version + 1,',"bench_epoch=bench_epoch+1,bench_revisions='{}'::jsonb,version = version + 1,");
    params.push(canonical);sql=sql.replace('meta = $5,',`bench_canonical_source=$${params.length}::text,meta = $5,`);
    params.push(JSON.stringify(certifyReadFreeSource(canonical)));sql=sql.replace('meta = $5,',`bench_capabilities=$${params.length}::jsonb,meta = $5,`);
   }
   // Correct coalescing must inspect the locked row, not a pre-wait snapshot of history.
   sql=sql.replace('updated_at = now()',"bench_archived_at=CASE WHEN bench_archived_at IS NULL OR bench_archived_at<=now()-($15::int*interval '1 millisecond') THEN now() ELSE bench_archived_at END, updated_at = now()");
   const archived=[['id',1,'text'],['version',8,'int'],['title',9,'text'],['description',10,'text'],['format',11,'text'],['content',12,'text'],['source',13,'jsonb'],['meta',14,'jsonb'],['actor_user_id',24,'text'],['actor_token_id',25,'text']];
   sql=sql.replace('RETURNING *',`RETURNING WITH (OLD AS o,NEW AS n) n.*, ${archived.map(([name])=>`o.${name} AS bench_old_${name}`).join(',')},o.bench_archived_at AS bench_old_archived_at`);
   sql=sql.replace('SELECT $1, $8, $9, $10, $11, $12, $13, $14::jsonb, $24, $25\n         WHERE EXISTS (SELECT 1 FROM updated)',`SELECT ${archived.map(([name,p,type])=>`CASE WHEN true THEN bench_old_${name} ELSE $${p}::${type} END`).join(',')} FROM updated WHERE true`);
   sql=sql.replace(/AND NOT EXISTS \(\s*SELECT 1 FROM artifact_versions\s*WHERE artifact_id = \$1 AND created_at > now\(\) - \(\$15::int \* interval '1 millisecond'\)\s*\)/,"AND (bench_old_archived_at IS NULL OR bench_old_archived_at <= now()-($15::int*interval '1 millisecond'))");
   sql=sql.replace('SELECT u.* FROM updated u',`SELECT ${columns} FROM updated u`);
  }else if(/INSERT INTO artifacts \(/.test(sql)){
   params.push(params[7]);params[7]=encode(params[7]);
   sql=sql.replace('COALESCE(source, content)',`COALESCE($${params.length}::text, content)`);
   sql=sql.replace('dataset_policy, policy_revision)','dataset_policy, policy_revision, bench_canonical_source)').replace('$18::int) RETURNING',`$18::int,$${params.length}::text) RETURNING`);
   params.push(JSON.stringify(certifyReadFreeSource(input[7])));
   sql=sql.replace('policy_revision, bench_canonical_source)','policy_revision, bench_canonical_source, bench_capabilities)').replace(`$${params.length-1}::text) RETURNING`,`$${params.length-1}::text,$${params.length}::jsonb) RETURNING`);
  }
  else if(/INSERT INTO artifact_versions/.test(sql)&&/VALUES/.test(sql))params[6]=encode(params[6]);
  else if(/UPDATE artifacts/.test(sql)&&/source\s*=\s*\$(\d+)/.test(sql)){
   const index=Number(/source\s*=\s*\$(\d+)/.exec(sql)[1])-1;params.push(params[index]);params[index]=encode(params[index]);
   sql=sql.replace(/source\s*=\s*\$(\d+)/,(_,index)=>`bench_epoch=bench_epoch+1,bench_revisions='{}'::jsonb,bench_canonical_source=$${params.length}::text,source=$${index}`);
   params.push(JSON.stringify(certifyReadFreeSource(input[index])));sql=sql.replace("bench_revisions='{}'::jsonb,",`bench_revisions='{}'::jsonb,bench_capabilities=$${params.length}::jsonb,`);
  }
  const result=await query(sql,params);
  // Full replacements/restores already run inside the app's transaction. Their shared
  // archive boundary must refresh the same marker used by subsequent atomic prose edits.
  if(/INSERT INTO artifact_versions/.test(sql)&&/VALUES/.test(sql))await query('UPDATE artifacts SET bench_archived_at=now() WHERE id=$1',[params[0]]);
  for(const row of result.rows)if(row.source&&typeof row.source==='object'){
   row.source=decodeSource(row.source);
   if(row.bench_canonical_source!==undefined)assert.equal(row.source,row.bench_canonical_source,'AST and source cache diverged');
   if(row.meta?.parsedArtifact)assert.equal(row.meta.parsedArtifact.sourceHash,createHash('sha256').update(row.source).digest('hex'),'metadata hash diverged');
   if(row.edit_id)heads.set(row.edit_id,{epoch:row.bench_epoch,version:row.version});
  }
  return result;
 };
 db.query=wrap(original);
 db.transaction=fn=>transaction(tx=>fn({...tx,query:wrap(tx.query.bind(tx))}));
 return counts;
}
