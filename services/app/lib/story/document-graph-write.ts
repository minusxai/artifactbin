/** The graph writer owns a single artifact lock and one SQL statement for the
 * document, preimage archive, invertible source log, node identities and wakeup. */
import type {Queryable} from '@artifactbin/contracts';
import type {ArtifactRow,Scope,TokenActor} from '../artifacts';
import {hydrateArtifactDocument} from '../artifact-document';
import {graphAdmissionPlan,type GraphAdmission,type GraphAdmissionPlan} from './document-graph-admission';
import {GRAPH_POLICY,type DocumentGraph} from './document-graph';
import {graphPatchSql,graphSourceSql,graphReferencesSql} from './document-graph-sql';
import type {annotationEffects} from './annotation-edits';
import type {BatchChange} from './edit-batch';
import {newEditId} from './splice';
import {graphProseSql} from './document-graph-prose';
import type {ProseOperation} from './document-prose';
export interface GraphCommitOptions {historyChanges?:{source:string;changes:BatchChange[]};archive?:'always'|'coalesce';history?:'whole'|'nodes';title?:string|null;description?:string|null;expectedEditId?:string;initialize?:{document:DocumentGraph;source:string};effects?:ReturnType<typeof annotationEffects>;aliases?:Array<{legacyKey:string;nodeId:string;path:string}>;visibility?:string;ancestorIds?:string[];access?:string;linkRole?:string|null;provenance?:'migration'|'authored'}
export async function commitGraphOperation(db:Queryable,actor:TokenActor|null,scope:Scope,token:GraphAdmission,options:GraphCommitOptions={}):Promise<ArtifactRow|null>{
 return commitGraphMutation(db,actor,scope,graphAdmissionPlan(token),options);
}
export async function commitGraphProseOperation(db:Queryable,actor:TokenActor,id:string,baseEditId:string,op:ProseOperation,scope:Scope):Promise<ArtifactRow|null>{
 return commitGraphMutation(db,actor,scope,{id,fields:{},expectedFields:{},references:[],aliases:[]},{},{baseEditId,op});
}
async function commitGraphMutation(db:Queryable,actor:TokenActor|null,scope:Scope,plan:Pick<GraphAdmissionPlan,'id'|'fields'|'expectedFields'|'references'|'aliases'>&Partial<Pick<GraphAdmissionPlan,'patch'>>,options:GraphCommitOptions,prose?:{baseEditId:string;op:ProseOperation}):Promise<ArtifactRow|null>{
 const editId=newEditId();
 const effective=options.initialize?'$6::jsonb':'l.document';
 const initial=[plan.id,scope.val,editId,actor?.userId??null,actor?.tokenId||null,...(options.initialize?[JSON.stringify(options.initialize.document)]:[])];
 const sql:(ReturnType<typeof graphPatchSql>&{context?:string;history?:{start:string;removed:string;inserted:string;end:string}})|null=prose?graphProseSql(effective,'l.version',prose.baseEditId,prose.op,initial):graphPatchSql(effective,'l.version',plan.patch!,initial);
 if(!sql)return null;
 const context=sql.context??'NULL::jsonb';
 const param=(value:unknown)=>{sql.params.push(value);return `$${sql.params.length}`;};
 const effects=options.effects??{updates:[],receipts:[]},updates=param(JSON.stringify(effects.updates)),receipts=param(JSON.stringify(effects.receipts));
 const originalSource=options.initialize?param(options.initialize.source):null;
 const expectedFields=param(JSON.stringify(plan.expectedFields));
 const meta=prose?"'{}'::jsonb":param(JSON.stringify(plan.fields)),policy=param(GRAPH_POLICY),archive=param(options.archive==='always');
 const title=param(options.title??null),hasTitle=param(options.title!==undefined),description=param(options.description??null),hasDescription=param(options.description!==undefined);
 const expectedEdit=param(options.expectedEditId??null),aliases=param(JSON.stringify(options.aliases??plan.aliases));
 const visibility=param(options.visibility??null),ancestors=param(options.ancestorIds??null),access=param(options.access??null),linkRole=param(options.linkRole??null),provenance=param(options.provenance??'authored');
 const references=param(JSON.stringify(plan.references)),referenceCount=param(plan.references.length);
 const priorSource=originalSource?`${originalSource}::text`:graphSourceSql("(u.previous->'document')");
 const currentSource=graphSourceSql('u.document'),originalUnits=options.initialize?param(options.initialize.source.length):null;
 const historySource=prose?'NULL::text':param(options.historyChanges?.source??null),historyChanges=prose?'NULL::jsonb':param(JSON.stringify(options.historyChanges?.changes??null));
 const logStart=sql.history?sql.history.start.replaceAll('l.mutation_context',"(u.previous->'mutation_context')"):'0';
 const logRemoved=sql.history?sql.history.removed:priorSource,logInserted=sql.history?sql.history.inserted:currentSource;
 const logEnd=sql.history?sql.history.end.replaceAll('l.mutation_context',"(u.previous->'mutation_context')"):originalSource?`${originalUnits}::int`:`COALESCE((SELECT sum((n.value->>'units')::int)::int FROM jsonb_each(u.previous#>'{document,nodes}') n),0)`;
 const ids=`ARRAY(SELECT substring(selector FROM 4) FROM jsonb_each(u.document->'nodes') n CROSS JOIN LATERAL jsonb_array_elements_text(n.value->'selectors') selector WHERE selector LIKE 'id:%')`;
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
 ), mutation_input AS MATERIALIZED (
  SELECT l.*,${context} AS mutation_context FROM locked l
 ), transformed AS MATERIALIZED (
  SELECT l.*,${sql.expression} AS next_document FROM mutation_input l
  WHERE l.format='markup' AND ${effective}->>'policy'=${policy} AND (${expectedEdit}::text IS NULL OR l.edit_id=${expectedEdit}::text) AND ${sql.guard}
   AND NOT EXISTS(SELECT 1 FROM jsonb_each(${expectedFields}::jsonb) f WHERE COALESCE(l.meta->f.key,'null'::jsonb) IS DISTINCT FROM f.value)
 ), updated AS (
  UPDATE artifacts SET document=l.next_document,source=NULL,content='',meta=${prose?"l.meta-'parsedArtifact'":`(l.meta||${meta}::jsonb||jsonb_build_object('refs',${graphReferencesSql('l.next_document')}))-'parsedArtifact'-'compiledCss'-'cssCompileVersion'`},version=l.version+1,edit_id=$3,
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
  INSERT INTO artifact_edits(artifact_id,edit_id,splice_start,removed,inserted,span_start,span_end,actor_user_id,actor_token_id,document_state,annotation_changes,changes)
  SELECT u.id,u.edit_id,${logStart},${logRemoved},${logInserted},${logStart},
   ${logEnd},$4,$5,
   jsonb_build_object('version',u.version,'kind','${prose?'prose':options.history==='whole'?'whole':'graph'}'),(SELECT jsonb_agg(receipt) FROM jsonb_array_elements(${receipts}::jsonb) receipt WHERE receipt->>'annotationId'='' OR receipt->>'annotationId' IN(SELECT id FROM moved_annotations)),
   ${prose?'NULL::jsonb':`CASE WHEN ${historySource}::text=${priorSource} THEN ${historyChanges}::jsonb ELSE NULL END`} FROM updated u
  RETURNING pg_notify('artifact_'||lower(artifact_id),edit_id)
 ), current_ids AS MATERIALIZED (
  SELECT u.id,u.version,${ids}::text[] AS ids FROM updated u WHERE ${prose?'FALSE':'TRUE'}
 ), reserved AS (
  INSERT INTO artifact_source_ids(artifact_id,source_id,provenance,first_version)
  SELECT k.id,source_id,${provenance}::text,k.version FROM current_ids k CROSS JOIN unnest(k.ids) source_id ON CONFLICT DO NOTHING
 ), identities AS (
  UPDATE artifact_source_ids SET retired_version=CASE WHEN source_id=ANY(k.ids) THEN NULL ELSE k.version END
  FROM current_ids k WHERE artifact_id=k.id
 ), aliases AS (
  INSERT INTO artifact_node_aliases(artifact_id,legacy_key,source_id,source_path,created_version)
  SELECT u.id,x->>'legacyKey',x->>'nodeId',x->>'path',u.version FROM updated u CROSS JOIN jsonb_array_elements(${aliases}::jsonb) x ON CONFLICT DO NOTHING
  RETURNING artifact_id,legacy_key,source_id
 ), anchors AS (
  UPDATE annotations a SET anchor_key=x.source_id FROM aliases x WHERE a.artifact_id=x.artifact_id AND a.anchor_key=x.legacy_key
 ) SELECT (to_jsonb(u)-'previous')||jsonb_build_object('shares',COALESCE((SELECT jsonb_agg(jsonb_build_object('email',s.email,'role',s.role) ORDER BY s.email) FROM artifact_shares s WHERE s.artifact_id=u.id),'[]'::jsonb)) AS artifact
 FROM updated u WHERE EXISTS(SELECT 1 FROM logged)`,sql.params);
 return result.rows[0]?hydrateArtifactDocument(result.rows[0].artifact):null;
}
