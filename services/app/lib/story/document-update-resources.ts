/** Prepared resource changes have their own version/ownership guards. They are
 * applied only when the document succeeds, so attachment cannot partially bind
 * a dataset or silently overwrite a dataset changed during authoring. */
import type {DocumentUpdate} from '@artifactbin/contracts';
import {newEditId} from './splice';
export function documentResourceSql(bindings:DocumentUpdate['datasetBindings'],param:(value:unknown)=>string,dryRun:boolean){
 if(!bindings?.length)return {before:'',guard:'TRUE',after:''};
 const input=param(JSON.stringify(bindings.map(binding=>({...binding,editId:newEditId()}))));
 const before=`resource_inputs AS MATERIALIZED (SELECT x FROM jsonb_array_elements(${input}::jsonb) x),
 resource_locked AS MATERIALIZED (
  SELECT d.* FROM artifacts d WHERE d.id IN(SELECT x->>'id' FROM resource_inputs) AND d.format='dataset' AND d.deleted_at IS NULL
  ORDER BY d.id ${dryRun?'':'FOR UPDATE OF d'}
 ), resource_ready AS MATERIALIZED (
  SELECT d.*,i.x FROM resource_locked d JOIN resource_inputs i ON d.id=i.x->>'id' CROSS JOIN locked l
  WHERE (CASE WHEN l.user_id IS NOT NULL THEN d.user_id=l.user_id ELSE d.token_id=l.token_id END)
   AND (d.version=(i.x->>'version')::int OR d.meta->>'userScopeDocument'=l.id)
 ),`;
 const guard='(SELECT count(*) FROM resource_ready)=(SELECT count(*) FROM resource_inputs)';
 const after=`resource_updated AS (
  UPDATE artifacts d SET meta=d.meta||(r.x->'meta'),source=r.x->>'source',version=d.version+1,edit_id=r.x->>'editId',updated_at=now()
  FROM resource_ready r WHERE d.id=r.id AND r.meta->>'userScopeDocument' IS DISTINCT FROM $1 AND EXISTS(SELECT 1 FROM updated)
  RETURNING d.*,to_jsonb(r)-'x' AS previous
 ), resource_archived AS (
  INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,meta,actor_user_id,actor_token_id,document)
  SELECT id,(previous->>'version')::int,previous->>'title',previous->>'description',previous->>'format',previous->>'content',previous->>'source',previous->'meta',previous->>'actor_user_id',previous->>'actor_token_id',previous->'document' FROM resource_updated ON CONFLICT DO NOTHING
 ), resource_logged AS (
  INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id)
  SELECT id,edit_id,0,COALESCE(previous->>'source',previous->>'content'),COALESCE(source,content),0,length(COALESCE(previous->>'source',previous->>'content')),actor_user_id,actor_token_id FROM resource_updated
  RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
 ),`;
 return {before,guard,after};
}
