import {documentResourceSql} from './document-update-resources';
import {documentMentionSql} from './document-update-mentions';
import {documentReplacementSql} from './document-replacement-sql';
import {documentAnnotationSql} from './document-update-annotations';
/** Trusted-client document commits. The caller supplies a prepared patch, never
 * SQL or authorization predicates. Permissions, dependency guards, history and
 * identity maintenance share the artifact row lock and the same SQL statement. */
import type {DocumentUpdate,Queryable} from '@artifactbin/contracts';
import {ownerPredicate,type ArtifactRow,type Scope,type TokenActor} from '../artifacts';
import {hydrateArtifactDocument} from '../artifact-document';
import {GRAPH_POLICY} from './document-graph';
import {graphPatchSql,graphReferencesSql} from './document-graph-sql';
import {newEditId} from './splice';
export type DocumentCommitResult={applied:true;row:ArtifactRow}|{applied:false;head:ArtifactRow;refusal?:string};
export async function commitDocumentUpdate(db:Queryable,actor:TokenActor|null,scope:Scope,id:string,update:DocumentUpdate,options:{dryRun?:boolean}={}):Promise<DocumentCommitResult|null>{
 const initial=[id,scope.val,newEditId(),actor?.userId??null,actor?.tokenId||null];
 const sql=update.replacement?documentReplacementSql(update.replacement,update.patch.baseVersion,initial):graphPatchSql('l.document','l.version',update.patch,initial);
 const param=(value:unknown)=>{sql.params.push(value);return `$${sql.params.length}`;};
 const settings=update.settings??{},sharing=param(update.expectedSharingRevision??null),oldParent=param(update.expectedParentIds??null);
 const visibility=param(settings.visibility??null),linkRole=param(settings.linkRole??null),parent=param(settings.parentId??null),hasParent=param(settings.parentId!==undefined);
 const shares=param(settings.shares===undefined?null:JSON.stringify(settings.shares));
 const owner=actor?ownerPredicate(actor):{where:()=> 'FALSE',val:null};const ownerValue=param(owner.val);
 const {title,description,...metadata}=update.metadata??{};
 const meta=param(JSON.stringify(metadata)),expected=param(JSON.stringify(update.expectedMetadata??{}));
 const titleValue=param(title??null),hasTitle=param(title!==undefined),descriptionValue=param(description??null),hasDescription=param(description!==undefined);
 const annotationOps=param(JSON.stringify(update.annotationOps??[])),aliases=param(JSON.stringify(update.aliases??[]));
 const replacement=param(update.replacement?JSON.stringify(update.replacement):null);
 const patch=param(JSON.stringify(update.patch)),whole=param(update.whole??false),wholeVersion=param(update.patch.baseVersion),policy=param(GRAPH_POLICY);
 const changed=param([...new Set([...Object.keys(update.patch.updated),...Object.keys(update.patch.inserted),...update.patch.removed])]);
 const preimage=param([...new Set([...Object.keys(update.patch.updated),...update.patch.removed])]),touched=param(update.patch.touched);
 const refs=update.effects.references?`||jsonb_build_object('refs',${graphReferencesSql('l.next_document')})`:'';
 const strip=update.effects.css?"-'parsedArtifact'-'compiledCss'-'cssCompileVersion'":"-'parsedArtifact'";
 const mention=documentMentionSql(actor,id,update.mentions,param,visibility,shares,!!options.dryRun);
 const resources=documentResourceSql(update.datasetBindings,param,!!options.dryRun);
 const prefix=`WITH RECURSIVE observed AS MATERIALIZED (
  SELECT id,sharing_revision FROM artifacts WHERE id=$1 AND ${scope.where('$2')}
 ), locked AS MATERIALIZED (
  SELECT artifacts.* FROM artifacts WHERE id=$1 AND ${scope.where('$2')}
   AND sharing_revision=(SELECT sharing_revision FROM observed) ${options.dryRun?'':'FOR UPDATE OF artifacts'}
 ), destination AS MATERIALIZED (
  SELECT p.ancestor_ids||p.id AS ancestors FROM artifacts p,locked l WHERE ${hasParent}::boolean AND p.id=${parent}::text AND p.format='folder' AND p.deleted_at IS NULL
   AND (CASE WHEN l.user_id IS NOT NULL THEN p.user_id=l.user_id ELSE p.token_id=l.token_id END)
   AND p.id<>l.id AND NOT l.id=ANY(p.ancestor_ids) AND cardinality(p.ancestor_ids)+1<6 ${options.dryRun?'':'FOR SHARE OF p'}
 ), ${mention.before} ${resources.before} transformed AS MATERIALIZED (
  SELECT l.*,${sql.expression} AS next_document FROM locked l
  WHERE ${mention.guard} AND ${resources.guard} AND l.format='markup' AND (${replacement}::jsonb IS NOT NULL OR l.document->>'policy'=${policy}) AND ${sql.guard} AND (NOT ${whole}::boolean OR l.version=${wholeVersion}::int)
   AND (${visibility}::text IS DISTINCT FROM 'private' OR l.user_id IS NOT NULL)
   AND (${sharing}::int IS NULL OR l.sharing_revision=${sharing}::int)
   AND (NOT ${hasParent}::boolean OR (l.ancestor_ids=${oldParent}::text[] AND (${parent}::text IS NULL OR EXISTS(SELECT 1 FROM destination))
    AND EXISTS(SELECT 1 FROM artifacts WHERE id=l.id AND ${owner.where(ownerValue)})))
   AND NOT EXISTS(SELECT 1 FROM jsonb_each(${expected}::jsonb) f
    WHERE CASE WHEN f.key IN ('title','description') THEN COALESCE(to_jsonb(l)->f.key,'null'::jsonb)
     ELSE COALESCE(l.meta->f.key,'null'::jsonb) END IS DISTINCT FROM f.value)
 )`;
 const commit=` , updated AS (
  UPDATE artifacts SET document=l.next_document,source=NULL,content='',meta=(l.meta||${meta}::jsonb${refs})${strip},
   visibility=COALESCE(${visibility}::text,l.visibility),link_role=COALESCE(${linkRole}::text,l.link_role),
   ancestor_ids=CASE WHEN ${hasParent}::boolean THEN COALESCE((SELECT ancestors FROM destination),ARRAY[]::text[]) ELSE l.ancestor_ids END,
   sharing_revision=l.sharing_revision+CASE WHEN ${visibility}::text IS NOT NULL OR ${linkRole}::text IS NOT NULL OR ${shares}::jsonb IS NOT NULL THEN 1 ELSE 0 END,
   version=l.version+1,edit_id=$3,title=CASE WHEN ${hasTitle}::boolean THEN ${titleValue}::text ELSE l.title END,
   description=CASE WHEN ${hasDescription}::boolean THEN ${descriptionValue}::text ELSE l.description END,
   actor_user_id=$4,actor_token_id=$5,updated_at=now(),
   document_archived_at=CASE WHEN ${whole}::boolean OR l.document_archived_at IS NULL OR l.document_archived_at<=now()-interval '120 seconds' THEN now() ELSE l.document_archived_at END
  FROM transformed l WHERE artifacts.id=l.id RETURNING artifacts.*,to_jsonb(l)-'next_document' AS previous
 ), archived AS (
  INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,meta,actor_user_id,actor_token_id,document)
  SELECT id,(previous->>'version')::int,previous->>'title',previous->>'description',previous->>'format',previous->>'content',previous->>'source',previous->'meta',previous->>'actor_user_id',previous->>'actor_token_id',previous->'document' FROM updated
  WHERE ${whole}::boolean OR previous->>'document_archived_at' IS NULL OR (previous->>'document_archived_at')::timestamptz<=now()-interval '120 seconds' ON CONFLICT DO NOTHING
 ), ${documentAnnotationSql(annotationOps)}, logged AS (
  INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id,document_state,annotation_changes)
  SELECT u.id,u.edit_id,0,'','',0,0,$4,$5,jsonb_build_object('kind','operations','version',u.version,
   'beforeEditId',u.previous->'edit_id','forward',${patch}::jsonb,'replacement',${replacement}::jsonb,'beforeDocument',CASE WHEN ${replacement}::jsonb IS NOT NULL THEN u.previous->'document' END,
   'beforeNodes',COALESCE((SELECT jsonb_object_agg(k,u.previous#>ARRAY['document','nodes',k]) FROM unnest(${preimage}::text[]) k WHERE u.previous#>ARRAY['document','nodes',k] IS NOT NULL),'{}'::jsonb),
   'beforeRevisions',COALESCE((SELECT jsonb_object_agg(k,jsonb_build_object('selfVersion',u.previous#>ARRAY['document','nodes',k,'selfVersion'],'childrenVersion',u.previous#>ARRAY['document','nodes',k,'childrenVersion'],'subtreeVersion',u.previous#>ARRAY['document','nodes',k,'subtreeVersion'])) FROM unnest(${touched}::text[]) k WHERE u.previous#>ARRAY['document','nodes',k] IS NOT NULL),'{}'::jsonb),
   'beforeBytes',u.previous#>'{document,bytes}','beforeMetadata',COALESCE((SELECT jsonb_object_agg(k,COALESCE(u.previous->'meta'->k,'null'::jsonb)) FROM jsonb_object_keys(${meta}::jsonb) k),'{}'::jsonb),
   'beforeTitle',u.previous->'title','beforeDescription',u.previous->'description'),(SELECT receipts FROM annotation_receipts) FROM updated u
  RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
 ), parent_notifications AS (
  SELECT pg_notify('artifact_'||lower(parent_id),'child') FROM updated u
  CROSS JOIN LATERAL (SELECT DISTINCT p AS parent_id FROM unnest(ARRAY[u.ancestor_ids[cardinality(u.ancestor_ids)],u.previous#>>ARRAY['ancestor_ids',((jsonb_array_length(u.previous->'ancestor_ids'))-1)::text]]) p WHERE p IS NOT NULL) parents
  WHERE ${hasParent}::boolean AND to_jsonb(u.ancestor_ids) IS DISTINCT FROM u.previous->'ancestor_ids'
 ), changed_ids AS MATERIALIZED (
  SELECT u.id,u.version,
   CASE WHEN ${replacement}::jsonb IS NOT NULL THEN ARRAY(SELECT source_id FROM artifact_source_ids WHERE artifact_id=u.id AND retired_version IS NULL) ELSE ARRAY(SELECT DISTINCT substring(s FROM 4) FROM unnest(${changed}::text[]) k CROSS JOIN LATERAL jsonb_array_elements_text(u.previous#>ARRAY['document','nodes',k,'selectors']) s WHERE s LIKE 'id:%') END AS before_ids,
   ARRAY(SELECT DISTINCT substring(s FROM 4) FROM unnest(CASE WHEN ${replacement}::jsonb IS NOT NULL THEN ARRAY(SELECT jsonb_object_keys(u.document->'nodes')) ELSE ${changed}::text[] END) k CROSS JOIN LATERAL jsonb_array_elements_text(u.document#>ARRAY['nodes',k,'selectors']) s WHERE s LIKE 'id:%') AS after_ids
  FROM updated u
 ), reserved AS (
  INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version)
  SELECT c.id,s,'authored',c.version FROM changed_ids c CROSS JOIN unnest(c.after_ids) s
  WHERE NOT s=ANY(c.before_ids) ON CONFLICT (artifact_id,source_id) DO UPDATE SET retired_version=NULL
 ), retired AS (
  UPDATE artifact_source_ids SET retired_version=c.version FROM changed_ids c
  WHERE artifact_id=c.id AND source_id=ANY(c.before_ids) AND NOT source_id=ANY(c.after_ids)
 ), removed_shares AS (
  DELETE FROM artifact_shares s WHERE s.artifact_id=$1 AND ${shares}::jsonb IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(${shares}::jsonb) x WHERE x->>'email'=s.email) AND EXISTS(SELECT 1 FROM updated)
 ), saved_shares AS (
  INSERT INTO artifact_shares(artifact_id,email,role,user_id)
  SELECT u.id,x->>'email',x->>'role',(SELECT id FROM users WHERE email=x->>'email' AND kind='account') FROM updated u CROSS JOIN jsonb_array_elements(${shares}::jsonb) x
  ON CONFLICT (artifact_id,email) DO UPDATE SET role=EXCLUDED.role,user_id=COALESCE(artifact_shares.user_id,EXCLUDED.user_id)
 ), resolved_shares AS (
  UPDATE artifact_shares SET user_id=$4 WHERE artifact_id=$1 AND user_id IS NULL AND ${shares}::jsonb IS NULL
   AND email=(SELECT email FROM users WHERE id=$4 AND kind='account') AND EXISTS(SELECT 1 FROM updated)
 ), aliases AS (
  INSERT INTO artifact_node_aliases(artifact_id,legacy_key,source_id,source_path,created_version)
  SELECT u.id,x->>'legacyKey',x->>'nodeId',x->>'path',u.version FROM updated u CROSS JOIN jsonb_array_elements(${aliases}::jsonb) x ON CONFLICT DO NOTHING
  RETURNING artifact_id,legacy_key,source_id
 ), anchors AS (
  UPDATE annotations a SET anchor_key=x.source_id FROM aliases x WHERE a.artifact_id=x.artifact_id AND a.anchor_key=x.legacy_key
 ), ${mention.after} ${resources.after} response AS (
  SELECT true AS applied,to_jsonb(u)-'previous' AS artifact,u.id FROM updated u WHERE EXISTS(SELECT 1 FROM logged) AND (SELECT count(*) FROM parent_notifications)>=0 ${update.mentions?.length?'AND (SELECT count(*) FROM mention_wake)>=0':''}
  UNION ALL SELECT false,to_jsonb(l),l.id FROM locked l WHERE NOT EXISTS(SELECT 1 FROM updated)
 ) SELECT applied,${mention.refusal} AS refusal,artifact||jsonb_build_object('open_annotations',(SELECT count(*) FROM annotations a WHERE a.artifact_id=response.id AND a.root_id IS NULL AND a.deleted_at IS NULL AND a.status='open'),'shares',COALESCE(CASE WHEN applied THEN ${shares}::jsonb END,(SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=response.id),'[]'::jsonb)) AS artifact FROM response`;
 const preview=`SELECT true AS applied,to_jsonb(t)-'next_document' AS artifact,${mention.refusal} AS refusal FROM transformed t UNION ALL SELECT false,to_jsonb(l),${mention.refusal} FROM locked l WHERE NOT EXISTS(SELECT 1 FROM transformed)`;
 const query=prefix+(options.dryRun?preview:commit);
 // Dry-run omits commit-only parameters as well as every write CTE. Compact
 // placeholders so PostgreSQL never receives an untyped, unused parameter.
 const bindings:number[]=[];
 const statement=query.replace(/\$(\d+)/g,(_,index:string)=>{
  const original=Number(index)-1;let position=bindings.indexOf(original);
  if(position<0){position=bindings.length;bindings.push(original);}
  return `$${position+1}`;
 });
 const result=await db.query<{applied:boolean;artifact:ArtifactRow;refusal:string|null}>(statement,bindings.map(index=>sql.params[index]));
 const row=result.rows[0];if(!row)return null;
 const artifact=await hydrateArtifactDocument(row.artifact);
 return row.applied?{applied:true,row:artifact}:{applied:false,head:artifact,...(row.refusal?{refusal:row.refusal}:{})};
}
