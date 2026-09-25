/** The semantic writer owns a single artifact lock and one SQL statement for the
 * document, preimage archive, invertible source log, node identities and wakeup. */
import type {Queryable} from '@artifactbin/contracts';
import type {ArtifactRow,Scope,TokenActor} from '../artifacts';
import {decodeArtifactDocument} from '../artifact-document';
import {semanticPlan,semanticSourceSegments,SEMANTIC_POLICY,type SemanticAdmission} from './document-semantic';
import {semanticOperationSql} from './document-semantic-sql';
import type {SemanticDocument} from './document-codec';
import type {annotationEffects} from './annotation-edits';
import {newEditId} from './splice';
export interface SemanticCommitOptions {archive?:'always'|'coalesce';history?:'whole'|'nodes';title?:string|null;description?:string|null;expectedEditId?:string;initialize?:{document:SemanticDocument;source:string};effects?:ReturnType<typeof annotationEffects>;aliases?:Array<{legacyKey:string;nodeId:string;path:string}>;visibility?:string;ancestorIds?:string[];access?:string;linkRole?:string|null;provenance?:'migration'|'authored'}
export async function commitSemanticOperation(db:Queryable,actor:TokenActor|null,scope:Scope,token:SemanticAdmission,options:SemanticCommitOptions={}):Promise<ArtifactRow|null>{
 const plan=semanticPlan(token),editId=newEditId();
 const effective=options.initialize?'$6::jsonb':'l.document';
 const sql=semanticOperationSql(effective,'l.version','l.meta',token,[plan.id,scope.val,editId,actor?.userId??null,actor?.tokenId||null,...(options.initialize?[JSON.stringify(options.initialize.document)]:[])]);
 const param=(value:unknown)=>{sql.params.push(value);return `$${sql.params.length}`;};
 const effects=options.effects??{updates:[],receipts:[]},updates=param(JSON.stringify(effects.updates)),receipts=param(JSON.stringify(effects.receipts));
 const originalSource=options.initialize?param(options.initialize.source):null;
 const meta=param(JSON.stringify(plan.meta)),policy=param(SEMANTIC_POLICY),archive=param(options.archive==='always');
 const title=param(options.title??null),hasTitle=param(options.title!==undefined),description=param(options.description??null),hasDescription=param(options.description!==undefined);
 const expectedEdit=param(options.expectedEditId??null),ids=param(plan.ids),aliases=param(JSON.stringify(options.aliases??plan.aliases));
 const visibility=param(options.visibility??null),ancestors=param(options.ancestorIds??null),access=param(options.access??null),linkRole=param(options.linkRole??null),provenance=param(options.provenance??'authored');
 const references=param(JSON.stringify(plan.references)),referenceCount=param(plan.references.length);
 const beforeSegments=semanticSourceSegments(plan.beforeTree),afterSegments=semanticSourceSegments(plan.tree);
 const before=originalSource?null:param(JSON.stringify(beforeSegments)),after=param(JSON.stringify(afterSegments));
 const source=(segments:string,document:string)=>`COALESCE((SELECT string_agg(CASE WHEN segment ? 'text' THEN segment->>'text' ELSE ${document}#>>ARRAY['prose',segment->>'slot','source'] END,'' ORDER BY ordinal) FROM jsonb_array_elements(${segments}::jsonb) WITH ORDINALITY AS parts(segment,ordinal)),'')`;
 const fixedUnits=options.initialize?options.initialize.source.length:beforeSegments.reduce((sum,s)=>sum+('text'in s?s.text.length:0),0),fixed=param(fixedUnits);
 const result=await db.query<{artifact:ArtifactRow}>(`WITH reference_witnesses AS MATERIALIZED (
  SELECT * FROM jsonb_to_recordset(${references}::jsonb) AS witness(id text,version int,"sharingRevision" int,"policyRevision" int)
 ), reference_rows AS MATERIALIZED (
  SELECT r.id,r.version,r.sharing_revision,r.policy_revision,r.deleted_at FROM artifacts r JOIN reference_witnesses w ON r.id=w.id ORDER BY r.id FOR UPDATE OF r
 ), valid_references AS MATERIALIZED (
  SELECT r.id FROM reference_rows r JOIN reference_witnesses w ON r.id=w.id
  WHERE r.version=w.version AND r.sharing_revision=w."sharingRevision" AND r.policy_revision=w."policyRevision" AND r.deleted_at IS NULL
 ), observed AS MATERIALIZED (
  SELECT id,sharing_revision FROM artifacts WHERE id=$1 AND ${scope.where('$2')}
 ), locked AS MATERIALIZED (
  SELECT artifacts.* FROM artifacts WHERE id=$1 AND ${scope.where('$2')} AND sharing_revision=(SELECT sharing_revision FROM observed) AND (SELECT count(*) FROM valid_references)=${referenceCount}::int FOR UPDATE OF artifacts
 ), transformed AS MATERIALIZED (
  SELECT l.*,${sql.expression} AS next_document FROM locked l
  WHERE l.format='markup' AND ${effective}->>'policy'=${policy} AND (${expectedEdit}::text IS NULL OR l.edit_id=${expectedEdit}::text) AND ${sql.guard}
 ), updated AS (
  UPDATE artifacts SET document=l.next_document,source=NULL,content='',meta=${meta}::jsonb-'parsedArtifact',version=l.version+1,edit_id=$3,
   title=CASE WHEN ${hasTitle}::boolean THEN ${title}::text ELSE l.title END,
   description=CASE WHEN ${hasDescription}::boolean THEN ${description}::text ELSE l.description END,
   visibility=COALESCE(${visibility}::text,l.visibility),ancestor_ids=COALESCE(${ancestors}::text[],l.ancestor_ids),access=COALESCE(${access}::text,l.access),link_role=COALESCE(${linkRole}::text,l.link_role),
   actor_user_id=$4,actor_token_id=$5,updated_at=now(),
   document_archived_at=CASE WHEN ${archive}::boolean OR l.document_archived_at IS NULL OR l.document_archived_at<=now()-interval '120 seconds' THEN now() ELSE l.document_archived_at END
  FROM transformed l WHERE artifacts.id=l.id
  RETURNING artifacts.*,to_jsonb(l)-'next_document' AS previous
 ), archived AS (
  INSERT INTO artifact_versions(artifact_id,version,title,description,format,content,source,meta,actor_user_id,actor_token_id,document)
  SELECT id,(previous->>'version')::int,previous->>'title',previous->>'description',previous->>'format',previous->>'content',previous->>'source',previous->'meta',previous->>'actor_user_id',previous->>'actor_token_id',previous->'document' FROM updated
  WHERE ${archive}::boolean OR previous->>'document_archived_at' IS NULL OR (previous->>'document_archived_at')::timestamptz<=now()-interval '120 seconds' ON CONFLICT DO NOTHING
 ), moved_annotations AS (
  UPDATE annotations a SET anchor_key=x->'after'->>'anchor',range=x->'after'->>'range' FROM jsonb_array_elements(${updates}::jsonb) x
  WHERE a.artifact_id=$1 AND a.id=x->>'annotationId' AND a.root_id IS NULL AND a.deleted_at IS NULL
   AND a.anchor_key=x->'before'->>'anchor' AND a.range IS NOT DISTINCT FROM (x->'before'->>'range') AND EXISTS(SELECT 1 FROM updated) RETURNING a.id
 ), logged AS (
  INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id,document_state,annotation_changes)
  SELECT u.id,u.edit_id,0,${originalSource?`${originalSource}::text`:source(before!,"(u.previous->'document')")},${source(after,'u.document')},0,
   ${fixed}::int+COALESCE((SELECT sum((p.value->>'units')::int)::int FROM jsonb_each(u.previous#>'{document,prose}') p),0),$4,$5,
   jsonb_build_object('epoch',u.document->>'epoch','version',u.version,'kind','${options.history==='whole'?'whole':'semantic'}'),(SELECT jsonb_agg(receipt) FROM jsonb_array_elements(${receipts}::jsonb) receipt WHERE receipt->>'annotationId'='' OR receipt->>'annotationId' IN(SELECT id FROM moved_annotations)) FROM updated u
  RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
 ), reserved AS (
  INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version)
  SELECT u.id,source_id,${provenance}::text,u.version FROM updated u CROSS JOIN unnest(${ids}::text[]) source_id ON CONFLICT DO NOTHING
 ), identities AS (
  UPDATE artifact_source_ids SET retired_version=CASE WHEN source_id=ANY(${ids}::text[]) THEN NULL ELSE u.version END
  FROM updated u WHERE artifact_id=u.id
 ), aliases AS (
  INSERT INTO artifact_node_aliases(artifact_id,legacy_key,source_id,source_path,created_version)
  SELECT u.id,x->>'legacyKey',x->>'nodeId',x->>'path',u.version FROM updated u CROSS JOIN jsonb_array_elements(${aliases}::jsonb) x ON CONFLICT DO NOTHING
  RETURNING artifact_id,legacy_key,source_id
 ), anchors AS (
  UPDATE annotations a SET anchor_key=x.source_id FROM aliases x WHERE a.artifact_id=x.artifact_id AND a.anchor_key=x.legacy_key
 ) SELECT (to_jsonb(u)-'previous')||jsonb_build_object('shares',COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=u.id),'[]'::jsonb)) AS artifact
 FROM updated u WHERE EXISTS(SELECT 1 FROM logged)`,sql.params);
 return result.rows[0]?decodeArtifactDocument(result.rows[0].artifact):null;
}
