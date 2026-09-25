/** SQL lowering for internal graph patches. The writer accepts only publication
 * admissions; clients cannot submit these SQL paths, fragments or revision sets.
 */
import {GRAPH_POLICY,GRAPH_ROOT} from './document-graph';
import type {GraphPatch} from './document-graph-patch';
import {MAX_CONTENT_BYTES} from './input';

export function graphPatchSql(document:string,version:string,patch:GraphPatch,initial:unknown[]):{expression:string;guard:string;params:unknown[]} {
  const params=[...initial];
  const param=(value:unknown)=>{params.push(value);return `$${params.length}`;};
  const reads=param(JSON.stringify(patch.reads)),inserted=param(JSON.stringify(patch.inserted)),removed=param(patch.removed),updated=param(JSON.stringify(patch.updated)),touched=param(patch.touched),delta=param(patch.byteDelta),base=param(patch.baseVersion),limit=param(MAX_CONTENT_BYTES),policy=param(GRAPH_POLICY);
  const selections=param(JSON.stringify(patch.selections)),unitDeltas=param(JSON.stringify(patch.unitDeltas)),claims=param(JSON.stringify(patch.claims));
  const nodes=`(${document}->'nodes')`;
  const replacement=`((${nodes}-${removed}::text[])||COALESCE((SELECT jsonb_object_agg(n.key,
    n.value||COALESCE(w.value->'value','{}'::jsonb)
    ||jsonb_build_object('subtreeUnits',(n.value->>'subtreeUnits')::int+COALESCE((${unitDeltas}::jsonb->>n.key)::int,0))
    ||CASE WHEN ${inserted}::jsonb ? n.key OR (w.value->>'self')::boolean THEN jsonb_build_object('selfVersion',${version}+1) ELSE '{}'::jsonb END
    ||CASE WHEN ${inserted}::jsonb ? n.key OR (w.value->>'children')::boolean THEN jsonb_build_object('childrenVersion',${version}+1) ELSE '{}'::jsonb END
    ||CASE WHEN n.key=ANY(${touched}::text[]) THEN jsonb_build_object('subtreeVersion',${version}+1) ELSE '{}'::jsonb END)
    FROM (SELECT key,COALESCE(${inserted}::jsonb->key,${nodes}->key) AS value FROM unnest(${touched}::text[]) key) n
    LEFT JOIN jsonb_each(${updated}::jsonb) w ON w.key=n.key),'{}'::jsonb))`;
  const expression=`(${document}||jsonb_build_object('claimedIds',(${document}->'claimedIds')||COALESCE((SELECT jsonb_object_agg(c.id,${version}+1) FROM jsonb_to_recordset(${claims}::jsonb) c(id text,version int)),'{}'::jsonb),'nodes',${replacement},'bytes',(${document}->>'bytes')::int+${delta}::int))`;
  const guard=`${document}->>'policy'=${policy} AND ${document}->>'kind'='graph'
    AND ${version}-${base}::int BETWEEN 0 AND 200
    AND (${document}->>'bytes')::int+${delta}::int BETWEEN 0 AND ${limit}::int
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${claims}::jsonb) c(id text,version int) WHERE (${document}->'claimedIds'->>c.id)::int IS DISTINCT FROM c.version)
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${selections}::jsonb) s(selector text,keys jsonb)
      WHERE s.keys IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(n.key ORDER BY n.key),'[]'::jsonb)
        FROM jsonb_each(${nodes}) n WHERE (n.value->'selectors') ? s.selector))
    AND NOT (${nodes} ?| ARRAY(SELECT jsonb_object_keys(${inserted}::jsonb)))
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${reads}::jsonb) r(key text,facet text,version int)
      LEFT JOIN jsonb_each(${nodes}) n ON n.key=r.key
      WHERE n.key IS NULL OR (n.value->>r.facet)::int IS DISTINCT FROM r.version)`;
  return {expression,guard,params};
}

/** Serialize server-generated fragments in tree order. jsonb_each extracts the
 * map once; recursive traversal visits each reachable node once. This is used
 * for the exact locked preimage and committed history, never for admission. */
const graphWalkSql=(document:string)=>`WITH RECURSIVE entries AS MATERIALIZED (
      SELECT key,value FROM jsonb_each((${document})->'nodes')
    ), walk(key,path) AS (
      SELECT '${GRAPH_ROOT}'::text,ARRAY[]::int[]
      UNION ALL
      SELECT child.key,walk.path||((child.ordinal-1)*2+1)::int FROM walk
      JOIN entries n ON n.key=walk.key
      CROSS JOIN LATERAL jsonb_array_elements_text(n.value->'children') WITH ORDINALITY child(key,ordinal)
    )`;
export function graphSourceSql(document:string):string {
  return `(${graphWalkSql(document)} SELECT COALESCE(string_agg(part.value,'' ORDER BY walk.path||((part.ordinal-1)*2)::int),'')
      FROM walk JOIN entries n ON n.key=walk.key
      CROSS JOIN LATERAL jsonb_array_elements_text(n.value->'parts') WITH ORDINALITY part(value,ordinal))`;
}
export function graphReferencesSql(document:string):string {
  return `(${graphWalkSql(document)}, reference_list AS (
      SELECT DISTINCT ON (ref.value->>'id') ref.value,walk.path,ref.ordinal
      FROM walk JOIN entries n ON n.key=walk.key
      CROSS JOIN LATERAL jsonb_array_elements(n.value->'refs') WITH ORDINALITY ref(value,ordinal)
      ORDER BY ref.value->>'id',walk.path,ref.ordinal
    ) SELECT COALESCE(jsonb_agg(value ORDER BY path,ordinal),'[]'::jsonb) FROM reference_list)`;
}
